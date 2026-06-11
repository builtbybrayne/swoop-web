/**
 * Tool description loader (C.t4 / C.34).
 *
 * Reads each tool's `cms/prompts/tools/<tool>/description.md` at boot, caches
 * the result for the connector lifetime. Per HITL Q3 ratification: **fail-fast
 * on ALL tools** — development-time visibility beats silent degradation.
 *
 * Tool count history:
 *   - 8 tools at C.t4 (find_inspiring through handoff_submit)
 *   - 9 tools after find_tips (customer-tips chunk)
 *   - 10 tools after get_pricing (goofy-goldstine pricing wave, 2026-06-11)
 *   - 11 tools after show_options (goofy-goldstine find/show split, 2026-06-11)
 *
 * Pattern mirrors the orchestrator's prompt-loader.ts. Single-file-per-tool
 * read; not generic across `cms/prompts/{system,skills,tools}/` (per G.11 —
 * different load contracts per subdirectory).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TOOL_NAMES } from '@swoop/common';

export const ALL_TOOL_NAMES = [
  TOOL_NAMES.FindInspiring,
  TOOL_NAMES.FindSomeoneWho,
  TOOL_NAMES.FindProof,
  TOOL_NAMES.Lookup,
  TOOL_NAMES.FindOptions,
  TOOL_NAMES.FindTips,
  TOOL_NAMES.GetPricing,
  TOOL_NAMES.Illustrate,
  TOOL_NAMES.Handoff,
  TOOL_NAMES.HandoffSubmit,
  // Eleventh tool — find/show split (C.goofy-goldstine-12, 2026-06-11)
  TOOL_NAMES.ShowOptions,
] as const;
export type RegisteredToolName = (typeof ALL_TOOL_NAMES)[number];

export type ToolDescriptions = Readonly<Record<RegisteredToolName, string>>;

export class ToolDescriptionLoadError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly absolutePath: string,
    public readonly underlying: unknown,
  ) {
    super(
      `[connector/tool-descriptions] Failed to load description for tool "${toolName}" from ${absolutePath}. ` +
        `Per HITL Q3 ratification, every tool must have a description.md at boot.`,
    );
    this.name = 'ToolDescriptionLoadError';
  }
}

/**
 * Load every tool's description.md from the resolved tools-prompt directory.
 * Throws on any missing or empty file. Returns a frozen map keyed by tool name.
 */
export function loadAllToolDescriptions(
  toolsPromptDirAbsolutePath: string,
): ToolDescriptions {
  const out: Partial<Record<RegisteredToolName, string>> = {};
  for (const name of ALL_TOOL_NAMES) {
    const absolutePath = path.join(
      toolsPromptDirAbsolutePath,
      name,
      'description.md',
    );
    let content: string;
    try {
      content = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      throw new ToolDescriptionLoadError(name, absolutePath, err);
    }
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new ToolDescriptionLoadError(
        name,
        absolutePath,
        new Error('description.md is empty after trim()'),
      );
    }
    out[name] = trimmed;
  }
  return Object.freeze(out as Record<RegisteredToolName, string>);
}
