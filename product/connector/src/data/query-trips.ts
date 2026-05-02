/**
 * Structured trip filter — pure SQL, no vector retrieval. Powers `find_options`.
 *
 * Per the C.t4 plan §"Out of scope" + decision C.30: trip-side internals are
 * still settling. This handler reads whatever `trip_card` rows C.t3a populates;
 * empty result is a valid outcome (data integrity surface, not handler logic).
 *
 * Filters compose as ANDed clauses; absent filters drop out cleanly.
 */

import type pg from 'pg';
import { TripCardPublicSchema, type BudgetBand, type TripCardPublic } from '@swoop/common';

import { resolveImagesByIds } from './resolve-image.js';

export interface QueryTripCardsOptions {
  region?: string | null;
  durationMin?: number | null;
  durationMax?: number | null;
  budgetBand?: BudgetBand | null;
  activity?: string | null;
  accommodationStyle?: string | null;
  limit: number;
}

/**
 * Map BudgetBand to a price ceiling (in GBP). Order-of-magnitude pricing for
 * filter narrowing only — actual pricing surfaces via `from_price`. Mirrors
 * the rough-cut calibration committed to in C.t2's contract.
 */
const BUDGET_CEILING: Record<BudgetBand, number> = {
  budget: 2_000,
  mid: 5_000,
  premium: 10_000,
  luxury: Number.POSITIVE_INFINITY,
};

export async function queryTripCardsByFilter(
  client: pg.PoolClient,
  opts: QueryTripCardsOptions,
): Promise<TripCardPublic[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (opts.region) {
    binds.push(`%${opts.region}%`);
    clauses.push(`region ILIKE $${binds.length}`);
  }
  if (opts.durationMin !== null && opts.durationMin !== undefined) {
    binds.push(opts.durationMin);
    clauses.push(`duration_days >= $${binds.length}`);
  }
  if (opts.durationMax !== null && opts.durationMax !== undefined) {
    binds.push(opts.durationMax);
    clauses.push(`duration_days <= $${binds.length}`);
  }
  if (opts.budgetBand) {
    const ceiling = BUDGET_CEILING[opts.budgetBand];
    if (Number.isFinite(ceiling)) {
      binds.push(ceiling);
      clauses.push(`(from_price IS NULL OR from_price <= $${binds.length})`);
    }
  }
  if (opts.activity) {
    binds.push(opts.activity);
    clauses.push(`$${binds.length} = ANY(activity_tags)`);
  }
  if (opts.accommodationStyle) {
    binds.push(`%${opts.accommodationStyle}%`);
    clauses.push(`accommodation_style ILIKE $${binds.length}`);
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT id, slug, headline, vibe_line, region, duration_days,
           from_price, currency_code, accommodation_style,
           COALESCE(activity_tags, '{}') AS activity_tags,
           canonical_url, image_id
    FROM trip_card
    ${where}
    ORDER BY duration_days NULLS LAST, from_price NULLS LAST, id
    LIMIT ${limitBind}
  `;

  const res = await client.query(sql, binds);

  const imageIds = res.rows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  return res.rows.map((r) =>
    TripCardPublicSchema.parse({
      id: r.id as number,
      slug: (r.slug ?? null) as string | null,
      headline: r.headline as string,
      vibeLine: (r.vibe_line ?? null) as string | null,
      region: (r.region ?? null) as string | null,
      durationDays: (r.duration_days ?? null) as number | null,
      fromPrice:
        r.from_price !== null && r.from_price !== undefined
          ? Number(r.from_price)
          : null,
      currencyCode: (r.currency_code ?? null) as string | null,
      accommodationStyle: (r.accommodation_style ?? null) as string | null,
      activityTags: (r.activity_tags ?? []) as string[],
      canonicalUrl: r.canonical_url as string,
      image: r.image_id ? (images.get(r.image_id as number) ?? null) : null,
    }),
  );
}
