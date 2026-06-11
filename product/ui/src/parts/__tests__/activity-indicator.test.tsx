// product/ui/src/parts/__tests__/activity-indicator.test.tsx
//
// Covers the activity-status behaviours from
// planning/03-exec-crosscut-goofy-goldstine-activity-status.md §2.3:
//
//   1. Copy schema: cms/ui/tool-status.en.json has `_default` and every
//      entry is a non-empty string (D.goofy-goldstine-11).
//   2. Pure derivation (`deriveActivitySnapshot`): pending tool → its
//      id/name; second pending tool replaces the first (latest wins); tool
//      completed + no text → dots-only snapshot; first text token → hidden;
//      completed/historical messages → hidden.
//   3. View behaviour (`ActivityIndicatorView`): copy renders beside the
//      dots; unknown toolName falls back to `_default`; tool completion
//      drops the line but keeps the dots.
//   4. Single-slot reconciliation with the D.10 `<fyi>` line: an fyi
//      suppresses the tool text; a NEWER tool signal (`tool-status`) fades
//      the fyi and reclaims the slot. Never two lines.
//
// Provider-scope lesson (discoveries.md 2026-05-13): we do NOT mock
// `useMessage`. The state derivation is a pure exported function tested with
// fabricated message states, and the view takes plain props — the
// `TextThinkingIndicator` wrapper is a parse-and-forward shim over those two
// tested layers.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import {
  ActivityIndicatorView,
  deriveActivitySnapshot,
  getToolStatusCopy,
  type ActivityMessageShape,
} from "../text-thinking-indicator";
import { FyiRenderer } from "../fyi-renderer";
import {
  emitFyiChannel,
  resetFyiChannel,
  subscribeFyiChannel,
} from "../fyi-channel";
import statusCopy from "../../../../cms/ui/tool-status.en.json";

const ACTIVITY_TEXT_SELECTOR = '[data-swoop-part="activity-status"]';
const INDICATOR_SELECTOR = '[data-swoop-part="thinking-indicator"]';

function runningMessage(
  content: ActivityMessageShape["content"],
): ActivityMessageShape {
  return { role: "assistant", status: { type: "running" }, content };
}

const pendingTool = (toolCallId: string, toolName: string) => ({
  type: "tool-call",
  toolCallId,
  toolName,
  result: undefined,
  isError: undefined,
});

const completedTool = (toolCallId: string, toolName: string) => ({
  type: "tool-call",
  toolCallId,
  toolName,
  result: { ok: true },
  isError: false,
});

describe("tool-status copy schema (cms/ui/tool-status.en.json)", () => {
  const entries = Object.entries(
    statusCopy as unknown as Record<string, string>,
  );

  it("has a _default fallback entry", () => {
    expect(
      (statusCopy as unknown as Record<string, string>)["_default"],
    ).toBeTruthy();
  });

  it("every entry is a non-empty string", () => {
    expect(entries.length).toBeGreaterThan(1);
    for (const [key, value] of entries) {
      expect(typeof value, `value for "${key}"`).toBe("string");
      expect(value.trim().length, `value for "${key}"`).toBeGreaterThan(0);
    }
  });

  it("getToolStatusCopy maps known tools, falls back for unknown, and never leaks meta keys", () => {
    expect(getToolStatusCopy("find_options")).toBe(
      (statusCopy as unknown as Record<string, string>)["find_options"],
    );
    const fallback = (statusCopy as unknown as Record<string, string>)[
      "_default"
    ];
    expect(getToolStatusCopy("not_a_real_tool")).toBe(fallback);
    expect(getToolStatusCopy("")).toBe(fallback);
    // Meta/authoring keys must never surface as UI copy.
    expect(getToolStatusCopy("$schema-notes")).toBe(fallback);
    expect(getToolStatusCopy("_default")).toBe(fallback);
  });
});

