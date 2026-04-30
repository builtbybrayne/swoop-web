/**
 * `submitHandoff` — connector-side orchestration for a successful handoff.
 *
 * Runs the four-step pipeline that lives behind any future MCP
 * `handoff_submit` tool call:
 *
 *   1. Schema-validate the payload against `HandoffPayloadSchema`.
 *      Belt + braces — callers are typed but the boundary is the right
 *      place to catch a wire-shape mismatch.
 *   2. Consent backstop. Reject if either tier-1 (conversation) or tier-2
 *      (handoff) consent is missing. Per
 *      planning/02-impl-handoff-and-compliance.md §"Verification" step 5.
 *   3. Save to the durable store. Today: file-backed JSON via
 *      `FsHandoffStore`. Tomorrow: `PostgresHandoffStore` against Cloud SQL
 *      (E.t2 proper / decisions E.10 + C.18 + C.23 — Firestore was the
 *      original target but is dropped project-wide).
 *   4. Send the verdict-aware email via the mailer. Mailer handles the
 *      "disqualified → no email" + "disabled → skip" branches internally;
 *      this layer just forwards the result.
 *
 * If consent is missing we do **not** persist the record. The audit trail
 * for rejected attempts lives in chunk F's event log, not the durable
 * store. This keeps the store an honest "successful handoffs" surface.
 *
 * Wiring (today):
 *   The orchestrator does not yet call `submitHandoff`. The lead-capture
 *   widget's `addResult(payload)` resolves the assistant-ui tool call,
 *   but no orchestrator-side hook routes that into this function. That
 *   wiring is the integration point E.t2/E.t3 finishes — see
 *   planning/02-impl-handoff-and-compliance.md §10 + §"Verification".
 *   This function is the dependency they will import from
 *   `@swoop/connector`.
 */

import {
  HandoffPayloadSchema,
  type HandoffPayload,
  type HandoffSubmitConsentGate,
} from '@swoop/common';

import {
  sendHandoffEmail,
  type MailerConfig,
  type MailerDeps,
  type SendResult,
} from './mailer.js';
import type { HandoffStore } from './store.js';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export type SubmitResult =
  | {
      readonly ok: true;
      readonly handoffId: string;
      readonly storedAt: string;
      readonly emailResult: SendResult;
    }
  | {
      readonly ok: false;
      readonly reason: 'payload_invalid' | 'consent_missing' | 'store_failed';
      readonly detail: string;
    };

export interface SubmitDeps {
  /** Where to persist the handoff record. */
  readonly store: HandoffStore;
  /** Mailer config (recipient, transport, templates dir). */
  readonly mailerConfig: MailerConfig;
  /** Optional mailer deps — surfaced here so tests can inject a stub
   *  transporter / template reader without re-plumbing every layer. */
  readonly mailerDeps?: MailerDeps;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export async function submitHandoff(
  payload: HandoffPayload,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  // ---- 1. Schema validation -------------------------------------------
  const parsed = HandoffPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      reason: 'payload_invalid',
      detail: issues,
    };
  }
  const validated = parsed.data;

  // ---- 2. Consent backstop --------------------------------------------
  const gate: HandoffSubmitConsentGate = {
    conversationGranted: validated.consent.conversationGranted,
    handoffGranted: validated.consent.handoffGranted,
  };
  if (!gate.conversationGranted || !gate.handoffGranted) {
    return {
      ok: false,
      reason: 'consent_missing',
      detail: `conversation:${gate.conversationGranted} handoff:${gate.handoffGranted}`,
    };
  }

  // ---- 3. Persist the record ------------------------------------------
  const saveResult = await deps.store.save(validated);
  if (!saveResult.ok) {
    return {
      ok: false,
      reason: 'store_failed',
      detail: saveResult.detail ?? saveResult.reason,
    };
  }

  // ---- 4. Verdict-aware email -----------------------------------------
  // Mailer is responsible for the verdict + enabled branches; we just
  // forward the result so the caller can log it via chunk F events.
  const emailResult = await sendHandoffEmail(
    validated,
    deps.mailerConfig,
    deps.mailerDeps,
  );

  return {
    ok: true,
    handoffId: saveResult.handoffId,
    storedAt: saveResult.absolutePath,
    emailResult,
  };
}
