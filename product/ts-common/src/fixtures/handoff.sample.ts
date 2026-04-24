// -----------------------------------------------------------------------------
// Handoff fixtures — one per verdict variant.
//
// Per planning/03-exec-handoff-t1.md. These are the schema-valid exemplars
// every downstream consumer (widget, email-template renderer, eval harness)
// can round-trip against. Bodies are minimal-but-real — the motivation anchors
// are deliberately distinct per fixture so a `grep` in a log trace can tell
// them apart.
// -----------------------------------------------------------------------------

import type {
  HandoffPayloadDisqualified,
  HandoffPayloadQualified,
  HandoffPayloadReferredOut,
} from "../handoff.js";

export const SampleHandoffQualified: HandoffPayloadQualified = {
  verdict: "qualified",
  handoffId: "handoff_puma_demo_qualified_001",
  contact: {
    name: "Ada Ríos",
    email: "ada.rios@example.com",
    preferredMethod: "email",
    timeZoneHint: "Europe/London",
  },
  reason: {
    code: "ready_booking_named_trip",
    text:
      "Visitor asked 'how do I book the W Trek for November?' after three turns of W-Trek-focused " +
      "conversation. Budget signals aligned with premium band.",
  },
  visitorProfile: {
    independenceLevel: "semi-guided",
    budgetBand: "premium",
    activityInclination: ["trekking", "photography"],
    regionInterest: ["torres-del-paine"],
  },
  wishlist: [
    {
      entityType: "trip",
      slug: "torres-del-paine-w-trek",
      note: "Preferred refugio-based, not camping.",
    },
    {
      entityType: "region",
      slug: "torres-del-paine",
    },
  ],
  motivationAnchor: "First big trekking trip — wants to feel like they earned it.",
  consent: {
    conversationGranted: true,
    conversationTimestamp: "2026-04-22T09:00:04.000Z",
    handoffGranted: true,
    handoffTimestamp: "2026-04-22T09:07:19.000Z",
    marketingGranted: false,
    consentCopyVersion: "consent-handoff/v1",
  },
  session: {
    sessionId: "sess_puma_demo_qualified_001",
    conversationStartedAt: "2026-04-22T09:00:12.000Z",
    handoffSubmittedAt: "2026-04-22T09:07:23.000Z",
    turnCount: 6,
    entryUrl: "https://www.swoop-patagonia.com/trips/w-trek",
    variantId: "puma-demo-A",
    rawConversationRef: "conversation_sess_puma_demo_qualified_001",
  },
};

export const SampleHandoffReferredOut: HandoffPayloadReferredOut = {
  verdict: "referred_out",
  handoffId: "handoff_puma_demo_referred_001",
  contact: {
    name: "Bruno Carvalho",
    email: "bruno.carvalho@example.com",
    preferredMethod: "either",
  },
  reason: {
    code: "below_profit_floor",
    text:
      "Visitor asked about a 3-night stopover in Punta Arenas only; budget stated as <£500pp. " +
      "Below the profit floor for a specialist call but worth surfacing for visibility.",
  },
  visitorProfile: {
    independenceLevel: "independent",
    budgetBand: "budget",
    activityInclination: ["stopover"],
    regionInterest: ["patagonia"],
  },
  wishlist: [
    {
      entityType: "region",
      slug: "punta-arenas",
    },
  ],
  motivationAnchor: "Using Punta Arenas as a layover before a separate Antarctic cruise.",
  consent: {
    conversationGranted: true,
    conversationTimestamp: "2026-04-22T10:30:00.000Z",
    handoffGranted: true,
    handoffTimestamp: "2026-04-22T10:36:41.000Z",
    marketingGranted: false,
    consentCopyVersion: "consent-handoff/v1",
  },
  session: {
    sessionId: "sess_puma_demo_referred_001",
    conversationStartedAt: "2026-04-22T10:30:06.000Z",
    handoffSubmittedAt: "2026-04-22T10:36:48.000Z",
    turnCount: 4,
    entryUrl: "https://www.swoop-patagonia.com/regions/punta-arenas",
    rawConversationRef: "conversation_sess_puma_demo_referred_001",
  },
};

export const SampleHandoffDisqualified: HandoffPayloadDisqualified = {
  verdict: "disqualified",
  handoffId: "handoff_puma_demo_disqualified_001",
  reason: {
    code: "proxy_to_claude",
    text:
      "Visitor used the chat to ask for help with a Python script. Closed politely and reminded " +
      "them the tool is for Swoop trip discovery.",
  },
  visitorProfile: {
    independenceLevel: undefined,
    budgetBand: "unknown",
    activityInclination: [],
    regionInterest: [],
  },
  wishlist: [],
  motivationAnchor: "Using the chat as a proxy to Claude; no travel intent surfaced.",
  consent: {
    conversationGranted: true,
    conversationTimestamp: "2026-04-22T11:05:00.000Z",
    // Disqualified records still carry handoff-consent state snapshot — the
    // flag is false here because the agent never surfaced the lead-capture
    // widget (verdict decided pre-widget). Timestamp matches the decision
    // time per E.t1's "snapshot at submission" principle.
    handoffGranted: false,
    handoffTimestamp: "2026-04-22T11:06:12.000Z",
  },
  session: {
    sessionId: "sess_puma_demo_disqualified_001",
    conversationStartedAt: "2026-04-22T11:05:07.000Z",
    handoffSubmittedAt: "2026-04-22T11:06:18.000Z",
    turnCount: 2,
    rawConversationRef: "conversation_sess_puma_demo_disqualified_001",
  },
};

/**
 * Back-compat alias. Retire when no consumers import `SampleHandoff` directly.
 * Current consumers: the existing round-trip fixture test + the UI's
 * lead-capture widget test (both accept `SampleHandoffQualified` equivalently).
 */
export const SampleHandoff = SampleHandoffQualified;
