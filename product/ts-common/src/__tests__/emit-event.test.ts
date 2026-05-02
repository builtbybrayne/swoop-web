// -----------------------------------------------------------------------------
// emitEvent helper — sink swap + validation-failure behaviour.
//
// Per planning/03-exec-observability-a.md (F-a §Verification). Scope is tight:
// three tests for a ~80 LOC helper.
// -----------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitErrorRaised,
  emitEvent,
  resetEventSink,
  setEventSink,
  type Event,
  type EventSink,
} from "../index.js";
import { SampleEvent } from "../fixtures/index.js";

afterEach(() => {
  resetEventSink();
  vi.restoreAllMocks();
});

describe("emitEvent", () => {
  it("writes JSON-serialised events to stdout via the default sink", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    emitEvent(SampleEvent);

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(typeof arg).toBe("string");
    expect(JSON.parse(arg as string)).toEqual(SampleEvent);
  });

  it("setEventSink swaps the sink and returns the previous one", () => {
    const captured: Event[] = [];
    const captureSink: EventSink = (event) => {
      captured.push(event);
    };

    const previous = setEventSink(captureSink);
    try {
      emitEvent(SampleEvent);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual(SampleEvent);
    } finally {
      // Restore the sink via the returned handle (not resetEventSink) to
      // prove the return value is live.
      setEventSink(previous);
    }

    // After restoration, the capture sink must not receive further events.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    emitEvent(SampleEvent);
    expect(captured).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("emits an error.raised fallback on schema validation failure — original is discarded", () => {
    const captured: Event[] = [];
    setEventSink((event) => {
      captured.push(event);
    });

    // Deliberately malformed: a valid discriminator (`handoff.submitted`)
    // paired with a payload shape that fails validation (missing required
    // fields). The cast sidesteps the type system to simulate a producer
    // bug.
    const malformed = {
      eventType: "handoff.submitted",
      eventVersion: 1,
      timestamp: "2026-04-22T09:07:23.000Z",
      sessionId: "sess_malformed",
      turnIndex: 0,
      actor: "agent",
      payload: {
        // missing handoffId, verdict, consent* fields → schema rejects
        emailDeliveryStatus: "sent",
      },
    } as unknown as Event;

    emitEvent(malformed);

    expect(captured).toHaveLength(1);
    const fallback = captured[0];
    expect(fallback.eventType).toBe("error.raised");
    expect(fallback.sessionId).toBe("sess_malformed");
    expect(fallback.actor).toBe("system");
    if (fallback.eventType === "error.raised") {
      expect(fallback.payload.errorType).toBe("event_schema_validation_failed");
      expect(fallback.payload.chunk).toBe("F");
      expect(typeof fallback.payload.sanitisedContext).toBe("string");
    }
  });
});

describe("emitErrorRaised — H2 helper", () => {
  it("emits a schema-conformant error.raised event from an Error", () => {
    const captured: Event[] = [];
    setEventSink((event) => {
      captured.push(event);
    });

    emitErrorRaised({
      sessionId: "sess_test",
      turnIndex: 3,
      actor: "system",
      errorType: "tool_pipeline_failed",
      chunk: "B",
      err: new Error("kaboom"),
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    expect(captured).toHaveLength(1);
    const event = captured[0];
    expect(event.eventType).toBe("error.raised");
    expect(event.sessionId).toBe("sess_test");
    expect(event.turnIndex).toBe(3);
    expect(event.actor).toBe("system");
    expect(event.timestamp).toBe("2026-05-01T00:00:00.000Z");
    if (event.eventType === "error.raised") {
      expect(event.payload.errorType).toBe("tool_pipeline_failed");
      expect(event.payload.chunk).toBe("B");
      expect(event.payload.sanitisedContext).toBe("kaboom");
    }
  });

  it("standardises sanitisedContext slice to 500 chars by default", () => {
    const captured: Event[] = [];
    setEventSink((event) => {
      captured.push(event);
    });

    const longMessage = "x".repeat(2000);
    emitErrorRaised({
      sessionId: "sess_test",
      actor: "system",
      errorType: "long_error",
      chunk: "B",
      err: new Error(longMessage),
    });

    expect(captured).toHaveLength(1);
    const event = captured[0];
    if (event.eventType === "error.raised") {
      expect(event.payload.sanitisedContext).toHaveLength(500);
    }
  });

  it("accepts a sanitisedContext override (for non-Error structured strings)", () => {
    const captured: Event[] = [];
    setEventSink((event) => {
      captured.push(event);
    });

    emitErrorRaised({
      sessionId: "sess_test",
      actor: "system",
      errorType: "triage_classifier_llm_error",
      chunk: "B",
      sanitisedContext: "rate_limited: too many requests",
    });

    expect(captured).toHaveLength(1);
    if (captured[0].eventType === "error.raised") {
      expect(captured[0].payload.sanitisedContext).toBe(
        "rate_limited: too many requests",
      );
    }
  });

  it("respects custom sanitisedContextLimit", () => {
    const captured: Event[] = [];
    setEventSink((event) => {
      captured.push(event);
    });

    emitErrorRaised({
      sessionId: "sess_test",
      actor: "system",
      errorType: "tight_limit",
      chunk: "B",
      err: new Error("12345678901234"),
      sanitisedContextLimit: 5,
    });

    if (captured[0].eventType === "error.raised") {
      expect(captured[0].payload.sanitisedContext).toBe("12345");
    }
  });

  it("turnIndex defaults to null when not provided", () => {
    const captured: Event[] = [];
    setEventSink((event) => {
      captured.push(event);
    });

    emitErrorRaised({
      sessionId: "sess_test",
      actor: "system",
      errorType: "no_turn",
      chunk: "B",
      err: new Error("boom"),
    });

    expect(captured[0].turnIndex).toBeNull();
  });

  it("omits sanitisedContext when neither err nor sanitisedContext is provided", () => {
    const captured: Event[] = [];
    setEventSink((event) => {
      captured.push(event);
    });

    emitErrorRaised({
      sessionId: "sess_test",
      actor: "system",
      errorType: "bare",
      chunk: "B",
    });

    expect(captured).toHaveLength(1);
    if (captured[0].eventType === "error.raised") {
      expect(captured[0].payload.sanitisedContext).toBeUndefined();
    }
  });
});
