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
  EventSchema,
  HandoffPayloadSchema,
  type HandoffPayload,
  type Event,
  ImageSchema,
  RegionSchema,
  SessionStateSchema,
  StorySchema,
  TourSchema,
  TripSchema,
} from "../index.js";

import {
  SampleEvent,
  SampleEventHandoffSubmitted,
  SampleEventConsentGranted,
  SampleEventConsentDeclined,
  SampleEventToolFailed,
  SampleEventHandoffTriggered,
  SampleEventSkillLoaded,
  SampleEventUiWidgetRendered,
  SampleEventUiConversationOpened,
  SampleEventUiConversationClosed,
  SampleEventSessionExpired,
  SampleEventWarmPoolHit,
  SampleEventWarmPoolMiss,
  SampleHandoff,
  SampleHandoffQualified,
  SampleHandoffReferredOut,
  SampleHandoffDisqualified,
  SampleImage,
  SampleRegion,
  SampleSession,
  SampleStory,
  SampleTour,
  SampleTrip,
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
  // Events — one round-trip case per kind.
  // ---------------------------------------------------------------------------

  const EVENT_FIXTURES: Array<[string, Event]> = [
    ["handoff.submitted", SampleEventHandoffSubmitted],
    ["consent.granted", SampleEventConsentGranted],
    ["consent.declined", SampleEventConsentDeclined],
    ["tool.failed", SampleEventToolFailed],
    ["handoff.triggered", SampleEventHandoffTriggered],
    ["skill.loaded", SampleEventSkillLoaded],
    ["ui.widget_rendered", SampleEventUiWidgetRendered],
    ["ui.conversation_opened", SampleEventUiConversationOpened],
    ["ui.conversation_closed", SampleEventUiConversationClosed],
    ["session.expired", SampleEventSessionExpired],
    ["warm_pool.hit", SampleEventWarmPoolHit],
    ["warm_pool.miss", SampleEventWarmPoolMiss],
  ];

  it.each(EVENT_FIXTURES)("%s parses against EventSchema", (_label, fixture) => {
    expect(EventSchema.parse(fixture)).toEqual(fixture);
  });

  it("SampleEvent (back-compat alias) still parses against EventSchema", () => {
    expect(EventSchema.parse(SampleEvent)).toEqual(SampleEvent);
  });
});
