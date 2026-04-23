/**
 * Agent factory.
 *
 * Builds the single conversational-orchestrator LlmAgent (per decision B.4 in
 * planning/02-impl-agent-runtime.md §5: "single conversational orchestrator;
 * functional agents allowed behind tool boundaries"). B.t3 wires the MCP
 * connector tool array; session state still in B.t2; streaming in B.t5.
 *
 * The `instruction` field is wired as an InstructionProvider so the prompt
 * loader owns the dev hot-reload path: ADK calls the provider on every turn,
 * and in non-production the loader re-reads the file each call.
 */

import { LlmAgent } from '@google/adk';
import type { FunctionTool } from '@google/adk';
import type { Config } from '../config/index.js';
import type { PromptLoader } from './prompt-loader.js';
import { ClaudeLlm } from './claude-llm.js';

export interface BuildAgentParams {
  readonly config: Config;
  readonly promptLoader: PromptLoader;
  /**
   * Connector-backed ADK tools produced by B.t3's `setupConnector`. Pass `[]`
   * to build a tool-less agent (used in unit tests that exercise the factory
   * without spinning up a connector).
   */
  readonly tools?: FunctionTool[];
}

export function buildOrchestratorAgent({ config, promptLoader, tools = [] }: BuildAgentParams): LlmAgent {
  const model = new ClaudeLlm({
    model: config.ORCHESTRATOR_MODEL,
    apiKey: config.ANTHROPIC_API_KEY,
  });

  return new LlmAgent({
    name: 'puma_orchestrator',
    description:
      "Puma's conversational discovery orchestrator for Swoop Adventures' Patagonia website. Single-agent layer; functional agents live behind tool boundaries (B.t7+).",
    model,
    // InstructionProvider: resolved per-invocation so dev edits to why.md
    // are picked up without a restart.
    instruction: () => promptLoader.load(),
    tools,
  });
}
