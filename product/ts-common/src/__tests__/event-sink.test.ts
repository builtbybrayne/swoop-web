// -----------------------------------------------------------------------------
// event-sink — severity/message derivation + the pure stdout / cloud-logging
// sinks. Per planning/03-exec-observability-c.md (F-c §1.1, §1.2).
// -----------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  severityForEvent,
  messageForEvent,
  stdoutSink,
  cloudLoggingSink,
  type EventSeverity,
} from "../event-sink.js";
import type { Event } from "../events.js";
import {
  SampleEventHandoffSubmitted,
  SampleEventToolInvoked,
  SampleEventUiWidgetRendered,
  SampleEventSessionExpired,
  SampleEventWarmPoolMiss,
  SampleEventConsentGranted,
} from "../fixtures/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// --- typed event constructors for the cases not covered by fixtures ---------

const errorRaised = (errorType: string, ctx: string): Event => ({
  eventType: "error.raised",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: 4,
  actor: "system",
  payload: { errorType, chunk: "B", sanitisedContext: ctx },
});

const toolInvokedFailed: Event = {
  eventType: "tool.invoked",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: 2,
  actor: "connector",
  payload: { toolName: "lookup", elapsedMs: 7, ok: false, errorKind: "handler_threw" },
};

const toolReturnedError: Event = {
  eventType: "tool.returned",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: 2,
  actor: "connector",
  payload: { toolName: "find_options", toolCallId: "c1", outcome: "error", latencyMs: 9 },
};

const toolReturnedOk: Event = {
  ...toolReturnedError,
  payload: { toolName: "find_options", toolCallId: "c1", outcome: "ok", latencyMs: 9 },
};

const handoffEmailFailed: Event = {
  eventType: "handoff.email.failed",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: 6,
  actor: "connector",
  payload: { handoffId: "h1", verdict: "qualified", errorCategory: "smtp", sanitisedContext: "ECONNREFUSED" },
};

const sweepFailed: Event = {
  eventType: "handoff.retention.sweep.failed",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "system",
  turnIndex: null,
  actor: "connector",
  payload: { runId: "00000000-0000-0000-0000-000000000000", errorCategory: "sweep_failed", sanitisedContext: "boom" },
};

const replayFailed: Event = {
  eventType: "session.replay.failed",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: null,
  actor: "system",
  payload: { stage: "translator", errorMessage: "kaboom" },
};

const widgetMalformed: Event = {
  eventType: "ui.widget_rendered",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: 2,
  actor: "ui",
  payload: { widgetType: "find-options:malformed:schema", toolName: "find_options", turnIndex: 2 },
};

const rehydrateFailed: Event = {
  eventType: "ui.session.rehydrate.failed",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: null,
  actor: "ui",
  payload: { stage: "network" },
};

const conversationStarted: Event = {
  eventType: "conversation.started",
  eventVersion: 1,
  timestamp: "2026-06-16T00:00:00.000Z",
  sessionId: "sess_test",
  turnIndex: null,
  actor: "system",
  payload: { warmPoolHit: false },
};

describe("severityForEvent", () => {
  const cases: ReadonlyArray<[string, Event, EventSeverity]> = [
    // ERROR — page the dev team
    ["error.raised", errorRaised("chat_turn_failed", "stack…"), "ERROR"],
    ["tool.invoked{ok:false}", toolInvokedFailed, "ERROR"],
    ["tool.returned{outcome:error}", toolReturnedError, "ERROR"],
    ["handoff.email.failed", handoffEmailFailed, "ERROR"],
    ["handoff.retention.sweep.failed", sweepFailed, "ERROR"],
    ["session.replay.failed", replayFailed, "ERROR"],
    // WARNING — drift / degraded
    ["ui.widget_rendered{:malformed}", widgetMalformed, "WARNING"],
    ["ui.session.rehydrate.failed", rehydrateFailed, "WARNING"],
    // INFO — normal lifecycle
    ["conversation.started", conversationStarted, "INFO"],
    ["tool.invoked{ok:true}", SampleEventToolInvoked, "INFO"],
    ["tool.returned{outcome:ok}", toolReturnedOk, "INFO"],
    ["ui.widget_rendered (plain)", SampleEventUiWidgetRendered, "INFO"],
    ["session.expired", SampleEventSessionExpired, "INFO"],
    ["warm_pool.miss", SampleEventWarmPoolMiss, "INFO"],
    ["handoff.submitted", SampleEventHandoffSubmitted, "INFO"],
    ["consent.granted", SampleEventConsentGranted, "INFO"],
  ];

  it.each(cases)("%s → %s", (_label, event, expected) => {
    expect(severityForEvent(event)).toBe(expected);
  });
});

describe("messageForEvent", () => {
  it("summarises error.raised by chunk + errorType, NOT the variable sanitisedContext", () => {
    const msg = messageForEvent(errorRaised("triage_classifier_failed", "secret-stack-trace"));
    expect(msg).toContain("triage_classifier_failed");
    expect(msg).toContain("[B]");
    expect(msg).not.toContain("secret-stack-trace");
  });

  it("is stable across variable context (so Error Reporting groups consistently)", () => {
    expect(messageForEvent(errorRaised("chat_turn_failed", "A"))).toBe(
      messageForEvent(errorRaised("chat_turn_failed", "B-totally-different")),
    );
  });

  it("names the failing tool + errorKind for tool.invoked failures", () => {
    const msg = messageForEvent(toolInvokedFailed);
    expect(msg).toContain("lookup");
    expect(msg).toContain("handler_threw");
  });

  it("falls back to the eventType for ordinary events", () => {
    expect(messageForEvent(conversationStarted)).toBe("conversation.started");
  });
});

describe("stdoutSink", () => {
  it("writes the raw JSON event with no added fields (dev behaviour unchanged)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSink(SampleEventHandoffSubmitted);
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toEqual(SampleEventHandoffSubmitted);
    expect(parsed).not.toHaveProperty("severity");
  });
});

describe("cloudLoggingSink", () => {
  it("adds a top-level severity + stable message, preserving the full event payload", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = handoffEmailFailed;
    cloudLoggingSink(event);
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.severity).toBe("ERROR");
    expect(parsed.message).toBe(messageForEvent(event));
    expect(parsed.eventType).toBe("handoff.email.failed");
    expect(parsed.sessionId).toBe(event.sessionId);
    expect(parsed.payload).toEqual(event.payload);
  });

  it("tags ordinary events INFO", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    cloudLoggingSink(SampleEventHandoffSubmitted);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.severity).toBe("INFO");
  });
});
