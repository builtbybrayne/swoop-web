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
// Verdict — the top-level discriminator.
// -----------------------------------------------------------------------------

export const HandoffVerdictSchema = z.enum([
  "qualified",
  "referred_out",
  "disqualified",
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

// -----------------------------------------------------------------------------
// Per-verdict reason object: { code, text }.
//
// The `text` field is freeform for sales-specialist context — a narrative
// summary of the qualifying signals. `min(1)` enforces non-empty.
// -----------------------------------------------------------------------------

export const QualifiedReasonSchema = z.object({
  code: QualifiedReasonCodeSchema,
  text: z.string().min(1),
});
export type QualifiedReason = z.infer<typeof QualifiedReasonSchema>;

export const ReferredOutReasonSchema = z.object({
  code: ReferredOutReasonCodeSchema,
  text: z.string().min(1),
});
export type ReferredOutReason = z.infer<typeof ReferredOutReasonSchema>;

export const DisqualifiedReasonSchema = z.object({
  code: DisqualifiedReasonCodeSchema,
  text: z.string().min(1),
});
export type DisqualifiedReason = z.infer<typeof DisqualifiedReasonSchema>;

/**
 * Union of all three variant-specific reasons. Use when a consumer wants to
 * accept any reason shape without discriminating on verdict.
 */
export const HandoffReasonSchema = z.union([
  QualifiedReasonSchema,
  ReferredOutReasonSchema,
  DisqualifiedReasonSchema,
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
// -----------------------------------------------------------------------------

export const HandoffContactSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  preferredMethod: z.enum(["email", "phone", "either"]).optional(),
  phone: z.string().optional(),
  timeZoneHint: z.string().optional(),
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
  motivationAnchor: z.string(),
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

export const HandoffPayloadSchema = z.discriminatedUnion("verdict", [
  HandoffPayloadQualifiedSchema,
  HandoffPayloadReferredOutSchema,
  HandoffPayloadDisqualifiedSchema,
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
