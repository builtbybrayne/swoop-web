/**
 * `find_tips` handler — second shape of the Inform job (the 9th MCP tool).
 *
 * The journey moment: the visitor has a practical concern and would value
 * lived-experience advice from someone who's been — "what should I pack?",
 * "how do I handle money down there?", "is the wind really that bad?". Where
 * `lookup` returns Swoop's own authoritative guidance, `find_tips` returns
 * short, first-person, attributed tips from fellow travellers. Hybrid retrieval
 * (cosine + ts_rank fused via RRF k=60) over `customer_tip`, with an optional
 * region filter (region-agnostic tips always remain eligible).
 *
 * Plan: planning/03-exec-customer-tips-tool.md.
 */

import {
  FindTipsInputSchema,
  FindTipsOutputSchema,
  type FindTipsInput,
  type FindTipsOutput,
} from '@swoop/common';

import { findCustomerTipsByTopic } from '../data/find-customer-tips.js';
import type { ToolHandlerDeps } from './deps.js';

export async function findTipsBody(
  input: FindTipsInput,
  deps: ToolHandlerDeps,
): Promise<FindTipsOutput> {
  const embedding = await deps.embedQuery(input.topic);
  const tips = await deps.withClient((client) =>
    findCustomerTipsByTopic(client, embedding, input.topic, {
      region: input.region,
      limit: input.limit,
      // Anti-repetition (planning/03-exec-crosscut-anti-repetition.md,
      // HITL-ratified 2026-05-27). Orchestrator-supplied; connector stateless.
      excludeIds: input.excludeIds,
    }),
  );
  return FindTipsOutputSchema.parse({
    tips,
    count: tips.length,
  });
}

export const findTipsSpec = {
  name: 'find_tips' as const,
  inputSchema: FindTipsInputSchema,
  outputSchema: FindTipsOutputSchema,
};
