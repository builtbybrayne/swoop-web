/**
 * Session module barrel + backend factory — B.t2.
 *
 * Single entry point the rest of the orchestrator imports from:
 *
 *   import { createSessionStore, canAcceptTurn } from './session/index.js';
 *
 * The factory reads `SESSION_BACKEND` from config and returns a
 * `SessionStore`. Unknown values exit fast at construction time — never
 * silently fall through to a default. Default is `"in-memory"` to keep
 * zero-config dev painless.
 *
 * Backend matrix (per Tier 3 plan §Deliverables):
 *   - `in-memory`  → `InMemorySessionStore` (custom `Map<>`, Phase 1 default)
 *   - `adk-native` → `AdkNativeSessionStore` (wraps ADK's `memory://`)
 *   - `vertex-ai`  → `VertexAiSessionStore` (stub; post-M4)
 *   - `firestore`  → `FirestoreSessionStore` (stub; post-M4)
 */

export type { SessionStore } from './interface.js';
export { canAcceptTurn } from './interface.js';
export {
  InMemorySessionStore,
  type InMemorySessionStoreOptions,
} from './in-memory.js';
export {
  AdkNativeSessionStore,
  type AdkNativeSessionStoreOptions,
} from './adk-native.js';
export { VertexAiSessionStore } from './vertex-ai.js';
export { FirestoreSessionStore } from './firestore.js';

import type { SessionStore } from './interface.js';
import { InMemorySessionStore } from './in-memory.js';
import { AdkNativeSessionStore } from './adk-native.js';
import { VertexAiSessionStore } from './vertex-ai.js';
import { FirestoreSessionStore } from './firestore.js';

/**
 * The four valid `SESSION_BACKEND` values. `in-memory` is the default.
 *
 * Kept as a string-literal tuple so both the config parser (B.t6 / current
 * ad-hoc reader in B.t5) and the factory share one source of truth.
 */
export const SESSION_BACKENDS = [
  'in-memory',
  'adk-native',
  'vertex-ai',
  'firestore',
] as const;
export type SessionBackend = (typeof SESSION_BACKENDS)[number];

export interface CreateSessionStoreOptions {
  /**
   * Which backend to instantiate. Required from callers now that config
   * ownership lives exclusively in `src/config/` (B.t5 cleanup — the former
   * fallback to `process.env.SESSION_BACKEND` here was the last stray
   * `process.env` read outside the config module, and it has been removed).
   * Defaults to `'in-memory'` when a caller genuinely wants the default
   * backend without knowing about it (exercised in unit tests).
   */
  backend?: SessionBackend | string;
  /**
   * Idle TTL (ms) for the in-memory sweeper. Passed through only for the
   * `in-memory` backend. Other backends have their own lifecycle rules.
   */
  idleTtlMs?: number;
  /**
   * Archive retention (ms) for the in-memory sweeper. Passed through only
   * for the `in-memory` backend.
   */
  archiveTtlMs?: number;
  /**
   * Clock injection. Only honoured by adapters that have a testable clock
   * (currently `in-memory` and `adk-native`).
   */
  now?: () => number;
}

function resolveBackend(input: string | undefined): SessionBackend {
  const candidate = (input ?? 'in-memory').trim();
  if ((SESSION_BACKENDS as readonly string[]).includes(candidate)) {
    return candidate as SessionBackend;
  }
  throw new Error(
    `unknown SESSION_BACKEND="${candidate}" — expected one of: ${SESSION_BACKENDS.join(
      ', ',
    )}`,
  );
}

/**
 * Build a `SessionStore` for the chosen backend. Startup must be clean for
 * every backend (even the stubs) — the stubs throw only when methods are
 * called, not at construction time. See Tier 3 plan §Verification step 4.
 *
 * Callers pass backend + TTLs explicitly; `src/index.ts` resolves them from
 * the validated `Config` object produced by `loadConfig()`. No `process.env`
 * reads happen inside this module.
 */
export function createSessionStore(opts: CreateSessionStoreOptions = {}): SessionStore {
  const backend = resolveBackend(opts.backend);
  switch (backend) {
    case 'in-memory':
      return new InMemorySessionStore({
        idleTtlMs: opts.idleTtlMs,
        archiveTtlMs: opts.archiveTtlMs,
        now: opts.now,
      });
    case 'adk-native':
      return new AdkNativeSessionStore({ now: opts.now });
    case 'vertex-ai':
      return new VertexAiSessionStore();
    case 'firestore':
      return new FirestoreSessionStore();
  }
}
