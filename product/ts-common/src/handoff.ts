// -----------------------------------------------------------------------------
// Handoff payload.
//
// Per planning/02-impl-handoff-and-compliance.md §2.1 and
// planning/03-exec-handoff-t1.md (E.t1). Consumed by chunk E (durable store +
// email delivery), chunk F (logs it), chunk G (email template renders against
// it), chunk H (evals assert on it).
//
// Shape decisions:
//   - Verdict is the discriminator on the payload-level union. `contact` is
//     required on qualified / referred_out and absent on disqualified — modelled
//     by splitting into three per-verdict variants.
//   - Reason is a { code, text } pair per verdict: the code is a
//     variant-specific `z.enum` (see below) so analytics / evals get
//     exhaustive-match coverage; the text stays freeform for sales-specialist
//     context.
//   - Codes are deliberately distinct per verdict — no code appears on two
//     verdicts. That means downstream `switch (verdict)` blocks exhaustively
//     cover `reason.code` without projecting on `(verdict, code)` pairs.
//   - The taxonomy is a **starter set**. G.t0 (HITL flow mapping) will refine —
//     rename / reweight / add. The wire shape survives either case because the
//     per-verdict enum is the only surface that would need to change.
//   - Consent flags mirror SessionState.consent but snapshot-at-submission
//     (the durable record must preserve what was true at the moment of submit,
//     even if session consent later changes).
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// Free-text length budgets.
//
// WHY CAPS EXIST AT ALL (R4, 2026-04-30 review): `POST /handoff/submit` is
// publicly reachable from the iframe, so every visitor-suppliable string is
// length-capped to stop unbounded payloads landing in the durable store,
// sha256 inputs, and the specialist email. The caps are abuse bounds, not
// editorial guidance.
//
// WHY 2_000 (recalibrated 2026-06-11): the original 500-char reason.text cap
// predated the frosty-leavitt form polish that routed the agent's RICH
// `specialistSummary` ("favour richness" — tools/handoff/description.md)
// through `reasonText`. Sonnet's organic summaries routinely exceeded 500,
// and the reject fired at the visitor's submit — losing the handoff at the
// product's core conversion moment. 2_000 matches the established narrative
// budget (`motivationAnchor`, `additionalNotes`) and is enforced FIRST at the
// agent tool boundary (tools.ts HandoffInputSchema), where an over-budget
// summary fails the tool call and the agent simply rewrites — recoverable —
// instead of failing the visitor's submission — not.
//
// Every layer (tool input, wire request, durable payload) derives from these
// constants so the caps cannot drift apart again.
// -----------------------------------------------------------------------------

/** Narrative free-text budget: specialistSummary → reason.text,
 *  motivationAnchor, additionalNotes. */
export const HANDOFF_NARRATIVE_TEXT_MAX = 2_000;

/** Visitor-facing precis budget. Behavioural target is ~300 chars (tool
 *  description); the cap is defence headroom, not the target. */
export const HANDOFF_VISITOR_PRECIS_MAX = 500;

// -----------------------------------------------------------------------------
// Verdict — the top-level discriminator.
//
// `inconclusive` was added per HITL Q5 (planning/00-discovery-design-thinking.md
// §3.4) for Path 7 visitors — agent never reaches confidence. Treated like
// `disqualified` for downstream consequences: no email (E.3 pattern), 90-day
// retention (E.7 pattern), no contact field on the durable record.
// -----------------------------------------------------------------------------

export const HandoffVerdictSchema = z.enum([
  "qualified",
  "referred_out",
  "disqualified",
  "inconclusive",
]);
export type HandoffVerdict = z.infer<typeof HandoffVerdictSchema>;

// -----------------------------------------------------------------------------
// Reason codes — per-verdict enums. See planning/03-exec-handoff-t1.md for the
// trigger / sales treatment / expected text per code.
// -----------------------------------------------------------------------------

/** Qualified = warm lead ready for a specialist. */
export const QualifiedReasonCodeSchema = z.enum([
  "ready_booking_named_trip",
  "ready_comparing_shortlist",
  "budget_and_timeline_confirmed",
  "group_tour_intent",
  "bespoke_request",
  "qualified_other",
]);
export type QualifiedReasonCode = z.infer<typeof QualifiedReasonCodeSchema>;

