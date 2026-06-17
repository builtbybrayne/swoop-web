/**
 * Memory-feature prompt loader (content-as-data — prompts live in CMS, never inline).
 *
 * Reads the sales-memory feature's agent-facing prompts from `cms/prompts/memory/`
 * at boot, fail-fast (mirrors connector `tools/description-loader.ts`). These were
 * briefly inline TS constants in the T3-3/T3-4 build; moved here so they can be
 * tuned without a code change, per the project rule: treat prompts as data, load
 * at runtime.
 *
 *   mode-wrapper.md   → the Opus memory agent's memory-mode instruction (sm-1)
 *   loaded-header.md  → the authoritative header atop the per-turn memory block (sm-6)
 *   seed-context.md   → the transcript-seed preamble ({{transcript}} placeholder, sm-9)
 *   tools/<name>.md   → memory tool descriptions the agent reads (memory_store … + finish_memory)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Memory tool descriptions loaded from `cms/prompts/memory/tools/<name>.md`. */
export const MEMORY_PROMPT_TOOL_NAMES = [
  'memory_store',
  'memory_edit',
  'memory_retire',
  'memory_list_active',
  'memory_show_history',
  'finish_memory',
] as const;

export interface MemoryPrompts {
  readonly modeWrapper: string;
  readonly loadedHeader: string;
  /** Carries a literal `{{transcript}}` placeholder for per-session substitution. */
  readonly seedContext: string;
  readonly toolDescriptions: Readonly<Record<string, string>>;
}

function readTrimmed(absPath: string): string {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new Error(
      `[memory-prompts] failed to read ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(`[memory-prompts] ${absPath} is empty after trim().`);
  }
  return trimmed;
}

/**
 * Load every memory-feature prompt from `dir` (cms/prompts/memory). Fail-fast: a
 * missing or empty file throws at boot rather than yielding a degraded agent.
 */
export function loadMemoryPrompts(dir: string): MemoryPrompts {
  const toolDescriptions: Record<string, string> = {};
  for (const name of MEMORY_PROMPT_TOOL_NAMES) {
    toolDescriptions[name] = readTrimmed(join(dir, 'tools', `${name}.md`));
  }
  return {
    modeWrapper: readTrimmed(join(dir, 'mode-wrapper.md')),
    loadedHeader: readTrimmed(join(dir, 'loaded-header.md')),
    seedContext: readTrimmed(join(dir, 'seed-context.md')),
    toolDescriptions,
  };
}
