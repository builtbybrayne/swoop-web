/**
 * Data primitives for the `sales_memory` / `sales_memory_version` tables.
 *
 * Operations:
 *   createMemory    — INSERT into sales_memory + version row (change_kind='create')
 *   editMemory      — UPDATE sales_memory + INSERT version row ('edit'), in ONE
 *                     transaction; optimistic concurrency on the `version` column.
 *   retireMemory    — UPDATE status='retired' + INSERT version row ('retire'), in
 *                     ONE transaction. Soft-delete only — never hard-delete.
 *   listActive      — SELECT active rows ordered by created_at DESC (stable,
 *                     deterministic). Single indexed query; the index on
 *                     (status, created_at DESC) WHERE status='active' is in
 *                     migration 020.
 *   getHistory      — SELECT all version rows for a memory_id, ORDER BY version ASC.
 *
 * Invariants:
 *   - Hard DELETE is never issued. All removal is via status='retired'.
 *   - Every mutation appends a version row. The version counter on sales_memory
 *     starts at 1 and increments by 1 on every edit/retire/restore.
 *   - Optimistic concurrency: editMemory rejects if the current DB version ≠
 *     expectedVersion. The caller must reload and retry.
 *   - No embeddings, no pgvector. Content is plain TEXT loaded whole.
 *
 * SM.t1 (sales-memory store + CRUD, connector side).
 */

import type pg from 'pg';
import {
  SalesMemoryPublicSchema,
  SalesMemoryVersionPublicSchema,
  type SalesMemoryPublic,
  type SalesMemoryVersionPublic,
} from '@swoop/common';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown when an edit is rejected because the caller supplied a stale version. */
export class SalesMemoryVersionConflictError extends Error {
  constructor(
    public readonly id: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `[sales-memory] Version conflict on memory ${id}: expected version ${expectedVersion} but found ${actualVersion}. Reload and retry.`,
    );
    this.name = 'SalesMemoryVersionConflictError';
  }
}

/** Thrown when a memory id is not found. */
export class SalesMemoryNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`[sales-memory] Memory not found: ${id}`);
    this.name = 'SalesMemoryNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Row → public shape helpers
// ---------------------------------------------------------------------------

function rowToPublic(row: Record<string, unknown>): SalesMemoryPublic {
  return SalesMemoryPublicSchema.parse({
    id: row.id,
    content: row.content,
    updatedBy: row.updated_by,
    // pg returns TIMESTAMPTZ as a JS Date; convert to ISO string for transport.
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  });
}

function versionRowToPublic(
  row: Record<string, unknown>,
): SalesMemoryVersionPublic {
  return SalesMemoryVersionPublicSchema.parse({
    id: row.id,
    memoryId: row.memory_id,
    version: row.version,
    content: row.content,
    changeKind: row.change_kind,
    author: row.author,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  });
}

// ---------------------------------------------------------------------------
// createMemory
// ---------------------------------------------------------------------------

export interface CreateMemoryOptions {
  content: string;
  author: string;
}

/**
 * Insert a new active memory entry and its initial version row (change_kind='create').
 * Returns the public shape of the new row.
 */