/** Referred out = outside direct Swoop scope but still deserves a next step. */
export const ReferredOutReasonCodeSchema = z.enum([
  "below_profit_floor",
  "out_of_region",
  "timing_outside_window",
  "referred_other",
]);
export type ReferredOutReasonCode = z.infer<typeof ReferredOutReasonCodeSchema>;

/** Disqualified = not a lead. Durable record for analytics; no email. */
export const DisqualifiedReasonCodeSchema = z.enum([
  "backpacker_no_budget",
  "off_brand_query",
  "proxy_to_claude",
  "disqualified_other",
]);
export type DisqualifiedReasonCode = z.infer<typeof DisqualifiedReasonCodeSchema>;

/**
 * Inconclusive = agent never reached confidence to qualify / refer-out /
 * disqualify. Path 7 in planning/00-discovery-design-thinking.md §3.2.
 * Durable record for analytics; no email (E.3 pattern); 90-day retention
 * (E.7 pattern).
 */
export const InconclusiveReasonCodeSchema = z.enum([
  "low_engagement",
  "mixed_signals",
  "extended_no_convergence",
  "comparison_shopping",
  "off_offer_in_region",
  "drive_by",
  "inconclusive_other",
]);
export type InconclusiveReasonCode = z.infer<typeof InconclusiveReasonCodeSchema>;

// -----------------------------------------------------------------------------
// Per-verdict reason object: { code, text }.
//
// The `text` field is freeform for sales-specialist context — a narrative
// summary of the qualifying signals. `min(1)` enforces non-empty.
// -----------------------------------------------------------------------------

// `text` is the freeform sales-specialist context — since the frosty-leavitt
// form polish it carries the agent's rich `specialistSummary` verbatim. The
// R4 abuse bound is HANDOFF_NARRATIVE_TEXT_MAX (see budget block above);
// still prevents a 60kb visitor-supplied string from landing in
// `var/handoffs/<id>.json` + email body + sha256 inputs.

export const QualifiedReasonSchema = z.object({
  code: QualifiedReasonCodeSchema,
  text: z.string().min(1).max(HANDOFF_NARRATIVE_TEXT_MAX),
});
export type QualifiedReason = z.infer<typeof QualifiedReasonSchema>;

export const ReferredOutReasonSchema = z.object({
  code: ReferredOutReasonCodeSchema,
  text: z.string().min(1).max(HANDOFF_NARRATIVE_TEXT_MAX),
});
export type ReferredOutReason = z.infer<typeof ReferredOutReasonSchema>;

export const DisqualifiedReasonSchema = z.object({
  code: DisqualifiedReasonCodeSchema,
  text: z.string().min(1).max(HANDOFF_NARRATIVE_TEXT_MAX),
});
export type DisqualifiedReason = z.infer<typeof DisqualifiedReasonSchema>;

export const InconclusiveReasonSchema = z.object({
  code: InconclusiveReasonCodeSchema,
  text: z.string().min(1).max(HANDOFF_NARRATIVE_TEXT_MAX),
});
export type InconclusiveReason = z.infer<typeof InconclusiveReasonSchema>;

/**
 * Union of all four variant-specific reasons. Use when a consumer wants to
 * accept any reason shape without discriminating on verdict.
 */
export const HandoffReasonSchema = z.union([
  QualifiedReasonSchema,
  ReferredOutReasonSchema,
  DisqualifiedReasonSchema,
  InconclusiveReasonSchema,
]);
export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

// -----------------------------------------------------------------------------
// Visitor profile — persona sketch mapped to the 20 Apr segmentation.
// Placeholder field set; chunk E §2.1 + Friday hackathon refine.
// -----------------------------------------------------------------------------

export const VisitorProfileSchema = z.object({
  independenceLevel: z.enum(["guided", "semi-guided", "independent"]).optional(),
  budgetBand: z.enum(["budget", "mid", "premium", "luxury", "unknown"]).optional(),
  activityInclination: z.array(z.string()).default([]),
  regionInterest: z.array(z.string()).default([]),
});
export type VisitorProfile = z.infer<typeof VisitorProfileSchema>;

