/**
 * Per-agent model selection registry.
 *
 * Implements decision B.5 (per-agent model strategy) from
 * planning/02-impl-agent-runtime.md §5 and the Tier 3 contract in
 * planning/03-exec-agent-runtime-t6.md §"Per-agent model selection shape".
 *
 * Every agent role the system spawns — the main orchestrator, classifiers,
 * future psych-profile agents, etc. — resolves its model, temperature, and
 * max-token budget through `getModelFor(role)`. Centralising this here keeps
 * the "which model powers X" question answerable in one file, and lets us
 * swap providers per-role without surgery on the call sites.
 *
 * Adding a new role:
 *   1. Add its string to the `AgentRole` union below.
 *   2. Add a case to the `buildRegistry` switch mapping it to a ModelConfig
 *      built from config fields.
 *   3. If the role wants its own env overrides, extend schema.ts first.
 *
 * Don't pre-populate roles we haven't built (YAGNI — Tier 3 §"Handoff notes").
 */

import type { Config } from './schema.js';

/**
 * Provider namespace for a model. The string is informational — the consumer
 * (ClaudeLlm, a future GeminiLlm, etc.) decides what to do with it.
 */
export type ModelProvider = 'anthropic' | 'google' | 'other';

/**
 * Shape a caller (agent factory) receives when it asks "what model powers
 * this role?". Immutable by convention; we freeze on return.
 */
export interface ModelConfig {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

/**
 * The set of agent roles this orchestrator knows about TODAY. Grows as
 * chunks land:
 *   - B.t1/B.t6: "orchestrator"
 *   - B.t7:      "classifier"
 *   - later:     "psych-profile", ...
 *
 * Unknown roles throw from `getModelFor` — we want a loud failure, not a
 * silent fallback to the orchestrator's tier (which would waste tokens).
 */
export type AgentRole = 'orchestrator' | 'classifier';

/**
 * Infer the provider namespace from a model id. Keeps role declarations
 * below terse — callers don't have to repeat "anthropic" everywhere.
 *
 * This is a best-effort prefix match; explicit provider overrides can be
 * added to the registry when a role genuinely needs a different namespace
 * from what the model id suggests.
 */
function inferProvider(modelId: string): ModelProvider {
  const id = modelId.toLowerCase();
  if (id.startsWith('claude-')) return 'anthropic';
  if (id.startsWith('gemini-')) return 'google';
  return 'other';
}

/**
 * Default max-token budget for the functional classifier. Classification
 * outputs are short (a label + maybe a justification) — no need for the
 * orchestrator's 2048-token ceiling. Not currently env-overridable; add
 * FUNCTIONAL_CLASSIFIER_MAX_TOKENS to schema.ts if a role asks.
 */
const CLASSIFIER_MAX_TOKENS_DEFAULT = 512;

/**
 * Build the frozen role → ModelConfig registry from a validated Config.
 *
 * Pure function of config — no I/O, no mutation. Called lazily from
 * `getModelFor` (cached per-config) so tests can swap configs at will.
 */
function buildRegistry(config: Config): Readonly<Record<AgentRole, ModelConfig>> {
  const orchestrator: ModelConfig = Object.freeze({
    provider: inferProvider(config.ORCHESTRATOR_MODEL),
    model: config.ORCHESTRATOR_MODEL,
    temperature: config.ORCHESTRATOR_TEMPERATURE,
    maxTokens: config.ORCHESTRATOR_MAX_TOKENS,
  });

  const classifier: ModelConfig = Object.freeze({
    provider: inferProvider(config.FUNCTIONAL_CLASSIFIER_MODEL),
    model: config.FUNCTIONAL_CLASSIFIER_MODEL,
    temperature: config.FUNCTIONAL_CLASSIFIER_TEMPERATURE,
    maxTokens: CLASSIFIER_MAX_TOKENS_DEFAULT,
  });

  return Object.freeze({ orchestrator, classifier });
}

/**
 * Registry cache. Keyed by Config identity (not deep equality) — each
 * `loadConfig()` call produces a fresh frozen object, so identity is the
 * right key. In production there's exactly one Config instance for the
 * process lifetime; in tests, each test builds its own and gets its own
 * registry.
 */
const registryCache = new WeakMap<Config, Readonly<Record<AgentRole, ModelConfig>>>();

function registryFor(config: Config): Readonly<Record<AgentRole, ModelConfig>> {
  let registry = registryCache.get(config);
  if (!registry) {
    registry = buildRegistry(config);
    registryCache.set(config, registry);
  }
  return registry;
}

/**
 * Resolve the ModelConfig for a given agent role.
 *
 * Throws on unknown roles — Tier 3 verification step 7 enforces this.
 * Silent defaults are a footgun: a typo'd role name would route to the
 * orchestrator's expensive tier without anyone noticing.
 *
 * @param config - The loaded orchestrator Config (from loadConfig()).
 * @param role - Which agent's model to resolve.
 * @returns A frozen ModelConfig.
 * @throws Error if `role` is not a known AgentRole.
 */
export function getModelFor(config: Config, role: AgentRole | string): ModelConfig {
  const registry = registryFor(config);
  // Guard: the AgentRole union is erased at runtime, so we re-check against
  // the registry's own keys. This catches `getModelFor(cfg, "unknown")`
  // calls from JS consumers / tests.
  if (!(role in registry)) {
    const known = Object.keys(registry).join(', ');
    throw new Error(
      `[config/models] Unknown agent role "${role}". Known roles: ${known}. ` +
        'Add the role to AgentRole + buildRegistry in src/config/models.ts.',
    );
  }
  return registry[role as AgentRole];
}
