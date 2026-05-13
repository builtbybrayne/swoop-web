// product/ui/src/widgets/__tests__/find-inspiring.test.tsx
//
// Covers the Inspire panel: happy-path rendering against the canonical
// fixture (passages + image + region tag + deep-link), the empty-state
// branch, and the malformed-output fallback.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SampleFindInspiringOutput } from "@swoop/common/fixtures";
import { FindInspiringWidget } from "../find-inspiring";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_inspire_1",
    toolName: "find_inspiring",
    args: { query: "torres del paine" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof FindInspiringWidget>;
}

afterEach(() => cleanup());

describe("FindInspiringWidget", () => {
  it("renders one passage card per passage with prose, region tag, and deep-link", () => {
    render(<FindInspiringWidget {...mockProps({ result: SampleFindInspiringOutput })} />);

    const root = screen.getByTestId("find-inspiring");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("data-swoop-part", "widget");
    expect(root).toHaveAttribute("data-swoop-widget", "find-inspiring");

    // Passage prose visible.
    const passage = SampleFindInspiringOutput.passages[0];
    expect(screen.getByText(new RegExp(passage.text.slice(0, 40), "i"))).toBeInTheDocument();

    // Region tag visible.
    expect(screen.getByTestId("find-inspiring-region")).toHaveTextContent(
      passage.region ?? "",
    );

    // Deep-link opens in new tab.
    const link = screen.getByTestId("find-inspiring-link");
    expect(link).toHaveAttribute("href", passage.canonicalUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when the passage list is empty (agent handles in prose)", () => {
    // Per crosscut plan 03-exec-crosscut-brave-pare-widget-user-copy-fix.md
    // — empty results yield to the conversational agent, no widget chrome.
    const { container } = render(
      <FindInspiringWidget
        {...mockProps({ result: { passages: [], count: 0 } })}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("falls back to the placeholder on a malformed result", () => {
    render(
      <FindInspiringWidget
        {...mockProps({ result: { passages: "not-an-array", count: 0 } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
