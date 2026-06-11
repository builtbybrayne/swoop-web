/**
 * MCP server registration — eight intent-named tools (C.t4).
 *
 * Per planning/03-exec-c-t4.md. Replaces the C.t1 no-op `ping` tool with the
 * eight conversational tools. Each registration loads its description from
 * `cms/prompts/tools/<tool>/description.md` (cached at boot, fail-fast on
 * missing/empty per HITL Q3 — ALL 8 tools, not just the 5 conversational).
 *
 * One server instance per HTTP session — same lifecycle as the C.t1 stub.
 * Pool + embedQuery + descriptions are wired in at app-build time and
 * partial-applied per session.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

import { PACKAGE_ROOT } from '../config/index.js';
import type { EmbedQueryFn } from '../data/embed-query.js';
import {
  registerAllTools,
  type ToolDescriptions,
} from '../tools/index.js';

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

export interface CreateMcpServerDeps {
  /** Connector's Postgres pool — borrowed inside each tool body. */
  readonly pool: pg.Pool;
  /** Gemini-bound embedding helper (gemini-embedding-001 / 3072d). */
  readonly embedQuery: EmbedQueryFn;
  /** Loaded tool descriptions (one per tool, fail-fast at app-build time). */
  readonly descriptions: ToolDescriptions;
}

/**
 * Build a fresh MCP server with all ten tools registered.
 */
export function createConnectorMcpServer(deps: CreateMcpServerDeps): McpServer {
  const server = new McpServer({
    name: 'swoop-connector',
    version: readPackageVersion(),
  });

  registerAllTools(server, {
    pool: deps.pool,
    embedQuery: deps.embedQuery,
    descriptions: deps.descriptions,
  });

  return server;
}
