// -----------------------------------------------------------------------------
// find_inspiring tool I/O fixtures.
//
// Visitor moment: open curiosity about Torres del Paine in autumn — exactly
// the conversational point Inspire serves.
// -----------------------------------------------------------------------------

import type {
  FindInspiringInput,
  FindInspiringOutput,
} from "../tools.js";

import { SampleInspirePassagePublic } from "./inspire-passage.sample.js";

export const SampleFindInspiringInput: FindInspiringInput = {
  query: "torres del paine in autumn",
  region: "torres-del-paine",
  mood: "wild",
  limit: 4,
};

export const SampleFindInspiringOutput: FindInspiringOutput = {
  passages: [SampleInspirePassagePublic],
  count: 1,
};
