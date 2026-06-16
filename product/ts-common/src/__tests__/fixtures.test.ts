// -----------------------------------------------------------------------------
// Fixture round-trip smoke test.
//
// The single test that ships with @swoop/common: parse every sample fixture
// against its Zod schema. Catches schema/fixture drift as a compile-time + run-
// time check. Any schema edit that breaks a fixture fails this test.
//
// Handoff + event coverage is table-driven (E.t1 + F-a): one row per variant /
// kind. Reject-path assertions protect the per-verdict enum narrowing +
// `.strict()` guarantees on the handoff payload.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  CustomerStorySchema,
  CustomerStoryPublicSchema,
  EventSchema,
  FindInspiringInputSchema,
  FindInspiringOutputSchema,
  FindOptionsInputSchema,
  FindOptionsOutputSchema,
  FindProofInputSchema,
  FindProofOutputSchema,
  FindSomeoneWhoInputSchema,
  FindSomeoneWhoOutputSchema,
  HandoffInputSchema,
  HandoffPayloadSchema,
  HandoffSubmitRequestSchema,
  HotelProposalCardSchema,
  type HandoffPayload,
  type Event,
  ImageSchema,
  InformChunkSchema,
  InformChunkPublicSchema,
  InspirePassageSchema,
  InspirePassagePublicSchema,
  LookupInputSchema,
  LookupOutputSchema,
  ProposalCardPublicSchema,
  RegionBaseProposalCardSchema,
  RegionSchema,
  SessionStateSchema,
  TriageStateSchema,
  type TriageState,
  StorySchema,
  TourProposalCardSchema,
  TourSchema,
  TripProposalCardSchema,
  TripSchema,
  TripCardSchema,
  TrustProofSchema,
  TrustProofPublicSchema,
} from "../index.js";

import {
  SampleCustomerStory,
  SampleCustomerStoryPublic,
  SampleEvent,
  SampleEventHandoffSubmitted,
  SampleEventConsentGranted,
  SampleEventConsentDeclined,
  SampleEventToolInvoked,
  SampleEventHandoffTriggered,
  SampleEventSkillLoaded,
  SampleEventUiWidgetRendered,
  SampleEventUiConversationOpened,
  SampleEventUiConversationClosed,
  SampleEventSessionExpired,
  SampleEventSessionExpiredRehydrate,
  SampleEventWarmPoolHit,
  SampleEventWarmPoolMiss,
  SampleEventSessionRehydrated,
  SampleEventSessionReplayEmpty,
  SampleEventSessionReplayFailed,
  SampleEventUiSessionRehydrateRequested,
  SampleEventUiSessionRehydrateApplied,
  SampleEventUiSessionRehydrateExpired,
  SampleEventUiSessionRehydrateFailed,
  SampleFindInspiringInput,
  SampleFindInspiringOutput,
  SampleFindOptionsInput,
  SampleFindOptionsOutput,
  SampleFindOptionsOutputMixed,
  SampleFindProofInput,
  SampleFindProofOutput,
  SampleFindSomeoneWhoInput,
  SampleFindSomeoneWhoOutput,
  SampleHandoff,
  SampleHandoffQualified,
  SampleHandoffReferredOut,
  SampleHandoffDisqualified,
  SampleHotelProposalCard,
  SampleImage,
  SampleInformChunk,
  SampleInformChunkPublic,
  SampleInspirePassage,
  SampleInspirePassagePublic,
  SampleLookupInput,
  SampleLookupOutput,
  SampleRegion,
  SampleRegionBaseProposalCard,
  SampleSession,
  SampleStory,
  SampleTour,
  SampleTourProposalCard,
  SampleTrip,
  SampleTripCard,
  SampleTripProposalCard,
  SampleTrustProof,
  SampleTrustProofPublic,
} from "../fixtures/index.js";

