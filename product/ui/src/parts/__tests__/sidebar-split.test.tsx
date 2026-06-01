// product/ui/src/parts/__tests__/sidebar-split.test.tsx
//
// Coverage for the resizable thread/sidebar split:
//   - renders both panes;
//   - exposes a keyboard-operable separator (WAI-ARIA window-splitter) that
//     defaults to a 50/50 ratio;
//   - arrow keys move the divider and clamp at the [20, 80] bounds;
//   - Home / Enter / double-click snap back to 50/50;
//   - the sidebar pane's flex-basis tracks the ratio.
//
// jsdom has no layout engine, so we drive the divider by keyboard (which is
// layout-free) rather than synthesising pointer drags against a zero-size box.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  SidebarSplitLayout,
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
} from "../sidebar-split";

const DEFAULT_NOW = String(Math.round(DEFAULT_SPLIT_RATIO));

afterEach(() => cleanup());

function setup() {
  render(
    <SidebarSplitLayout
      main={<div data-testid="main-content">transcript</div>}
      aside={<div data-testid="aside-content">sidebar</div>}
    />,
  );
  const separator = screen.getByRole("separator");
  const pane = document.querySelector(
    '[data-swoop-part="sidebar-pane"]',
  ) as HTMLElement;
  return { separator, pane };
}

describe("clampSplitRatio", () => {
  it("clamps to the [20, 80] percent window", () => {
    expect(clampSplitRatio(50)).toBe(50);
    expect(clampSplitRatio(5)).toBe(20);
    expect(clampSplitRatio(95)).toBe(80);
  });
});

describe("SidebarSplitLayout", () => {
  it("renders both panes", () => {
    setup();
    expect(screen.getByTestId("main-content")).toBeInTheDocument();
    expect(screen.getByTestId("aside-content")).toBeInTheDocument();
  });

  it("defaults to a golden-ratio split with the chat larger than the sidebar", () => {
    const { separator, pane } = setup();
    expect(separator).toHaveAttribute("aria-valuenow", DEFAULT_NOW);
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    // Sidebar's share is the smaller side: ~38.2%, chat ~61.8%.
    expect(DEFAULT_SPLIT_RATIO).toBeCloseTo(38.2, 1);
    expect(DEFAULT_SPLIT_RATIO).toBeLessThan(50);
    expect(pane.style.flexBasis).toBe(`${DEFAULT_SPLIT_RATIO}%`);
  });

  it("ArrowLeft grows the sidebar, ArrowRight shrinks it", () => {
    const { separator, pane } = setup();
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(
      DEFAULT_SPLIT_RATIO,
    );
    const grown = pane.style.flexBasis;

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeLessThan(
      DEFAULT_SPLIT_RATIO,
    );
    expect(pane.style.flexBasis).not.toBe(grown);
  });

  it("clamps at the bounds under repeated presses", () => {
    const { separator } = setup();
    for (let i = 0; i < 40; i++)
      fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "20");

    for (let i = 0; i < 40; i++)
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "80");
  });

  it("Home and double-click snap back to the default golden-ratio split", () => {
    const { separator, pane } = setup();
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).not.toHaveAttribute("aria-valuenow", DEFAULT_NOW);

    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", DEFAULT_NOW);

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute("aria-valuenow", DEFAULT_NOW);
    expect(pane.style.flexBasis).toBe(`${DEFAULT_SPLIT_RATIO}%`);
  });
});
