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
import { trimCmsDecorativeWhitespace } from './text-utils.js';

export interface QueryHotelCardsOptions {
  region?: string | null;
  budgetBand?: BudgetBand | null;
  accommodationStyle?: string | null;
  /**
   * Hotel ids to omit (e.g. items shown in earlier turns). Empty / undefined
   * means no exclusion. Per C.focused-shamir-5.
   */
  excludeIds?: number[];
  limit: number;
}

/**
 * Per-night budget ceilings for hotel cards.
 *
 * Calibrated against the 2026-04-27 pricing matrix quartiles (probed at ETL
 * execution — see execution log in the plan). Unlike the trip BUDGET_CEILING
 * (which is trip-scale GBP), these are per-night figures in the hotel's own
 * authored currency.
 *
 * - budget  ≤ 400 /night   (lower quartile of the priced matrix)
 * - mid     ≤ 800 /night   (around median)
 * - premium ≤ 1500 /night  (upper quartile)
 * - luxury  no ceiling     (every priced hotel passes)
 *
 * The HAVING clause is NULL-tolerant: unpriced hotels (no hotel_pricing rows)
 * always pass regardless of band, so they appear alongside priced results
 * unless the agent specifically needs a priced comparison (use get_pricing
 * for that).
 *
 * Decision C.goofy-goldstine-2 + plan §2.3.
 */
export const BUDGET_CEILING: Record<BudgetBand, number> = {
  budget: 400,
  mid: 800,
  premium: 1_500,
  luxury: Number.POSITIVE_INFINITY,
};

/**
 * Pass the source description through full (trim + empty→undefined only).
 * The UI handles visible clamping + an inline "Read more" affordance per
 * planning/03-exec-crosscut-brave-pare-card-expandable-prose.md. Server-side
 * truncation was the previous behaviour and is removed here: cards must not
 * silently truncate without an option to expand. WYSIWYG decorative-whitespace
 * artefacts (`<br>`, `&nbsp;`, empty trailing paragraphs) are stripped via the
 * shared `trimCmsDecorativeWhitespace` helper.
 */
function vibeLineFromDescription(text: string | null | undefined): string | undefined {
  return trimCmsDecorativeWhitespace(text);
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
  // accommodationStyle accepted but NOT applied as a SQL clause —
  // hotel.description is 0/44 populated in puma_dev; the ILIKE filter would
  // guarantee zero results for any supplied value. Lights up when the ETL
  // populates the description column. (2026-06-11 filter-sparsity hot patch)
  void opts.accommodationStyle;
  if (opts.budgetBand) {
    const ceiling = BUDGET_CEILING[opts.budgetBand];
    if (Number.isFinite(ceiling)) {
      binds.push(ceiling);
      // Applied as HAVING because the aggregate is not available in WHERE.
      // Per-night derivation: price::numeric / NULLIF(nights, 0). NULL-tolerant:
      // unpriced hotels (no hotel_pricing rows) always pass so they surface
      // alongside priced results.
      havingClauses.push(
        `(MIN(hp.price::numeric / NULLIF(hp.nights, 0)) IS NULL OR MIN(hp.price::numeric / NULLIF(hp.nights, 0)) <= $${binds.length})`,
      );
    }
  }
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push(opts.excludeIds);
    whereClauses.push(`h.id <> ALL($${binds.length}::int[])`);
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  const where =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const having =
    havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

  const sql = `
    ${HOTEL_SELECT}
    ${where}
    ${HOTEL_GROUP_BY}
    ${having}
    ORDER BY RANDOM(), h.id
    LIMIT ${limitBind}
  `;

  const res = await client.query(sql, binds);
  return mapHotelRows(client, res.rows);
}

/**
 * Shared hotel SELECT/JOIN/GROUP BY block. ONE definition for both the
 * filter and by-id paths so the projection can never drift between them
 * (the drift class that bit the first show_options cut, live-verify
 * 2026-06-12).
 */
const HOTEL_SELECT = `
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
      -- Per-night derivation: divide by nights, cast to avoid integer division.
      -- ROUND to nearest integer — "from $907/night" is false precision.
      -- FILTER ensures unpriced hotels yield NULL (not 0) for from_price.
      ROUND(MIN(hp.price::numeric / NULLIF(hp.nights, 0))
        FILTER (WHERE hp.price IS NOT NULL AND hp.nights IS NOT NULL AND hp.nights > 0)
      )::integer                                AS from_price,
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
`;

const HOTEL_GROUP_BY = `GROUP BY h.id, loc.name, area.name, country.name, p.image_id`;

/**
 * Hydrate full hotel cards for an explicit id list — the `show_options`
 * by-id path (goofy-goldstine find/show split, C.goofy-goldstine-12).
 * Returns rows in DB order; the caller re-sorts to its input order.
 */
export async function queryHotelCardsByIds(
  client: pg.PoolClient,
  ids: number[],
): Promise<HotelProposalCard[]> {
  if (ids.length === 0) return [];
  const sql = `
    ${HOTEL_SELECT}
    WHERE h.id = ANY($1::int[])
    ${HOTEL_GROUP_BY}
  `;
  const res = await client.query(sql, [ids]);
  return mapHotelRows(client, res.rows);
}

/**
 * Shared row → HotelProposalCard projection (filter + by-id paths).
 * Drops rows with no deep-link affordance, resolves page-hub images,
 * parses through the schema.
 */
async function mapHotelRows(
  client: pg.PoolClient,
  rows: Array<Record<string, unknown>>,
): Promise<HotelProposalCard[]> {
  // Filter out rows we can't surface (no deep-link CTA possible).
  const usableRows = rows.filter((r) => {
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
