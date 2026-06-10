// product/ui/src/widgets/__tests__/source-title-anchors.test.tsx
//
// "Find out more about {sourceTitle} →" anchor rendering across the three
// link-bearing widgets (lookup, find-inspiring, find-proof), per the
// retrieval-provenance plan §1.4 (planning/03-exec-crosscut-magical-poincare-
// retrieval-provenance.md) + visual-channel plan §2.2.
//
// WHY THE MOCK: today the shared `*Public` schemas in @swoop/common are
// `.strict()`, so a result carrying the provenance `sourceTitle` enrichment
// would fail the widgets' outer envelope validation. The provenance workstream
// adds `sourceTitle` as an optional field to those schemas; this file mocks
// the three output schemas to that loosened vintage so the widgets' local
// defensive reads (EnrichedChunkSchema et al.) can be exercised end-to-end
// now. Once @swoop/common ships optional `sourceTitle`, the mock becomes a
// harmless near-no-op — keep the tests, the mock can be deleted at leisure.
//
// Fallback behaviour (no sourceTitle → each widget's legacy anchor copy) is
// covered in the per-widget test files against the REAL schemas.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";

vi.mock("@swoop/common", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { z } = await import("zod");
  const loosenedOutput = (listKey: string) =>
    z
      .object({
        [listKey]: z.array(z.object({}).passthrough()),
        count: z.number().int().nonnegative().optional(),
      })
      .passthrough();
  return {
    ...mod,
    LookupOutputSchema: loosenedOutput("chunks"),
    FindInspiringOutputSchema: loosenedOutput("passages"),
    FindProofOutputSchema: loosenedOutput("proofs"),
  };
});

import {
  SampleFindInspiringOutput,
  SampleFindProofOutput,
  SampleInformChunkPublic,
} from "@swoop/common/fixtures";
import { LookupWidget } from "../lookup";
import { FindInspiringWidget } from "../find-inspiring";
import { FindProofWidget } from "../find-proof";

function toolProps(toolName: string, result: unknown) {
  return {
    type: "tool-call",
    toolCallId: `call_${toolName}_title`,
    toolName,
    args: {},
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" },
    result,
  } as unknown as ToolCallMessagePartProps<unknown, unknown>;
}

afterEach(() => cleanup());

describe("lookup — title anchor", () => {
  it("renders 'Find out more about {title} →' and folds the question hint away", () => {
    const result = {
      chunks: [
        {
          ...SampleInformChunkPublic,
          sourceTitle: "Visiting Torres del Paine in December",
        },
      ],
      count: 1,
    };
    render(<LookupWidget {...toolProps("lookup", result)} />);

    const link = screen.getByTestId("lookup-link");
    expect(link).toHaveTextContent(
      "Find out more about Visiting Torres del Paine in December →",
    );
    expect(link).toHaveAttribute("href", SampleInformChunkPublic.canonicalUrl);
    // The title carries the page-naming job — no separate hint element.
    expect(screen.queryByTestId("lookup-hint")).toBeNull();
  });

  it("decodes HTML entities in the title", () => {
    const result = {
      chunks: [
        {
          ...SampleInformChunkPublic,
          sourceTitle: "Glaciers &amp; Icefields of Patagonia",
        },
      ],
      count: 1,
    };
    render(<LookupWidget {...toolProps("lookup", result)} />);

    expect(screen.getByTestId("lookup-link")).toHaveTextContent(
      "Find out more about Glaciers & Icefields of Patagonia →",
    );
  });

  it("truncates long titles to ~60 chars with an ellipsis", () => {
    const result = {
      chunks: [
        {
          ...SampleInformChunkPublic,
          sourceTitle:
            "The Complete Guide to Trekking Torres del Paine National Park in Chile",
        },
      ],
      count: 1,
    };
    render(<LookupWidget {...toolProps("lookup", result)} />);

    const link = screen.getByTestId("lookup-link");
    expect(link.textContent).toContain("Find out more about The Complete Guide");
    expect(link.textContent).toContain("…");
    expect(link.textContent).not.toContain("in Chile");
  });

  it("falls back to the legacy copy when sourceTitle is null or blank", () => {
    for (const sourceTitle of [null, "   "]) {
      cleanup();
      const result = {
        chunks: [{ ...SampleInformChunkPublic, sourceTitle }],
        count: 1,
      };
      render(<LookupWidget {...toolProps("lookup", result)} />);
      expect(screen.getByTestId("lookup-link")).toHaveTextContent(
        /Read the full guide on swoop-patagonia\.com/,
      );
    }
  });
});

describe("find-inspiring — title anchor", () => {
  it("renders 'Find out more about {title} →' on the passage deep-link", () => {
    const result = {
      passages: [
        {
          ...SampleFindInspiringOutput.passages[0],
          sourceTitle: "Torres del Paine: An Introduction",
        },
      ],
      count: 1,
    };
    render(<FindInspiringWidget {...toolProps("find_inspiring", result)} />);

    expect(screen.getByTestId("find-inspiring-link")).toHaveTextContent(
      "Find out more about Torres del Paine: An Introduction →",
    );
  });

  it("keeps the legacy copy for passages without a title", () => {
    render(
      <FindInspiringWidget
        {...toolProps("find_inspiring", SampleFindInspiringOutput)}
      />,
    );
    expect(screen.getByTestId("find-inspiring-link")).toHaveTextContent(
      /Read more on swoop-patagonia\.com/,
    );
  });
});

describe("find-proof — title anchor", () => {
  it("renders 'Find out more about {title} →' on the pulled-quote link", () => {
    const result = {
      proofs: [
        {
          ...SampleFindProofOutput.proofs[0],
          sourceTitle: "Swoop &amp; B Corp: our certification",
        },
      ],
      count: 1,
    };
    render(<FindProofWidget {...toolProps("find_proof", result)} />);

    expect(screen.getByTestId("find-proof-link")).toHaveTextContent(
      "Find out more about Swoop & B Corp: our certification →",
    );
  });

  it("keeps the legacy copy for proofs without a title", () => {
    render(<FindProofWidget {...toolProps("find_proof", SampleFindProofOutput)} />);
    expect(screen.getByTestId("find-proof-link")).toHaveTextContent(/Read more/);
  });
});
