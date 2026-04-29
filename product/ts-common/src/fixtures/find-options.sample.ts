// -----------------------------------------------------------------------------
// find_options tool I/O fixtures (Propose options).
//
// Visitor moment: ready to consider concrete trips. Filters constructed by
// Sonnet from accumulated conversation signal: region named, duration band,
// budget level, activity preference.
// -----------------------------------------------------------------------------

import type {
  FindOptionsInput,
  FindOptionsOutput,
} from "../tools.js";

import { SampleTripCardPublic } from "./trip-card.sample.js";

export const SampleFindOptionsInput: FindOptionsInput = {
  region: "torres-del-paine",
  durationMin: 5,
  durationMax: 10,
  budgetBand: "mid",
  activity: "hiking",
  accommodationStyle: "refugios",
  limit: 4,
};

export const SampleFindOptionsOutput: FindOptionsOutput = {
  cards: [SampleTripCardPublic],
  count: 1,
};
