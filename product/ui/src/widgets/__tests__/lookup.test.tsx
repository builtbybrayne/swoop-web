// product/ui/src/widgets/__tests__/lookup.test.tsx
//
// Covers the Inform source-page affordance: exactly ONE link card — the top
// (retrieval-rank-first) source page — even when chunks span multiple
// canonical URLs (planning/03-exec-crosscut-magical-poincare-visual-channel.md
// §2.2, Luke Loom feedback D4). No-URL renders nothing; empty-chunks renders
// nothing. Title-anchor rendering (provenance `sourceTitle`) is covered in
// source-title-anchors.test.tsx against the loosened schema vintage.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  SampleInformChunkPublic,
  SampleLookupOutput,
} from "@swoop/common/fixtures";
import { LookupWidget } from "../lookup";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_lookup_1",
    toolName: "lookup",
    args: { question: "how long is the W trek" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof LookupWidget>;
}

/** The prop shape parts/visual-sidebar.tsx reconstructs from the store —
 *  inert transport fields, empty argsText. Rendering through this shape
 *  covers the sidebar mounting path at the widget level. */
function sidebarProps(result: unknown) {
  return {
    type: "tool-call",
    toolCallId: "call_lookup_sidebar",
    toolName: "lookup",
    args: {},
    argsText: "",
    result,
    status: { type: "complete" },
    isError: false,
    addResult: () => {},
    resume: () => {},
  } as unknown as React.ComponentProps<typeof LookupWidget>;
}

afterEach(() => cleanup());

describe("LookupWidget", () => {
  it("renders one source-page affordance when all chunks share one canonicalUrl", () => {
    const result = {
      chunks: [
        SampleInformChunkPublic,
        {
          ...SampleInformChunkPublic,
          id: "44444444-4444-4444-8444-444444444445",
          question: "Does that mean Refugio Grey books out fast?",
        },
      ],
      count: 2,
    };
    render(<LookupWidget {...mockProps({ result })} />);

    const root = screen.getByTestId("lookup");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("data-swoop-widget", "lookup");

    const links = screen.getAllByTestId("lookup-link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", SampleInformChunkPublic.canonicalUrl);
    expect(links[0]).toHaveAttribute("target", "_blank");
  });

  it("renders ONLY the top source page when chunks span multiple canonicalUrls", () => {
    // Pre-Luke-feedback this stacked up to two affordances; per visual-channel
    // plan §2.2 the single most-relevant source page is the whole surface —
    // secondary sources live in the agent's prose, not the widget.
    const result = {
      chunks: [
        SampleInformChunkPublic,
        {
          ...SampleInformChunkPublic,
          id: "44444444-4444-4444-8444-444444444446",
          canonicalUrl: "https://swoop-patagonia.com/practical/transport",
          question: "How do I get from Punta Arenas to the park?",
        },
        {
          ...SampleInformChunkPublic,
          id: "44444444-4444-4444-8444-444444444447",
          canonicalUrl: "https://swoop-patagonia.com/practical/visas",
          question: "Do I need a visa?",
        },
      ],
      count: 3,
    };
    render(<LookupWidget {...mockProps({ result })} />);

    const links = screen.getAllByTestId("lookup-link");
    expect(links).toHaveLength(1);
    // The first chunk (retrieval rank order) wins.
    expect(links[0]).toHaveAttribute("href", SampleInformChunkPublic.canonicalUrl);

    // One hint (the top chunk's question), in the no-title fallback shape.
    const hints = screen.getAllByTestId("lookup-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0]).toHaveTextContent(SampleInformChunkPublic.question ?? "");
  });

  it("skips URL-less chunks and surfaces the first chunk that has a canonicalUrl", () => {
    const result = {
      chunks: [
        { ...SampleInformChunkPublic, canonicalUrl: null },
        {
          ...SampleInformChunkPublic,
          id: "44444444-4444-4444-8444-444444444448",
          canonicalUrl: "https://swoop-patagonia.com/practical/transport",
        },
      ],
      count: 2,
    };
    render(<LookupWidget {...mockProps({ result })} />);

    const links = screen.getAllByTestId("lookup-link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute(
      "href",
      "https://swoop-patagonia.com/practical/transport",
    );
  });

  it("renders the single link card from sidebar-reconstructed props", () => {
    render(<LookupWidget {...sidebarProps(SampleLookupOutput)} />);
    expect(screen.getByTestId("lookup")).toBeInTheDocument();
    expect(screen.getAllByTestId("lookup-link")).toHaveLength(1);
  });

  it("renders the dev silent indicator when chunks lack canonicalUrls (prod stays silent)", () => {
    const result = {
      chunks: [
        {
          ...SampleInformChunkPublic,
          canonicalUrl: null,
        },
      ],
      count: 1,
    };
    render(<LookupWidget {...mockProps({ result })} />);
    expect(screen.queryByTestId("lookup")).toBeNull();
    const silent = screen.getByTestId("widget-silent");
    expect(silent).toHaveAttribute("data-swoop-widget", "lookup");
    expect(silent.textContent).toContain("lookup");
    expect(silent.textContent).toContain("no canonical URLs");
  });

  it("renders the dev silent indicator when the chunks list is empty (prod stays silent)", () => {
    render(
      <LookupWidget {...mockProps({ result: { chunks: [], count: 0 } })} />,
    );
    expect(screen.queryByTestId("lookup")).toBeNull();
    const silent = screen.getByTestId("widget-silent");
    expect(silent).toHaveAttribute("data-swoop-widget", "lookup");
    expect(silent.textContent).toContain("empty result");
  });

  it("falls back to the placeholder on a malformed result", () => {
    render(
      <LookupWidget
        {...mockProps({ result: { chunks: "not-an-array", count: 0 } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });

  // Cross-check against the canonical fixture too, since that's the one the
  // happy-path SSE walkthrough exercises.
  it("renders correctly against the canonical SampleLookupOutput fixture", () => {
    render(<LookupWidget {...mockProps({ result: SampleLookupOutput })} />);
    expect(screen.getByTestId("lookup")).toBeInTheDocument();
    const link = screen.getByTestId("lookup-link");
    expect(link).toHaveAttribute(
      "href",
      SampleLookupOutput.chunks[0].canonicalUrl,
    );
    // No provenance title in the fixture → the legacy fallback anchor copy.
    expect(link).toHaveTextContent(/Read the full guide on swoop-patagonia\.com/);
  });
});
