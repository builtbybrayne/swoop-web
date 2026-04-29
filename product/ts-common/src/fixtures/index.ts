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

// Handoff fixtures — one per verdict + back-compat alias. See E.t1.
export {
  SampleHandoff,
  SampleHandoffQualified,
  SampleHandoffReferredOut,
  SampleHandoffDisqualified,
} from "./handoff.sample.js";

// Event fixtures — one per event kind + back-compat alias. See F-a.
export {
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

export {
  SampleTripCard,
  SampleTripCardPublic,
} from "./trip-card.sample.js";

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
} from "./find-options.sample.js";
