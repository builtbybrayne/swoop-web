import type { Tour } from "../domain.js";

export const SampleTour: Tour = {
  id: "tour_solo_adventurer_patagonia_001",
  slug: "solo-adventurer-patagonia-group-tour",
  title: "Solo Adventurer: Patagonia Group Tour",
  summary:
    "A 12-day small-group tour for solo travellers stitching Torres del Paine, El Chaltén, and " +
    "the Perito Moreno glacier. Mixed-age cohort, capped at ten.",
  heroImageUrl: "https://cdn.example.com/puma-fixtures/group-tour-hero.jpg",
  durationDays: 12,
  regionSlugs: ["torres-del-paine", "el-chalten", "los-glaciares"],
  startingPriceGbp: 4250,
  groupSizeMax: 10,
  departureMonths: ["November", "December", "January", "February", "March"],
};
