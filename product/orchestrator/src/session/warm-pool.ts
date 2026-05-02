/**
 * Warm session pool — B.t10.
 *
 * Layered on top of `SessionStore`, not a replacement for it. The pool holds a
 * queue of pre-created session ids; a claim pops the oldest entry and hands
 * the underlying `SessionState` to the caller. The session records themselves
 * still live in the store.
 *
 * Honest framing (planning/03-exec-agent-runtime-t10.md): with the Phase 1
 * in-memory `SessionStore`, `POST /session` runs sub-10ms. This task is latent
 * architectural prep for a network-backed session backend where create calls
 * carry round-trip cost; the pool fronts that cost with an eager pre-warm and
 * background refill. Ship disabled by default (`WARM_POOL_SIZE=0`) and flip
 * post-M4 when a real backend exists. `DirectAllocator` below is the
 * zero-size equivalent so the bootstrap path stays unconditional.
 *
 * Observability: every `claim()` emits one event. Hit carries
 * `poolSizeAtClaim` and `waitTimeMs` (always 0 in Puma; the schema reserves
 * the field for a future wait-for-warm strategy). Miss carries only
 * `poolSizeAtClaim`. Recycle events are not in the schema and we do not emit
 * them; refill failures emit `error.raised`.
 */

import type { SessionState } from '@swoop/common';
import { emitEvent, messageOf } from '@swoop/common';
import type { SessionStore } from './interface.js';

/**
 * Allocator contract the `POST /session` handler depends on. Either the warm
 * pool or a trivial wrapper around `sessionStore.create` implements this; the
 * handler stays ignorant of which one.
 */
export interface SessionAllocator {
  /** Hand out a fresh session. Emits `warm_pool.hit` or `warm_pool.miss`. */
  claim(initial?: Partial<SessionState>): Promise<SessionState>;
  /** Stop any background work. No-op on the direct allocator. */
  stop(): Promise<void>;
}

/**
 * Zero-pool allocator. Used when `WARM_POOL_SIZE=0` so the bootstrap path
 * always has a non-null allocator and does not branch on pool / no-pool.
 */
export class DirectAllocator implements SessionAllocator {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly onSessionCreated?: (sessionId: string) => Promise<void> | void,
  ) {}

  async claim(initial?: Partial<SessionState>): Promise<SessionState> {
    const state = await this.sessionStore.create(initial);
    if (this.onSessionCreated) {
      try {
        await this.onSessionCreated(state.sessionId);
      } catch (err) {
        // Mirror `session-bootstrap.ts`: on downstream provisioning failure,
        // unwind so the caller is not handed a half-built session id.
        await this.sessionStore.delete(state.sessionId).catch(() => {});
        throw err;
      }
    }
    emitEvent({
      eventType: 'warm_pool.miss',
      eventVersion: 1,
      timestamp: new Date().toISOString(),
      sessionId: state.sessionId,
      turnIndex: null,
      actor: 'system',
      payload: { poolSizeAtClaim: 0 },
    });
    return state;
  }

  async stop(): Promise<void> {
    // Nothing to clean up.
  }
}

/**
 * One pre-warmed entry. Only the id lives here; the full `SessionState` lives
 * in the store. `createdAtMs` drives TTL recycling.
 */
interface WarmEntry {
  readonly sessionId: string;
  readonly createdAtMs: number;
}

export interface WarmSessionPoolOptions {
  readonly sessionStore: SessionStore;
  /** Target pool size at steady state. Zero short-circuits this class entirely; use `DirectAllocator` instead. */
  readonly targetSize: number;
  /** How long a warm entry lives before it is recycled. Default 30 minutes. */
  readonly ttlMs: number;
  /**
   * Called after each warm entry's underlying session is created. Mirrors
   * `SessionBootstrapDeps.onSessionCreated` — `src/index.ts` uses it to seed
   * the matching ADK session keyed on the same id.
   */
  readonly onSessionCreated?: (sessionId: string) => Promise<void> | void;
  /**
   * How often the maintenance tick runs (recycle + refill). Defaults to
   * `min(ttlMs / 4, 30_000)` which gives four checks per TTL window, capped at
   * 30s so very long TTLs do not sit idle.
   */
  readonly refillIntervalMs?: number;
  /** Clock injection for tests. */
  readonly now?: () => number;
  /**
   * Timer factory — tests pass a manual-advance fake so refill ticks are
   * deterministic. Defaults to `setInterval` / `clearInterval`.
   */
  readonly setInterval?: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>;
  readonly clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
}

/**
 * Pre-warmed session pool. Construct, `await start()` for the initial fill,
 * and the allocator is ready. Stop on shutdown to clear the timer and drop
 * remaining entries.
 */
