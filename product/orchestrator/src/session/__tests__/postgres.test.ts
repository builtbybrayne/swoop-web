/**
 * Tests for PostgresSessionStore — B.t13.
 *
 * DB-gated: these tests skip unless ORCHESTRATOR_DATABASE_URL (or DATABASE_URL)
 * is set to a Postgres URL with migration 016 applied.
 *
 * To run locally:
 *   ORCHESTRATOR_DATABASE_URL=postgresql://al:pick-a-password@localhost:5432/puma_bt13_test \
 *     npm test -w @swoop/orchestrator
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { PostgresSessionStore, sweepPostgresSessions } from '../postgres.js';

const DB_URL =
  process.env['ORCHESTRATOR_DATABASE_URL'] ??
  process.env['DATABASE_URL'];

const skipUnless = DB_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanSessions(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM puma_session WHERE id LIKE 'test-%'`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

skipUnless('PostgresSessionStore (DB-gated)', () => {
  let pool: pg.Pool;
  let store: PostgresSessionStore;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL! });
    store = new PostgresSessionStore({ connectionString: DB_URL! });
  });

  afterAll(async () => {
    await cleanSessions(pool);
    await store.close();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanSessions(pool);
  });

  // --- Basic CRUD -----------------------------------------------------------

  it('create returns a SessionState with defaults', async () => {
    const state = await store.create({ sessionId: 'test-create-1' });
    expect(state.sessionId).toBe('test-create-1');
    expect(state.consent.conversation.granted).toBe(false);
    expect(state.triage.verdict).toBe('none');
    expect(state.conversationHistory).toEqual([]);
  });

  it('get returns null for unknown id', async () => {
    const result = await store.get('test-nonexistent');
    expect(result).toBeNull();
  });

  it('get returns created session', async () => {
    await store.create({ sessionId: 'test-get-1' });
    const result = await store.get('test-get-1');
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('test-get-1');
  });

  it('update mutates and persists', async () => {
    await store.create({ sessionId: 'test-update-1' });
    const updated = await store.update('test-update-1', (s) => ({
      ...s,
      consent: {
        ...s.consent,
        conversation: { granted: true, timestamp: new Date().toISOString() },
      },
    }));
    expect(updated.consent.conversation.granted).toBe(true);

    // Verify persisted.
    const fetched = await store.get('test-update-1');
    expect(fetched!.consent.conversation.granted).toBe(true);
  });

  it('update throws for unknown session', async () => {
    await expect(store.update('test-ghost', (s) => s)).rejects.toThrow('session not found');
  });

  it('delete removes the session', async () => {
    await store.create({ sessionId: 'test-delete-1' });
    await store.delete('test-delete-1');
    expect(await store.get('test-delete-1')).toBeNull();
  });

  it('delete is idempotent', async () => {
    await store.create({ sessionId: 'test-delete-2' });
    await store.delete('test-delete-2');
    await expect(store.delete('test-delete-2')).resolves.toBeUndefined();
  });

  it('archive sets archived_at', async () => {
    await store.create({ sessionId: 'test-archive-1' });
    await store.archive('test-archive-1');
    const row = await pool.query(
      `SELECT archived_at FROM puma_session WHERE id = 'test-archive-1'`,
    );
    expect(row.rows[0].archived_at).not.toBeNull();
  });

  it('archive is idempotent', async () => {
    await store.create({ sessionId: 'test-archive-2' });
    await store.archive('test-archive-2');
    await expect(store.archive('test-archive-2')).resolves.toBeUndefined();
  });

  // --- Restart-survival (B.t13 core requirement, Step-7a) ------------------

  it('session survives a new store instance (restart-survival)', async () => {
    // Instance A creates a session and grants consent.
    const storeA = new PostgresSessionStore({ connectionString: DB_URL! });
    await storeA.create({ sessionId: 'test-restart-1' });
    await storeA.update('test-restart-1', (s) => ({
      ...s,
      consent: {
        ...s.consent,
        conversation: { granted: true, timestamp: new Date().toISOString() },
      },
    }));
    await storeA.close();

    // Instance B (fresh pool, simulates restart) reads it.
    const storeB = new PostgresSessionStore({ connectionString: DB_URL! });
    const state = await storeB.get('test-restart-1');
    expect(state).not.toBeNull();
    expect(state!.consent.conversation.granted).toBe(true);
    await storeB.close();
  });

  // --- MutexSessionStore wraps correctly -----------------------------------

  it('canAcceptTurn returns false before consent', async () => {
    const { canAcceptTurn } = await import('../interface.js');
    const state = await store.create({ sessionId: 'test-consent-gate-1' });
    expect(canAcceptTurn(state)).toBe(false);
  });

  it('canAcceptTurn returns true after consent update', async () => {
    const { canAcceptTurn } = await import('../interface.js');
    await store.create({ sessionId: 'test-consent-gate-2' });
    const updated = await store.update('test-consent-gate-2', (s) => ({
      ...s,
      consent: {
        ...s.consent,
        conversation: { granted: true, timestamp: new Date().toISOString() },
      },
    }));
    expect(canAcceptTurn(updated)).toBe(true);
  });

  // --- Sweep ---------------------------------------------------------------

  it('sweep archives idle sessions and deletes archived-past-retention', async () => {
    const now = Date.now();
    const idleTtlMs = 1_000; // 1 second
    const archiveTtlMs = 500; // 0.5 seconds

    // Insert active session with old last_active_at.
    const pastActive = new Date(now - 2_000).toISOString(); // 2s ago — idle
    await pool.query(
      `INSERT INTO puma_session (id, state, adk_state, created_at, last_active_at)
       VALUES ('test-sweep-1', '{}', '{}', $1, $1)`,
      [pastActive],
    );

    // Insert already-archived session with old archived_at.
    const pastArchived = new Date(now - 1_000).toISOString(); // 1s ago — past retention
    await pool.query(
      `INSERT INTO puma_session (id, state, adk_state, created_at, last_active_at, archived_at)
       VALUES ('test-sweep-2', '{}', '{}', $1, $1, $2)`,
      [pastArchived, pastArchived],
    );

    // Insert fresh session — should survive both sweeps.
    await store.create({ sessionId: 'test-sweep-3' });

    const result = await sweepPostgresSessions({ pool, idleTtlMs, archiveTtlMs });
    expect(result.archived).toBeGreaterThanOrEqual(1);
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    // test-sweep-3 should still exist.
    expect(await store.get('test-sweep-3')).not.toBeNull();

    // test-sweep-2 should be gone (deleted).
    const row = await pool.query(`SELECT id FROM puma_session WHERE id = 'test-sweep-2'`);
    expect(row.rowCount).toBe(0);
  });

  // --- History projection round-trip (Step-6) ------------------------------

  it('session stored via update contains conversation history', async () => {
    await store.create({ sessionId: 'test-history-1' });
    await store.update('test-history-1', (s) => ({
      ...s,
      conversationHistory: [
        {
          turnIndex: 0,
          role: 'user',
          blockType: 'user_message',
          text: 'hello',
          timestamp: new Date().toISOString(),
        },
      ],
    }));
    const fetched = await store.get('test-history-1');
    expect(fetched!.conversationHistory).toHaveLength(1);
    expect(fetched!.conversationHistory[0].text).toBe('hello');
  });
});
