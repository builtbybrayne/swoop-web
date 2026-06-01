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
import { SidebarSplitLayout, clampSplitRatio } from "../sidebar-split";

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

  it("defaults to a 50/50 split", () => {
    const { separator, pane } = setup();
    expect(separator).toHaveAttribute("aria-valuenow", "50");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(pane.style.flexBasis).toBe("50%");
  });

  it("ArrowLeft grows the sidebar, ArrowRight shrinks it", () => {
    const { separator, pane } = setup();
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(50);
    const grown = pane.style.flexBasis;

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeLessThan(50);
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

  it("Home and double-click snap back to 50/50", () => {
    const { separator, pane } = setup();
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).not.toHaveAttribute("aria-valuenow", "50");

    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "50");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute("aria-valuenow", "50");
    expect(pane.style.flexBasis).toBe("50%");
  });
});
