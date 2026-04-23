// product/ui/src/widgets/__tests__/lead-capture.test.tsx
//
// Covers the `handoff` widget's two-step state machine, form validation,
// and — critically — the consent-gate requirement: submit is disabled
// until the tier-2 tickbox is checked (planning/03-exec-chat-surface-
// t3.md "Key implementation notes" §4).

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LeadCaptureWidget } from "../lead-capture";
import { SampleHandoff } from "@swoop/common/fixtures";

function mockProps(overrides: Partial<Record<string, unknown>> = {}) {
  const args = {
    verdict: SampleHandoff.verdict,
    reasonCode: SampleHandoff.reason.code,
    conversationSummary: SampleHandoff.reason.text,
    motivationAnchor: SampleHandoff.motivationAnchor,
  };
  return {
    type: "tool-call" as const,
    toolCallId: "call_4",
    toolName: "handoff",
    args,
    argsText: JSON.stringify(args),
    addResult: vi.fn(),
    resume: () => {},
    status: { type: "running" as const },
    ...overrides,
  } as unknown as React.ComponentProps<typeof LeadCaptureWidget>;
}

afterEach(() => cleanup());

describe("LeadCaptureWidget", () => {
  it("renders the verdict-aware summary first (step 1)", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
    const root = screen.getByTestId("lead-capture");
    expect(root).toHaveAttribute("data-step", "summary");
    expect(root).toHaveAttribute("data-verdict", SampleHandoff.verdict);
    expect(screen.getByText(/Swoop specialist is the right next step/i)).toBeInTheDocument();
    expect(screen.getByText(SampleHandoff.reason.text)).toBeInTheDocument();
    expect(screen.getByText(SampleHandoff.motivationAnchor)).toBeInTheDocument();
  });

  it("advances to the form on Continue", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByTestId("lead-capture")).toHaveAttribute("data-step", "form");
  });

  it("keeps submit disabled until the consent tickbox is checked", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Ríos" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });

    const submit = screen.getByRole("button", { name: /Submit handoff details/i });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId("lead-capture-consent"));
    expect(submit).not.toBeDisabled();
  });

  it("validates name + email before calling addResult", () => {
    const addResult = vi.fn();
    render(<LeadCaptureWidget {...mockProps({ addResult })} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByTestId("lead-capture-consent"));

    // Submit with empty name/email — validation should catch it.
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));
    expect(addResult).not.toHaveBeenCalled();
    expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/Email is required/i)).toBeInTheDocument();

    // Invalid email.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));
    expect(addResult).not.toHaveBeenCalled();
    expect(screen.getByText(/valid email/i)).toBeInTheDocument();

    // Valid email.
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));
    expect(addResult).toHaveBeenCalledTimes(1);
    const payload = addResult.mock.calls[0][0];
    expect(payload.contact.name).toBe("Ada");
    expect(payload.contact.email).toBe("ada@example.com");
    expect(payload.consent.handoffGranted).toBe(true);
    expect(payload.consent.marketingGranted).toBe(false);
  });

  it("marketing opt-in does NOT gate the submit button", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByTestId("lead-capture-consent"));

    // Without marketing opt-in the submit should already be enabled.
    const submit = screen.getByRole("button", { name: /Submit handoff details/i });
    expect(submit).not.toBeDisabled();
  });

  it("renders malformed placeholder when args don't match HandoffInputSchema", () => {
    render(<LeadCaptureWidget {...mockProps({ args: { not: "valid" } })} />);
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
