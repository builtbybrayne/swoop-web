// product/ui/src/parts/__tests__/fyi-renderer.test.tsx
//
// Covers the four behaviours called out in
// planning/03-exec-chat-surface-t2.md "Tests":
//
//   1. A single `<fyi>` status line renders with the expected a11y shape.
//   2. It auto-fades after FYI_TIMEOUT_MS.
//   3. It fades immediately when a `text-arrived` event is emitted
//      (simulating the text renderer starting to stream).
//   4. Rapid `<fyi>` updates don't stack: the newest replaces the previous.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { FyiRenderer, FYI_TIMEOUT_MS } from "../fyi-renderer";
import { emitFyiChannel, resetFyiChannel } from "../fyi-channel";

const FADE_TRANSITION_MS = 300;

function makeFyi(message: string, timestamp = new Date().toISOString()) {
  return { message, timestamp };
}

describe("FyiRenderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFyiChannel();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetFyiChannel();
  });

  it("renders a single status line with role=status and aria-live=polite", () => {
    render(<FyiRenderer data={makeFyi("Checking availability…")} />);

    const status = screen.getByTestId("fyi-status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("data-fyi-visible", "true");
    expect(status).toHaveTextContent("Checking availability…");
  });

  it("auto-fades after the timeout and then unmounts", () => {
    render(<FyiRenderer data={makeFyi("Thinking…")} />);

    // Before the timer, still visible.
    expect(screen.getByTestId("fyi-status")).toHaveAttribute(
      "data-fyi-visible",
      "true",
    );

    // Advance just to the timeout: the component sets visible=false.
    act(() => {
      vi.advanceTimersByTime(FYI_TIMEOUT_MS);
    });

    expect(screen.getByTestId("fyi-status")).toHaveAttribute(
      "data-fyi-visible",
      "false",
    );

    // After the fade transition window, the node unmounts entirely.
    act(() => {
      vi.advanceTimersByTime(FADE_TRANSITION_MS + 10);
    });
    expect(screen.queryByTestId("fyi-status")).not.toBeInTheDocument();
  });

  it("fades immediately when a text part arrives (text-arrived event)", () => {
    render(<FyiRenderer data={makeFyi("Searching trips…")} />);

    // Well before the natural timeout, simulate the text renderer starting
    // to stream by emitting a text-arrived signal on the channel.
    act(() => {
      vi.advanceTimersByTime(200);
      emitFyiChannel("text-arrived");
    });

    expect(screen.getByTestId("fyi-status")).toHaveAttribute(
      "data-fyi-visible",
      "false",
    );
  });

  it("replaces — not stacks — when multiple fyi parts arrive rapidly", () => {
    // First fyi renders and announces itself.
    const { rerender } = render(
      <FyiRenderer data={makeFyi("Step 1: resolving location", "2026-04-22T10:00:00.000Z")} />,
    );

    // Flush the post-mount effect: the initial emit fires and the listener
    // for this instance registers.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Confirm only one status node exists.
    expect(screen.getAllByTestId("fyi-status")).toHaveLength(1);
    expect(screen.getByTestId("fyi-status")).toHaveTextContent(
      "Step 1: resolving location",
    );

    // Newer fyi replaces the payload (this mirrors what assistant-ui does
    // when two consecutive data-fyi parts arrive on the same position — in
    // practice they'll be separate parts but the visual "latest wins" story
    // is the same: only one node visible).
    rerender(
      <FyiRenderer data={makeFyi("Step 2: querying inventory", "2026-04-22T10:00:01.000Z")} />,
    );

    // Flush the re-mount-ish effect so the newer instance registers.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const nodes = screen.getAllByTestId("fyi-status");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveTextContent("Step 2: querying inventory");
    expect(nodes[0]).not.toHaveTextContent("Step 1");
  });

  it("emits fyi-appeared on mount so older siblings can fade", () => {
    // Render the first fyi.
    render(<FyiRenderer data={makeFyi("first", "2026-04-22T10:00:00.000Z")} />);

    // Flush so the first instance's subscription is registered.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Now render a sibling via a separate component tree.
    render(<FyiRenderer data={makeFyi("second", "2026-04-22T10:00:01.000Z")} />);

    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Both are still in the DOM for this render window, but the first should
    // already be invisible (fading).
    const nodes = screen.getAllByTestId("fyi-status");
    const firstNode = nodes.find((n) => n.textContent?.includes("first"));
    const secondNode = nodes.find((n) => n.textContent?.includes("second"));
    expect(firstNode).toHaveAttribute("data-fyi-visible", "false");
    expect(secondNode).toHaveAttribute("data-fyi-visible", "true");
  });
});
