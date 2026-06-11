/**
 * ADK tool wrappers over the MCP connector client (B.t3 / B.t3a).
 *
 * For each Puma tool name, build a `FunctionTool` that:
 *
 *   1. Validates the LLM's proposed args against the matching
 *      `*InputSchema` from `@swoop/common` BEFORE hitting the network. Bad
 *      args → structured error returned to the agent (no exception thrown
 *      out of ADK's tool dispatch).
 *   2. Calls the connector via `ConnectorClient.callTool`.
 *   3. Validates the returned payload against the matching `*OutputSchema`.
 *      Schema drift on the connector side → structured error returned.
 *
 * Tool surface: the **eight intent-named tools** mapped to the five
 * conversational jobs (decisions C.24 + C.25):
 *
 *   find_inspiring   → Inspire           (find_someone_who → Mirror)
 *   find_proof       → Reassure          (lookup           → Inform)
 *   find_options     → Propose options
 *   illustrate       → Visual companion
 *   handoff          → Open lead-capture
 *   handoff_submit   → Submit lead       (NOT exposed to the model;
 *                                         called by the lead-capture widget
 *                                         directly via POST /handoff/submit)
 *
 * B.t3a (2026-05-02) replaced the librarian-shaped `search` / `get_detail`
 * pair the A.t2 stub seeded with the eight intent-named tools above. The
 * deprecated schemas were removed from `@swoop/common` in the same change.
 *
 * Tool descriptions: the SDK requires a description string at registration
 * time; the authoritative copy lives in `cms/prompts/tools/<tool>/
 * description.md` per G.11. The orchestrator's entrypoint loads each file
 * once at boot via `loadAllToolDescriptions` (re-exported from
 * `@swoop/connector`) and passes the resulting `ToolDescriptions` map into
 * `createConnectorTools`. Fail-fast on missing/empty files matches the
 * connector boot path.
 */

import { FunctionTool } from '@google/adk';
import type { Context } from '@google/adk';
import {
  FindInspiringInputSchema,
  FindInspiringOutputSchema,
  FindOptionsInputSchema,
  FindOptionsOutputSchema,
  FindProofInputSchema,
  FindProofOutputSchema,
  FindSomeoneWhoInputSchema,
  FindSomeoneWhoOutputSchema,
  FindTipsInputSchema,
  FindTipsOutputSchema,
  HandoffInputSchema,
  HandoffOutputSchema,
  HandoffSubmitInputSchema,
  HandoffSubmitOutputSchema,
  IllustrateInputSchema,
  IllustrateOutputSchema,
  LookupInputSchema,
  LookupOutputSchema,
  ShowOptionsInputSchema,
  ShowOptionsOutputSchema,
  TOOL_NAMES,
  defaultEmptySeenItems,
  mergeSeen,
  messageOf,
  type ToolName,
} from '@swoop/common';
import type { ToolDescriptions } from '@swoop/connector';
import { z } from 'zod';

import type { SessionStore } from '../session/index.js';
import type { ConnectorClient, CallToolRawResult } from './client.js';
import {
  computeExcludes,
  extractSeenDelta,
  mergeExcludesIntoInput,
} from './anti-repetition.js';

/**
 * Structured error the agent sees when the adapter refuses to proceed —
 * either because args don't validate, the output doesn't validate, or the
 * connector returned an MCP tool-level error.
 *
 * Shape is deliberately boring JSON so the LLM can pattern-match on `ok`.
 * (B.t5's translator turns this into text for the user if needed.)
 */
