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
import type { SessionStore } from '../session/index.js';
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
   */
  readonly onSessionCreated?: (sessionId: string) => Promise<void> | void;
}

export function createSessionBootstrapHandler(
  deps: SessionBootstrapDeps,
): (req: Request, res: Response) => Promise<void> {
  const copyVersion = deps.disclosureCopyVersion ?? DISCLOSURE_COPY_VERSION;
  return async function handleSessionBootstrap(req, res) {
    try {
      const entryUrl = typeof req.body?.entryUrl === 'string' ? req.body.entryUrl : undefined;
      const regionInterestHint =
        typeof req.body?.regionInterestHint === 'string'
          ? req.body.regionInterestHint
          : undefined;

      const state = await deps.sessionStore.create({
        metadata: {
          ...(entryUrl ? { entryUrl } : {}),
          ...(regionInterestHint ? { regionInterestHint } : {}),
        },
      });

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

      res.status(201).json({
        sessionId: state.sessionId,
        disclosureCopyVersion: copyVersion,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'session bootstrap failed';
      sendError(res, 500, 'internal_error', message);
    }
  };
}
