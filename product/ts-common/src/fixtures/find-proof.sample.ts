// -----------------------------------------------------------------------------
// find_proof tool I/O fixtures (Reassure).
//
// Visitor moment: hesitation surfaces about the operator's environmental
// stance. Reassure surfaces concrete evidence — B-Corp, conservation fund,
// satisfaction signals — matched to the concern.
// -----------------------------------------------------------------------------

import type { FindProofInput, FindProofOutput } from "../tools.js";

import { SampleTrustProofPublic } from "./trust-proof.sample.js";

export const SampleFindProofInput: FindProofInput = {
  concern: "I want to know whether the company actually walks the talk on impact",
  topic: "b-corp",
  limit: 3,
};

export const SampleFindProofOutput: FindProofOutput = {
  proofs: [SampleTrustProofPublic],
  count: 1,
};
