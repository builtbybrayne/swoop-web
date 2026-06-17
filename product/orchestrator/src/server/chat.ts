/**
 * `POST /chat` — SSE streaming chat endpoint (B.t5).
 *
 * Wire-level contract (planning/02-impl-agent-runtime.md §2.5 + §2.5a):
 *   - Request body: `{ sessionId: string, message: string }`.
 *   - Response: `text/event-stream`. One `data:` line per `message.parts`
 *     translator output; terminating `event: done`; mid-stream faults
 *     become `event: error`.
 *   - Consent gate runs BEFORE any agent work starts (canAcceptTurn from
 *     B.t2). 403 with `consent_required` if tier-1 is unset.
 *   - Client disconnect: `res.on('close')` aborts the agent turn via an
 *     `AbortController` threaded through the Runner. (Express 5 emits
 *     `close` on the `req` immediately after the body parser drains the
 *     incoming stream — which happens before this handler runs — so
 *     listening on `res` is the only reliable way to observe the
 *     downstream socket actually going away mid-stream.)
 *   - Reasoning parts: stripped from the SSE wire by the translator's
 *     `filterReasoning`, persisted to session history via `onFiltered`
 *     (chunk B §2.6 invariant).
 *
 * What is intentionally missing:
 *   - Rate limiting (B.t5 scope: "no auth"; 429 shape reserved for later).
 *   - Warm pool hydration (B.t10).
 *   - Observability events (chunk F).
 */

import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import type { Content } from '@google/genai';
import type { Runner, Event as AdkEvent } from '@google/adk';
import { ChatRequestSchema, emitErrorRaised, emitEvent, messageOf } from '@swoop/common';
import type {
  MessagePart,
  ReasoningPart,
  SessionState,
  ConversationEntry,
  StaffAuthenticator,
} from '@swoop/common';

import type { SessionStore } from '../session/index.js';
import { canAcceptTurn } from '../session/index.js';
import { translateAdkStream } from '../translator/index.js';
import { sendError, writeSseError } from './errors.js';
import { startHeartbeat } from './heartbeat.js';
import type { TriageClassifier } from '../functional-agents/triage-classifier.js';
import { applyTriageVerdict } from '../functional-agents/triage-classifier.js';
import { isExplicitMemoryExit, isExplicitMemoryRequest } from './memory-mode.js';
import {
  FINISH_MEMORY_TOOL_NAME,
  MEMORY_AGENT_USER_ID,
  buildTranscriptSummary,
  type BuildMemoryAgentResult,
} from '../agent/memory-agent.js';

export interface ChatDeps {
  readonly sessionStore: SessionStore;
  readonly runner: Runner;
  /** Per-Puma-session user id. ADK sessions are keyed on (appName, userId, sessionId). */
  readonly userId?: string;
  /** Clock injection for session history timestamps. */
  readonly now?: () => Date;
  /**
   * Origin for CORS. Populated in registerRoutes; per-handler use is only
   * for documenting that the Express-level middleware already checked.
   */
  readonly corsAllowedOrigins?: readonly string[];
  /**
   * Optional layer-2 pre-turn classifier (B.t7). When present, runs BEFORE
   * the orchestrator turn and writes its advisory verdict into
   * `session.triage`. Absence means unit tests that only exercise the HTTP
   * surface don't have to build the classifier.
   */
  readonly triageClassifier?: TriageClassifier;
  /**
   * Staff authenticator (staff-auth task). When present and the request
   * carries a `staffToken`, the token is re-validated each turn. On success,
   * `session.staff` + `session.mode` are refreshed. Failure → flags stay at
   * their current values (visitor session if never set). Optional — unit
   * tests that don't need auth don't have to supply it.
   */
  readonly staffAuthenticator?: StaffAuthenticator | null;
  /**
   * Memory-agent provider (T3-3 / sm-1). A factory that builds the Opus
   * memory agent bound to a specific staff session's validated token + name.
   *
   * Called ONLY on the staff + memory-mode path, ONLY after the staff token
   * has been validated this turn (the token + name are passed in). Absence
   * means the memory feature is not wired (visitor-only deploys, unit tests
   * of the conversational path) — a staff member who triggers memory mode
   * without a provider gets a graceful fallback to the conversational agent.
   *
   * The factory shape (not a prebuilt agent) is deliberate: the staff token
   * is bound into the connector memory tools at build time (sm-4 dual
   * backstop), and the token is per-session, so the agent must be built
   * per memory-mode entry with the current turn's validated token.
   */
  readonly memoryAgentProvider?: MemoryAgentProvider;
}

