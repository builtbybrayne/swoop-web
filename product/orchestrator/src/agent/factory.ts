/**
 * Agent factory.
 *
 * Builds the single conversational-orchestrator LlmAgent (per decision B.4 in
 * planning/02-impl-agent-runtime.md §5: "single conversational orchestrator;
 * functional agents allowed behind tool boundaries"). B.t3 wires the MCP
 * connector tool array; session state still in B.t2; streaming in B.t5;
 * B.t9 wires the 14 authored ADK skills from `cms/prompts/skills/` as
 * modular guidance via a `SkillToolset`.
 *
 * The `instruction` field is wired as an InstructionProvider so the prompt
 * loader owns the dev hot-reload path: ADK calls the provider on every turn,
 * and in non-production the loader re-reads the file each call.
 *
 * The `tools` array carries the SkillToolset **alongside** the connector
 * FunctionTools as siblings — `tools: [skillToolset, ...connectorTools]`.
 * Connector tools are the agent's always-on WHAT layer (the eight intent-
 * named tools per planning/01-top-level.md §3.0); skills are *additive*
 * modular guidance per planning/02-impl-content.md §2.6.
 *
 * Connector tools are NOT passed into SkillToolset's `additionalTools`
 * option. That option is a conditional-binding mechanism gated by each
 * skill's `frontmatter.metadata.adk_additional_tools` — see the
 * `## 2026-05-18 nice-goodall live-smoke fix` addendum in
 * `planning/03-exec-agent-runtime-t9.md` for the full diagnosis. The
 * earlier B.t9 HITL Q2 ratification ("bundle internally") was based on
 * a misread of ADK's API surface and is superseded.
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
import { buildSkillsPromptInjection } from './skills-prompt-injection.js';

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

  // Build the skills-prompt injection ONCE at boot. Skill bodies don't
  // change at runtime (dev hot-reload of the brief stays via promptLoader;
  // skill bodies need a restart). The XML index + ADK-style "you MUST use
  // load_skill" instruction reach the model on every turn via the
  // InstructionProvider below. When PRELOAD_SKILL_BODIES is true the full
  // body of every skill is appended — see config schema + skills-prompt-
  // injection.ts header comment for the why.
  const skillsInjection = buildSkillsPromptInjection(skills, {
    includeBodies: config.PRELOAD_SKILL_BODIES,
  });
  console.log(
    `[orchestrator] skills-prompt injection ready: xml-index always-on, ` +
      `bodies=${config.PRELOAD_SKILL_BODIES ? 'PRELOADED' : 'on-demand via load_skill'}`,
  );

  // SkillToolset accepts either a Skill[] or a Record<string, Skill>; we
  // pass the sorted array so iteration order matches the boot-log order.
  // No `additionalTools` — connector tools live alongside the toolset as
  // top-level siblings (see the file header comment + the 2026-05-18
  // nice-goodall live-smoke fix addendum in planning/03-exec-agent-runtime-t9.md).
  const skillToolset = new SkillToolset(skills);

  const agent = new LlmAgent({
    name: 'puma_orchestrator',
    description:
      "Puma's conversational discovery orchestrator for Swoop Adventures' Patagonia website. Single-agent layer; functional agents live behind tool boundaries (B.t7+).",
    model,
    // InstructionProvider: resolved per-invocation so dev edits to why.md
    // are picked up without a restart. The skills injection (ADK's
    // DEFAULT_SKILL_SYSTEM_INSTRUCTION + <available_skills> XML, plus
    // optional bodies appendix) is appended after the brief — manual
    // replacement for ADK's broken SkillToolset.processLlmRequest
    // pipeline. See skills-prompt-injection.ts + gotchas.md.
    instruction: () => `${promptLoader.load()}\n\n---\n\n${skillsInjection}`,
    // Connector FunctionTools as top-level siblings of the SkillToolset.
    // The SkillToolset contributes the 5 skill-management tools
    // (list_skills / load_skill / etc.). Its processLlmRequest hook never
    // fires (ADK bug — see gotchas.md), so the load_skill MUST-instruction
    // and skills XML are injected manually via `instruction` above.
    // Connector tools (the eight intent-named WHAT layer) reach Sonnet
    // directly via `toolsDict`.
    tools: [skillToolset, ...tools],
  });

  return { agent, skills };
}