export class WarmSessionPool implements SessionAllocator {
  private readonly sessionStore: SessionStore;
  private readonly targetSize: number;
  private readonly ttlMs: number;
  private readonly refillIntervalMs: number;
  private readonly onSessionCreated?: (sessionId: string) => Promise<void> | void;
  private readonly nowMs: () => number;
  private readonly setIntervalFn: NonNullable<WarmSessionPoolOptions['setInterval']>;
  private readonly clearIntervalFn: NonNullable<WarmSessionPoolOptions['clearInterval']>;

  private readonly queue: WarmEntry[] = [];
  private readonly members = new Set<string>();
  private timerHandle: ReturnType<typeof globalThis.setInterval> | null = null;
  /**
   * Refill serialisation flag. Not a true lock — JS is single-threaded on the
   * event loop, so a flag suffices to prevent two overlapping refill passes
   * from creating more than `targetSize` sessions when a claim-triggered
   * refill collides with a timer tick.
   */
  private refilling = false;
  private stopped = false;

  constructor(opts: WarmSessionPoolOptions) {
    if (opts.targetSize <= 0) {
      throw new Error('WarmSessionPool.targetSize must be > 0; use DirectAllocator for size 0.');
    }
    this.sessionStore = opts.sessionStore;
    this.targetSize = opts.targetSize;
    this.ttlMs = opts.ttlMs;
    this.refillIntervalMs =
      opts.refillIntervalMs ?? Math.min(Math.max(Math.floor(opts.ttlMs / 4), 1), 30_000);
    this.onSessionCreated = opts.onSessionCreated;
    this.nowMs = opts.now ?? (() => Date.now());
    this.setIntervalFn = opts.setInterval ?? globalThis.setInterval;
    this.clearIntervalFn = opts.clearInterval ?? globalThis.clearInterval;
  }

  /**
   * Initial pre-warm to `targetSize` and start the maintenance timer.
   * `await` this before accepting traffic so the first visitor sees a hit.
   */
  async start(): Promise<void> {
    await this.refillToTarget();
    this.timerHandle = this.setIntervalFn(() => {
      void this.tick();
    }, this.refillIntervalMs);
    // Allow the process to exit even if the timer is still live. Applies when
    // the platform's timer exposes `unref` (Node's Timeout does); browser /
    // fake timers may not, so guard with a feature check.
    const handle = this.timerHandle as unknown as { unref?: () => void };
    handle?.unref?.();
  }

  /**
   * Stop the maintenance timer and drop every remaining warm entry. Called
   * from the orchestrator's SIGTERM / SIGINT shutdown path so pre-warmed
   * sessions do not linger in the store pretending to be real visitors.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timerHandle !== null) {
      this.clearIntervalFn(this.timerHandle);
      this.timerHandle = null;
    }
    // Drop every pre-warmed entry. Important invariant: a warm session has no
    // consent, no user messages, no conversation. Leaving them in the store
    // after shutdown would pollute the session surface.
    const drained = this.queue.splice(0, this.queue.length);
    this.members.clear();
    for (const entry of drained) {
      await this.sessionStore.delete(entry.sessionId).catch(() => {
        // Delete is idempotent — swallow transient errors; we are shutting down.
      });
    }
  }

  /** Current queue length. Visible for tests and for future /healthz wiring. */
  size(): number {
    return this.queue.length;
  }

  /** Membership test — used by tests to confirm recycled entries are gone. */
  hasEntry(sessionId: string): boolean {
    return this.members.has(sessionId);
  }

  /**
   * Allocator contract. Pop the oldest entry (hit) or fall through to
   * `sessionStore.create()` (miss). Either way emits one event.
   *
   * If `initial` is supplied and a hit occurs, we apply the metadata to the
   * warm session via `sessionStore.update` so `entryUrl` / `regionInterestHint`
   * still land on the right record. That keeps the pool transparent to the
   * caller — they pass metadata, they see metadata, regardless of path.
   */
  async claim(initial?: Partial<SessionState>): Promise<SessionState> {
    const sizeAtClaim = this.queue.length;

    const entry = this.queue.shift();
    if (entry !== undefined) {
      this.members.delete(entry.sessionId);
      // Background refill — fire-and-forget. Timer will catch up if this
      // misses, and a `refilling` flag prevents overlap with the tick.
      void this.refillToTarget();

      const state = await this.applyInitial(entry.sessionId, initial);

      emitEvent({
        eventType: 'warm_pool.hit',
        eventVersion: 1,
        timestamp: new Date().toISOString(),
        sessionId: entry.sessionId,
        turnIndex: null,
        actor: 'system',
        payload: { poolSizeAtClaim: sizeAtClaim, waitTimeMs: 0 },
      });

      return state;
    }

    // Cold-path fallthrough — no queueing for a future warm entry in Puma.
    const created = await this.sessionStore.create(initial);
    if (this.onSessionCreated) {
      try {
        await this.onSessionCreated(created.sessionId);
      } catch (err) {
        await this.sessionStore.delete(created.sessionId).catch(() => {});
        throw err;
      }
    }

    emitEvent({
      eventType: 'warm_pool.miss',
      eventVersion: 1,
      timestamp: new Date().toISOString(),
      sessionId: created.sessionId,
      turnIndex: null,
      actor: 'system',
      payload: { poolSizeAtClaim: sizeAtClaim },
    });

    // The refill loop catches up on the next tick. No refill trigger here —
    // a miss means the pool was already empty, and the timer-driven refill is
    // responsible for reaching target; another refill call would race.
    return created;
  }

