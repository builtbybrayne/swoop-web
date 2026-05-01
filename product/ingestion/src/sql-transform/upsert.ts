/**
 * Generic INSERT … ON CONFLICT DO UPDATE batcher for the SQL-transform pipeline.
 *
 * Why this exists: every transformation upserts rows into Postgres in batches.
 * The shape — column allowlist + conflict key + non-clobbering UPDATE clause —
 * is identical across tables. One helper keeps the per-table transformation
 * code focused on filters / flattens / computed columns, and ensures
 * idempotency is wired the same way everywhere (theme 5).
 *
 * Per the C.t3 plan §"Image" + §"Where ntag_ids[] gets aggregated":
 *   - Each transformation declares which columns it owns (everything in the
 *     `columns` array). On conflict, *only those columns* are updated.
 *   - Columns NOT in the `columns` array are left alone — this is how we
 *     avoid clobbering `embedding` / `subject_tags` / `persona_summary`
 *     populated by C.t3a / C.t6.
 */

import type pg from 'pg';

/**
 * Spec for one batch of upserts.
 *
 * `rows` is a list of plain JS objects keyed by column name. The helper builds
 * the `INSERT … VALUES … ON CONFLICT DO UPDATE` SQL parameterised by the
 * column list. Anything in the JS object NOT in `columns` is dropped at SQL
 * time — keeping the boundary explicit avoids accidental column leak.
 */
export interface UpsertSpec<T extends Record<string, unknown>> {
  /** Postgres table name. */
  table: string;
  /** Conflict key column(s). Almost always `['id']`; tour_item / hotel_room are also `['id']`. */
  conflictKeys: readonly string[];
  /**
   * The full ordered column list this batch writes. Used for both the INSERT
   * column projection AND the ON CONFLICT DO UPDATE SET list. Anything in the
   * row object outside this list is silently ignored.
   */
  columns: readonly string[];
  /** Columns to skip in the ON CONFLICT DO UPDATE SET clause (e.g. `id`). */
  noUpdateColumns?: readonly string[];
  rows: readonly T[];
}

export interface UpsertResult {
  written: number;
}

/**
 * Run an upsert batch. Throws on SQL error so the caller can record the
 * failure and decide whether to skip + continue or abort the run.
 *
 * The helper builds a single multi-row INSERT (`VALUES ($1, $2, …), ($N+1, …)`)
 * which is dramatically faster than per-row INSERTs at our scale. Postgres
 * accepts up to ~32K params per statement; we bound batch size at 500 rows
 * (caller's responsibility) so the largest batch is well under that.
 */
export async function upsertBatch<T extends Record<string, unknown>>(
  client: pg.PoolClient,
  spec: UpsertSpec<T>,
): Promise<UpsertResult> {
  if (spec.rows.length === 0) return { written: 0 };

  const colList = spec.columns.map((c) => `"${c}"`).join(', ');
  const conflictColList = spec.conflictKeys.map((c) => `"${c}"`).join(', ');
  const updateCols = spec.columns.filter(
    (c) => !spec.conflictKeys.includes(c) && !(spec.noUpdateColumns ?? []).includes(c),
  );

  const params: unknown[] = [];
  const valueGroups: string[] = [];
  for (const row of spec.rows) {
    const placeholders: string[] = [];
    for (const col of spec.columns) {
      params.push(row[col] ?? null);
      placeholders.push(`$${params.length}`);
    }
    valueGroups.push(`(${placeholders.join(', ')})`);
  }

  const setClause = updateCols.length
    ? updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
    : null;

  const sql = setClause
    ? `INSERT INTO "${spec.table}" (${colList}) VALUES ${valueGroups.join(', ')} ON CONFLICT (${conflictColList}) DO UPDATE SET ${setClause}`
    : `INSERT INTO "${spec.table}" (${colList}) VALUES ${valueGroups.join(', ')} ON CONFLICT (${conflictColList}) DO NOTHING`;

  await client.query(sql, params);
  return { written: spec.rows.length };
}

/**
 * Default safe batch size. Postgres limit is ~32K params; at 30 columns per
 * row, 500 rows = 15K params, comfortably under.
 */
export const DEFAULT_BATCH_SIZE = 500;
