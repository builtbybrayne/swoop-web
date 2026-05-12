/**
 * `find_options` handler — Propose options job.
 *
 * The journey moment: visitor is ready to consider concrete options.
 * Output `cards` is polymorphic — a discriminated union over `trip | tour |
 * hotel | region_base` (`ProposalCardPublicSchema` in `@swoop/common`).
 *
 * Crosscut C.48 (v1 tranche, 2026-05-12): the contract carries all four
 * variants from day one so the UI is forward-compatible; the handler only
 * wires the `trip` variant live. Tour / hotel / region_base data primitives
 * land in v2 (Swoop-data-gated, Luke upsell priority) and v3 tranches.
 *
 * v1 behaviour:
 *   - `preferredType` is accepted on the input but not yet dispatched against
 *     (decision C.51 — schema-only in v1).
 *   - Every card returned carries `type: 'trip'`.
 *
 * Pure SQL filter — no vector retrieval (per C.t4 plan §"Components" + the
 * C.t2 contract). No defence against missing trip_card rows: per HITL Q7,
 * empty result is the correct outcome when C.t3a hasn't populated trips yet.
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
