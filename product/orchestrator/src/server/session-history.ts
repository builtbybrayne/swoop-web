/**
 * `GET /session/:id/history` — server-side session history projection (B.t11).
 *
 * Per planning/01-side-quest-persistence.md §5 W1:
 *   - On iframe remount, the UI fetches the full UI-facing message-part stream
 *     for an existing session id so the visitor sees their prior conversation
 *     intact.
 *   - The endpoint runs the existing translator (B.t4) over the ADK session's
 *     stored events. Same translator, same reasoning-strip filter as the live
 *     SSE — the response shape is `{ parts: MessagePart[] }` matching the live
 *     stream 1:1 (decision SQ.2 in the side-quest plan).
 *   - Reasoning parts MUST NOT appear in the response. The reasoning-filter
 *     invariant from chunk B §2.4 holds here too: if `<reasoning>` leaks, it
 *     is a translator bug, not a behavioural choice.
 *
 * Contract (decision SQ.2 + SQ.6):
 *   - 200 + `{ parts: MessagePart[] }` for a known active session id.
 *     Empty `parts` is a valid response when consent has been granted but no
 *     turns have happened yet.
 *   - 404 + `{ error: { code: 'session_not_found', ... } }` for unknown or
 *     archived ids. Conflating "unknown" and "archived" matches the
 *     `/chat` 404 path (consent gate already treats archived as un-acceptable);
 *     the UI uses 404 to clear sessionStorage and route to a fresh-visit flow.
 *
 * Architecture:
 *   - The Puma `SessionStore.get` lookup is the gatekeeper for "is this id
 *     real?". It hits the same `Map` the consent gate and `/chat` use.
 *   - The ADK `BaseSessionService.getSession` lookup is the source of truth
 *     for the event log. The translator consumes ADK events directly.
 *   - We deliberately do NOT replay from the Puma `conversationHistory` —
 *     that's a downsampled projection (chat.ts persists tool-call parts as
 *     `${toolName}:${state}` text, losing toolCallId / input / output). The
 *     ADK event log is lossless because it carries the original LlmResponse
 *     content blocks (functionCall / functionResponse / text / thought).
 *
 * Out of scope (per Tier 3 brief):
 *   - Client-side rehydration (D.t9).
 *   - Real ADK session-event-replay test (we use the existing translator
 *     fixture pattern: hand-built ADK Event objects).
 *   - New shared types in @swoop/common (the existing `MessagePart` covers it).
 *
 * CORS: the global `corsMiddleware` in `server/index.ts` already emits
 * `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS` so a GET
 * preflight succeeds without new wiring.
 */

import type { Request, Response } from 'express';
import type { BaseSessionService } from '@google/adk';
import type { MessagePart } from '@swoop/common';

import type { SessionStore } from '../session/index.js';
import { translateAdkStream } from '../translator/index.js';
import type { AdkEvent } from '../translator/index.js';
import { sendError } from './errors.js';

export interface SessionHistoryDeps {
  readonly sessionStore: SessionStore;
  /**
   * The ADK session service the runner uses to persist events. Same instance
   * `runner.sessionService` exposes; the entry point passes it through here
   * so we don't re-derive it from `runner` at request time.
   */
  readonly sessionService: BaseSessionService;
  /** ADK app name keying. Defaults to the orchestrator's fixed app name. */
  readonly appName?: string;
  /** ADK user id keying. Defaults to the anonymous Phase 1 user id. */
  readonly userId?: string;
  /** Clock injection for tests; passed through to the translator's `<fyi>` timestamps. */
  readonly now?: () => Date;
}

const DEFAULT_APP_NAME = 'puma-orchestrator';
const DEFAULT_USER_ID = 'anonymous';

export function createSessionHistoryHandler(
  deps: SessionHistoryDeps,
): (req: Request, res: Response) => Promise<void> {
  const appName = deps.appName ?? DEFAULT_APP_NAME;
  const userId = deps.userId ?? DEFAULT_USER_ID;
  const now = deps.now ?? (() => new Date());

  return async function handleSessionHistory(req, res) {
    const sessionId = req.params.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sendError(res, 400, 'invalid_request', 'session id is required.');
      return;
    }

    // Gate 1: Puma-side existence check. `SessionStore.get` returns null for
    // both unknown and deleted ids; archived sessions still come back as
    // non-null (matching `/session/:id/ping`'s conflation behaviour). The
    // 404 here is what trips the client's "expired conversation" UX.
    const pumaSession = await deps.sessionStore.get(sessionId);
    if (!pumaSession) {
      sendError(res, 404, 'session_not_found', `no session with id ${sessionId}`);
      return;
    }

    // Gate 2: ADK-side event log fetch. If the Puma session exists but the
    // ADK session is missing (orchestrator-restart desync, or any future
    // backend that lets the two stores diverge), treat it as not found.
    // Belt-and-braces: in practice the bootstrap path keeps the two in sync.
    let adkSession: Awaited<ReturnType<BaseSessionService['getSession']>>;
    try {
      adkSession = await deps.sessionService.getSession({
        appName,
        userId,
        sessionId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, 'internal_error', `failed to load session events: ${message}`);
      return;
    }

    if (!adkSession) {
      sendError(res, 404, 'session_not_found', `no session with id ${sessionId}`);
      return;
    }

    // Wrap the recorded ADK events as an async iterable so the existing
    // translator pipeline consumes them unchanged. The translator strips
    // reasoning parts unconditionally (chunk B §2.4 invariant); we don't
    // pass an `onFiltered` sink because rehydration is read-only and we're
    // not re-persisting anything.
    const events = adkSession.events ?? [];
    const parts: MessagePart[] = [];
    try {
      for await (const part of translateAdkStream(asAsyncIterable(events), { now })) {
        parts.push(part);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(
        res,
        500,
        'internal_error',
        `failed to translate session events: ${message}`,
      );
      return;
    }

    res.status(200).json({ parts });
  };
}

/**
 * Adapt an `Event[]` into an `AsyncIterable<AdkEvent>` so the existing
 * translator (which consumes `for await ... of source`) can run over a
 * recorded log without modification.
 */
async function* asAsyncIterable(events: readonly AdkEvent[]): AsyncIterable<AdkEvent> {
  for (const event of events) {
    yield event;
  }
}
