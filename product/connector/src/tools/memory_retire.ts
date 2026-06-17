/**
 * `memory_retire` handler — soft-delete a sales-memory entry.
 *
 * Sets status='retired' and appends a 'retire' version row in ONE transaction.
 * Hard DELETE is never issued — retired memories remain in the DB with full
 * version history.
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
  MemoryRetireInputSchema,
  MemoryRetireOutputSchema,
  type MemoryRetireInput,
  type MemoryRetireOutput,
} from '@swoop/common';

import { retireMemory } from '../data/sales-memory.js';
import { assertStaffTokenPresent, type ToolHandlerDeps } from './deps.js';

export async function memoryRetireBody(
  input: MemoryRetireInput,
  deps: ToolHandlerDeps,
): Promise<MemoryRetireOutput> {
  // Staff-token enforcement (sm-4). Injected verifier wins; presence backstop
  // otherwise. Throws → mutation rejected before any DB write.
  if (deps.assertStaffToken) {
    await deps.assertStaffToken(input.staffToken);
  } else {
    assertStaffTokenPresent(input.staffToken, 'memory_retire');
  }

  const result = await deps.withClient((client) =>
    retireMemory(client, {
      id: input.id,
      author: input.author,
    }),
  );

  return MemoryRetireOutputSchema.parse(result);
}

export const memoryRetireSpec = {
  name: 'memory_retire' as const,
  inputSchema: MemoryRetireInputSchema,
  outputSchema: MemoryRetireOutputSchema,
};
