/**
 * `memory_list_active` handler — list all active sales-memory entries.
 *
 * Read-only; no staff token required.
 * Returns active rows with content + updated_at + updated_by, ordered by
 * created_at DESC (newest first), then by id for deterministic tiebreak.
 * Single indexed query (index: sales_memory_status_created_at_idx, migration 020).
 *
 * This is the query a later loading task will call to hydrate memories into
 * every visitor conversation. Connector-side only — MUST NOT be registered
 * in the orchestrator's TOOL_SPECS.
 *
 * SM.t1 (sales-memory store + CRUD, connector side).
 */

import {
  MemoryListActiveInputSchema,
  MemoryListActiveOutputSchema,
  type MemoryListActiveInput,
  type MemoryListActiveOutput,
} from '@swoop/common';

import { listActiveMemories } from '../data/sales-memory.js';
import type { ToolHandlerDeps } from './deps.js';

export async function memoryListActiveBody(
  _input: MemoryListActiveInput,
  deps: ToolHandlerDeps,
): Promise<MemoryListActiveOutput> {
  const memories = await deps.withClient((client) => listActiveMemories(client));

  return MemoryListActiveOutputSchema.parse({
    memories,
    count: memories.length,
  });
}

export const memoryListActiveSpec = {
  name: 'memory_list_active' as const,
  inputSchema: MemoryListActiveInputSchema,
  outputSchema: MemoryListActiveOutputSchema,
};
