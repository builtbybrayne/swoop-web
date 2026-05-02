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
      region: input.region,
      mood: input.mood,
      limit: input.limit,
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
