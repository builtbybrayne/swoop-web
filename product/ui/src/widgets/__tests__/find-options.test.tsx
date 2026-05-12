// product/ui/src/widgets/__tests__/find-options.test.tsx
//
// Covers the polymorphic Proposal-card set: trips-only (v1 live reality),
// mixed (one of each variant — D.t9 ships all four renderers day-one), the
// tour-card group-size affordance (Luke priority), the hotel-card per-night
// pricing branch, the region-base framing line, the empty-state branch, and
// the malformed fallback.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  SampleFindOptionsOutput,
  SampleFindOptionsOutputMixed,
  SampleHotelProposalCard,
  SampleRegionBaseProposalCard,
  SampleTourProposalCard,
  SampleTripProposalCard,
} from "@swoop/common/fixtures";
import { FindOptionsWidget } from "../find-options";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_options_1",
    toolName: "find_options",
    args: { region: "torres-del-paine" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof FindOptionsWidget>;
}

afterEach(() => cleanup());

describe("FindOptionsWidget", () => {
  it("renders an all-trips set against the v1 fixture", () => {
    render(
      <FindOptionsWidget {...mockProps({ result: SampleFindOptionsOutput })} />,
    );

    const root = screen.getByTestId("find-options");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("data-swoop-widget", "find-options");

    const tripCards = screen.getAllByTestId("find-options-trip-card");
    expect(tripCards).toHaveLength(1);
    expect(tripCards[0]).toHaveAttribute("data-swoop-card-type", "trip");

    // From-price rendered with "from £" prefix per per-type pricing rule
    // (trip = total).
    expect(screen.getByText(/from £2,150/i)).toBeInTheDocument();
  });

  it("renders one of each variant against the mixed fixture (polymorphic dispatch)", () => {
    render(
      <FindOptionsWidget
        {...mockProps({ result: SampleFindOptionsOutputMixed })}
      />,
    );

    expect(screen.getByTestId("find-options-trip-card")).toBeInTheDocument();
    expect(screen.getByTestId("find-options-tour-card")).toBeInTheDocument();
    expect(screen.getByTestId("find-options-hotel-card")).toBeInTheDocument();
    expect(
      screen.getByTestId("find-options-region-base-card"),
    ).toBeInTheDocument();
  });

  it("surfaces the group-size badge on a tour card (Luke salience hook)", () => {
    const result = {
      cards: [SampleTourProposalCard],
      count: 1,
    };
    render(<FindOptionsWidget {...mockProps({ result })} />);

    const badge = screen.getByTestId("find-options-tour-group-size");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(`max ${SampleTourProposalCard.groupSizeMax} guests`);
    // Brand-extension hook present so styling can target the badge.
    expect(badge).toHaveAttribute(
      "data-swoop-part",
      "find-options-tour-group-size",
    );
  });

  it("renders /night pricing for hotel cards (the per_night discriminator)", () => {
    const result = {
      cards: [SampleHotelProposalCard],
      count: 1,
    };
    render(<FindOptionsWidget {...mockProps({ result })} />);

    // Per-night framing, not total.
    expect(screen.getByText(/from £920 \/ night/i)).toBeInTheDocument();
    // Star rating row visible.
    expect(
      screen.getByTestId("find-options-hotel-star-rating"),
    ).toBeInTheDocument();
  });

  it("renders the use-as-a-base framing on region_base cards", () => {
    const result = {
      cards: [SampleRegionBaseProposalCard],
      count: 1,
    };
    render(<FindOptionsWidget {...mockProps({ result })} />);

    const framing = screen.getByTestId("find-options-region-base-framing");
    expect(framing).toBeInTheDocument();
    expect(framing.textContent).toContain("Use El Calafate as a base");
  });

  it("renders trip-card CTAs as new-tab anchors", () => {
    render(
      <FindOptionsWidget {...mockProps({ result: SampleFindOptionsOutput })} />,
    );
    const link = screen.getByRole("link", {
      name: new RegExp(`Read more about ${SampleTripProposalCard.headline}`, "i"),
    });
    expect(link).toHaveAttribute("href", SampleTripProposalCard.canonicalUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows empty state when the cards list is empty", () => {
    render(
      <FindOptionsWidget
        {...mockProps({ result: { cards: [], count: 0 } })}
      />,
    );
    expect(screen.getByTestId("find-options-empty")).toBeInTheDocument();
  });

  it("falls back to the placeholder on a malformed result", () => {
    render(
      <FindOptionsWidget
        {...mockProps({ result: { cards: "not-an-array", count: 0 } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
