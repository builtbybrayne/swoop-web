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
import { z } from 'zod';
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
 * Register a single tool on the MCP server with the runHandler runtime.
 * Generic over input/output types so each callsite preserves its precise
 * spec types (avoids a heterogeneous-union dance at the call site).
 */
function registerOne<S extends z.ZodTypeAny, T extends z.ZodTypeAny>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: S,
  outputSchema: T,
  body: (input: z.infer<S>) => Promise<z.infer<T>>,
  runtimeDeps: HandlerRuntimeDeps,
): void {
  // The SDK accepts a ZodRawShape; for our z.object().strict() schemas the
  // .shape is what we want. Cast through `any` because the schema
  // discriminator the SDK exposes is more general than what we feed.
  const shape =
    (inputSchema as unknown as { shape?: z.ZodRawShape }).shape ?? {};
  server.registerTool(
    name,
    { description, inputSchema: shape },
    async (rawInput: unknown) => {
      const result = await runHandler(
        name,
        inputSchema,
        outputSchema,
        body,
        rawInput,
        runtimeDeps,
      );
      const mapped = toMcpToolResult(result);
      // Cast: SDK's structuredContent type is `Record<string, unknown> |
      // undefined`; our schema-validated output is more permissive at the
      // type level. The runtime shape is correct.
      return mapped as unknown as Awaited<
        ReturnType<Parameters<McpServer['registerTool']>[2]>
      >;
    },
  );
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

  const lookupDescription = (name: keyof ToolDescriptions): string => {
    const description = opts.descriptions[name];
    if (!description) {
      // Defence in depth — loadAllToolDescriptions already throws on miss.
      throw new Error(
        `[connector/tools] Cannot register tool "${name}": description map is missing this entry.`,
      );
    }
    return description;
  };

  registerOne(
    server,
    findInspiringSpec.name,
    lookupDescription(findInspiringSpec.name),
    findInspiringSpec.inputSchema,
    findInspiringSpec.outputSchema,
    (input) => findInspiringBody(input, baseDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    findSomeoneWhoSpec.name,
    lookupDescription(findSomeoneWhoSpec.name),
    findSomeoneWhoSpec.inputSchema,
    findSomeoneWhoSpec.outputSchema,
    (input) => findSomeoneWhoBody(input, baseDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    findProofSpec.name,
    lookupDescription(findProofSpec.name),
    findProofSpec.inputSchema,
    findProofSpec.outputSchema,
    (input) => findProofBody(input, baseDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    lookupSpec.name,
    lookupDescription(lookupSpec.name),
    lookupSpec.inputSchema,
    lookupSpec.outputSchema,
    (input) => lookupBody(input, baseDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    findOptionsSpec.name,
    lookupDescription(findOptionsSpec.name),
    findOptionsSpec.inputSchema,
    findOptionsSpec.outputSchema,
    (input) => findOptionsBody(input, baseDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    illustrateSpec.name,
    lookupDescription(illustrateSpec.name),
    illustrateSpec.inputSchema,
    illustrateSpec.outputSchema,
    (input) => illustrateBody(input, baseDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    handoffSpec.name,
    lookupDescription(handoffSpec.name),
    handoffSpec.inputSchema,
    handoffSpec.outputSchema,
    (input) => handoffBody(input),
    runtimeDeps,
  );
  registerOne(
    server,
    handoffSubmitSpec.name,
    lookupDescription(handoffSubmitSpec.name),
    handoffSubmitSpec.inputSchema,
    handoffSubmitSpec.outputSchema,
    (input) => handoffSubmitBody(input),
    runtimeDeps,
  );
}
