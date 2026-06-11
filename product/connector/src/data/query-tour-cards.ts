/**
 * Structured tour filter — SQL filters + optional hybrid ranking. Powers
 * `find_options(preferredType: 'tour')` and is included in `blendCards`'s
 * four-way mix.
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
 * Today's data realities:
 *   - 11 tours total, all Patagonia-themed.
 *   - `region` is informational, NOT a filter (C.focused-shamir-6). Two of
 *     the 11 tours are anchored to a specific region (Atacama, Torres del
 *     Paine); the rest are pan-region. Region hierarchy (Torres del Paine ⊂
 *     Patagonia ⊂ Chile) doesn't reduce to ILIKE filtering, so the tool
 *     surfaces every tour and lets the conversational agent decide which
 *     fits the visitor's region focus. Region appears on each card so the
 *     agent has the label to reason about + frame in prose.
 *   - `from_price` / `group_size_max` are NULL today (no source columns) but
 *     their clauses are NULL-tolerant (`IS NULL OR …`) — harmless soft
 *     filters that light up if Swoop ever populates pricing / group size.
 *   - `accommodation_style` (NULL on all 11 rows) and `activity_tags` (`{}`
 *     on all 11 — page ntag_ids empty) had HARD clauses that guaranteed zero
 *     results whenever the agent supplied either filter. Removed 2026-06-11
 *     (filter-sparsity hot-patch sibling extension; see
 *     planning/reviews/2026-06-11-widget-emptiness-diagnosis.md §3 M1).
 *     Both fields are accepted-but-ignored until the columns populate.
 *
 * goofy-goldstine reshape (2026-06-11, C.goofy-goldstine-10): when
 * `queryEmbedding` + `queryText` are supplied, ORDER BY shifts from RANDOM()
 * to RRF hybrid (cosine ANN on `tour_card.embedding` + ts_rank on
 * `tour_card.tsv` if present). RANDOM() demoted to tiebreak.
 * NOTE: `tour_card.tsv` existence verified at execution — if absent, the
 * text CTE leg falls back to embedding-only by returning no rows (the
 * vecCTE still fires). The 11-row corpus means hybrid adds marginal value
 * over random here; wired symmetrically with trip for future-proofing.
 *
 * Plan: planning/03-exec-crosscut-find-options-v2-backfill.md §2.3.
 */

import type pg from 'pg';
import {
  TourProposalCardSchema,
  type BudgetBand,
  type TourProposalCard,
} from '@swoop/common';

import { buildHybridSearchSql } from './hybrid-search.js';
import { resolveImagesByIds } from './resolve-image.js';

export interface QueryTourCardsOptions {
  /**
   * Accepted-but-ignored (C.focused-shamir-6). Region hierarchy can't reduce
   * to ILIKE filtering on a single string; the tool returns every tour and
   * lets the agent decide contextually. Shape kept for dispatch symmetry
   * with the other primitives via `SharedFilters` in find_options.ts.
   */
  region?: string | null;
  durationMin?: number | null;
  durationMax?: number | null;
  // budgetBand + groupSizeMax compose NULL-tolerant clauses (soft — every
  // NULL row passes), kept wired for the day Swoop populates the columns.
  budgetBand?: BudgetBand | null;
  // accommodationStyle + activity are accepted-but-IGNORED: their columns are
  // empty on all 11 rows and the former hard clauses guaranteed zero results
  // (2026-06-11 filter-sparsity hot-patch sibling extension). Shape kept for
  // dispatch symmetry via `SharedFilters` in find_options.ts.
  accommodationStyle?: string | null;
  groupSizeMax?: number | null;
  activity?: string | null;
  /**
   * Tour ids to omit (e.g. items shown in earlier turns). Empty / undefined
   * means no exclusion. Per C.focused-shamir-5.
   */
  excludeIds?: number[];
  /**
   * When present, activates hybrid ranking (RRF over cosine ANN on
   * `tour_card.embedding` + ts_rank on `tour_card.tsv` if populated).
   * Both must be supplied together. RANDOM() demoted to tiebreak.
   * Per C.goofy-goldstine-10 (2026-06-11).
   */
  queryEmbedding?: number[] | null;
  queryText?: string | null;
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

