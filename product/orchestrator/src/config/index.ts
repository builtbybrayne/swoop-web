/**
 * Config barrel — public surface of the orchestrator's config module.
 *
 * Ownership: B.t6 — see planning/03-exec-agent-runtime-t6.md.
 *
 * Consumers should only ever import from `./config/index.js` (or
 * `@swoop/orchestrator/config` once we add path exports). Do NOT reach into
 * `./schema.js` / `./load.js` / `./models.js` directly from outside this
 * folder — the split is a module-internal concern.
 *
 * Backward-compatibility:
 *   - B.t1 callers (src/index.ts, src/agent/factory.ts) import `loadConfig`
 *     and the `Config` type from this path. Preserved.
 *   - B.t3 connector adapter reads `config.CONNECTOR_URL` /
 *     `config.CONNECTOR_REQUEST_TIMEOUT_MS`. Preserved with the same default
 *     (`http://localhost:3001/mcp`, 10_000 ms).
 *   - `config.PRIMARY_MODEL` still resolves (mirrors ORCHESTRATOR_MODEL).
 *
 * The full surface (session, CORS, warm pool, per-agent models, ...) lands
 * additively here — see schema.ts for the canonical field list.
 */

export { loadConfig } from './load.js';
export type { Config, RawConfig, SessionBackend } from './schema.js';
export { DEFAULT_ORCHESTRATOR_MODEL, DEFAULT_CLASSIFIER_MODEL } from './schema.js';
export { getModelFor } from './models.js';
export type { AgentRole, ModelConfig, ModelProvider } from './models.js';
