/**
 * Per-tool handler dependency bag — the surface every handler body consumes.
 *
 * Wired once at registration time (`tools/index.ts`); tests inject their own
 * implementations and never touch the pool / Gemini client.
 */

import type pg from 'pg';
import type { EmbedQueryFn } from '../data/embed-query.js';

export interface ToolHandlerDeps {
  /**
   * Borrow-and-release a PoolClient for the duration of fn. Tools call this
   * once per primitive composition; the runtime guarantees release on throw.
   */
  withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  /** Embed a visitor utterance into the 3072d gemini-embedding-001 search vector. */
  embedQuery: EmbedQueryFn;
  /**
   * Staff-token enforcement gate for mutating sales-memory tools (T3-3 / sm-4).
   * Optional: only the mutating memory tools (memory_store / memory_edit /
   * memory_retire) consult it; when absent they fall back to the built-in
   * `assertStaffTokenPresent` presence check. Every other tool ignores it, so
   * existing tool wiring + tests are unaffected.
   *
   * Throws (rejecting the mutation) when the token is missing/invalid.
   *
   * Trust-boundary note: the orchestrator is the PRIMARY trust boundary — it
   * cryptographically verifies the staff JWT and binds the validated token into
   * the memory-tool call before it reaches the connector. This connector-side
   * gate is the server-side BACKSTOP required by sm-4 ("connector hard-rejects
   * unauth'd mutates"): a mutation can never run without a token even if a
   * caller bypasses the orchestrator's binding. A future hardening swaps in a
   * full cryptographic verifier here once the connector carries its own
   * STAFF_JWT_SECRET — no handler change required (the seam is this function).
   */
  assertStaffToken?: (token: string | undefined) => void | Promise<void>;
}

/**
 * Default staff-token gate (T3-3 / sm-4): rejects a mutation when the token is
 * absent or blank. Used by the mutating memory tools when `ToolHandlerDeps`
 * does not inject a stronger `assertStaffToken`.
 *
 * This is intentionally a structural (presence) check, not a cryptographic one:
 * the orchestrator already verified the JWT signature + expiry before binding
 * the token into the call. The connector's job is to guarantee no mutation runs
 * tokenless. `toolName` is woven into the error so logs identify the rejected
 * call.
 */
export function assertStaffTokenPresent(
  token: string | undefined,
  toolName: string,
): void {
  if (!token || token.trim().length === 0) {
    throw new Error(
      `[${toolName}] Mutation rejected: a valid staffToken is required. ` +
        `This tool is staff-only; the orchestrator binds the token after ` +
        `verifying the staff JWT.`,
    );
  }
}
