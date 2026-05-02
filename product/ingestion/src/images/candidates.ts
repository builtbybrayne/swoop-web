/**
 * Candidate selection for the C.t6 image annotation pipeline.
 *
 * The annotation pipeline runs only over images that meet two criteria:
 *
 *   1. They have a usable image URL — `image.canonical_url` populated by
 *      C.t3's transform. Rows without one (FK-nullified or genuinely
 *      missing) are excluded; the pipeline can't show Vision a URL it
 *      doesn't have.
 *
 *   2. They are missing or have a whitespace-only upstream description.
 *      Per HITL Q2 (2026-05-01), the new `image.annotation` column writes
 *      always; the description column writes ONLY when upstream is empty.
 *      The candidate filter below is the description filter — annotation
 *      writes that overlap an existing description are still useful, BUT
 *      the cost-vs-value calc is best served by populating only rows that
 *      need a description first. After full-catalogue coverage, a
 *      future re-run can widen the filter to "annotation IS NULL" and
 *      pick up everything else.
 *
 *  Filter shape: `description IS NULL OR TRIM(description) = ''`. The
 *  TRIM is load-bearing — upstream sometimes carries a single space or
 *  whitespace as a "we tried to populate but had nothing" sentinel.
 *
 *  Idempotency: a second run of the same filter returns rows that have
 *  not yet had their description filled. Within the run, the checkpoint
 *  tracks per-id status so a `--resume` doesn't re-process completed
 *  rows.
 */

import type pg from 'pg';

/**
 * One row of the candidate set. We pull only what the Vision call + the
 * write-back need — id + URL + the existing description (so the
 * write-back can verify the UPDATE doesn't clobber an upstream value
 * that landed mid-run).
 */
export interface Candidate {
  id: number;
  canonical_url: string;
  /** Existing upstream description, possibly empty/whitespace. */
  description: string | null;
  /** Existing annotation; if populated, this is a re-annotation. */
  annotation: string | null;
}

/**
 * Build the WHERE-clause filter SQL fragment + params shared by the
 * count query and the row-fetch query. Splitting this avoids a copy-
 * paste drift between the two queries.
 *
 * `limit` is honoured downstream by the SELECT; the count query never
 * limits.
 */
function candidatesWhere(): string {
  return `
    canonical_url IS NOT NULL
    AND TRIM(canonical_url) <> ''
    AND (description IS NULL OR TRIM(description) = '')
  `;
}

/**
 * Count how many rows match the candidate filter. Used by the cost
 * estimator to project per-call cost over the candidate set.
 */
export async function countCandidates(client: pg.PoolClient): Promise<number> {
  const sql = `SELECT COUNT(*)::INTEGER AS n FROM image WHERE ${candidatesWhere()}`;
  const res = await client.query<{ n: number }>(sql);
  return res.rows[0]?.n ?? 0;
}

/**
 * Fetch up to `limit` candidates, ordered by id ascending. Stable order
 * means a `--resume` after a crash picks up where the last run left off
 * (combined with checkpoint state).
 */
export async function fetchCandidates(
  client: pg.PoolClient,
  limit: number,
): Promise<Candidate[]> {
  if (limit <= 0) return [];
  const sql = `
    SELECT id, canonical_url, description, annotation
    FROM image
    WHERE ${candidatesWhere()}
    ORDER BY id ASC
    LIMIT $1
  `;
  const res = await client.query<Candidate>(sql, [limit]);
  return res.rows;
}

/**
 * Fetch candidates by explicit id list. Used by `--resume` paths that
 * already know which ids they want to retry from the checkpoint.
 */
export async function fetchCandidatesByIds(
  client: pg.PoolClient,
  ids: number[],
): Promise<Candidate[]> {
  if (ids.length === 0) return [];
  const sql = `
    SELECT id, canonical_url, description, annotation
    FROM image
    WHERE id = ANY($1::INTEGER[])
    ORDER BY id ASC
  `;
  const res = await client.query<Candidate>(sql, [ids]);
  return res.rows;
}
