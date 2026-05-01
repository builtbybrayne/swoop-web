/**
 * Per-session async mutex over `SessionStore.update` — R2 (2026-04-30 review).
 *
 * Problem this solves: `chat.ts` fires `store.update(sessionId, ...)` from
 * multiple unawaited paths inside a single turn —
 *   - `void persistPart(...)` per streamed part (`chat.ts:258`),
 *   - `void appendToHistory(...)` from the reasoning sink (`chat.ts:213-219`),
 *   - the pre-stream `appendUserMessage` and the triage classifier write,
 *
 * each of which performs a read-modify-write `s => ({...s, conversationHistory: [...s.conversationHistory, ...] })`.
 * `InMemorySessionStore` happens to serialise these by JS event-loop ordering
 * (the mutator runs synchronously and never awaits), so today the lost-update
 * window is empty in practice. The moment any backing store goes async (the
 * Firestore stub already does; the planned Postgres `SessionService` from
 * B.22 will), two interleaved updates each see the same `s` snapshot and the
 * second `set` clobbers the first — silently dropping entries.
 *
 * Fix shape: a thin decorator around any `SessionStore`. It keeps a
 * per-sessionId tail promise; every `update()` awaits the previous tail before
 * invoking the underlying store. Reads / creates / deletes are passthrough
 * (none of the racy call sites are reads, and `archive` runs from the sweeper
 * which already operates on idle sessions). Failures inside `update` propagate
 * to the caller AND clear the chain so subsequent updates aren't poisoned.
 *
 * The mutex is per-sessionId: distinct sessions never serialise against each
 * other, so concurrent turns on different visitors stay parallel. The map
 * grows lazily and is cleared opportunistically when a session's chain
 * settles back to its initial promise — bounded growth in normal operation.
 */

import type { SessionState } from '@swoop/common';
import type { SessionStore } from './interface.js';

export class MutexSessionStore implements SessionStore {
  /**
   * Per-session tail promise. The current chain head for sessionId. Awaiting
   * `tails.get(id)` blocks until every prior queued update has settled.
   */
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(private readonly inner: SessionStore) {}

  create(initial?: Partial<SessionState>): Promise<SessionState> {
    return this.inner.create(initial);
  }

  get(id: string): Promise<SessionState | null> {
    return this.inner.get(id);
  }

  delete(id: string): Promise<void> {
    // Drop any pending chain — there's nothing to serialise into a deleted
    // session. Lets the GC reclaim the closures.
    this.tails.delete(id);
    return this.inner.delete(id);
  }

  archive(id: string): Promise<void> {
    return this.inner.archive(id);
  }

  /**
   * Serialise updates per sessionId. The pattern: build a new tail that
   * `await`s the prior tail, then runs the underlying update; install it
   * before returning so the next caller sees a chain that includes us. The
   * `.catch(() => {})` guard on the awaited prior tail prevents one failed
   * update from rejecting subsequent queued updates — each waits for the
   * previous to *settle*, not to *succeed*.
   */
  async update(
    id: string,
    mutate: (s: SessionState) => SessionState,
  ): Promise<SessionState> {
    const prior = this.tails.get(id) ?? Promise.resolve();
    const next = (async () => {
      // Wait for the prior queued update to settle (success OR failure).
      // Swallowing the prior's error here is correct: that error has already
      // been propagated to its own caller; we only need to know the prior
      // state-write window is closed before we read.
      try {
        await prior;
      } catch {
        // intentional swallow — see comment above.
      }
      return this.inner.update(id, mutate);
    })();

    // Track the tail for the *next* caller. The settled-or-not guard on the
    // chain (the catch above) means a rejection here doesn't poison the
    // chain — but we still want to clear the entry once the queue drains so
    // the map doesn't grow without bound. The `.finally(...)` runs after
    // both success and failure; the identity check ensures we only clear
    // when we're still the latest tail (a newer enqueue has overwritten us
    // otherwise).
    const tail = next.catch(() => undefined).finally(() => {
      if (this.tails.get(id) === tail) {
        this.tails.delete(id);
      }
    });
    this.tails.set(id, tail);

    return next;
  }
}
