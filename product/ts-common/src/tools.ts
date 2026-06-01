// -----------------------------------------------------------------------------
// Tool I/O schemas for the Puma tool set.
//
// Per planning/02-impl-retrieval-and-data.md §2.2 + planning/03-exec-c-t2.md.
// The agent's tool surface is **eight intent-named tools** mapped to the five
// conversational jobs (decisions C.24 + C.25):
//
//   find_inspiring   → Inspire
//   find_someone_who → Mirror   (live; graduated 2026-04-30 per decision C.26)
//   find_proof       → Reassure
//   lookup           → Inform
//   find_options     → Propose options
//   illustrate       → Visual companion (any job)
//   handoff          → Open lead-capture
//   handoff_submit   → Submit lead
//
// History note: an earlier iteration shipped librarian-shaped `search` /
// `get_detail` tools from the A.t2 stub. Those were retired 2026-05-02 in
// B.t3a, alongside the orchestrator's connector adapter rewrite — the
// canonical surface is now exactly the eight tools above (no deprecated pair).
// See `discoveries.md` 2026-04-30 entry "Five-jobs / eight-tools / no-composer
// is the load-bearing substrate of chunk C" + the chunk-C ★ Read this first
// anchor in `planning/02-impl-retrieval-and-data.md`.
//
// Tool descriptions live in `cms/prompts/tools/<tool>/description.md` per
// G.11 — the prose Sonnet reads to pick a tool. The `TOOL_DESCRIPTIONS` map
// here carries short labels for runtime tool registration where the SDK
// requires a description string; the authoritative copy is the markdown,
// loaded by the connector at boot via `loadAllToolDescriptions`.
// -----------------------------------------------------------------------------

import { z } from "zod";

import {
  CustomerStoryPublicSchema,
  CustomerTipPublicSchema,
  DerivedImageSchema,
  InformChunkPublicSchema,
  InspirePassagePublicSchema,
  TrustProofPublicSchema,
  TrustProofTopicSchema,
} from "./derived.js";
import {
  DisqualifiedReasonCodeSchema,
  InconclusiveReasonCodeSchema,
  QualifiedReasonCodeSchema,
  ReferredOutReasonCodeSchema,
} from "./handoff.js";

// =============================================================================
// CARRIED FORWARD — unchanged from the A.t2 stub. Match the eight-tool surface.
// =============================================================================

// -----------------------------------------------------------------------------
// illustrate — surface curated images matching a conversation moment.
// -----------------------------------------------------------------------------

export const IllustrateInputSchema = z.object({
  keywords: z.array(z.string()).min(1),
  regionSlug: z.string().optional(),
  count: z.number().int().positive().max(6).optional(),
  /**
   * Image canonical URLs to omit — anti-repetition. The orchestrator
   * auto-supplies this from `SessionState.seenItems.image`; the agent
   * typically does not pass it. Keyed by URL per HITL Q5 ("never show the
   * same picture twice").
   * Per planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
   */
  excludeCanonicalUrls: z.array(z.string()).optional(),
});
export type IllustrateInput = z.infer<typeof IllustrateInputSchema>;

export const IllustrateOutputSchema = z.object({
  images: z.array(
    z.object({
      id: z.string(),
      url: z.string().url(),
      altText: z.string(),
      caption: z.string().optional(),
    }),
  ),
});
export type IllustrateOutput = z.infer<typeof IllustrateOutputSchema>;

// -----------------------------------------------------------------------------
// handoff — trigger the lead-capture widget. Tier-1 (conversation) consent is
// a precondition; tier-2 (handoff) consent is captured inside the widget
// before handoff_submit fires.
//
// Per VERDICT-E.t1 (2026-05-13, decisions E.verdict-1..4): the tool input is
// a discriminated union over `verdict`, with per-verdict `reasonCode`
// constrained to the matching enum from `handoff.ts`. Catches invalid
// `(verdict, reasonCode)` combinations at the agent tool-call boundary,
// not late at the server-side `HandoffPayloadSchema` parse.
// -----------------------------------------------------------------------------

