/**
 * MCP server registration — empty surface with one no-op ping tool.
 *
 * Per planning/03-exec-c-t1.md HITL Q4 (option α + ping tool): stand the
 * MCP-over-HTTP surface up NOW so C.t4 just adds tool registrations later.
 * The ping tool gives `mcp inspect` and developer probes something to
 * call without forcing them to construct a tool-call payload against
 * future schemas that don't exist yet.
 *
 * The eight intent-named tools (per C.25) register in C.t4 — they call
 * data primitives at src/data/<primitive>.ts which themselves don't
 * exist yet. The ping tool is removed by C.t4 when the real tools land.
 *
 * Shape mirrors the stub-connector pattern at
 * product/orchestrator/test-fixtures/stub-connector.ts so the orchestrator's
 * connector adapter (B.t3) can talk to either without code changes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../config/index.js';

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Build a fresh MCP server with the no-op ping tool registered.
 *
 * One server instance per HTTP session — this matches the
 * `StreamableHTTPServerTransport` lifecycle in the stub-connector. The
 * MCP SDK keeps server state per-connection; cross-session state isn't
 * a thing here, so a new server per session is correct and cheap.
 */
export function createConnectorMcpServer(): McpServer {
  const server = new McpServer({
    name: 'swoop-connector',
    version: readPackageVersion(),
  });

  // The no-op ping tool. Returns the connector's version + a fixed `ok`
  // marker. C.t4 deletes this when the real tools register.
  server.registerTool(
    'ping',
    {
      description:
        'Liveness probe. Returns the connector version. No-op tool registered by C.t1; ' +
        'removed when the real tool surface lands in C.t4.',
      inputSchema: z.object({}).shape,
    },
    async () => {
      const payload = { ok: true, version: readPackageVersion() };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  return server;
}
