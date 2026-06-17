/**
 * `memory_store` handler — create a new sales-memory entry.
 *
 * Staff-only mutating tool. The enforcement gate (sm-4) rejects the call when
 * the staff token is missing/invalid: it calls `deps.assertStaffToken` when
 * injected (the orchestrator-bound verifier / future cryptographic check) and
 * falls back to the built-in `assertStaffTokenPresent` presence backstop.
 *
 * Connector-side only. MUST NOT be registered in the orchestrator's
 * conversational TOOL_SPECS — it must never reach the visitor agent.
 *
 * SM.t1 (sales-memory store + CRUD, connector side); T3-3 wires the real
 * staff-token enforcement (replacing the SM.t1 TODO seam).
 */

import {
  MemoryStoreInputSchema,
  MemoryStoreOutputSchema,
  type MemoryStoreInput,
  type MemoryStoreOutput,
} from '@swoop/common';

import { createMemory } from '../data/sales-memory.js';
import { assertStaffTokenPresent, type ToolHandlerDeps } from './deps.js';

export async function memoryStoreBody(
  input: MemoryStoreInput,
  deps: ToolHandlerDeps,
): Promise<MemoryStoreOutput> {
  // Staff-token enforcement (sm-4). Injected verifier wins; presence backstop
  // otherwise. Throws → mutation rejected before any DB write.
  if (deps.assertStaffToken) {
    await deps.assertStaffToken(input.staffToken);
  } else {
    assertStaffTokenPresent(input.staffToken, 'memory_store');
  }

  const memory = await deps.withClient((client) =>
    createMemory(client, {
      content: input.content,
      author: input.author,
    }),
  );

  return MemoryStoreOutputSchema.parse({ memory });
}

export const memoryStoreSpec = {
  name: 'memory_store' as const,
  inputSchema: MemoryStoreInputSchema,
  outputSchema: MemoryStoreOutputSchema,
};
