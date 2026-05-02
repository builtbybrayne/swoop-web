/**
 * `find_proof` handler — Reassure job.
 *
 * The journey moment: a hesitation surfaces — about credibility, partner
 * quality, environmental impact, safety, expertise. Returns 1–3 trust-proof
 * items: claim + evidence + canonical URL. Hybrid retrieval (cosine + ts_rank
 * fused via RRF k=60) over `trust_proof`; optional `topic` narrows pre-RRF.
 */

import {
  FindProofInputSchema,
  FindProofOutputSchema,
  type FindProofInput,
  type FindProofOutput,
} from '@swoop/common';

import { findTrustProofsByConcern } from '../data/find-trust-proofs.js';
import type { ToolHandlerDeps } from './deps.js';

export async function findProofBody(
  input: FindProofInput,
  deps: ToolHandlerDeps,
): Promise<FindProofOutput> {
  const embedding = await deps.embedQuery(input.concern);
  const proofs = await deps.withClient((client) =>
    findTrustProofsByConcern(client, embedding, input.concern, {
      topic: input.topic,
      limit: input.limit,
    }),
  );
  return FindProofOutputSchema.parse({
    proofs,
    count: proofs.length,
  });
}

export const findProofSpec = {
  name: 'find_proof' as const,
  inputSchema: FindProofInputSchema,
  outputSchema: FindProofOutputSchema,
};