/**
 * Factory that builds the Opus memory agent for one staff memory session.
 *
 * The orchestrator entry point (src/index.ts) supplies a closure that calls
 * `buildMemoryAgent` with the shared config + prompt loader + connector
 * client, injecting the per-turn validated `staffToken` + `staffName`.
 *
 * Returns `null` when the memory agent cannot be built (e.g. connector
 * unavailable) so the handler falls back to the conversational agent rather
 * than erroring the staff member's turn.
 */
export type MemoryAgentProvider = (params: {
  readonly staffToken: string;
  readonly staffName: string;
}) => BuildMemoryAgentResult | null;

const DEFAULT_USER_ID = 'anonymous';

export function createChatHandler(
  deps: ChatDeps,
): (req: Request, res: Response) => Promise<void> {
  const userId = deps.userId ?? DEFAULT_USER_ID;
  const now = deps.now ?? (() => new Date());

  return async function handleChat(req, res) {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      sendError(res, 400, 'invalid_request', detail);
      return;
    }
    const { sessionId, message, clientTime, staffToken } = parsed.data;
    if (message.trim().length === 0) {
      sendError(res, 400, 'message_empty', 'message cannot be empty.');
      return;
    }

    const session = await deps.sessionStore.get(sessionId);
    if (!session) {
      sendError(res, 404, 'session_not_found', `no session with id ${sessionId}`);
      return;
    }
    if (!canAcceptTurn(session)) {
      sendError(
        res,
        403,
        'consent_required',
        'tier-1 conversation consent is required before chat turns are accepted.',
      );
      return;
    }

    // B.t12 — store latest visitor clock. Additive update: existing sessions
    // without clientTime round-trip cleanly; new requests overwrite with the
    // freshest value. Store before anything else so the dateline is always
    // available from session state if we ever need it post-turn.
    if (clientTime) {
      await deps.sessionStore.update(sessionId, (s) => ({
        ...s,
        clientTime,
      }));
    }

    // staff-auth — re-validate the staff JWT on every /chat turn so a revoked
    // or expired token is caught promptly, not just at session bootstrap.
    // Failure (invalid/expired/absent) → session keeps its current staff/mode
    // values (visitor defaults if never set). Never blocks the turn — staff
    // auth is advisory routing infrastructure, not a hard gate. The only hard
    // gate is tier-1 consent (canAcceptTurn above).
    //
    // T3-3 — the validated `name` claim is captured here for memory-agent
    // attribution + memory-mode routing. `isStaffThisTurn` gates ALL memory
    // routing below: a turn is only ever routed to the memory agent when the
    // staff token validated THIS turn. We never trust a persisted `staff`
    // flag alone for routing — the live token is the trust boundary (sm-4).
    let isStaffThisTurn = false;
    let staffName = '';
    if (staffToken && deps.staffAuthenticator) {
      try {
        const verifyResult = await deps.staffAuthenticator.verify(staffToken);
        if (verifyResult.ok) {
          isStaffThisTurn = true;
          staffName = verifyResult.name;
          await deps.sessionStore.update(sessionId, (s) => ({
            ...s,
            staff: true,
            mode: s.mode ?? ('conversation' as const),
          }));
        }
      } catch {
        // Degrade gracefully — turn proceeds as visitor session.
      }
    }

    // T3-3 — memory-mode transitions (sm-3): staff-only, explicit-only, never
    // inferred and never available to visitors (all gated on isStaffThisTurn).
    //   • ENTRY: an explicit memory-management request flips mode to 'memory'.
    //     The confirm-before-write step inside the memory agent is the safety
    //     net against a false-positive trigger — nothing is persisted without
    //     an explicit staff confirmation.
    //   • HARD EXIT (backstop): when already in 'memory' mode, an explicit
    //     "leave memory mode" phrase flips back to 'conversation' EVEN IF the
    //     memory agent never emitted `finish_memory`. This is the deterministic
    //     complement to that (softer) agent-driven handback, so a staff member
    //     can never get wedged in memory mode. Exit wins over entry this turn.
    //
    // Once in 'memory' mode the session stays there across turns (multi-turn
    // authoring) until finish_memory (stream loop below) or a hard exit here.
    if (isStaffThisTurn) {
      if (session.mode === 'memory' && isExplicitMemoryExit(message)) {
        await deps.sessionStore.update(sessionId, (s) => ({
          ...s,
          mode: 'conversation' as const,
        }));
      } else if (isExplicitMemoryRequest(message)) {
        await deps.sessionStore.update(sessionId, (s) => ({
          ...s,
          mode: 'memory' as const,
        }));
      }
    }

    // Re-read the (possibly mode-flipped) session so the routing decision below
    // sees the freshest mode value.
    const routingSession = (await deps.sessionStore.get(sessionId)) ?? session;

    // T3-3 — the binding routing decision. A turn routes to the memory agent
    // ONLY when ALL of these hold:
    //   1. The staff token validated THIS turn (isStaffThisTurn).
    //   2. The session is in 'memory' mode.
    //   3. A memory-agent provider is wired.
    // A visitor session can satisfy none of these — it is BYTE-IDENTICAL to
    // today's path. This is the Sacred Invariant in code.
    const routeToMemory =
      isStaffThisTurn &&
      routingSession.mode === 'memory' &&
      deps.memoryAgentProvider !== undefined;

    // B.t12 — build a per-turn dateline for injection into the user-message
    // envelope. The dateline must NOT go into the system prompt — the system
    // prompt block carries cache_control: ephemeral (Perf-1); a changing
    // dateline there would bust the Anthropic prompt cache every turn.
    // Placing it as a prefix line on the user message achieves the same
    // grounding effect while leaving the cached prefix untouched.
    // Decision B.poincare-1.
    const dateline = buildDateline(clientTime ?? null, now());

    // Append the user message to history up front. If the agent turn fails
    // mid-stream, the user side is still recorded — we don't want to lose
    // what the visitor said just because the model errored.
    await appendUserMessage(deps.sessionStore, sessionId, message, now());

    // Turn index the user message landed at. Used for every per-turn event
    // below so spot-checks can trace a turn's event sequence by (sessionId,
    // turnIndex).
    const userTurnIndex =
      ((await deps.sessionStore.get(sessionId))?.conversationHistory.length ?? 1) - 1;

    emitEvent({
      eventType: 'turn.received',
      eventVersion: 1,
      timestamp: now().toISOString(),
      sessionId,
      turnIndex: userTurnIndex,
      actor: 'user',
      payload: {
        userMessageLength: message.length,
        userMessageSha256: createHash('sha256').update(message).digest('hex'),
      },
    });

    const turnStartedAt = now().getTime();

    // Pre-turn triage classification (B.t7). A layer-2 ADK agent running on
    // a different model from the orchestrator (Haiku vs Sonnet) tags the
    // visitor posture into `session.triage`. Advisory only — the
    // orchestrator's prompt can read the verdict but makes its own call.
    // Failures are logged and swallowed; classification is non-critical
    // infra and must never block the user's turn.
    //
    // Perf-3 (2026-04-30 review) — skip the classifier on turn 1
    // (`userTurnIndex === 0`). Turn-1 messages are typically one-line
    // greetings; the placeholder classifier produces no behaviour change
    // but pays Haiku TTFB on every first impression. The verdict from turn
    // N is still written into `session.triage` and remains available on
    // turn N+1 — we just stop paying the latency cost when there is no
    // prior turn to weigh against.
    if (deps.triageClassifier && userTurnIndex > 0) {
      try {
        const sessionAfterUser = await deps.sessionStore.get(sessionId);
        if (sessionAfterUser) {
          const classifyResult = await deps.triageClassifier.classify(
            message,
            sessionAfterUser,
          );
          const updated = await deps.sessionStore.update(sessionId, (s) =>
            applyTriageVerdict({ session: s, result: classifyResult, now: now() }),
          );
          if (updated.triage.verdict !== 'none') {
            emitEvent({
              eventType: 'triage.decided',
              eventVersion: 1,
              timestamp: now().toISOString(),
              sessionId,
              turnIndex: userTurnIndex,
              actor: 'agent',
              payload: {
                verdict: updated.triage.verdict,
                reasonCode: updated.triage.reasonCode,
                reasonText: updated.triage.reasonText,
              },
            });
          }
        }
      } catch (err) {
        emitErrorRaised({
          sessionId,
          turnIndex: userTurnIndex,
          actor: 'system',
          errorType: 'triage_classifier_failed',
          chunk: 'B',
          err,
          now,
        });
      }
    }

    // Open the SSE stream. Once headers are flushed, every failure mode is
    // "emit error event, then close" — never a second HTTP status.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // defeat nginx buffering
    res.flushHeaders?.();

    const stopHeartbeat = startHeartbeat(res);

    // Abort plumbing: client disconnect cancels the agent turn cleanly.
    // Listen on `res.on('close')` rather than `req.on('close')`. Under
    // Express 5 + Node 20, `req` emits `close` as soon as the body parser
    // drains the request stream — which happens before this handler is
    // entered. Attaching the listener to `req` after that point would
    // therefore *never* fire on a real mid-stream disconnect. `res.close`
    // fires when the response socket actually goes away, which is the
    // signal we want.
    const abortController = new AbortController();
    let closed = false;
    const onClientClose = (): void => {
      if (closed) return;
      closed = true;
      abortController.abort();
    };
    res.on('close', onClientClose);

    // Turn-index for history entries: start at the current conversationHistory
    // length (user message just landed).
    let turnIndex = (await deps.sessionStore.get(sessionId))?.conversationHistory.length ?? 0;

    // onFiltered: reasoning parts never reach SSE; they persist in session
    // history so the model's next turn can see its own prior reasoning, and
    // so audit tooling has the full record (chunk B §2.6).
    const onFiltered = (part: MessagePart): void => {
      if (part.type !== 'reasoning') return;
      const reasoning = part as ReasoningPart;
      void appendToHistory(deps.sessionStore, sessionId, {
        turnIndex: turnIndex++,
        role: 'agent',
        blockType: 'reasoning',
        text: reasoning.text,
        timestamp: now().toISOString(),
      });
    };

    // Per-turn counters feeding turn.completed — block counts and cumulative
    // utter length let spot-checks tell "chatty turn" from "silent tool
    // orchestration" without parsing history.
    let utterLength = 0;
    let fyiCount = 0;
    let reasoningCount = 0;
    let adjunctCount = 0;

    // Track tool-call lifecycle so we can emit tool.called exactly once on
    // input-available and tool.returned exactly once on output-available,
    // with a per-call latency measurement.
    const toolCallStartedAt = new Map<string, number>();

    // Wrap onFiltered to tally reasoning parts for the turn.completed count.
    const onFilteredTallying = (part: MessagePart): void => {
      if (part.type === 'reasoning') reasoningCount += 1;
      onFiltered(part);
    };

    // T3-3 — flips true if the memory agent emitted `finish_memory` this turn.
    // After the stream drains we use it to write session.mode back to
    // 'conversation' so the NEXT turn returns to the conversational agent.
    let memoryHandbackRequested = false;

    try {
      // T3-3 — stream-source selection. The Sacred Invariant lives here: the
      // conversational `deps.runner` (Sonnet, public tools, production prompt)
      // is the default for EVERY turn. Only an authenticated staff turn that
      // has explicitly entered memory mode is diverted to the Opus memory
      // agent, in its OWN isolated session (sm-9). The visitor path never
      // reaches the `routeToMemory` branch.
      let adkStream: AsyncIterable<AdkEvent>;
      if (routeToMemory) {
        // `routeToMemory` implies `isStaffThisTurn`, which only becomes true
        // after a non-empty `staffToken` validated this turn — so the token is
        // present here. The non-null assertion encodes that invariant.
        adkStream = await runMemoryAgentTurn({
          provider: deps.memoryAgentProvider!,
          session: routingSession,
          staffToken: staffToken!,
          staffName,
          message,
          abortSignal: abortController.signal,
        });
      } else {
        adkStream = runAgentTurn({
          runner: deps.runner,
          userId,
          sessionId,
          message,
          dateline,
          abortSignal: abortController.signal,
        });
      }

      for await (const part of translateAdkStream(adkStream, {
        onFiltered: onFilteredTallying,
        now,
        // ClaudeLlm emits a consolidated non-partial copy of the assistant's
        // text at end-of-turn so ADK persists it to the session; the wire has
        // already received that text via the partial deltas, so drop the copy
        // here to avoid rendering the whole message twice.
        suppressNonPartialText: true,
      })) {
        if (closed) break;

        // T3-3 — finish_memory interception (sm-3 handback). The memory agent
        // emits a `finish_memory` tool call to signal it's done. This is an
        // orchestrator-internal control signal, NOT a connector tool — its
        // FunctionTool.execute is a no-op. We swallow the tool-call parts here
        // (never stream them to the wire, never count them as adjuncts, never
        // emit tool.called/tool.returned events) and record the handback so the
        // post-stream step flips session.mode back to 'conversation'. The
        // memory agent's natural-language wrap-up text still streams normally.
        if (part.type === 'tool-call' && part.toolName === FINISH_MEMORY_TOOL_NAME) {
          memoryHandbackRequested = true;
          continue;
        }

        writeSsePart(res, part);
        // Persist visible parts to history as they stream; errors are best-
        // effort, the SSE wire remains the source of truth for the client.
        void persistPart(deps.sessionStore, sessionId, part, turnIndex++, now());

        // Per-kind bookkeeping + per-tool-call events.
        if (part.type === 'text') {
          utterLength += part.text.length;
        } else if (part.type === 'data-fyi') {
          fyiCount += 1;
        } else if (part.type === 'tool-call') {
          if (part.state === 'input-available') {
            adjunctCount += 1;
            toolCallStartedAt.set(part.toolCallId, now().getTime());
            emitEvent({
              eventType: 'tool.called',
              eventVersion: 1,
              timestamp: now().toISOString(),
              sessionId,
              turnIndex: userTurnIndex,
              actor: 'agent',
              payload: {
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                inputSha256: createHash('sha256')
                  .update(safeStringify(part.input))
                  .digest('hex'),
              },
            });
          } else if (part.state === 'output-available') {
            const startedAt = toolCallStartedAt.get(part.toolCallId);
            const latencyMs =
              startedAt !== undefined
                ? Math.max(0, now().getTime() - startedAt)
                : 0;
            toolCallStartedAt.delete(part.toolCallId);
            const outputSize = safeStringify(part.output).length;
            emitEvent({
              eventType: 'tool.returned',
              eventVersion: 1,
              timestamp: now().toISOString(),
              sessionId,
              turnIndex: userTurnIndex,
              actor: 'connector',
              payload: {
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                outcome: part.isError === true ? 'error' : 'ok',
                latencyMs,
                outputSize,
              },
            });
          }
        }
      }

      // T3-3 — apply the memory handback (sm-3). The memory agent asked to
      // hand back to the conversational agent (emitted finish_memory), so flip
      // session.mode to 'conversation'. Done after the stream drains and
      // regardless of `closed` so the server-side mode is correct for the next
      // turn even if this turn's client disconnected mid-stream.
      if (memoryHandbackRequested) {
        await deps.sessionStore.update(sessionId, (s) => ({
          ...s,
          mode: 'conversation' as const,
        }));
      }

      if (!closed) {
        res.write('event: done\n');
        res.write('data: {}\n\n');
        emitEvent({
          eventType: 'turn.completed',
          eventVersion: 1,
          timestamp: now().toISOString(),
          sessionId,
          turnIndex: userTurnIndex,
          actor: 'agent',
          payload: {
            utterLength,
            fyiCount,
            reasoningCount,
            adjunctCount,
            latencyMs: Math.max(0, now().getTime() - turnStartedAt),
          },
        });
      }
    } catch (err) {
      const message = messageOf(err);
      if (!closed) {
        writeSseError(res, 'internal_error', message);
      }
      emitErrorRaised({
        sessionId,
        turnIndex: userTurnIndex,
        actor: 'system',
        errorType: 'chat_turn_failed',
        chunk: 'B',
        sanitisedContext: message,
        now,
      });
    } finally {
      stopHeartbeat();
      res.off('close', onClientClose);
      if (!res.writableEnded) {
        res.end();
      }
      // Diagnostic-only: cancelled turns are infrequent and noisy to log at
      // event level. Kept as a plain console line so local dev sees the
      // abort path without polluting the structured event stream.
      if (abortController.signal.aborted) {
        console.log(`[orchestrator] /chat turn cancelled (session=${sessionId}).`);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// SSE formatting — one `data:` line per part, JSON-encoded.
// ---------------------------------------------------------------------------

/**
 * JSON-stringify something that might contain circular references or bigints
 * without throwing. Used for deriving stable hashes + size counts for the
 * tool.called / tool.returned event payloads — a hash / length that falls
 * back to `""` on pathological input is fine; we never want observability to
 * bring down the turn loop.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function writeSsePart(res: Response, part: MessagePart): void {
  const payload = JSON.stringify(part);
  // Event type is implicit in the JSON's `type` field. Chunk D's parser
  // discriminates there; we don't also duplicate it as an SSE `event:`
  // header because that would force the client to register per-type
  // listeners unnecessarily.
  res.write(`data: ${payload}\n\n`);
}

// ---------------------------------------------------------------------------
// Runner invocation — abstract so tests can stub the agent without needing
// to stand up a full ADK Runner.
// ---------------------------------------------------------------------------

function runAgentTurn(params: {
  runner: Runner;
  userId: string;
  sessionId: string;
  message: string;
  /** B.t12 — per-turn dateline prepended to the user message content. */
  dateline: string;
  abortSignal: AbortSignal;
}): AsyncIterable<AdkEvent> {
  // B.t12 — inject the dateline as a context prefix on the user turn.
  // Using a separate text part keeps the visitor's raw message unmodified in
  // session history (appendUserMessage above already recorded the raw text);
  // only the ADK runner / Anthropic sees the combined envelope.
  const newMessage: Content = {
    role: 'user',
    parts: [
      { text: params.dateline },
      { text: params.message },
    ],
  };
  return params.runner.runAsync({
    userId: params.userId,
    sessionId: params.sessionId,
    newMessage,
    abortSignal: params.abortSignal,
  });
}

// ---------------------------------------------------------------------------
// T3-3 — Memory-agent turn invocation (sm-1, sm-9).
//
// Diverts a staff memory-mode turn to the Opus memory agent running in its OWN
// isolated InMemoryRunner session, seeded with the conversation transcript so
// the agent has context without polluting the conversational session's ADK
// event log. The staff message is run in the memory session; the returned ADK
// stream feeds the same translator + SSE wire as a normal turn, so the staff
// member sees the memory agent's response inline in the same chat window.
//
// The dateline is intentionally NOT injected here — memory authoring is not
// season/lead-time-sensitive, and the transcript seed already carries the
// relevant context.
// ---------------------------------------------------------------------------

async function runMemoryAgentTurn(params: {
  provider: MemoryAgentProvider;
  session: SessionState;
  staffToken: string;
  staffName: string;
  message: string;
  abortSignal: AbortSignal;
}): Promise<AsyncIterable<AdkEvent>> {
  // Build the memory agent bound to this staff session's validated token+name
  // (sm-4 — the token is bound into the connector memory tools at build time).
  const built = params.provider({
    staffToken: params.staffToken,
    staffName: params.staffName,
  });
  if (built === null) {
    // Provider couldn't build the agent (e.g. connector down). Surface a
    // single explanatory text part rather than erroring the staff turn. The
    // session stays in memory mode; the staff member can retry.
    return singleTextEventStream(
      "I can't reach memory management right now. Please try again in a moment.",
    );
  }

  // Seed a fresh isolated runner with the conversation transcript (sm-9).
  const transcriptSummary = buildTranscriptSummary(params.session.conversationHistory);
  const seeded = await built.createSeededRunner({
    sessionId: params.session.sessionId,
    transcriptSummary,
  });

  // Run the staff's actual memory instruction in the seeded memory session.
  const newMessage: Content = {
    role: 'user',
    parts: [{ text: params.message }],
  };
  return seeded.runner.runAsync({
    userId: MEMORY_AGENT_USER_ID,
    sessionId: seeded.sessionId,
    newMessage,
    abortSignal: params.abortSignal,
  });
}

/**
 * Build a one-event ADK stream carrying a single assistant text part. Used for
 * graceful fallbacks (e.g. the memory provider couldn't build an agent) so the
 * staff member sees an explanatory message on the normal SSE wire instead of an
 * error event.
 */
async function* singleTextEventStream(text: string): AsyncIterable<AdkEvent> {
  yield {
    content: { role: 'model', parts: [{ text }] },
  } as unknown as AdkEvent;
}

// ---------------------------------------------------------------------------
// B.t12 — Dateline builder.
//
// Produces a human-readable date context line injected into the user-message
// envelope on every turn. The line deliberately avoids the system prompt
// (which carries cache_control: ephemeral per Perf-1) so the Anthropic prompt
// cache is never busted by a per-turn clock value. Decision B.poincare-1.
//
// Format: "Current date for this visitor: Wednesday 10 June 2026 (Europe/London, 17:42 local)."
// Fallback (no clientTime): "Current date (server clock — visitor clock unavailable): Wednesday 10 June 2026 (UTC)."
// ---------------------------------------------------------------------------

/** Build the per-turn dateline string for injection into the user message. */
export function buildDateline(
  clientTime: { iso: string; timeZone: string } | null,
  serverNow: Date,
): string {
  if (clientTime) {
    try {
      const date = new Date(clientTime.iso);
      if (!Number.isNaN(date.getTime())) {
        const formatted = formatVisitorDate(date, clientTime.timeZone);
        return `Current date for this visitor: ${formatted}. Reason about seasons, lead times and "how far out" from this date.`;
      }
    } catch {
      // Fall through to server-clock fallback on any formatting failure.
    }
  }
  const formatted = formatVisitorDate(serverNow, 'UTC');
  return `Current date (server clock — visitor clock unavailable): ${formatted}. Reason about seasons, lead times and "how far out" from this date.`;
}

/** Format a Date in a given IANA timezone as a human-readable string. */
function formatVisitorDate(date: Date, timeZone: string): string {
  try {
    const dayName = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone });
    const day = date.toLocaleDateString('en-GB', { day: 'numeric', timeZone });
    const month = date.toLocaleDateString('en-GB', { month: 'long', timeZone });
    const year = date.toLocaleDateString('en-GB', { year: 'numeric', timeZone });
    const time = date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      hour12: false,
    });
    return `${dayName} ${day} ${month} ${year} (${timeZone}, ${time} local)`;
  } catch {
    // Unknown timezone — fall back to UTC ISO date only.
    return date.toISOString().slice(0, 10) + ' (UTC)';
  }
}

