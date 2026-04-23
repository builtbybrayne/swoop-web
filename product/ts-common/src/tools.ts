// -----------------------------------------------------------------------------
// Tool I/O schemas for the Puma tool set.
//
// Per planning/02-impl-foundations.md §6 + planning/02-impl-agent-runtime.md §2.3:
// the agent orchestrator (chunk B) invokes these tools via the connector (chunk C).
// Exact tool set settles during chunk C Tier 2; this stub names five tools as
// the contract location and minimal Input/Output pair for each.
//
// TOOL_DESCRIPTIONS carries forward the descriptive pattern from
// chatgpt_poc/product/ts-common/src/tools.ts — WHY/HOW/WHAT × User/Agent/Swoop
// thinking framework, with the description string itself kept tight. Full
// descriptions firm up when chunk G authors real prompt content.
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// search — keyword / semantic lookup across domain entities.
// -----------------------------------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string().min(1),
  entityTypes: z.array(z.enum(["trip", "tour", "region", "story"])).optional(),
  limit: z.number().int().positive().max(20).optional(),
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

export const SearchHitSchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  score: z.number().min(0).max(1),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchOutputSchema = z.object({
  hits: z.array(SearchHitSchema),
  totalMatches: z.number().int().nonnegative(),
});
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

// -----------------------------------------------------------------------------
// get_detail — full record for a single entity (trip / tour / region / story).
// -----------------------------------------------------------------------------

export const GetDetailInputSchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  slug: z.string(),
});
export type GetDetailInput = z.infer<typeof GetDetailInputSchema>;

// Output is deliberately a freeform record here — the real shape is the matching
// domain schema from ./domain.ts, but wiring a discriminated union across the
// domain types inside the tool module creates a circular-feel; chunk C's real
// implementation will narrow to the right domain schema.
export const GetDetailOutputSchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  record: z.record(z.string(), z.unknown()),
});
export type GetDetailOutput = z.infer<typeof GetDetailOutputSchema>;

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
// a precondition; tier-2 (handoff) consent is captured inside the widget before
// handoff_submit fires. See chunk E §2.3.
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
// visitor's contact details + tier-2 consent. Writes the durable handoff record
// and (verdict-dependent) sends the sales email. See chunk E §2.4 + §2.5.
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

// -----------------------------------------------------------------------------
// TOOL_DESCRIPTIONS — consumed by chunk B when registering tools with ADK.
// Placeholder strings; chunk G authors the real WHY/HOW/WHAT-matrix copy
// against a finalised Puma tool set. Structure carried forward from
// chatgpt_poc/product/ts-common/src/tools.ts.
// -----------------------------------------------------------------------------

export const TOOL_DESCRIPTIONS = {
  search:
    "Search across Swoop's curated catalogue — trips, tours, regions, stories. " +
    "Use when the visitor has named something specific (a destination, a product type) " +
    "or you need to narrow from a loose signal toward concrete options. Returns ranked hits.",
  get_detail:
    "Fetch the full record for one trip / tour / region / story by slug. " +
    "Use after the visitor signals interest in a specific option surfaced by search, " +
    "or when you need facility-level detail (duration, starting price, highlights).",
  illustrate:
    "Surface curated imagery that makes the conversation vivid. Use keywords " +
    "(e.g. ['puma', 'torres-del-paine']) or a region slug. Swoop's experience is that " +
    "seeing a real photograph transforms how a visitor feels about a trip.",
  handoff:
    "Flag the current conversation as a handoff candidate with a verdict " +
    "(qualified / referred_out / disqualified), reason, and conversation summary. " +
    "This triggers the lead-capture widget; tier-2 consent is captured inside the widget " +
    "before any contact detail leaves the browser.",
  handoff_submit:
    "Internal: called by the lead-capture widget when the visitor submits contact " +
    "details + tier-2 consent. Not invoked by the model directly. Writes the durable " +
    "handoff record and (for qualified / referred_out) dispatches the sales email.",
} as const;

export type ToolName = keyof typeof TOOL_DESCRIPTIONS;