export interface ToolAdapterError {
  readonly ok: false;
  readonly error: {
    readonly kind: 'input_validation' | 'output_validation' | 'connector_error' | 'transport_error';
    readonly toolName: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

/**
 * Successful tool result. The `value` is whatever the matching OutputSchema
 * parsed — the agent consumes the parsed shape, not the raw MCP envelope.
 */
export interface ToolAdapterSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type ToolAdapterResult<T> = ToolAdapterSuccess<T> | ToolAdapterError;

/** Registration entry mapping a tool name to its Zod I/O schemas. */
interface ToolSpec {
  readonly name: ToolName;
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
  /**
   * Exposed to the conversational model? `handoff_submit` is internal-only —
   * the lead-capture widget POSTs to `/handoff/submit` directly; the agent
   * never sees this tool in its tool list.
   */
  readonly exposedToModel: boolean;
}

/**
 * Canonical spec table — the nine intent-named tools. Order here drives the
 * order in which tools land in the agent's `tools` array (diagnostic, not
 * semantic) and mirrors the connector's registration order. The
 * `exposedToModel` flag filters `handoff_submit` out of the model-facing
 * list.
 */
const TOOL_SPECS: ReadonlyArray<ToolSpec> = [
  {
    name: TOOL_NAMES.FindInspiring,
    inputSchema: FindInspiringInputSchema,
    outputSchema: FindInspiringOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.FindSomeoneWho,
    inputSchema: FindSomeoneWhoInputSchema,
    outputSchema: FindSomeoneWhoOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.FindProof,
    inputSchema: FindProofInputSchema,
    outputSchema: FindProofOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.Lookup,
    inputSchema: LookupInputSchema,
    outputSchema: LookupOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.FindOptions,
    inputSchema: FindOptionsInputSchema,
    outputSchema: FindOptionsOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.FindTips,
    inputSchema: FindTipsInputSchema,
    outputSchema: FindTipsOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.Illustrate,
    inputSchema: IllustrateInputSchema,
    outputSchema: IllustrateOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.Handoff,
    inputSchema: HandoffInputSchema,
    outputSchema: HandoffOutputSchema,
    exposedToModel: true,
  },
  {
    name: TOOL_NAMES.HandoffSubmit,
    inputSchema: HandoffSubmitInputSchema,
    outputSchema: HandoffSubmitOutputSchema,
    exposedToModel: false,
  },
  // Tenth tool — find/show split (C.goofy-goldstine-12, 2026-06-11).
  // Visitor-facing curation: full cards, grouped primary/also_interesting.
  {
    name: TOOL_NAMES.ShowOptions,
    inputSchema: ShowOptionsInputSchema,
    outputSchema: ShowOptionsOutputSchema,
    exposedToModel: true,
  },
];

export interface BuildConnectorToolsParams {
  readonly client: ConnectorClient;
  /**
   * Authoritative tool descriptions loaded from `cms/prompts/tools/<tool>/
   * description.md` at boot. Same fail-fast contract as the connector side.
   * The `ToolDescriptions` type is re-exported from `@swoop/connector`.
   */
  readonly descriptions: ToolDescriptions;
  /** Names the connector reported at startup. Used as a sanity check. */
  readonly discoveredNames: readonly string[];
  /**
   * Session store for anti-repetition. When supplied, the orchestrator
   * reads `seenItems` from session state before each tool call (computes
   * per-tool exclude args) and merges returned ids/URLs back into session
   * state after each successful call. Optional — when omitted (unit tests
   * that don't exercise dedup), tool calls behave exactly as before.
   *
   * Per planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
   */
  readonly sessionStore?: SessionStore;
}

/**
 * Build the `FunctionTool[]` passed into `LlmAgent.tools`.
 *
 * Only tools marked `exposedToModel` end up in the returned array. If the
 * connector reported a name we don't know about we log a one-liner (the
 * connector could ship tools ahead of the orchestrator schema), and if we
 * know a name the connector didn't report we log that too — but we keep the
 * tool wired up, because failing startup on a partial connector blocks
 * local dev.
 */
export function createConnectorTools({
  client,
  descriptions,
  discoveredNames,
  sessionStore,
}: BuildConnectorToolsParams): FunctionTool[] {
  warnOnMismatch(discoveredNames);

  return TOOL_SPECS.filter((spec) => spec.exposedToModel).map((spec) =>
    buildFunctionTool(client, spec, descriptions[spec.name], sessionStore),
  );
}

/**
 * Turn one spec into an ADK `FunctionTool`. The `parameters` Zod schema is
 * passed straight into `FunctionTool` so ADK generates the
 * `FunctionDeclaration` from it — no hand-maintained JSON Schema.
 *
 * Why the `as unknown as never` cast on `parameters`:
 *   `@google/adk@1.0.0` bundles its own `zod` in `node_modules/@google/adk/
 *   node_modules/zod/` for version stability. Our `@swoop/common` schemas
 *   are instances of the workspace-root `zod`. The two `ZodObject` classes
 *   are structurally identical but nominally distinct (TS complains about a
 *   mismatch in the private `_cached` field). Structural equivalence means
 *   the runtime is correct; the cast silences the nominal mismatch without
 *   duplicating the schema definitions. If ADK ever stops bundling zod, this
 *   cast becomes a no-op.
 */
function buildFunctionTool(
  client: ConnectorClient,
  spec: ToolSpec,
  description: string,
  sessionStore: SessionStore | undefined,
): FunctionTool {
  const parameters = spec.inputSchema as unknown as never;
  return new FunctionTool({
    name: spec.name,
    description,
    parameters,
    // ADK's FunctionTool execute callback receives the agent-supplied args
    // plus a `tool_context` carrying the active session id (per
    // `Context.sessionId` inherited from `ReadonlyContext`). When a
    // session store + context are both available, we use them to
    // auto-inject anti-repetition excludes and merge returned ids back.
    execute: async (input: unknown, toolContext?: Context) => {
      const sessionId = toolContext?.sessionId;
      return invokeTool(client, spec, input, {
        sessionStore,
        sessionId,
      });
    },
  });
}

/**
 * Optional anti-repetition deps. When both `sessionStore` and `sessionId`
 * are present, `invokeTool` brackets the connector call with a seen-set
 * read (compute excludes) and a post-success seen-set merge (mark shown).
 *
 * Per planning/03-exec-crosscut-anti-repetition.md (HITL-ratified 2026-05-27).
 */
export interface InvokeToolDeps {
  readonly sessionStore?: SessionStore;
  readonly sessionId?: string;
}

/**
 * Execute one tool call end-to-end. This is the function the agent turn loop
 * ultimately invokes (indirectly, through FunctionTool.runAsync).
 *
 * Returns a `ToolAdapterResult<unknown>` serialised as a plain object so ADK
 * passes it to the model as the tool response content.
 */
export async function invokeTool(
  client: ConnectorClient,
  spec: ToolSpec,
  input: unknown,
  deps: InvokeToolDeps = {},
): Promise<ToolAdapterResult<unknown>> {
  // 0. Anti-repetition (pre-dispatch). Read seen-set, compute per-tool
  //    excludes, merge into the agent-supplied input BEFORE schema
  //    validation so the validated input carries the orchestrator's
  //    additions. Stays a no-op when sessionStore / sessionId aren't both
  //    available (unit tests, utility tools).
  let augmentedInput: unknown = input;
  const antiRepActive =
    deps.sessionStore !== undefined && deps.sessionId !== undefined;
  if (antiRepActive) {
    try {
      const session = await deps.sessionStore!.get(deps.sessionId!);
      const seenItems = session?.seenItems ?? defaultEmptySeenItems();
      const autoExcludes = computeExcludes(spec.name, seenItems);
      if (autoExcludes) {
        const inputObj =
          input && typeof input === 'object'
            ? (input as Record<string, unknown>)
            : {};
        augmentedInput = mergeExcludesIntoInput(
          spec.name,
          inputObj,
          autoExcludes,
        );
      }
    } catch {
      // Read failure shouldn't block the tool call — fall through with the
      // unmodified input. The handler may repeat content this turn, but a
      // session-state read error must not become a tool-call error.
      augmentedInput = input;
    }
  }

  // 1. Input validation (before network).
  const parsedInput = spec.inputSchema.safeParse(augmentedInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: {
        kind: 'input_validation',
        toolName: spec.name,
        message: 'Tool arguments did not match the expected schema.',
        details: parsedInput.error.issues,
      },
    };
  }

  // 2. Call the connector. Transport-level retries live in the client; what
  //    surfaces here is either (a) success, (b) a non-retryable transport
  //    failure, (c) a tool-level `isError: true` envelope.
  let raw: CallToolRawResult;
  try {
    raw = await client.callTool(spec.name, parsedInput.data as Record<string, unknown>);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'transport_error',
        toolName: spec.name,
        message: messageOf(err),
      },
    };
  }

  // 3. Parse the connector envelope: distinguish tool-level errors
  //    (`isError: true`) from shape mismatches (safeParse fails) via
  //    `parseToolResult`.
  const parsed = parseToolResult(spec.name, spec.outputSchema, raw);
  if (!parsed.ok) {
    if (parsed.code === 'tool_error') {
      return {
        ok: false,
        error: {
          kind: 'connector_error',
          toolName: spec.name,
          message: parsed.detail,
          details: raw.structuredContent,
        },
      };
    }
    // Re-run safeParse on the same payload to surface the structured Zod
    // issues array as `details`. The helper returns `detail: string` per its
    // public contract; `ToolAdapterError.details` keeps the richer shape for
    // log + agent consumption.
    const issues = spec.outputSchema.safeParse(extractPayload(raw));
    return {
      ok: false,
      error: {
        kind: 'output_validation',
        toolName: spec.name,
        message: 'Connector response did not match the expected schema.',
        details: issues.success ? undefined : issues.error.issues,
      },
    };
  }

  // 4. Anti-repetition (post-success). Extract per-type ids/URLs from the
  //    validated result and merge into session state. Trip/tour rows are
  //    silently dropped by `extractSeenDelta` (carve-out). A merge failure
  //    is logged but never propagates — the tool call itself succeeded.
  if (antiRepActive) {
    try {
      const delta = extractSeenDelta(spec.name, parsed.value);
      const hasAnyDelta = Object.keys(delta).some(
        (k) => (delta[k as keyof typeof delta]?.length ?? 0) > 0,
      );
      if (hasAnyDelta) {
        await deps.sessionStore!.update(deps.sessionId!, (s) => ({
          ...s,
          seenItems: mergeSeen(s.seenItems, delta),
        }));
      }
    } catch (err) {
      // Diagnostic only — the tool call already succeeded. Future turns
      // may repeat content; live observation will tell us if this matters.
      console.warn(
        `[orchestrator] anti-repetition seen-set merge failed for tool ` +
          `"${spec.name}" (session=${deps.sessionId}): ${messageOf(err)}`,
      );
    }
  }

  return { ok: true, value: parsed.value };
}

