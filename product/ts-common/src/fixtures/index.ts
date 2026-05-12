// -----------------------------------------------------------------------------
// Fixtures — one hand-crafted, schema-valid instance per top-level contract.
//
// Patagonia-flavoured; invented detail is fine. Downstream chunks import these
// when mocking at boundaries during parallel fan-out.
// -----------------------------------------------------------------------------

export { SampleTrip } from "./trip.sample.js";
export { SampleTour } from "./tour.sample.js";
export { SampleRegion } from "./region.sample.js";
export { SampleStory } from "./story.sample.js";
export { SampleImage } from "./image.sample.js";
export { SampleSession } from "./session.sample.js";

// Handoff fixtures — one per verdict + back-compat alias. See E.t1 + Q5.
export {
  SampleHandoff,
  SampleHandoffQualified,
  SampleHandoffReferredOut,
  SampleHandoffDisqualified,
  SampleHandoffInconclusive,
} from "./handoff.sample.js";

// Event fixtures — one per event kind + back-compat alias. See F-a + C.t4.
export {
  SampleEvent,
  SampleEventHandoffSubmitted,
  SampleEventConsentGranted,
  SampleEventConsentDeclined,
  SampleEventToolFailed,
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
} from "./event.sample.js";

// -----------------------------------------------------------------------------
// C.t2 — derived entity fixtures (one full + one public projection per entity)
// -----------------------------------------------------------------------------

export {
  SampleInspirePassage,
  SampleInspirePassagePublic,
} from "./inspire-passage.sample.js";

export {
  SampleCustomerStory,
  SampleCustomerStoryPublic,
} from "./customer-story.sample.js";

export {
  SampleTrustProof,
  SampleTrustProofPublic,
} from "./trust-proof.sample.js";

export {
  SampleInformChunk,
  SampleInformChunkPublic,
} from "./inform-chunk.sample.js";

export { SampleTripCard } from "./trip-card.sample.js";

// -----------------------------------------------------------------------------
// Crosscut C.48 — ProposalCardPublic discriminated-union fixtures
// (`find_options` v1 tranche: schema lands day-one, all four variants present;
// only `type: 'trip'` is wired live by the connector handler).
// -----------------------------------------------------------------------------

export {
  SampleTripProposalCard,
  SampleTourProposalCard,
  SampleHotelProposalCard,
  SampleRegionBaseProposalCard,
} from "./proposal-card.sample.js";

// -----------------------------------------------------------------------------
// C.t2 — eight-tool intent-named surface I/O fixtures
// -----------------------------------------------------------------------------

export {
  SampleFindInspiringInput,
  SampleFindInspiringOutput,
} from "./find-inspiring.sample.js";

export {
  SampleFindSomeoneWhoInput,
  SampleFindSomeoneWhoOutput,
} from "./find-someone-who.sample.js";

export {
  SampleFindProofInput,
  SampleFindProofOutput,
} from "./find-proof.sample.js";

export {
  SampleLookupInput,
  SampleLookupOutput,
} from "./lookup.sample.js";

export {
  SampleFindOptionsInput,
  SampleFindOptionsOutput,
  SampleFindOptionsOutputMixed,
} from "./find-options.sample.js";
