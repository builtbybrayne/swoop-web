/**
 * Lazy per-model runner registry — dev/test model picker (M-PICK-1).
 *
 * The default runner (= `ORCHESTRATOR_MODEL`) is built once at boot in
 * `index.ts` and passed in here. `getRunner(modelId)` returns:
 *   - the **default runner** when the override is absent, equals the default,
 *     the picker is disabled, or the id isn't allow-listed; OR
 *   - a lazily-built-and-cached **per-model runner** otherwise.
 *
 * Every per-model runner REUSES the default runner's `sessionService`, so a
 * session bootstrapped under the default (via `onSessionCreated`) is visible
 * to whichever model the visitor's turns route to, and `/session/:id/history`
 * keeps working unchanged. Per-model runners differ ONLY in the agent's
 * `ClaudeLlm` (the model id + the per-family request shape in claude-llm.ts).
 *
 * Provider seam (M-PICK-7): `buildAgentFor` is provider-agnostic — a future
 * non-Claude `BaseLlm` shim slots in behind the same callback with no change
 * here. See planning/03-exec-crosscut-test-mode-model-picker.md.
 */

import type { Runner } from '@google/adk';
import type { BuildAgentResult } from './factory.js';

type AdkRunner = Runner;

export interface RunnerRegistry {
  /** Resolve the runner for a (possibly-overridden) model id. */
  getRunner(modelId?: string): Promise<AdkRunner>;
}

export interface CreateRunnerRegistryParams {
  /** The runner built for the default `ORCHESTRATOR_MODEL`. */
  readonly defaultRunner: AdkRunner;
  /** `ORCHESTRATOR_MODEL` — requests naming this (or nothing) get the default runner. */
  readonly defaultModelId: string;
  /** Whether overrides are honoured (`config.modelPickerEnabled`). */
  readonly enabled: boolean;
  /** Allow-listed model ids (`config.MODEL_PICKER_ALLOWLIST`). */
  readonly allowlist: readonly string[];
  /** Builds a fresh agent pinned to `modelId` (wraps `buildOrchestratorAgent`). */
  readonly buildAgentFor: (modelId: string) => Promise<BuildAgentResult>;
  /**
   * Construct a runner for a freshly-built per-model agent. Injected (rather
   * than `new Runner(...)` here) so the gating/caching logic is unit-testable
   * without standing up a real ADK Runner. index.ts supplies the default
   * runner's sessionService here so every model shares one session store.
   */
  readonly buildRunner: (agent: BuildAgentResult['agent']) => AdkRunner;
}

export function createRunnerRegistry(params: CreateRunnerRegistryParams): RunnerRegistry {
  const { defaultRunner, defaultModelId, enabled, allowlist, buildAgentFor, buildRunner } = params;
  const allowSet = new Set(allowlist);

  // Cache per-model runners keyed by model id. Cache the in-flight PROMISE
  // (not the resolved runner) so two concurrent first-requests for the same
  // new model share one build instead of racing two.
  const cache = new Map<string, Promise<AdkRunner>>();

  async function build(modelId: string): Promise<AdkRunner> {
    const { agent } = await buildAgentFor(modelId);
    return buildRunner(agent);
  }

  return {
    async getRunner(modelId?: string): Promise<AdkRunner> {
      if (
        !enabled ||
        modelId === undefined ||
        modelId === defaultModelId ||
        !allowSet.has(modelId)
      ) {
        return defaultRunner;
      }
      let pending = cache.get(modelId);
      if (pending === undefined) {
        pending = build(modelId);
        cache.set(modelId, pending);
        // On build failure, drop the cache entry so a later request can retry
        // (and so a transient error doesn't pin a rejected promise forever).
        pending.catch(() => cache.delete(modelId));
      }
      return pending;
    },
  };
}
