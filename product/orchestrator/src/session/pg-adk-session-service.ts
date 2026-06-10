/**
 * Postgres-backed ADK `BaseSessionService` — B.t13.
 *
 * Implements ADK's `BaseSessionService` interface over the same Postgres DB
 * used by `PostgresSessionStore`. This is Layer 2 of the two-layer durability
 * model: it persists the ADK event log (what `runner.sessionService` writes on
 * every turn) to `puma_session_event` so event history survives restart.
 *
 * Decision B.poincare-4: custom implementation over `puma_session_event` rather
 * than `DatabaseSessionService` (ADK's own Postgres backend). Reasons:
 *   - `DatabaseSessionService` uses MikroORM + manages its own schema; our
 *     events must live in `puma_session_event` (migration 016) not an ORM table.
 *   - ADK exports `BaseSessionService` cleanly — extending it is the intended
 *     extension point per the plan's "implement against ADK's exported interface"
 *     guardrail.
 *
 * The class uses the same pool passed in (not a new pool). The caller
 * (src/index.ts) provides the orchestrator's dedicated pg pool so the pool
 * lifecycle is owned externally.
 *
 * Session state (`adk_state` column in `puma_session`) stores ADK's `state`
 * record (app/user/session state deltas written by the model on each turn).
 * It is separate from `state` (which holds Puma's `SessionState`). Both live
 * in the same row for a single-query existence check.
 *
 * `session-history.ts` calls `sessionService.getSession()` which returns a
 * session object with `events[]` populated from `puma_session_event`. The
 * translator then iterates those events. All existing paths unchanged.
 */

import pg from 'pg';
import { BaseSessionService } from '@google/adk';
import type { Session, Event as AdkEvent } from '@google/adk';

// ADK's `Session` type — we construct via a plain object matching the shape.
// The `createSession` factory from ADK returns the right runtime shape.
// Rather than importing the private `createSession` factory (not exported),
// we build the object ourselves — the BaseSessionService contract only needs
// the duck-typed shape.
function makeSession(params: {
  id: string;
  appName: string;
  userId: string;
  state: Record<string, unknown>;
  events: AdkEvent[];
  lastUpdateTime: number;
}): Session {
  return {
    id: params.id,
    appName: params.appName,
    userId: params.userId,
    state: params.state,
    events: params.events,
    lastUpdateTime: params.lastUpdateTime,
  } as Session;
}

export interface PgAdkSessionServiceOptions {
  pool: pg.Pool;
  /** Fixed app name for this orchestrator instance. */
  appName?: string;
  /** Clock injection for tests. */
  now?: () => number;
}

const DEFAULT_APP_NAME = 'puma-orchestrator';

export class PgAdkSessionService extends BaseSessionService {
  private readonly pool: pg.Pool;
  private readonly appName: string;
  private readonly nowMs: () => number;

  constructor(opts: PgAdkSessionServiceOptions) {
    super();
    this.pool = opts.pool;
    this.appName = opts.appName ?? DEFAULT_APP_NAME;
    this.nowMs = opts.now ?? (() => Date.now());
  }

  /**
   * Create an ADK session row. Upserts into `puma_session` using
   * ON CONFLICT DO NOTHING — the `PostgresSessionStore.create` call from
   * `onSessionCreated` already inserts the row. The ADK side only needs
   * `adk_state` to be initialised (empty).
   */
  async createSession(request: {
    appName: string;
    userId: string;
    sessionId?: string;
    state?: Record<string, unknown>;
  }): Promise<Session> {
    const sessionId = request.sessionId;
    if (!sessionId) {
      throw new Error(
        'PgAdkSessionService.createSession: sessionId is required (Puma always pre-creates sessions)',
      );
    }

    const now = this.nowMs();
    const nowIso = new Date(now).toISOString();
    const initialState = request.state ?? {};

    // The puma_session row should already exist (created by PostgresSessionStore.create).
    // Update adk_state only; INSERT in case the row was somehow missing.
    await this.pool.query(
      `INSERT INTO puma_session (id, state, adk_state, created_at, last_active_at)
       VALUES ($1, '{}', $2::jsonb, $3, $3)
       ON CONFLICT (id) DO UPDATE
         SET adk_state = EXCLUDED.adk_state`,
      [sessionId, JSON.stringify(initialState), nowIso],
    );

    return makeSession({
      id: sessionId,
      appName: request.appName,
      userId: request.userId,
      state: initialState,
      events: [],
      lastUpdateTime: now,
    });
  }

