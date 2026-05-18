/**
 * Thin HTTP client over Puma's orchestrator (B.t5 endpoints).
 *
 * Three responsibilities:
 *   1. `createSession()` — POST /session → { sessionId, disclosureCopyVersion }.
 *   2. `grantConsent()`  — PATCH /session/:id/consent with { granted, copyVersion }.
 *   3. `sendMessage()`   — POST /chat, consume the SSE stream, aggregate utter
 *      text + tool-call records + per-part structural counts, return the
 *      aggregated payload for assertions.
 *
 * Session deletion is intentionally omitted: the orchestrator's idle sweeper
 * eventually cleans up, and each scenario starts a fresh session anyway.
 *
 * Error handling: every method throws on non-2xx. The runner catches and
 * records the failure against the scenario; the CLI itself never crashes on a
 * single scenario failure (per H.13 non-gating posture).
 *
 * H.t3 extends the response shape with `toolCalls: CapturedToolCall[]` and
 * `structure: TurnStructure` so the new assertion handlers have what they
 * need without re-parsing the SSE.
 */

import { messageOf, parseSseFrames } from '@swoop/common';

import { envelope } from './events.js';
import type { ObservabilityContext } from './events.js';

// Re-export so callers that imported ObservabilityContext from this module
// don't break. New code should import from `./events.js` directly.
export type { ObservabilityContext } from './events.js';

const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_TURN_TIMEOUT_MS = 180_000;

export interface OrchestratorSession {
  readonly sessionId: string;
  readonly disclosureCopyVersion: string;
}

/**
 * Per-turn structural counts, by SSE part type.
 * - `utterPartCount`     — `text` parts (the visible utterance fragments).
 * - `fyiPartCount`       — `data-fyi` parts (status affordances).
 * - `reasoningPartCount` — should always be zero (B.t4 invariant: reasoning
 *                          is filtered server-side). Counted defensively so
 *                          `response_format` assertions can sanity-check the
 *                          invariant still holds.
 * - `toolCallCount`      — `tool-call` parts.
 */
export interface TurnStructure {
  readonly utterPartCount: number;
  readonly fyiPartCount: number;
  readonly reasoningPartCount: number;
  readonly toolCallCount: number;
}

export interface CapturedToolCall {
  /** 1-indexed turn this call belongs to. The runner sets this. */
  readonly turnIndex: number;
  readonly toolName: string;
  readonly input: unknown;
}

export interface AggregatedResponse {
  /** Concatenation of all `text` parts delivered during the turn. */
  readonly utterText: string;
  /** Tool-call records lifted from the SSE stream (without `turnIndex`). */
  readonly toolCalls: readonly RawToolCall[];
  /** Structural counts for the turn (for `response_format` assertions). */
  readonly structure: TurnStructure;
  /** Every raw MessagePart observed on the wire (for debugging / H.t3). */
  readonly rawParts: readonly unknown[];
}

/**
 * Tool-call record at the SSE-consumer layer — turn index is stamped at the
 * runner level (since the client doesn't know which turn-of-N this is).
 */
export interface RawToolCall {
  readonly toolName: string;
  readonly input: unknown;
}

export interface OrchestratorClientOptions {
  readonly baseUrl?: string;
  /**
   * Turn timeout in ms. Puma turns are typically 3–10s but agent-as-user
   * scenarios with long Dreamer turns occasionally hit 30–60s; 180s leaves
   * comfortable headroom. Configurable via the CLI's `--turn-timeout-ms` flag.
   */
  readonly turnTimeoutMs?: number;
}

export class OrchestratorClient {
  private readonly baseUrl: string;
  private readonly turnTimeoutMs: number;

  constructor(opts: OrchestratorClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.turnTimeoutMs = opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  }

