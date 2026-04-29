// -----------------------------------------------------------------------------
// InspirePassage fixture — Inspire job, Patagonia-flavoured.
//
// Real-feeling page-derived prose. Invented detail per G.5 — real content
// lands in C.t3a's embedding pass against actual pages/blog rows.
// -----------------------------------------------------------------------------

import type {
  InspirePassage,
  InspirePassagePublic,
} from "../derived.js";

export const SampleInspirePassage: InspirePassage = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceProvenance: "page_summary",
  sourceId: "1042",
  text:
    "There's a moment in Torres del Paine, usually somewhere between the second " +
    "and third day, when the wind drops just long enough that you can hear the " +
    "ice on Glaciar Grey moving. Visitors who've spent a fortnight planning the " +
    "trek often say that's the moment the trip became theirs.",
  canonicalUrl: "https://swoop-patagonia.com/torres-del-paine",
  ntagIds: [12, 47, 51],
  region: "Torres del Paine",
  mood: "wild",
  imageId: 88421,
  embedding: null,
  tsv: null,
  contentHash: "sha256:inspire-tdpaine-summary-v1",
};

export const SampleInspirePassagePublic: InspirePassagePublic = {
  id: SampleInspirePassage.id,
  text: SampleInspirePassage.text,
  canonicalUrl: SampleInspirePassage.canonicalUrl,
  region: SampleInspirePassage.region,
  mood: SampleInspirePassage.mood,
  image: {
    id: 88421,
    canonicalUrl:
      "https://swoop-patagonia.imgix.net/torres-del-paine-grey-glacier.jpg" +
      "?auto=format,enhance,compress&fit=crop&w=900&h=600&q=80",
    altText:
      "Glaciar Grey ice front in early morning light, Torres del Paine National Park",
    description:
      "Wide-angle view of Glaciar Grey's calving face from the lookout above " +
      "Refugio Grey, with the Paine Massif catching first light behind.",
    subjectTags: ["glacier", "wildlife"],
    moodTags: ["serene", "dramatic"],
    regionTags: ["torres-del-paine"],
  },
};
