import type { Event } from "../events.js";

// One representative event — `handoff.submitted`, end-of-funnel. Enough to
// prove the envelope + payload round-trip. Chunk F authors richer fixtures
// when F.t1 lands.
export const SampleEvent: Event = {
  eventType: "handoff.submitted",
  eventVersion: 1,
  timestamp: "2026-04-22T09:07:23.000Z",
  sessionId: "sess_puma_demo_001",
  turnIndex: 6,
  actor: "agent",
  payload: {
    handoffId: "handoff_puma_demo_001",
    verdict: "qualified",
    consentConversationGranted: true,
    consentHandoffGranted: true,
    consentMarketingGranted: false,
    emailDeliveryStatus: "sent",
  },
};
