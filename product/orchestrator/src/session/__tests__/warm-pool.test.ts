/**
 * Vitest coverage for the warm session pool (B.t10).
 *
 * Scope (ten unit tests per the Tier 3 plan):
 *   1. DirectAllocator delegates to sessionStore.create and emits miss.
 *   2. WarmSessionPool.start() pre-warms to targetSize.
 *   3. claim() returns a pre-warmed entry and emits warm_pool.hit.
 *   4. claim() on empty pool falls through and emits warm_pool.miss.
 *   5. Claim triggers a background refill that restores target size.
 *   6. TTL recycle: stale entries are deleted and replaced on tick.
 *   7. onSessionCreated hook fires for every pre-warmed entry.
 *   8. onSessionCreated failure unwinds the session and keeps the pool alive.
 *   9. stop() clears timer + drops every pre-warmed session from the store.
 *  10. Every emitted event parses cleanly against EventSchema.
 *
 * Clock + timer are injected so tests are deterministic with zero real waits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventSchema, resetEventSink, setEventSink, type Event } from '@swoop/common';

import { InMemorySessionStore } from '../in-memory.js';
import { DirectAllocator, WarmSessionPool } from '../warm-pool.js';

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

function makeClock(startMs = Date.parse('2026-04-24T10:00:00.000Z')) {
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

/**
 * Manual timer. The pool calls `setIntervalFn(fn, ms)`; the test advances
 * time manually via `fireTick()`. Avoids `vi.useFakeTimers()` global state
 * so each test is hermetic.
 */
function makeManualTimer() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const api = {
    setInterval: ((fn: () => void, _ms: number) => {
      const h = nextHandle++;
      callbacks.set(h, fn);
      return h as unknown as ReturnType<typeof globalThis.setInterval>;
    }) as (fn: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>,
    clearInterval: ((handle: ReturnType<typeof globalThis.setInterval>) => {
      callbacks.delete(handle as unknown as number);
    }) as (handle: ReturnType<typeof globalThis.setInterval>) => void,
    async fireTick(): Promise<void> {
      for (const fn of callbacks.values()) {
        fn();
      }
      await flushAsync();
    },
  };
  return api;
}

