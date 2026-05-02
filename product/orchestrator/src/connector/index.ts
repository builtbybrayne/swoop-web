/**
 * Connector adapter — public surface (B.t3 / B.t3a).
 *
 * The orchestrator entrypoint imports `setupConnector` to wire the
 * MCP-over-HTTP tools into the `LlmAgent`. See the Tier 3 plan:
 * planning/03-exec-agent-runtime-t3.md (B.t3) + the B.t3a sunset addendum.
 *
 * What this factory does in order:
 *   1. Build an MCP client pointed at `config.CONNECTOR_URL`.
 *   2. Connect + list the connector's advertised tools.
 *   3. Wrap the eight intent-named Puma tools (find_inspiring,
 *      find_someone_who, find_proof, lookup, find_options, illustrate,
 *      handoff, handoff_submit) as ADK `FunctionTool` instances with Zod
 *      validation on both sides. `handoff_submit` is registered for
 *      validation reuse but filtered out of the model-facing list.
 *
 * Failure handling at startup:
 *   - If the connector is unreachable, `withRetry` in the client will burn
 *     its retries and then throw. We rethrow out of here so `src/index.ts`
 *     logs a clear "cannot reach connector" message at process start.
 *   - A partial tool list (e.g. connector booting with 2/8 tools registered)
 *     produces a warning, not a startup failure. Local dev stays unblocked.
 */

import type { FunctionTool } from '@google/adk';
import type { ToolDescriptions } from '@swoop/connector';

import type { Config } from '../config/index.js';
import { createConnectorClient, type ConnectorClient } from './client.js';
import { createConnectorTools } from './tools.js';

export { createConnectorClient } from './client.js';
export type { ConnectorClient, ConnectorToolDescriptor } from './client.js';
export { createConnectorTools } from './tools.js';
export type { ToolAdapterError, ToolAdapterResult, ToolAdapterSuccess } from './tools.js';
export { withRetry, isRetryableError } from './retry.js';

export interface ConnectorSetup {
  /** Underlying MCP client. The entrypoint calls `.close()` on shutdown. */
  readonly client: ConnectorClient;
  /** ADK tools to pass into `LlmAgent({ tools })`. */
  readonly tools: FunctionTool[];
  /** Tool names the connector advertised at startup — for logging. */
  readonly discoveredNames: readonly string[];
}

export interface SetupConnectorParams {
  readonly config: Config;
  /**
   * Authoritative tool descriptions — one per tool — loaded by the
   * entrypoint at boot via `loadAllToolDescriptions` (re-exported from
   * `@swoop/connector`). Same fail-fast contract as the connector boot path.
   */
  readonly descriptions: ToolDescriptions;
}

/**
 * One-shot bootstrap: connect, list tools, build adapters. Call once from
 * `src/index.ts` before constructing the agent.
 */
export async function setupConnector({
  config,
  descriptions,
}: SetupConnectorParams): Promise<ConnectorSetup> {
  const client = createConnectorClient({
    url: config.CONNECTOR_URL,
    requestTimeoutMs: config.CONNECTOR_REQUEST_TIMEOUT_MS,
  });

  await client.connect();
  const discovered = await client.listTools();
  const discoveredNames = discovered.map((t) => t.name);

  const tools = createConnectorTools({ client, descriptions, discoveredNames });

  return { client, tools, discoveredNames };
}
