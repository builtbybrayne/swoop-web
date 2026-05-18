/**
 * HarnessEvent + EventSink — per-event observability for harness runs.
 *
 * Defect this exists to fix: today's harness writes results to disk only at
 * end-of-run. A killed/crashed/timed-out run loses every transcript in
 * memory. This module enables per-event streaming: every observable signal
 * (SSE frames, Anthropic calls, assertions, errors) is appended to a
 * per-scenario JSONL file the instant it happens.
 *
 * Plan: planning/03-exec-h-t8-streaming-fix.md (HITL-ratified 2026-05-18).
 *
 * Naming: this module is NOT to be confused with `event-capture.ts` in the
 * same directory. That captures the ORCHESTRATOR's emitted F-a events
 * (`handoff.submitted`, `triage.decided`, etc.) for assertion evaluation.
 * THIS module captures the HARNESS's own internal events (SSE frames coming
 * in, Anthropic calls going out, assertions evaluating, errors thrown).
 * Different surfaces, different lifetimes.
 */

import { appendFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Common envelope.
// ---------------------------------------------------------------------------

export interface EventEnvelope {
  /** ISO 8601 timestamp with millisecond precision. */
  readonly ts: string;
  /** Scenario this event belongs to. */
  readonly scenarioName: string;
  /** Optional 1-indexed turn number when the event happened mid-conversation. */
  readonly turnIndex?: number;
}

/** Build an envelope at "now". Spread into event literals at call sites.
 *
 * Overloaded: when `turnIndex` is supplied the return type includes it as
 * required (`number`), which is what turn-scoped events need. Without it the
 * return type omits the field — compatible with scenario-level events that
 * have no turnIndex (`scenario.started`, `session.created`, etc).
 */
export function envelope(
  scenarioName: string,
): { readonly ts: string; readonly scenarioName: string };
export function envelope(
  scenarioName: string,
  turnIndex: number,
): { readonly ts: string; readonly scenarioName: string; readonly turnIndex: number };
export function envelope(
  scenarioName: string,
  turnIndex?: number,
): EventEnvelope {
  return {
    ts: new Date().toISOString(),
    scenarioName,
    ...(turnIndex !== undefined ? { turnIndex } : {}),
  };
}

// ---------------------------------------------------------------------------
// Event kinds — discriminated union over `kind`.
//
// One interface per kind. Every field is `readonly`. Field naming follows the
// dotted-namespace convention (`agent.sse.frame`, `stop_judge.invoked` etc).
// ---------------------------------------------------------------------------

export interface ScenarioStartedEvent extends EventEnvelope {
  readonly kind: 'scenario.started';
  readonly file: string;
  readonly scenarioShape: 'scripted' | 'agent';
  /** When shape === 'agent', the userAgent block from the scenario YAML. */
  readonly userAgentSpec?: unknown;
}

export interface SessionCreatedEvent extends EventEnvelope {
  readonly kind: 'session.created';
  readonly sessionId: string;
  readonly disclosureCopyVersion: string;
}

export interface ConsentGrantedEvent extends EventEnvelope {
  readonly kind: 'consent.granted';
  readonly sessionId: string;
  readonly copyVersion: string;
}

export interface UserAgentInvokedEvent extends EventEnvelope {
  readonly kind: 'user_agent.invoked';
  readonly turnIndex: number;
  readonly persona: string;
  readonly goal: string;
  readonly transcriptSoFar: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  readonly model: string;
}

export interface UserAgentRespondedEvent extends EventEnvelope {
  readonly kind: 'user_agent.responded';
  readonly turnIndex: number;
  readonly message: string;
  readonly durationMs: number;
  /** Full Anthropic messages.create response — raw. Per Alastair's "RAW and EVERYTHING". */
  readonly anthropicRaw: unknown;
}

export interface UserMessageSentEvent extends EventEnvelope {
  readonly kind: 'user.message.sent';
  readonly turnIndex: number;
  readonly sessionId: string;
  readonly message: string;
}

export interface AgentSseFrameEvent extends EventEnvelope {
  readonly kind: 'agent.sse.frame';
  readonly turnIndex: number;
  /** Raw SSE `event:` field (e.g. "done", "error", or null for default `data:`-only frames). */
  readonly frameEvent: string | null;
  /** Raw SSE `data:` field — verbatim JSON string from the wire. */
  readonly frameData: string;
  /**
   * Convenience: parsed `part.type` when frame is a data part with a
   * recognizable MessagePart payload. Undefined for terminal frames or
   * malformed JSON.
   */
  readonly partType?: string;
  /** Convenience: text content for `text` parts. */
  readonly text?: string;
  /** Convenience: toolName for `tool-call` parts. */
  readonly toolName?: string;
  /** Convenience: tool args for `tool-call` parts. */
  readonly toolInput?: unknown;
  /** Convenience: payload for `data-fyi` parts. */
  readonly fyiData?: unknown;
}

export interface AgentResponseAggregatedEvent extends EventEnvelope {
  readonly kind: 'agent.response.aggregated';
  readonly turnIndex: number;
  readonly utterText: string;
  readonly toolCalls: ReadonlyArray<{
    readonly toolName: string;
    readonly input: unknown;
  }>;
  readonly structure: {
    readonly utterPartCount: number;
    readonly fyiPartCount: number;
    readonly reasoningPartCount: number;
    readonly toolCallCount: number;
  };
  readonly durationMs: number;
  /** Set when the SSE stream was aborted before a clean `done` frame. */
  readonly abortReason?: string;
}

export interface StopJudgeInvokedEvent extends EventEnvelope {
  readonly kind: 'stop_judge.invoked';
  readonly turnIndex: number;
  readonly model: string;
  readonly transcriptSoFar: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  readonly latestAgentResponse: string;
}

export interface StopJudgeRespondedEvent extends EventEnvelope {
  readonly kind: 'stop_judge.responded';
  readonly turnIndex: number;
  readonly shouldStop: boolean;
  readonly anthropicRaw: unknown;
  readonly durationMs: number;
}

export interface AssertionEvaluatedEvent extends EventEnvelope {
  readonly kind: 'assertion.evaluated';
  readonly assertionKind: string;
  readonly passed: boolean;
  readonly reason: string;
}

export interface JudgeInvokedEvent extends EventEnvelope {
  readonly kind: 'judge.invoked';
  readonly rubric: string;
  readonly finalUtterance: string;
  readonly model: string;
}

export interface JudgeRespondedEvent extends EventEnvelope {
  readonly kind: 'judge.responded';
  readonly passed: boolean;
  readonly reasoning: string;
  readonly anthropicRaw: unknown;
  readonly durationMs: number;
}

export interface ErrorEvent extends EventEnvelope {
  readonly kind: 'error';
  readonly message: string;
  readonly stack?: string;
  /** Human-readable phase tag — e.g. "sendMessage", "user-agent.generate", "judge.evaluate". */
  readonly phase: string;
}

export interface TimeoutEvent extends EventEnvelope {
  readonly kind: 'timeout';
  /** Human-readable phase tag — e.g. "turn-timeout", "anthropic-call-timeout". */
  readonly phase: string;
  readonly timeoutMs: number;
}

export interface ScenarioCompletedEvent extends EventEnvelope {
  readonly kind: 'scenario.completed';
  readonly status: 'passed' | 'failed' | 'errored';
  readonly durationMs: number;
  /** Brief summary line — same prose as the CLI's PASS/FAIL log line. */
  readonly summary: string;
}

export type HarnessEvent =
  | ScenarioStartedEvent
  | SessionCreatedEvent
  | ConsentGrantedEvent
  | UserAgentInvokedEvent
  | UserAgentRespondedEvent
  | UserMessageSentEvent
  | AgentSseFrameEvent
  | AgentResponseAggregatedEvent
  | StopJudgeInvokedEvent
  | StopJudgeRespondedEvent
  | AssertionEvaluatedEvent
  | JudgeInvokedEvent
  | JudgeRespondedEvent
  | ErrorEvent
  | TimeoutEvent
  | ScenarioCompletedEvent;

// ---------------------------------------------------------------------------
// EventSink interface + default implementations.
// ---------------------------------------------------------------------------

export interface EventSink {
  emit(event: HarnessEvent): void;
}

/**
 * Drops all events. The default when no observability is required (tests,
 * CI runs against a non-writable filesystem, etc.).
 */
export class NullEventSink implements EventSink {
  emit(_event: HarnessEvent): void {
    // no-op
  }
}

/**
 * Appends one JSON line per event to the given path via synchronous
 * `appendFileSync`. Each call is durable through OS page cache (crash-safe
 * across process kills; only lost on full OS panic or power failure).
 *
 * Parent directory must already exist; this class does not auto-mkdir
 * (that's the CLI's responsibility — it creates `outDir/scenarios/` once
 * at boot before constructing per-scenario sinks).
 *
 * Throughput note: at typical harness load (~5 events/turn × ~6 turns =
 * ~30 events per scenario; 50 scenarios ≈ 1,500 events per run), the
 * per-emit cost is dominated by JSON.stringify on the payload (microseconds)
 * + the fs syscall (~50µs on SSDs). Total sink overhead for a full run is
 * far below 1s of wall-clock.
 */
export class FileEventSink implements EventSink {
  constructor(private readonly path: string) {}

  emit(event: HarnessEvent): void {
    appendFileSync(this.path, JSON.stringify(event) + '\n', 'utf8');
  }
}
