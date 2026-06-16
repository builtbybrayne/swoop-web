// -----------------------------------------------------------------------------
// event-log-sink — the Postgres EventSink + the mode resolver.
// Per planning/03-exec-observability-c.md (F-c §1.2). Mocks pg so the suite
// runs without a live puma_dev; SQL semantics are verified by the live smoke.
// -----------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { severityForEvent, type Event } from '@swoop/common';

import { createPostgresEventSink, resolveEventSink } from '../event-log-sink.js';

const sampleEvent: Event = {
  eventType: 'tool.invoked',
  eventVersion: 1,
  timestamp: '2026-06-16T00:00:00.000Z',
  sessionId: 'sess_x',
  turnIndex: 2,
  actor: 'connector',
  payload: { toolName: 'lookup', elapsedMs: 7, ok: false, errorKind: 'handler_threw' },
};

function fakePool(
  queryImpl: (sql: string, params: unknown[]) => Promise<unknown>,
): pg.Pool {
  return { query: vi.fn(queryImpl) } as unknown as pg.Pool;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPostgresEventSink', () => {
  it('inserts into event_log with the denormalised hot-query columns', async () => {
    let captured: { sql: string; params: unknown[] } | undefined;
    const pool = fakePool(async (sql, params) => {
      captured = { sql, params };
      return { rows: [] };
    });

    createPostgresEventSink(pool)(sampleEvent);
    await tick();

    expect(captured).toBeDefined();
    expect(captured!.sql.toLowerCase()).toContain('insert into event_log');
    // column order: event_type, severity, session_id, turn_index, actor, event, ts
    expect(captured!.params[0]).toBe('tool.invoked');
    expect(captured!.params[1]).toBe('ERROR'); // tool.invoked{ok:false}
    expect(captured!.params[2]).toBe('sess_x');
    expect(captured!.params[3]).toBe(2);
    expect(captured!.params[4]).toBe('connector');
    expect(JSON.parse(captured!.params[5] as string)).toEqual(sampleEvent);
    expect(captured!.params[6]).toBe('2026-06-16T00:00:00.000Z');
  });

  it('never throws when the pool query rejects (fire-and-forget)', async () => {
    const pool = fakePool(async () => {
      throw new Error('db down');
    });
    expect(() => createPostgresEventSink(pool)(sampleEvent)).not.toThrow();
    await tick(); // the rejected promise is swallowed, no unhandled rejection
  });
});

describe('resolveEventSink', () => {
  it('returns the postgres sink when mode=postgres and a pool is present', () => {
    const pool = fakePool(async () => ({ rows: [] }));
    resolveEventSink({ mode: 'postgres', pool })(sampleEvent);
    expect(pool.query as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('warns once and falls back to stdout when mode=postgres without a pool', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sink = resolveEventSink({ mode: 'postgres' });
    expect(warn).toHaveBeenCalledTimes(1);
    sink(sampleEvent);
    const parsed = JSON.parse(log.mock.calls[0][0] as string);
    expect(parsed).toEqual(sampleEvent); // raw stdout shape
  });

  it('returns the cloud-logging sink when mode=cloud-logging', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolveEventSink({ mode: 'cloud-logging' })(sampleEvent);
    const parsed = JSON.parse(log.mock.calls[0][0] as string);
    expect(parsed.severity).toBe(severityForEvent(sampleEvent));
  });

  it('returns the raw stdout sink for mode=stdout', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolveEventSink({ mode: 'stdout' })(sampleEvent);
    const parsed = JSON.parse(log.mock.calls[0][0] as string);
    expect(parsed).toEqual(sampleEvent);
    expect(parsed).not.toHaveProperty('severity');
  });
});
