/**
 * Vitest coverage for the in-memory `SessionStore` (B.t2).
 *
 * Scope:
 *   1. create → get → update → delete round-trip.
 *   2. Idle sweep archives a stale session after the idle TTL.
 *   3. Archived session is deleted after the archive retention window.
 *   4. `canAcceptTurn` rejects sessions without tier-1 consent and accepts
 *      sessions that have granted it.
 *   5. `createSessionStore` factory honours the `in-memory` backend and
 *      rejects unknown backend values.
 *
 * Time is mocked via the `now` option so sweep behaviour is deterministic.
 */

import { describe, it, expect } from 'vitest';
import {
  InMemorySessionStore,
  canAcceptTurn,
  createSessionStore,
} from '../index.js';
import type { SessionState } from '@swoop/common';

/**
 * Controllable clock. Returns the current value of `t.ms`; callers mutate
 * it to jump time forward deterministically.
 */
function makeClock(startMs = Date.parse('2026-04-22T10:00:00.000Z')) {
  const t = { ms: startMs };
  return {
    get now() {
      return t.ms;
    },
    advance(deltaMs: number) {
      t.ms += deltaMs;
    },
    fn: () => t.ms,
  };
}

describe('InMemorySessionStore', () => {
  it('creates, reads, updates, and deletes a session', async () => {
    const clock = makeClock();
    const store = new InMemorySessionStore({ now: clock.fn });

    const created = await store.create({
      metadata: { regionInterestHint: 'patagonia' },
    });
    expect(created.sessionId).toBeTruthy();
    expect(created.triage.verdict).toBe('none');
    expect(created.consent.conversation.granted).toBe(false);
    expect(created.metadata.regionInterestHint).toBe('patagonia');

    const fetched = await store.get(created.sessionId);
    expect(fetched).not.toBeNull();
    expect(fetched?.sessionId).toBe(created.sessionId);

    clock.advance(1_000);
    const updated = await store.update(created.sessionId, (s) => ({
      ...s,
      triage: {
        verdict: 'qualified',
        reasonCode: 'matches_patagonia',
        reasonText: 'asked for a trekking trip in Patagonia',
        decidedAt: new Date(clock.now).toISOString(),
      },
    }));
    expect(updated.triage.verdict).toBe('qualified');
    expect(Date.parse(updated.updatedAt)).toBe(clock.now);

    await store.delete(created.sessionId);
    expect(await store.get(created.sessionId)).toBeNull();
  });

  it('update throws on a missing session', async () => {
    const store = new InMemorySessionStore();
    await expect(store.update('nope', (s) => s)).rejects.toThrow(/not found/);
  });

  it('sweep archives sessions that have been idle past the TTL', async () => {
    const clock = makeClock();
    const store = new InMemorySessionStore({
      idleTtlMs: 1_000,
      archiveTtlMs: 10_000,
      now: clock.fn,
    });

    const s = await store.create();
    // Not yet idle — nothing sweeps.
    let counts = store.sweep();
    expect(counts).toEqual({ archived: 0, deleted: 0 });

    // Advance past idle TTL. The session should archive, not delete.
    clock.advance(1_500);
    counts = store.sweep();
    expect(counts).toEqual({ archived: 1, deleted: 0 });

    // Still reachable (archival is read-only retention, not erasure).
    expect(await store.get(s.sessionId)).not.toBeNull();
  });

  it('sweep deletes archived sessions past the retention window', async () => {
    const clock = makeClock();
    const store = new InMemorySessionStore({
      idleTtlMs: 1_000,
      archiveTtlMs: 5_000,
      now: clock.fn,
    });

    const s = await store.create();
    clock.advance(1_500);
    store.sweep(); // archives
    expect(store.size()).toBe(1);

    clock.advance(6_000);
    const counts = store.sweep();
    expect(counts).toEqual({ archived: 0, deleted: 1 });
    expect(store.size()).toBe(0);
    expect(await store.get(s.sessionId)).toBeNull();
  });

  it('archive is idempotent and preserves readability', async () => {
    const clock = makeClock();
    const store = new InMemorySessionStore({ now: clock.fn });
    const s = await store.create();
    await store.archive(s.sessionId);
    await store.archive(s.sessionId); // no-op second time
    expect(await store.get(s.sessionId)).not.toBeNull();
  });

  it('delete is idempotent on a missing id', async () => {
    const store = new InMemorySessionStore();
    await expect(store.delete('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('canAcceptTurn consent gate', () => {
  function stateWithConsent(granted: boolean): SessionState {
    const ts = '2026-04-22T10:00:00.000Z';
    return {
      sessionId: 'sess-1',
      createdAt: ts,
      updatedAt: ts,
      conversationHistory: [],
      triage: { verdict: 'none' },
      wishlist: { items: [] },
      consent: {
        conversation: { granted, timestamp: ts },
        handoff: { granted: false, timestamp: ts },
      },
      metadata: {},
    };
  }

  it('rejects a session without tier-1 consent', () => {
    expect(canAcceptTurn(stateWithConsent(false))).toBe(false);
  });

  it('accepts a session with tier-1 consent granted', () => {
    expect(canAcceptTurn(stateWithConsent(true))).toBe(true);
  });
});

describe('createSessionStore factory', () => {
  it('defaults to in-memory and builds a working store', async () => {
    const store = createSessionStore();
    const s = await store.create();
    expect(s.sessionId).toBeTruthy();
    expect(await store.get(s.sessionId)).not.toBeNull();
  });

  it('rejects an unknown backend value', () => {
    expect(() => createSessionStore({ backend: 'mongo' })).toThrow(
      /unknown SESSION_BACKEND/,
    );
  });

  it('vertex-ai and firestore stubs construct cleanly but throw on use', async () => {
    const vx = createSessionStore({ backend: 'vertex-ai' });
    await expect(vx.get('x')).rejects.toThrow(/not implemented/);
    const fs = createSessionStore({ backend: 'firestore' });
    await expect(fs.get('x')).rejects.toThrow(/not implemented/);
  });
});
