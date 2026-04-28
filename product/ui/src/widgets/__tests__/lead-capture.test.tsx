// product/ui/src/widgets/__tests__/lead-capture.test.tsx
//
// Covers the `handoff` widget's two-step state machine, form validation,
// the consent-gate (submit disabled until tier-2 tickbox is checked), and
// the new POST-then-addResult flow that lands a successful submission via
// the orchestrator's /handoff/submit endpoint (E.t3).

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SampleHandoff } from "@swoop/common/fixtures";

// Mock the handoff client BEFORE importing the widget so the widget binds
// to the mocked module.
vi.mock("../../runtime/handoff-client", () => ({
  postHandoffSubmit: vi.fn(),
}));

import { LeadCaptureWidget } from "../lead-capture";
import { postHandoffSubmit } from "../../runtime/handoff-client";

const postHandoffSubmitMock = vi.mocked(postHandoffSubmit);

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

afterEach(() => {
  cleanup();
  postHandoffSubmitMock.mockReset();
});

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

  it("validates name + email before attempting POST", async () => {
    const addResult = vi.fn();
    render(<LeadCaptureWidget {...mockProps({ addResult })} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByTestId("lead-capture-consent"));

    // Submit with empty name/email — validation should catch it locally.
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));
    expect(postHandoffSubmitMock).not.toHaveBeenCalled();
    expect(addResult).not.toHaveBeenCalled();
    expect(screen.getByText(/Name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/Email is required/i)).toBeInTheDocument();

    // Invalid email.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));
    expect(postHandoffSubmitMock).not.toHaveBeenCalled();
    expect(addResult).not.toHaveBeenCalled();
    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
  });

  it("POSTs to /handoff/submit with the right body shape, then resolves the tool call on success", async () => {
    postHandoffSubmitMock.mockResolvedValueOnce({
      ok: true,
      handoffId: "handoff_abc_123",
      emailStatus: "sent",
    });

    const addResult = vi.fn();
    render(<LeadCaptureWidget {...mockProps({ addResult })} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Ríos" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByTestId("lead-capture-consent"));
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));

    await waitFor(() => expect(postHandoffSubmitMock).toHaveBeenCalledTimes(1));

    const body = postHandoffSubmitMock.mock.calls[0]![0];
    expect(body.verdict).toBe(SampleHandoff.verdict);
    expect(body.reasonCode).toBe(SampleHandoff.reason.code);
    expect(body.reasonText).toBe(SampleHandoff.reason.text);
    expect(body.motivationAnchor).toBe(SampleHandoff.motivationAnchor);
    expect(body.contact?.name).toBe("Ada Ríos");
    expect(body.contact?.email).toBe("ada@example.com");
    expect(body.contact?.preferredMethod).toBe("email");
    expect(body.consent.handoffGranted).toBe(true);
    expect(body.consent.marketingGranted).toBe(false);
    expect(body.consent.consentCopyVersion).toBe("consent-handoff/v1");
    expect(body.consent.handoffTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await waitFor(() => expect(addResult).toHaveBeenCalledTimes(1));
    const out = addResult.mock.calls[0]![0];
    expect(out.status).toBe("accepted");
    expect(out.handoffId).toBe("handoff_abc_123");
  });

  it("shows an inline error and does not resolve the tool call on POST failure", async () => {
    postHandoffSubmitMock.mockResolvedValueOnce({
      ok: false,
      reason: "store_failed",
      detail: "simulated disk failure",
    });

    const addResult = vi.fn();
    render(<LeadCaptureWidget {...mockProps({ addResult })} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByTestId("lead-capture-consent"));
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));

    await waitFor(() =>
      expect(screen.getByTestId("lead-capture-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("lead-capture-error").textContent).toMatch(/simulated disk failure/);
    expect(addResult).not.toHaveBeenCalled();

    // Form is still usable — the visitor can retry.
    expect(screen.getByRole("button", { name: /Submit handoff details/i })).not.toBeDisabled();
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
