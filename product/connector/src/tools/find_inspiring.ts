/**
 * `find_inspiring` handler — Inspire job.
 *
 * The journey moment: visitor's energy is open and curious. They've named a
 * region, a feeling, a season — not a question to be answered, an opening
 * to be met with sensory prose. Returns 2–4 vivid passages with optional
 * region/mood narrowing, paired with imagery where the passage carries one.
 *
 * Thin orchestration: validate input → embed → hybrid SQL → image hydrate
 * (inside primitive) → project. No LLM, no synthesis (C.24).
 */

import {
  FindInspiringInputSchema,
  FindInspiringOutputSchema,
  type FindInspiringInput,
  type FindInspiringOutput,
} from '@swoop/common';

import { findInspirePassages } from '../data/find-inspire-passages.js';
import type { ToolHandlerDeps } from './deps.js';

export async function findInspiringBody(
  input: FindInspiringInput,
  deps: ToolHandlerDeps,
): Promise<FindInspiringOutput> {
  const embedding = await deps.embedQuery(input.query);
  const passages = await deps.withClient((client) =>
    findInspirePassages(client, embedding, input.query, {
      // region and mood are NOT forwarded to the primitive — inspire_passage.region
      // and .mood are 0/665 populated so passing them as hard SQL filters zeroes
      // both hybrid CTE legs. Fields remain in FindInspiringInputSchema (removing
      // them would cause input_validation rejections on existing agent calls).
      // They are accepted here and silently ignored; they will be wired back in
      // once the ETL compose pass populates the columns.
      // (2026-06-11 filter-sparsity hot patch)
      limit: input.limit,
      // Anti-repetition (planning/03-exec-crosscut-anti-repetition.md,
      // HITL-ratified 2026-05-27). Orchestrator-supplied; connector stateless.
      excludeIds: input.excludeIds,
      excludeImageCanonicalUrls: input.excludeImageCanonicalUrls,
    }),
  );
  return FindInspiringOutputSchema.parse({
    passages,
    count: passages.length,
  });
}

export const findInspiringSpec = {
  name: 'find_inspiring' as const,
  inputSchema: FindInspiringInputSchema,
  outputSchema: FindInspiringOutputSchema,
};