describe("deriveActivitySnapshot", () => {
  it("hides for non-assistant roles and non-running statuses", () => {
    expect(
      deriveActivitySnapshot({
        role: "user",
        status: { type: "running" },
        content: [],
      }),
    ).toBe("");
    expect(
      deriveActivitySnapshot({
        role: "assistant",
        status: { type: "complete" },
        content: [pendingTool("call-1", "lookup")],
      }),
    ).toBe("");
  });

  it("shows dots-only while running with no parts (pre-first-tool gap)", () => {
    expect(deriveActivitySnapshot(runningMessage([]))).toBe("show");
  });

  it("names the pending tool call", () => {
    const snapshot = deriveActivitySnapshot(
      runningMessage([pendingTool("call-1", "find_options")]),
    );
    expect(snapshot.split("\u0000")).toEqual([
      "show",
      "call-1",
      "find_options",
    ]);
  });

  it("latest pending tool wins the single slot", () => {
    const snapshot = deriveActivitySnapshot(
      runningMessage([
        pendingTool("call-1", "find_options"),
        pendingTool("call-2", "lookup"),
      ]),
    );
    expect(snapshot.split("\u0000")).toEqual(["show", "call-2", "lookup"]);
  });

  it("a completed later call does not clear an earlier still-pending one", () => {
    const snapshot = deriveActivitySnapshot(
      runningMessage([
        pendingTool("call-1", "find_options"),
        completedTool("call-2", "lookup"),
      ]),
    );
    expect(snapshot.split("\u0000")).toEqual([
      "show",
      "call-1",
      "find_options",
    ]);
  });

  it("drops to dots-only when every tool call has completed and no text yet", () => {
    expect(
      deriveActivitySnapshot(
        runningMessage([completedTool("call-1", "find_options")]),
      ),
    ).toBe("show");
  });

  it("hides entirely once non-empty text streams (empty text part does not count)", () => {
    expect(
      deriveActivitySnapshot(
        runningMessage([
          completedTool("call-1", "find_options"),
          { type: "text", text: "" },
        ]),
      ),
    ).toBe("show");
    expect(
      deriveActivitySnapshot(
        runningMessage([
          pendingTool("call-1", "find_options"),
          { type: "text", text: "Patagonia in March is" },
        ]),
      ),
    ).toBe("");
  });
});

