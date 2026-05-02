/**
 * `POST /session` — allocate a fresh Puma session (B.t5).
 *
 * Chunk D calls this once when its chat surface opens (before the tier-1
 * consent disclosure is shown; see planning/02-impl-chat-surface.md §2.4).
 * The response carries:
 *   - `sessionId`: opaque uuid used on every subsequent call.
 *   - `disclosureCopyVersion`: the version string chunk D should paint into
 *     the tier-1 disclosure. The UI echoes this value back in
 *     `PATCH /session/:id/consent` so we have a paper trail of which copy
 *     the visitor saw (chunk E §2.3).
 *
 * No body is required. Tier-1 consent is NOT granted at this point — the
 * session exists so that even a visitor who closes the window before
 * consenting can be garbage-collected cleanly (idle sweeper, B.t2).
 *
 * Warm-pool allocation is out of scope (B.t10). Every call here mints a
 * fresh session via `SessionStore.create`.
 */

import type { Request, Response } from 'express';
import { SessionBootstrapRequestSchema, emitErrorRaised, emitEvent } from '@swoop/common';
import type { SessionStore, SessionAllocator } from '../session/index.js';
import { DISCLOSURE_COPY_VERSION, sendError } from './errors.js';

export interface SessionBootstrapDeps {
  readonly sessionStore: SessionStore;
  /**
   * Optional factory for the disclosure copy version string. Defaults to
   * the constant exported from `errors.ts`. Tests inject alternatives.
   */
  readonly disclosureCopyVersion?: string;
  /**
   * Called after the ADK-side hook has finished provisioning any ephemeral
   * state tied to this session id. B.t7's vertical slice wires this to the
   * ADK `SessionService` so Runner turns find a matching ADK session.
   *
   * Ignored when `allocator` is supplied — the allocator owns the hook in
   * that path (B.t10). Retained on the signature so existing tests that
   * exercise the bootstrap handler without an allocator keep working.
   */
  readonly onSessionCreated?: (sessionId: string) => Promise<void> | void;
  /**
   * Warm-pool allocator (B.t10). When present, `/session` claims via the
   * allocator instead of calling `sessionStore.create` directly. The
   * allocator internally dispatches between a hot pool entry (hit) and a
   * fresh create (miss) and emits the corresponding `warm_pool.*` event.
   *
   * When omitted (the default, WARM_POOL_SIZE=0 path via `DirectAllocator`
   * can also be used — both work), the handler falls through to the legacy
   * `sessionStore.create` + `onSessionCreated` sequence. Tests rely on this
   * fallthrough so the HTTP surface can be driven without wiring the pool.
   */
  readonly allocator?: SessionAllocator;
}

export function createSessionBootstrapHandler(
  deps: SessionBootstrapDeps,
): (req: Request, res: Response) => Promise<void> {
  const copyVersion = deps.disclosureCopyVersion ?? DISCLOSURE_COPY_VERSION;
  return async function handleSessionBootstrap(req, res) {
    // `req.body` is `{}` when no body is sent (Express + express.json default).
    // Theme-A.1: Zod-validate. `entryUrl` is `.url()`-checked, closing Sec-3
    // (arbitrary `javascript:`/`data:` URLs no longer reach session metadata
    // or downstream events / handoff records).
    const parsed = SessionBootstrapRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      sendError(res, 400, 'invalid_request', detail);
      return;
    }
    const { entryUrl, regionInterestHint } = parsed.data;

    try {
      const initial = {
        metadata: {
          ...(entryUrl ? { entryUrl } : {}),
          ...(regionInterestHint ? { regionInterestHint } : {}),
        },
      };

      let state;
      if (deps.allocator) {
        // Allocator path (B.t10). Emits warm_pool.hit or warm_pool.miss and
        // runs its own onSessionCreated hook.
        state = await deps.allocator.claim(initial);
      } else {
        state = await deps.sessionStore.create(initial);
        if (deps.onSessionCreated) {
          try {
            await deps.onSessionCreated(state.sessionId);
          } catch (err) {
            // If downstream session provisioning fails, unwind so the caller
            // isn't handed an id pointing at a half-built session.
            await deps.sessionStore.delete(state.sessionId).catch(() => {});
            throw err;
          }
        }
      }

      emitEvent({
        eventType: 'conversation.started',
        eventVersion: 1,
        timestamp: new Date().toISOString(),
        sessionId: state.sessionId,
        turnIndex: null,
        actor: 'system',
        payload: {
          ...(entryUrl ? { entryUrl } : {}),
          // variantId + warmPoolHit remain unset until B.t10 lands the
          // warm-pool path; the schema allows either to be absent.
        },
      });

      res.status(201).json({
        sessionId: state.sessionId,
        disclosureCopyVersion: copyVersion,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'session bootstrap failed';
      emitErrorRaised({
        sessionId: 'unknown',
        actor: 'system',
        errorType: 'session_bootstrap_failed',
        chunk: 'B',
        sanitisedContext: message,
      });
      sendError(res, 500, 'internal_error', message);
    }
  };
}
