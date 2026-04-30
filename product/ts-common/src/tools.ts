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
// `search` and `get_detail` from the A.t2 stub are **deprecated** here. They
// stay exported so the orchestrator's existing connector adapter compiles;
// B.t3a removes them when it rewrites the adapter against the new surface.
//
// Tool descriptions live in `cms/prompts/tools/<tool>/description.md` per
// G.11 — the prose Sonnet reads to pick a tool. The `TOOL_DESCRIPTIONS` map
// here carries placeholder strings for runtime tool registration; the
// authoritative copy is the markdown.
// -----------------------------------------------------------------------------

import { z } from "zod";

import {
  CustomerStoryPublicSchema,
  InformChunkPublicSchema,
  InspirePassagePublicSchema,
  TripCardPublicSchema,
  TrustProofPublicSchema,
  TrustProofTopicSchema,
} from "./derived.js";

// =============================================================================
// DEPRECATED — superseded 2026-04-29 by the eight-tool intent-named surface.
// Removed in B.t3a when the orchestrator's connector adapter is rewritten.
// =============================================================================

// -----------------------------------------------------------------------------
// search — keyword / semantic lookup across domain entities.
//
// @deprecated since 2026-04-29 — superseded by `lookup` (free-form factual)
// and `find_options` (structured trip filter). Removed in B.t3a.
// -----------------------------------------------------------------------------

/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export const SearchInputSchema = z.object({
  query: z.string().min(1),
  entityTypes: z.array(z.enum(["trip", "tour", "region", "story"])).optional(),
  limit: z.number().int().positive().max(20).optional(),
});
/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export type SearchInput = z.infer<typeof SearchInputSchema>;

/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export const SearchHitSchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  score: z.number().min(0).max(1),
});
/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export type SearchHit = z.infer<typeof SearchHitSchema>;

/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export const SearchOutputSchema = z.object({
  hits: z.array(SearchHitSchema),
  totalMatches: z.number().int().nonnegative(),
});
/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

// -----------------------------------------------------------------------------
// get_detail — full record for a single entity.
//
// @deprecated since 2026-04-29 — superseded by `lookup` (free-form factual)
// and `find_options` (structured trip filter). Removed in B.t3a.
// -----------------------------------------------------------------------------

/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export const GetDetailInputSchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  slug: z.string(),
});
/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export type GetDetailInput = z.infer<typeof GetDetailInputSchema>;

/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export const GetDetailOutputSchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  record: z.record(z.string(), z.unknown()),
});
/** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
export type GetDetailOutput = z.infer<typeof GetDetailOutputSchema>;

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
// -----------------------------------------------------------------------------

export const HandoffInputSchema = z.object({
  verdict: z.enum(["qualified", "referred_out", "disqualified"]),
  reasonCode: z.string(),
  conversationSummary: z.string(),
  motivationAnchor: z.string(),
});
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
// Used when the visitor is ready to consider concrete trips. Returns 2–4
// trip cards: image, headline, vibe-line, region, headline price, duration.
// Filters are structured (region, duration, budget band, activity, accom
// style) — the agent constructs these from conversation signal.
// -----------------------------------------------------------------------------

export const BudgetBandSchema = z.enum(["budget", "mid", "premium", "luxury"]);
export type BudgetBand = z.infer<typeof BudgetBandSchema>;

export const FindOptionsInputSchema = z
  .object({
    region: z.string().optional(),
    durationMin: z.number().int().positive().optional(),
    durationMax: z.number().int().positive().optional(),
    budgetBand: BudgetBandSchema.optional(),
    activity: z.string().optional(),
    accommodationStyle: z.string().optional(),
    /** Cap on returned cards. Defaults to 4. */
    limit: z.number().int().positive().max(6).default(4),
  })
  .strict();
export type FindOptionsInput = z.infer<typeof FindOptionsInputSchema>;

export const FindOptionsOutputSchema = z
  .object({
    cards: z.array(TripCardPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type FindOptionsOutput = z.infer<typeof FindOptionsOutputSchema>;

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
  Illustrate: "illustrate",
  Handoff: "handoff",
  HandoffSubmit: "handoff_submit",
  // Deprecated — kept for orchestrator compile until B.t3a
  Search: "search",
  GetDetail: "get_detail",
} as const;
export type ToolNameKey = keyof typeof TOOL_NAMES;
export type ToolNameValue = (typeof TOOL_NAMES)[ToolNameKey];

// =============================================================================
// TOOL_DESCRIPTIONS — short labels for runtime tool registration.
//
// THE AUTHORITATIVE TOOL DESCRIPTIONS LIVE AT
// `product/cms/prompts/tools/<tool-name>/description.md` (per G.11).
//
// Tool code reads its CMS folder explicitly. The strings here are runtime
// labels for tool registration where a description string is required by the
// SDK shape but the rich Sonnet-facing prose comes from the markdown. They're
// short on purpose — duplication across two surfaces invites drift.
//
// TODO(C.t4): The placeholder strings below contain pointers like
// "See cms/prompts/tools/<tool>/description.md" but no actual loading
// happens here. C.t4 (tool registration in the connector boot path) is
// responsible for: (1) reading the markdown at startup from
// `product/cms/prompts/tools/<tool>/description.md`, (2) substituting the
// rich prose into the MCP tool registration before the connector advertises
// the tool surface, and (3) failing fast if any expected description.md is
// missing. Until that wiring lands, Sonnet sees the short labels here, not
// the full markdown. This comment is the breadcrumb so the loading step
// doesn't get missed during C.t4.
// =============================================================================

export const TOOL_DESCRIPTIONS = {
  // ---------- Eight-tool intent-named surface (C.25) ----------
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
  illustrate:
    "Return curated imagery matching a conversation moment. Use keywords or " +
    "a region slug. Visual companion to any of the content tools. See " +
    "cms/prompts/tools/illustrate/description.md.",
  handoff:
    "Trigger the lead-capture widget with a verdict (qualified / referred_out / " +
    "disqualified), reason, and conversation summary. Tier-2 consent is " +
    "captured inside the widget. See cms/prompts/tools/handoff/description.md.",
  handoff_submit:
    "Internal: called by the lead-capture widget when the visitor submits " +
    "contact details + tier-2 consent. Not invoked by the model directly.",

  // ---------- Deprecated (B.t3a removes) ----------
  /** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
  search:
    "[DEPRECATED 2026-04-29 — use lookup or find_options] Search across " +
    "Swoop's curated catalogue — trips, tours, regions, stories.",
  /** @deprecated since 2026-04-29 — superseded by `lookup` / `find_options`. Removed in B.t3a. */
  get_detail:
    "[DEPRECATED 2026-04-29 — use lookup or find_options] Fetch the full " +
    "record for one trip / tour / region / story by slug.",
} as const;

export type ToolName = keyof typeof TOOL_DESCRIPTIONS;
