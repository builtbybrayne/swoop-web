/**
 * MCP-over-HTTP client (B.t3).
 *
 * Thin wrapper around `@modelcontextprotocol/sdk`'s `Client` + the streamable
 * HTTP transport. Pointed at `config.connectorUrl`. Exposes the two operations
 * we actually need: `listTools()` at startup and `callTool(name, args)` at
 * turn time.
 *
 * Why not use ADK's MCPToolset directly?
 *   ADK ships `MCPToolset` (dist/esm/tools/mcp/mcp_toolset.js) which auto-
 *   wraps every MCP tool as a `FunctionDeclaration` for Gemini. Nice, but it
 *   gives us no seam to run Zod validation from `@swoop/common` on input and
 *   output (planning/03-exec-agent-runtime-t3.md §3/§4). B.t3 is where that
 *   seam lives, so we build our own `FunctionTool[]` in ./tools.ts on top of
 *   this raw client.
 *
 * Session lifecycle (§"Key implementation notes" 6):
 *   - One client per orchestrator process. Connect eagerly at startup.
 *   - `listTools()` called once; no runtime re-discovery cache needed.
 *   - `close()` on SIGTERM/SIGINT; B.t1's shutdown hook calls it.
 *   - Per-call timeout honours `config.connectorRequestTimeoutMs` via the
 *     SDK's `RequestOptions.timeout`.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { withRetry } from './retry.js';

export interface ConnectorClientParams {
  /** MCP-over-HTTP URL for the connector (chunk C) or stub (test-fixtures). */
  readonly url: string;
  /** Per-call timeout in ms. */
  readonly requestTimeoutMs: number;
  /** Client identity — surfaces in the connector's logs. */
  readonly clientName?: string;
  readonly clientVersion?: string;
}

/** Shape we care about per tool — a subset of MCP's ListToolsResult.tools[]. */
export interface ConnectorToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface ConnectorClient {
  /** Connect transport + run the MCP initialise handshake. Retries on transport errors. */
  connect(): Promise<void>;
  /** List tools the connector exposes. Called once at startup. */
  listTools(): Promise<readonly ConnectorToolDescriptor[]>;
  /**
   * Call a tool by name with already-validated args. Returns the raw MCP
   * `CallToolResult`; callers (./tools.ts) unwrap `structuredContent` /
   * `content` and run Zod validation on top.
   *
   * Retries transport-level failures (see ./retry.ts). Tool-level errors
   * (`isError: true` on the result) are returned as-is so the caller can
   * surface them to the agent.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolRawResult>;
  /** Tear down the MCP session. Idempotent. */
  close(): Promise<void>;
  /** URL the client is pointed at — for startup logs. */
  readonly url: string;
}

/**
 * Structural subset of the SDK's `CallToolResult` that we actually read.
 * Typed loosely on purpose — the SDK's full types are large and pull in the
 * Gemini types; this adapter only needs these fields.
 */
export interface CallToolRawResult {
  readonly content?: ReadonlyArray<{ type: string; text?: string; [k: string]: unknown }>;
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

/**
 * Build a connector client. Does not connect — call `.connect()` explicitly
 * so startup failures land at the entrypoint where they're logged cleanly.
 */
export function createConnectorClient(params: ConnectorClientParams): ConnectorClient {
  const client = new Client({
    name: params.clientName ?? 'puma-orchestrator',
    version: params.clientVersion ?? '0.1.0',
  });

  let transport: StreamableHTTPClientTransport | undefined;
  let connected = false;

  async function connect(): Promise<void> {
    if (connected) return;
    // `StreamableHTTPClientTransport` wants a URL object, not a string.
    // URL construction happens here rather than at config-parse time so the
    // failure path (bad URL) is caught in one place.
    const targetUrl = new URL(params.url);
    transport = new StreamableHTTPClientTransport(targetUrl);
    await withRetry(() => client.connect(transport!));
    connected = true;
  }

  async function listTools(): Promise<readonly ConnectorToolDescriptor[]> {
    if (!connected) {
      throw new Error('[connector] listTools called before connect(). Call connectorClient.connect() first.');
    }
    const result = await withRetry(() => client.listTools(undefined, { timeout: params.requestTimeoutMs }));
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolRawResult> {
    if (!connected) {
      throw new Error(`[connector] callTool("${name}") before connect(). Call connectorClient.connect() first.`);
    }
    const result = await withRetry(() =>
      client.callTool({ name, arguments: args }, undefined, { timeout: params.requestTimeoutMs }),
    );
    // The result is a union (`CallToolResult | CompatibilityCallToolResult`);
    // we only read fields common to both code paths.
    return result as CallToolRawResult;
  }

  async function close(): Promise<void> {
    if (!connected) return;
    try {
      await client.close();
    } finally {
      connected = false;
      transport = undefined;
    }
  }

  return {
    connect,
    listTools,
    callTool,
    close,
    url: params.url,
  };
}
