// -----------------------------------------------------------------------------
// lookup tool I/O fixtures (Inform).
//
// Visitor moment: a concrete factual question. Returns prose chunks the agent
// can quote and a canonical URL it can offer as the deep-link.
// -----------------------------------------------------------------------------

import type { LookupInput, LookupOutput } from "../tools.js";

import { SampleInformChunkPublic } from "./inform-chunk.sample.js";

export const SampleLookupInput: LookupInput = {
  question: "How crowded is Torres del Paine in December?",
  limit: 5,
};

export const SampleLookupOutput: LookupOutput = {
  chunks: [SampleInformChunkPublic],
  count: 1,
};
