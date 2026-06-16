/**
 * `memory_store` handler — create a new sales-memory entry.
 *
 * Staff-only mutating tool. The enforcement seam rejects the call when
 * `staffToken` is absent. TODO(sm-t2-auth): a separate task wires real
 * token validation against a staff-identity store.
 *
 * Connector-side only. MUST NOT be registered in the orchestrator's
 * TOOL_SPECS — it must never reach the visitor agent.
 *
 * SM.t1 (sales-memory store + CRUD, connector side).
 */

import {
  MemoryStoreInputSchema,
  MemoryStoreOutputSchema,
  type MemoryStoreInput,
  type MemoryStoreOutput,
} from '@swoop/common';

import { createMemory } from '../data/sales-memory.js';
import type { ToolHandlerDeps } from './deps.js';

export async function memoryStoreBody(
  input: MemoryStoreInput,
  deps: ToolHandlerDeps,
): Promise<MemoryStoreOutput> {
  // ---------------------------------------------------------------------------
  // Staff-token enforcement seam.
  // TODO(sm-t2-auth): replace this presence check with real token validation.
  // Signature the auth task targets:
  //   assertStaffToken(input.staffToken) — throws if invalid/absent.
  // ---------------------------------------------------------------------------
  if (!input.staffToken || input.staffToken.trim().length === 0) {
    throw new Error(
      '[memory_store] Mutation rejected: staffToken is required. ' +
        'TODO(sm-t2-auth): wire real token validation here.',
    );
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
