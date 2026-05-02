/**
 * `find_someone_who` handler — Mirror job.
 *
 * The journey moment: visitor reveals a persona signal — solo female traveller,
 * post-retirement, photographer. Returns 1–3 customer stories where someone
 * with a similar persona has done a similar trip. Per decision C.30, retrieval
 * is persona-shaped: cosine on `persona_embedding` only. No hybrid; the embedding
 * encodes who-they-are, not what-they-said.
 */

import {
  FindSomeoneWhoInputSchema,
  FindSomeoneWhoOutputSchema,
  type FindSomeoneWhoInput,
  type FindSomeoneWhoOutput,
} from '@swoop/common';

import { findCustomerStoriesByPersonaSignal } from '../data/find-customer-stories.js';
import type { ToolHandlerDeps } from './deps.js';

export async function findSomeoneWhoBody(
  input: FindSomeoneWhoInput,
  deps: ToolHandlerDeps,
): Promise<FindSomeoneWhoOutput> {
  const embedding = await deps.embedQuery(input.signal);
  const stories = await deps.withClient((client) =>
    findCustomerStoriesByPersonaSignal(client, embedding, {
      region: input.region,
      limit: input.limit,
    }),
  );
  return FindSomeoneWhoOutputSchema.parse({
    stories,
    count: stories.length,
  });
}

export const findSomeoneWhoSpec = {
  name: 'find_someone_who' as const,
  inputSchema: FindSomeoneWhoInputSchema,
  outputSchema: FindSomeoneWhoOutputSchema,
};
