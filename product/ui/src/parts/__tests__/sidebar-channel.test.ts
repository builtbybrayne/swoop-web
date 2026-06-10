// product/ui/src/parts/__tests__/sidebar-channel.test.ts
//
// Unit coverage for the sidebar projection store: append-by-id, update-in-
// place (keeps arrival position), snapshot referential stability, subscriber
// notification (and idempotent no-op skip), reset — plus the static-card
// entry kind (D.poincare-4): once-per-conversation via id-keying, pinned
// above tool-parts, dismissal, and reset clearing the dismissal.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  publishSidebarWidget,
  publishStaticCard,
  dismissStaticCard,
  resetSidebar,
  subscribeSidebar,
  getSidebarSnapshot,
  type SidebarEntry,
  type SidebarToolPartEntry,
  type SidebarWidgetEntry,
  type StaticCardPayload,
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

const CARD_PAYLOAD: StaticCardPayload = {
  title: "About Swoop Planning Specialists",
  lines: ["Line one.", "Line two."],
};

/** Narrow a snapshot entry to a tool-part, failing loudly on a static card. */
function asToolPart(e: SidebarEntry): SidebarToolPartEntry {
  if (e.kind !== "tool-part") throw new Error("expected a tool-part entry");
  return e;
}

beforeEach(() => {
  resetSidebar();
});

describe("sidebar-channel store", () => {
  it("appends a first publish in arrival order", () => {
    publishSidebarWidget(entry("a"));
    publishSidebarWidget(entry("b"));
    expect(getSidebarSnapshot().map((e) => asToolPart(e).toolCallId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("updates in place on re-publish of the same toolCallId, keeping position", () => {
    publishSidebarWidget(entry("a", { result: { proofs: [{ id: 1 }] } }));
    publishSidebarWidget(entry("b"));
    // Re-publish "a" with a new result — must stay first, payload replaced.
    const newResult = { proofs: [{ id: 1 }, { id: 2 }] };
    publishSidebarWidget(entry("a", { result: newResult }));

    const snap = getSidebarSnapshot();
    expect(snap.map((e) => asToolPart(e).toolCallId)).toEqual(["a", "b"]);
    expect(asToolPart(snap[0]).result).toBe(newResult);
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

describe("sidebar-channel static cards (D.poincare-4)", () => {
  it("appends a static card once — repeat publishes for the same id are no-ops", () => {
    const listener = vi.fn();
    subscribeSidebar(listener);

    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    expect(listener).toHaveBeenCalledTimes(1);

    // Multi-mention conversations / rehydrate replay / StrictMode all re-fire
    // the trigger; id-keying collapses them to the one entry, no re-emit.
    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    publishStaticCard("terminology:specialists", {
      title: "different",
      lines: ["payload ignored — first publish wins"],
    });
    expect(listener).toHaveBeenCalledTimes(1);

    const snap = getSidebarSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      kind: "static-card",
      id: "terminology:specialists",
      payload: CARD_PAYLOAD,
    });
  });

  it("sorts static cards above tool-part entries regardless of arrival order", () => {
    publishSidebarWidget(entry("a"));
    publishSidebarWidget(entry("b"));
    publishStaticCard("terminology:specialists", CARD_PAYLOAD);

    expect(
      getSidebarSnapshot().map((e) =>
        e.kind === "static-card" ? e.id : e.toolCallId,
      ),
    ).toEqual(["terminology:specialists", "a", "b"]);
  });

  it("dismiss removes the card, notifies, and blocks re-publication", () => {
    const listener = vi.fn();
    subscribeSidebar(listener);

    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    listener.mockClear();

    dismissStaticCard("terminology:specialists");
    expect(getSidebarSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);

    // Later trigger fires in the same conversation must not resurrect it.
    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    expect(getSidebarSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);

    // Dismissing an absent id is silent.
    dismissStaticCard("terminology:specialists");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reset clears the dismissal — a fresh conversation can re-earn the card", () => {
    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    dismissStaticCard("terminology:specialists");
    resetSidebar();

    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    expect(getSidebarSnapshot()).toHaveLength(1);
  });

  it("reset clears static cards together with tool-parts", () => {
    publishStaticCard("terminology:specialists", CARD_PAYLOAD);
    publishSidebarWidget(entry("a"));
    resetSidebar();
    expect(getSidebarSnapshot()).toEqual([]);
  });
});
