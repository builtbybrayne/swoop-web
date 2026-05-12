/**
 * `GET /session/:id/history` — server-side session history projection (B.t11).
 *
 * Per planning/03-exec-agent-runtime-t11.md:
 *   - On iframe remount (D.t9-mount-rehydrate is the UI side), the visitor's
 *     prior conversation is replayed from the ADK session's stored event
 *     log so the chat picks up where it left off rather than starting fresh.
 *   - The endpoint runs the existing translator (B.t4) over the recorded
 *     ADK events. Same translator, same reasoning-strip filter as the live
 *     SSE — the response shape is `{parts: MessagePart[]}` matching the
 *     live stream 1:1 (decision SQ.2 in the side-quest plan).
 *   - Reasoning parts MUST NOT appear in the response. The reasoning-filter
 *     invariant from chunk B §2.4 holds here too: if `<reasoning>` leaks,
 *     that is a translator bug, not a behavioural choice. Enforced by
 *     reusing `translateAdkStream`, which composes `adkEventsToParts` with
 *     `filterReasoning`.
 *
 * Contract (decisions SQ.2 + SQ.6, refined by B.26):
 *   - `200 {parts: MessagePart[]}` for a known active session id. Empty
 *     `parts` is a valid response when consent has been granted but no
 *     turns have happened yet (or for a warm-pool-claimed session per
 *     B.t10 — same "alive, just no history" state).
 *   - `400 {error.code:"invalid_request"}` for a malformed `:id` path
 *     parameter. The client never builds this URL in practice; defence-in-
 *     depth keeps the handler honest.
 *   - `404 {error.code:"session_not_found"}` when the Puma `SessionStore`
 *     lookup returns null, the ADK `getSession` returns null, or the
 *     session exists but consent has not been granted. All three gates
 *     collapse to one wire-level verdict (D.16's `/ping` rationale: the UI
 *     does not need to distinguish; one banner surface serves all three).
 *     The four observability emits below preserve the distinction.
 *   - `500 {error.code:"internal_error"}` when the ADK `getSession` call
 *     throws or the translator throws mid-replay. UI's `unknown` surface.
 *   - `503` is reserved for the post-M4 swap to a networked session
 *     backend (Postgres `SessionService` per B.22); the in-memory backend
 *     does not produce it.
 *
 * Observability:
 *   - `session.rehydrated` — non-empty 200 path. Carries `partCount`,
 *     `eventCount`, `durationMs`.
 *   - `session.replay.empty` — 200 path with zero parts. Carries
 *     `eventCount` so analytics can tell "empty session" from "session
 *     with parts that all got filtered out" (the latter shouldn't happen
 *     under the current translator, but the data lets us notice if it
 *     starts).
 *   - `session.replay.failed` — 5xx path. Carries `stage` (which step
 *     threw: `adk_fetch` or `translator`) and a short `errorMessage`.
 *   - `session.expired` — 404 path. Carries a `gate` discriminator
 *     (`puma` / `adk` / `consent`) so post-launch analytics can
 *     distinguish unknown-id from desync from pre-consent race. The
 *     existing sweeper-driven emit (in-memory.ts) continues to carry
 *     `{cause}` instead; both shapes pass through the widened payload
 *     union in `@swoop/common/events`.
 *
 * Projection source:
 *   The handler reads the ADK session's `events` array directly via
 *   `sessionService.getSession()`, then feeds it through `translateAdkStream`.
 *   We deliberately do NOT project from Puma's `SessionState.conversationHistory`
 *   — that's a downsampled shape (`{turnIndex, role, blockType, text,
 *   timestamp}`) that loses `toolCallId` / `input` / `output` for tool-call
 *   parts. The ADK event log carries the lossless original `LlmResponse`
 *   content blocks (functionCall / functionResponse / text / thought).
 *
 * Authentication:
 *   Session-id-as-secret, same posture as `/chat` per decision B.8. The
 *   open HITL item (Q1 in the plan's HITL ratification record) is whether
 *   the rehydration path warrants a stronger token given it leaks more
 *   state per call than `/chat` does per turn. Default leaning per the
 *   plan: same posture; revisit with legal counsel.
 *
 * Interface stability:
 *   `SessionHistoryDeps` is typed against `SessionStore` (Puma's interface)
 *   and `BaseSessionService` (ADK's interface). The post-M4 swap to a
 *   Postgres-backed adapter (B.22) requires zero changes here — the
 *   construction site re-points the concrete impls. Mirrors the
 *   `FsHandoffStore` → `PostgresHandoffStore` trajectory (E.t2 / E.12).
 *
 * Out of scope (per Tier 3 brief):
 *   - Client-side rehydration (D.t9-mount-rehydrate).
 *   - Real ADK session-event-replay against a live runner (the existing
 *     translator fixture pattern proves event-shape → parts-shape under
 *     heavy fixture loads).
 *   - New shared types in @swoop/common (the existing `MessagePart` union
 *     covers the response payload; only `events.ts` grows).
 *   - Real Postgres-backed session write. That's B.22, post-M4.
 *
 * CORS: the global `corsMiddleware` in `server/index.ts` already emits
 * `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS` so GET
 * preflights against this route succeed without any new wiring.
 */

import type { Request, Response } from 'express';
import type { BaseSessionService } from '@google/adk';
import { emitEvent, type MessagePart } from '@swoop/common';

