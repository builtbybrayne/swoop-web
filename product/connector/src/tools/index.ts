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
 * ten intent-named tools (find_tips joined at the customer-tips chunk;
 * show_options added by goofy-goldstine find/show split) and nothing else.
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
import { findTipsSpec, findTipsBody } from './find_tips.js';
import { getPricingSpec, getPricingBody } from './get_pricing.js';
import { illustrateSpec, illustrateBody } from './illustrate.js';
import { handoffSpec, handoffBody } from './handoff.js';
import { handoffSubmitSpec, handoffSubmitBody } from './handoff_submit.js';
import { showOptionsSpec, showOptionsBody } from './show_options.js';
import { memoryStoreSpec, memoryStoreBody } from './memory_store.js';
import { memoryEditSpec, memoryEditBody } from './memory_edit.js';
import { memoryRetireSpec, memoryRetireBody } from './memory_retire.js';
import { memoryListActiveSpec, memoryListActiveBody } from './memory_list_active.js';
import { memoryShowHistorySpec, memoryShowHistoryBody } from './memory_show_history.js';
import { assertStaffTokenPresent, type ToolHandlerDeps } from './deps.js';
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

export { assertStaffTokenPresent, type ToolHandlerDeps } from './deps.js';

export interface RegisterToolsOptions {
  /** Pool — borrow-and-release happens inside the handler deps. */
  readonly pool: pg.Pool;
  /** Gemini-bound embedQuery function (gemini-embedding-001 / 3072d). */
  readonly embedQuery: ToolHandlerDeps['embedQuery'];
  /** Loaded description map (one description.md per tool). */
  readonly descriptions: ToolDescriptions;
  /**
   * ISO date when the source pricing data was captured (PRICES_CAPTURED_AT
   * config value). Stamped on every `get_pricing` response.
   * Defaults to '2026-04-27' when absent (safe for tests that don't care).
   */
  readonly capturedAt?: string;
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
  // .shape is what we want. For z.discriminatedUnion(...) schemas (the
  // HandoffInputSchema family post VERDICT-E.t1) `.shape` is undefined —
  // the union itself isn't a ZodObject. Fall back to the first variant's
  // shape, which is structurally representative (all variants carry the
  // same field names; only the literal `verdict` differs). The strict
  // per-variant runtime validation still fires via runHandler's
  // `inputSchema.safeParse` below.
  const rawShape =
    (inputSchema as unknown as { shape?: z.ZodRawShape }).shape ??
    extractDiscriminatedUnionShape(inputSchema);
  const shape = rawShape ?? {};
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
 * For `z.discriminatedUnion(<key>, [variant1, variant2, ...])` schemas,
 * build a permissive `ZodRawShape` for MCP `registerTool` advertising:
 *
 *  - takes the first variant's shape as the structural base (all variants
 *    share field names by design — the union discriminator is what differs);
 *  - widens the discriminator field to `z.enum([...all-literals])` so the
 *    SDK's input-validation layer accepts any variant's payload;
 *  - keeps strict per-variant validation downstream — `runHandler`'s
 *    `inputSchema.safeParse(rawInput)` against the full union narrows to
 *    the correct variant and rejects invalid `(discriminator, fields)` combos.
 *
 * Returns `undefined` for non-discriminated-union schemas; the caller falls
 * back to `{}` in that case.
 *
 * Added by VERDICT-E.t1 (2026-05-13, decision E.verdict-5) to keep the
 * MCP-side tool registration working after HandoffInputSchema became a
 * discriminated union.
 */
function extractDiscriminatedUnionShape(
  schema: z.ZodTypeAny,
): z.ZodRawShape | undefined {
  const def = (
    schema as unknown as {
      _def?: {
        typeName?: string;
        discriminator?: string;
        options?: unknown[];
      };
    }
  )._def;
  if (def?.typeName !== 'ZodDiscriminatedUnion') return undefined;
  const variants = (def.options ?? []) as Array<{ shape?: z.ZodRawShape }>;
  const firstVariant = variants[0];
  if (!firstVariant?.shape) return undefined;
  // Collect the literal values across every variant's discriminator field.
  const discriminator = def.discriminator;
  const literals = discriminator
    ? variants
        .map(
          (v) =>
            (
              (v.shape ?? {}) as Record<
                string,
                { _def?: { value?: string } }
              >
            )[discriminator]?._def?.value,
        )
        .filter((v): v is string => typeof v === 'string')
    : [];
  const baseShape = { ...firstVariant.shape };
  if (discriminator && literals.length > 0) {
    // Cast to satisfy the ZodRawShape index — the constructed enum is
    // shape-compatible with the field's z.literal at the MCP advertising
    // layer; runtime narrowing is preserved by the discriminated-union
    // parse in runHandler.
    baseShape[discriminator] = z.enum(
      literals as [string, ...string[]],
    ) as unknown as z.ZodTypeAny;
  }
  return baseShape;
}

/**
 * Register every tool on a fresh MCP server instance. Mirrors the per-session
 * `createConnectorMcpServer` shape in `server/mcp.ts`.
 */