// -----------------------------------------------------------------------------
// Wishlist entry on the payload — the durable record of what the visitor
// gravitated to. Mirrors the session wishlist shape but lives independently
// because the payload persists beyond the session.
// -----------------------------------------------------------------------------

export const HandoffWishlistEntrySchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  slug: z.string(),
  note: z.string().optional(),
});
export type HandoffWishlistEntry = z.infer<typeof HandoffWishlistEntrySchema>;

// -----------------------------------------------------------------------------
// Contact — required on qualified / referred_out.
//
// Each string field carries a `.regex(/^[^\r\n]{1,200}$/)` constraint to close
// R3 (email-header injection vector — visitor-supplied newlines flowing into
// nodemailer's `subject` / template-bound fields) and R4 (length cap — visitor
// strings end up in `var/handoffs/<id>.json`, sha256 inputs and the email
// body, so a 200-char cap is defence-in-depth against storage-abuse / DoS).
// 200 chars matches the reasonable upper bound for any contact field; clean
// fixtures sit well under it.
// -----------------------------------------------------------------------------

const ContactStringSchema = z.string().regex(/^[^\r\n]{1,200}$/);

export const HandoffContactSchema = z.object({
  name: ContactStringSchema,
  email: z.string().email().max(200).regex(/^[^\r\n]+$/),
  preferredMethod: z.enum(["email", "phone", "either"]).optional(),
  phone: ContactStringSchema.optional(),
  timeZoneHint: ContactStringSchema.optional(),
});
export type HandoffContact = z.infer<typeof HandoffContactSchema>;

// -----------------------------------------------------------------------------
// Consent flags snapshot at submission time.
// -----------------------------------------------------------------------------

export const HandoffConsentSchema = z.object({
  conversationGranted: z.boolean(),
  conversationTimestamp: z.string().datetime(),
  handoffGranted: z.boolean(),
  handoffTimestamp: z.string().datetime(),
  marketingGranted: z.boolean().optional(),
  marketingTimestamp: z.string().datetime().optional(),
  consentCopyVersion: z.string().optional(),
});
export type HandoffConsent = z.infer<typeof HandoffConsentSchema>;

// -----------------------------------------------------------------------------
// Session metadata snapshot on the payload.
// -----------------------------------------------------------------------------

export const HandoffSessionMetadataSchema = z.object({
  sessionId: z.string(),
  conversationStartedAt: z.string().datetime(),
  handoffSubmittedAt: z.string().datetime(),
  turnCount: z.number().int().nonnegative(),
  entryUrl: z.string().url().optional(),
  variantId: z.string().optional(),
  rawConversationRef: z.string(),
});
export type HandoffSessionMetadata = z.infer<typeof HandoffSessionMetadataSchema>;

// -----------------------------------------------------------------------------
// Per-verdict payload variants.
//
// Each variant `.strict()`s to reject unknown fields — belt-and-braces against
// accidental leakage (e.g. a `contact` block sneaking onto a disqualified
// record).
// -----------------------------------------------------------------------------

const HandoffPayloadCommon = {
  handoffId: z.string(),
  visitorProfile: VisitorProfileSchema,
  wishlist: z.array(HandoffWishlistEntrySchema),
  // R4 cap: visitor-influenced free text. The narrative budget covers a
  // multi-sentence motivation summary; prevents unbounded payloads landing in
  // durable store + sha256 inputs + email body.
  motivationAnchor: z.string().max(HANDOFF_NARRATIVE_TEXT_MAX),
  // Short, logistical-only summary the visitor saw inside the lead-capture
  // form. Persisted to the durable record for audit. NEVER appears in the
  // specialist email — the visitor and the specialist see different
  // summaries by design. See cms/prompts/tools/handoff/description.md.
  visitorPrecis: z.string().max(HANDOFF_VISITOR_PRECIS_MAX).optional(),
  // Free text from the visitor's "Anything else the specialist should know?"
  // textarea. Optional. Rendered into the email under its own section.
  additionalNotes: z.string().max(HANDOFF_NARRATIVE_TEXT_MAX).optional(),
  consent: HandoffConsentSchema,
  session: HandoffSessionMetadataSchema,
};