const HandoffInputCommonFields = {
  // The rich, archetype-aware narrative the specialist will read. Carries
  // motivation reads, signal-pattern observations, direct quotes — texture
  // the specialist uses to pick up the conversation warm. Visitor never
  // sees this. Wired through to `reason.text` on the durable record + email.
  specialistSummary: z.string(),
  // Short, logistical-only summary shown to the visitor inside the
  // lead-capture form as reassurance their choices have been captured.
  // MUST NOT carry archetype reads, relational-mode reads, or motivation
  // interpretations — see cms/prompts/tools/handoff/description.md for the
  // rule. Optional on the schema because disqualified / inconclusive
  // verdicts don't render the widget; the tool description steers it to
  // be present on qualified / referred_out.
  visitorPrecis: z.string().optional(),
  // The visitor's "why this trip, why now" in their own words where
  // possible. Optional because the agent honestly can't always read
  // motivation — early-turn handoffs (a Skeptic pushing back on a
  // redirect; a transactional Browser saying "connect me anyway") may
  // have no clear motivation surfaced yet. Forcing the agent to invent
  // one is worse than letting the specialist establish it on the call.
  // Wire + payload schemas already treat this as optional; this aligns
  // the agent-facing tool schema with that posture.
  motivationAnchor: z.string().optional(),
} as const;

export const HandoffInputQualifiedSchema = z
  .object({
    verdict: z.literal("qualified"),
    reasonCode: QualifiedReasonCodeSchema,
    ...HandoffInputCommonFields,
  })
  .strict();
export type HandoffInputQualified = z.infer<typeof HandoffInputQualifiedSchema>;

export const HandoffInputReferredOutSchema = z
  .object({
    verdict: z.literal("referred_out"),
    reasonCode: ReferredOutReasonCodeSchema,
    ...HandoffInputCommonFields,
  })
  .strict();
export type HandoffInputReferredOut = z.infer<typeof HandoffInputReferredOutSchema>;

export const HandoffInputDisqualifiedSchema = z
  .object({
    verdict: z.literal("disqualified"),
    reasonCode: DisqualifiedReasonCodeSchema,
    ...HandoffInputCommonFields,
  })
  .strict();
export type HandoffInputDisqualified = z.infer<typeof HandoffInputDisqualifiedSchema>;

export const HandoffInputInconclusiveSchema = z
  .object({
    verdict: z.literal("inconclusive"),
    reasonCode: InconclusiveReasonCodeSchema,
    ...HandoffInputCommonFields,
  })
  .strict();
export type HandoffInputInconclusive = z.infer<typeof HandoffInputInconclusiveSchema>;

export const HandoffInputSchema = z.discriminatedUnion("verdict", [
  HandoffInputQualifiedSchema,
  HandoffInputReferredOutSchema,
  HandoffInputDisqualifiedSchema,
  HandoffInputInconclusiveSchema,
]);
export type HandoffInput = z.infer<typeof HandoffInputSchema>;

export const HandoffOutputSchema = z.object({
  status: z.enum(["widget_triggered", "noop"]),
  widgetToken: z.string().optional(),
});
export type HandoffOutput = z.infer<typeof HandoffOutputSchema>;

// -----------------------------------------------------------------------------
// handoff_submit — internal: called by the lead-capture widget with the
// visitor's contact details + tier-2 consent.
// -----------------------------------------------------------------------------

export const HandoffSubmitInputSchema = z.object({
  widgetToken: z.string(),
  contact: z
    .object({
      name: z.string(),
      email: z.string().email(),
      preferredMethod: z.enum(["email", "phone", "either"]).optional(),
      phone: z.string().optional(),
      timeZoneHint: z.string().optional(),
    })
    .optional(),
  consent: z.object({
    handoffGranted: z.boolean(),
    marketingGranted: z.boolean().optional(),
    consentCopyVersion: z.string().optional(),
  }),
});
export type HandoffSubmitInput = z.infer<typeof HandoffSubmitInputSchema>;

export const HandoffSubmitOutputSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  handoffId: z.string().optional(),
  rejectionReason: z.string().optional(),
});
export type HandoffSubmitOutput = z.infer<typeof HandoffSubmitOutputSchema>;

// =============================================================================
// NEW — five intent-named content tools (decision C.25).
// =============================================================================

// -----------------------------------------------------------------------------
// find_inspiring — Inspire job.
//
// Used when the visitor's energy is curiosity, not specifics. Returns 2–4
// vivid passages the agent can weave into <utter>.
// -----------------------------------------------------------------------------

