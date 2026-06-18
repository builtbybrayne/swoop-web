/**
 * Express app builder — testable surface for the connector service.
 *
 * Wires the health endpoints + the MCP-over-HTTP transport. Same shape as
 * the stub at product/orchestrator/test-fixtures/stub-connector.ts: per-
 * session `StreamableHTTPServerTransport` keyed on `mcp-session-id`, fresh
 * `McpServer` per session, transport.handleRequest delegated to inside the
 * /mcp catch-all.
 *
 * Why a builder instead of a default-exported `app`: tests instantiate the
 * app with a controlled pool (or a mock readiness probe) without booting
 * the listener. The entrypoint at src/server/index.ts wires the real pool
 * and calls `app.listen`.
 */

import express, { type Express, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type pg from 'pg';

import type { EmbedQueryFn } from '../data/embed-query.js';
import type { ToolDescriptions } from '../tools/index.js';
import type { ConnectorMemoryToolName } from '../tools/memory-description-loader.js';
import { healthzHandler, buildReadyzHandler } from './health.js';
import { createConnectorMcpServer } from './mcp.js';

export interface BuildAppDeps {
  /** Pool used for /readyz's SELECT 1 probe + tool body borrows. */
  readonly pool: pg.Pool;
  /** Gemini-bound embedQuery (gemini-embedding-001 / 3072d) — wired into every conversational tool. */
  readonly embedQuery: EmbedQueryFn;
  /** Loaded tool descriptions (one per registered tool). */
  readonly descriptions: ToolDescriptions;
  /**
   * Loaded memory tool descriptions (one per connector-facing memory tool).
   * Loaded from cms/prompts/memory/tools/<name>.md at boot. When absent,
   * registerMemoryTools is not called (opt-in, same gate as enableMemoryTools).
   */
  readonly memoryDescriptions?: Readonly<Record<ConnectorMemoryToolName, string>>;
  /**
   * ISO date when pricing data was captured (PRICES_CAPTURED_AT config value).
   * Stamped on every get_pricing response. Defaults to '2026-04-27' when absent.
   */
  readonly capturedAt?: string;
  /**
   * Cryptographic staff-token verifier (sm-t2-auth). When present, injected
   * into the MCP server's memory-tool deps bag so all mutating tools perform
   * full JWT verification instead of the presence-only backstop. When absent,
   * mutation tools fall back to `assertStaffTokenPresent`.
   */
  readonly assertStaffToken?: (token: string | undefined) => Promise<void>;
  /**
   * Optional readiness override — tests substitute a deterministic handler
   * to exercise the 200 / 503 branches without touching pg. Production
   * leaves this undefined and gets the real DB-probe handler.
   */
  readonly readinessHandler?: RequestHandler;
}

export function buildApp(deps: BuildAppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // 16kb body cap — same shape as the orchestrator's R4-server tightening.
  // MCP message bodies are small; cap protects against runaway payloads.
  app.use(express.json({ limit: '16kb' }));

  app.get('/healthz', healthzHandler);
  app.get('/readyz', deps.readinessHandler ?? buildReadyzHandler(deps.pool));

  // ---------------------------------------------------------------------
  // MCP-over-HTTP. Per-session transport; transports keyed by the
  // `mcp-session-id` header set by the SDK on initialize. Mirrors the
  // stub-connector pattern.
  // ---------------------------------------------------------------------
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.all('/mcp', async (req, res) => {
    const sessionHeader = req.header('mcp-session-id');
    let transport: StreamableHTTPServerTransport | undefined = sessionHeader
      ? transports.get(sessionHeader)
      : undefined;

    if (!transport && req.method === 'POST' && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          if (transport) transports.set(id, transport);
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      const server = createConnectorMcpServer({
        pool: deps.pool,
        embedQuery: deps.embedQuery,
        descriptions: deps.descriptions,
        capturedAt: deps.capturedAt,
        ...(deps.memoryDescriptions ? {
          enableMemoryTools: true,
          memoryDescriptions: deps.memoryDescriptions,
        } : {}),
        ...(deps.assertStaffToken ? { assertStaffToken: deps.assertStaffToken } : {}),
      });
      await server.connect(transport);
    }

    if (!transport) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: no active session' },
        id: null,
      });
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[connector] MCP request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'connector internal error' });
      }
    }
  });

  return app;
}

function isInitializeRequest(body: unknown): boolean {
  if (body && typeof body === 'object') {
    if (Array.isArray(body)) return body.some(isInitializeRequest);
    return (body as { method?: unknown }).method === 'initialize';
  }
  return false;
}
