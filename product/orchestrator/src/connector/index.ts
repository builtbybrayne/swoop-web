/**
 * Connector adapter — public surface (B.t3).
 *
 * The orchestrator entrypoint imports `createConnectorTools` to wire the
 * MCP-over-HTTP tools into the `LlmAgent`. See the Tier 3 plan:
 * planning/03-exec-agent-runtime-t3.md.
 *
 * What this factory does in order:
 *   1. Build an MCP client pointed at `config.CONNECTOR_URL`.
 *   2. Connect + list the connector's advertised tools.
 *   3. Wrap the Puma tool set (search, get_detail, illustrate, handoff) as
 *      ADK `FunctionTool` instances with Zod validation on both sides.
 *
 * Failure handling at startup:
 *   - If the connector is unreachable, `withRetry` in the client will burn
 *     its retries and then throw. We rethrow out of here so `src/index.ts`
 *     logs a clear "cannot reach connector" message at process start.
 *   - A partial tool list (e.g. connector booting with 2/5 tools registered)
 *     produces a warning, not a startup failure. Local dev stays unblocked.
 */

import type { FunctionTool } from '@google/adk';

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

/**
 * One-shot bootstrap: connect, list tools, build adapters. Call once from
 * `src/index.ts` before constructing the agent.
 */
export async function setupConnector(config: Config): Promise<ConnectorSetup> {
  const client = createConnectorClient({
    url: config.CONNECTOR_URL,
    requestTimeoutMs: config.CONNECTOR_REQUEST_TIMEOUT_MS,
  });

  await client.connect();
  const discovered = await client.listTools();
  const discoveredNames = discovered.map((t) => t.name);

  const tools = createConnectorTools({ client, discoveredNames });

  return { client, tools, discoveredNames };
}
