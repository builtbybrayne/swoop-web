// product/ui/src/widgets/__tests__/dev-tool-trace.test.tsx
//
// Covers the universal dev-only tool-call trace surface:
//   - Collapsed-summary line names the tool, status, duration, error flag.
//   - Expanded body exposes toolCallId, args, result, isError, timestamps.
//   - `wrapWithDevTrace` HOC composes the trace below the wrapped widget,
//     preserving the wrapped widget's render.
//
// Under Vitest, `import.meta.env.DEV` is true so the trace renders. In
// production it returns null (covered by the live preview smoke, not
// here — Vitest can't easily toggle DEV mid-test without restarting).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ComponentType } from "react";
import { wrapWithDevTrace } from "../widget-shell";
// `ToolCallMessagePartProps` is exported via widget-shell's `wrapWithDevTrace`
// signature; importing it directly from @assistant-ui/react keeps the test
// honest about the contract.
import type { ToolCallMessagePartProps } from "@assistant-ui/react";

afterEach(() => cleanup());

function mockProps(
  overrides: Partial<Record<string, unknown>> = {},
): ToolCallMessagePartProps {
  return {
    type: "tool-call" as const,
    toolCallId: "call_test_1",
    toolName: "find_options",
    args: { region: "patagonia" },
    argsText: "{}",
    addResult: () => {},
    resume: () => {},
    status: { type: "complete" as const },
    result: { cards: [], count: 0 },
    ...overrides,
  } as unknown as ToolCallMessagePartProps;
}

const StubInner: ComponentType<ToolCallMessagePartProps> = () => (
  <div data-testid="stub-inner">stub widget body</div>
);

describe("wrapWithDevTrace + DevToolCallTrace", () => {
  it("renders the wrapped widget AND the trace card below it", () => {
    const Wrapped = wrapWithDevTrace("find_options", StubInner);
    render(<Wrapped {...mockProps()} />);
    expect(screen.getByTestId("stub-inner")).toBeInTheDocument();
    const trace = screen.getByTestId("dev-tool-trace");
    expect(trace).toBeInTheDocument();
    expect(trace).toHaveAttribute("data-swoop-tool", "find_options");
  });

  it("collapsed summary names the tool + status", () => {
    const Wrapped = wrapWithDevTrace("find_options", StubInner);
    render(<Wrapped {...mockProps()} />);
    const summary = screen.getByTestId("dev-tool-trace").querySelector("summary");
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain("find_options");
    expect(summary!.textContent).toContain("complete");
  });

  it("expands on summary click and exposes args + result + toolCallId", () => {
    const Wrapped = wrapWithDevTrace("find_options", StubInner);
    render(
      <Wrapped
        {...mockProps({
          toolCallId: "call_xyz",
          args: { foo: "bar" },
          result: { cards: ["a", "b"], count: 2 },
        })}
      />,
    );
    const trace = screen.getByTestId("dev-tool-trace");
    const summary = trace.querySelector("summary");
    expect(summary).not.toBeNull();
    // <details> open via click
    fireEvent.click(summary!);
    // Native <details> open toggling in jsdom doesn't always flip via
    // synthetic click — set the attribute directly for the expansion check.
    (trace as HTMLDetailsElement).open = true;
    expect(trace.textContent).toContain("call_xyz");
    expect(trace.textContent).toContain("\"foo\": \"bar\"");
    expect(trace.textContent).toContain("\"count\": 2");
  });

  it("flags isError in the summary when the tool call errored", () => {
    const Wrapped = wrapWithDevTrace("find_options", StubInner);
    render(<Wrapped {...mockProps({ isError: true })} />);
    const trace = screen.getByTestId("dev-tool-trace");
    expect(trace.textContent).toContain("isError");
    expect(trace.textContent).toContain("error");
  });

  it("falls back to the registration-side toolName when props.toolName is missing", () => {
    const Wrapped = wrapWithDevTrace("(unregistered)", StubInner);
    render(
      <Wrapped {...mockProps({ toolName: undefined })} />,
    );
    const trace = screen.getByTestId("dev-tool-trace");
    expect(trace).toHaveAttribute("data-swoop-tool", "(unregistered)");
    expect(trace.textContent).toContain("(unregistered)");
  });

  it("renders the wrapped widget even when result is still undefined (running state)", () => {
    const Wrapped = wrapWithDevTrace("find_options", StubInner);
    render(
      <Wrapped
        {...mockProps({
          status: { type: "running" },
          result: undefined,
        })}
      />,
    );
    expect(screen.getByTestId("stub-inner")).toBeInTheDocument();
    const trace = screen.getByTestId("dev-tool-trace");
    expect(trace.textContent).toContain("running");
  });
});
