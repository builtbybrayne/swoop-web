// product/ui/src/widgets/lead-capture.tsx
//
// Renders the `handoff` tool call. Two-step flow:
//
//   Step 1 — summary preview.  Verdict-aware intro, conversation summary,
//            motivation anchor. A "Continue" button advances to step 2.
//
//   Step 2 — contact form.  Name + email (required), preferred method,
//            phone (optional), the tier-2 handoff consent tickbox
//            (required — submit disabled until checked), and a marketing
//            opt-in (optional, unticked by default). On submit the widget
//            POSTs to the orchestrator's `/handoff/submit` endpoint
//            (E.t3) which runs the connector-side `submitHandoff`
//            pipeline (consent backstop → durable store → verdict-aware
//            email). On success the widget calls `props.addResult` with
//            a `HandoffSubmitOutput` shape so assistant-ui can render
//            the confirmation; on failure the widget shows an inline
//            error and lets the visitor retry.
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
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { CtaButton } from "../shared";
import {
  safeParse,
  WidgetMalformedPlaceholder,
} from "./widget-shell";
import { postHandoffSubmit } from "../runtime/handoff-client";

const VERDICT_INTRO: Record<HandoffInput["verdict"], string> = {
  qualified:
    "A Swoop specialist is the right next step. Share a contact detail and they'll pick up where we left off.",
  referred_out:
    "Your plans are a better fit for a partner we know well. Share a contact detail and we'll introduce you.",
  disqualified:
    "This particular trip isn't the right match today, but we'd still love to hear from you if anything changes.",
  // Inconclusive: agent never reached confidence; no contact requested.
  // Same operational pattern as disqualified per HITL Q5 — the widget is not
  // expected to render this branch (the agent typically doesn't surface the
  // lead-capture widget on inconclusive outcomes), but the type-checker
  // requires the entry.
  inconclusive:
    "We weren't quite able to find the right match in this conversation, but the door's open whenever you'd like to come back.",
};

/** Pattern matches HTML5 `type=email` — keep the regex minimal / permissive. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Versioned token mirrored into the durable record's `consentCopyVersion`
 *  field. Bump when the tier-2 consent text changes. */
const CONSENT_COPY_VERSION = "consent-handoff/v1";

type Step = "summary" | "form";

export function LeadCaptureWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  // Validate args at the render boundary. The tool call is already running
  // (assistant-ui has invoked handoff) so args are populated; if somehow
  // malformed, fall back to the placeholder.
  const argsParsed = useMemo(
    () => safeParse(HandoffInputSchema, props.args),
    [props.args],
  );

  // Hooks must run unconditionally; we track the submit status regardless
  // of whether args parsed so the return-early below is safe.
  const [step, setStep] = useState<Step>("summary");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredMethod, setPreferredMethod] =
    useState<"email" | "phone" | "either">("email");
  const [handoffConsent, setHandoffConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!argsParsed.ok) return <WidgetMalformedPlaceholder />;
  const args = argsParsed.data;

  // Result-driven states. After a successful POST we mark `submitted`;
  // assistant-ui re-renders with `props.result` populated by addResult.
  if (submitted) {
    const resultParsed = safeParse(HandoffSubmitOutputSchema, props.result);
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
            A Swoop specialist will be in touch.
          </p>
        </div>
      );
    }
    if (resultParsed.ok && resultParsed.data.status === "rejected") {
      return <WidgetMalformedPlaceholder />;
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

  if (step === "summary") {
    return (
      <section
        data-testid="lead-capture"
        data-step="summary"
        data-verdict={args.verdict}
        data-swoop-part="widget"
        data-swoop-widget="lead-capture"
        data-swoop-widget-state="summary"
        aria-label="Handoff summary"
        className="my-2 w-full rounded-lg border border-slate-200 bg-white p-4"
      >
        <p className="text-sm text-slate-700">{VERDICT_INTRO[args.verdict]}</p>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Conversation summary
            </h3>
            <p className="mt-1 text-sm text-slate-800">{args.conversationSummary}</p>
          </div>
          {args.motivationAnchor ? (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Motivation
              </h3>
              <p className="mt-1 text-sm text-slate-800">{args.motivationAnchor}</p>
            </div>
          ) : null}
        </div>
        {args.verdict === "disqualified" ? (
          <p className="mt-4 text-xs italic text-slate-500">
            No contact is required — you don&apos;t need to continue if you&apos;d rather not.
          </p>
        ) : null}
        <div className="mt-4">
          <CtaButton
            onClick={() => setStep("form")}
            ariaLabel="Continue to contact form"
          >
            Continue
          </CtaButton>
        </div>
      </section>
    );
  }

  // ----- step === "form" -----

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

    const reqBody = {
      verdict: args.verdict,
      reasonCode: args.reasonCode,
      reasonText: args.conversationSummary,
      motivationAnchor: args.motivationAnchor || undefined,
      contact: {
        name: name.trim(),
        email: email.trim(),
        preferredMethod,
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

    const response = await postHandoffSubmit(reqBody);

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
      setSubmitted(true);
      return;
    }

    // Failed submit — keep the form usable, surface the reason inline.
    const detail = response.detail ?? response.reason;
    setSubmitError(`We couldn't send your details just now (${detail}). Please try again.`);
  }

  const canSubmit = handoffConsent && !submitting;

  return (
    <section
      data-testid="lead-capture"
      data-step="form"
      data-verdict={args.verdict}
      data-swoop-part="widget"
      data-swoop-widget="lead-capture"
      data-swoop-widget-state="form"
      aria-label="Contact form"
      className="my-2 w-full rounded-lg border border-slate-200 bg-white p-4"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
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

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-slate-700">Preferred contact method</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {(["email", "phone", "either"] as const).map((method) => (
              <label key={method} className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="lc-preferred"
                  value={method}
                  checked={preferredMethod === method}
                  onChange={() => setPreferredMethod(method)}
                />
                <span className="capitalize">{method}</span>
              </label>
            ))}
          </div>
        </fieldset>

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
            I agree Swoop can share my conversation summary and contact details with a
            specialist so they can follow up.
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
          <CtaButton
            type="button"
            onClick={() => setStep("summary")}
            ariaLabel="Back to summary"
          >
            Back
          </CtaButton>
        </div>
      </form>
    </section>
  );
}

LeadCaptureWidget.displayName = "LeadCaptureWidget";
