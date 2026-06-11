// product/ui/src/widgets/__tests__/find-options.test.tsx
//
// Post-goofy-goldstine find/show split (2026-06-11): `find_options` is the
// agent-private BROWSE tool. It renders NOTHING for the visitor — a silent
// placeholder in dev, null in prod. Card rendering moved to ShowOptionsWidget
// (see show-options.test.tsx). These tests pin the silence.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  SampleFindOptionsOutput,
  SampleFindOptionsOutputMixed,
} from "@swoop/common/fixtures";
import { FindOptionsWidget } from "../find-options";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_options_1",
    toolName: "find_options",
    args: { query: "kayaking near glaciers" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof FindOptionsWidget>;
}

afterEach(() => cleanup());

describe("FindOptionsWidget (browse-only — renders nothing)", () => {
  it("renders the dev silent placeholder for a populated browse result", () => {
    render(
      <FindOptionsWidget {...mockProps({ result: SampleFindOptionsOutput })} />,
    );
    // No visitor-facing card surface — browse output never renders.
    expect(screen.queryByTestId("find-options")).toBeNull();
    expect(screen.queryByTestId("find-options-trip-card")).toBeNull();
    const silent = screen.getByTestId("widget-silent");
    expect(silent).toHaveAttribute("data-swoop-widget", "find-options");
  });

  it("stays silent for a mixed-type browse result too", () => {
    render(
      <FindOptionsWidget
        {...mockProps({ result: SampleFindOptionsOutputMixed })}
      />,
    );
    expect(screen.queryByTestId("find-options")).toBeNull();
    expect(screen.getByTestId("widget-silent")).toBeInTheDocument();
  });

  it("renders the dev silent indicator when options are empty", () => {
    render(
      <FindOptionsWidget
        {...mockProps({ result: { options: [], count: 0 } })}
      />,
    );
    expect(screen.queryByTestId("find-options")).toBeNull();
    const silent = screen.getByTestId("widget-silent");
    expect(silent).toHaveAttribute("data-swoop-widget", "find-options");
    expect(silent.textContent).toContain("find_options");
  });

  it("falls back to the malformed placeholder on a malformed result", () => {
    render(
      <FindOptionsWidget
        {...mockProps({ result: { options: "not-an-array", count: 0 } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });

  it("rejects the legacy full-card shape (cards: [...]) as malformed", () => {
    // The pre-split shape must not silently pass — schema narrowed to
    // BrowseOption[].
    render(
      <FindOptionsWidget
        {...mockProps({
          result: { cards: [{ type: "trip", id: "1", headline: "x" }], count: 1 },
        })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
