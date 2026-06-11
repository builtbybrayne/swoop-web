// -----------------------------------------------------------------------------
// ProposalCardPublic fixtures — one per variant of the discriminated union.
//
// Surface: `find_options` returns `cards: ProposalCardPublic[]` with each card
// tagged `type: 'trip' | 'tour' | 'hotel' | 'region_base'`. v1 tranche wires
// only the trip variant live; the fixtures here let D.t9's widget executor
// build all four card-variant renderers from day one against schema-valid
// data.
//
// Per crosscut plan `03-exec-crosscut-find-options-polymorphism.md` §2.5 +
// decisions C.48 – C.51.
// -----------------------------------------------------------------------------

import type {
  HotelProposalCard,
  RegionBaseProposalCard,
  ShowOptionsOutput,
  TourProposalCard,
  TripProposalCard,
} from "../tools.js";

/** Trip variant — the common Patagonia entry point. */
export const SampleTripProposalCard: TripProposalCard = {
  type: "trip",
  id: "1042",
  slug: "torres-del-paine-w-trail-self-guided",
  headline: "Torres del Paine W Trail — Self-Guided",
  vibeLine:
    "Five days walking through the heart of the Paine massif. Refugios, " +
    "trailhead transfers, and a route plan tuned to your fitness.",
  region: "Torres del Paine",
  durationDays: 7,
  fromPrice: 2150.0,
  currencyCode: "GBP",
  accommodationStyle: "refugios",
  activityTags: ["hiking", "wildlife"],
  canonicalUrl: "https://swoop-patagonia.com/trips/torres-del-paine-w-self-guided",
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

/**
 * Tour variant — Luke upsell priority. Group-size + day-by-day affordances
 * are the discriminators vs trip; sourced from the `tour` + `tour_item`
 * tables when v2 lands.
 */
export const SampleTourProposalCard: TourProposalCard = {
  type: "tour",
  id: "tour-217",
  slug: "patagonia-classic-group-tour",
  headline: "Patagonia Classic — Small-Group Guided",
  vibeLine:
    "Twelve days, one guide, a group of eight. Torres del Paine to El " +
    "Chaltén with a fixed itinerary tuned across many seasons.",
  region: "Southern Patagonia",
  durationDays: 12,
  groupSizeMax: 8,
  dayCount: 12,
  fromPrice: 4850.0,
  currencyCode: "GBP",
  accommodationStyle: "mid-range hotels",
  activityTags: ["hiking", "wildlife", "guided"],
  canonicalUrl: "https://swoop-patagonia.com/tours/patagonia-classic",
  image: {
    id: 88422,
    canonicalUrl:
      "https://swoop-patagonia.imgix.net/fitz-roy-sunrise.jpg" +
      "?auto=format,enhance,compress&fit=crop&w=900&h=600&q=80",
    altText: "Fitz Roy massif at sunrise, lit pink over El Chaltén",
    description: null,
    subjectTags: ["mountain", "sunrise"],
    moodTags: ["dramatic"],
    regionTags: ["el-chalten"],
  },
};

/**
 * Hotel variant — location-anchored, per-night pricing. `pricingUnit` literal
 * carries the per-night discriminator so the UI can branch the price line.
 */
export const SampleHotelProposalCard: HotelProposalCard = {
  type: "hotel",
  id: "hotel-44",
  slug: "explora-patagonia",
  headline: "Explora Patagonia — Salto Chico",
  vibeLine:
    "All-inclusive lodge inside the national park boundary. Guided excursions " +
    "daily; the kind of base where nothing else needs arranging.",
  region: "Torres del Paine",
  location: "Salto Chico, Torres del Paine National Park",
  starRating: 5,
  fromPrice: 920.0,
  currencyCode: "GBP",
  accommodationStyle: "luxury lodge",
  pricingUnit: "per_night",
  canonicalUrl: "https://swoop-patagonia.com/hotels/explora-patagonia",
  image: {
    id: 88423,
    canonicalUrl:
      "https://swoop-patagonia.imgix.net/explora-patagonia-lodge.jpg" +
      "?auto=format,enhance,compress&fit=crop&w=900&h=600&q=80",
    altText:
      "Explora Patagonia lodge perched above Lago Pehoé, Torres del Paine",
    description: null,
    subjectTags: ["lodge", "lake"],
    moodTags: ["intimate"],
    regionTags: ["torres-del-paine"],
  },
};

/**
 * Region-base variant — a region framed as a launchpad. `nearbyTripsCount`
 * is derivable from `trip` + `area`; `baseFraming` is the prose framing
 * either composed at ETL time or surfaced from a curated `page`.
 */
export const SampleRegionBaseProposalCard: RegionBaseProposalCard = {
  type: "region_base",
  id: "region-el-calafate",
  slug: "el-calafate",
  headline: "El Calafate — Gateway to the Glaciers",
  vibeLine:
    "Two hours from Perito Moreno, four from Torres del Paine, a short flight " +
    "from El Chaltén. Stay here, branch out, come back to a hot shower.",
  region: "Argentine Patagonia",
  nearbyTripsCount: 11,
  baseFraming:
    "Use El Calafate as a base for short trips to Perito Moreno, day hikes " +
    "near Lago Argentino, and onward overland to Torres del Paine.",
  canonicalUrl: "https://swoop-patagonia.com/regions/el-calafate",
  image: {
    id: 88424,
    canonicalUrl:
      "https://swoop-patagonia.imgix.net/el-calafate-perito-moreno.jpg" +
      "?auto=format,enhance,compress&fit=crop&w=900&h=600&q=80",
    altText:
      "Perito Moreno glacier face from the El Calafate boardwalk viewpoint",
    description: null,
    subjectTags: ["glacier", "ice"],
    moodTags: ["expansive"],
    regionTags: ["el-calafate"],
  },
};

/**
 * `show_options` output — the visitor-facing curation surface from the
 * goofy-goldstine find/show split. Three primary cards + one
 * also_interesting near-fit, exercising every variant and both groups.
 */
export const SampleShowOptionsOutput: ShowOptionsOutput = {
  cards: [
    { ...SampleTripProposalCard, group: "primary" },
    { ...SampleTourProposalCard, group: "primary" },
    { ...SampleHotelProposalCard, group: "primary" },
    { ...SampleRegionBaseProposalCard, group: "also_interesting" },
  ],
};
