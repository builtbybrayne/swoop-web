// -----------------------------------------------------------------------------
// find_options tool I/O fixtures (Browse options — agent-private).
//
// goofy-goldstine reshape (2026-06-11): find_options output is now a compact
// browse list (`options: BrowseOption[]`). The full ProposalCard shape moves
// to show_options (visitor-facing). These fixtures updated accordingly.
//
// Per crosscut plan `03-exec-crosscut-goofy-goldstine-find-options-reshape.md`
// §2–3, decisions C.goofy-goldstine-10..13.
// -----------------------------------------------------------------------------

import type {
  BrowseOption,
  FindOptionsInput,
  FindOptionsOutput,
} from "../tools.js";

export const SampleFindOptionsInput: FindOptionsInput = {
  region: "torres-del-paine",
  durationMin: 5,
  durationMax: 10,
  budgetBand: "mid",
  activity: "hiking",
  accommodationStyle: "refugios",
  limit: 12,
};

/** Single trip browse option. */
export const SampleTripBrowseOption: BrowseOption = {
  type: "trip",
  id: 42,
  title: "Torres del Paine W Trek",
  region: "Torres del Paine",
  durationDays: 7,
  fromPrice: 2150,
  currencyCode: "GBP",
  line: "The classic W — refugios, wind, and pampas eagles overhead.",
};

/**
 * v1-tranche-shaped browse output: one trip option.
 */
export const SampleFindOptionsOutput: FindOptionsOutput = {
  options: [SampleTripBrowseOption],
  count: 1,
};

/**
 * Mixed-variant browse output — one option per type.
 */
export const SampleFindOptionsOutputMixed: FindOptionsOutput = {
  options: [
    { type: "trip", id: 42, title: "Torres del Paine W Trek", region: "Torres del Paine", durationDays: 7 },
    { type: "tour", id: 9, title: "Best of Patagonia Tour", durationDays: 10 },
    { type: "hotel", id: 12, title: "Tierra Patagonia Hotel" },
    { type: "region_base", id: 7, title: "El Calafate" },
  ],
  count: 4,
};
