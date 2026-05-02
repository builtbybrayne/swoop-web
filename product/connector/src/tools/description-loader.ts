/**
 * Tool description loader (C.t4 / C.34).
 *
 * Reads each of the eight tools' `cms/prompts/tools/<tool>/description.md` at
 * boot, caches the result for the connector lifetime. Per HITL Q3 ratification:
 * **fail-fast on ALL 8 tools** — development-time visibility beats silent
 * degradation.
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
  TOOL_NAMES.Illustrate,
  TOOL_NAMES.Handoff,
  TOOL_NAMES.HandoffSubmit,
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
