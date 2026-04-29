// -----------------------------------------------------------------------------
// TrustProof fixture — Reassure job. The B-Corp slice is the canonical worked
// example because Swoop's actual B-Corp page is the most-cited proof source
// in the Reassure flow.
// -----------------------------------------------------------------------------

import type {
  TrustProof,
  TrustProofPublic,
} from "../derived.js";

export const SampleTrustProof: TrustProof = {
  id: "33333333-3333-4333-8333-333333333333",
  sourceProvenance: "swoop_page",
  sourceId: "211",
  topic: "b-corp",
  claim: "Swoop is a certified B Corporation.",
  evidence:
    "Swoop has held B Corp certification since 2021, recertified 2024 with an " +
    "improved score across community, environment, and governance dimensions. " +
    "The certification means we publish our impact report annually and " +
    "submit to independent audit on the social and environmental practices we " +
    "claim — not just for marketing, but as a legal commitment under our " +
    "articles of association.",
  canonicalUrl: "https://swoop-patagonia.com/about/b-corp",
  embedding: null,
  tsv: null,
  contentHash: "sha256:trust-proof-bcorp-v1",
};

export const SampleTrustProofPublic: TrustProofPublic = {
  id: SampleTrustProof.id,
  topic: SampleTrustProof.topic,
  claim: SampleTrustProof.claim,
  evidence: SampleTrustProof.evidence,
  canonicalUrl: SampleTrustProof.canonicalUrl,
};
