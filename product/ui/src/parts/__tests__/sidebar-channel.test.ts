// product/ui/src/parts/__tests__/sidebar-channel.test.ts
//
// Unit coverage for the sidebar projection store: append-by-id, update-in-
// place (keeps arrival position), snapshot referential stability, subscriber
// notification (and idempotent no-op skip), and reset.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  publishSidebarWidget,
  resetSidebar,
  subscribeSidebar,
  getSidebarSnapshot,
  type SidebarWidgetEntry,
} from "../sidebar-channel";

function entry(
  toolCallId: string,
  overrides: Partial<SidebarWidgetEntry> = {},
): SidebarWidgetEntry {
  return {
    toolCallId,
    toolName: "find_proof",
    args: {},
    result: { proofs: [] },
    status: { type: "complete" },
    isError: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetSidebar();
});

describe("sidebar-channel store", () => {
  it("appends a first publish in arrival order", () => {
    publishSidebarWidget(entry("a"));
    publishSidebarWidget(entry("b"));
    expect(getSidebarSnapshot().map((e) => e.toolCallId)).toEqual(["a", "b"]);
  });

  it("updates in place on re-publish of the same toolCallId, keeping position", () => {
    publishSidebarWidget(entry("a", { result: { proofs: [{ id: 1 }] } }));
    publishSidebarWidget(entry("b"));
    // Re-publish "a" with a new result — must stay first, payload replaced.
    const newResult = { proofs: [{ id: 1 }, { id: 2 }] };
    publishSidebarWidget(entry("a", { result: newResult }));

    const snap = getSidebarSnapshot();
    expect(snap.map((e) => e.toolCallId)).toEqual(["a", "b"]);
    expect(snap[0].result).toBe(newResult);
  });

  it("returns a referentially stable snapshot between mutations", () => {
    publishSidebarWidget(entry("a"));
    const first = getSidebarSnapshot();
    const second = getSidebarSnapshot();
    expect(first).toBe(second);
    // A mutation produces a new snapshot reference.
    publishSidebarWidget(entry("b"));
    expect(getSidebarSnapshot()).not.toBe(first);
  });

  it("notifies subscribers on a changing publish and skips no-op re-publishes", () => {
    const listener = vi.fn();
    const unsub = subscribeSidebar(listener);

    const e = entry("a");
    publishSidebarWidget(e);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same payload (identical args/result refs, status, isError) → no emit.
    publishSidebarWidget(e);
    expect(listener).toHaveBeenCalledTimes(1);

    // Streaming update (new result ref) → emit.
    publishSidebarWidget(entry("a", { result: { proofs: [{ id: 9 }] } }));
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    publishSidebarWidget(entry("c"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clears all entries and notifies on reset (no-op when already empty)", () => {
    const listener = vi.fn();
    subscribeSidebar(listener);

    publishSidebarWidget(entry("a"));
    publishSidebarWidget(entry("b"));
    listener.mockClear();

    resetSidebar();
    expect(getSidebarSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);

    // Already empty → no further notification.
    resetSidebar();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