  /**
   * Timer-driven maintenance: recycle stale entries, then refill to target.
   * Swallows errors so a transient store failure does not kill the timer.
   */
  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.recycleStale();
      await this.refillToTarget();
    } catch (err) {
      // Observability — refill failures should be visible but must not crash
      // the timer. Emit the sanitised context and move on.
      emitEvent({
        eventType: 'error.raised',
        eventVersion: 1,
        timestamp: new Date().toISOString(),
        sessionId: 'warm-pool',
        turnIndex: null,
        actor: 'system',
        payload: {
          errorType: 'warm_pool_tick_failed',
          chunk: 'B',
          sanitisedContext: messageOf(err),
        },
      });
    }
  }

  /** Delete warm entries whose TTL has expired. */
  private async recycleStale(): Promise<void> {
    const now = this.nowMs();
    const fresh: WarmEntry[] = [];
    const stale: WarmEntry[] = [];
    for (const entry of this.queue) {
      if (now - entry.createdAtMs >= this.ttlMs) {
        stale.push(entry);
      } else {
        fresh.push(entry);
      }
    }
    if (stale.length === 0) return;

    // Replace the queue atomically before any awaits so a concurrent claim
    // cannot hand out a stale id.
    this.queue.splice(0, this.queue.length, ...fresh);
    for (const entry of stale) {
      this.members.delete(entry.sessionId);
    }
    for (const entry of stale) {
      await this.sessionStore.delete(entry.sessionId).catch(() => {
        // Idempotent delete; swallow.
      });
    }
  }

  /**
   * Top the queue up to `targetSize`. Serialised by `refilling` — a second
   * caller while one is in-flight is a no-op.
   */
  private async refillToTarget(): Promise<void> {
    if (this.stopped) return;
    if (this.refilling) return;
    this.refilling = true;
    try {
      while (!this.stopped && this.queue.length < this.targetSize) {
        const built = await this.buildOne();
        if (built === null) {
          // Failed to build this entry — stop refilling this pass so a
          // persistent store failure does not tight-loop. Next tick tries again.
          break;
        }
        if (this.stopped) {
          // Stopped mid-build: drop the entry we just created so it does not
          // linger in the store.
          await this.sessionStore.delete(built.sessionId).catch(() => {});
          break;
        }
        this.queue.push(built);
        this.members.add(built.sessionId);
      }
    } finally {
      this.refilling = false;
    }
  }

  /**
   * Build one warm session. Returns the new entry on success, null on
   * failure. Failures emit `error.raised` and unwind any half-created
   * session. Never throws.
   */
  private async buildOne(): Promise<WarmEntry | null> {
    let created: SessionState | null = null;
    try {
      created = await this.sessionStore.create({});
      if (this.onSessionCreated) {
        await this.onSessionCreated(created.sessionId);
      }
      return { sessionId: created.sessionId, createdAtMs: this.nowMs() };
    } catch (err) {
      if (created) {
        await this.sessionStore.delete(created.sessionId).catch(() => {});
      }
      emitEvent({
        eventType: 'error.raised',
        eventVersion: 1,
        timestamp: new Date().toISOString(),
        sessionId: created?.sessionId ?? 'warm-pool',
        turnIndex: null,
        actor: 'system',
        payload: {
          errorType: 'warm_pool_build_failed',
          chunk: 'B',
          sanitisedContext: messageOf(err),
        },
      });
      return null;
    }
  }

  /**
   * On a hit, apply caller-supplied metadata to the pre-warmed session. The
   * pool itself only ever builds with `{}`, so `entryUrl` / `regionInterestHint`
   * arrive here.
   */
  private async applyInitial(
    sessionId: string,
    initial: Partial<SessionState> | undefined,
  ): Promise<SessionState> {
    if (!initial || Object.keys(initial).length === 0) {
      const current = await this.sessionStore.get(sessionId);
      if (!current) {
        // Entry was deleted between shift and get — recover by creating fresh.
        // Rare enough that we accept the extra round-trip rather than complicate
        // the queue with a reservation protocol.
        return this.sessionStore.create(initial);
      }
      return current;
    }
    return this.sessionStore.update(sessionId, (s) => ({
      ...s,
      ...(initial.metadata ? { metadata: { ...s.metadata, ...initial.metadata } } : {}),
    }));
  }
}
