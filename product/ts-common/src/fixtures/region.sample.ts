import type { Region } from "../domain.js";

export const SampleRegion: Region = {
  id: "region_torres_del_paine_001",
  slug: "torres-del-paine",
  title: "Torres del Paine",
  summary:
    "Chilean Patagonia's most famous national park — granite towers, turquoise lakes, pumas " +
    "tracking guanacos across the steppe. Centrepiece of almost every Patagonia itinerary.",
  country: "Chile",
  heroImageUrl: "https://cdn.example.com/puma-fixtures/tdp-hero.jpg",
  signatureExperiences: [
    "W Trek",
    "Full-circuit O Trek",
    "Puma tracking day-trip",
    "Glacier Grey kayak",
  ],
};
