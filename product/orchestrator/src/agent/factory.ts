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

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { LlmAgent, SkillToolset } from '@google/adk';
import type { FunctionTool } from '@google/adk';
import type { Config } from '../config/index.js';
import type { PromptLoader } from './prompt-loader.js';
import { ClaudeLlm } from './claude-llm.js';
import { loadSkillsFromDir, type LoadedSkill } from './skill-loader.js';
import { buildSkillsPromptInjection } from './skills-prompt-injection.js';
import { loadSalesMemoryBlock } from './sales-memory-loader.js';
import type { ConnectorClient } from '../connector/client.js';

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
  /**
   * Optional model id for the orchestrator's `ClaudeLlm`. Defaults to
   * `config.ORCHESTRATOR_MODEL`. The dev/test model picker passes an
   * allow-listed override here when building a per-model runner
   * (planning/03-exec-crosscut-test-mode-model-picker.md, M-PICK-1).
   */
  readonly modelId?: string;
  /**
   * Connector MCP client — used per-turn to read the active sales-memory set
   * (T3-4 / sm-6). When omitted (e.g. unit tests that don't need memory
   * loading), the memory block is silently skipped and the instruction is
   * assembled from prompt + skills only.
   *
   * The connector is the only path to the active-memory set (decision E.11:
   * orchestrator never queries Postgres directly). No app-level cache here —
   * each turn reads fresh; shared-DB propagation handles cross-instance
   * consistency.
   */
  readonly connectorClient?: ConnectorClient;
  /**
   * The authoritative header for the sales-memory block (loaded from
   * cms/prompts/memory/loaded-header.md via loadMemoryPrompts at boot).
   * When omitted (e.g. unit tests that don't need memory loading), the memory
   * block is silently skipped.
   */
  readonly memoryLoadedHeader?: string;
}

export interface BuildAgentResult {
  readonly agent: LlmAgent;
  /** The skills the loader returned, in deterministic order. Boot-log + tests assert against this. */
  readonly skills: LoadedSkill[];
}

/**
 * RL.3 — the thinking-off fallback "belt".
 *
 * When native thinking is DISABLED, the model has no private reasoning channel,
 * so without guidance it narrates its planning + tool use as visible text (the
 * reasoning-leak this work fixes). In that mode we inject a "work silently"
 * instruction, authored in CMS at `cms/prompts/fallbacks/silent-working.md`.
 *
 * When thinking is ENABLED we inject NOTHING — the thinking channel already
 * isolates reasoning, and layering a blanket silence instruction on top risks
 * clipping transparency or the visible answer (Alastair, 2026-06-17).
 *
 * Returns the block to append to the system prompt (leading separator), or ''
 * when thinking is on. Gated on `=== false` so a cast/partial Config in tests
 * (field undefined) is treated as "not disabled" and never reads a file.
 */
export function buildThinkingFallbackInjection(
  config: Pick<Config, 'ORCHESTRATOR_THINKING_ENABLED' | 'systemPromptDirAbsolutePath'>,
): string {
  if (config.ORCHESTRATOR_THINKING_ENABLED !== false) return '';
  const beltPath = path.resolve(
    config.systemPromptDirAbsolutePath,
    '..',
    'fallbacks',
    'silent-working.md',
  );
  const belt = readFileSync(beltPath, 'utf8').trim();
  return belt.length > 0 ? `\n\n---\n\n${belt}` : '';
}

export async function buildOrchestratorAgent({
  config,
  promptLoader,
  tools = [],
  modelId,
  connectorClient,
  memoryLoadedHeader,
}: BuildAgentParams): Promise<BuildAgentResult> {
  const model = new ClaudeLlm({
    model: modelId ?? config.ORCHESTRATOR_MODEL,
    apiKey: config.ANTHROPIC_API_KEY,
    // RL.5: thread the config max-tokens/temperature through (they previously
    // defaulted inside ClaudeLlm and were never wired) + RL.2/RL.4 native
    // thinking. The dev model picker passes `modelId`; thinking config applies
    // to whichever model is selected (buildThinkingFragment branches per family).
    maxTokens: config.ORCHESTRATOR_MAX_TOKENS,
    temperature: config.ORCHESTRATOR_TEMPERATURE,
    thinkingEnabled: config.ORCHESTRATOR_THINKING_ENABLED,
    effort: config.ORCHESTRATOR_EFFORT,
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

  // RL.3: the silent-working belt is injected ONLY when thinking is off.
  const thinkingFallback = buildThinkingFallbackInjection(config);
  console.log(
    config.ORCHESTRATOR_THINKING_ENABLED
      ? `[orchestrator] thinking: ENABLED (adaptive, effort=${config.ORCHESTRATOR_EFFORT ?? 'high (default)'}) — reasoning isolated in the thinking channel; no belt`
      : '[orchestrator] thinking: DISABLED — silent-working belt injected (prompt-only leak mitigation)',
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
    // T3-4 (sm-6): async InstructionProvider — reads the active sales-memory
    // set from the connector on EVERY turn so every Cloud Run instance folds
    // in a write on its next turn (shared-DB, no per-instance cache). ADK's
    // InstructionProvider type accepts `() => string | Promise<string>`, so
    // the async upgrade is a transparent extension.
    //
    // Placement: base = prompt + skills injection + (RL.3) thinking belt — all
    // boot-static, so they form the cache-stable prefix. The sales-memory block
    // is appended AFTER base; it changes only when a memory is written (one
    // cache-bust, then stable again), so the Anthropic prompt cache
    // (cache_control: ephemeral, Perf-1) keeps hitting between writes. The belt
    // is '' when thinking is on (RL.3), so it doesn't perturb the prefix then.
    //
    // Connector-client absent (test/no-memory path): skip the block silently
    // so tests that don't wire a connector still work.
    instruction: async () => {
      const base = `${promptLoader.load()}\n\n---\n\n${skillsInjection}${thinkingFallback}`;
      if (!connectorClient || !memoryLoadedHeader) return base;
      try {
        const memoryBlock = await loadSalesMemoryBlock(connectorClient, memoryLoadedHeader);
        return memoryBlock.length > 0 ? `${base}\n\n---\n\n${memoryBlock}` : base;
      } catch (err) {
        // Connector hiccup must not break the user turn. Log and degrade
        // gracefully — the instruction is assembled without the memory block.
        console.warn(
          `[orchestrator] sales-memory load failed (omitting block): ${err instanceof Error ? err.message : String(err)}`,
        );
        return base;
      }
    },
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
