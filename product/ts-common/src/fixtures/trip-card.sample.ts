// -----------------------------------------------------------------------------
// TripCard fixture — Propose options job. Surface fields are committed; the
// internals will firm up when trips ingestion lands. Lean on a real-feeling
// W-trail self-guided trip — the most common Patagonia entry point.
// -----------------------------------------------------------------------------

import type { TripCard, TripCardPublic } from "../derived.js";

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

export const SampleTripCardPublic: TripCardPublic = {
  id: SampleTripCard.id,
  slug: SampleTripCard.slug,
  headline: SampleTripCard.headline,
  vibeLine: SampleTripCard.vibeLine,
  region: SampleTripCard.region,
  durationDays: SampleTripCard.durationDays,
  fromPrice: SampleTripCard.fromPrice,
  currencyCode: SampleTripCard.currencyCode,
  accommodationStyle: SampleTripCard.accommodationStyle,
  activityTags: SampleTripCard.activityTags,
  canonicalUrl: SampleTripCard.canonicalUrl,
  image: {
    id: 88421,
    canonicalUrl:
      "https://swoop-patagonia.imgix.net/torres-del-paine-grey-glacier.jpg" +
      "?auto=format,enhance,compress&fit=crop&w=900&h=600&q=80",
    altText:
      "Glaciar Grey ice front in early morning light, Torres del Paine National Park",
    description: null,
    subjectTags: ["glacier"],
    moodTags: ["serene"],
    regionTags: ["torres-del-paine"],
  },
};