describe("ActivityIndicatorView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFyiChannel();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetFyiChannel();
  });

  function flushEffects() {
    act(() => {
      vi.advanceTimersByTime(0);
    });
  }

  it("renders nothing when show=false (completed / historical messages)", () => {
    render(
      <ActivityIndicatorView show={false} toolCallId={null} toolName={null} />,
    );
    expect(document.querySelector(INDICATOR_SELECTOR)).toBeNull();
  });

  it("shows dots plus the tool's copy with the a11y + skinning contract", () => {
    render(
      <ActivityIndicatorView
        show
        toolCallId="call-1"
        toolName="find_options"
      />,
    );
    flushEffects();

    const container = document.querySelector(INDICATOR_SELECTOR);
    expect(container).not.toBeNull();
    expect(container).toHaveAttribute("role", "status");
    expect(container).toHaveAttribute("aria-live", "polite");

    const text = document.querySelector(ACTIVITY_TEXT_SELECTOR);
    expect(text).not.toBeNull();
    expect(text).toHaveTextContent("Browsing trip ideas…");
    // The visible line replaces the sr-only fallback — one announcement.
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("unknown toolName falls back to the _default copy", () => {
    render(
      <ActivityIndicatorView show toolCallId="call-9" toolName="brand_new" />,
    );
    flushEffects();
    expect(
      document.querySelector(ACTIVITY_TEXT_SELECTOR),
    ).toHaveTextContent("Looking that up…");
  });

  it("a second tool call replaces the first — one slot, never two lines", () => {
    const { rerender } = render(
      <ActivityIndicatorView
        show
        toolCallId="call-1"
        toolName="find_options"
      />,
    );
    flushEffects();
    rerender(
      <ActivityIndicatorView show toolCallId="call-2" toolName="lookup" />,
    );
    flushEffects();

    const nodes = document.querySelectorAll(ACTIVITY_TEXT_SELECTOR);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveTextContent("Checking Swoop's guides…");
    expect(nodes[0]).not.toHaveTextContent("Browsing trip ideas…");
  });

  it("tool completes with no text yet → dots remain, status line drops", () => {
    // Chosen semantics (documented in the component header): the line is
    // state-derived, so it reflects what IS in flight — once nothing is, the
    // silent composing gap keeps the original dots-only treatment.
    const { rerender } = render(
      <ActivityIndicatorView
        show
        toolCallId="call-1"
        toolName="find_options"
      />,
    );
    flushEffects();
    rerender(
      <ActivityIndicatorView show toolCallId={null} toolName={null} />,
    );
    flushEffects();

    expect(document.querySelector(INDICATOR_SELECTOR)).not.toBeNull();
    expect(document.querySelector(ACTIVITY_TEXT_SELECTOR)).toBeNull();
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("emits tool-status when the in-flight tool changes — not on unrelated re-renders", () => {
    const events: string[] = [];
    subscribeFyiChannel((event) => {
      if (event === "tool-status") events.push(event);
    });

    const { rerender } = render(
      <ActivityIndicatorView
        show
        toolCallId="call-1"
        toolName="find_options"
      />,
    );
    flushEffects();
    expect(events).toHaveLength(1);

    // Same tool re-rendered: no new signal.
    rerender(
      <ActivityIndicatorView
        show
        toolCallId="call-1"
        toolName="find_options"
      />,
    );
    flushEffects();
    expect(events).toHaveLength(1);

    // New tool: new signal.
    rerender(
      <ActivityIndicatorView show toolCallId="call-2" toolName="lookup" />,
    );
    flushEffects();
    expect(events).toHaveLength(2);
  });
});

describe("single-slot reconciliation with the D.10 fyi line", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFyiChannel();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetFyiChannel();
  });

  function flushEffects() {
    act(() => {
      vi.advanceTimersByTime(0);
    });
  }

  /** Visible status lines = tool-derived text spans + non-faded fyi nodes. */
  function visibleStatusLineCount(): number {
    const toolLines = document.querySelectorAll(
      ACTIVITY_TEXT_SELECTOR,
    ).length;
    const fyiLines = document.querySelectorAll(
      '[data-testid="fyi-status"][data-fyi-visible="true"]',
    ).length;
    return toolLines + fyiLines;
  }

  it("fyi suppresses the tool text; a newer tool signal fades the fyi and reclaims the slot — never two lines", () => {
    // 1. Tool call in flight → tool text owns the slot.
    const { rerender } = render(
      <ActivityIndicatorView
        show
        toolCallId="call-1"
        toolName="find_options"
      />,
    );
    flushEffects();
    expect(
      document.querySelector(ACTIVITY_TEXT_SELECTOR),
    ).toHaveTextContent("Browsing trip ideas…");
    expect(visibleStatusLineCount()).toBe(1);

    // 2. Agent-authored fyi arrives (separate root, as in the app where the
    //    fyi renders inside MessagePrimitive.Parts and the indicator after
    //    it). The fyi is the newer signal: tool text steps aside.
    render(
      <FyiRenderer
        data={{
          message: "Just double-checking the map…",
          timestamp: "2026-06-11T10:00:00.000Z",
        }}
      />,
    );
    flushEffects();
    expect(document.querySelector(ACTIVITY_TEXT_SELECTOR)).toBeNull();
    expect(screen.getByTestId("fyi-status")).toHaveAttribute(
      "data-fyi-visible",
      "true",
    );
    expect(visibleStatusLineCount()).toBe(1);
    // Dots stay up throughout.
    expect(document.querySelector(INDICATOR_SELECTOR)).not.toBeNull();

    // 3. A NEW tool call starts → tool-status emitted → fyi fades, tool text
    //    reclaims the single slot.
    rerender(
      <ActivityIndicatorView show toolCallId="call-2" toolName="lookup" />,
    );
    flushEffects();
    expect(screen.getByTestId("fyi-status")).toHaveAttribute(
      "data-fyi-visible",
      "false",
    );
    expect(
      document.querySelector(ACTIVITY_TEXT_SELECTOR),
    ).toHaveTextContent("Checking Swoop's guides…");
    expect(visibleStatusLineCount()).toBe(1);
  });

  it("suppression persists for the SAME tool after the fyi fades by timeout (signals don't resurrect)", () => {
    render(
      <ActivityIndicatorView
        show
        toolCallId="call-1"
        toolName="find_options"
      />,
    );
    flushEffects();
    act(() => {
      emitFyiChannel("fyi-appeared");
    });
    expect(document.querySelector(ACTIVITY_TEXT_SELECTOR)).toBeNull();

    // The fyi's ~3s window passes; nothing new happened — dots alone is the
    // honest state (documented choice in the component header).
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(document.querySelector(ACTIVITY_TEXT_SELECTOR)).toBeNull();
    expect(document.querySelector(INDICATOR_SELECTOR)).not.toBeNull();
  });

  it("an fyi arriving in the composing gap still yields to the next tool call", () => {
    const { rerender } = render(
      <ActivityIndicatorView show toolCallId={null} toolName={null} />,
    );
    flushEffects();
    act(() => {
      emitFyiChannel("fyi-appeared");
    });

    rerender(
      <ActivityIndicatorView show toolCallId="call-1" toolName="illustrate" />,
    );
    flushEffects();
    expect(
      document.querySelector(ACTIVITY_TEXT_SELECTOR),
    ).toHaveTextContent("Finding a picture worth showing you…");
  });
});
