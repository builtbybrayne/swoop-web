// product/ui/src/widgets/__tests__/inspiration.test.tsx
//
// Covers the `illustrate` widget: single-hero rendering (no caption, no mood
// chips — D.poincare-2/3, planning/03-exec-crosscut-magical-poincare-visual-
// channel.md), hero+thumbs for agent-explicit multi-image results, lightbox
// expansion without a caption line, and the sidebar-reconstructed prop shape
// (the visual sidebar mounts this same component — see parts/visual-sidebar).

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

/** The prop shape parts/visual-sidebar.tsx reconstructs from the store —
 *  inert transport fields, empty argsText. Rendering through this shape
 *  covers the sidebar mounting path at the widget level. */
function sidebarProps(result: unknown) {
  return {
    type: "tool-call",
    toolCallId: "call_sidebar_3",
    toolName: "illustrate",
    args: {},
    argsText: "",
    result,
    status: { type: "complete" },
    isError: false,
    addResult: () => {},
    resume: () => {},
  } as unknown as React.ComponentProps<typeof InspirationWidget>;
}

const HERO_IMAGE = {
  id: SampleImage.id,
  url: SampleImage.url,
  altText: SampleImage.altText,
  caption: SampleImage.summary,
  moodTags: ["dramatic", "dawn"],
};

const GLACIER_IMAGE = {
  id: "image_glacier_002",
  url: "https://cdn.example.com/puma-fixtures/glacier.jpg",
  altText: "Blue glacier wall at midday",
  moodTags: ["still"],
};

const RIVER_IMAGE = {
  id: "image_river_003",
  url: "https://cdn.example.com/puma-fixtures/river.jpg",
  altText: "Braided river crossing the steppe",
};

afterEach(() => cleanup());

describe("InspirationWidget", () => {
  it("renders a single hero image with no caption and no mood chips", () => {
    const result = { images: [HERO_IMAGE] };

    render(<InspirationWidget {...mockProps({ result })} />);

    expect(screen.getByTestId("inspiration")).toBeInTheDocument();
    expect(screen.getByTestId("inspiration-hero")).toBeInTheDocument();

    // Exactly one image rendered — and no thumbnail row for a 1-image result.
    expect(screen.getAllByTestId("image-block")).toHaveLength(1);
    expect(screen.queryByTestId("inspiration-thumbs")).toBeNull();

    // Annotations are retrieval substrate + alt text, never visitor-visible
    // captions (D.poincare-2): caption text and mood chips are absent.
    expect(screen.queryByText(SampleImage.summary)).toBeNull();
    expect(screen.queryByTestId("inspiration-moods")).toBeNull();
    expect(screen.queryByText("dramatic")).toBeNull();

    // Alt text retained on the rendered image.
    expect(screen.getByAltText(SampleImage.altText)).toBeInTheDocument();
  });

  it("renders hero + small thumbnails when the agent explicitly asked for more", () => {
    const result = { images: [HERO_IMAGE, GLACIER_IMAGE, RIVER_IMAGE] };

    render(<InspirationWidget {...mockProps({ result })} />);

    // First image is the hero…
    const hero = screen.getByTestId("inspiration-hero");
    expect(hero).toHaveAttribute(
      "aria-label",
      `Expand image: ${SampleImage.altText}`,
    );

    // …the rest are thumbnails (hero + 2 thumbs = 3 image blocks total).
    const thumbs = screen.getByTestId("inspiration-thumbs");
    expect(thumbs.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getAllByTestId("image-block")).toHaveLength(3);

    // Still no captions or mood chips anywhere.
    expect(screen.queryByTestId("inspiration-moods")).toBeNull();
    expect(screen.queryByText(SampleImage.summary)).toBeNull();
  });

  it("expands the hero into a captionless lightbox and closes it", () => {
    const result = { images: [HERO_IMAGE] };

    render(<InspirationWidget {...mockProps({ result })} />);

    fireEvent.click(screen.getByTestId("inspiration-hero"));
    const lightbox = screen.getByTestId("inspiration-lightbox");
    expect(lightbox).toBeInTheDocument();
    expect(lightbox).toHaveAttribute("role", "dialog");
    // aria-label carries the alt text; no caption line in the dialog.
    expect(lightbox).toHaveAttribute("aria-label", SampleImage.altText);
    expect(screen.queryByText(SampleImage.summary)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Close expanded image/i }));
    expect(screen.queryByTestId("inspiration-lightbox")).not.toBeInTheDocument();
  });

  it("expands a thumbnail into the lightbox", () => {
    const result = { images: [HERO_IMAGE, GLACIER_IMAGE] };

    render(<InspirationWidget {...mockProps({ result })} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: `Expand image: ${GLACIER_IMAGE.altText}`,
      }),
    );
    const lightbox = screen.getByTestId("inspiration-lightbox");
    expect(lightbox).toHaveAttribute("aria-label", GLACIER_IMAGE.altText);
  });

  it("renders the same single-hero shape from sidebar-reconstructed props", () => {
    render(
      <InspirationWidget
        {...sidebarProps({ images: [HERO_IMAGE, GLACIER_IMAGE] })}
      />,
    );

    expect(screen.getByTestId("inspiration-hero")).toBeInTheDocument();
    expect(screen.getByTestId("inspiration-thumbs")).toBeInTheDocument();
    expect(screen.queryByTestId("inspiration-moods")).toBeNull();
    expect(screen.queryByText(SampleImage.summary)).toBeNull();
  });

  it("falls back to a placeholder when the result is malformed", () => {
    render(<InspirationWidget {...mockProps({ result: { images: "nope" } })} />);
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });

  it("renders images when the result is wrapped in the connector's {ok,value} envelope", () => {
    // Regression: the connector adapter wraps successful results as
    // `{ ok: true, value: { images } }`. Earlier the widget bypassed
    // `safeParse`'s unwrap and read `props.result.images` directly,
    // silently rendering an empty-result placeholder for every real call.
    const result = {
      ok: true as const,
      value: {
        images: [
          {
            id: SampleImage.id,
            url: SampleImage.url,
            altText: SampleImage.altText,
            caption: SampleImage.summary,
          },
        ],
      },
    };

    render(<InspirationWidget {...mockProps({ result })} />);

    expect(screen.getByTestId("inspiration")).toBeInTheDocument();
    expect(screen.getByTestId("inspiration-hero")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-silent")).toBeNull();
  });

  it("renders the dev silent indicator when the image list is empty (prod stays silent)", () => {
    // Visitor-facing chrome is gone (agent prose carries the moment); the
    // dev silent placeholder surfaces what fired and why under Vitest.
    render(
      <InspirationWidget {...mockProps({ result: { images: [] } })} />,
    );
    expect(screen.queryByTestId("inspiration")).toBeNull();
    const silent = screen.getByTestId("widget-silent");
    expect(silent).toHaveAttribute("data-swoop-widget", "inspiration");
    expect(silent.textContent).toContain("illustrate");
    expect(silent.textContent).toContain("empty result");
  });
});