export async function createMemory(
  client: pg.PoolClient,
  opts: CreateMemoryOptions,
): Promise<SalesMemoryPublic> {
  // Both inserts in one transaction so we never have a memory row without a
  // corresponding version row.
  await client.query('BEGIN');
  try {
    const insertMemory = await client.query<Record<string, unknown>>(
      `
      INSERT INTO sales_memory (content, status, version, created_by, updated_by)
      VALUES ($1, 'active', 1, $2, $2)
      RETURNING id, content, status, version, created_by, created_at, updated_by, updated_at
      `,
      [opts.content, opts.author],
    );
    const row = insertMemory.rows[0];
    if (!row) {
      throw new Error('[sales-memory] createMemory: INSERT returned no row');
    }

    await client.query(
      `
      INSERT INTO sales_memory_version (memory_id, version, content, change_kind, author)
      VALUES ($1, 1, $2, 'create', $3)
      `,
      [row.id, opts.content, opts.author],
    );

    await client.query('COMMIT');
    return rowToPublic(row);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// editMemory
// ---------------------------------------------------------------------------

export interface EditMemoryOptions {
  id: string;
  content: string;
  expectedVersion: number;
  author: string;
}

/**
 * Update the content of an existing active memory entry.
 *
 * Uses optimistic concurrency: the UPDATE WHERE clause requires that the current
 * DB `version` equals `expectedVersion`. If another writer has already bumped the
 * version, the UPDATE touches 0 rows and we throw `SalesMemoryVersionConflictError`.
 *
 * Both the UPDATE of `sales_memory` and the INSERT of the version row happen in
 * ONE transaction (the caller-supplied client is used directly — the caller is
 * responsible for borrowing and releasing through `withClient`).
 */
export async function editMemory(
  client: pg.PoolClient,
  opts: EditMemoryOptions,
): Promise<SalesMemoryPublic> {
  const newVersion = opts.expectedVersion + 1;

  await client.query('BEGIN');
  try {
    const updateResult = await client.query<Record<string, unknown>>(
      `
      UPDATE sales_memory
      SET
        content    = $1,
        version    = $2,
        updated_by = $3,
        updated_at = NOW()
      WHERE id = $4
        AND version = $5
      RETURNING id, content, status, version, created_by, created_at, updated_by, updated_at
      `,
      [opts.content, newVersion, opts.author, opts.id, opts.expectedVersion],
    );

    if (updateResult.rowCount === 0) {
      // Either the id doesn't exist or the version has already moved forward.
      // Peek at the current state to give the caller a useful error.
      const peek = await client.query<Record<string, unknown>>(
        `SELECT version FROM sales_memory WHERE id = $1`,
        [opts.id],
      );
      await client.query('ROLLBACK');
      if (peek.rowCount === 0) {
        throw new SalesMemoryNotFoundError(opts.id);
      }
      const actual = peek.rows[0]?.version as number;
      throw new SalesMemoryVersionConflictError(
        opts.id,
        opts.expectedVersion,
        actual,
      );
    }

    const row = updateResult.rows[0]!;

    await client.query(
      `
      INSERT INTO sales_memory_version (memory_id, version, content, change_kind, author)
      VALUES ($1, $2, $3, 'edit', $4)
      `,
      [opts.id, newVersion, opts.content, opts.author],
    );

    await client.query('COMMIT');
    return rowToPublic(row);
  } catch (err) {
    // ROLLBACK is a no-op if we already committed; safe to call unconditionally.
    // (pg silently ignores ROLLBACK outside a transaction.)
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow secondary rollback error — original error is more useful.
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// retireMemory
// ---------------------------------------------------------------------------

export interface RetireMemoryOptions {
  id: string;
  author: string;
}

/**
 * Soft-delete a memory by setting status='retired' and bumping the version.
 * Appends a version row with change_kind='retire'. Returns the updated id + status.
 *
 * Idempotent on already-retired rows: still appends a version row and bumps
 * version (consistent audit trail) but does not error.
 */
export async function retireMemory(
  client: pg.PoolClient,
  opts: RetireMemoryOptions,
): Promise<{ id: string; status: 'retired' }> {
  await client.query('BEGIN');
  try {
    const updateResult = await client.query<Record<string, unknown>>(
      `
      UPDATE sales_memory
      SET
        status     = 'retired',
        version    = version + 1,
        updated_by = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING id, version, content
      `,
      [opts.author, opts.id],
    );

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new SalesMemoryNotFoundError(opts.id);
    }

    const row = updateResult.rows[0]!;

    await client.query(
      `
      INSERT INTO sales_memory_version (memory_id, version, content, change_kind, author)
      VALUES ($1, $2, $3, 'retire', $4)
      `,
      [opts.id, row.version, row.content, opts.author],
    );

    await client.query('COMMIT');
    return { id: opts.id, status: 'retired' };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listActive
// ---------------------------------------------------------------------------

/**
 * Return all active memories, ordered by created_at DESC (newest first),
 * then by id for deterministic tiebreak.
 *
 * This is the single indexed query a later loading task will call.
 * The index `sales_memory_status_created_at_idx` (migration 020) covers it.
 */
export async function listActiveMemories(
  client: pg.PoolClient,
): Promise<SalesMemoryPublic[]> {
  const result = await client.query<Record<string, unknown>>(
    `
    SELECT id, content, updated_by, updated_at
    FROM sales_memory
    WHERE status = 'active'
    ORDER BY created_at DESC, id
    `,
  );
  return result.rows.map(rowToPublic);
}

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------

/**
 * Return the full version history for a memory entry, ordered by version ASC
 * (chronological — first entry is the 'create' row).
 *
 * Throws SalesMemoryNotFoundError if the memory_id has no rows in the version
 * table (which implies the memory itself doesn't exist, since createMemory
 * always inserts both atomically).
 */
export async function getMemoryHistory(
  client: pg.PoolClient,
  id: string,
): Promise<SalesMemoryVersionPublic[]> {
  const result = await client.query<Record<string, unknown>>(
    `
    SELECT id, memory_id, version, content, change_kind, author, created_at
    FROM sales_memory_version
    WHERE memory_id = $1
    ORDER BY version ASC
    `,
    [id],
  );

  if (result.rowCount === 0) {
    // No version rows means the memory doesn't exist (or was improperly inserted).
    throw new SalesMemoryNotFoundError(id);
  }

  return result.rows.map(versionRowToPublic);
}
