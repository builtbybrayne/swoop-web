/**
 * Session storage interface — B.t2.
 *
 * Puma's orchestrator code is agnostic to the backend. Every adapter
 * (in-memory, ADK-native, Vertex AI Session Service, Firestore) implements
 * this shape so we can swap the store at `SESSION_BACKEND` config time
 * without touching callers.
 *
 * Design notes:
 *   - `SessionState` (from `@swoop/common`) is the full shape the orchestrator
 *     reasons about. It holds conversation history, triage verdict, consent,
 *     wishlist, and metadata — the entire response across all four block
 *     types (utter / reasoning / fyi / adjunct) per chunk B §2.6 + §2.6a.
 *   - `update` is a mutate-in-place callback rather than a diff/patch: the
 *     adapter gets the current state, runs the mutator, persists the result.
 *     Keeps call sites terse and lets adapters decide on optimistic locking
 *     later (post-M4 when DB-backed lands).
 *   - Archival and deletion are distinct: `archive` flips a flag / moves the
 *     record to a read-only retention bucket (7-day window); `delete` drops
 *     it outright. Chunk B §2.6a's "warm pool deferred to B.t10" and the
 *     consent-withdrawal path in chunk E both lean on archival semantics.
 *   - All methods are async even if the backing store is sync. Matches the
 *     ADK-native and Firestore shapes and future-proofs the in-memory one.
 *
 * The consent gate `canAcceptTurn` is a free function that operates on a
 * `SessionState` snapshot so it can be called anywhere a session is in hand
 * without an adapter round-trip. Used by B.t5 in `/chat` before accepting
 * any user turn (chunk E §2.3 tier-1 consent requirement).
 */

import type { SessionState } from '@swoop/common';

/**
 * Storage abstraction over session records.
 *
 * Every adapter (in-memory, ADK-native, Vertex AI, Firestore) implements
 * this interface. Orchestrator code depends on the interface, never on a
 * concrete adapter — swap at `SESSION_BACKEND` config time.
 */
export interface SessionStore {
  /**
   * Create a new session. Adapter assigns `sessionId`, `createdAt`, and
   * `updatedAt` if not supplied in `initial`. Defaults for optional fields
   * (empty wishlist, `triage.verdict = "none"`, ungranted consent) are
   * filled in when missing.
   */
  create(initial?: Partial<SessionState>): Promise<SessionState>;

  /**
   * Fetch a session by id. Returns `null` when not found or when the
   * session has been deleted. Archived sessions are still returned (they
   * remain readable for their 7-day retention window); consumers that care
   * can inspect a future archived-flag field.
   */
  get(id: string): Promise<SessionState | null>;

  /**
   * Apply `mutate` to the current session and persist the result. The
   * mutator receives a snapshot and returns the new full state. Throws if
   * the session doesn't exist (mutating a ghost is always a bug).
   *
   * `updatedAt` is refreshed by the adapter after `mutate` runs — callers
   * do not need to touch it.
   */
  update(id: string, mutate: (s: SessionState) => SessionState): Promise<SessionState>;

  /**
   * Delete a session outright. Idempotent — calling on a missing id is a
   * no-op, not an error. Used for consent-withdrawal data erasure and for
   * the sweeper's final cleanup step after the archive window expires.
   */
  delete(id: string): Promise<void>;

  /**
   * Mark a session archived (read-only retention). The session is still
   * readable via `get` for the configured retention window; the sweeper
   * calls `delete` once that window expires. Idempotent.
   */
  archive(id: string): Promise<void>;
}

/**
 * Tier-1 consent gate (chunk E §2.3, chunk B §2.6 + §2.6a).
 *
 * Returns `true` only if the session holder has granted conversation
 * consent. The orchestrator calls this before processing every user turn
 * in `/chat` (B.t5) and refuses turns without tier-1 consent — that is the
 * mechanism by which "no session state accumulates before tier-1 consent"
 * is enforced.
 *
 * A free function (not a method on `SessionStore`) so the check has zero
 * adapter cost when a session snapshot is already in hand.
 */
export function canAcceptTurn(session: SessionState): boolean {
  return session.consent.conversation.granted === true;
}
