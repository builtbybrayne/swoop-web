// -----------------------------------------------------------------------------
// emitEvent — the single audit-grade log point for Puma.
//
// Per planning/03-exec-observability-a.md (F-a). Every runtime package
// (orchestrator, connector, ui, ingestion) calls this instead of `console.log`
// for anything auditable. The default sink writes a structured JSON line to
// stdout (which Cloud Run ships to Cloud Logging untouched). A pluggable sink
// is available for:
//   - Dev / tests (capture in a ring buffer).
//   - Post-M4 wiring to Cloud Logging via @google-cloud/logging (or whatever
//     Swoop settles on).
//
// Design notes:
//   - Module-level mutable sink (not DI). Rationale: the whole point of the
//     retrofit (F-b) is that every call site is `emitEvent(event)` and
//     nothing else. Sink configuration is a process-lifecycle concern,
//     handled once at startup. Same pattern the UI adapter error emitter
//     uses (decision D.12).
//   - Validation-failure-emits-error.raised pattern. If a producer constructs
//     a bad event we don't want to crash the producer; we want a visible
//     fingerprint in the logs so the drift gets fixed. Mirrors the
//     orchestrator's `server/errors.ts` posture: structured, never throws.
//   - No automatic session-id correlation in F-a. In Puma's two-process
//     topology there is no global session context; the caller always knows
//     the session id. F-b can add sugar if retrofit pain shows up.
// -----------------------------------------------------------------------------

import { EventSchema, type Event, type EventActor } from "./events.js";
import { messageOf } from "./errors.js";

export type EventSink = (event: Event) => void;

const defaultSink: EventSink = (event) => {
  // Structured JSON on a single line. Cloud Run → Cloud Logging parses it
  // as a structured entry; local dev just sees the JSON. This is the one
  // sanctioned console use in Puma — every other auditable log goes via
  // `emitEvent`.
  console.log(JSON.stringify(event));
};

let currentSink: EventSink = defaultSink;

/**
 * Swap the sink. Returns the previous sink so callers can restore it (e.g.
 * tests, post-M4 init code registering a Cloud Logging writer).
 *
 * Module-level mutable state is deliberate — see file header.
 */
export function setEventSink(sink: EventSink): EventSink {
  const previous = currentSink;
  currentSink = sink;
  return previous;
}

/** Reset to the default stdout-JSON sink. Primarily for test hygiene. */
export function resetEventSink(): void {
  currentSink = defaultSink;
}

/**
 * Emit one event. Validates against the discriminated-union schema; on
 * validation failure, emits an `error.raised` event describing the drift
 * instead of the original (the broken event is discarded so consumers never
 * see malformed lines). Never throws — observability must never take down
 * the code it observes.
 */
export function emitEvent(event: Event): void {
  const result = EventSchema.safeParse(event);
  if (!result.success) {
    const fallback: Event = {
      eventType: "error.raised",
      eventVersion: 1,
      timestamp: new Date().toISOString(),
      sessionId:
        typeof (event as { sessionId?: unknown }).sessionId === "string"
          ? ((event as { sessionId?: string }).sessionId as string)
          : "unknown",
      turnIndex: null,
      actor: "system",
      payload: {
        errorType: "event_schema_validation_failed",
        chunk: "F",
        sanitisedContext: result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.code}`)
          .join(", ")
          .slice(0, 500),
      },
    };
    try {
      currentSink(fallback);
    } catch {
      // Sink itself is broken; we've done everything we can.
    }
    return;
  }
  try {
    currentSink(result.data);
  } catch {
    // Sink throw must never propagate.
  }
}

// -----------------------------------------------------------------------------
// emitErrorRaised — H2 helper.
//
// Closes H2 from planning/03-exec-crosscut-common-helpers-fix.md. The
// `error.raised` envelope was being constructed inline at 9+ sites with subtly
// inconsistent payloads (some sliced sanitisedContext to 500 chars, some
// didn't; some passed an err and ran the inline `instanceof Error` triage,
// others built a synthetic string). Folds them all into one helper.
//
// Behaviour:
//   - `err` argument: when provided, sanitisedContext = messageOf(err) sliced
//     to `sanitisedContextLimit` (default 500).
//   - `sanitisedContext` override: when provided, used verbatim before slicing.
//     Lets callers that already have a structured non-Error string (e.g. an
//     LLM error code) emit without faking an Error.
//   - Either `err` or `sanitisedContext` must be provided. Passing neither
//     emits an envelope with no sanitisedContext field — Zod accepts that
//     (it's optional on ErrorRaisedEventSchema).
//   - Standardised slice limit: 500 chars unless overridden. Per H2 spec,
//     consolidates the previous mix of sliced / unsliced sites.
//   - `now` injectable for tests; defaults to `new Date()`.
//
// Caller-friendly call site:
//
//   emitErrorRaised({
//     sessionId,
//     turnIndex: userTurnIndex,
//     actor: 'system',
//     errorType: 'triage_classifier_failed',
//     chunk: 'B',
//     err,
//   });
// -----------------------------------------------------------------------------

export type ErrorChunk = "B" | "C" | "D" | "E" | "F" | "system";

export interface EmitErrorRaisedArgs {
  sessionId: string;
  turnIndex?: number | null;
  actor: EventActor;
  errorType: string;
  chunk: ErrorChunk;
  /** When provided, sanitisedContext = messageOf(err).slice(0, limit). */
  err?: unknown;
  /** When provided, sanitisedContext = sanitisedContext.slice(0, limit). */
  sanitisedContext?: string;
  /** Default 500. Set to Infinity to disable slicing. */
  sanitisedContextLimit?: number;
  /** Test-injectable clock; defaults to `new Date()`. */
  now?: () => Date;
}

export function emitErrorRaised(args: EmitErrorRaisedArgs): void {
  const limit = args.sanitisedContextLimit ?? 500;
  const raw =
    args.sanitisedContext !== undefined
      ? args.sanitisedContext
      : args.err !== undefined
        ? messageOf(args.err)
        : undefined;
  const sliced =
    raw !== undefined
      ? Number.isFinite(limit)
        ? raw.slice(0, limit)
        : raw
      : undefined;
  const clock = args.now ?? (() => new Date());
  emitEvent({
    eventType: "error.raised",
    eventVersion: 1,
    timestamp: clock().toISOString(),
    sessionId: args.sessionId,
    turnIndex: args.turnIndex ?? null,
    actor: args.actor,
    payload: {
      errorType: args.errorType,
      chunk: args.chunk,
      ...(sliced !== undefined ? { sanitisedContext: sliced } : {}),
    },
  });
}