export function registerAllTools(
  server: McpServer,
  opts: RegisterToolsOptions,
): void {
  const capturedAt = opts.capturedAt ?? '2026-04-27';
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
    findTipsSpec.name,
    lookupDescription(findTipsSpec.name),
    findTipsSpec.inputSchema,
    findTipsSpec.outputSchema,
    (input) => findTipsBody(input, baseDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    getPricingSpec.name,
    lookupDescription(getPricingSpec.name),
    getPricingSpec.inputSchema,
    getPricingSpec.outputSchema,
    (input) => getPricingBody(input, baseDeps, capturedAt),
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
  registerOne(
    server,
    showOptionsSpec.name,
    lookupDescription(showOptionsSpec.name),
    showOptionsSpec.inputSchema,
    showOptionsSpec.outputSchema,
    (input) => showOptionsBody(input, baseDeps),
    runtimeDeps,
  );
}

// ---------------------------------------------------------------------------
// Sales-memory tools (T3-3 / sm-1, sm-4).
//
// Registered SEPARATELY from registerAllTools so the memory surface is opt-in:
// only a connector boot that wants the staff memory-authoring feature calls
// registerMemoryTools. The visitor agent NEVER sees these — they are exposed
// solely to the orchestrator's Opus memory agent, which validates the staff
// JWT and binds the token before any call reaches here.
//
// Unlike the conversational tools, memory tools have no cms/prompts/tools/
// description.md (they're not visitor-facing content), so descriptions are
// inline constants here.
// ---------------------------------------------------------------------------

export interface RegisterMemoryToolsOptions {
  /** Pool — borrow-and-release happens inside the handler deps. */
  readonly pool: pg.Pool;
  /**
   * Loaded descriptions for the five connector-facing memory tools, from
   * cms/prompts/memory/tools/<name>.md. Keyed by tool name.
   */
  readonly descriptions: Readonly<Record<string, string>>;
  /**
   * Staff-token enforcement gate (sm-4). Injected so the connector boot can
   * supply a real verifier (orchestrator-bound / future cryptographic check).
   * When omitted, the mutating tools fall back to the built-in
   * `assertStaffTokenPresent` presence backstop.
   */
  readonly assertStaffToken?: ToolHandlerDeps['assertStaffToken'];
  /** Session id for envelope correlation. Tests pin; production uses 'connector-host'. */
  readonly sessionId?: string;
  /** Test-injectable sink for tool.invoked events. */
  readonly sink?: HandlerRuntimeDeps['sink'];
  /** Test-injectable clock. */
  readonly now?: HandlerRuntimeDeps['now'];
}

/**
 * Register the five sales-memory tools on an MCP server. Call this IN ADDITION
 * to registerAllTools on a connector boot that enables staff memory authoring.
 *
 * The mutating tools (store/edit/retire) enforce the staff-token gate; the
 * read-only tools (list_active/show_history) do not require a token.
 */
export function registerMemoryTools(
  server: McpServer,
  opts: RegisterMemoryToolsOptions,
): void {
  const memoryDeps: ToolHandlerDeps = {
    withClient: buildWithClient(opts.pool),
    // Memory tools never embed — supply a guard that fails loudly if a future
    // memory tool tries to use it, rather than a silent no-op.
    embedQuery: () => {
      throw new Error('[connector/memory] embedQuery is not available to memory tools.');
    },
    ...(opts.assertStaffToken ? { assertStaffToken: opts.assertStaffToken } : {}),
  };
  const runtimeDeps: HandlerRuntimeDeps = {
    sessionId: opts.sessionId ?? 'connector-host',
    sink: opts.sink,
    now: opts.now,
  };

  registerOne(
    server,
    memoryStoreSpec.name,
    opts.descriptions[memoryStoreSpec.name] ?? memoryStoreSpec.name,
    memoryStoreSpec.inputSchema,
    memoryStoreSpec.outputSchema,
    (input) => memoryStoreBody(input, memoryDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    memoryEditSpec.name,
    opts.descriptions[memoryEditSpec.name] ?? memoryEditSpec.name,
    memoryEditSpec.inputSchema,
    memoryEditSpec.outputSchema,
    (input) => memoryEditBody(input, memoryDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    memoryRetireSpec.name,
    opts.descriptions[memoryRetireSpec.name] ?? memoryRetireSpec.name,
    memoryRetireSpec.inputSchema,
    memoryRetireSpec.outputSchema,
    (input) => memoryRetireBody(input, memoryDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    memoryListActiveSpec.name,
    opts.descriptions[memoryListActiveSpec.name] ?? memoryListActiveSpec.name,
    memoryListActiveSpec.inputSchema,
    memoryListActiveSpec.outputSchema,
    (input) => memoryListActiveBody(input, memoryDeps),
    runtimeDeps,
  );
  registerOne(
    server,
    memoryShowHistorySpec.name,
    opts.descriptions[memoryShowHistorySpec.name] ?? memoryShowHistorySpec.name,
    memoryShowHistorySpec.inputSchema,
    memoryShowHistorySpec.outputSchema,
    (input) => memoryShowHistoryBody(input, memoryDeps),
    runtimeDeps,
  );
}
