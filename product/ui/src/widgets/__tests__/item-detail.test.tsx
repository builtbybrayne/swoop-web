// product/ui/src/widgets/__tests__/item-detail.test.tsx
//
// Covers the `get_detail` widget happy path + gallery + deep link.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ItemDetailWidget } from "../item-detail";
import { SampleTrip } from "@swoop/common/fixtures";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_2",
    toolName: "get_detail",
    args: { entityType: "trip", slug: SampleTrip.slug },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof ItemDetailWidget>;
}

afterEach(() => cleanup());

describe("ItemDetailWidget", () => {
  it("renders hero, title, summary, attributes, gallery and deep-link CTA", () => {
    const result = {
      entityType: "trip" as const,
      record: {
        ...SampleTrip,
        activities: ["trekking", "photography"],
        budgetBand: "premium",
        gallery: [
          "https://cdn.example.com/puma-fixtures/gallery-1.jpg",
          "https://cdn.example.com/puma-fixtures/gallery-2.jpg",
        ],
        publicUrl: "https://www.swoop-patagonia.com/trips/w-trek",
      },
    };

    render(<ItemDetailWidget {...mockProps({ result })} />);

    const article = screen.getByTestId("item-detail");
    expect(article).toHaveAttribute("data-entity-type", "trip");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(SampleTrip.title);
    expect(screen.getByText(SampleTrip.summary)).toBeInTheDocument();
    expect(screen.getByText(/7 days/)).toBeInTheDocument();
    expect(screen.getByText("torres-del-paine")).toBeInTheDocument();
    expect(screen.getByText("trekking, photography")).toBeInTheDocument();
    expect(screen.getByText("premium")).toBeInTheDocument();

    // Gallery: 2 entries + 1 hero = 3 image-block nodes.
    const imageBlocks = screen.getAllByTestId("image-block");
    expect(imageBlocks.length).toBeGreaterThanOrEqual(3);

    const link = screen.getByRole("link", { name: /Open Torres del Paine W Trek on Swoop/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the malformed placeholder for a missing record", () => {
    render(
      <ItemDetailWidget
        {...mockProps({ result: { entityType: "trip" } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });

  it("renders a loading placeholder pre-output", () => {
    render(
      <ItemDetailWidget
        {...mockProps({ status: { type: "running" }, result: undefined })}
      />,
    );
    expect(screen.getByTestId("widget-loading")).toBeInTheDocument();
  });
});