/**
 * Parse one connector tool result against its output schema.
 *
 * Folds the two failure modes — connector-side `isError: true` envelopes
 * (`tool_error`) and schema mismatches against the output schema
 * (`shape_invalid`) — behind a single helper. Lives here (not in
 * `@swoop/common`) because it assumes the connector's specific
 * `CallToolRawResult` envelope shape; lifting it would over-couple the
 * shared package to MCP transport details.
 *
 * Returns the parsed value on success; structured `{ok: false, code, detail}`
 * on failure. Callers in `invokeTool` map `code` onto the richer
 * `ToolAdapterError` taxonomy.
 *
 * Cross-cut helper closed under H4 (planning/03-exec-crosscut-common-helpers-fix.md).
 */
export function parseToolResult<T>(
  toolName: string,
  schema: z.ZodType<T>,
  raw: unknown,
): { ok: true; value: T } | { ok: false; code: 'shape_invalid' | 'tool_error'; detail: string } {
  const envelope = raw as CallToolRawResult;
  if (envelope.isError === true) {
    return {
      ok: false,
      code: 'tool_error',
      detail: extractTextContent(envelope) ?? `Connector returned an error for tool "${toolName}".`,
    };
  }
  const payload = extractPayload(envelope);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, code: 'shape_invalid', detail: JSON.stringify(parsed.error.issues) };
  }
  return { ok: true, value: parsed.data };
}

