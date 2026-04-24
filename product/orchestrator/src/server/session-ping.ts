/**
 * `GET /session/:id/ping` — proactive preflight probe (D.t6).
 *
 * Layered on top of D.t5's reactive `/chat` 404 path: instead of the visitor
 * discovering their session has expired only after typing a message, the UI
 * probes this endpoint on mount / tab-focus / long idle and surfaces the
 * `session_expired` banner *before* the visitor composes anything.
 *
 * Contract:
 *   - Always returns `200 OK` — even for unknown ids. The verdict travels in
 *     the body (`{ok, expired, serverTime}`), not the HTTP status. Rationale:
 *     the probe is a routine client action (fires multiple times per visit
 *     in some triggers); browser / CORS edge cases around 404s from an
 *     otherwise-healthy origin would cry-wolf into the UI's unreachable
 *     surface. The discriminator belongs in the payload. (Decision D.16.)
 *   - Reads via `SessionStore.get(id)`. Non-null → `{ok:true, expired:false}`;
 *     null → `{ok:false, expired:true}`. We deliberately do NOT distinguish
 *     archived sessions from live ones at this surface (decision D.16 / plan
 *     §Key notes option (c)): an archived session already fails `/chat`'s
 *     consent gate and looks identical to "expired" from the visitor's POV.
 *     Promoting archival to a dedicated interface method is deferred until
 *     a concrete UX need surfaces.
 *   - Does NOT mutate the session — specifically, does NOT bump `updatedAt`.
 *     A probe is not an interaction; if it refreshed the idle timer, the
 *     sweeper would never archive a session whose tab is left open. The
 *     `SessionStore.get` adapter is already side-effect-free for both in-
 *     memory and ADK-native backends — nothing else to do here to preserve
 *     that invariant.
 *   - Rate limiting: none. The client debounces (plan §D.17); the probe is
 *     cheap (one `Map.get`). Revisit if F's telemetry flags abuse patterns.
 *
 * CORS: the global `corsMiddleware` in `server/index.ts` already emits
 * `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS` so GET
 * preflights against this route succeed without any new wiring.
 *
 * See planning/03-exec-chat-surface-t6.md §Orchestrator side — the probe
 * endpoint.
 */

import type { Request, Response } from 'express';
import type { SessionPingResponse } from '@swoop/common';
import type { SessionStore } from '../session/index.js';
import { sendError } from './errors.js';

export interface SessionPingDeps {
  readonly sessionStore: SessionStore;
  /** Clock injection for tests (e.g. pinning `serverTime` in assertions). */
  readonly now?: () => Date;
}

export function createSessionPingHandler(
  deps: SessionPingDeps,
): (req: Request, res: Response) => Promise<void> {
  const now = deps.now ?? (() => new Date());
  return async function handleSessionPing(req, res) {
    const sessionId = req.params.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      // Kept as a 400 to distinguish malformed requests from "no such id";
      // the client never hits this path in practice (the URL is built from
      // a stored id) but defensive validation keeps the handler honest.
      sendError(res, 400, 'invalid_request', 'session id is required.');
      return;
    }

    // One read; cached so the response object is a pure transform of a
    // single store lookup. Keeps the "no mutation" invariant trivially true.
    const state = await deps.sessionStore.get(sessionId);
    const exists = state !== null;
    const body: SessionPingResponse = {
      ok: exists,
      expired: !exists,
      serverTime: now().toISOString(),
    };
    res.status(200).json(body);
  };
}
