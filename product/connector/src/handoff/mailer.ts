/**
 * Handoff mailer (E.t3 — partial port from PoC).
 *
 * Sends a verdict-aware email when a handoff is submitted. Currently lives
 * here in the orchestrator workspace because the eventual home (`product/
 * connector/`) hasn't been scaffolded yet — once chunk C lands the real
 * connector, this module relocates with no API change beyond imports.
 *
 * Behaviour:
 *   - `qualified`     → full email to the qualified-recipient inbox.
 *   - `referred_out`  → lighter email to the referred-out-recipient inbox
 *                       (defaults to the qualified inbox if not set —
 *                       Tier 3 plan E.t3 §"referred_out variants" allows
 *                       Julie to decide later whether referrals split out).
 *   - `disqualified`  → no email. Durable record only (E.t2 / future).
 *   - `inconclusive`  → no email. Durable record only (E.3 pattern, per
 *                       HITL Q5 — agent never reached confidence).
 *
 * Templates live at `cms/templates/handoff/{qualified,referred-out}.md`,
 * loaded at send time so authoring iterations don't require a restart in
 * dev. Substitution uses the tiny `renderTemplate` helper —
 * `{{path.to.field}}` plus pre-formatted helper keys (e.g.
 * `visitorActivities`, `wishlistFormatted`) computed below.
 *
 * Off-by-default. The orchestrator's config exposes `HANDOFF_EMAIL_ENABLED`
 * (boolean) gated on the operator providing real SMTP credentials and a
 * sales-inbox address (tracked in `questions.md` — pending Julie). When
 * disabled, the mailer is a no-op that returns `{ status: 'skipped',
 * reason: 'mailer_disabled' }` so handoff_submit can still log the
 * durable record without trying to send.
 *
 * Integration point — currently unwired:
 *   The lead-capture widget calls `props.addResult(payload)` to resolve
 *   the orchestrator's `handoff` tool call. The orchestrator-side
 *   `handoff_submit` handler (E.t2 + E.t3 proper) will:
 *     1. Validate the payload against `HandoffPayloadSchema`
 *        (`@swoop/common/handoff`).
 *     2. Persist the durable record (Cloud SQL Postgres once IAM lands
 *        per E.10 + C.18 + C.23 — Firestore was the original target but is
 *        dropped; today an `FsHandoffStore` interim writes JSON to disk).
 *     3. Call `sendHandoffEmail(payload, mailerConfig)` if the verdict is
 *        `qualified` or `referred_out`.
 *     4. Emit observability events
 *        (`handoff.submitted`, `handoff.email.sent | skipped | failed`).
 *   None of those exist today. This module is the plumbed-but-not-yet-
 *   called dependency they will reach for.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';
import { messageOf } from '@swoop/common';
import type {
  HandoffPayload,
  HandoffPayloadQualified,
  HandoffPayloadReferredOut,
  VisitorProfile,
  HandoffWishlistEntry,
} from '@swoop/common';

import { renderTemplate } from './template-renderer.js';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * Configuration the mailer needs at send time. Built by the caller from
 * the orchestrator's `Config` object — the mailer doesn't read env vars
 * directly so it stays unit-testable without process.env mocking.
 */
export interface MailerConfig {
  /** Master kill-switch. When false, every send returns `skipped`. */
  readonly enabled: boolean;
  /** Absolute path to `cms/templates/handoff/`. */
  readonly templatesDirAbsolutePath: string;
  /** From-address on every email. Required when `enabled === true`. */
  readonly fromAddress: string;
  /** Where qualified leads go. Required when `enabled === true`. */
  readonly qualifiedRecipient: string;
  /**
   * Where referred-out leads go. Falls back to `qualifiedRecipient` if
   * empty — common case at launch (one inbox, subject prefix
   * differentiates).
   */
  readonly referredOutRecipient: string;
  /** SMTP transport options. */
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user?: string;
    readonly pass?: string;
  };
}

/**
 * The result returned from a send attempt. The caller (handoff_submit
 * handler) routes this into observability events + the durable record.
 */
export type SendResult =
  | { readonly status: 'sent'; readonly toAddress: string; readonly subject: string }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'mailer_disabled'
        | 'verdict_disqualified'
        | 'verdict_inconclusive';
    }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * Internal seam for tests — pass a stub transporter to bypass real SMTP.
 */
