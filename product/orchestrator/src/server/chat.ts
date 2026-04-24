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
 *   - Client disconnect: `req.on('close')` aborts the agent turn via an
 *     `AbortController` threaded through the Runner.
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
import { emitEvent } from '@swoop/common';
import type {
  MessagePart,
  ReasoningPart,
  SessionState,
  ConversationEntry,
} from '@swoop/common';

import type { SessionStore } from '../session/index.js';
import { canAcceptTurn } from '../session/index.js';
import { translateAdkStream } from '../translator/index.js';
import { sendError, writeSseError } from './errors.js';
import { startHeartbeat } from './heartbeat.js';
import type { TriageClassifier } from '../functional-agents/triage-classifier.js';
import { applyTriageVerdict } from '../functional-agents/triage-classifier.js';

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
}

const DEFAULT_USER_ID = 'anonymous';

export function createChatHandler(
  deps: ChatDeps,
): (req: Request, res: Response) => Promise<void> {
  const userId = deps.userId ?? DEFAULT_USER_ID;
  const now = deps.now ?? (() => new Date());

  return async function handleChat(req, res) {
    const body = req.body as { sessionId?: unknown; message?: unknown } | undefined;
    const sessionId = body?.sessionId;
    const message = body?.message;

    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sendError(res, 400, 'invalid_request', '`sessionId` is required.');
      return;
    }
    if (typeof message !== 'string') {
      sendError(res, 400, 'invalid_request', '`message` must be a string.');
      return;
    }
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
    if (deps.triageClassifier) {
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
        emitEvent({
          eventType: 'error.raised',
          eventVersion: 1,
          timestamp: now().toISOString(),
          sessionId,
          turnIndex: userTurnIndex,
          actor: 'system',
          payload: {
            errorType: 'triage_classifier_failed',
            chunk: 'B',
            sanitisedContext:
              (err instanceof Error ? err.message : String(err)).slice(0, 500),
          },
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
    const abortController = new AbortController();
    let closed = false;
    const onClientClose = (): void => {
      if (closed) return;
      closed = true;
      abortController.abort();
    };
    req.on('close', onClientClose);

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

    try {
      const adkStream = runAgentTurn({
        runner: deps.runner,
        userId,
        sessionId,
        message,
        abortSignal: abortController.signal,
      });

      for await (const part of translateAdkStream(adkStream, {
        onFiltered: onFilteredTallying,
        now,
      })) {
        if (closed) break;
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
      const message = err instanceof Error ? err.message : String(err);
      if (!closed) {
        writeSseError(res, 'internal_error', message);
      }
      emitEvent({
        eventType: 'error.raised',
        eventVersion: 1,
        timestamp: now().toISOString(),
        sessionId,
        turnIndex: userTurnIndex,
        actor: 'system',
        payload: {
          errorType: 'chat_turn_failed',
          chunk: 'B',
          sanitisedContext: message.slice(0, 500),
        },
      });
    } finally {
      stopHeartbeat();
      req.off('close', onClientClose);
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
  abortSignal: AbortSignal;
}): AsyncIterable<AdkEvent> {
  const newMessage: Content = {
    role: 'user',
    parts: [{ text: params.message }],
  };
  return params.runner.runAsync({
    userId: params.userId,
    sessionId: params.sessionId,
    newMessage,
    abortSignal: params.abortSignal,
  });
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
