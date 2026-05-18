/**
 * Agent factory.
 *
 * Builds the single conversational-orchestrator LlmAgent (per decision B.4 in
 * planning/02-impl-agent-runtime.md §5: "single conversational orchestrator;
 * functional agents allowed behind tool boundaries"). B.t3 wires the MCP
 * connector tool array; session state still in B.t2; streaming in B.t5;
 * B.t9 (this revision) wires the 14 authored ADK skills from
 * `cms/prompts/skills/` into a SkillToolset bundled with the connector tools.
 *
 * The `instruction` field is wired as an InstructionProvider so the prompt
 * loader owns the dev hot-reload path: ADK calls the provider on every turn,
 * and in non-production the loader re-reads the file each call.
 *
 * The `tools` array is a single entry — a SkillToolset that wraps both the
 * loaded skills and the connector FunctionTools (ADK's contract per
 * `tools/skill/skill_toolset.d.ts`). Per
 * [HITL Q2 ratification in planning/03-exec-agent-runtime-t9.md](../../../planning/03-exec-agent-runtime-t9.md),
 * the factory bundles internally so callers (src/index.ts) keep their
 * current `tools: FunctionTool[]` signature.
 *
 * B.t9 made `buildOrchestratorAgent` async because the underlying
 * `loadSkillsFromDir` (a wrapper around ADK's async `loadAllSkillsInDir`)
 * is async. The single caller (`index.ts`) already runs inside an async
 * `main()`, so the `await` was a one-character change there.
 */

import { LlmAgent, SkillToolset } from '@google/adk';
import type { FunctionTool } from '@google/adk';
import type { Config } from '../config/index.js';
import type { PromptLoader } from './prompt-loader.js';
import { ClaudeLlm } from './claude-llm.js';
import { loadSkillsFromDir, type LoadedSkill } from './skill-loader.js';

export interface BuildAgentParams {
  readonly config: Config;
  readonly promptLoader: PromptLoader;
  /**
   * Connector-backed ADK tools produced by B.t3's `setupConnector`. Pass `[]`
   * to build a tool-less agent (used in unit tests that exercise the factory
   * without spinning up a connector). Bundled into the SkillToolset alongside
   * the loaded skills.
   */
  readonly tools?: FunctionTool[];
}

export interface BuildAgentResult {
  readonly agent: LlmAgent;
  /** The skills the loader returned, in deterministic order. Boot-log + tests assert against this. */
  readonly skills: LoadedSkill[];
}

export async function buildOrchestratorAgent({
  config,
  promptLoader,
  tools = [],
}: BuildAgentParams): Promise<BuildAgentResult> {
  const model = new ClaudeLlm({
    model: config.ORCHESTRATOR_MODEL,
    apiKey: config.ANTHROPIC_API_KEY,
  });

  const skills: LoadedSkill[] = await loadSkillsFromDir(config.skillsDirAbsolutePath);
  if (skills.length === 0) {
    // Defensive — the cms/prompts/skills/ directory is never empty in
    // practice (G.t3 landed 14 skills). Per HITL Q1, warn rather than
    // fail; the system prompt + tools still drive every conversation.
    console.warn(
      `[orchestrator] no skills loaded from ${config.skillsDirAbsolutePath} — ` +
        `the agent will run with system prompt + tools only.`,
    );
  } else {
    console.log(
      `[orchestrator] loaded ${skills.length} skills from ${config.skillsDirAbsolutePath}: ` +
        skills.map((s) => s.frontmatter.name).join(', '),
    );
  }

  // SkillToolset accepts either a Skill[] or a Record<string, Skill>; we
  // pass the sorted array so iteration order matches the boot-log order.
  const skillToolset = new SkillToolset(skills, { additionalTools: tools });

  const agent = new LlmAgent({
    name: 'puma_orchestrator',
    description:
      "Puma's conversational discovery orchestrator for Swoop Adventures' Patagonia website. Single-agent layer; functional agents live behind tool boundaries (B.t7+).",
    model,
    // InstructionProvider: resolved per-invocation so dev edits to why.md
    // are picked up without a restart.
    instruction: () => promptLoader.load(),
    tools: [skillToolset],
  });

  return { agent, skills };
}