export const HandoffPayloadQualifiedSchema = z
  .object({
    verdict: z.literal("qualified"),
    contact: HandoffContactSchema,
    reason: QualifiedReasonSchema,
    ...HandoffPayloadCommon,
  })
  .strict();
export type HandoffPayloadQualified = z.infer<typeof HandoffPayloadQualifiedSchema>;

export const HandoffPayloadReferredOutSchema = z
  .object({
    verdict: z.literal("referred_out"),
    contact: HandoffContactSchema,
    reason: ReferredOutReasonSchema,
    ...HandoffPayloadCommon,
  })
  .strict();
export type HandoffPayloadReferredOut = z.infer<typeof HandoffPayloadReferredOutSchema>;

export const HandoffPayloadDisqualifiedSchema = z
  .object({
    verdict: z.literal("disqualified"),
    // No contact field on disqualified — we never ask for it. `.strict()`
    // means a caller that leaks `contact` onto this variant fails parsing.
    reason: DisqualifiedReasonSchema,
    ...HandoffPayloadCommon,
  })
  .strict();
export type HandoffPayloadDisqualified = z.infer<typeof HandoffPayloadDisqualifiedSchema>;

export const HandoffPayloadInconclusiveSchema = z
  .object({
    verdict: z.literal("inconclusive"),
    // No contact field on inconclusive — agent never surfaced the
    // lead-capture widget because it never reached confidence. Same shape
    // as disqualified per HITL Q5.
    reason: InconclusiveReasonSchema,
    ...HandoffPayloadCommon,
  })
  .strict();
export type HandoffPayloadInconclusive = z.infer<typeof HandoffPayloadInconclusiveSchema>;

export const HandoffPayloadSchema = z.discriminatedUnion("verdict", [
  HandoffPayloadQualifiedSchema,
  HandoffPayloadReferredOutSchema,
  HandoffPayloadDisqualifiedSchema,
  HandoffPayloadInconclusiveSchema,
]);
export type HandoffPayload = z.infer<typeof HandoffPayloadSchema>;

// -----------------------------------------------------------------------------
// Backstop-contract helper type.
//
// Contract: E.t2's connector-side guard rejects a `handoff_submit` payload
// unless BOTH consent flags are true. This type surfaces the shape of the
// input to that guard. Runtime check lives in E.t2.
// -----------------------------------------------------------------------------

export type HandoffSubmitConsentGate = Pick<
  HandoffPayload["consent"],
  "conversationGranted" | "handoffGranted"
>;

// -----------------------------------------------------------------------------
// HandoffSubmitRequestSchema — the HTTP wire shape between the lead-capture
// widget and the orchestrator's `POST /handoff/submit` endpoint.
//
// What's IN this shape:
//   - `sessionId` — the orchestrator looks up session state to enrich the
//     payload (tier-1 consent timestamp, conversation start, turn count,
//     wishlist accumulator, motivationAnchor in session if present).
//   - The agent's tool-call args (`verdict`, `reasonCode`, `reasonText`,
//     `motivationAnchor`) — passed back from the widget which received them
//     via `props.args`.
//   - The form's contact + tier-2 consent (handoff + optional marketing).
//
// What's OUT of this shape (server enriches before validating against
// `HandoffPayloadSchema`):
//   - `handoffId` — server-generated.
//   - `consent.conversationGranted` + `conversationTimestamp` — pulled from
//     session state (the source of truth for tier-1 consent).
//   - `session` block — derived from session state + the request itself.
//   - `visitorProfile` + `wishlist` — read from session state.
// -----------------------------------------------------------------------------

/**
 * Per VERDICT-E.t1 (2026-05-13, decisions E.verdict-1..4): the wire schema is
 * a discriminated union over `verdict`. Each variant carries the per-verdict
 * `reasonCode` enum from above, mirroring `HandoffPayloadSchema`'s shape.
 * `contact` is required on qualified / referred_out and absent (rejected by
 * `.strict()`) on disqualified / inconclusive. `reasonText` carries the
 * agent's `specialistSummary` verbatim and is capped at
 * HANDOFF_NARRATIVE_TEXT_MAX to mirror the durable record's cap — the same
 * constant also caps the tool input (tools.ts), so an over-budget summary
 * fails at the agent boundary, never here.
 */
