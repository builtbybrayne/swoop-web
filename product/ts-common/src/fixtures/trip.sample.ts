import type { Trip } from "../domain.js";

export const SampleTrip: Trip = {
  id: "trip_torres_w_trek_001",
  slug: "torres-del-paine-w-trek",
  title: "Torres del Paine W Trek",
  summary:
    "Five days on the signature W circuit — granite towers, the French Valley hanging glacier, " +
    "and the blue-ice terminus of Grey Glacier. Refugio-based; luggage moves between stops.",
  heroImageUrl: "https://cdn.example.com/puma-fixtures/w-trek-hero.jpg",
  durationDays: 7,
  regionSlugs: ["torres-del-paine"],
  startingPriceGbp: 2890,
  highlights: [
    "Sunrise at the base of the Torres",
    "French Valley viewpoint",
    "Grey Glacier from Mirador Grey",
  ],
};
