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
export { SampleHandoff } from "./handoff.sample.js";
export { SampleEvent } from "./event.sample.js";
