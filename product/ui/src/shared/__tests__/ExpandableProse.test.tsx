// product/ui/src/shared/__tests__/ExpandableProse.test.tsx
//
// Behavioural coverage for the inline expand/collapse affordance. JSDOM
// reports scrollHeight === 0 by default, so we stub the relevant geometry
// per test to simulate the overflow / no-overflow branches.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExpandableProse } from "../ExpandableProse";

afterEach(() => cleanup());

/**
 * Force the next ExpandableProse render to look like it overflows by
 * stubbing scrollHeight + clientHeight on all div elements. We can't target
 * just the prose body because JSDOM hands out the same getter to every
 * HTMLDivElement; stubbing on the prototype is fine for the test
 * lifetime since `afterEach(cleanup)` unmounts everything.
 */
function stubOverflow({
  scroll,
  client,
}: {
  scroll: number;
  client: number;
}): void {
  Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scroll,
  });
  Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
    configurable: true,
    get: () => client,
  });
}

describe("ExpandableProse", () => {
  it("renders content without a toggle when it does not overflow", () => {
    stubOverflow({ scroll: 40, client: 40 });
    render(<ExpandableProse content="Short prose." testId="prose" />);
    expect(screen.getByTestId("prose")).toHaveTextContent("Short prose.");
    expect(screen.queryByTestId("prose-toggle")).toBeNull();
  });

  it("shows a Read more toggle when content overflows the clamp", () => {
    stubOverflow({ scroll: 400, client: 60 });
    render(
      <ExpandableProse
        content="A very long stretch of prose that fills more than three lines and therefore requires the visitor to opt into the full reveal."
        testId="prose"
      />,
    );
    const toggle = screen.getByTestId("prose-toggle");
    expect(toggle).toHaveTextContent("Read more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles to Show less + aria-expanded=true on click", () => {
    stubOverflow({ scroll: 400, client: 60 });
    render(
      <ExpandableProse
        content="Long content that overflows the default 3-line clamp."
        testId="prose"
      />,
    );

    const toggle = screen.getByTestId("prose-toggle");
    fireEvent.click(toggle);

    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders HTML content via dangerouslySetInnerHTML when html=true", () => {
    stubOverflow({ scroll: 400, client: 60 });
    render(
      <ExpandableProse
        html
        content="<p><strong>Bold</strong> intro.</p><p>Second para.</p>"
        testId="prose"
      />,
    );
    const body = screen.getByTestId("prose");
    // <strong> renders as a child element, not as escaped text.
    expect(body.querySelector("strong")?.textContent).toBe("Bold");
    expect(body.querySelectorAll("p")).toHaveLength(2);
  });

  it("applies the requested line-clamp class when collapsed", () => {
    stubOverflow({ scroll: 400, client: 60 });
    render(
      <ExpandableProse
        content="Long prose."
        maxLines={5}
        testId="prose"
      />,
    );
    expect(screen.getByTestId("prose").className).toContain("line-clamp-5");
  });

  it("drops the clamp class once expanded", () => {
    stubOverflow({ scroll: 400, client: 60 });
    render(<ExpandableProse content="Long prose." testId="prose" />);
    const toggle = screen.getByTestId("prose-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("prose").className).not.toContain("line-clamp-");
  });
});