// ---------------------------------------------------------------------------
// Session history persistence helpers.
//
// We write the user's turn up front (pre-stream) and stream the agent's
// parts as they arrive. Reasoning parts are persisted separately via
// onFiltered. Tool-call parts are persisted under the `adjunct` block type.
// ---------------------------------------------------------------------------

async function appendUserMessage(
  store: SessionStore,
  sessionId: string,
  text: string,
  now: Date,
): Promise<void> {
  await store.update(sessionId, (s): SessionState => ({
    ...s,
    conversationHistory: [
      ...s.conversationHistory,
      {
        turnIndex: s.conversationHistory.length,
        role: 'user',
        blockType: 'user_message',
        text,
        timestamp: now.toISOString(),
      },
    ],
  }));
}

async function appendToHistory(
  store: SessionStore,
  sessionId: string,
  entry: ConversationEntry,
): Promise<void> {
  await store.update(sessionId, (s): SessionState => ({
    ...s,
    conversationHistory: [...s.conversationHistory, entry],
  }));
}

async function persistPart(
  store: SessionStore,
  sessionId: string,
  part: MessagePart,
  turnIndex: number,
  now: Date,
): Promise<void> {
  const entry = partToHistoryEntry(part, turnIndex, now);
  if (!entry) return;
  await appendToHistory(store, sessionId, entry);
}

function partToHistoryEntry(
  part: MessagePart,
  turnIndex: number,
  now: Date,
): ConversationEntry | undefined {
  switch (part.type) {
    case 'text':
      if (part.text.length === 0) return undefined;
      return {
        turnIndex,
        role: 'agent',
        blockType: 'utter',
        text: part.text,
        timestamp: now.toISOString(),
      };
    case 'data-fyi':
      return {
        turnIndex,
        role: 'agent',
        blockType: 'fyi',
        text: part.data.message,
        timestamp: now.toISOString(),
      };
    case 'tool-call':
      return {
        turnIndex,
        role: 'agent',
        blockType: 'adjunct',
        text: `${part.toolName}:${part.state}`,
        timestamp: now.toISOString(),
      };
    case 'reasoning':
      // Should be stripped by filterReasoning before it ever reaches here;
      // defensive — persist just in case.
      return {
        turnIndex,
        role: 'agent',
        blockType: 'reasoning',
        text: part.text,
        timestamp: now.toISOString(),
      };
    default:
      return undefined;
  }
}