  /**
   * Fetch a session with its full event log. Returns `undefined` if not found
   * (ADK's contract — `undefined`, not `null`).
   */
  async getSession(request: {
    appName: string;
    userId: string;
    sessionId: string;
    config?: { numRecentEvents?: number; afterTimestamp?: number };
  }): Promise<Session | undefined> {
    const sessionRow = await this.pool.query<{
      adk_state: Record<string, unknown>;
      last_active_at: Date;
    }>(
      `SELECT adk_state, last_active_at FROM puma_session WHERE id = $1`,
      [request.sessionId],
    );
    if (sessionRow.rowCount === 0) return undefined;

    const { adk_state, last_active_at } = sessionRow.rows[0];

    // Fetch events with optional filters.
    let eventsQuery: string;
    const eventsParams: unknown[] = [request.sessionId];

    if (request.config?.afterTimestamp !== undefined) {
      // afterTimestamp is epoch milliseconds in ADK's API.
      const afterIso = new Date(request.config.afterTimestamp).toISOString();
      eventsQuery =
        `SELECT event FROM puma_session_event WHERE session_id = $1 AND created_at > $2 ORDER BY seq ASC`;
      eventsParams.push(afterIso);
    } else {
      eventsQuery =
        `SELECT event FROM puma_session_event WHERE session_id = $1 ORDER BY seq ASC`;
    }

    if (request.config?.numRecentEvents !== undefined) {
      // Fetch last N events — sub-select ordered by seq DESC, then re-order ASC.
      eventsQuery =
        `SELECT event FROM (
           SELECT event, seq FROM puma_session_event WHERE session_id = $1
           ORDER BY seq DESC LIMIT $${eventsParams.length + 1}
         ) t ORDER BY seq ASC`;
      eventsParams.push(request.config.numRecentEvents);
    }

    const eventsResult = await this.pool.query<{ event: AdkEvent }>(
      eventsQuery,
      eventsParams,
    );
    const events = eventsResult.rows.map((r) => r.event as AdkEvent);

    return makeSession({
      id: request.sessionId,
      appName: request.appName,
      userId: request.userId,
      state: adk_state ?? {},
      events,
      lastUpdateTime: last_active_at.getTime(),
    });
  }

  /**
   * Append an ADK event to `puma_session_event`. Delegates state-merge to
   * `BaseSessionService.appendEvent` which handles `stateDelta` + `partial`
   * filtering and pushes to `session.events[]` in memory. We then persist.
   */
  async appendEvent(request: { session: Session; event: AdkEvent }): Promise<AdkEvent> {
    // Let base class filter partials, trim temp state, update session.state.
    const finalEvent = await super.appendEvent(request);

    // `finalEvent` is the trimmed event (or `event` unchanged if partial — but
    // base class returns early for partials without touching session.events).
    // Only persist non-partial events.
    if (request.event.partial) {
      return finalEvent;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Determine next seq for this session.
      const seqResult = await client.query<{ next_seq: number }>(
        `SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq
         FROM puma_session_event
         WHERE session_id = $1`,
        [request.session.id],
      );
      const seq = seqResult.rows[0].next_seq;

      await client.query(
        `INSERT INTO puma_session_event (session_id, seq, event, created_at)
         VALUES ($1, $2, $3::jsonb, NOW())`,
        [request.session.id, seq, JSON.stringify(finalEvent)],
      );

      // Persist updated adk_state back to puma_session.
      await client.query(
        `UPDATE puma_session SET adk_state = $2::jsonb, last_active_at = NOW() WHERE id = $1`,
        [request.session.id, JSON.stringify(request.session.state)],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return finalEvent;
  }

  /**
   * Delete all session data (puma_session_event rows cascade on DELETE of
   * puma_session). The `PostgresSessionStore.delete` call handles the
   * puma_session row; this method is called by ADK's Runner on session
   * teardown via `runner.sessionService.deleteSession`.
   * Idempotent — no-op if session doesn't exist.
   */
  async deleteSession(request: {
    appName: string;
    userId: string;
    sessionId: string;
  }): Promise<void> {
    // Events cascade via FK. Delete the session row.
    // NOTE: PostgresSessionStore.delete does the same thing. Two deletes are
    // idempotent — second one is a no-op.
    await this.pool.query(`DELETE FROM puma_session WHERE id = $1`, [request.sessionId]);
  }

  async listSessions(request: {
    appName: string;
    userId?: string;
  }): Promise<{ sessions: Session[] }> {
    // Minimal implementation — not used by Puma's server paths today.
    const result = await this.pool.query<{
      id: string;
      last_active_at: Date;
    }>(
      `SELECT id, last_active_at FROM puma_session WHERE archived_at IS NULL ORDER BY last_active_at DESC`,
    );
    const sessions = result.rows.map((r) =>
      makeSession({
        id: r.id,
        appName: request.appName,
        userId: request.userId ?? 'anonymous',
        state: {},
        events: [],
        lastUpdateTime: r.last_active_at.getTime(),
      }),
    );
    return { sessions };
  }
}
