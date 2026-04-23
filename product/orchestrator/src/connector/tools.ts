/**
 * ADK tool wrappers over the MCP connector client (B.t3).
 *
 * For each Puma tool name declared in `@swoop/common` TOOL_DESCRIPTIONS, build
 * a `FunctionTool` that:
 *
 *   1. Validates the LLM's proposed args against the matching
 *      `*InputSchema` from `@swoop/common` BEFORE hitting the network. Bad
 *      args → structured error returned to the agent (no exception thrown
 *      out of ADK's tool dispatch).
 *   2. Calls the connector via `ConnectorClient.callTool`.
 *   3. Validates the returned payload against the matching `*OutputSchema`.
 *      Schema drift on the connector side → structured error returned.
 *
 * Tool descriptions are carried verbatim from `TOOL_DESCRIPTIONS` — chunk G
 * owns that copy. Do not paraphrase here (planning/03-exec-agent-runtime-t3.md
 * "Key implementation notes" 1).
 *
 * `handoff_submit` is listed in TOOL_DESCRIPTIONS for contract completeness
 * but is NOT exposed to the model — it's called by the lead-capture widget
 * directly (see ts-common/src/tools.ts comment). We still wrap it so the
 * widget's eventual integration has a single place to borrow the validation;
 * agent registration is filtered in `createConnectorTools`.
 */

import { FunctionTool } from '@google/adk';
import {
  GetDetailInputSchema,
  GetDetailOutputSchema,
  HandoffInputSchema,
  HandoffOutputSchema,
  HandoffSubmitInputSchema,
  HandoffSubmitOutputSchema,
  IllustrateInputSchema,
  IllustrateOutputSchema,
  SearchInputSchema,
  SearchOutputSchema,
  TOOL_DESCRIPTIONS,
  type ToolName,
} from '@swoop/common';
import { z } from 'zod';

import type { ConnectorClient, CallToolRawResult } from './client.js';

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
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
  /**
   * Exposed to the conversational model? `handoff_submit` is internal-only;
   * see module docstring.
   */
  readonly exposedToModel: boolean;
}

/**
 * Canonical spec table. One row per Puma tool; order here drives the order in
 * which tools land in the agent's `tools` array (diagnostic, not semantic).
 */
const TOOL_SPECS: ReadonlyArray<ToolSpec> = [
  {
    name: 'search',
    description: TOOL_DESCRIPTIONS.search,
    inputSchema: SearchInputSchema,
    outputSchema: SearchOutputSchema,
    exposedToModel: true,
  },
  {
    name: 'get_detail',
    description: TOOL_DESCRIPTIONS.get_detail,
    inputSchema: GetDetailInputSchema,
    outputSchema: GetDetailOutputSchema,
    exposedToModel: true,
  },
  {
    name: 'illustrate',
    description: TOOL_DESCRIPTIONS.illustrate,
    inputSchema: IllustrateInputSchema,
    outputSchema: IllustrateOutputSchema,
    exposedToModel: true,
  },
  {
    name: 'handoff',
    description: TOOL_DESCRIPTIONS.handoff,
    inputSchema: HandoffInputSchema,
    outputSchema: HandoffOutputSchema,
    exposedToModel: true,
  },
  {
    name: 'handoff_submit',
    description: TOOL_DESCRIPTIONS.handoff_submit,
    inputSchema: HandoffSubmitInputSchema,
    outputSchema: HandoffSubmitOutputSchema,
    exposedToModel: false,
  },
];

export interface BuildConnectorToolsParams {
  readonly client: ConnectorClient;
  /** Names the connector reported at startup. Used as a sanity check. */
  readonly discoveredNames: readonly string[];
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
  discoveredNames,
}: BuildConnectorToolsParams): FunctionTool[] {
  warnOnMismatch(discoveredNames);

  return TOOL_SPECS.filter((spec) => spec.exposedToModel).map((spec) => buildFunctionTool(client, spec));
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
function buildFunctionTool(client: ConnectorClient, spec: ToolSpec): FunctionTool {
  const parameters = spec.inputSchema as unknown as never;
  return new FunctionTool({
    name: spec.name,
    description: spec.description,
    parameters,
    execute: async (input: unknown) => {
      return invokeTool(client, spec, input);
    },
  });
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
): Promise<ToolAdapterResult<unknown>> {
  // 1. Input validation (before network).
  const parsedInput = spec.inputSchema.safeParse(input);
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
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (raw.isError === true) {
    return {
      ok: false,
      error: {
        kind: 'connector_error',
        toolName: spec.name,
        message: extractTextContent(raw) ?? `Connector returned an error for tool "${spec.name}".`,
        details: raw.structuredContent,
      },
    };
  }

  // 3. Output validation (after network). Prefer `structuredContent` — the
  //    MCP SDK populates it when the tool declared an `outputSchema`. Fall
  //    back to parsing the first JSON text block, which is how the PoC
  //    connector shapes its responses.
  const payload = extractPayload(raw);
  const parsedOutput = spec.outputSchema.safeParse(payload);
  if (!parsedOutput.success) {
    return {
      ok: false,
      error: {
        kind: 'output_validation',
        toolName: spec.name,
        message: 'Connector response did not match the expected schema.',
        details: parsedOutput.error.issues,
      },
    };
  }

  return { ok: true, value: parsedOutput.data };
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
