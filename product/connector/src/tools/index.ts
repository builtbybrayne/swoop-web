/**
 * Tool registration boot path.
 *
 * Per planning/03-exec-c-t4.md §"`tools/index.ts` — registration boot path".
 * Wires every handler body into the MCP server with:
 *   1. Description string loaded from `cms/prompts/tools/<tool>/description.md`
 *      (fail-fast on ALL 8 per HITL Q3).
 *   2. Input/output Zod schemas from `@swoop/common`.
 *   3. The shared `runHandler` runtime (input/output validation +
 *      tool.invoked event emission).
 *
 * The MCP server retires the C.t1 no-op `ping` tool — `tools/list` returns the
 * eight intent-named tools and nothing else.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import type pg from 'pg';

import {
  runHandler,
  toMcpToolResult,
  type HandlerRuntimeDeps,
} from './_handler-runtime.js';
import { findInspiringSpec, findInspiringBody } from './find_inspiring.js';
import { findSomeoneWhoSpec, findSomeoneWhoBody } from './find_someone_who.js';
import { findProofSpec, findProofBody } from './find_proof.js';
import { lookupSpec, lookupBody } from './lookup.js';
import { findOptionsSpec, findOptionsBody } from './find_options.js';
import { illustrateSpec, illustrateBody } from './illustrate.js';
import { handoffSpec, handoffBody } from './handoff.js';
import { handoffSubmitSpec, handoffSubmitBody } from './handoff_submit.js';
import type { ToolHandlerDeps } from './deps.js';
import type { ToolDescriptions } from './description-loader.js';

export {
  loadAllToolDescriptions,
  ALL_TOOL_NAMES,
  ToolDescriptionLoadError,
  type ToolDescriptions,
  type RegisteredToolName,
} from './description-loader.js';

export {
  runHandler,
  toMcpToolResult,
  type HandlerResult,
  type HandlerRuntimeDeps,
  type ToolInvokedSink,
} from './_handler-runtime.js';

export type { ToolHandlerDeps } from './deps.js';

export interface RegisterToolsOptions {
  /** Pool — borrow-and-release happens inside the handler deps. */
  readonly pool: pg.Pool;
  /** Voyage-bound embedQuery function. */
  readonly embedQuery: ToolHandlerDeps['embedQuery'];
  /** Loaded description map (one description.md per tool). */
  readonly descriptions: ToolDescriptions;
  /** Session id for envelope correlation. Tests pin; production uses 'connector-host'. */
  readonly sessionId?: string;
  /** Test-injectable sink for tool.invoked events. */
  readonly sink?: HandlerRuntimeDeps['sink'];
  /** Test-injectable clock. */
  readonly now?: HandlerRuntimeDeps['now'];
}

interface SpecWithBody<I, O> {
  readonly name: string;
  readonly inputSchema: z.ZodSchema<I>;
  readonly outputSchema: z.ZodSchema<O>;
  readonly body: (input: I, deps: ToolHandlerDeps) => Promise<O>;
}

/**
 * Build a `withClient` from a pool that borrows-and-releases per call. Each
 * tool composes 1–N primitives inside one `withClient` so transient state
 * (e.g. SET LOCAL hnsw.ef_search overrides — deferred to C.t8) can land on
 * the same connection.
 */
function buildWithClient(pool: pg.Pool): ToolHandlerDeps['withClient'] {
  return async function withClient<T>(
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  };
}

/**
 * Register every tool on a fresh MCP server instance. Mirrors the per-session
 * `createConnectorMcpServer` shape in `server/mcp.ts`.
 */
export function registerAllTools(
  server: McpServer,
  opts: RegisterToolsOptions,
): void {
  const baseDeps: ToolHandlerDeps = {
    withClient: buildWithClient(opts.pool),
    embedQuery: opts.embedQuery,
  };
  const runtimeDeps: HandlerRuntimeDeps = {
    sessionId: opts.sessionId ?? 'connector-host',
    sink: opts.sink,
    now: opts.now,
  };

  const allSpecs: ReadonlyArray<SpecWithBody<unknown, unknown>> = [
    {
      ...findInspiringSpec,
      body: (input, deps) => findInspiringBody(input, deps),
    },
    {
      ...findSomeoneWhoSpec,
      body: (input, deps) => findSomeoneWhoBody(input, deps),
    },
    { ...findProofSpec, body: (input, deps) => findProofBody(input, deps) },
    { ...lookupSpec, body: (input, deps) => lookupBody(input, deps) },
    {
      ...findOptionsSpec,
      body: (input, deps) => findOptionsBody(input, deps),
    },
    { ...illustrateSpec, body: (input, deps) => illustrateBody(input, deps) },
    { ...handoffSpec, body: (input) => handoffBody(input) },
    {
      ...handoffSubmitSpec,
      body: (input) => handoffSubmitBody(input),
    },
  ] as ReadonlyArray<SpecWithBody<unknown, unknown>>;

  for (const spec of allSpecs) {
    const description = opts.descriptions[spec.name as keyof ToolDescriptions];
    if (!description) {
      // Defence in depth — loadAllToolDescriptions already throws on miss,
      // but a corrupt descriptions map shouldn't silently succeed.
      throw new Error(
        `[connector/tools] Cannot register tool "${spec.name}": description map is missing this entry.`,
      );
    }
    server.registerTool(
      spec.name,
      {
        description,
        // Pass the schema's shape — the SDK's inputSchema accepts a ZodRawShape.
        // For our z.object().strict() schemas, .shape is what we need.
        inputSchema: ((spec.inputSchema as unknown as { shape?: z.ZodRawShape })
          .shape ?? {}) as z.ZodRawShape,
      },
      async (rawInput) => {
        const result = await runHandler(
          spec.name,
          spec.inputSchema,
          spec.outputSchema,
          (input) => spec.body(input, baseDeps),
          rawInput,
          runtimeDeps,
        );
        return toMcpToolResult(result);
      },
    );
  }
}
