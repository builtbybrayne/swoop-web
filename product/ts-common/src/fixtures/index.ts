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
