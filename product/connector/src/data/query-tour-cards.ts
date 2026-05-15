/**
 * Structured tour filter — pure SQL, no vector retrieval. Powers
 * `find_options(preferredType: 'tour')` and is included in `blendCards`'s
 * four-way mix at limit=4.
 *
 * Mirrors `query-trips.ts` with three deliberate shifts:
 *   1. ORDER BY RANDOM(), id — imagination-stoking variety by default
 *      (decision C.focused-shamir-4). Tiebreaker by id keeps the rare
 *      random-collision case stable.
 *   2. `excludeIds` support from inception — agent can pass ids to omit
 *      across turns (decision C.focused-shamir-5).
 *   3. day_count + duration_days both selected for query-shape parity with
 *      trip_card. day_count is the honest signal (count of `tour_item`s);
 *      duration_days mirrors it today and can diverge if Swoop sends
 *      explicit durations later.
 *
 * Today's data realities (per C.focused-shamir-2 surfacing):
 *   - 11 tours total, all Patagonia-themed.
 *   - `region` is NULL on every row (source field `contentblock.region_id`
 *     is a dangling reference; tour pages have empty `ntag_ids`). Net
 *     effect: a region filter on tours returns zero — accept; document.
 *   - `from_price`, `currency_code`, `group_size_max`, `accommodation_style`
 *     are NULL today (no source columns). Filters on them effectively skip
 *     all tours; same accept-and-document.
 *   - `activity_tags` is `{}` today (page ntag_ids empty); activity filter
 *     same.
 *
 * Plan: planning/03-exec-crosscut-find-options-v2-backfill.md §2.3.
 */

import type pg from 'pg';
import {
  TourProposalCardSchema,
  type BudgetBand,
  type TourProposalCard,
} from '@swoop/common';

import { resolveImagesByIds } from './resolve-image.js';

export interface QueryTourCardsOptions {
  region?: string | null;
  durationMin?: number | null;
  durationMax?: number | null;
  // The next three are accepted-but-no-op for v2: every row is NULL on these
  // columns today. Shape kept for symmetry with QueryTripCardsOptions and so
  // the dispatch in find_options.ts can forward `SharedFilters` uniformly.
  budgetBand?: BudgetBand | null;
  accommodationStyle?: string | null;
  groupSizeMax?: number | null;
  activity?: string | null;
  /**
   * Tour ids to omit (e.g. items shown in earlier turns). Empty / undefined
   * means no exclusion. Per C.focused-shamir-5.
   */
  excludeIds?: number[];
  limit: number;
}

/** Mirrors trip's budget-band ceiling for shape parity (today's tours have
 * NULL from_price, so the clause never narrows results — but stays symmetric
 * so the day Swoop populates pricing the filter is already wired). */
const BUDGET_CEILING: Record<BudgetBand, number> = {
  budget: 2_000,
  mid: 5_000,
  premium: 10_000,
  luxury: Number.POSITIVE_INFINITY,
};

export async function queryTourCardsByFilter(
  client: pg.PoolClient,
  opts: QueryTourCardsOptions,
): Promise<TourProposalCard[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (opts.region) {
    binds.push(`%${opts.region}%`);
    clauses.push(`region ILIKE $${binds.length}`);
  }
  if (opts.durationMin !== null && opts.durationMin !== undefined) {
    binds.push(opts.durationMin);
    clauses.push(`day_count >= $${binds.length}`);
  }
  if (opts.durationMax !== null && opts.durationMax !== undefined) {
    binds.push(opts.durationMax);
    clauses.push(`day_count <= $${binds.length}`);
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
  if (opts.groupSizeMax !== null && opts.groupSizeMax !== undefined) {
    binds.push(opts.groupSizeMax);
    clauses.push(`(group_size_max IS NULL OR group_size_max <= $${binds.length})`);
  }
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push(opts.excludeIds);
    clauses.push(`id <> ALL($${binds.length}::int[])`);
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT id, slug, headline, vibe_line, region, day_count, duration_days,
           group_size_max, from_price, currency_code, accommodation_style,
           COALESCE(activity_tags, '{}') AS activity_tags,
           canonical_url, image_id
    FROM tour_card
    ${where}
    ORDER BY RANDOM(), id
    LIMIT ${limitBind}
  `;

  const res = await client.query(sql, binds);

  const imageIds = res.rows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  return res.rows.map((r) => {
    const image = r.image_id
      ? (images.get(r.image_id as number) ?? undefined)
      : undefined;
    // Same convention as trip: optional fields use `undefined`; fromPrice is
    // nullable+optional so the UI can render "no price line" distinct from
    // "field omitted".
    const fromPrice =
      r.from_price !== null && r.from_price !== undefined
        ? Number(r.from_price)
        : null;
    return TourProposalCardSchema.parse({
      type: 'tour' as const,
      id: String(r.id),
      ...(r.slug != null ? { slug: r.slug as string } : {}),
      headline: r.headline as string,
      ...(r.vibe_line != null ? { vibeLine: r.vibe_line as string } : {}),
      ...(r.region != null ? { region: r.region as string } : {}),
      ...(r.duration_days != null
        ? { durationDays: r.duration_days as number }
        : {}),
      ...(r.group_size_max != null
        ? { groupSizeMax: r.group_size_max as number }
        : {}),
      ...(r.day_count != null && (r.day_count as number) > 0
        ? { dayCount: r.day_count as number }
        : {}),
      fromPrice,
      ...(r.currency_code != null
        ? { currencyCode: r.currency_code as string }
        : {}),
      ...(r.accommodation_style != null
        ? { accommodationStyle: r.accommodation_style as string }
        : {}),
      activityTags: (r.activity_tags ?? []) as string[],
      canonicalUrl: r.canonical_url as string,
      ...(image ? { image } : {}),
    });
  });
}
