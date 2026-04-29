// -----------------------------------------------------------------------------
// CustomerStory fixture — Mirror job (conditional on C.26).
//
// Persona-shaped retrieval per decision C.30: persona_summary is what the
// embedding is built from; text is what the agent shows the visitor.
// -----------------------------------------------------------------------------

import type {
  CustomerStory,
  CustomerStoryPublic,
} from "../derived.js";

export const SampleCustomerStory: CustomerStory = {
  id: "22222222-2222-4222-8222-222222222222",
  sourceProvenance: "blog_first_person",
  sourceId: "blog-post-2025-w-trail-solo",
  text:
    "I'd booked the W in a moment of post-divorce clarity at 2am, then spent the " +
    "next six months convincing myself it was a terrible idea. It wasn't. The " +
    "guides on the group tour read me right on day one — gave me space when I " +
    "wanted it, brought me into the conversation when I needed it. By the time " +
    "we hit the French Valley I'd stopped second-guessing the whole trip.",
  canonicalUrl: "https://swoop-patagonia.com/blog/solo-w-trail-reflections",
  region: "Torres del Paine",
  personaSummary:
    "Mid-40s woman, solo traveller on a post-divorce reset trip. Intermediate " +
    "fitness, drawn to wildlife and quiet trails. Wanted the structure of a " +
    "group tour without the sociability pressure of a tight friendship group.",
  personaEmbedding: null,
  imageId: null,
  tsv: null,
  contentHash: "sha256:customer-story-w-trail-solo-v1",
};

export const SampleCustomerStoryPublic: CustomerStoryPublic = {
  id: SampleCustomerStory.id,
  text: SampleCustomerStory.text,
  personaSummary: SampleCustomerStory.personaSummary,
  canonicalUrl: SampleCustomerStory.canonicalUrl,
  region: SampleCustomerStory.region,
};
