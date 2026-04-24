// product/ui/src/runtime/__tests__/emit-ui-event.test.ts
//
// Coverage for the UI-side wrapper over `@swoop/common`'s `emitEvent`.
// Scope is tight: envelope defaults, session-id fallbacks, and that the
// payload round-trips through the common Zod validator without loss.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Event,
  type EventSink,
  resetEventSink,
  setEventSink,
} from "@swoop/common";

import { SESSION_STORAGE_KEY } from "../orchestrator-adapter";
import { emitUiEvent } from "../emit-ui-event";

let captured: Event[] = [];
const captureSink: EventSink = (event) => {
  captured.push(event);
};

beforeEach(() => {
  captured = [];
  setEventSink(captureSink);
  window.sessionStorage.clear();
});

afterEach(() => {
  resetEventSink();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("emitUiEvent", () => {
  it("fills envelope defaults and reads session id from storage", () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "sess-abc");

    emitUiEvent({
      eventType: "ui.conversation_opened",
      payload: { source: "mount", uaCategory: "desktop" },
    });

    expect(captured).toHaveLength(1);
    const event = captured[0]!;
    expect(event.eventType).toBe("ui.conversation_opened");
    expect(event.eventVersion).toBe(1);
    expect(event.actor).toBe("ui");
    expect(event.sessionId).toBe("sess-abc");
    expect(event.turnIndex).toBeNull();
    expect(typeof event.timestamp).toBe("string");
    if (event.eventType === "ui.conversation_opened") {
      expect(event.payload.source).toBe("mount");
      expect(event.payload.uaCategory).toBe("desktop");
    }
  });

  it("falls back to sessionId='unknown' when storage is empty", () => {
    emitUiEvent({
      eventType: "consent.declined",
      payload: { tier: "conversation", copyVersion: "v1" },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sessionId).toBe("unknown");
  });

  it("honours an explicit sessionId override", () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "sess-from-storage");

    emitUiEvent({
      eventType: "consent.granted",
      sessionId: "sess-explicit",
      payload: { tier: "conversation", copyVersion: "v1" },
    });

    expect(captured[0]!.sessionId).toBe("sess-explicit");
  });

  it("emits ui.widget_rendered with a concrete turnIndex", () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "sess-widget");
    emitUiEvent({
      eventType: "ui.widget_rendered",
      payload: { widgetType: "search-results", toolName: "search", turnIndex: 3 },
    });

    expect(captured).toHaveLength(1);
    const event = captured[0]!;
    if (event.eventType === "ui.widget_rendered") {
      expect(event.payload.turnIndex).toBe(3);
      expect(event.payload.toolName).toBe("search");
    }
  });
});
