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
  registerMemoryTools,
  type ToolDescriptions,
  type ToolHandlerDeps,
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
  /**
   * ISO date when pricing data was captured (PRICES_CAPTURED_AT).
   * Stamped on every get_pricing response. Defaults to '2026-04-27'.
   */
  readonly capturedAt?: string;
  /**
   * Enable the staff sales-memory tools (T3-3 / sm-1). Opt-in: when true the
   * five memory tools are registered ALONGSIDE the conversational tools so the
   * orchestrator's Opus memory agent can call them over MCP. Off by default so
   * a connector that doesn't serve staff memory authoring never advertises the
   * surface. The visitor agent is unaffected either way — it has its own
   * orchestrator-side TOOL_SPECS allow-list and never sees these tools.
   */
  readonly enableMemoryTools?: boolean;
  /**
   * Staff-token enforcement gate for the memory mutating tools (sm-4). Passed
   * straight to `registerMemoryTools`. When omitted, the mutating tools fall
   * back to the built-in presence backstop.
   */
  readonly assertStaffToken?: ToolHandlerDeps['assertStaffToken'];
}

/**
 * Build a fresh MCP server with the eleven conversational tools registered,
 * plus (opt-in) the five staff sales-memory tools when `enableMemoryTools`.
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
    capturedAt: deps.capturedAt,
  });

  // T3-3 — opt-in staff sales-memory surface (sm-1, sm-4). Registered as a
  // sibling set; never reaches the visitor agent.
  if (deps.enableMemoryTools) {
    registerMemoryTools(server, {
      pool: deps.pool,
      ...(deps.assertStaffToken ? { assertStaffToken: deps.assertStaffToken } : {}),
    });
  }

  return server;
}
