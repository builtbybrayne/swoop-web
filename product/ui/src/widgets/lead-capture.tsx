// product/ui/src/widgets/lead-capture.tsx
//
// Renders the `handoff` tool call as a single-step form. Per the
// 2026-05-19 frosty-leavitt-handoff-form-polish Tier-3 plan, the prior
// "summary preview → form" two-step flow is replaced with a single form
// surface:
//
//   - Verdict-aware intro line at the top (per VERDICT_INTRO).
//   - Name + email (required), preferred method, phone (optional).
//   - A collapsible <details> disclosure ("Review what you've told us so
//     far") rendering args.visitorPrecis — the agent's logistical-
//     only summary, with a generic fallback if the agent didn't supply it.
//     The rich, archetype-aware args.specialistSummary is NEVER shown to
//     the visitor — it flows through reasonText to the durable record +
//     specialist email only.
//   - A free-text "Anything else the specialist should know? (optional)"
//     textarea — persists to the durable record and renders into the
//     specialist email.
//   - Tier-2 handoff consent tickbox (required — submit disabled until
//     checked), plus an optional marketing opt-in (unticked by default).
//
// On submit the widget POSTs to the orchestrator's `/handoff/submit`
// endpoint (E.t3) which runs the connector-side `submitHandoff` pipeline
// (consent backstop → durable store → verdict-aware email). On success
// the widget calls `props.addResult` with a `HandoffSubmitOutput` shape
// so assistant-ui can render the confirmation; on failure the widget
// shows an inline error and lets the visitor retry.
//
// Tier-1 (conversation-opening) consent is NOT captured here — that lives
// in D.t4. This widget only captures the tier-2 handoff-specific consent.
// See planning/03-exec-chat-surface-t3.md "Key implementation notes" §4–5
// and chunk E §2.3.

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  HandoffInputSchema,
  HandoffSubmitOutputSchema,
  type HandoffInput,
  type HandoffSubmitOutput,
} from "@swoop/common";
import {
  useAssistantRuntime,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { CtaButton } from "../shared";
import { SPECIALIST_TERM_SINGULAR } from "../shared/specialist-term";
import {
  safeParse,
  WidgetMalformedPlaceholder,
} from "./widget-shell";
import { postHandoffSubmit } from "../runtime/handoff-client";

// VERDICT_INTRO — visitor-facing intro line at the top of the form.
// qualified copy is Luke's requested wording (2026-06-10); the other
// verdicts are re-voiced to the same register but preserve distinct semantics.
// Specialist term centralised via SPECIALIST_TERM_SINGULAR.
const VERDICT_INTRO: Record<HandoffInput["verdict"], string> = {
  qualified: `One of ${SPECIALIST_TERM_SINGULAR}s will answer your questions and pick up where we left off. Please share your details.`,
  referred_out: `We know just the right people for this. One of ${SPECIALIST_TERM_SINGULAR}s will make an introduction — please share your details.`,
  disqualified: `This particular trip isn't the right match today, but a ${SPECIALIST_TERM_SINGULAR} would still love to hear from you if anything changes.`,
  // Inconclusive: agent never reached confidence; no contact requested.
  // Same operational pattern as disqualified per HITL Q5 — the widget is not
  // expected to render this branch (the agent typically doesn't surface the
  // lead-capture widget on inconclusive outcomes), but the type-checker
  // requires the entry.
  inconclusive: `We weren't quite able to find the right match this time, but a ${SPECIALIST_TERM_SINGULAR} is here whenever you'd like to come back.`,
};

/** Pattern matches HTML5 `type=email` — keep the regex minimal / permissive. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Versioned token mirrored into the durable record's `consentCopyVersion`
 *  field. Bump when the tier-2 consent text changes. */
const CONSENT_COPY_VERSION = "consent-handoff/v1";

const SHELL_CTX = {
  widgetType: "lead-capture",
  toolName: "handoff",
} as const;

const PRECIS_FALLBACK =
  "A summary of what you've told us will be shared with the specialist.";

export function LeadCaptureWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  // Validate args at the render boundary. The tool call is already running
  // (assistant-ui has invoked handoff) so args are populated; if somehow
  // malformed, fall back to the placeholder.
  const argsParsed = useMemo(
    () => safeParse(HandoffInputSchema, props.args, SHELL_CTX),
    [props.args],
  );

  // Hooks must run unconditionally; we track the submit status regardless
  // of whether args parsed so the return-early below is safe.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [handoffConsent, setHandoffConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Used post-submit to nudge the agent back into a follow-up turn — see the
  // `props.addResult(out)` block below. assistant-ui doesn't reliably trigger
  // a new model run from `addResult` alone once the assistant message has
  // closed; appending a synthetic visitor turn forces the agent to acknowledge
  // submission and continue the conversation (per Alastair 2026-05-19).
  //
  // `optional: true` so unit tests that render the widget bare (no
  // <AssistantRuntimeProvider> in scope) don't throw; the append is guarded
  // below.
  const runtime = useAssistantRuntime({ optional: true });

  if (!argsParsed.ok) {
    return (
      <WidgetMalformedPlaceholder {...SHELL_CTX} debug={argsParsed.debug} />
    );
  }
  const args = argsParsed.data;

  // Result-driven states. After a successful POST we mark `submitted`;
  // assistant-ui re-renders with `props.result` populated by addResult.
  if (submitted) {
    const resultParsed = safeParse(
      HandoffSubmitOutputSchema,
      props.result,
      SHELL_CTX,
    );
    if (resultParsed.ok && resultParsed.data.status === "accepted") {
      return (
        <div
          data-testid="lead-capture-confirmation"
          data-swoop-part="widget"
          data-swoop-widget="lead-capture"
          data-swoop-widget-state="confirmation"
          role="status"
          className="my-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700"
        >
          <p className="font-medium text-slate-900">Thanks — we&apos;ve got your details.</p>
          <p className="mt-1 text-slate-600">
            A {SPECIALIST_TERM_SINGULAR} will be in touch.
          </p>
        </div>
      );
    }
    if (resultParsed.ok && resultParsed.data.status === "rejected") {
      // Server-side rejection: not a parse failure but the rest of the
      // confirmation surface can't render. Treat as a lifecycle-style
      // malformed signal (no schema-issues payload to surface).
      return <WidgetMalformedPlaceholder {...SHELL_CTX} lifecycleFailure />;
    }
    // result not yet available → pending state
    return (
      <div
        data-testid="lead-capture-pending"
        data-swoop-part="widget"
        data-swoop-widget="lead-capture"
        data-swoop-widget-state="pending"
        role="status"
        aria-live="polite"
        className="my-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600"
      >
        Sending your details…
      </div>
    );
  }

  // ----- single-step form -----

  function validate(): boolean {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Name is required";
    if (!email.trim()) {
      next.email = "Email is required";
    } else if (!EMAIL_RE.test(email.trim())) {
      next.email = "Please enter a valid email";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!handoffConsent) return; // Consent-gate: shouldn't fire since submit is disabled, but belt + braces.
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError(null);

    const now = new Date().toISOString();

    const trimmedNotes = additionalNotes.trim();

    const reqBody = {
      verdict: args.verdict,
      reasonCode: args.reasonCode,
      reasonText: args.specialistSummary,
      motivationAnchor: args.motivationAnchor || undefined,
      ...(args.visitorPrecis ? { visitorPrecis: args.visitorPrecis } : {}),
      ...(trimmedNotes ? { additionalNotes: trimmedNotes } : {}),
      contact: {
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      },
      consent: {
        handoffGranted: handoffConsent,
        handoffTimestamp: now,
        marketingGranted: marketingConsent,
        ...(marketingConsent ? { marketingTimestamp: now } : {}),
        consentCopyVersion: CONSENT_COPY_VERSION,
      },
    };

    // `reqBody.verdict` carries the union literal from `args.verdict`, not a
    // narrowed variant. The widget only renders the contact-form path for
    // qualified / referred_out verdicts (the others don't surface the
    // lead-capture widget in normal operation), so the assembled body matches
    // one of those two variants at runtime. The orchestrator runs Zod
    // validation at the route boundary regardless. Cast to satisfy the
    // distributive-Omit parameter type without restructuring the assembly.
    const response = await postHandoffSubmit(
      reqBody as Parameters<typeof postHandoffSubmit>[0],
    );

    setSubmitting(false);

    if (response.ok) {
      // Mirror the orchestrator's success into a `HandoffSubmitOutput`
      // shape — that's what assistant-ui forwards back as the resolved
      // tool result, and what this widget reads in the `submitted`
      // branch above to render the confirmation.
      const out: HandoffSubmitOutput = {
        status: "accepted",
        handoffId: response.handoffId,
      };
      props.addResult(out as unknown as never);
      // Kick the agent into a follow-up turn. `addResult` populates the
      // tool-call's result slot, but by the time the visitor presses Submit
      // the assistant message is typically closed — addResult alone doesn't
      // re-start a run. Appending a synthetic visitor turn is the path that
      // reliably triggers the model. Text is neutral and read like a quick
      // visitor confirmation; future iteration could swap this for a hidden
      // data-part if the visible user bubble becomes jarring.
      runtime?.thread.append({
        role: "user",
        content: [{ type: "text", text: "(Form submitted.)" }],
      });
      setSubmitted(true);
      return;
    }

    // Failed submit — keep the form usable, surface the reason inline.
    const detail = response.detail ?? response.reason;
    setSubmitError(`We couldn't send your details just now (${detail}). Please try again.`);
  }

  const canSubmit = handoffConsent && !submitting;

  // L1 render-position fix: the agent fires `handoff` before writing its
  // framing prose (per 00_why.md §9 booking-limit rule), so the tool-call
  // part arrives before text parts in the DOM. The assistant message root is
  // a flex column (`flex flex-col gap-2` in App.tsx); CSS `order-last` pushes
  // this widget to the visual tail of that column regardless of DOM position,
  // so text streamed after the tool call appears above the form.
  // Decision D.poincare-1: CSS order mechanism chosen over custom parts renderer.
  return (
    <section
      data-testid="lead-capture"
      data-verdict={args.verdict}
      data-swoop-part="widget"
      data-swoop-widget="lead-capture"
      data-swoop-widget-state="form"
      aria-label="Contact form"
      className="order-last my-2 w-full rounded-lg border border-slate-200 bg-white p-4"
    >
      <p
        data-testid="lead-capture-verdict-intro"
        className="text-sm text-slate-700"
      >
        {VERDICT_INTRO[args.verdict]}
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="lc-name" className="text-xs font-medium text-slate-700">
            Name
          </label>
          <input
            id="lc-name"
            type="text"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "lc-name-err" : undefined}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          {errors.name ? (
            <span id="lc-name-err" className="text-xs text-red-600">{errors.name}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="lc-email" className="text-xs font-medium text-slate-700">
            Email
          </label>
          <input
            id="lc-email"
            type="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "lc-email-err" : undefined}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          {errors.email ? (
            <span id="lc-email-err" className="text-xs text-red-600">{errors.email}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="lc-phone" className="text-xs font-medium text-slate-700">
            Phone <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="lc-phone"
            type="tel"
            value={phone}
            onChange={(ev) => setPhone(ev.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>

        {/*
          U3 + U4: precis disclosure sits above the notes textarea so
          the visitor reviews what they've shared before adding anything.
          U4: `open` by default — visible immediately, still collapsible.
          Surfaces the agent's `visitorPrecis` (logistical-only, never
          the rich specialist summary). If the agent omitted it, a generic
          reassurance line stands in so the disclosure still has substance.
        */}
        <details
          open
          data-testid="lead-capture-precis-disclosure"
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <summary className="cursor-pointer text-xs font-medium text-slate-700">
            Review what you&apos;ve told us so far
          </summary>
          <p
            data-testid="lead-capture-precis-body"
            className="mt-2 text-sm text-slate-700"
          >
            {args.visitorPrecis?.trim() ? args.visitorPrecis : PRECIS_FALLBACK}
          </p>
        </details>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="lc-additional-notes"
            className="text-xs font-medium text-slate-700"
          >
            Anything else the Specialist should know?{" "}
            <span className="text-slate-400">(optional)</span>
          </label>
          <textarea
            id="lc-additional-notes"
            data-testid="lead-capture-additional-notes"
            value={additionalNotes}
            onChange={(ev) => setAdditionalNotes(ev.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>

        <label className="mt-1 flex gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={handoffConsent}
            onChange={(ev) => setHandoffConsent(ev.target.checked)}
            data-testid="lead-capture-consent"
            className="mt-0.5"
            required
          />
          <span>
            I agree my conversation summary can be shared with a {SPECIALIST_TERM_SINGULAR} so
            they can follow up.
          </span>
        </label>

        <label className="flex gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(ev) => setMarketingConsent(ev.target.checked)}
            data-testid="lead-capture-marketing"
            className="mt-0.5"
          />
          <span>
            Send me occasional ideas and inspiration from Swoop (optional).
          </span>
        </label>

        {submitError ? (
          <p
            role="alert"
            data-testid="lead-capture-error"
            className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800"
          >
            {submitError}
          </p>
        ) : null}

        <div className="mt-2 flex gap-2">
          {/* The submit wrapper carries `data-swoop-part="lead-capture-submit"`
              so Swoop's brand extension can target the primary handoff action
              without reaching into CtaButton's generic surface. The wrapper is
              inline-flex so layout stays identical to the unwrapped button. */}
          <span data-swoop-part="lead-capture-submit" className="inline-flex">
            <CtaButton
              type="submit"
              disabled={!canSubmit}
              ariaLabel="Submit handoff details"
            >
              {submitting ? "Sending…" : "Send my details"}
            </CtaButton>
          </span>
        </div>
      </form>
    </section>
  );
}

LeadCaptureWidget.displayName = "LeadCaptureWidget";
