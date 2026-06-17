/**
 * Memory tool description loader (T3-3 relocation).
 *
 * Reads the five connector-facing sales-memory tool descriptions from
 * `cms/prompts/memory/tools/<name>.md` at boot. Mirrors the pattern in
 * `description-loader.ts` (which covers the 11 conversational tools).
 *
 * These descriptions were previously inline constants in tools/index.ts under
 * MEMORY_TOOL_DESCRIPTIONS. Moved here per the project rule: treat prompts as
 * data, load at runtime; never inline.
 *
 * Fail-fast: a missing or empty file throws at boot rather than yielding a
 * degraded connector. Does NOT include `finish_memory` — that tool is
 * orchestrator-internal and never registered on the connector.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The five connector-facing memory tool names (finish_memory is orchestrator-only). */
export const MEMORY_TOOL_NAMES_FOR_CONNECTOR = [
  'memory_store',
  'memory_edit',
  'memory_retire',
  'memory_list_active',
  'memory_show_history',
] as const;

export type ConnectorMemoryToolName = (typeof MEMORY_TOOL_NAMES_FOR_CONNECTOR)[number];

/**
 * Load the five connector-facing memory tool descriptions from
 * `dir/tools/<name>.md`. Fail-fast on any missing or empty file.
 *
 * @param dir  Absolute path to `cms/prompts/memory/` (from config).
 * @returns    Frozen map keyed by tool name.
 */
export function loadMemoryToolDescriptions(
  dir: string,
): Readonly<Record<ConnectorMemoryToolName, string>> {
  const out: Partial<Record<ConnectorMemoryToolName, string>> = {};
  for (const name of MEMORY_TOOL_NAMES_FOR_CONNECTOR) {
    const absolutePath = join(dir, 'tools', `${name}.md`);
    let content: string;
    try {
      content = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      throw new Error(
        `[connector/memory-descriptions] Failed to read description for tool "${name}" ` +
          `from ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new Error(
        `[connector/memory-descriptions] Description for tool "${name}" at ${absolutePath} ` +
          `is empty after trim(). Each memory tool must have a non-empty description.md.`,
      );
    }
    out[name] = trimmed;
  }
  return Object.freeze(out as Record<ConnectorMemoryToolName, string>);
}
