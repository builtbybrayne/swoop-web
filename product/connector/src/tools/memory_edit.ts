/**
 * `memory_edit` handler — edit an existing sales-memory entry.
 *
 * Bumps the version counter and inserts a version row in ONE transaction.
 * Optimistic concurrency: the caller must supply `expectedVersion`; if the
 * DB row has already advanced, the write is rejected with a descriptive error.
 *
 * Staff-only mutating tool. Enforcement seam rejects when `staffToken` absent.
 * TODO(sm-t2-auth): wire real token validation.
 *
 * Connector-side only. MUST NOT be registered in the orchestrator's TOOL_SPECS.
 *
 * SM.t1 (sales-memory store + CRUD, connector side).
 */

import {
  MemoryEditInputSchema,
  MemoryEditOutputSchema,
  type MemoryEditInput,
  type MemoryEditOutput,
} from '@swoop/common';

import { editMemory } from '../data/sales-memory.js';
import type { ToolHandlerDeps } from './deps.js';

export async function memoryEditBody(
  input: MemoryEditInput,
  deps: ToolHandlerDeps,
): Promise<MemoryEditOutput> {
  // ---------------------------------------------------------------------------
  // Staff-token enforcement seam.
  // TODO(sm-t2-auth): replace presence check with real token validation.
  // Signature the auth task targets:
  //   assertStaffToken(input.staffToken) — throws if invalid/absent.
  // ---------------------------------------------------------------------------
  if (!input.staffToken || input.staffToken.trim().length === 0) {
    throw new Error(
      '[memory_edit] Mutation rejected: staffToken is required. ' +
        'TODO(sm-t2-auth): wire real token validation here.',
    );
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
