/**
 * Structured trip filter — SQL filters + optional hybrid ranking. Powers
 * `find_options` (browse leg).
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
 *
 * goofy-goldstine reshape (2026-06-11, C.goofy-goldstine-10): when
 * `queryEmbedding` + `queryText` are supplied, ORDER BY shifts from RANDOM()
 * to RRF hybrid (cosine ANN on `trip_card.embedding` + ts_rank on
 * `trip_card.tsv`). RANDOM() demoted to tiebreak among equal RRF scores.
 * Filters still apply before ranking — they constrain, embeddings order.
 */

import type pg from 'pg';
import {
  TripProposalCardSchema,
  type BudgetBand,
  type TripProposalCard,
} from '@swoop/common';

import { buildHybridSearchSql } from './hybrid-search.js';
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
  /**
   * When present, activates hybrid ranking (RRF over cosine ANN on
   * `trip_card.embedding` + ts_rank on `trip_card.tsv`). Both must be
   * supplied together. RANDOM() demoted to tiebreak/fallback.
   * Per C.goofy-goldstine-10 (2026-06-11).
   */
  queryEmbedding?: number[] | null;
  queryText?: string | null;
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

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const useHybrid =
    opts.queryEmbedding != null &&
    opts.queryEmbedding.length > 0 &&
    opts.queryText != null &&
    opts.queryText.length > 0;

  let sql: string;
  let queryBinds: unknown[];

  if (useHybrid) {
    // Hybrid path: RRF over cosine ANN (trip_card.embedding) + ts_rank
    // (trip_card.tsv). Filter clauses apply inside BOTH hybrid CTE legs so
    // the WHERE constraint reduces the candidate pool before ranking.
    // RANDOM() demoted to tiebreak among equal RRF scores.
    // Per C.goofy-goldstine-10 (2026-06-11).
    const embedding = opts.queryEmbedding!;
    const queryText = opts.queryText!;
    const limit = opts.limit;
    // Hybrid binds: $1 = embedding, $2 = query text, $3 = limit
    // Filter binds begin at $4+ (offset by 3).
    const filterClauses: string[] = [];
    const filterBinds: unknown[] = [];
    if (opts.region) {
      filterBinds.push(`%${opts.region}%`);
      filterClauses.push(`region ILIKE $${filterBinds.length + 3}`);
    }
    if (opts.durationMin !== null && opts.durationMin !== undefined) {
      filterBinds.push(opts.durationMin);
      filterClauses.push(`duration_days >= $${filterBinds.length + 3}`);
    }
    if (opts.durationMax !== null && opts.durationMax !== undefined) {
      filterBinds.push(opts.durationMax);
      filterClauses.push(`duration_days <= $${filterBinds.length + 3}`);
    }
    if (opts.budgetBand) {
      const ceiling = BUDGET_CEILING[opts.budgetBand];
      if (Number.isFinite(ceiling)) {
        filterBinds.push(ceiling);
        filterClauses.push(`(from_price IS NULL OR from_price <= $${filterBinds.length + 3})`);
      }
    }
    if (opts.activity) {
      filterBinds.push(opts.activity);
      filterClauses.push(`$${filterBinds.length + 3} = ANY(activity_tags)`);
    }
    // accommodation_style: accepted-but-ignored (0/649 populated)
    void opts.accommodationStyle;
    if (opts.excludeIds && opts.excludeIds.length > 0) {
      filterBinds.push(opts.excludeIds);
      filterClauses.push(`id <> ALL($${filterBinds.length + 3}::int[])`);
    }
    const hybridWhere =
      filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

    sql = buildHybridSearchSql({
      vectorCte: `
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
        FROM trip_card
        WHERE embedding IS NOT NULL ${hybridWhere}
        ORDER BY embedding <=> $1::vector
        LIMIT 50
      `,
      textCte: `
        SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC) AS rank
        FROM trip_card
        WHERE tsv @@ websearch_to_tsquery('english', $2) ${hybridWhere}
        ORDER BY ts_rank(tsv, websearch_to_tsquery('english', $2)) DESC
        LIMIT 50
      `,
      outerSelect: `
        SELECT tc.id, tc.slug, tc.headline, tc.vibe_line, tc.region,
               tc.duration_days, tc.from_price, tc.currency_code,
               tc.accommodation_style,
               COALESCE(tc.activity_tags, '{}') AS activity_tags,
               tc.canonical_url, tc.image_id, fused.rrf_score
        FROM fused
        JOIN trip_card tc ON tc.id = fused.id
      `,
      tail: `ORDER BY rrf_score DESC, RANDOM(), id LIMIT $3`,
    });
    queryBinds = [`[${embedding.join(',')}]`, queryText, limit, ...filterBinds];
  } else {
    // Random-variety path (decision C.focused-shamir-4). RANDOM() tiebreak,
    // id for stability. Falls back here when no query supplied.
    binds.push(opts.limit);
    const limitBind = `$${binds.length}`;
    sql = `
      SELECT id, slug, headline, vibe_line, region, duration_days,
             from_price, currency_code, accommodation_style,
             COALESCE(activity_tags, '{}') AS activity_tags,
             canonical_url, image_id
      FROM trip_card
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