export interface MailerDeps {
  readonly createTransport?: (
    smtp: MailerConfig['smtp'],
  ) => Pick<Transporter, 'sendMail'>;
  readonly readTemplate?: (filePath: string) => string;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Render and send a handoff email. Returns a structured `SendResult`
 * regardless of outcome so the caller can branch / log uniformly.
 */
export async function sendHandoffEmail(
  payload: HandoffPayload,
  config: MailerConfig,
  deps: MailerDeps = {},
): Promise<SendResult> {
  if (!config.enabled) {
    return { status: 'skipped', reason: 'mailer_disabled' };
  }
  if (payload.verdict === 'disqualified') {
    return { status: 'skipped', reason: 'verdict_disqualified' };
  }
  if (payload.verdict === 'inconclusive') {
    // No email per HITL Q5 — same pattern as disqualified.
    return { status: 'skipped', reason: 'verdict_inconclusive' };
  }

  const templateFilename =
    payload.verdict === 'qualified' ? 'qualified.md' : 'referred-out.md';
  const templatePath = path.join(config.templatesDirAbsolutePath, templateFilename);

  const readTemplate = deps.readTemplate ?? ((p: string) => readFileSync(p, 'utf8'));
  let rawTemplate: string;
  try {
    rawTemplate = readTemplate(templatePath);
  } catch (err) {
    const message = messageOf(err);
    return { status: 'failed', reason: `template_read_failed: ${message}` };
  }

  const data = preparePayloadForTemplate(payload);
  const body = renderTemplate(rawTemplate, data);
  const subject = computeSubject(payload);
  const toAddress =
    payload.verdict === 'qualified'
      ? config.qualifiedRecipient
      : config.referredOutRecipient || config.qualifiedRecipient;

  const transporter =
    deps.createTransport?.(config.smtp) ?? nodemailer.createTransport(config.smtp);

  const mailOptions: SendMailOptions = {
    from: config.fromAddress,
    to: toAddress,
    subject,
    text: body,
  };

  try {
    await transporter.sendMail(mailOptions);
    return { status: 'sent', toAddress, subject };
  } catch (err) {
    const message = messageOf(err);
    return { status: 'failed', reason: `smtp_send_failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Subject line.
//
// R3 (defence-in-depth): strip CR / LF / control chars from any visitor-
// supplied component before interpolating into the subject. The schema's
// regex on `HandoffContactSchema.name` is the primary guard; this is the
// belt-and-braces second line — if a future caller ever bypasses the
// schema or passes us a partially-validated value, header-injection (`Foo
// \r\nBcc: attacker@example.com`) still cannot reach nodemailer.
// ---------------------------------------------------------------------------

/**
 * Strip ASCII control characters (CR, LF, NUL, DEL, etc.) from a string.
 * Conservative: removes anything < 0x20 plus 0x7F.
 */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, '');
}

function computeSubject(payload: HandoffPayload): string {
  switch (payload.verdict) {
    case 'qualified':
      return stripControlChars(
        `Swoop lead — ${payload.contact.name} (qualified, ${payload.reason.code})`,
      );
    case 'referred_out':
      return stripControlChars(
        `Swoop referral — ${payload.contact.name} (referred_out, ${payload.reason.code})`,
      );
    case 'disqualified':
      // Unreachable under normal flow (we early-return above), but
      // exhaustive switch keeps the type checker honest.
      return stripControlChars(`Swoop lead — disqualified (${payload.reason.code})`);
    case 'inconclusive':
      // Unreachable under normal flow (early-return above), but exhaustive
      // switch keeps the type checker honest after the HITL Q5 extension.
      return stripControlChars(`Swoop lead — inconclusive (${payload.reason.code})`);
  }
}

// ---------------------------------------------------------------------------
// Payload preparation.
//
// The renderer is deliberately string-substitution-only (no array loops, no
// conditionals) — so we do the formatting work here in JS and surface
// authored-friendly top-level keys the template consumes by name.
// ---------------------------------------------------------------------------

/** Visible to tests only. */
export function preparePayloadForTemplate(
  payload: HandoffPayloadQualified | HandoffPayloadReferredOut | HandoffPayload,
): Record<string, unknown> {
  const v = payload.verdict;
  // No-contact verdicts: disqualified and inconclusive (per HITL Q5).
  const contact =
    v === 'disqualified' || v === 'inconclusive' ? null : payload.contact;

  // R3 (defence-in-depth): scrub control chars from visitor-influenced
  // template-bound fields before substitution. Schema already enforces
  // newline-free + length caps; this is the second line if a future
  // caller bypasses validation. `motivationAnchor` and `reason.text` are
  // freeform-narrative fields by design — they survive control-char
  // scrubbing semantically but are no longer header-injection vectors
  // when interpolated into email bodies.
  const scrubbedContact = contact
    ? {
        ...contact,
        name: stripControlChars(contact.name),
        email: stripControlChars(contact.email),
        phone: contact.phone ? stripControlChars(contact.phone) : contact.phone,
        timeZoneHint: contact.timeZoneHint
          ? stripControlChars(contact.timeZoneHint)
          : contact.timeZoneHint,
      }
    : null;

  // The base spread carries `payload.contact`, `payload.motivationAnchor`,
  // `payload.reason` — overwrite the visitor-influenced ones with scrubbed
  // forms so `{{contact.name}}`, `{{motivationAnchor}}`, `{{reason.text}}`
  // get the safe values during template substitution.
  return {
    ...payload,
    ...(scrubbedContact ? { contact: scrubbedContact } : {}),
    // motivationAnchor is optional on the agent-facing tool args (an
    // early-turn handoff may have no clear motivation read yet), so render
    // a fallback when the durable payload carries an empty string — keeps
    // the email's "Why this trip, why now" section reading cleanly either
    // way.
    motivationAnchor:
      payload.motivationAnchor && payload.motivationAnchor.trim().length > 0
        ? stripControlChars(payload.motivationAnchor)
        : '(not surfaced)',
    reason: { ...payload.reason, text: stripControlChars(payload.reason.text) },

    // ---- Contact fallbacks (disqualified has no contact field) -----------
    contactPhoneOrDash: formatOptional(scrubbedContact?.phone),
    contactPreferredMethod: formatOptional(scrubbedContact?.preferredMethod),
    contactTimeZoneOrDash: formatOptional(scrubbedContact?.timeZoneHint),

    // ---- Visitor profile -------------------------------------------------
    visitorIndependence: formatOptional(payload.visitorProfile.independenceLevel),
    visitorBudgetBand: formatOptional(payload.visitorProfile.budgetBand),
    visitorActivities: formatActivityList(payload.visitorProfile),
    visitorRegions: formatRegionList(payload.visitorProfile),

    // ---- Wishlist (multi-line bulleted) ---------------------------------
    wishlistFormatted: formatWishlist(payload.wishlist),

    // ---- Additional notes (visitor-supplied free text) ------------------
    // Visitor's "Anything else the specialist should know?" textarea
    // (frosty-leavitt-handoff-form-polish, 2026-05-19). Sanitised the same
    // way as other visitor-influenced strings; renders as the literal "—"
    // when absent so the template section reads cleanly either way.
    additionalNotesOrNone: payload.additionalNotes
      ? stripControlChars(payload.additionalNotes)
      : '—',

    // ---- Session ---------------------------------------------------------
    sessionEntryUrlOrDash: formatOptional(payload.session.entryUrl),

    // ---- Consent ---------------------------------------------------------
    consentCopyVersionOrDash: formatOptional(payload.consent.consentCopyVersion),
    marketingConsentLabel: formatMarketingConsent(
      payload.consent.marketingGranted,
      payload.consent.marketingTimestamp,
    ),
  };
}

function formatOptional(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—';
  return value;
}

function formatActivityList(profile: VisitorProfile): string {
  if (profile.activityInclination.length === 0) return '(none surfaced)';
  return profile.activityInclination.join(', ');
}

function formatRegionList(profile: VisitorProfile): string {
  if (profile.regionInterest.length === 0) return '(none surfaced)';
  return profile.regionInterest.join(', ');
}

function formatWishlist(items: readonly HandoffWishlistEntry[]): string {
  if (items.length === 0) return '  (none surfaced during the conversation)';
  return items
    .map((item) => {
      const note = item.note ? ` — ${item.note}` : '';
      return `  - ${item.slug} (${item.entityType})${note}`;
    })
    .join('\n');
}

function formatMarketingConsent(granted: boolean | undefined, ts: string | undefined): string {
  if (granted === undefined) return 'not asked';
  if (granted === false) return 'declined';
  return ts ? `granted at ${ts}` : 'granted';
}
