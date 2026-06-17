// product/ui/src/parts/__tests__/visual-sidebar.test.tsx
//
// Integration coverage for the visual-sidebar relocation:
//   - The registry composition wraps the six display widgets with the
//     sidebar-publish HOC but leaves `handoff` inline-only (asserted via the
//     outermost component's displayName — render-free, so we don't drag in
//     lead-capture's runtime/client mocks).
//   - A wrapped display widget renders its inline copy inside the desktop-hide
//     marker AND publishes its tool-part into the store.
//   - <VisualSidebar/> projects the store: empty state when empty, one
//     sidebar-widget per entry when populated, and tracks reset.
//   - Static-card entries (D.poincare-4) render via TerminologyCard, pinned
//     above the tool-part widgets, dismissable in place.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SampleFindProofOutput } from "@swoop/common/fixtures";
import { messagePartComponents } from "../index";
import { VisualSidebar } from "../visual-sidebar";
import {
  publishSidebarWidget,
  publishStaticCard,
  resetSidebar,
  getSidebarSnapshot,
  type SidebarEntry,
  type SidebarToolPartEntry,
  type SidebarWidgetEntry,
} from "../sidebar-channel";

/** Narrow a snapshot entry to a tool-part, failing loudly on a static card. */
function asToolPart(e: SidebarEntry): SidebarToolPartEntry {
  if (e.kind !== "tool-part") throw new Error("expected a tool-part entry");
  return e;
}

const byName = messagePartComponents.tools.by_name as Record<
  string,
  React.ComponentType<Record<string, unknown>> & { displayName?: string }
>;

function findProofProps(overrides: Record<string, unknown> = {}) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_proof_sidebar",
    toolName: "find_proof",
    args: { concern: "credibility" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    result: SampleFindProofOutput,
    ...overrides,
  };
}

function storeEntry(
  toolCallId: string,
  overrides: Partial<SidebarWidgetEntry> = {},
): SidebarWidgetEntry {
  return {
    toolCallId,
    toolName: "find_proof",
    args: {},
    result: SampleFindProofOutput,
    status: { type: "complete" },
    isError: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetSidebar();
});
afterEach(() => cleanup());

describe("registry composition", () => {
  it("wraps display widgets with the sidebar-publish HOC", () => {
    for (const tool of [
      "find_inspiring",
      "find_someone_who",
      "find_proof",
      "lookup",
      "show_options",
      "illustrate",
    ]) {
      expect(byName[tool]?.displayName).toBe(
        `WrappedWithSidebarPublish(${tool})`,
      );
    }
  });

  it("leaves handoff inline-only (not sidebar-wrapped)", () => {
    // Under Vitest, import.meta.env.DEV is true so dev-trace wraps; the
    // ABSENCE of the sidebar-publish layer is the point.
    expect(byName.handoff?.displayName).toBe("WrappedWithDevTrace(handoff)");
  });

  it("leaves find_options inline-only — it renders nothing (browse tool)", () => {
    // find/show split: find_options is the agent-private browse tool and
    // renders no widget, so it must NOT be sidebar-wrapped. show_options is
    // the visitor-facing card renderer that relocates to the sidebar.
    // Regression guard for the goofy-goldstine split, which moved the
    // renderer (widgets/index.ts) but not the sidebar routing (parts/index.ts).
    expect(byName.find_options?.displayName).toBe(
      "WrappedWithDevTrace(find_options)",
    );
  });
});

describe("display-widget inline copy + publish", () => {
  it("renders the inline copy in the desktop-hide marker and publishes to the store", () => {
    const WrappedFindProof = byName.find_proof;
    render(<WrappedFindProof {...findProofProps()} />);

    // Inline copy still rendered, wrapped in the layout-transparent marker
    // that collapses on desktop (`lg:hidden`).
    const marker = document.querySelector('[data-swoop-inline-widget="true"]');
    expect(marker).not.toBeNull();
    expect(marker?.className).toContain("lg:hidden");
    expect(screen.getByTestId("find-proof")).toBeInTheDocument();

    // Published into the store, keyed by toolCallId.
    const snap = getSidebarSnapshot();
    expect(snap).toHaveLength(1);
    expect(asToolPart(snap[0]).toolCallId).toBe("call_proof_sidebar");
    expect(asToolPart(snap[0]).toolName).toBe("find_proof");
    expect(asToolPart(snap[0]).result).toBe(SampleFindProofOutput);
  });
});

describe("VisualSidebar", () => {
  it("shows the empty state when the store is empty", () => {
    render(<VisualSidebar />);
    expect(
      document.querySelector('[data-swoop-part="visual-sidebar-empty"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-swoop-part="sidebar-widget"]'),
    ).toBeNull();
  });

  it("renders one sidebar-widget per stored entry, using the real widget", () => {
    publishSidebarWidget(storeEntry("a"));
    publishSidebarWidget(storeEntry("b", { toolCallId: "b" }));
    render(<VisualSidebar />);

    expect(
      document.querySelectorAll('[data-swoop-part="sidebar-widget"]'),
    ).toHaveLength(2);
    // The real find-proof widget rendered inside the sidebar (not a stub).
    expect(screen.getAllByTestId("find-proof")).toHaveLength(2);
  });

  it("tracks reset — re-renders to the empty state when the store clears", () => {
    publishSidebarWidget(storeEntry("a"));
    render(<VisualSidebar />);
    expect(
      document.querySelector('[data-swoop-part="sidebar-widget"]'),
    ).not.toBeNull();

    act(() => {
      resetSidebar();
    });

    expect(
      document.querySelector('[data-swoop-part="sidebar-widget"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-swoop-part="visual-sidebar-empty"]'),
    ).not.toBeNull();
  });
});

describe("VisualSidebar static cards (D.poincare-4)", () => {
  const CARD_PAYLOAD = {
    title: "About Swoop Planning Specialists",
    lines: ["They design trips for a living.", "First-hand knowledge."],
  };

  it("renders the terminology card above tool-part widgets, inside the labelled region", () => {
    // Tool-part arrives FIRST; the static card still renders above it.
    publishSidebarWidget(storeEntry("a"));
    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    render(<VisualSidebar />);

    const list = document.querySelector(
      '[data-swoop-part="visual-sidebar-scroll"] > div',
    );
    expect(list).not.toBeNull();
    const children = Array.from(list!.children);
    expect(children[0].getAttribute("data-swoop-widget")).toBe(
      "terminology-card",
    );
    expect(children[1].getAttribute("data-swoop-part")).toBe("sidebar-widget");

    // Part of the existing aria-labelled complementary region (a11y per plan
    // §4.4) — no aria region of its own.
    const aside = document.querySelector('[data-swoop-part="visual-sidebar"]');
    expect(aside?.contains(children[0])).toBe(true);

    // Copy comes through from the payload.
    expect(screen.getByText("About Swoop Planning Specialists")).toBeInTheDocument();
    expect(screen.getByText("They design trips for a living.")).toBeInTheDocument();
  });

  it("dismisses in place — card gone, widgets stay, re-publish blocked", () => {
    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    publishSidebarWidget(storeEntry("a"));
    render(<VisualSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(
      document.querySelector('[data-swoop-widget="terminology-card"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-swoop-part="sidebar-widget"]'),
    ).not.toBeNull();

    // A later trigger fire in the same conversation must not bring it back.
    act(() => {
      publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    });
    expect(
      document.querySelector('[data-swoop-widget="terminology-card"]'),
    ).toBeNull();
  });
});
