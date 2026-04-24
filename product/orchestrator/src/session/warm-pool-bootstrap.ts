/**
 * Warm pool bootstrap — B.t10.
 *
 * Thin composition function called from `src/index.ts`. Keeps the pool module
 * testable without a config-shape dependency: this file is the seam where the
 * `Config` object, the store, and the ADK `onSessionCreated` hook come together.
 *
 * Behaviour:
 *   - `WARM_POOL_SIZE === 0` (default): returns a `DirectAllocator` so the
 *     `POST /session` handler is unconditional. Emits `warm_pool.miss` on
 *     every claim; behaviour otherwise identical to the previous B.t5 path.
 *   - `WARM_POOL_SIZE > 0`: constructs a `WarmSessionPool`, awaits `start()`
 *     for the initial pre-warm, returns it. First visitor sees a hit.
 *
 * The caller owns the lifecycle: always `await allocator.stop()` on shutdown
 * so warm entries do not linger in the session store.
 */

import type { Config } from '../config/index.js';
import type { SessionStore } from './interface.js';
import { DirectAllocator, WarmSessionPool, type SessionAllocator } from './warm-pool.js';

export interface StartWarmPoolDeps {
  readonly config: Config;
  readonly sessionStore: SessionStore;
  /**
   * Called after each warm entry's session is created. `src/index.ts` uses
   * this to pre-create the matching ADK session so `/chat` finds it when the
   * visitor's first turn arrives.
   */
  readonly onSessionCreated?: (sessionId: string) => Promise<void> | void;
}

/**
 * Build + start the session allocator. Resolves after the initial pre-warm
 * (if any) completes, so the caller can call `app.listen` knowing the first
 * `POST /session` will hit.
 */
export async function startWarmPool(deps: StartWarmPoolDeps): Promise<SessionAllocator> {
  const size = deps.config.WARM_POOL_SIZE;
  if (size === 0) {
    return new DirectAllocator(deps.sessionStore, deps.onSessionCreated);
  }
  const pool = new WarmSessionPool({
    sessionStore: deps.sessionStore,
    targetSize: size,
    ttlMs: deps.config.WARM_POOL_TTL_MINUTES * 60_000,
    onSessionCreated: deps.onSessionCreated,
  });
  await pool.start();
  return pool;
}
