// -----------------------------------------------------------------------------
// event-sink — severity/message derivation + the pure (dependency-free) sinks.
//
// Per planning/03-exec-observability-c.md (F-c). These pieces are pure so they
// live in @swoop/common alongside emit-event.ts — no `pg` / GCP weight leaks
// into the browser bundle. The Postgres sink (which needs `pg`) lives in
// @swoop/connector; this module owns severity, message, and the two
// console-based sinks.
//
//   - severityForEvent / messageForEvent  — what Cloud Logging, Error
//     Reporting and alert policies key off (decision F.sink-2).
//   - stdoutSink                          — the dev default; identical bytes
//     to emit-event.ts's built-in default sink.
//   - cloudLoggingSink                    — structured stdout enriched with a
//     top-level `severity` + stable `message`, in the shape Cloud Logging
//     ingests via Cloud Run native / the Ops Agent (decision F.sink-4). No
//     `@google-cloud/logging` dependency.
// -----------------------------------------------------------------------------

import type { Event } from "./events.js";
import type { EventSink } from "./emit-event.js";

export type EventSeverity = "ERROR" | "WARNING" | "INFO";

/**
 * Map an event kind to a Cloud Logging severity. ERROR is the page-the-dev-team
 * class (Error Reporting + alert policies fire on `severity>=ERROR`); WARNING
 * is drift / degraded worth review; everything else is INFO. See F-c §1.1.
 */
export function severityForEvent(event: Event): EventSeverity {
  switch (event.eventType) {
    case "error.raised":
    case "handoff.email.failed":
    case "handoff.retention.sweep.failed":
    case "session.replay.failed":
      return "ERROR";
    case "tool.invoked":
      return event.payload.ok === false ? "ERROR" : "INFO";
    case "tool.returned":
      return event.payload.outcome === "error" ? "ERROR" : "INFO";
    case "ui.widget_rendered":
      return event.payload.widgetType.includes(":malformed") ? "WARNING" : "INFO";
    case "ui.session.rehydrate.failed":
      return "WARNING";
    default:
      return "INFO";
  }
}

/**
 * A stable, low-cardinality one-line summary for the Log Explorer summary and
 * Error Reporting grouping. Deliberately keyed off structural fields only —
 * never the variable `sanitisedContext` / `errorMessage` (those stay in the
 * payload) — so the same failure class groups consistently.
 */
export function messageForEvent(event: Event): string {
  switch (event.eventType) {
    case "error.raised":
      return `error.raised [${event.payload.chunk}] ${event.payload.errorType}`;
    case "tool.invoked":
      return event.payload.ok === false
        ? `tool.invoked FAILED ${event.payload.toolName} (${event.payload.errorKind ?? "unknown"})`
        : `tool.invoked ${event.payload.toolName}`;
    case "tool.called":
      return `tool.called ${event.payload.toolName}`;
    case "tool.returned":
      return `tool.returned ${event.payload.outcome} ${event.payload.toolName}`;
    case "handoff.email.failed":
      return `handoff.email.failed ${event.payload.errorCategory}`;
    case "handoff.retention.sweep.failed":
      return `handoff.retention.sweep.failed ${event.payload.errorCategory}`;
    case "session.replay.failed":
      return `session.replay.failed ${event.payload.stage}`;
    case "ui.widget_rendered":
      return `ui.widget_rendered ${event.payload.widgetType}`;
    default:
      return event.eventType;
  }
}

/**
 * The dev default sink — one raw JSON line per event. Functionally identical to
 * emit-event.ts's built-in default; named here so `resolveEventSink('stdout')`
 * has something to return.
 */
export const stdoutSink: EventSink = (event) => {
  // This function IS the sink — stdout is the intended destination.
  console.log(JSON.stringify(event));
};

/**
 * Structured-stdout sink for Cloud Logging. Adds a top-level `severity` and a
 * stable `message`; the full event rides as the structured payload so Log
 * Explorer queries on `eventType` / `payload.*` keep working. Ingested by Cloud
 * Run natively or the Ops Agent on a GCE VM — no client library needed.
 */
export const cloudLoggingSink: EventSink = (event) => {
  // This function IS the sink — Cloud Logging is the intended destination.
  console.log(
    JSON.stringify({
      severity: severityForEvent(event),
      message: messageForEvent(event),
      ...event,
    }),
  );
};
