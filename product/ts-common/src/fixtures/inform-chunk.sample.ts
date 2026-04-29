// -----------------------------------------------------------------------------
// InformChunk fixture — Inform job. FAQ-style worked example with a question
// and an answer, since FAQ is the dominant Inform source.
// -----------------------------------------------------------------------------

import type {
  InformChunk,
  InformChunkPublic,
} from "../derived.js";

export const SampleInformChunk: InformChunk = {
  id: "44444444-4444-4444-8444-444444444444",
  sourceProvenance: "faq",
  sourceId: "612",
  question: "How crowded is Torres del Paine in December?",
  text:
    "December is the busiest month in the park. The W trail refugios book out " +
    "12 months ahead, the Paine Grande shuttle queues run long, and the most " +
    "popular viewpoints (Mirador Las Torres at sunrise especially) draw " +
    "crowds. That said, December's long daylight hours and reliable weather " +
    "make it a strong choice for first-time visitors. Sub-six-hour day hikes " +
    "from base lodges hit the highlights without the logistics overhead.",
  canonicalUrl: "https://swoop-patagonia.com/practical/when-to-visit/december",
  topicTags: ["weather", "crowds", "season"],
  embedding: null,
  tsv: null,
  contentHash: "sha256:inform-tdp-december-v1",
};

export const SampleInformChunkPublic: InformChunkPublic = {
  id: SampleInformChunk.id,
  question: SampleInformChunk.question,
  text: SampleInformChunk.text,
  canonicalUrl: SampleInformChunk.canonicalUrl,
  topicTags: SampleInformChunk.topicTags,
};
