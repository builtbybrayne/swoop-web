/**
 * `memory_retire` handler — soft-delete a sales-memory entry.
 *
 * Sets status='retired' and appends a 'retire' version row in ONE transaction.
 * Hard DELETE is never issued — retired memories remain in the DB with full
 * version history.
 *
 * Staff-only mutating tool. Enforcement seam rejects when `staffToken` absent.
 * TODO(sm-t2-auth): wire real token validation.
 *
 * Connector-side only. MUST NOT be registered in the orchestrator's TOOL_SPECS.
 *
 * SM.t1 (sales-memory store + CRUD, connector side).
 */

import {
  MemoryRetireInputSchema,
  MemoryRetireOutputSchema,
  type MemoryRetireInput,
  type MemoryRetireOutput,
} from '@swoop/common';

import { retireMemory } from '../data/sales-memory.js';
import type { ToolHandlerDeps } from './deps.js';

export async function memoryRetireBody(
  input: MemoryRetireInput,
  deps: ToolHandlerDeps,
): Promise<MemoryRetireOutput> {
  // ---------------------------------------------------------------------------
  // Staff-token enforcement seam.
  // TODO(sm-t2-auth): replace presence check with real token validation.
  // Signature the auth task targets:
  //   assertStaffToken(input.staffToken) — throws if invalid/absent.
  // ---------------------------------------------------------------------------
  if (!input.staffToken || input.staffToken.trim().length === 0) {
    throw new Error(
      '[memory_retire] Mutation rejected: staffToken is required. ' +
        'TODO(sm-t2-auth): wire real token validation here.',
    );
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