/**
 * Flush microtasks + a few macrotask turns so fire-and-forget refills
 * complete before assertions.
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

interface Captured {
  events: Event[];
  reset(): void;
}
function captureEvents(): Captured {
  const events: Event[] = [];
  setEventSink((e) => events.push(e));
  return {
    events,
    reset: () => {
      events.splice(0, events.length);
    },
  };
}

// ---------------------------------------------------------------------------
// Test suites.
// ---------------------------------------------------------------------------

describe('DirectAllocator', () => {
  let capture: Captured;
  beforeEach(() => {
    capture = captureEvents();
  });
  afterEach(() => {
    resetEventSink();
  });

  it('delegates to sessionStore.create and emits warm_pool.miss', async () => {
    const store = new InMemorySessionStore();
    const createSpy = vi.spyOn(store, 'create');
    const allocator = new DirectAllocator(store);

    const state = await allocator.claim({ metadata: { entryUrl: 'https://swoop.example' } });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(state.sessionId).toBeTruthy();
    expect(state.metadata.entryUrl).toBe('https://swoop.example');

    const misses = capture.events.filter((e) => e.eventType === 'warm_pool.miss');
    expect(misses).toHaveLength(1);
    expect(misses[0]?.payload).toEqual({ poolSizeAtClaim: 0 });
  });
});

describe('WarmSessionPool', () => {
  let capture: Captured;
  beforeEach(() => {
    capture = captureEvents();
  });
  afterEach(() => {
    resetEventSink();
  });

  it('start() pre-warms the queue to targetSize', async () => {
    const store = new InMemorySessionStore();
    const createSpy = vi.spyOn(store, 'create');
    const clock = makeClock();
    const timer = makeManualTimer();

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 3,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await pool.start();

    expect(pool.size()).toBe(3);
    expect(createSpy).toHaveBeenCalledTimes(3);
    await pool.stop();
  });

  it('claim() returns a pre-warmed entry and emits warm_pool.hit', async () => {
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 2,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await pool.start();
    const beforeClaim = pool.size();
    capture.reset();
    const createSpy = vi.spyOn(store, 'create');

    const claimed = await pool.claim();
    expect(claimed.sessionId).toBeTruthy();
    expect(createSpy).not.toHaveBeenCalled();

    const hits = capture.events.filter((e) => e.eventType === 'warm_pool.hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.payload).toEqual({ poolSizeAtClaim: beforeClaim, waitTimeMs: 0 });

    await pool.stop();
  });

  it('claim() on empty pool falls through to sessionStore.create and emits warm_pool.miss', async () => {
    // targetSize must be > 0 but we exhaust the pool before asserting the miss.
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 1,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await pool.start();
    // Drain the single warm entry, and block refill by stopping the pool.
    await pool.claim();
    await pool.stop();
    capture.reset();

    // Now create a fresh pool that starts with size 0 (no await start initial fill).
    // Simpler: use a pool where we patch buildOne to fail so refill cannot top up.
    const store2 = new InMemorySessionStore();
    // Make `create` queue an always-failing build path: we emulate by using
    // a pool with targetSize=1 but immediately calling claim before refill
    // has a chance to run (start() awaits the initial fill, so we bypass
    // start() and call claim directly — claim on an empty queue is the miss).
    const pool2 = new WarmSessionPool({
      sessionStore: store2,
      targetSize: 1,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    expect(pool2.size()).toBe(0);

    const claimed = await pool2.claim({ metadata: { entryUrl: 'https://x' } });
    expect(claimed.sessionId).toBeTruthy();
    expect(claimed.metadata.entryUrl).toBe('https://x');

    const misses = capture.events.filter((e) => e.eventType === 'warm_pool.miss');
    expect(misses.length).toBeGreaterThanOrEqual(1);
    expect(misses[misses.length - 1]?.payload).toEqual({ poolSizeAtClaim: 0 });

    await pool2.stop();
  });

  it('claim() triggers a background refill that restores size to target', async () => {
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 2,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await pool.start();
    expect(pool.size()).toBe(2);

    await pool.claim();
    // After claim, size drops and a background refill is in-flight.
    await flushAsync();
    expect(pool.size()).toBe(2);

    await pool.stop();
  });

  it('TTL recycle: stale entries are deleted and replaced on tick', async () => {
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 2,
      ttlMs: 1_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await pool.start();
    // Snapshot the pre-warmed ids so we can assert they are gone after recycle.
    const initialIds = Array.from({ length: 2 }).map(
      (_, i) => (pool as unknown as { queue: Array<{ sessionId: string }> }).queue[i]!.sessionId,
    );

    clock.advance(2_000);
    await timer.fireTick();
    await flushAsync();

    for (const id of initialIds) {
      expect(pool.hasEntry(id)).toBe(false);
      // Underlying store record is dropped too.
      expect(await store.get(id)).toBeNull();
    }
    // Size remains at target via refill after recycle.
    expect(pool.size()).toBe(2);

    await pool.stop();
  });

  it('onSessionCreated hook fires for every pre-warmed entry', async () => {
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();
    const seeded: string[] = [];

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 3,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
      onSessionCreated: async (id) => {
        seeded.push(id);
      },
    });
    await pool.start();

    expect(seeded).toHaveLength(3);
    // Each id should correspond to a real record in the store.
    for (const id of seeded) {
      expect(await store.get(id)).not.toBeNull();
    }
    await pool.stop();
  });

  it('onSessionCreated failure unwinds the store record and keeps the pool alive', async () => {
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();
    let failureCount = 0;

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 1,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
      onSessionCreated: async () => {
        failureCount += 1;
        throw new Error('downstream provisioning blew up');
      },
    });

    // start() should not throw even though buildOne fails every attempt.
    await pool.start();

    expect(failureCount).toBeGreaterThanOrEqual(1);
    // Pool is empty because every build failed.
    expect(pool.size()).toBe(0);
    // Any session that was briefly created must have been deleted by the unwind path.
    // We assert by counting records in the underlying in-memory store via sweep(),
    // which reports size() via the adapter's internal map.
    const mapSize = (store as unknown as { sessions: Map<string, unknown> }).sessions.size;
    expect(mapSize).toBe(0);

    await pool.stop();
  });

  it('stop() clears the timer and drops every pre-warmed session from the store', async () => {
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 3,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await pool.start();
    const idsBeforeStop = (
      pool as unknown as { queue: Array<{ sessionId: string }> }
    ).queue.map((e) => e.sessionId);
    expect(idsBeforeStop).toHaveLength(3);

    await pool.stop();

    expect(pool.size()).toBe(0);
    for (const id of idsBeforeStop) {
      expect(await store.get(id)).toBeNull();
    }
    // Firing the timer after stop() is a no-op: the handle is cleared.
    await timer.fireTick();
    expect(pool.size()).toBe(0);
  });

  it('every emitted event parses cleanly against EventSchema', async () => {
    const store = new InMemorySessionStore();
    const clock = makeClock();
    const timer = makeManualTimer();

    const pool = new WarmSessionPool({
      sessionStore: store,
      targetSize: 2,
      ttlMs: 60_000,
      now: clock.fn,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await pool.start();
    await pool.claim();
    await flushAsync();
    await pool.claim();
    await flushAsync();
    // Drain to force at least one miss.
    await pool.stop();
    const directFallback = new DirectAllocator(new InMemorySessionStore());
    await directFallback.claim();

    expect(capture.events.length).toBeGreaterThan(0);
    for (const e of capture.events) {
      const result = EventSchema.safeParse(e);
      expect(result.success).toBe(true);
    }
    // At least one hit and one miss should have landed across the flow.
    expect(capture.events.some((e) => e.eventType === 'warm_pool.hit')).toBe(true);
    expect(capture.events.some((e) => e.eventType === 'warm_pool.miss')).toBe(true);
  });
});
