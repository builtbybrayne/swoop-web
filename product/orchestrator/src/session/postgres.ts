/**
 * Postgres-backed `SessionStore` — B.t13.
 *
 * Stores Puma `SessionState` in `puma_session.state` (JSONB) so sessions
 * survive orchestrator restart. Migration 016_puma_session.sql owns the
 * schema; this module owns a dedicated pg pool (separate from the connector's
 * pool — same DB, separate connection pool per the plan's "separate service,
 * separate pool" rule).
 *
 * TTL lifecycle mirrors `InMemorySessionStore`:
 *   - `last_active_at` is refreshed on every `update`.
 *   - `archived_at` NULL = active; non-NULL = archived.
 *   - Sweep: `sweepPostgresSessions(deps)` archives idle-past-TTL then
 *     deletes archived-past-retention. Called from `startPostgresSessionSweep`.
 *
 * `statement_timeout` is set via libpq startup options (not `on('connect')`).
 * See gotchas.md "pg.Pool on('connect') queries warn…".
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { defaultEmptySeenItems, emitEvent } from '@swoop/common';
import type { SessionState } from '@swoop/common';
import type { SessionStore } from './interface.js';

export interface PostgresSessionStoreOptions {
  /** Full postgres connection URL. Falls back to `ORCHESTRATOR_DATABASE_URL` then `DATABASE_URL`. */
  connectionString: string;
  /** Max pool connections. Default 5 (orchestrator is lighter than the connector). */
  maxConnections?: number;
  /** Idle eviction window (ms). Default 30s. */
  idleTimeoutMs?: number;
  /** statement_timeout per connection (ms). Default 5000. */
  statementTimeoutMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

const DEFAULT_MAX = 5;
const DEFAULT_IDLE_MS = 30_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;

/** Build a default `SessionState` shell, identical to the in-memory adapter. */
function buildDefaultState(
  initial: Partial<SessionState> | undefined,
  nowIso: string,
  generatedId: string,
): SessionState {
  const ungranted = { granted: false as const, timestamp: nowIso };
  return {
    sessionId: initial?.sessionId ?? generatedId,
    createdAt: initial?.createdAt ?? nowIso,
    updatedAt: initial?.updatedAt ?? nowIso,
    conversationHistory: initial?.conversationHistory ?? [],
    triage: initial?.triage ?? { verdict: 'none' },
    wishlist: initial?.wishlist ?? { items: [] },
    consent: initial?.consent ?? {
      conversation: ungranted,
      handoff: ungranted,
    },
    metadata: initial?.metadata ?? {},
    seenItems: initial?.seenItems ?? defaultEmptySeenItems(),
    // staff-auth — visitor defaults. A staff session sets staff:true.
    staff: initial?.staff ?? false,
    mode: initial?.mode ?? 'conversation',
  };
}

export class PostgresSessionStore implements SessionStore {
  private readonly pool: pg.Pool;
  private readonly nowMs: () => number;

  constructor(opts: PostgresSessionStoreOptions) {
    this.nowMs = opts.now ?? (() => Date.now());
    const statementTimeoutMs = opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      max: opts.maxConnections ?? DEFAULT_MAX,
      idleTimeoutMillis: opts.idleTimeoutMs ?? DEFAULT_IDLE_MS,
      application_name: 'swoop-orchestrator',
      // libpq startup option avoids the on('connect') race — see gotchas.md.
      options: `-c statement_timeout=${statementTimeoutMs}`,
    });

    // Surface unexpected idle-client errors without crashing the process.
    this.pool.on('error', (err) => {
      console.error(`[orchestrator] postgres session pool error: ${String(err)}`);
    });
  }

  async create(initial?: Partial<SessionState>): Promise<SessionState> {
    const nowIso = new Date(this.nowMs()).toISOString();
    const state = buildDefaultState(initial, nowIso, randomUUID());

    await this.pool.query(
      `INSERT INTO puma_session (id, state, created_at, last_active_at, archived_at)
       VALUES ($1, $2::jsonb, $3, $3, NULL)`,
      [state.sessionId, JSON.stringify(state), nowIso],
    );

    return state;
  }

  async get(id: string): Promise<SessionState | null> {
    const result = await this.pool.query<{ state: SessionState }>(
      `SELECT state FROM puma_session WHERE id = $1`,
      [id],
    );
    if (result.rowCount === 0) return null;
    return result.rows[0].state as SessionState;
  }

  async update(
    id: string,
    mutate: (s: SessionState) => SessionState,
  ): Promise<SessionState> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ state: SessionState }>(
        `SELECT state FROM puma_session WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error(`session not found: ${id}`);
      }
      const current = result.rows[0].state as SessionState;
      const next = mutate(current);
      const nowIso = new Date(this.nowMs()).toISOString();
      const finalState: SessionState = { ...next, updatedAt: nowIso };
      await client.query(
        `UPDATE puma_session SET state = $2::jsonb, last_active_at = $3 WHERE id = $1`,
        [id, JSON.stringify(finalState), nowIso],
      );
      await client.query('COMMIT');
      return finalState;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM puma_session WHERE id = $1`, [id]);
  }

  async archive(id: string): Promise<void> {
    const nowIso = new Date(this.nowMs()).toISOString();
    await this.pool.query(
      `UPDATE puma_session SET archived_at = $2 WHERE id = $1 AND archived_at IS NULL`,
      [id, nowIso],
    );
  }

  /** Close the pool. Call on process shutdown. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------------------
// TTL sweeper — mirrors InMemorySessionStore.sweep() semantics.
// ---------------------------------------------------------------------------

export interface PostgresSessionSweepDeps {
  pool: pg.Pool;
  idleTtlMs: number;
  archiveTtlMs: number;
  now?: () => number;
}

export interface SweepResult {
  archived: number;
  deleted: number;
}

/**
 * Run one sweep pass:
 *   1. Archive active sessions idle past `idleTtlMs`.
 *   2. Delete archived sessions past `archiveTtlMs`.
 * Returns counts for observability. Callable as a one-shot function or from
 * the in-process interval wired in `startPostgresSessionSweep`.
 */