describe("fixtures round-trip through their Zod schemas", () => {
  it("SampleTrip parses against TripSchema", () => {
    expect(TripSchema.parse(SampleTrip)).toEqual(SampleTrip);
  });

  it("SampleTour parses against TourSchema", () => {
    expect(TourSchema.parse(SampleTour)).toEqual(SampleTour);
  });

  it("SampleRegion parses against RegionSchema", () => {
    expect(RegionSchema.parse(SampleRegion)).toEqual(SampleRegion);
  });

  it("SampleStory parses against StorySchema", () => {
    expect(StorySchema.parse(SampleStory)).toEqual(SampleStory);
  });

  it("SampleImage parses against ImageSchema", () => {
    expect(ImageSchema.parse(SampleImage)).toEqual(SampleImage);
  });

  it("SampleSession parses against SessionStateSchema", () => {
    expect(SessionStateSchema.parse(SampleSession)).toEqual(SampleSession);
  });

  // ---------------------------------------------------------------------------
  // Triage state — one round-trip case per verdict (R1 fix, 2026-04-30).
  // `inconclusive` was added per HITL Q5 propagation; this guards against
  // future re-introduction of the discriminator gap.
  // ---------------------------------------------------------------------------

  const TRIAGE_FIXTURES: Array<[string, TriageState]> = [
    ["none", { verdict: "none" }],
    [
      "qualified",
      {
        verdict: "qualified",
        reasonCode: "triage_classifier_placeholder",
        reasonText: "advisory:leaning_qualified — placeholder",
        decidedAt: "2026-04-30T09:00:00.000Z",
      },
    ],
    [
      "referred_out",
      {
        verdict: "referred_out",
        reasonCode: "triage_classifier_placeholder",
        reasonText: "advisory:leaning_backpacker — placeholder",
        decidedAt: "2026-04-30T09:00:00.000Z",
      },
    ],
    [
      "disqualified",
      {
        verdict: "disqualified",
        reasonCode: "triage_classifier_placeholder",
        reasonText: "advisory:leaning_low_value — placeholder",
        decidedAt: "2026-04-30T09:00:00.000Z",
      },
    ],
    [
      "inconclusive",
      {
        verdict: "inconclusive",
        reasonCode: "triage_classifier_placeholder",
        reasonText: "advisory:inconclusive — placeholder",
        decidedAt: "2026-04-30T09:00:00.000Z",
      },
    ],
  ];

  it.each(TRIAGE_FIXTURES)("TriageState verdict=%s parses against TriageStateSchema", (_label, fixture) => {
    expect(TriageStateSchema.parse(fixture)).toEqual(fixture);
  });

  // ---------------------------------------------------------------------------
  // Handoff — one round-trip case per verdict + two reject-path assertions.
  // ---------------------------------------------------------------------------

  const HANDOFF_FIXTURES: Array<[string, HandoffPayload]> = [
    ["SampleHandoffQualified", SampleHandoffQualified],
    ["SampleHandoffReferredOut", SampleHandoffReferredOut],
    ["SampleHandoffDisqualified", SampleHandoffDisqualified],
  ];

  it.each(HANDOFF_FIXTURES)("%s parses against HandoffPayloadSchema", (_label, fixture) => {
    expect(HandoffPayloadSchema.parse(fixture)).toEqual(fixture);
  });

  it("SampleHandoff (back-compat alias) still parses against HandoffPayloadSchema", () => {
    expect(HandoffPayloadSchema.parse(SampleHandoff)).toEqual(SampleHandoff);
  });

  it("rejects a qualified payload with a referred_out reason code", () => {
    const bad = {
      ...SampleHandoffQualified,
      reason: { code: "below_profit_floor", text: "x" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a disqualified payload that carries a contact field", () => {
    const bad = {
      ...SampleHandoffDisqualified,
      contact: { name: "x", email: "x@y.z" },
    };
    expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // E.t1 wire-tightening (VERDICT-E.t1, 2026-05-13) —
  // HandoffInputSchema + HandoffSubmitRequestSchema are now discriminated
  // unions over `verdict` with per-verdict reason-code enums. These tests
  // pin (a) the round-trip for each variant and (b) the reject paths the
  // schema-as-contract is designed to catch.
  // ---------------------------------------------------------------------------

  it("HandoffInputSchema accepts a qualified input with a qualified reasonCode", () => {
    const ok = {
      verdict: "qualified" as const,
      reasonCode: "ready_booking_named_trip" as const,
      specialistSummary: "summary",
      motivationAnchor: "anchor",
    };
    expect(HandoffInputSchema.parse(ok)).toEqual(ok);
  });

  it("HandoffInputSchema rejects a qualified input with an inconclusive reasonCode", () => {
    const bad = {
      verdict: "qualified" as const,
      reasonCode: "low_engagement",
      specialistSummary: "summary",
      motivationAnchor: "anchor",
    };
    expect(HandoffInputSchema.safeParse(bad).success).toBe(false);
  });

  it("HandoffInputSchema rejects an unknown reasonCode regardless of verdict", () => {
    const bad = {
      verdict: "disqualified" as const,
      reasonCode: "unknown_code_123",
      specialistSummary: "summary",
      motivationAnchor: "anchor",
    };
    expect(HandoffInputSchema.safeParse(bad).success).toBe(false);
  });

  it("HandoffInputSchema accepts an inconclusive input with all 7 inconclusive reason codes", () => {
    const codes = [
      "low_engagement",
      "mixed_signals",
      "extended_no_convergence",
      "comparison_shopping",
      "off_offer_in_region",
      "drive_by",
      "inconclusive_other",
    ] as const;
    for (const code of codes) {
      const ok = {
        verdict: "inconclusive" as const,
        reasonCode: code,
        specialistSummary: "summary",
        motivationAnchor: "anchor",
      };
      expect(HandoffInputSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("HandoffSubmitRequestSchema accepts qualified WITH contact", () => {
    const ok = {
      sessionId: "sess-1",
      verdict: "qualified" as const,
      reasonCode: "ready_booking_named_trip" as const,
      reasonText: "named the W trek, asked about availability in March",
      contact: { name: "Alex", email: "alex@example.com" },
      consent: {
        handoffGranted: true,
        handoffTimestamp: "2026-05-13T12:00:00.000Z",
      },
    };
    expect(HandoffSubmitRequestSchema.parse(ok)).toEqual(ok);
  });

  it("HandoffSubmitRequestSchema rejects qualified WITHOUT contact", () => {
    const bad = {
      sessionId: "sess-1",
      verdict: "qualified",
      reasonCode: "ready_booking_named_trip",
      reasonText: "x",
      consent: { handoffGranted: true, handoffTimestamp: "2026-05-13T12:00:00.000Z" },
    };
    expect(HandoffSubmitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it("HandoffSubmitRequestSchema accepts disqualified WITHOUT contact", () => {
    const ok = {
      sessionId: "sess-2",
      verdict: "disqualified" as const,
      reasonCode: "backpacker_no_budget" as const,
      reasonText: "self-identified backpacker, no budget",
      consent: { handoffGranted: true, handoffTimestamp: "2026-05-13T12:00:00.000Z" },
    };
    expect(HandoffSubmitRequestSchema.parse(ok)).toEqual(ok);
  });

  it("HandoffSubmitRequestSchema rejects disqualified WITH a contact (.strict bites)", () => {
    const bad = {
      sessionId: "sess-2",
      verdict: "disqualified",
      reasonCode: "backpacker_no_budget",
      reasonText: "x",
      contact: { name: "Alex", email: "alex@example.com" },
      consent: { handoffGranted: true, handoffTimestamp: "2026-05-13T12:00:00.000Z" },
    };
    expect(HandoffSubmitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it("HandoffSubmitRequestSchema rejects inconclusive WITH a contact (.strict bites)", () => {
    const bad = {
      sessionId: "sess-3",
      verdict: "inconclusive",
      reasonCode: "low_engagement",
      reasonText: "x",
      contact: { name: "Alex", email: "alex@example.com" },
      consent: { handoffGranted: true, handoffTimestamp: "2026-05-13T12:00:00.000Z" },
    };
    expect(HandoffSubmitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it("HandoffSubmitRequestSchema rejects mismatched (verdict, reasonCode)", () => {
    const bad = {
      sessionId: "sess-4",
      verdict: "disqualified",
      reasonCode: "ready_booking_named_trip", // qualified code on disqualified verdict
      reasonText: "x",
      consent: { handoffGranted: true, handoffTimestamp: "2026-05-13T12:00:00.000Z" },
    };
    expect(HandoffSubmitRequestSchema.safeParse(bad).success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Events — one round-trip case per kind.
  // ---------------------------------------------------------------------------

  const EVENT_FIXTURES: Array<[string, Event]> = [
    ["handoff.submitted", SampleEventHandoffSubmitted],
    ["consent.granted", SampleEventConsentGranted],
    ["consent.declined", SampleEventConsentDeclined],
    ["tool.invoked", SampleEventToolInvoked],
    ["handoff.triggered", SampleEventHandoffTriggered],
    ["skill.loaded", SampleEventSkillLoaded],
    ["ui.widget_rendered", SampleEventUiWidgetRendered],
    ["ui.conversation_opened", SampleEventUiConversationOpened],
    ["ui.conversation_closed", SampleEventUiConversationClosed],
    ["session.expired", SampleEventSessionExpired],
    ["session.expired{gate}", SampleEventSessionExpiredRehydrate],
    ["warm_pool.hit", SampleEventWarmPoolHit],
    ["warm_pool.miss", SampleEventWarmPoolMiss],
    ["session.rehydrated", SampleEventSessionRehydrated],
    ["session.replay.empty", SampleEventSessionReplayEmpty],
    ["session.replay.failed", SampleEventSessionReplayFailed],
    [
      "ui.session.rehydrate.requested",
      SampleEventUiSessionRehydrateRequested,
    ],
    ["ui.session.rehydrate.applied", SampleEventUiSessionRehydrateApplied],
    ["ui.session.rehydrate.expired", SampleEventUiSessionRehydrateExpired],
    ["ui.session.rehydrate.failed", SampleEventUiSessionRehydrateFailed],
  ];

  it.each(EVENT_FIXTURES)("%s parses against EventSchema", (_label, fixture) => {
    expect(EventSchema.parse(fixture)).toEqual(fixture);
  });

  it("SampleEvent (back-compat alias) still parses against EventSchema", () => {
    expect(EventSchema.parse(SampleEvent)).toEqual(SampleEvent);
  });

  // ---------------------------------------------------------------------------
  // C.t2 — derived entity fixtures (full + public projections).
  // ---------------------------------------------------------------------------

  it("SampleInspirePassage parses against InspirePassageSchema", () => {
    expect(InspirePassageSchema.parse(SampleInspirePassage)).toEqual(
      SampleInspirePassage,
    );
  });

  it("SampleInspirePassagePublic parses against InspirePassagePublicSchema", () => {
    expect(InspirePassagePublicSchema.parse(SampleInspirePassagePublic)).toEqual(
      SampleInspirePassagePublic,
    );
  });

  it("SampleCustomerStory parses against CustomerStorySchema", () => {
    expect(CustomerStorySchema.parse(SampleCustomerStory)).toEqual(
      SampleCustomerStory,
    );
  });

  it("SampleCustomerStoryPublic parses against CustomerStoryPublicSchema", () => {
    expect(CustomerStoryPublicSchema.parse(SampleCustomerStoryPublic)).toEqual(
      SampleCustomerStoryPublic,
    );
  });

  it("SampleTrustProof parses against TrustProofSchema", () => {
    expect(TrustProofSchema.parse(SampleTrustProof)).toEqual(SampleTrustProof);
  });

  it("SampleTrustProofPublic parses against TrustProofPublicSchema", () => {
    expect(TrustProofPublicSchema.parse(SampleTrustProofPublic)).toEqual(
      SampleTrustProofPublic,
    );
  });

  it("SampleInformChunk parses against InformChunkSchema", () => {
    expect(InformChunkSchema.parse(SampleInformChunk)).toEqual(SampleInformChunk);
  });

  it("SampleInformChunkPublic parses against InformChunkPublicSchema", () => {
    expect(InformChunkPublicSchema.parse(SampleInformChunkPublic)).toEqual(
      SampleInformChunkPublic,
    );
  });

  it("SampleTripCard parses against TripCardSchema", () => {
    expect(TripCardSchema.parse(SampleTripCard)).toEqual(SampleTripCard);
  });

  // ---------------------------------------------------------------------------
  // Crosscut C.48 — ProposalCardPublic discriminated-union round-tripping.
  // Each variant parses against its sub-schema AND against the parent union
  // (which is how the connector + UI consume it). Per crosscut plan
  // `03-exec-crosscut-find-options-polymorphism.md` §2.1 + §5.
  // ---------------------------------------------------------------------------

  it("SampleTripProposalCard parses against TripProposalCardSchema", () => {
    expect(TripProposalCardSchema.parse(SampleTripProposalCard)).toEqual(
      SampleTripProposalCard,
    );
  });

  it("SampleTourProposalCard parses against TourProposalCardSchema", () => {
    expect(TourProposalCardSchema.parse(SampleTourProposalCard)).toEqual(
      SampleTourProposalCard,
    );
  });

  it("SampleHotelProposalCard parses against HotelProposalCardSchema", () => {
    expect(HotelProposalCardSchema.parse(SampleHotelProposalCard)).toEqual(
      SampleHotelProposalCard,
    );
  });

  it("SampleRegionBaseProposalCard parses against RegionBaseProposalCardSchema", () => {
    expect(
      RegionBaseProposalCardSchema.parse(SampleRegionBaseProposalCard),
    ).toEqual(SampleRegionBaseProposalCard);
  });

  it.each([
    ["trip", SampleTripProposalCard],
    ["tour", SampleTourProposalCard],
    ["hotel", SampleHotelProposalCard],
    ["region_base", SampleRegionBaseProposalCard],
  ])(
    "ProposalCardPublicSchema discriminates on type=%s",
    (_label, fixture) => {
      expect(ProposalCardPublicSchema.parse(fixture)).toEqual(fixture);
    },
  );

  it("ProposalCardPublicSchema rejects a card with an unknown type", () => {
    const bad = { ...SampleTripProposalCard, type: "package" as const };
    expect(ProposalCardPublicSchema.safeParse(bad).success).toBe(false);
  });

  it("ProposalCardPublicSchema rejects a card missing the type discriminator", () => {
    const { type: _omit, ...rest } = SampleTripProposalCard;
    expect(ProposalCardPublicSchema.safeParse(rest).success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // C.t2 — eight-tool intent-named surface I/O fixtures.
  // ---------------------------------------------------------------------------

  it("find_inspiring I/O round-trips clean", () => {
    expect(FindInspiringInputSchema.parse(SampleFindInspiringInput)).toEqual(
      SampleFindInspiringInput,
    );
    expect(FindInspiringOutputSchema.parse(SampleFindInspiringOutput)).toEqual(
      SampleFindInspiringOutput,
    );
  });

  it("find_someone_who I/O round-trips clean", () => {
    expect(FindSomeoneWhoInputSchema.parse(SampleFindSomeoneWhoInput)).toEqual(
      SampleFindSomeoneWhoInput,
    );
    expect(FindSomeoneWhoOutputSchema.parse(SampleFindSomeoneWhoOutput)).toEqual(
      SampleFindSomeoneWhoOutput,
    );
  });

  it("find_proof I/O round-trips clean", () => {
    expect(FindProofInputSchema.parse(SampleFindProofInput)).toEqual(
      SampleFindProofInput,
    );
    expect(FindProofOutputSchema.parse(SampleFindProofOutput)).toEqual(
      SampleFindProofOutput,
    );
  });

  it("lookup I/O round-trips clean", () => {
    expect(LookupInputSchema.parse(SampleLookupInput)).toEqual(SampleLookupInput);
    expect(LookupOutputSchema.parse(SampleLookupOutput)).toEqual(SampleLookupOutput);
  });

  it("find_options I/O round-trips clean (browse — compact options list)", () => {
    expect(FindOptionsInputSchema.parse(SampleFindOptionsInput)).toEqual(
      SampleFindOptionsInput,
    );
    expect(FindOptionsOutputSchema.parse(SampleFindOptionsOutput)).toEqual(
      SampleFindOptionsOutput,
    );
    for (const option of SampleFindOptionsOutput.options) {
      expect(option.type).toBe("trip");
    }
  });

  it("find_options mixed-variant output round-trips clean", () => {
    expect(FindOptionsOutputSchema.parse(SampleFindOptionsOutputMixed)).toEqual(
      SampleFindOptionsOutputMixed,
    );
    const types = SampleFindOptionsOutputMixed.options.map((c) => c.type).sort();
    expect(types).toEqual(["hotel", "region_base", "tour", "trip"]);
  });

  it("FindOptionsInputSchema accepts an optional preferredType discriminator", () => {
    const withPreferred = {
      ...SampleFindOptionsInput,
      preferredType: "tour" as const,
    };
    expect(FindOptionsInputSchema.parse(withPreferred)).toEqual(withPreferred);
  });
});