function extractPayload(raw: CallToolRawResult): unknown {
  if (raw.structuredContent !== undefined) return raw.structuredContent;
  const text = extractTextContent(raw);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractTextContent(raw: CallToolRawResult): string | undefined {
  const block = raw.content?.find((c) => c.type === 'text' && typeof c.text === 'string');
  return block?.text;
}

function warnOnMismatch(discovered: readonly string[]): void {
  const known = new Set(TOOL_SPECS.map((s) => s.name));
  const discoveredSet = new Set(discovered);

  // These two warnings fire once at startup and describe schema drift
  // between the connector and the orchestrator. No event kind covers
  // startup-time capability negotiation (F-a's set is per-turn / per-tool-
  // call granularity), and a session id isn't in scope here. Keep as
  // diagnostic console lines rather than synthesise an event with a bogus
  // envelope — cleaner to spot in `npm run dev` output, and there's no
  // value in routing one-shot boot banners through Cloud Logging as
  // structured events.
  for (const name of discovered) {
    if (!known.has(name as ToolName)) {
      console.warn(
        `[connector] Connector reports tool "${name}" which the orchestrator has no schema for — ignoring.`,
      );
    }
  }
  for (const spec of TOOL_SPECS) {
    if (!discoveredSet.has(spec.name)) {
      console.warn(
        `[connector] Connector did not advertise "${spec.name}" at startup. Calls will fail until it does.`,
      );
    }
  }
}

// Re-exported for tests — not a public surface for callers.
export const __testing = {
  TOOL_SPECS,
  invokeTool,
};
