/**
 * Structured trip filter — pure SQL, no vector retrieval. Powers `find_options`.
 *
 * Per the C.t4 plan §"Out of scope" + decision C.30: trip-side internals are
 * still settling. This handler reads whatever `trip_card` rows C.t3a populates;
 * empty result is a valid outcome (data integrity surface, not handler logic).
 *
 * Filters compose as ANDed clauses; absent filters drop out cleanly.
 *
 * Crosscut C.48 (v1 tranche, 2026-05-12): the primitive now returns
 * `TripProposalCard[]` — the `trip` variant of `ProposalCardPublicSchema`'s
 * discriminated union. Every card carries `type: 'trip'`. Tour / hotel /
 * region_base data primitives land in v2 / v3 tranches.
 */

import type pg from 'pg';
import {
  TripProposalCardSchema,
  type BudgetBand,
  type TripProposalCard,
} from '@swoop/common';

import { resolveImagesByIds } from './resolve-image.js';

export interface QueryTripCardsOptions {
  region?: string | null;
  durationMin?: number | null;
  durationMax?: number | null;
  budgetBand?: BudgetBand | null;
  activity?: string | null;
  /**
   * Accepted-but-ignored — `trip_card.accommodation_style` is 0/649 populated
   * in puma_dev (ETL never derives it), so the ILIKE clause guaranteed zero
   * results whenever the agent supplied the filter. Sibling of the 2026-06-11
   * filter-sparsity hot patch; see
   * planning/reviews/2026-06-11-widget-emptiness-diagnosis.md §3 M1.
   * Lights up when ETL populates the column.
   */
  accommodationStyle?: string | null;
  /**
   * Trip ids to omit (e.g. items shown in earlier turns). Empty / undefined
   * means no exclusion. Per C.focused-shamir-5.
   */
  excludeIds?: number[];
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
): Promise<TripProposalCard[]> {
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
  // accommodation_style is 0/649 populated — the ILIKE clause structurally
  // zeroed every query that supplied the filter ("lodge-based trip" → 0 of
  // 151 matching TdP trips). Accepted-but-ignored until ETL populates the
  // column. (2026-06-11 filter-sparsity hot patch, sibling-trap extension.)
  void opts.accommodationStyle;
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push(opts.excludeIds);
    clauses.push(`id <> ALL($${binds.length}::int[])`);
  }

  binds.push(opts.limit);
  const limitBind = `$${binds.length}`;

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  // ORDER BY RANDOM() — imagination-stoking variety by default (decision
  // C.focused-shamir-4). Supersedes the previous cheapest-first / shortest-
  // first implicit ranking. id tiebreaker stabilises the rare collision case.
  const sql = `
    SELECT id, slug, headline, vibe_line, region, duration_days,
           from_price, currency_code, accommodation_style,
           COALESCE(activity_tags, '{}') AS activity_tags,
           canonical_url, image_id
    FROM trip_card
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
    // Optional fields use `undefined` (not `null`) — `ProposalCardBaseFields`
    // declares them with `.optional()`, no `.nullable()`. `.strict()` rejects
    // explicit `null` for an absent value. `fromPrice` is the lone exception
    // (`.nullable().optional()`) so the price line can render "no price"
    // distinct from "field omitted".
    const fromPrice =
      r.from_price !== null && r.from_price !== undefined
        ? Number(r.from_price)
        : null;
    return TripProposalCardSchema.parse({
      type: "trip" as const,
      id: String(r.id),
      ...(r.slug != null ? { slug: r.slug as string } : {}),
      headline: r.headline as string,
      ...(r.vibe_line != null ? { vibeLine: r.vibe_line as string } : {}),
      ...(r.region != null ? { region: r.region as string } : {}),
      ...(r.duration_days != null
        ? { durationDays: r.duration_days as number }
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
