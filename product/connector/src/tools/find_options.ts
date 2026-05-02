/**
 * `find_options` handler — Propose options job.
 *
 * The journey moment: visitor is ready to consider concrete trips. Returns
 * 2–4 trip cards (image, headline, vibe-line, region, headline price,
 * duration). Pure SQL filter — no vector retrieval (per C.t4 plan §
 * "Components" + the C.t2 contract). No defence against missing trip_card
 * rows: per HITL Q7, empty result is the correct outcome when C.t3a hasn't
 * populated trips yet.
 */

import {
  FindOptionsInputSchema,
  FindOptionsOutputSchema,
  type FindOptionsInput,
  type FindOptionsOutput,
} from '@swoop/common';

import { queryTripCardsByFilter } from '../data/query-trips.js';
import type { ToolHandlerDeps } from './deps.js';

export async function findOptionsBody(
  input: FindOptionsInput,
  deps: ToolHandlerDeps,
): Promise<FindOptionsOutput> {
  const cards = await deps.withClient((client) =>
    queryTripCardsByFilter(client, {
      region: input.region,
      durationMin: input.durationMin,
      durationMax: input.durationMax,
      budgetBand: input.budgetBand,
      activity: input.activity,
      accommodationStyle: input.accommodationStyle,
      limit: input.limit,
    }),
  );
  return FindOptionsOutputSchema.parse({
    cards,
    count: cards.length,
  });
}

export const findOptionsSpec = {
  name: 'find_options' as const,
  inputSchema: FindOptionsInputSchema,
  outputSchema: FindOptionsOutputSchema,
};