import { canAcceptTurn, type SessionStore } from '../session/index.js';
import { translateAdkStream } from '../translator/index.js';
import type { AdkEvent } from '../translator/index.js';
import { sendError } from './errors.js';

export interface SessionHistoryDeps {
  /**
   * Puma's session store — the same `Map`-backed (or future Postgres-backed)
   * instance the consent gate and `/chat` use. Used as the authoritative
   * existence check.
   */
  readonly sessionStore: SessionStore;
  /**
   * The ADK session service the runner uses to persist events. Same
   * instance `runner.sessionService` exposes; the entry point passes it
   * through here so we don't re-derive it from `runner` at request time.
   */
  readonly sessionService: BaseSessionService;
  /** ADK app name keying. Defaults to the orchestrator's fixed app name. */
  readonly appName?: string;
  /** ADK user id keying. Defaults to the anonymous Phase 1 user id. */
  readonly userId?: string;
  /**
   * Clock injection for tests. Passed through to the translator's `<fyi>`
   * timestamps and used for the `durationMs` field on `session.rehydrated`.
   */
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

    const startedAt = now().getTime();

    // Gate 1: Puma-side existence check. `SessionStore.get` returns null for
    // both unknown and deleted ids; archived sessions still come back as
    // non-null (matching `/session/:id/ping`'s D.16 conflation behaviour).
    // The 404 here is what trips the client's "expired conversation" UX.
    const pumaSession = await deps.sessionStore.get(sessionId);
    if (!pumaSession) {
      emitSessionExpired(sessionId, 'puma', now);
      sendError(res, 404, 'session_not_found', `no session with id ${sessionId}`);
      return;
    }

    // Gate 2: consent — a session can exist but have consent ungranted in
    // the very narrow window between `POST /session` succeeding and the
    // consent PATCH landing. The UI never has a session id in storage at
    // that point in practice; defence-in-depth catches the race anyway.
    // No state has accumulated pre-consent (the orchestrator refuses
    // /chat turns without it), so a 404 is the right verdict here too.
    if (!canAcceptTurn(pumaSession)) {
      emitSessionExpired(sessionId, 'consent', now);
      sendError(res, 404, 'session_not_found', `no session with id ${sessionId}`);
      return;
    }

    // Gate 3: ADK-side event log fetch. If the Puma session exists but the
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
      emitSessionReplayFailed(sessionId, 'adk_fetch', message, now);
      sendError(
        res,
        500,
        'internal_error',
        `failed to load session events: ${message}`,
      );
      return;
    }

    if (!adkSession) {
      emitSessionExpired(sessionId, 'adk', now);
      sendError(res, 404, 'session_not_found', `no session with id ${sessionId}`);
      return;
    }

    // Wrap the recorded ADK events as an async iterable so the existing
    // translator pipeline consumes them unchanged. The translator strips
    // reasoning parts unconditionally (chunk B §2.4 invariant); we don't
    // pass an `onFiltered` sink because rehydration is read-only — the
    // reasoning parts are already persisted in the ADK event log, no
    // re-persist needed.
    const events = (adkSession.events ?? []) as readonly AdkEvent[];
    const parts: MessagePart[] = [];
    try {
      for await (const part of translateAdkStream(asAsyncIterable(events), { now })) {
        parts.push(part);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitSessionReplayFailed(sessionId, 'translator', message, now);
      sendError(
        res,
        500,
        'internal_error',
        `failed to translate session events: ${message}`,
      );
      return;
    }

    const durationMs = Math.max(0, now().getTime() - startedAt);
    if (parts.length === 0) {
      emitEvent({
        eventType: 'session.replay.empty',
        eventVersion: 1,
        timestamp: now().toISOString(),
        sessionId,
        turnIndex: null,
        actor: 'system',
        payload: { eventCount: events.length },
      });
    } else {
      emitEvent({
        eventType: 'session.rehydrated',
        eventVersion: 1,
        timestamp: now().toISOString(),
        sessionId,
        turnIndex: null,
        actor: 'system',
        payload: {
          partCount: parts.length,
          eventCount: events.length,
          durationMs,
        },
      });
    }

    res.status(200).json({ parts });
  };
}

/**
 * Adapt an `Event[]` into an `AsyncIterable<AdkEvent>` so the existing
 * translator (which consumes `for await ... of source`) can run over a
 * recorded log without modification.
 */
async function* asAsyncIterable(
  events: readonly AdkEvent[],
): AsyncIterable<AdkEvent> {
  for (const event of events) {
    yield event;
  }
}

function emitSessionExpired(
  sessionId: string,
  gate: 'puma' | 'adk' | 'consent',
  now: () => Date,
): void {
  emitEvent({
    eventType: 'session.expired',
    eventVersion: 1,
    timestamp: now().toISOString(),
    sessionId,
    turnIndex: null,
    actor: 'system',
    payload: { gate },
  });
}

function emitSessionReplayFailed(
  sessionId: string,
  stage: 'adk_fetch' | 'translator',
  errorMessage: string,
  now: () => Date,
): void {
  emitEvent({
    eventType: 'session.replay.failed',
    eventVersion: 1,
    timestamp: now().toISOString(),
    sessionId,
    turnIndex: null,
    actor: 'system',
    payload: {
      stage,
      // Match the standardised 500-char slice used elsewhere
      // (`emitErrorRaised` H2 helper). Keeps log lines bounded.
      errorMessage: errorMessage.slice(0, 500),
    },
  });
}
