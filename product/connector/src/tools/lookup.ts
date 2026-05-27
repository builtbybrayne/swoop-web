/**
 * `lookup` handler — Inform job.
 *
 * The journey moment: visitor asks a concrete question expecting a concrete
 * answer. "How long is the W trek?" "Is December crowded?" "Do I need a visa?"
 * Returns relevant prose chunks with canonical URLs. Hybrid retrieval (cosine
 * + ts_rank fused via RRF k=60) over `inform_chunk`. No structured filter —
 * the question is whatever they asked.
 */

import {
  LookupInputSchema,
  LookupOutputSchema,
  type LookupInput,
  type LookupOutput,
} from '@swoop/common';

import { findInformChunksByQuestion } from '../data/find-inform-chunks.js';
import type { ToolHandlerDeps } from './deps.js';

export async function lookupBody(
  input: LookupInput,
  deps: ToolHandlerDeps,
): Promise<LookupOutput> {
  const embedding = await deps.embedQuery(input.question);
  const chunks = await deps.withClient((client) =>
    findInformChunksByQuestion(client, embedding, input.question, {
      limit: input.limit,
      // Anti-repetition (planning/03-exec-crosscut-anti-repetition.md,
      // HITL-ratified 2026-05-27). Orchestrator-supplied; connector stateless.
      excludeIds: input.excludeIds,
    }),
  );
  return LookupOutputSchema.parse({
    chunks,
    count: chunks.length,
  });
}

export const lookupSpec = {
  name: 'lookup' as const,
  inputSchema: LookupInputSchema,
  outputSchema: LookupOutputSchema,
};
