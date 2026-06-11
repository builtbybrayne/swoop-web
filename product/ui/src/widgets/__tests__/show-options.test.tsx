// product/ui/src/widgets/__tests__/show-options.test.tsx
//
// `show_options` is the visitor-facing half of the goofy-goldstine find/show
// split: the agent curates ids after browsing privately and this widget
// hydrates the full polymorphic ProposalCards. Card-rendering coverage
// carried over from the pre-split find-options tests (the four variant
// renderers are shared sub-components), plus the new grouping behaviour:
// primary grid + also_interesting compact strip.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  SampleShowOptionsOutput,
  SampleHotelProposalCard,
  SampleRegionBaseProposalCard,
  SampleTourProposalCard,
  SampleTripProposalCard,
} from "@swoop/common/fixtures";
import { ShowOptionsWidget } from "../show-options";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_show_1",
    toolName: "show_options",
    args: { items: [{ type: "trip", id: 1042, group: "primary" }] },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof ShowOptionsWidget>;
}

afterEach(() => cleanup());

describe("ShowOptionsWidget", () => {
  it("renders all four variants from the mixed fixture (polymorphic dispatch)", () => {
    render(
      <ShowOptionsWidget {...mockProps({ result: SampleShowOptionsOutput })} />,
    );

    const root = screen.getByTestId("show-options");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("data-swoop-widget", "show-options");

    expect(screen.getByTestId("find-options-trip-card")).toBeInTheDocument();
    expect(screen.getByTestId("find-options-tour-card")).toBeInTheDocument();
    expect(screen.getByTestId("find-options-hotel-card")).toBeInTheDocument();
    expect(
      screen.getByTestId("find-options-region-base-card"),
    ).toBeInTheDocument();
  });

  it("splits primary grid from the also_interesting strip", () => {
    const { container } = render(
      <ShowOptionsWidget {...mockProps({ result: SampleShowOptionsOutput })} />,
    );

    const primary = container.querySelector(
      '[data-swoop-part="show-options-primary"]',
    );
    const strip = container.querySelector(
      '[data-swoop-part="show-options-also-interesting"]',
    );
    expect(primary).not.toBeNull();
    expect(strip).not.toBeNull();

    // The region_base card is the lone also_interesting item in the fixture —
    // it renders inside the strip, not the primary grid.
    expect(
      strip!.querySelector('[data-testid="find-options-region-base-card"]'),
    ).not.toBeNull();
    expect(
      primary!.querySelector('[data-testid="find-options-region-base-card"]'),
    ).toBeNull();
    // Strip carries its visitor-readable label.
    expect(strip!.textContent).toContain("Also worth a look");
  });

  it("omits the strip when every card is primary", () => {
    const result = {
      cards: [
        { ...SampleTripProposalCard, group: "primary" },
        { ...SampleTourProposalCard, group: "primary" },
      ],
    };
    const { container } = render(
      <ShowOptionsWidget {...mockProps({ result })} />,
    );
    expect(
      container.querySelector('[data-swoop-part="show-options-primary"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-swoop-part="show-options-also-interesting"]',
      ),
    ).toBeNull();
  });

  it("surfaces the group-size badge on a tour card (Luke salience hook)", () => {
    const result = { cards: [{ ...SampleTourProposalCard, group: "primary" }] };
    render(<ShowOptionsWidget {...mockProps({ result })} />);

    const badge = screen.getByTestId("find-options-tour-group-size");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(
      `max ${SampleTourProposalCard.groupSizeMax} guests`,
    );
  });

  it("renders /night pricing for hotel cards (the per_night discriminator)", () => {
    const result = {
      cards: [{ ...SampleHotelProposalCard, group: "primary" }],
    };
    render(<ShowOptionsWidget {...mockProps({ result })} />);

    expect(screen.getByText(/from £920 \/ night/i)).toBeInTheDocument();
    expect(
      screen.getByTestId("find-options-hotel-star-rating"),
    ).toBeInTheDocument();
  });

  it("renders the use-as-a-base framing on region_base cards", () => {
    const result = {
      cards: [{ ...SampleRegionBaseProposalCard, group: "primary" }],
    };
    render(<ShowOptionsWidget {...mockProps({ result })} />);

    const framing = screen.getByTestId("find-options-region-base-framing");
    expect(framing).toBeInTheDocument();
    expect(framing.textContent).toContain("Use El Calafate as a base");
  });

  it("renders trip-card CTAs as new-tab anchors", () => {
    const result = { cards: [{ ...SampleTripProposalCard, group: "primary" }] };
    render(<ShowOptionsWidget {...mockProps({ result })} />);
    const link = screen.getByRole("link", {
      name: new RegExp(
        `Read more about ${SampleTripProposalCard.headline}`,
        "i",
      ),
    });
    expect(link).toHaveAttribute("href", SampleTripProposalCard.canonicalUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the dev silent indicator when cards are empty (prod stays silent)", () => {
    render(<ShowOptionsWidget {...mockProps({ result: { cards: [] } })} />);
    expect(screen.queryByTestId("show-options")).toBeNull();
    const silent = screen.getByTestId("widget-silent");
    expect(silent).toHaveAttribute("data-swoop-widget", "show-options");
    expect(silent.textContent).toContain("show_options");
  });

  it("falls back to the placeholder on a malformed result", () => {
    render(
      <ShowOptionsWidget
        {...mockProps({ result: { cards: "not-an-array" } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });

  it("rejects cards missing the group field (schema is the contract)", () => {
    // A card without `group` is the pre-split shape leaking through — the
    // widget must not guess; it surfaces malformed instead.
    render(
      <ShowOptionsWidget
        {...mockProps({ result: { cards: [SampleTripProposalCard] } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
