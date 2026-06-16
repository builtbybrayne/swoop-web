// -----------------------------------------------------------------------------
// event-log-sink — the Postgres EventSink + the EVENT_SINK mode resolver.
//
// Per planning/03-exec-observability-c.md (F-c §1.2). Lives in @swoop/connector
// because the Postgres path needs `pg`; the pure stdout / cloud-logging sinks +
// severity come from @swoop/common. Both the orchestrator and connector
// processes call `resolveEventSink` once at startup and register the result via
// `setEventSink`.
// -----------------------------------------------------------------------------

import type pg from 'pg';
import {
  cloudLoggingSink,
  severityForEvent,
  stdoutSink,
  type Event,
  type EventSink,
} from '@swoop/common';

export type EventSinkMode = 'stdout' | 'postgres' | 'cloud-logging';

const INSERT_SQL = `INSERT INTO event_log
  (event_type, severity, session_id, turn_index, actor, event, ts)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

/**
 * A fire-and-forget EventSink that appends each event to `event_log`
 * (migration 020, single store per C.18). Never throws and never blocks the
 * turn — observability must not take down the code it observes (same posture
 * as `emitEvent`). Per-event insert is fine at Puma volume; batching is a
 * documented future optimisation (plan §4), not v1.
 */
export function createPostgresEventSink(pool: pg.Pool): EventSink {
  return (event: Event): void => {
    try {
      void pool
        .query(INSERT_SQL, [
          event.eventType,
          severityForEvent(event),
          event.sessionId,
          event.turnIndex,
          event.actor,
          JSON.stringify(event),
          event.timestamp,
        ])
        .catch(() => {
          // Best-effort: a dropped observability row must never surface to a
          // visitor turn or crash the process.
        });
    } catch {
      // pool.query threw synchronously (pool ended, etc.) — swallow.
    }
  };
}

/**
 * Choose the production sink from the EVENT_SINK config. Called once per process
 * at startup; the result is registered via `setEventSink`. `postgres` without a
 * pool degrades to stdout with a one-time warning rather than crashing.
 */
export function resolveEventSink(opts: {
  mode: EventSinkMode;
  pool?: pg.Pool;
}): EventSink {
  switch (opts.mode) {
    case 'postgres':
      if (opts.pool) return createPostgresEventSink(opts.pool);
      // Startup diagnostic, not an event.
      console.warn(
        '[event-sink] EVENT_SINK=postgres but no pool was provided — falling back to stdout.',
      );
      return stdoutSink;
    case 'cloud-logging':
      return cloudLoggingSink;
    case 'stdout':
    default:
      return stdoutSink;
  }
}
