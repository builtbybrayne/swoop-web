import type { HandoffPayload } from "../handoff.js";

export const SampleHandoff: HandoffPayload = {
  verdict: "qualified",
  handoffId: "handoff_puma_demo_001",
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
    sessionId: "sess_puma_demo_001",
    conversationStartedAt: "2026-04-22T09:00:12.000Z",
    handoffSubmittedAt: "2026-04-22T09:07:23.000Z",
    turnCount: 6,
    entryUrl: "https://www.swoop-patagonia.com/trips/w-trek",
    variantId: "puma-demo-A",
    rawConversationRef: "conversation_sess_puma_demo_001",
  },
};
