// product/ui/src/widgets/__tests__/find-someone-who.test.tsx
//
// Covers the Mirror story-vignette: happy-path against the canonical fixture
// (with the persona-summary preface as the load-bearing Mirror affordance —
// HITL Q3 visual treatment), the empty state, and the malformed fallback.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SampleFindSomeoneWhoOutput } from "@swoop/common/fixtures";
import { FindSomeoneWhoWidget } from "../find-someone-who";

function mockProps(overrides: Partial<Record<string, unknown>>) {
  return {
    type: "tool-call" as const,
    toolCallId: "call_mirror_1",
    toolName: "find_someone_who",
    args: { signal: "solo, mid-40s" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof FindSomeoneWhoWidget>;
}

afterEach(() => cleanup());

describe("FindSomeoneWhoWidget", () => {
  it("renders a vignette per story with the persona-summary preface, story prose, and region tag", () => {
    render(
      <FindSomeoneWhoWidget
        {...mockProps({ result: SampleFindSomeoneWhoOutput })}
      />,
    );

    const root = screen.getByTestId("find-someone-who");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("data-swoop-widget", "find-someone-who");

    const story = SampleFindSomeoneWhoOutput.stories[0];

    // Persona summary rendered distinctly with the "Someone like…" preface.
    const persona = screen.getByTestId("find-someone-who-persona");
    expect(persona).toHaveTextContent("Someone like…");
    expect(persona).toHaveTextContent(
      new RegExp(story.personaSummary.slice(0, 40), "i"),
    );
    // Italic class applied (this is the visual affordance that distinguishes
    // Mirror from Inspire — the persona summary makes the *match* legible).
    expect(persona.className).toMatch(/italic/);

    // Story prose visible.
    expect(screen.getByTestId("find-someone-who-story")).toHaveTextContent(
      new RegExp(story.text.slice(0, 40), "i"),
    );

    // Region tag visible.
    expect(screen.getByTestId("find-someone-who-region")).toHaveTextContent(
      story.region ?? "",
    );

    // Deep-link to the source.
    const link = screen.getByTestId("find-someone-who-link");
    expect(link).toHaveAttribute("href", story.canonicalUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the persona summary distinctly from the story prose", () => {
    render(
      <FindSomeoneWhoWidget
        {...mockProps({ result: SampleFindSomeoneWhoOutput })}
      />,
    );
    const persona = screen.getByTestId("find-someone-who-persona");
    const story = screen.getByTestId("find-someone-who-story");
    expect(persona).not.toBe(story);
    expect(persona.textContent).not.toEqual(story.textContent);
  });

  it("shows empty state when the stories list is empty", () => {
    render(
      <FindSomeoneWhoWidget
        {...mockProps({ result: { stories: [], count: 0 } })}
      />,
    );
    expect(screen.getByTestId("find-someone-who-empty")).toBeInTheDocument();
  });

  it("falls back to the placeholder on a malformed result", () => {
    render(
      <FindSomeoneWhoWidget
        {...mockProps({ result: { stories: "not-an-array", count: 0 } })}
      />,
    );
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
