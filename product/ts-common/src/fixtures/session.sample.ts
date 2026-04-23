import type { SessionState } from "../session.js";

export const SampleSession: SessionState = {
  sessionId: "sess_puma_demo_001",
  createdAt: "2026-04-22T09:00:00.000Z",
  updatedAt: "2026-04-22T09:07:23.000Z",
  conversationHistory: [
    {
      turnIndex: 0,
      role: "user",
      blockType: "user_message",
      text: "I'd love to trek in Patagonia but I've never done anything like that before.",
      timestamp: "2026-04-22T09:00:12.000Z",
    },
    {
      turnIndex: 0,
      role: "agent",
      blockType: "reasoning",
      text:
        "Visitor is curious but inexperience-flagged. Lead with Torres del Paine as the canonical " +
        "starting point; gently probe fitness and timing before narrowing to W vs O.",
      timestamp: "2026-04-22T09:00:14.000Z",
    },
    {
      turnIndex: 0,
      role: "agent",
      blockType: "utter",
      text:
        "Patagonia is a great first trekking trip — the W Trek in Torres del Paine is the classic " +
        "starting point. What draws you to it?",
      timestamp: "2026-04-22T09:00:16.000Z",
    },
  ],
  triage: {
    verdict: "none",
  },
  wishlist: {
    items: [
      {
        entityType: "region",
        slug: "torres-del-paine",
        noted: "Mentioned W Trek as the 'big first thing'.",
      },
    ],
    motivationAnchor: "First real trekking trip; bucket-list feel.",
  },
  consent: {
    conversation: {
      granted: true,
      timestamp: "2026-04-22T09:00:04.000Z",
      copyVersion: "disclosure-opening/v1",
    },
    handoff: {
      granted: false,
      timestamp: "2026-04-22T09:00:04.000Z",
    },
  },
  metadata: {
    entryUrl: "https://www.swoop-patagonia.com/trips/w-trek",
    regionInterestHint: "torres-del-paine",
    variantId: "puma-demo-A",
    warmPoolHit: true,
  },
};
