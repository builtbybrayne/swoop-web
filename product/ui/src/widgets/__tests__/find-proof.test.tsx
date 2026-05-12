// product/ui/src/widgets/__tests__/find-proof.test.tsx
//
// Covers the Reassure pulled-quote: happy-path against the canonical fixture
// (claim lead-in + evidence prose + "Read more →" link), the empty-result
// case (renders nothing — Reassure with no evidence is silence, not a
// disclosure), and the malformed fallback.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SampleFindProofOutput } from "@swoop/common/fixtures";
import { FindProofWidget } from "../find-proof";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_proof_1",
    toolName: "find_proof",
    args: { concern: "b-corp credibility" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof FindProofWidget>;
}

afterEach(() => cleanup());

describe("FindProofWidget", () => {
  it("renders a pulled-quote per proof with claim, evidence, and a new-tab Read more link", () => {
    render(<FindProofWidget {...mockProps({ result: SampleFindProofOutput })} />);

    const root = screen.getByTestId("find-proof");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("data-swoop-widget", "find-proof");

    const proof = SampleFindProofOutput.proofs[0];

    // Claim lead-in visible.
    expect(screen.getByTestId("find-proof-claim")).toHaveTextContent(proof.claim);

    // Evidence prose visible.
    expect(screen.getByTestId("find-proof-evidence")).toHaveTextContent(
      new RegExp(proof.evidence.slice(0, 40), "i"),
    );

    // "Read more →" link → new tab.
    const link = screen.getByTestId("find-proof-link");
    expect(link).toHaveTextContent(/Read more/);
    expect(link).toHaveAttribute("href", proof.canonicalUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when the proofs list is empty (silence, not a disclosure)", () => {
    const { container } = render(
      <FindProofWidget {...mockProps({ result: { proofs: [], count: 0 } })} />,
    );
    // No find-proof root rendered — nothing visible at all from this widget.
    expect(screen.queryByTestId("find-proof")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("falls back to the placeholder on a malformed result", () => {
    render(
      <FindProofWidget
        {...mockProps({ result: { proofs: "not-an-array", count: 0 } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
