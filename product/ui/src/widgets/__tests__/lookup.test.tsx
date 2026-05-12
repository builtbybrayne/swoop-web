// product/ui/src/widgets/__tests__/lookup.test.tsx
//
// Covers the Inform quiet source-page affordance: single-URL collapse to one
// affordance, multi-URL up-to-two stacked, no-URL renders nothing, and
// empty-chunks renders nothing.

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

  it("renders up to two affordances when chunks span multiple canonicalUrls", () => {
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
    // Capped at 2.
    expect(links).toHaveLength(2);

    // Hints visible above each link.
    const hints = screen.getAllByTestId("lookup-hint");
    expect(hints).toHaveLength(2);
  });

  it("renders nothing when chunks lack canonicalUrls", () => {
    const result = {
      chunks: [
        {
          ...SampleInformChunkPublic,
          canonicalUrl: null,
        },
      ],
      count: 1,
    };
    const { container } = render(<LookupWidget {...mockProps({ result })} />);
    expect(screen.queryByTestId("lookup")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the chunks list is empty", () => {
    const { container } = render(
      <LookupWidget {...mockProps({ result: { chunks: [], count: 0 } })} />,
    );
    expect(screen.queryByTestId("lookup")).toBeNull();
    expect(container.textContent).toBe("");
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
  });
});
