// product/ui/src/widgets/__tests__/search-results.test.tsx
//
// Covers the happy-path render, the lifecycle gate, and schema-drift safety
// for the `search` widget.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SearchResultsWidget } from "../search-results";
import {
  SampleTrip,
  SampleTour,
  SampleRegion,
} from "@swoop/common/fixtures";

/** Build a minimal ToolCallMessagePartProps-shaped mock. */
function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_1",
    toolName: "search",
    args: {},
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof SearchResultsWidget>;
}

afterEach(() => cleanup());

describe("SearchResultsWidget", () => {
  it("renders cards for each hit built from fixture data", () => {
    const result = {
      hits: [
        {
          entityType: "trip",
          id: SampleTrip.id,
          slug: SampleTrip.slug,
          title: SampleTrip.title,
          summary: SampleTrip.summary,
          score: 0.95,
          heroImageUrl: SampleTrip.heroImageUrl,
          publicUrl: "https://www.swoop-patagonia.com/trips/w-trek",
        },
        {
          entityType: "tour",
          id: SampleTour.id,
          slug: SampleTour.slug,
          title: SampleTour.title,
          summary: SampleTour.summary,
          score: 0.88,
          heroImageUrl: SampleTour.heroImageUrl,
        },
        {
          entityType: "region",
          id: SampleRegion.id,
          slug: SampleRegion.slug,
          title: SampleRegion.title,
          summary: SampleRegion.summary,
          score: 0.72,
        },
      ],
      totalMatches: 3,
    };
    render(<SearchResultsWidget {...mockProps({ result })} />);

    expect(screen.getByTestId("search-results")).toBeInTheDocument();
    expect(screen.getByText(SampleTrip.title)).toBeInTheDocument();
    expect(screen.getByText(SampleTour.title)).toBeInTheDocument();
    expect(screen.getByText(SampleRegion.title)).toBeInTheDocument();

    const types = screen.getAllByTestId("search-result-type").map((el) => el.textContent);
    expect(types).toEqual(["Trip", "Tour", "Region"]);

    // Deep-link CTA is only rendered for hits that carry publicUrl.
    const wTrekLink = screen.getByRole("link", {
      name: /Open Torres del Paine W Trek/i,
    });
    expect(wTrekLink).toHaveAttribute("target", "_blank");
    expect(wTrekLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the loading placeholder while the tool call is running", () => {
    render(
      <SearchResultsWidget
        {...mockProps({ status: { type: "running" }, result: undefined })}
      />,
    );
    expect(screen.getByTestId("widget-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
  });

  it("renders a malformed placeholder when the result doesn't match the schema", () => {
    render(
      <SearchResultsWidget
        {...mockProps({ result: { wrong: "shape" } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });

  it("renders an empty message when totalMatches is zero", () => {
    render(
      <SearchResultsWidget
        {...mockProps({ result: { hits: [], totalMatches: 0 } })}
      />,
    );
    expect(screen.getByTestId("search-results-empty")).toBeInTheDocument();
  });
});
