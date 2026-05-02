/**
 * Reciprocal Rank Fusion (RRF) helper for hybrid retrieval.
 *
 * Per HITL Q4 ratification of 03-exec-c-t4.md: RRF k=60 default. Cosine ANN
 * (pgvector HNSW) and lexical (tsvector GIN) ranks fuse via:
 *
 *     score(d) = sum_i 1 / (k + rank_i(d))
 *
 * Implemented over the live Postgres pool. The CTE-based single-query
 * variant (per the C.t4 plan §"primitives") composes:
 *
 *   WITH vec_ranked  AS (... ORDER BY embedding <=> $1 LIMIT 50),
 *        text_ranked AS (... ORDER BY ts_rank(...) LIMIT 50)
 *   SELECT id, max(score) AS rrf_score, ...
 *   FROM (
 *     SELECT id, 1.0/($k + rank) AS score FROM vec_ranked
 *     UNION ALL
 *     SELECT id, 1.0/($k + rank) AS score FROM text_ranked
 *   ) ranked
 *   GROUP BY id
 *   ORDER BY rrf_score DESC
 *   LIMIT $limit
 *
 * Each derived-table primitive specialises this template. The fusion happens
 * in SQL, not in TypeScript — keeps the round-trip count to one and lets
 * Postgres do the heavy lifting.
 */

export const RRF_K = 60 as const;
export const HNSW_EF_SEARCH_DEFAULT = 40 as const;

/**
 * SQL fragment for RRF over two ordered CTEs. Each CTE selects `id` and is
 * ordered by its retrieval mechanism (cosine distance / ts_rank). The outer
 * query computes `1.0 / (k + row_number)` per candidate, sums per id, and
 * selects the top N.
 *
 * Caller binds:
 *   $1 = embedding vector (number[1024])
 *   $2 = tsquery string (websearch_to_tsquery format)
 *   $3 = result limit (integer)
 *   ...optional filter binds at index $4+ depending on tool
 *
 * Each tool builds the inner CTEs against its own table; only the column list
 * + table + filter clause vary.
 */
export interface RrfTemplate {
  /** Per-table CTE producing `(id, rank)` ordered by cosine distance. */
  readonly vectorCte: string;
  /** Per-table CTE producing `(id, rank)` ordered by ts_rank. */
  readonly textCte: string;
  /** Final SELECT projecting the row columns plus `rrf_score`. */
  readonly outerSelect: string;
  /** ORDER BY + LIMIT clause. */
  readonly tail: string;
}

/**
 * Build the full SQL string from a per-tool RrfTemplate. Keeps the RRF arithmetic
 * in one place; per-tool primitives compose the SELECT shape and filter shape
 * via the template.
 */
export function buildHybridSearchSql(t: RrfTemplate): string {
  return `
    WITH vec_ranked AS (${t.vectorCte}),
         text_ranked AS (${t.textCte}),
         scored AS (
           SELECT id, 1.0 / (${RRF_K} + rank) AS score FROM vec_ranked
           UNION ALL
           SELECT id, 1.0 / (${RRF_K} + rank) AS score FROM text_ranked
         ),
         fused AS (
           SELECT id, SUM(score)::float8 AS rrf_score
           FROM scored
           GROUP BY id
         )
    ${t.outerSelect}
    ${t.tail}
  `;
}
