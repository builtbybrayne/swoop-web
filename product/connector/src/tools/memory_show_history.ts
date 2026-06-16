/**
 * `memory_show_history` handler — version history for a single memory entry.
 *
 * Read-only; no staff token required.
 * Returns all version rows for a given memory id, ordered by version ASC
 * (chronological). The first row always has change_kind='create'.
 *
 * Connector-side only — MUST NOT be registered in the orchestrator's TOOL_SPECS.
 *
 * SM.t1 (sales-memory store + CRUD, connector side).
 */

import {
  MemoryShowHistoryInputSchema,
  MemoryShowHistoryOutputSchema,
  type MemoryShowHistoryInput,
  type MemoryShowHistoryOutput,
} from '@swoop/common';

import { getMemoryHistory } from '../data/sales-memory.js';
import type { ToolHandlerDeps } from './deps.js';

export async function memoryShowHistoryBody(
  input: MemoryShowHistoryInput,
  deps: ToolHandlerDeps,
): Promise<MemoryShowHistoryOutput> {
  const versions = await deps.withClient((client) =>
    getMemoryHistory(client, input.id),
  );

  return MemoryShowHistoryOutputSchema.parse({
    memoryId: input.id,
    versions,
    count: versions.length,
  });
}

export const memoryShowHistorySpec = {
  name: 'memory_show_history' as const,
  inputSchema: MemoryShowHistoryInputSchema,
  outputSchema: MemoryShowHistoryOutputSchema,
};
