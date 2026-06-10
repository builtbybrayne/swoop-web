// product/ui/src/parts/__tests__/terminology-card.test.tsx
//
// Coverage for the "About Swoop Planning Specialists" terminology card
// (D.poincare-4): the settled-text trigger (debounce semantics, role gate,
// term variants, once-across-replay) and the card component (cms-sourced
// copy, dismiss).
//
// The trigger publishes through the real sidebar store, so these tests assert
// against `getSidebarSnapshot()` — the same observable surface the sidebar
// renders from.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { act } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import {
  getSidebarSnapshot,
  publishStaticCard,
  resetSidebar,
} from "../sidebar-channel";
import {
  useSpecialistTermTrigger,
  getTerminologyCardContent,
  TERMINOLOGY_CARD_ID,
  TERM_SETTLE_MS,
} from "../terminology-trigger";
import { TerminologyCard } from "../terminology-card";

/** Minimal host for the trigger hook — the assistant-text render path stand-in. */
function Harness({
  text,
  enabled = true,
}: {
  text: string;
  enabled?: boolean;
}) {
  useSpecialistTermTrigger(text, enabled);
  return null;
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSidebar();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSpecialistTermTrigger", () => {
  it("publishes the card only after the text has settled", () => {
    render(<Harness text="Our Swoop Planning Specialists design trips for a living." />);

    advance(TERM_SETTLE_MS - 1);
    expect(getSidebarSnapshot()).toHaveLength(0);

    advance(1);
    const snap = getSidebarSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      kind: "static-card",
      id: TERMINOLOGY_CARD_ID,
    });
  });

  it("re-arms while text is still streaming — no mid-stream fire", () => {
    const { rerender } = render(
      // Mid-stream: the model has typed the singular so far.
      <Harness text="…talk to a Swoop Planning Specialist" />,
    );
    advance(TERM_SETTLE_MS - 100);

    // Next chunk lands before the settle window closes → timer restarts.
    rerender(
      <Harness text="…talk to a Swoop Planning Specialists are the team who" />,
    );
    advance(TERM_SETTLE_MS - 100);
    expect(getSidebarSnapshot()).toHaveLength(0);

    // Stream has settled; the full window elapses → exactly one publish.
    advance(100);
    expect(getSidebarSnapshot()).toHaveLength(1);
  });

  it("never fires for text without the canonical term", () => {
    render(<Harness text="Our planning specialists know the routes first-hand." />);
    advance(TERM_SETTLE_MS * 4);
    expect(getSidebarSnapshot()).toHaveLength(0);
  });

  it("never fires when disabled (visitor-typed text)", () => {
    render(
      <Harness
        text="What are Swoop Planning Specialists?"
        enabled={false}
      />,
    );
    advance(TERM_SETTLE_MS * 4);
    expect(getSidebarSnapshot()).toHaveLength(0);
  });

  it("matches the possessive and the typographic-apostrophe variants", () => {
    render(<Harness text="Swoop’s planning specialists have been there." />);
    advance(TERM_SETTLE_MS);
    expect(getSidebarSnapshot()).toHaveLength(1);
  });

  it("publishes once across replayed history (rehydrate, plan §1.3)", () => {
    // A reload replays multiple assistant messages mentioning the term; each
    // renders through the same text path and fires the trigger. The id-keyed
    // store collapses them to one card.
    render(
      <>
        <Harness text="Swoop Planning Specialists design trips for a living." />
        <Harness text="One of our Swoop Planning Specialists can take it from here." />
      </>,
    );
    advance(TERM_SETTLE_MS);
    expect(getSidebarSnapshot()).toHaveLength(1);
  });

  it("publishes the cms-sourced content as the card payload", () => {
    render(<Harness text="Meet the Swoop Planning Specialists." />);
    advance(TERM_SETTLE_MS);

    const snap = getSidebarSnapshot();
    expect(snap[0]).toMatchObject({
      kind: "static-card",
      payload: getTerminologyCardContent(),
    });
    // Sanity: the content really came from cms/ (title + 2-3 lines, no CTA).
    const content = getTerminologyCardContent();
    expect(content.title.length).toBeGreaterThan(0);
    expect(content.lines.length).toBeGreaterThanOrEqual(2);
    expect(content.lines.length).toBeLessThanOrEqual(3);
  });
});

describe("TerminologyCard", () => {
  const entry = {
    kind: "static-card",
    id: TERMINOLOGY_CARD_ID,
    payload: {
      title: "About Swoop Planning Specialists",
      lines: ["They design trips for a living.", "First-hand knowledge."],
    },
  } as const;

  it("renders title and lines under the stable styling seam", () => {
    render(<TerminologyCard entry={entry} />);

    const card = document.querySelector(
      '[data-swoop-widget="terminology-card"]',
    );
    expect(card).not.toBeNull();
    expect(
      screen.getByText("About Swoop Planning Specialists"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("They design trips for a living."),
    ).toBeInTheDocument();
    expect(screen.getByText("First-hand knowledge.")).toBeInTheDocument();
  });

  it("dismiss is a labelled button that removes the card from the store", () => {
    publishStaticCard(entry.id, entry.payload);
    render(<TerminologyCard entry={entry} />);

    // Native <button> with an accessible name — keyboard reachable by
    // construction (plan §4.4).
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    act(() => {
      dismiss.click();
    });

    expect(getSidebarSnapshot()).toHaveLength(0);
    // Stays gone for the conversation.
    publishStaticCard(entry.id, entry.payload);
    expect(getSidebarSnapshot()).toHaveLength(0);
  });
});