export async function sweepPostgresSessions(
  deps: PostgresSessionSweepDeps,
): Promise<SweepResult> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const idleCutoff = new Date(nowMs - deps.idleTtlMs).toISOString();
  const archiveCutoff = new Date(nowMs - deps.archiveTtlMs).toISOString();

  // Step 1: archive idle sessions.
  const archiveResult = await deps.pool.query<{ id: string }>(
    `UPDATE puma_session
     SET archived_at = $1
     WHERE archived_at IS NULL AND last_active_at < $2
     RETURNING id`,
    [nowIso, idleCutoff],
  );
  const archivedIds = archiveResult.rows.map((r) => r.id);
  for (const sessionId of archivedIds) {
    emitEvent({
      eventType: 'session.expired',
      eventVersion: 1,
      timestamp: nowIso,
      sessionId,
      turnIndex: null,
      actor: 'system',
      payload: { cause: 'idle_timeout' },
    });
  }

  // Step 2: delete archived sessions past retention window.
  const deleteResult = await deps.pool.query<{ id: string }>(
    `DELETE FROM puma_session
     WHERE archived_at IS NOT NULL AND archived_at < $1
     RETURNING id`,
    [archiveCutoff],
  );
  const deletedIds = deleteResult.rows.map((r) => r.id);
  for (const sessionId of deletedIds) {
    emitEvent({
      eventType: 'session.expired',
      eventVersion: 1,
      timestamp: nowIso,
      sessionId,
      turnIndex: null,
      actor: 'system',
      payload: { cause: 'archive_to_delete' },
    });
  }

  return { archived: archivedIds.length, deleted: deletedIds.length };
}

export interface StartPostgresSessionSweepDeps {
  store: PostgresSessionStore;
  pool: pg.Pool;
  idleTtlMs: number;
  archiveTtlMs: number;
  /** Sweep interval (ms). Default 5 minutes. */
  intervalMs?: number;
  /** Initial delay before first sweep (ms). Default 60s. */
  initialDelayMs?: number;
}

/**
 * Wire the postgres session sweeper as an in-process interval.
 * Returns a stop function to call on shutdown.
 */
export function startPostgresSessionSweep(deps: StartPostgresSessionSweepDeps): () => void {
  const intervalMs = deps.intervalMs ?? 5 * 60 * 1000;
  const initialDelayMs = deps.initialDelayMs ?? 60_000;

  const sweepDeps: PostgresSessionSweepDeps = {
    pool: deps.pool,
    idleTtlMs: deps.idleTtlMs,
    archiveTtlMs: deps.archiveTtlMs,
  };

  const runSweep = (): void => {
    void sweepPostgresSessions(sweepDeps).catch((err) => {
      console.error(`[orchestrator] postgres session sweep failed: ${String(err)}`);
    });
  };

  const initialTimer = setTimeout(runSweep, initialDelayMs);
  initialTimer.unref?.();
  const interval = setInterval(runSweep, intervalMs);
  interval.unref?.();

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
