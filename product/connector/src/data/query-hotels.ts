/**
 * Structured hotel filter — pure SQL, no vector retrieval. Powers the
 * `find_options` `type: 'hotel'` variant.
 *
 * Mirrors the shape of `query-trips.ts` for review consistency. Differences:
 *   - Hotels have no `duration_days`; structured filters for duration are
 *     ignored (handler doesn't thread them through).
 *   - `from_price` aggregates as `MIN(hotel_pricing.price)` per hotel via
 *     GROUP BY; budget-band filter applies via HAVING.
 *   - Hotels have no direct `image_id` (per 2026-04-29 "Hotels have ONLY the
 *     page path" discovery). Image hydration goes via `hotel.page_id →
 *     page.image_id`. Decision C.bf-2 in the v3 backfill plan.
 *
 * Per Tier-3 plan `planning/03-exec-crosscut-find-options-v3-backfill.md`
 * §2.1 (task code BF-FO-v3-1).
 */

import type pg from 'pg';
import {
  HotelProposalCardSchema,
  type BudgetBand,
  type HotelProposalCard,
} from '@swoop/common';

import { resolveImagesByIds } from './resolve-image.js';

export interface QueryHotelCardsOptions {
  region?: string | null;
  budgetBand?: BudgetBand | null;
  accommodationStyle?: string | null;
  limit: number;
}

/**
 * Mirrors `query-trips.ts` BUDGET_CEILING. Order-of-magnitude pricing for
 * filter narrowing only — actual pricing surfaces via `from_price`. `luxury`
 * is `+Infinity` so the filter is a no-op (every priced hotel passes).
 */
const BUDGET_CEILING: Record<BudgetBand, number> = {
  budget: 2_000,
  mid: 5_000,
  premium: 10_000,
  luxury: Number.POSITIVE_INFINITY,
};

/**
 * Pass the source description through full (trim + empty→undefined only).
 * The UI handles visible clamping + an inline "Read more" affordance per
 * planning/03-exec-crosscut-brave-pare-card-expandable-prose.md. Server-side
 * truncation was the previous behaviour and is removed here: cards must not
 * silently truncate without an option to expand.
 */
function vibeLineFromDescription(text: string | null | undefined): string | undefined {
  if (text === null || text === undefined) return undefined;
  const trimmed = String(text).trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Clamp star rating to the schema's 1-5 inclusive range. Out-of-range values
 * (legacy 0, bogus > 5) return undefined — the schema field is optional, so
 * omitting is the right surface.
 */
function clampStarRating(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  if (n < 1 || n > 5) return undefined;
  return n;
}

export async function queryHotelCardsByFilter(
  client: pg.PoolClient,
  opts: QueryHotelCardsOptions,
): Promise<HotelProposalCard[]> {
  const whereClauses: string[] = [];
  const havingClauses: string[] = [];
  const binds: unknown[] = [];

  if (opts.region) {
    binds.push(`%${opts.region}%`);
    const bindRef = `$${binds.length}`;
    whereClauses.push(
      `(area.alias ILIKE ${bindRef} OR area.name ILIKE ${bindRef} OR loc.name ILIKE ${bindRef})`,
    );
  }
  if (opts.accommodationStyle) {
    binds.push(`%${opts.accommodationStyle}%`);
    whereClauses.push(`h.description ILIKE $${binds.length}`);
  }
  if (opts.budgetBand) {
    const ceiling = BUDGET_CEILING[opts.budgetBand];
    if (Number.isFinite(ceiling)) {
      binds.push(ceiling);
      // Applied as HAVING because the aggregate MIN(price) isn't available
      // in the WHERE clause.
      havingClauses.push(
        `(MIN(hp.price) IS NULL OR MIN(hp.price) <= $${binds.length})`,
      );
    }
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  const where =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const having =
    havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

  const sql = `
    SELECT
      h.id,
      h.slug,
      h.name AS headline,
      h.description AS vibe_line_source,
      h.star_rating,
      h.canonical_url,
      h.page_id,
      COALESCE(loc.name, area.name)             AS location,
      COALESCE(area.name, country.name)         AS region,
      MIN(hp.price) FILTER (WHERE hp.price IS NOT NULL) AS from_price,
      (SELECT hp2.currency_code FROM hotel_pricing hp2
        WHERE hp2.hotel_id = h.id AND hp2.currency_code IS NOT NULL
        GROUP BY hp2.currency_code
        ORDER BY COUNT(*) DESC, hp2.currency_code ASC
        LIMIT 1)                                AS currency_code,
      p.image_id                                AS page_image_id
    FROM hotel h
    LEFT JOIN location loc       ON loc.id = h.location_id
    LEFT JOIN area               ON area.id = h.area_id
    LEFT JOIN country            ON country.id = area.country_id
    LEFT JOIN page p             ON p.id = h.page_id
    LEFT JOIN hotel_pricing hp   ON hp.hotel_id = h.id
    ${where}
    GROUP BY h.id, loc.name, area.name, country.name, p.image_id
    ${having}
    ORDER BY MIN(hp.price) NULLS LAST, h.id
    LIMIT ${limitBind}
  `;

  const res = await client.query(sql, binds);

  // Filter out rows we can't surface (no deep-link CTA possible).
  const usableRows = res.rows.filter((r) => {
    return Boolean(r.canonical_url) || Boolean(r.slug);
  });

  const pageImageIds = usableRows.map(
    (r) => r.page_image_id as number | null,
  );
  const images = await resolveImagesByIds(client, pageImageIds);

  return usableRows.map((r) => {
    const image = r.page_image_id
      ? (images.get(r.page_image_id as number) ?? undefined)
      : undefined;
    const fromPrice =
      r.from_price !== null && r.from_price !== undefined
        ? Number(r.from_price)
        : null;
    const starRating = clampStarRating(r.star_rating);
    const vibeLine = vibeLineFromDescription(
      r.vibe_line_source as string | null | undefined,
    );
    const canonicalUrl = (r.canonical_url as string | null) ?? null;
    // Fallback canonicalUrl only fires when h.canonical_url is null but slug
    // is present — defensive against missing canonical_url at the ETL
    // boundary. The base schema requires a URL so a card without either is
    // dropped above.
    const resolvedCanonicalUrl =
      canonicalUrl ??
      `https://www.swoop-patagonia.com/${String(r.slug ?? '').trim()}`;

    return HotelProposalCardSchema.parse({
      type: 'hotel' as const,
      id: String(r.id),
      ...(r.slug != null ? { slug: r.slug as string } : {}),
      headline: r.headline as string,
      ...(vibeLine !== undefined ? { vibeLine } : {}),
      ...(r.region != null ? { region: r.region as string } : {}),
      fromPrice,
      ...(r.currency_code != null
        ? { currencyCode: r.currency_code as string }
        : {}),
      canonicalUrl: resolvedCanonicalUrl,
      ...(r.location != null ? { location: r.location as string } : {}),
      ...(starRating !== undefined ? { starRating } : {}),
      // accommodationStyle: not derived in v3 (no dedicated source column).
      pricingUnit: 'per_night' as const,
      ...(image ? { image } : {}),
    });
  });
}