export const FindInspiringInputSchema = z
  .object({
    /** Free-text theme phrase: "torres del paine in autumn", "puma photography". */
    query: z.string().min(1).max(200),
    /** Optional region narrowing — matches `ntag.alias` on type='area'. */
    region: z.string().optional(),
    /** Optional mood/atmosphere narrowing — "remote", "social", "wild". */
    mood: z.string().optional(),
    /** Cap on returned passages. Defaults to 4 — enough variety, not overload. */
    limit: z.number().int().positive().max(8).default(4),
    /**
     * Passage uuids to omit — anti-repetition. The orchestrator auto-supplies
     * from `SessionState.seenItems.inspire_passage`. Per
     * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
     */
    excludeIds: z.array(z.string()).optional(),
    /**
     * Image canonical URLs to omit from embedded images — anti-repetition.
     * Auto-supplied from `SessionState.seenItems.image`. Keyed by URL per
     * HITL Q5 ("never show the same picture twice") and Q6 (embedded images
     * are marked shown alongside their parent row).
     */
    excludeImageCanonicalUrls: z.array(z.string()).optional(),
  })
  .strict();
export type FindInspiringInput = z.infer<typeof FindInspiringInputSchema>;

export const FindInspiringOutputSchema = z
  .object({
    passages: z.array(InspirePassagePublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type FindInspiringOutput = z.infer<typeof FindInspiringOutputSchema>;

// -----------------------------------------------------------------------------
// find_someone_who — Mirror job. Live since 2026-04-30 (decision C.26 closed).
//
// Used when the visitor reveals a persona signal ("I'm going alone",
// "we're retiring next year", "I'm into wildlife photography"). Returns
// 1–3 customer stories where someone with a similar persona has done a
// similar trip.
// -----------------------------------------------------------------------------

export const FindSomeoneWhoInputSchema = z
  .object({
    /** Free-text persona signal — what the visitor revealed about themselves. */
    signal: z.string().min(1).max(200),
    /** Optional region narrowing if the visitor named one. */
    region: z.string().optional(),
    /** Cap on returned stories. Defaults to 3 — enough echo, not crowding. */
    limit: z.number().int().positive().max(5).default(3),
    /**
     * Story uuids to omit — anti-repetition. The orchestrator auto-supplies
     * from `SessionState.seenItems.customer_story`. Per
     * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
     */
    excludeIds: z.array(z.string()).optional(),
    /**
     * Image canonical URLs to omit from embedded images — anti-repetition.
     * Auto-supplied from `SessionState.seenItems.image`.
     */
    excludeImageCanonicalUrls: z.array(z.string()).optional(),
  })
  .strict();
export type FindSomeoneWhoInput = z.infer<typeof FindSomeoneWhoInputSchema>;

export const FindSomeoneWhoOutputSchema = z
  .object({
    stories: z.array(CustomerStoryPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type FindSomeoneWhoOutput = z.infer<typeof FindSomeoneWhoOutputSchema>;

// -----------------------------------------------------------------------------
// find_proof — Reassure job.
//
// Used when a hesitation surfaces — about Swoop's credibility, the operator
// quality, environmental impact, safety, expertise. Returns 1–3 trust-proof
// items: claim + evidence + source URL.
// -----------------------------------------------------------------------------

export const FindProofInputSchema = z
  .object({
    /** The concern as the visitor expressed it (or the agent's read of it). */
    concern: z.string().min(1).max(200),
    /** Optional explicit topic narrowing. */
    topic: TrustProofTopicSchema.optional(),
    /** Cap on returned proofs. Defaults to 3. */
    limit: z.number().int().positive().max(5).default(3),
    /**
     * Proof uuids to omit — anti-repetition. The orchestrator auto-supplies
     * from `SessionState.seenItems.trust_proof`. Per
     * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
     */
    excludeIds: z.array(z.string()).optional(),
  })
  .strict();
export type FindProofInput = z.infer<typeof FindProofInputSchema>;

export const FindProofOutputSchema = z
  .object({
    proofs: z.array(TrustProofPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type FindProofOutput = z.infer<typeof FindProofOutputSchema>;

// -----------------------------------------------------------------------------
// lookup — Inform job.
//
// Used when the visitor asks a concrete question expecting a concrete answer:
// "How long is the W trek?", "Is December crowded?", "Do I need a visa?".
// Returns relevant prose chunks with canonical URLs the agent can link to.
// -----------------------------------------------------------------------------

export const LookupInputSchema = z
  .object({
    /** The visitor's question, in their own words where possible. */
    question: z.string().min(1).max(300),
    /** Cap on returned chunks. Defaults to 5. */
    limit: z.number().int().positive().max(8).default(5),
    /**
     * Chunk uuids to omit — anti-repetition. The orchestrator auto-supplies
     * from `SessionState.seenItems.inform_chunk`. Per
     * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
     */
    excludeIds: z.array(z.string()).optional(),
  })
  .strict();
export type LookupInput = z.infer<typeof LookupInputSchema>;

export const LookupOutputSchema = z
  .object({
    chunks: z.array(InformChunkPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type LookupOutput = z.infer<typeof LookupOutputSchema>;

// -----------------------------------------------------------------------------
// find_options — Propose options job.
//
// Used when the visitor is ready to consider concrete options. Returns 2–4
// *proposal cards* — polymorphic over four variants:
//   trip         | flexible package; today's default
//   tour         | guided fixed-itinerary group product (Luke upsell priority)
//   hotel        | accommodation as a concrete option (per-night pricing)
//   region_base  | a region framed as a launchpad ("use this as a base")
//
// The discriminator is the `type` literal on every card. The UI dispatches
// per-variant renderers from that discriminator. Filters are structured
// (region, duration, budget band, activity, accommodation style) plus an
// optional `preferredType` steer when the conversational signal is decisive.
//
// Per crosscut plan `03-exec-crosscut-find-options-polymorphism.md` + decisions
// C.48 – C.51 (HITL-ratified 2026-05-12). v1 tranche wires only `type: 'trip'`
// live; the day-one contract carries all four variants so the UI is forward
// compatible. v2 (tours, Swoop-data-gated) and v3 (hotels + region_bases)
// follow on the same contract without further schema work.
// -----------------------------------------------------------------------------

export const BudgetBandSchema = z.enum(["budget", "mid", "premium", "luxury"]);
export type BudgetBand = z.infer<typeof BudgetBandSchema>;

/**
 * `preferredType` lets the agent steer the tool toward one variant when the
 * conversational signal is decisive. When unset the handler picks based on
 * filter-to-data alignment. v1 tranche: schema-only (no dispatch logic);
 * decision C.51.
 */
export const ProposalTypeSchema = z.enum([
  "trip",
  "tour",
  "hotel",
  "region_base",
]);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

// -----------------------------------------------------------------------------
// ProposalCardPublicSchema — the discriminated union.
//
// Shared base = what every card renders (image + headline + vibe-line +
// deep-link CTA + region context). Per-variant extensions carry only the
// affordances unique to that card type.
// -----------------------------------------------------------------------------

const ProposalCardBaseFields = {
  id: z.string().min(1),
  slug: z.string().min(1).optional(),
  headline: z.string().min(1),
  vibeLine: z.string().optional(),
  region: z.string().optional(),
  fromPrice: z.number().nullable().optional(),
  currencyCode: z.string().optional(),
  canonicalUrl: z.string().url(),
  image: DerivedImageSchema.optional(),
} as const;

/** Trip — flexible package. Today's shape (preserved); migrated to discriminated. */
export const TripProposalCardSchema = z
  .object({
    type: z.literal("trip"),
    ...ProposalCardBaseFields,
    durationDays: z.number().int().positive().optional(),
    accommodationStyle: z.string().optional(),
    activityTags: z.array(z.string()).default([]),
  })
  .strict();
export type TripProposalCard = z.infer<typeof TripProposalCardSchema>;

/**
 * Tour — guided fixed-itinerary group product (per source `tour` + `tour_item`).
 * Group-size + day-by-day count are the discriminators vs trip.
 *
 * Luke's upsell priority. See cms/prompts/tools/find_options/description.md.
 */
export const TourProposalCardSchema = z
  .object({
    type: z.literal("tour"),
    ...ProposalCardBaseFields,
    durationDays: z.number().int().positive().optional(),
    groupSizeMax: z.number().int().positive().optional(),
    dayCount: z.number().int().positive().optional(),
    accommodationStyle: z.string().optional(),
    activityTags: z.array(z.string()).default([]),
  })
  .strict();
export type TourProposalCard = z.infer<typeof TourProposalCardSchema>;

/**
 * Hotel — accommodation as a concrete option (location-anchored, /night
 * pricing). `pricingUnit` literal carries the per-night discriminator so the
 * UI can branch the price line deterministically.
 */
export const HotelProposalCardSchema = z
  .object({
    type: z.literal("hotel"),
    ...ProposalCardBaseFields,
    location: z.string().optional(),
    starRating: z.number().int().min(1).max(5).optional(),
    accommodationStyle: z.string().optional(),
    pricingUnit: z.literal("per_night").default("per_night"),
  })
  .strict();
export type HotelProposalCard = z.infer<typeof HotelProposalCardSchema>;

/**
 * Region-base — a region/area framed as a launchpad ("use this as a base,
 * explore around"). `nearbyTripsCount` is derivable from `trip` + `area`;
 * `baseFraming` is the prose framing the agent / ETL composes.
 */
export const RegionBaseProposalCardSchema = z
  .object({
    type: z.literal("region_base"),
    ...ProposalCardBaseFields,
    nearbyTripsCount: z.number().int().nonnegative().optional(),
    baseFraming: z.string().optional(),
  })
  .strict();
export type RegionBaseProposalCard = z.infer<typeof RegionBaseProposalCardSchema>;

/** The discriminated union over all four variants. */
export const ProposalCardPublicSchema = z.discriminatedUnion("type", [
  TripProposalCardSchema,
  TourProposalCardSchema,
  HotelProposalCardSchema,
  RegionBaseProposalCardSchema,
]);
export type ProposalCardPublic = z.infer<typeof ProposalCardPublicSchema>;

export const FindOptionsInputSchema = z
  .object({
    region: z.string().optional(),
    durationMin: z.number().int().positive().optional(),
    durationMax: z.number().int().positive().optional(),
    budgetBand: BudgetBandSchema.optional(),
    activity: z.string().optional(),
    accommodationStyle: z.string().optional(),
    /**
     * Optional preferred proposal type. v1 tranche: schema-only — the handler
     * does not yet dispatch off this field (only `trip` is wired live).
     * Decision C.51.
     */
    preferredType: ProposalTypeSchema.optional(),
    /**
     * Cards to omit from the result. Use to avoid repeating items shown
     * earlier in the conversation. Each entry is `{type, id}` so cross-type
     * id-spaces don't collide (a `trip` id 369 doesn't accidentally exclude
     * a `tour` with id 369). The agent owns its own shown-history; the tool
     * does not track session state. Decision C.focused-shamir-5.
     */
    exclude: z
      .array(
        z.object({
          type: ProposalTypeSchema,
          id: z.string().min(1),
        }),
      )
      .optional(),
    /** Cap on returned cards. Defaults to 4. */
    limit: z.number().int().positive().max(6).default(4),
  })
  .strict();
export type FindOptionsInput = z.infer<typeof FindOptionsInputSchema>;

export const FindOptionsOutputSchema = z
  .object({
    cards: z.array(ProposalCardPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type FindOptionsOutput = z.infer<typeof FindOptionsOutputSchema>;

// -----------------------------------------------------------------------------
// find_tips — Inform job, second shape. The 9th tool.
//
// Where `lookup` answers a concrete question with Swoop's own authoritative
// guidance, `find_tips` surfaces traveller-sourced practical wisdom — short,
// first-person tips written by people who've actually made the trip, shown
// WITH attribution ("— Joey A."). Reach for this when the visitor wants the
// kind of lived-experience advice a fellow traveller gives, not an
// institutional answer: "what do people wish they'd known", "any packing
// tips", "is it worth bringing X".
//
// Per planning/03-exec-customer-tips-tool.md (HITL-ratified 2026-05-27).
// `topic` is the free-text subject the visitor is curious about; the optional
// `region` narrows to tips that name a matching Patagonian sub-region (tips
// with no region still surface — most practical wisdom is region-agnostic).
// `excludeIds` carries the anti-repetition set (integer tip ids, not uuids).
// -----------------------------------------------------------------------------

export const FindTipsInputSchema = z
  .object({
    /** Free-text subject — "packing", "what to bring", "altitude", "ferry crossing". */
    topic: z.string().min(1).max(200),
    /** Optional region narrowing; region-agnostic tips still surface alongside. */
    region: z.string().optional(),
    /** Cap on returned tips. Defaults to 4 (range 3–5, hard cap 6). */
    limit: z.number().int().positive().max(6).default(4),
    /**
     * Tip ids to omit — anti-repetition. The orchestrator auto-supplies from
     * `SessionState.seenItems.customer_tip`. Integer-keyed (tip ids are plain
     * integers carried from upstream, not uuids). Per
     * planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
     */
    excludeIds: z.array(z.number().int()).optional(),
  })
  .strict();
export type FindTipsInput = z.infer<typeof FindTipsInputSchema>;

export const FindTipsOutputSchema = z
  .object({
    tips: z.array(CustomerTipPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type FindTipsOutput = z.infer<typeof FindTipsOutputSchema>;

// =============================================================================
// TOOL_NAMES — single source of truth for tool name strings.
//
// Handler files reference tools via this const, not by stringly-typed names.
// Adding a tool: add an entry here; downstream code picks it up.
// =============================================================================

export const TOOL_NAMES = {
  // Eight-tool intent-named surface (C.25)
  FindInspiring: "find_inspiring",
  FindSomeoneWho: "find_someone_who",
  FindProof: "find_proof",
  Lookup: "lookup",
  FindOptions: "find_options",
  FindTips: "find_tips",
  Illustrate: "illustrate",
  Handoff: "handoff",
  HandoffSubmit: "handoff_submit",
} as const;
export type ToolNameKey = keyof typeof TOOL_NAMES;
export type ToolNameValue = (typeof TOOL_NAMES)[ToolNameKey];

// =============================================================================
// TOOL_DESCRIPTIONS — short labels for runtime tool registration where the SDK
// requires a description string but the authoritative copy is the markdown.
//
// THE AUTHORITATIVE TOOL DESCRIPTIONS LIVE AT
// `product/cms/prompts/tools/<tool-name>/description.md` (per G.11).
//
// The connector loads the markdown at boot via `loadAllToolDescriptions` (per
// C.t4) and registers each tool with the rich prose Sonnet reads. The
// orchestrator's connector adapter (post-B.t3a) does the same. The strings
// below are fallback / unit-test labels — the runtime path always prefers the
// loaded markdown.
// =============================================================================

export const TOOL_DESCRIPTIONS = {
  find_inspiring:
    "Surface vivid Patagonia passages — sensory, evocative, ready to weave " +
    "into a response. Reach for this when a visitor's curiosity is open " +
    "rather than specific. See cms/prompts/tools/find_inspiring/description.md.",
  find_someone_who:
    "Surface a customer story about someone with a similar persona to the " +
    "visitor — solo traveller, post-retirement, photographer, etc. Reach " +
    "for this when the visitor reveals a persona signal. See " +
    "cms/prompts/tools/find_someone_who/description.md.",
  find_proof:
    "Surface trust evidence — sustainability credentials, B-Corp status, " +
    "expertise, conservation work, satisfaction signals. Reach for this " +
    "when a hesitation surfaces. See cms/prompts/tools/find_proof/description.md.",
  lookup:
    "Answer a concrete question with relevant prose chunks from FAQ, " +
    "guidebook, and trip detail. Includes canonical URLs for go-see-the-page " +
    "affordances. See cms/prompts/tools/lookup/description.md.",
  find_options:
    "Return concrete trip options matching structured filters (region, " +
    "duration, budget band, activity, accommodation style). Reach for this " +
    "when the visitor is ready to consider specific trips. See " +
    "cms/prompts/tools/find_options/description.md.",
  find_tips:
    "Surface short, first-person practical tips from travellers who've made " +
    "the trip — packing, weather, money, transit, food, and the like — shown " +
    "with attribution. Reach for this when the visitor wants lived-experience " +
    "advice from fellow travellers rather than Swoop's own answer (use lookup " +
    "for that). See cms/prompts/tools/find_tips/description.md.",
  illustrate:
    "Return curated imagery matching a conversation moment. Use keywords or " +
    "a region slug. Visual companion to any of the content tools. See " +
    "cms/prompts/tools/illustrate/description.md.",
  handoff:
    "Trigger the lead-capture widget with a verdict (qualified / referred_out / " +
    "disqualified / inconclusive), reason, and conversation summary. Tier-2 " +
    "consent is captured inside the widget. See " +
    "cms/prompts/tools/handoff/description.md.",
  handoff_submit:
    "Internal: called by the lead-capture widget when the visitor submits " +
    "contact details + tier-2 consent. Not invoked by the model directly.",
} as const;

export type ToolName = keyof typeof TOOL_DESCRIPTIONS;
