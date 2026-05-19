// product/ui/src/widgets/__tests__/lead-capture.test.tsx
//
// Covers the `handoff` widget's single-step form, the precis disclosure,
// the optional "Anything else?" textarea, the consent-gate (submit disabled
// until tier-2 tickbox is checked), and the POST-then-addResult flow that
// lands a successful submission via the orchestrator's /handoff/submit
// endpoint (E.t3).
//
// Per the 2026-05-19 frosty-leavitt-handoff-form-polish Tier-3 plan, the
// prior "summary preview → form" two-step flow is collapsed into a single
// step; these tests assert that collapse (no `data-step="summary"`, no
// "Continue" button, the form renders on first paint).

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

const VISITOR_PRECIS_SAMPLE =
  "W Trek in November, refugio-based, premium budget, Torres del Paine.";

function mockProps(overrides: Partial<Record<string, unknown>> = {}) {
  const args = {
    verdict: SampleHandoff.verdict,
    reasonCode: SampleHandoff.reason.code,
    specialistSummary: SampleHandoff.reason.text,
    visitorPrecis: VISITOR_PRECIS_SAMPLE,
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
  it("renders the form directly — no summary step, no Continue button", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
    const root = screen.getByTestId("lead-capture");
    expect(root).toHaveAttribute("data-verdict", SampleHandoff.verdict);
    expect(root).toHaveAttribute("data-swoop-widget-state", "form");
    // Verdict-aware intro line stays as a signpost at the top of the form.
    expect(screen.getByText(/Swoop specialist is the right next step/i)).toBeInTheDocument();
    // Form controls are present from the first paint.
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    // No legacy Continue button — single-step.
    expect(screen.queryByRole("button", { name: /Continue/i })).not.toBeInTheDocument();
    // Specialist summary MUST NOT appear on the visitor surface anywhere.
    expect(screen.queryByText(SampleHandoff.reason.text)).not.toBeInTheDocument();
    // Motivation anchor likewise stays out of the visitor surface.
    expect(screen.queryByText(SampleHandoff.motivationAnchor)).not.toBeInTheDocument();
  });

  it("renders the visitor precis inside a collapsible disclosure", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
    const disclosure = screen.getByTestId("lead-capture-precis-disclosure");
    expect(disclosure).toBeInTheDocument();
    expect(screen.getByTestId("lead-capture-precis-body").textContent).toBe(
      VISITOR_PRECIS_SAMPLE,
    );
  });

  it("falls back to a generic precis line when the agent omitted visitorPrecis", () => {
    const props = mockProps({
      args: {
        verdict: SampleHandoff.verdict,
        reasonCode: SampleHandoff.reason.code,
        specialistSummary: SampleHandoff.reason.text,
        motivationAnchor: SampleHandoff.motivationAnchor,
      },
    });
    render(<LeadCaptureWidget {...props} />);
    expect(screen.getByTestId("lead-capture-precis-body").textContent).toMatch(
      /summary of what you've told us will be shared/i,
    );
  });

  it("uses the updated consent copy ('I agree my conversation summary can be shared...')", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
    expect(
      screen.getByText(
        /I agree my conversation summary can be shared with a Swoop specialist/i,
      ),
    ).toBeInTheDocument();
  });

  it("keeps submit disabled until the consent tickbox is checked", () => {
    render(<LeadCaptureWidget {...mockProps()} />);
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

  it("POSTs the new body shape (reasonText from specialistSummary; visitorPrecis + additionalNotes when present)", async () => {
    postHandoffSubmitMock.mockResolvedValueOnce({
      ok: true,
      handoffId: "handoff_abc_123",
      emailStatus: "sent",
    });

    const addResult = vi.fn();
    render(<LeadCaptureWidget {...mockProps({ addResult })} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Ríos" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByTestId("lead-capture-additional-notes"), {
      target: { value: "Travelling with my partner — they're less experienced on multi-day treks." },
    });
    fireEvent.click(screen.getByTestId("lead-capture-consent"));
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));

    await waitFor(() => expect(postHandoffSubmitMock).toHaveBeenCalledTimes(1));

    const body = postHandoffSubmitMock.mock.calls[0]![0];
    expect(body.verdict).toBe(SampleHandoff.verdict);
    expect(body.reasonCode).toBe(SampleHandoff.reason.code);
    // reasonText is the wire name for the specialist summary the agent produced.
    expect(body.reasonText).toBe(SampleHandoff.reason.text);
    expect(body.motivationAnchor).toBe(SampleHandoff.motivationAnchor);
    expect(body.visitorPrecis).toBe(VISITOR_PRECIS_SAMPLE);
    expect(body.additionalNotes).toMatch(/Travelling with my partner/);
    if (body.verdict !== "qualified" && body.verdict !== "referred_out") {
      throw new Error(`expected contact-bearing verdict, got ${body.verdict}`);
    }
    expect(body.contact.name).toBe("Ada Ríos");
    expect(body.contact.email).toBe("ada@example.com");
    expect(body.contact.preferredMethod).toBe("email");
    expect(body.consent.handoffGranted).toBe(true);
    expect(body.consent.marketingGranted).toBe(false);
    expect(body.consent.consentCopyVersion).toBe("consent-handoff/v1");
    expect(body.consent.handoffTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await waitFor(() => expect(addResult).toHaveBeenCalledTimes(1));
    const out = addResult.mock.calls[0]![0];
    expect(out.status).toBe("accepted");
    expect(out.handoffId).toBe("handoff_abc_123");
  });

  it("omits additionalNotes from the POST body when the textarea is empty", async () => {
    postHandoffSubmitMock.mockResolvedValueOnce({
      ok: true,
      handoffId: "handoff_no_notes",
      emailStatus: "sent",
    });
    render(<LeadCaptureWidget {...mockProps()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByTestId("lead-capture-consent"));
    fireEvent.click(screen.getByRole("button", { name: /Submit handoff details/i }));
    await waitFor(() => expect(postHandoffSubmitMock).toHaveBeenCalledTimes(1));
    const body = postHandoffSubmitMock.mock.calls[0]![0];
    expect("additionalNotes" in body).toBe(false);
  });

  it("shows an inline error and does not resolve the tool call on POST failure", async () => {
    postHandoffSubmitMock.mockResolvedValueOnce({
      ok: false,
      reason: "store_failed",
      detail: "simulated disk failure",
    });

    const addResult = vi.fn();
    render(<LeadCaptureWidget {...mockProps({ addResult })} />);
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
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByTestId("lead-capture-consent"));
    const submit = screen.getByRole("button", { name: /Submit handoff details/i });
    expect(submit).not.toBeDisabled();
  });

  it("renders malformed placeholder when args don't match HandoffInputSchema", () => {
    render(<LeadCaptureWidget {...mockProps({ args: { not: "valid" } })} />);
    expect(screen.getByTestId("widget-malformed")).toBeInTheDocument();
  });
});
