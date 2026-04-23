/**
 * `PATCH /session/:id/consent` + `DELETE /session/:id` — B.t5.
 *
 * Captures the visitor's tier-1 (conversation) consent decision. The UI has
 * already painted the disclosure at the copy version returned by
 * `POST /session`; this endpoint writes the outcome to session state so the
 * `/chat` turn gate (canAcceptTurn) knows whether turns can proceed.
 *
 * Body: `{ granted: boolean, copyVersion: string }`.
 *   - `granted: true`  → tier-1 set, session becomes accept-turn-eligible.
 *   - `granted: false` → tier-1 cleared + session deleted outright. Chunk E
 *     §2.3 treats an active refusal as a data-erasure signal: we drop the
 *     record rather than keep a negative-consent shell.
 *
 * Missing session → 404. Malformed body → 400. Unknown copyVersion is NOT
 * rejected here: the UI may be a few patches ahead; we trust the string and
 * let audit tooling reconcile later.
 *
 * `DELETE /session/:id` is the hard-close path (user closed the widget,
 * explicitly). Idempotent: missing session still returns 204.
 */

import type { Request, Response } from 'express';
import type { SessionStore } from '../session/index.js';
import type { ConsentState, SessionState } from '@swoop/common';
import { sendError } from './errors.js';

export interface ConsentDeps {
  readonly sessionStore: SessionStore;
  /**
   * Clock injection for the consent record timestamp — tests use a frozen
   * clock so assertions don't fight wallclock drift.
   */
  readonly now?: () => Date;
}

export function createConsentHandler(
  deps: ConsentDeps,
): (req: Request, res: Response) => Promise<void> {
  const now = deps.now ?? (() => new Date());
  return async function handleConsent(req, res) {
    const sessionId = req.params.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sendError(res, 400, 'invalid_request', 'session id is required.');
      return;
    }

    const body = req.body as
      | { granted?: unknown; copyVersion?: unknown }
      | undefined;
    const granted = body?.granted;
    const copyVersion = body?.copyVersion;

    if (typeof granted !== 'boolean') {
      sendError(res, 400, 'invalid_request', '`granted` must be a boolean.');
      return;
    }
    if (typeof copyVersion !== 'string' || copyVersion.length === 0) {
      sendError(res, 400, 'invalid_request', '`copyVersion` must be a non-empty string.');
      return;
    }

    const existing = await deps.sessionStore.get(sessionId);
    if (!existing) {
      sendError(res, 404, 'session_not_found', `no session with id ${sessionId}`);
      return;
    }

    if (!granted) {
      // Active refusal — drop the record. Keeps Puma's "no state without
      // tier-1 consent" invariant crisp (chunk B §2.6 + chunk E §2.3).
      await deps.sessionStore.delete(sessionId);
      res.status(200).json({ deleted: true });
      return;
    }

    const nowIso = now().toISOString();
    const consent: ConsentState = {
      ...existing.consent,
      conversation: {
        granted: true,
        timestamp: nowIso,
        copyVersion,
      },
    };

    const next: SessionState = await deps.sessionStore.update(sessionId, (s) => ({
      ...s,
      consent,
    }));

    res.status(200).json({ consent: next.consent });
  };
}

export function createSessionDeleteHandler(
  deps: ConsentDeps,
): (req: Request, res: Response) => Promise<void> {
  return async function handleDelete(req, res) {
    const sessionId = req.params.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sendError(res, 400, 'invalid_request', 'session id is required.');
      return;
    }
    await deps.sessionStore.delete(sessionId);
    res.status(204).end();
  };
}