  async createSession(): Promise<OrchestratorSession> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      throw new Error(
        `POST /session failed: ${res.status} ${res.statusText} — ${await safeBody(res)}`,
      );
    }
    const json = (await res.json()) as {
      sessionId?: unknown;
      disclosureCopyVersion?: unknown;
    };
    if (
      typeof json.sessionId !== 'string' ||
      typeof json.disclosureCopyVersion !== 'string'
    ) {
      throw new Error(
        `POST /session returned unexpected shape: ${JSON.stringify(json)}`,
      );
    }
    return {
      sessionId: json.sessionId,
      disclosureCopyVersion: json.disclosureCopyVersion,
    };
  }

  async grantConsent(
    sessionId: string,
    copyVersion: string,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/session/${encodeURIComponent(sessionId)}/consent`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granted: true, copyVersion }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `PATCH /session/:id/consent failed: ${res.status} ${res.statusText} — ${await safeBody(res)}`,
      );
    }
  }

  async sendMessage(
    sessionId: string,
    message: string,
    observability?: ObservabilityContext,
  ): Promise<AggregatedResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.turnTimeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({ sessionId, message }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const reason = messageOf(err);
      if (timedOut && observability) {
        observability.sink.emit({
          kind: 'timeout',
          ...envelope(observability.scenarioName, observability.turnIndex),
          phase: 'turn-fetch',
          timeoutMs: this.turnTimeoutMs,
        });
      }
      throw new Error(`POST /chat fetch failed: ${reason}`);
    }

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      throw new Error(
        `POST /chat failed: ${res.status} ${res.statusText} — ${await safeBody(res)}`,
      );
    }

    try {
      return await consumeSseStream(res.body, observability, startedAt);
    } catch (err) {
      // If the abort fired during stream consumption, the parser throws.
      // Emit a timeout event before re-throwing so the JSONL captures it.
      if (timedOut && observability) {
        observability.sink.emit({
          kind: 'timeout',
          ...envelope(observability.scenarioName, observability.turnIndex),
          phase: 'turn-stream',
          timeoutMs: this.turnTimeoutMs,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// SSE consumer. Puma's wire format:
//   `data: <MessagePart-json>\n\n`  for each part
//   `event: done\ndata: {}\n\n`     when the turn finishes cleanly
//   `event: error\ndata: {...}\n\n` for mid-stream faults
//
// Frame parsing is delegated to `@swoop/common`'s `parseSseFrames`
// (canonicalised by H5, planning/03-exec-crosscut-shared-sse-parser-fix.md).
// This loop keeps the harness-specific aggregation: utter-text concatenation,
// per-part-type counts, tool-call extraction.
// ---------------------------------------------------------------------------

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  observability: ObservabilityContext | undefined,
  startedAt: number,
): Promise<AggregatedResponse> {
  let utterText = '';
  let utterPartCount = 0;
  let fyiPartCount = 0;
  let reasoningPartCount = 0;
  const toolCalls: RawToolCall[] = [];
  const rawParts: unknown[] = [];
  let errored: string | null = null;

  function emitAggregated(abortReason?: string): void {
    if (!observability) return;
    observability.sink.emit({
      kind: 'agent.response.aggregated',
      ...envelope(observability.scenarioName, observability.turnIndex),
      utterText,
      toolCalls: toolCalls.map((tc) => ({
        toolName: tc.toolName,
        input: tc.input,
      })),
      structure: {
        utterPartCount,
        fyiPartCount,
        reasoningPartCount,
        toolCallCount: toolCalls.length,
      },
      durationMs: Date.now() - startedAt,
      ...(abortReason !== undefined ? { abortReason } : {}),
    });
  }

  for await (const frame of parseSseFrames(body)) {
    // Per-frame emit — verbatim raw plus parsed convenience fields.
    if (observability) {
      const conv: {
        partType?: string;
        text?: string;
        toolName?: string;
        toolInput?: unknown;
        fyiData?: unknown;
      } = {};
      if (frame.event === null && frame.data.length > 0) {
        try {
          const part = JSON.parse(frame.data) as {
            type?: unknown;
            text?: unknown;
            toolName?: unknown;
            input?: unknown;
          };
          if (typeof part?.type === 'string') {
            conv.partType = part.type;
            if (part.type === 'text' && typeof part.text === 'string') {
              conv.text = part.text;
            } else if (part.type === 'tool-call') {
              if (typeof part.toolName === 'string') conv.toolName = part.toolName;
              conv.toolInput = part.input;
            } else if (part.type === 'data-fyi') {
              conv.fyiData = part;
            }
          }
        } catch {
          // Malformed; skip convenience fields. Raw still flows.
        }
      }
      observability.sink.emit({
        kind: 'agent.sse.frame',
        ...envelope(observability.scenarioName, observability.turnIndex),
        frameEvent: frame.event,
        frameData: frame.data,
        ...conv,
      });
    }

    if (frame.event === 'done') {
      // Clean end of turn.
      const result: AggregatedResponse = {
        utterText,
        toolCalls,
        structure: {
          utterPartCount,
          fyiPartCount,
          reasoningPartCount,
          toolCallCount: toolCalls.length,
        },
        rawParts,
      };
      emitAggregated();
      return result;
    }
    if (frame.event === 'error') {
      errored = frame.data;
      break;
    }

    // Default: `data:` line is a MessagePart JSON. (Frames emitted by the
    // canonical parser preserve null for the absent `event:` field; the
    // orchestrator only emits `event:` for `done`/`error`.)
    if (frame.data.length === 0) continue;
    try {
      const part = JSON.parse(frame.data) as { type?: unknown };
      rawParts.push(part);
      if (
        typeof part === 'object' &&
        part !== null &&
        typeof (part as { type?: unknown }).type === 'string'
      ) {
        const typed = part as {
          type: string;
          text?: unknown;
          toolName?: unknown;
          input?: unknown;
        };
        if (typed.type === 'text' && typeof typed.text === 'string') {
          utterText += typed.text;
          utterPartCount += 1;
        } else if (typed.type === 'data-fyi') {
          fyiPartCount += 1;
        } else if (typed.type === 'reasoning') {
          // Should never happen — B.t4 invariant. Counted so the
          // `response_format` assertion can flag it loudly.
          reasoningPartCount += 1;
        } else if (typed.type === 'tool-call') {
          toolCalls.push({
            toolName: typeof typed.toolName === 'string' ? typed.toolName : '<unknown>',
            input: typed.input,
          });
        }
      }
    } catch {
      // Malformed JSON on the wire — ignore.
    }
  }

  if (errored) {
    emitAggregated(`sse-error-frame: ${errored}`);
    throw new Error(`SSE error frame from /chat: ${errored}`);
  }

  // Stream ended without an explicit `done` event — return what we have.
  emitAggregated('stream-ended-without-done');
  return {
    utterText,
    toolCalls,
    structure: {
      utterPartCount,
      fyiPartCount,
      reasoningPartCount,
      toolCallCount: toolCalls.length,
    },
    rawParts,
  };
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return '<body unreadable>';
  }
}
