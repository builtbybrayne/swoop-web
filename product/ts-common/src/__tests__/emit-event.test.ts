// -----------------------------------------------------------------------------
// emitEvent helper — sink swap + validation-failure behaviour.
//
// Per planning/03-exec-observability-a.md (F-a §Verification). Scope is tight:
// three tests for a ~80 LOC helper.
// -----------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
