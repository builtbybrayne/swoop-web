/**
 * Tests for PgAdkSessionService — B.t13.
 *
 * DB-gated: skip unless ORCHESTRATOR_DATABASE_URL (or DATABASE_URL) is set.
 *
 * To run locally:
 *   ORCHESTRATOR_DATABASE_URL=postgresql://al:pick-a-password@localhost:5432/puma_bt13_test \
 *     npm test -w @swoop/orchestrator
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { PgAdkSessionService } from '../pg-adk-session-service.js';
import type { Event as AdkEvent } from '@google/adk';

const DB_URL =
  process.env['ORCHESTRATOR_DATABASE_URL'] ??
  process.env['DATABASE_URL'];

const skipUnless = DB_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanSessions(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM puma_session WHERE id LIKE 'adk-test-%'`);
}

function makeEvent(overrides: Partial<AdkEvent> = {}): AdkEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    invocationId: 'inv-1',
    author: 'agent',
    timestamp: Date.now(),
    content: { role: 'model', parts: [{ text: 'hello' }] },
    partial: false,
    ...overrides,
  } as AdkEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

skipUnless('PgAdkSessionService (DB-gated)', () => {
  let pool: pg.Pool;
  let svc: PgAdkSessionService;
  const APP_NAME = 'puma-orchestrator';
  const USER_ID = 'anonymous';

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL! });
    svc = new PgAdkSessionService({ pool, appName: APP_NAME });
  });

  afterAll(async () => {
    await cleanSessions(pool);
    await pool.end();
  });

  beforeEach(async () => {
    await cleanSessions(pool);
  });

  // Seed a puma_session row so createSession's upsert works cleanly.
  async function seedSession(id: string): Promise<void> {
    await pool.query(
      `INSERT INTO puma_session (id, state, adk_state, created_at, last_active_at)
       VALUES ($1, '{}', '{}', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id],
    );
  }

  it('createSession returns a session with the supplied id', async () => {
    await seedSession('adk-test-create-1');
    const session = await svc.createSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-create-1',
      state: {},
    });
    expect(session.id).toBe('adk-test-create-1');
    expect(session.events).toEqual([]);
  });

  it('getSession returns undefined for unknown id', async () => {
    const result = await svc.getSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-missing',
    });
    expect(result).toBeUndefined();
  });

  it('appendEvent stores the event and getSession returns it', async () => {
    await seedSession('adk-test-append-1');
    const session = await svc.createSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-append-1',
    });

    const evt = makeEvent({ id: 'evt-adk-1' });
    await svc.appendEvent({ session, event: evt });

    const fetched = await svc.getSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-append-1',
    });
    expect(fetched!.events).toHaveLength(1);
    expect(fetched!.events[0].id).toBe('evt-adk-1');
  });

  it('partial events are NOT persisted', async () => {
    await seedSession('adk-test-partial-1');
    const session = await svc.createSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-partial-1',
    });

    const partialEvt = makeEvent({ partial: true });
    await svc.appendEvent({ session, event: partialEvt });

    const fetched = await svc.getSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-partial-1',
    });
    // Partial events must not be persisted.
    expect(fetched!.events).toHaveLength(0);
  });

  it('multiple events are stored in order', async () => {
    await seedSession('adk-test-order-1');
    const session = await svc.createSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-order-1',
    });

    const evt1 = makeEvent({ id: 'evt-order-1' });
    const evt2 = makeEvent({ id: 'evt-order-2' });
    const evt3 = makeEvent({ id: 'evt-order-3' });

    await svc.appendEvent({ session, event: evt1 });
    await svc.appendEvent({ session, event: evt2 });
    await svc.appendEvent({ session, event: evt3 });

    const fetched = await svc.getSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-order-1',
    });
    expect(fetched!.events.map((e) => e.id)).toEqual(['evt-order-1', 'evt-order-2', 'evt-order-3']);
  });

  // --- Restart-survival (B.t13 Step-7a, ADK layer) -------------------------

  it('events survive a new service instance (restart-survival)', async () => {
    await seedSession('adk-test-restart-1');

    // Instance A appends events.
    const svcA = new PgAdkSessionService({ pool, appName: APP_NAME });
    const sessionA = await svcA.createSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-restart-1',
    });
    await svcA.appendEvent({ session: sessionA, event: makeEvent({ id: 'evt-restart-1' }) });
    await svcA.appendEvent({ session: sessionA, event: makeEvent({ id: 'evt-restart-2' }) });

    // Instance B (fresh, simulates restart) reads events.
    const svcB = new PgAdkSessionService({ pool, appName: APP_NAME });
    const fetched = await svcB.getSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-restart-1',
    });
    expect(fetched!.events).toHaveLength(2);
    expect(fetched!.events[0].id).toBe('evt-restart-1');
    expect(fetched!.events[1].id).toBe('evt-restart-2');
  });

  it('deleteSession removes events (cascade)', async () => {
    await seedSession('adk-test-delete-1');
    const session = await svc.createSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: 'adk-test-delete-1',
    });
    await svc.appendEvent({ session, event: makeEvent() });

    await svc.deleteSession({ appName: APP_NAME, userId: USER_ID, sessionId: 'adk-test-delete-1' });

    // Events should be gone (cascaded).
    const evtRow = await pool.query(
      `SELECT id FROM puma_session_event WHERE session_id = 'adk-test-delete-1'`,
    );
    expect(evtRow.rowCount).toBe(0);
  });
});
