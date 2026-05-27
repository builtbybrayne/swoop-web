/**
 * MutexSessionStore — R2 (2026-04-30 review).
 *
 * Verifies the per-session async mutex serialises read-modify-write `update`
 * calls so concurrent appends don't drop entries. The "lost update" failure
 * mode is reproduced first against an *un*mutexed async store so the
 * assertions are calibrated; then the same workload is run through the
 * MutexSessionStore wrapper and asserted lossless.
 */

import { describe, expect, it } from 'vitest';
import { defaultEmptySeenItems } from '@swoop/common';
import type { SessionState } from '@swoop/common';
import type { SessionStore } from '../interface.js';
import { MutexSessionStore } from '../mutex-store.js';

/**
 * A SessionStore whose `update` deliberately introduces an `await` between
 * read and write — modelling a Postgres / Firestore round-trip. Without
 * external serialisation this leaks the lost-update window the R2 fix
 * targets.
 */
class AsyncRaceStore implements SessionStore {
  private readonly states = new Map<string, SessionState>();

  async create(initial?: Partial<SessionState>): Promise<SessionState> {
    const id = initial?.sessionId ?? `s_${this.states.size + 1}`;
    const nowIso = new Date().toISOString();
    const state: SessionState = {
      sessionId: id,
      createdAt: nowIso,
      updatedAt: nowIso,
      conversationHistory: [],
      triage: { verdict: 'none' },
      wishlist: { items: [] },
      consent: {
        conversation: { granted: false, timestamp: nowIso },
        handoff: { granted: false, timestamp: nowIso },
      },
      metadata: {},
      seenItems: defaultEmptySeenItems(),
      ...initial,
    };
    this.states.set(id, state);
    return state;
  }

  async get(id: string): Promise<SessionState | null> {
    return this.states.get(id) ?? null;
  }

  async update(
    id: string,
    mutate: (s: SessionState) => SessionState,
  ): Promise<SessionState> {
    const current = this.states.get(id);
    if (!current) throw new Error(`session not found: ${id}`);
    // Force a microtask gap between read and write — this is the window
    // where two unawaited concurrent updates collide on an async backend.
    const next = mutate(current);
    await Promise.resolve();
    this.states.set(id, next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.states.delete(id);
  }

  async archive(_id: string): Promise<void> {
    // no-op for the test
  }
}

function appender(text: string) {
  return (s: SessionState): SessionState => ({
    ...s,
    conversationHistory: [
      ...s.conversationHistory,
      {
        turnIndex: s.conversationHistory.length,
        role: 'agent',
        blockType: 'utter',
        text,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

describe('AsyncRaceStore (control)', () => {
  it('drops entries when concurrent updates race', async () => {
    const inner = new AsyncRaceStore();
    const session = await inner.create();
    // Fire 10 unawaited updates concurrently.
    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i++) {
      promises.push(inner.update(session.sessionId, appender(`m${i}`)));
    }
    await Promise.all(promises);
    const final = await inner.get(session.sessionId);
    // Without serialisation the final length is < 10 — that's the R2 bug.
    expect(final?.conversationHistory.length ?? 0).toBeLessThan(10);
  });
});

describe('MutexSessionStore', () => {
  it('serialises concurrent updates so no entries are dropped', async () => {
    const inner = new AsyncRaceStore();
    const store = new MutexSessionStore(inner);
    const session = await store.create();

    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i++) {
      promises.push(store.update(session.sessionId, appender(`m${i}`)));
    }
    await Promise.all(promises);

    const final = await store.get(session.sessionId);
    expect(final?.conversationHistory).toHaveLength(10);
    // Order is preserved — entries land in enqueue order.
    expect(final?.conversationHistory.map((e) => e.text)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
    ]);
  });

  it('keeps distinct sessions parallel (no cross-session blocking)', async () => {
    const inner = new AsyncRaceStore();
    const store = new MutexSessionStore(inner);
    const a = await store.create({ sessionId: 'a' });
    const b = await store.create({ sessionId: 'b' });

    await Promise.all([
      store.update(a.sessionId, appender('a1')),
      store.update(b.sessionId, appender('b1')),
      store.update(a.sessionId, appender('a2')),
      store.update(b.sessionId, appender('b2')),
    ]);

    const finalA = await store.get(a.sessionId);
    const finalB = await store.get(b.sessionId);
    expect(finalA?.conversationHistory.map((e) => e.text)).toEqual(['a1', 'a2']);
    expect(finalB?.conversationHistory.map((e) => e.text)).toEqual(['b1', 'b2']);
  });

  it('does not poison the chain when one update throws', async () => {
    const inner = new AsyncRaceStore();
    const store = new MutexSessionStore(inner);
    const session = await store.create();

    const failing = store.update(session.sessionId, () => {
      throw new Error('boom');
    });
    const ok1 = store.update(session.sessionId, appender('x1'));
    const ok2 = store.update(session.sessionId, appender('x2'));

    await expect(failing).rejects.toThrow('boom');
    await ok1;
    await ok2;

    const final = await store.get(session.sessionId);
    expect(final?.conversationHistory.map((e) => e.text)).toEqual(['x1', 'x2']);
  });

  it('passes through reads, deletes, and creates without serialisation', async () => {
    const inner = new AsyncRaceStore();
    const store = new MutexSessionStore(inner);

    const created = await store.create({ sessionId: 'pass' });
    expect(created.sessionId).toBe('pass');

    const read = await store.get('pass');
    expect(read?.sessionId).toBe('pass');

    await store.delete('pass');
    expect(await store.get('pass')).toBeNull();
  });
});
