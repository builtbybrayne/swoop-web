// -----------------------------------------------------------------------------
// find_options tool I/O fixtures (Propose options).
//
// Visitor moment: ready to consider concrete options. Filters constructed by
// Sonnet from accumulated conversation signal: region named, duration band,
// budget level, activity preference. The output is `cards:
// ProposalCardPublic[]` — a discriminated union over four variants.
//
// `SampleFindOptionsOutput` carries an all-trip card set (v1 tranche reality:
// only `type: 'trip'` is wired live). `SampleFindOptionsOutputMixed` carries
// one of each variant; D.t9's widget executor + the schema round-trip tests
// consume it. Per crosscut plan `03-exec-crosscut-find-options-polymorphism.md`
// §2.5 + decisions C.48 – C.51.
// -----------------------------------------------------------------------------

import type {
  FindOptionsInput,
  FindOptionsOutput,
} from "../tools.js";

import {
  SampleHotelProposalCard,
  SampleRegionBaseProposalCard,
  SampleTourProposalCard,
  SampleTripProposalCard,
} from "./proposal-card.sample.js";

export const SampleFindOptionsInput: FindOptionsInput = {
  region: "torres-del-paine",
  durationMin: 5,
  durationMax: 10,
  budgetBand: "mid",
  activity: "hiking",
  accommodationStyle: "refugios",
  limit: 4,
};

/**
 * v1-tranche-shaped output: trip cards only. Mirrors what the live connector
 * handler returns until v2 (tours) and v3 (hotels + region_bases) land.
 */
export const SampleFindOptionsOutput: FindOptionsOutput = {
  cards: [SampleTripProposalCard],
  count: 1,
};

/**
 * Mixed-variant output — one card per type. D.t9's widget executor renders
 * against this to verify the polymorphic dispatch; future-tranche backend
 * smokes shape against this too.
 */
export const SampleFindOptionsOutputMixed: FindOptionsOutput = {
  cards: [
    SampleTripProposalCard,
    SampleTourProposalCard,
    SampleHotelProposalCard,
    SampleRegionBaseProposalCard,
  ],
  count: 4,
};
