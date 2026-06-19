/**
 * Lazy per-variant runner registry — dev/test model picker (M-PICK-1) + thinking
 * toggle (TT-1).
 *
 * The default runner (= `ORCHESTRATOR_MODEL` + `ORCHESTRATOR_THINKING_ENABLED`)
 * is built once at boot in `index.ts` and passed in here. `getRunner(modelId,
 * thinkingEnabled)` returns:
 *   - the **default runner** when neither dimension is overridden (the common
 *     case: no override, the picker/toggle disabled, an id that isn't
 *     allow-listed, or an override that equals the default); OR
 *   - a lazily-built-and-cached **variant runner**, keyed by
 *     `(effectiveModel, effectiveThinking)`, otherwise.
 *
 * Two independent dimensions, two independent gates:
 *   - **model** override is honoured only when `modelOverridesEnabled`
 *     (= `config.modelPickerEnabled`: allow-list non-empty AND not production)
 *     AND the id is allow-listed AND differs from the default. (Allow-list =
 *     the cost/abuse gate against forcing Opus.)
 *   - **thinking** override is honoured only when `thinkingOverridesEnabled`
 *     (= `config.thinkingPickerEnabled`: not production) AND it differs from the
 *     default. No allow-list — thinking on/off is cheap and valid on every
 *     family.
 *
 * Every variant runner REUSES the default runner's `sessionService`, so a
 * session bootstrapped under the default is visible to whichever variant a
 * turn routes to, and `/session/:id/history` keeps working unchanged. Variants
 * differ ONLY in the agent's `ClaudeLlm` (model id + per-family request shape)
 * and, for a thinking override, the RL.3 belt in the system prefix.
 *
 * Provider seam (M-PICK-7): `buildAgentFor` is provider-agnostic. See
 * planning/03-exec-crosscut-test-mode-model-picker.md and
 * planning/03-exec-crosscut-test-mode-thinking-toggle.md.
 */

import type { Runner } from '@google/adk';
import type { BuildAgentResult } from './factory.js';

type AdkRunner = Runner;

export interface RunnerRegistry {
  /** Resolve the runner for a turn's (possibly-overridden) model + thinking. */
  getRunner(modelId?: string, thinkingEnabled?: boolean): Promise<AdkRunner>;
}

export interface CreateRunnerRegistryParams {
  /** The runner built for the default model + default thinking. */
  readonly defaultRunner: AdkRunner;
  /** `ORCHESTRATOR_MODEL` — requests naming this (or nothing) get the default model. */
  readonly defaultModelId: string;
  /** `ORCHESTRATOR_THINKING_ENABLED` — the thinking the default runner was built with. */
  readonly defaultThinking: boolean;
  /** Whether MODEL overrides are honoured (`config.modelPickerEnabled`). */
  readonly modelOverridesEnabled: boolean;
  /** Whether THINKING overrides are honoured (`config.thinkingPickerEnabled`). */
  readonly thinkingOverridesEnabled: boolean;
  /** Allow-listed model ids (`config.MODEL_PICKER_ALLOWLIST`). */
  readonly allowlist: readonly string[];
  /** Builds a fresh agent pinned to `(modelId, thinkingEnabled)` (wraps `buildOrchestratorAgent`). */
  readonly buildAgentFor: (
    modelId: string,
    thinkingEnabled: boolean,
  ) => Promise<BuildAgentResult>;
  /**
   * Construct a runner for a freshly-built variant agent. Injected (rather than
   * `new Runner(...)` here) so the gating/caching logic is unit-testable without
   * standing up a real ADK Runner. index.ts supplies the default runner's
   * sessionService here so every variant shares one session store.
   */
  readonly buildRunner: (agent: BuildAgentResult['agent']) => AdkRunner;
}

export function createRunnerRegistry(params: CreateRunnerRegistryParams): RunnerRegistry {
  const {
    defaultRunner,
    defaultModelId,
    defaultThinking,
    modelOverridesEnabled,
    thinkingOverridesEnabled,
    allowlist,
    buildAgentFor,
    buildRunner,
  } = params;
  const allowSet = new Set(allowlist);

  // Cache variant runners keyed by `${model}|${thinking}`. Cache the in-flight
  // PROMISE (not the resolved runner) so two concurrent first-requests for the
  // same variant share one build instead of racing two.
  const cache = new Map<string, Promise<AdkRunner>>();

  async function build(modelId: string, thinkingEnabled: boolean): Promise<AdkRunner> {
    const { agent } = await buildAgentFor(modelId, thinkingEnabled);
    return buildRunner(agent);
  }

  return {
    async getRunner(modelId?: string, thinkingEnabled?: boolean): Promise<AdkRunner> {
      // Resolve each dimension independently against its own gate.
      const modelOverrideActive =
        modelOverridesEnabled &&
        modelId !== undefined &&
        modelId !== defaultModelId &&
        allowSet.has(modelId);
      const effectiveModel = modelOverrideActive ? modelId! : defaultModelId;

      const thinkingOverrideActive =
        thinkingOverridesEnabled &&
        thinkingEnabled !== undefined &&
        thinkingEnabled !== defaultThinking;
      const effectiveThinking = thinkingOverrideActive ? thinkingEnabled! : defaultThinking;

      // Neither dimension overridden → the boot-time default runner.
      if (!modelOverrideActive && !thinkingOverrideActive) {
        return defaultRunner;
      }

      const key = `${effectiveModel}|${effectiveThinking}`;
      let pending = cache.get(key);
      if (pending === undefined) {
        pending = build(effectiveModel, effectiveThinking);
        cache.set(key, pending);
        // On build failure, drop the cache entry so a later request can retry
        // (and so a transient error doesn't pin a rejected promise forever).
        pending.catch(() => cache.delete(key));
      }
      return pending;
    },
  };
}