  // NOTE: opts.region is intentionally NOT applied as a WHERE clause
  // (C.focused-shamir-6). Tour catalogue is small + region hierarchy
  // (Torres del Paine ⊂ Patagonia ⊂ Chile) doesn't reduce to a flat
  // string match. The agent reads the `region` field on returned cards
  // and frames in prose.
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
  // activity_tags is {} and accommodation_style NULL on all 11 tour rows —
  // the former `= ANY(activity_tags)` and `accommodation_style ILIKE` hard
  // clauses guaranteed zero results whenever the agent supplied either
  // filter ("kayaking tours" → 0 of 11). Accepted-but-ignored until the
  // columns populate. (2026-06-11 filter-sparsity hot patch, sibling
  // extension.)
  void opts.activity;
  void opts.accommodationStyle;
  if (opts.groupSizeMax !== null && opts.groupSizeMax !== undefined) {
    binds.push(opts.groupSizeMax);
    clauses.push(`(group_size_max IS NULL OR group_size_max <= $${binds.length})`);
  }
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    binds.push(opts.excludeIds);
    clauses.push(`id <> ALL($${binds.length}::int[])`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const useHybrid =
    opts.queryEmbedding != null &&
    opts.queryEmbedding.length > 0 &&
    opts.queryText != null &&
    opts.queryText.length > 0;

  let sql: string;
  let queryBinds: unknown[];

  if (useHybrid) {
    // Hybrid path: RRF over cosine ANN on tour_card.embedding + ts_rank on
    // tour_card.tsv (if populated). Filter clauses apply inside both CTEs.
    // RANDOM() demoted to tiebreak. Per C.goofy-goldstine-10 (2026-06-11).
    const embedding = opts.queryEmbedding!;
    const queryText = opts.queryText!;
    const limit = opts.limit;
    // Rebuild filter binds offset by 3 (embedding=$1, query=$2, limit=$3)
    const filterClauses: string[] = [];
    const filterBinds: unknown[] = [];
    if (opts.durationMin !== null && opts.durationMin !== undefined) {
      filterBinds.push(opts.durationMin);
      filterClauses.push(`day_count >= $${filterBinds.length + 3}`);
    }
    if (opts.durationMax !== null && opts.durationMax !== undefined) {
      filterBinds.push(opts.durationMax);
      filterClauses.push(`day_count <= $${filterBinds.length + 3}`);
    }
    if (opts.budgetBand) {
      const ceiling = BUDGET_CEILING[opts.budgetBand];
      if (Number.isFinite(ceiling)) {
        filterBinds.push(ceiling);
        filterClauses.push(`(from_price IS NULL OR from_price <= $${filterBinds.length + 3})`);
      }
    }
    // activity + accommodationStyle: accepted-but-ignored (0-populated columns)
    void opts.activity;
    void opts.accommodationStyle;
    if (opts.groupSizeMax !== null && opts.groupSizeMax !== undefined) {
      filterBinds.push(opts.groupSizeMax);
      filterClauses.push(`(group_size_max IS NULL OR group_size_max <= $${filterBinds.length + 3})`);
    }
    if (opts.excludeIds && opts.excludeIds.length > 0) {
      filterBinds.push(opts.excludeIds);
      filterClauses.push(`id <> ALL($${filterBinds.length + 3}::int[])`);
    }
    const hybridWhere =
      filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

    sql = buildHybridSearchSql({
      vectorCte: `
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
        FROM tour_card
        WHERE embedding IS NOT NULL ${hybridWhere}
        ORDER BY embedding <=> $1::vector
        LIMIT 50
      `,
      textCte: `
        SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC) AS rank
        FROM tour_card
        WHERE tsv IS NOT NULL AND tsv @@ websearch_to_tsquery('english', $2) ${hybridWhere}
        ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC
        LIMIT 50
      `,
      outerSelect: `
        SELECT tc.id, tc.slug, tc.headline, tc.vibe_line, tc.region,
               tc.day_count, tc.duration_days, tc.group_size_max,
               tc.from_price, tc.currency_code, tc.accommodation_style,
               COALESCE(tc.activity_tags, '{}') AS activity_tags,
               tc.canonical_url, tc.image_id, fused.rrf_score
        FROM fused
        JOIN tour_card tc ON tc.id = fused.id
      `,
      tail: `ORDER BY rrf_score DESC, RANDOM(), id LIMIT $3`,
    });
    queryBinds = [`[${embedding.join(',')}]`, queryText, limit, ...filterBinds];
  } else {
    // Random-variety path (decision C.focused-shamir-4). Falls back here when
    // no query supplied.
    binds.push(opts.limit);
    const limitBind = `$${binds.length}`;
    sql = `
      SELECT id, slug, headline, vibe_line, region, day_count, duration_days,
             group_size_max, from_price, currency_code, accommodation_style,
             COALESCE(activity_tags, '{}') AS activity_tags,
             canonical_url, image_id
      FROM tour_card
      ${where}
      ORDER BY RANDOM(), id
      LIMIT ${limitBind}
    `;
    queryBinds = binds;
  }

  const res = await client.query(sql, queryBinds);

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
