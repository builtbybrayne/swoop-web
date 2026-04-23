// -----------------------------------------------------------------------------
// Handoff payload.
//
// Per planning/02-impl-handoff-and-compliance.md §2.1. Consumed by chunk E
// (durable store + email delivery), chunk F (logs it), chunk G (email template
// renders against it), chunk H (evals assert on it).
//
// Shape decisions:
//   - Verdict is the discriminator on the payload-level union. `contact` is
//     required on qualified / referred_out and absent on disqualified — modelled
//     by splitting into three per-verdict variants.
//   - Reason is a { code, text } pair: structured code for analytics / evals,
//     freeform text for sales-specialist context.
//   - Consent flags mirror SessionState.consent but snapshot-at-submission
//     (the durable record must preserve what was true at the moment of submit,
//     even if session consent later changes).
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// Reason — structured code + freeform text.
// -----------------------------------------------------------------------------

export const HandoffReasonSchema = z.object({
  code: z.string(),
  text: z.string(),
});
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
// -----------------------------------------------------------------------------

const HandoffPayloadCommon = {
  handoffId: z.string(),
  reason: HandoffReasonSchema,
  visitorProfile: VisitorProfileSchema,
  wishlist: z.array(HandoffWishlistEntrySchema),
  motivationAnchor: z.string(),
  consent: HandoffConsentSchema,
  session: HandoffSessionMetadataSchema,
};

export const HandoffPayloadQualifiedSchema = z.object({
  verdict: z.literal("qualified"),
  contact: HandoffContactSchema,
  ...HandoffPayloadCommon,
});

export const HandoffPayloadReferredOutSchema = z.object({
  verdict: z.literal("referred_out"),
  contact: HandoffContactSchema,
  ...HandoffPayloadCommon,
});

export const HandoffPayloadDisqualifiedSchema = z.object({
  verdict: z.literal("disqualified"),
  // No contact field on disqualified — we never ask for it.
  ...HandoffPayloadCommon,
});

export const HandoffPayloadSchema = z.discriminatedUnion("verdict", [
  HandoffPayloadQualifiedSchema,
  HandoffPayloadReferredOutSchema,
  HandoffPayloadDisqualifiedSchema,
]);
export type HandoffPayload = z.infer<typeof HandoffPayloadSchema>;