const HandoffSubmitRequestConsentSchema = z.object({
  handoffGranted: z.boolean(),
  handoffTimestamp: z.string().datetime(),
  marketingGranted: z.boolean().optional(),
  marketingTimestamp: z.string().datetime().optional(),
  consentCopyVersion: z.string().optional(),
});

const HandoffSubmitRequestCommonFields = {
  sessionId: z.string().min(1),
  reasonText: z.string().min(1).max(HANDOFF_NARRATIVE_TEXT_MAX),
  // Capped on the wire too — without it, an over-budget anchor would sail
  // through here and die at the server-side HandoffPayloadSchema parse,
  // which is the same lost-handoff failure mode reasonText had.
  motivationAnchor: z.string().max(HANDOFF_NARRATIVE_TEXT_MAX).optional(),
  // Visitor-facing summary captured for audit. Persists into the durable
  // record; NEVER reaches the email. Carries the agent's `visitorPrecis`
  // tool arg verbatim. See cms/prompts/tools/handoff/description.md.
  visitorPrecis: z.string().max(HANDOFF_VISITOR_PRECIS_MAX).optional(),
  // Free text from the visitor's "Anything else the specialist should know?"
  // textarea. Trimmed on the widget side; absent if the visitor left it
  // empty. Renders into the specialist email.
  additionalNotes: z.string().max(HANDOFF_NARRATIVE_TEXT_MAX).optional(),
  consent: HandoffSubmitRequestConsentSchema,
} as const;

export const HandoffSubmitRequestQualifiedSchema = z
  .object({
    verdict: z.literal("qualified"),
    reasonCode: QualifiedReasonCodeSchema,
    contact: HandoffContactSchema,
    ...HandoffSubmitRequestCommonFields,
  })
  .strict();
export type HandoffSubmitRequestQualified = z.infer<typeof HandoffSubmitRequestQualifiedSchema>;

export const HandoffSubmitRequestReferredOutSchema = z
  .object({
    verdict: z.literal("referred_out"),
    reasonCode: ReferredOutReasonCodeSchema,
    contact: HandoffContactSchema,
    ...HandoffSubmitRequestCommonFields,
  })
  .strict();
export type HandoffSubmitRequestReferredOut = z.infer<typeof HandoffSubmitRequestReferredOutSchema>;

export const HandoffSubmitRequestDisqualifiedSchema = z
  .object({
    verdict: z.literal("disqualified"),
    reasonCode: DisqualifiedReasonCodeSchema,
    // No contact — `.strict()` rejects if a buggy client supplies one.
    ...HandoffSubmitRequestCommonFields,
  })
  .strict();
export type HandoffSubmitRequestDisqualified = z.infer<typeof HandoffSubmitRequestDisqualifiedSchema>;

export const HandoffSubmitRequestInconclusiveSchema = z
  .object({
    verdict: z.literal("inconclusive"),
    reasonCode: InconclusiveReasonCodeSchema,
    // No contact (matches HandoffPayloadInconclusiveSchema).
    ...HandoffSubmitRequestCommonFields,
  })
  .strict();
export type HandoffSubmitRequestInconclusive = z.infer<typeof HandoffSubmitRequestInconclusiveSchema>;

export const HandoffSubmitRequestSchema = z.discriminatedUnion("verdict", [
  HandoffSubmitRequestQualifiedSchema,
  HandoffSubmitRequestReferredOutSchema,
  HandoffSubmitRequestDisqualifiedSchema,
  HandoffSubmitRequestInconclusiveSchema,
]);
export type HandoffSubmitRequest = z.infer<typeof HandoffSubmitRequestSchema>;

export const HandoffSubmitResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    handoffId: z.string(),
    emailStatus: z.enum(["sent", "skipped", "failed"]),
    emailReason: z.string().optional(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      "session_not_found",
      "consent_required",
      "invalid_request",
      "consent_missing",
      "store_failed",
      "internal_error",
    ]),
    detail: z.string().optional(),
  }),
]);
export type HandoffSubmitResponse = z.infer<typeof HandoffSubmitResponseSchema>;
