/**
 * `memory_edit` handler — edit an existing sales-memory entry.
 *
 * Bumps the version counter and inserts a version row in ONE transaction.
 * Optimistic concurrency: the caller must supply `expectedVersion`; if the
 * DB row has already advanced, the write is rejected with a descriptive error.
 *
 * Staff-only mutating tool. The enforcement gate (sm-4) rejects the call when
 * the staff token is missing/invalid: `deps.assertStaffToken` when injected,
 * else the built-in `assertStaffTokenPresent` presence backstop.
 *
 * Connector-side only. MUST NOT be registered in the orchestrator's
 * conversational TOOL_SPECS.
 *
 * SM.t1 (sales-memory store + CRUD, connector side); T3-3 wires real
 * staff-token enforcement (replacing the SM.t1 TODO seam).
 */

import {
  MemoryEditInputSchema,
  MemoryEditOutputSchema,
  type MemoryEditInput,
  type MemoryEditOutput,
} from '@swoop/common';

import { editMemory } from '../data/sales-memory.js';
import { assertStaffTokenPresent, type ToolHandlerDeps } from './deps.js';

export async function memoryEditBody(
  input: MemoryEditInput,
  deps: ToolHandlerDeps,
): Promise<MemoryEditOutput> {
  // Staff-token enforcement (sm-4). Injected verifier wins; presence backstop
  // otherwise. Throws → mutation rejected before any DB write.
  if (deps.assertStaffToken) {
    await deps.assertStaffToken(input.staffToken);
  } else {
    assertStaffTokenPresent(input.staffToken, 'memory_edit');
  }

  const memory = await deps.withClient((client) =>
    editMemory(client, {
      id: input.id,
      content: input.content,
      expectedVersion: input.expectedVersion,
      author: input.author,
    }),
  );

  return MemoryEditOutputSchema.parse({ memory });
}

export const memoryEditSpec = {
  name: 'memory_edit' as const,
  inputSchema: MemoryEditInputSchema,
  outputSchema: MemoryEditOutputSchema,
};
