// -----------------------------------------------------------------------------
// TripCard ETL fixture — Propose options job, full server-side row shape.
//
// The public projection moved into the discriminated `ProposalCardPublicSchema`
// (see crosscut plan `03-exec-crosscut-find-options-polymorphism.md` +
// decisions C.48 – C.51). The per-variant card fixtures live in
// `proposal-card.sample.ts`; this file keeps only the ETL row so the
// `trip_card` Postgres table's `composeTripCard` continues to validate
// against an unchanged shape.
//
// Patagonia-flavoured: a real-feeling W-trail self-guided trip — the most
// common Patagonia entry point.
// -----------------------------------------------------------------------------

import type { TripCard } from "../derived.js";

export const SampleTripCard: TripCard = {
  id: 1042,
  slug: "torres-del-paine-w-trail-self-guided",
  headline: "Torres del Paine W Trail — Self-Guided",
  vibeLine:
    "Five days walking through the heart of the Paine massif. Refugios, " +
    "trailhead transfers, and a route plan tuned to your fitness.",
  region: "Torres del Paine",
  durationDays: 7,
  fromPrice: 2150.0,
  currencyCode: "GBP",
  imageId: 88421,
  accommodationStyle: "refugios",
  activityTags: ["hiking", "wildlife"],
  canonicalUrl: "https://swoop-patagonia.com/trips/torres-del-paine-w-self-guided",
  embedding: null,
  tsv: null,
  contentHash: "sha256:trip-card-w-self-guided-v1",
};
