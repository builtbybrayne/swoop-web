// product/ui/src/widgets/__tests__/inspiration.test.tsx
//
// Covers the `illustrate` widget happy path + lightbox expansion.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InspirationWidget } from "../inspiration";
import { SampleImage } from "@swoop/common/fixtures";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_3",
    toolName: "illustrate",
    args: { keywords: ["puma"] },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof InspirationWidget>;
}

afterEach(() => cleanup());

describe("InspirationWidget", () => {
  it("renders a gallery strip with mood tags and expands on click", () => {
    const result = {
      images: [
        {
          id: SampleImage.id,
          url: SampleImage.url,
          altText: SampleImage.altText,
          caption: SampleImage.summary,
          moodTags: ["dramatic", "dawn"],
        },
        {
          id: "image_glacier_002",
          url: "https://cdn.example.com/puma-fixtures/glacier.jpg",
          altText: "Blue glacier wall at midday",
          moodTags: ["still"],
        },
      ],
    };

    render(<InspirationWidget {...mockProps({ result })} />);

    const gallery = screen.getByTestId("inspiration");
    expect(gallery).toBeInTheDocument();

    const moods = screen.getAllByTestId("inspiration-moods");
    expect(moods).toHaveLength(2);
    expect(moods[0]).toHaveTextContent("dramatic");
    expect(moods[0]).toHaveTextContent("dawn");

    // Expand first image
    const firstTrigger = screen.getByRole("button", {
      name: new RegExp(`Expand image: ${SampleImage.altText}`, "i"),
    });
    fireEvent.click(firstTrigger);
    const lightbox = screen.getByTestId("inspiration-lightbox");
    expect(lightbox).toBeInTheDocument();
    expect(lightbox).toHaveAttribute("role", "dialog");

    // Close via the button
    fireEvent.click(screen.getByRole("button", { name: /Close expanded image/i }));
    expect(screen.queryByTestId("inspiration-lightbox")).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when the result is malformed", () => {
    render(<InspirationWidget {...mockProps({ result: { images: "nope" } })} />);
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });

  it("shows empty state when the image list is empty", () => {
    render(<InspirationWidget {...mockProps({ result: { images: [] } })} />);
    expect(screen.getByTestId("inspiration-empty")).toBeInTheDocument();
  });
});
