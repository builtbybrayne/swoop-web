// -----------------------------------------------------------------------------
// @swoop/common — re-exports for every cross-chunk contract.
//
// Downstream packages import from the package name:
//   import { SessionStateSchema, TripSchema } from "@swoop/common";
//
// Fixtures live under a subpath export:
//   import { SampleTrip } from "@swoop/common/fixtures";
// -----------------------------------------------------------------------------

export * from "./domain.js";
export * from "./tools.js";
export * from "./streaming.js";
export * from "./session.js";
export * from "./handoff.js";
export * from "./events.js";
export * from "./emit-event.js";
