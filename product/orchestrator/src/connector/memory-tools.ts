/**
 * Memory CRUD FunctionTools for the Opus memory agent (T3-3 / sm-1).
 *
 * These tools are the orchestrator-side wrappers over the connector's five
 * memory endpoints. They are ONLY exposed to the Opus memory agent — they
 * MUST NEVER be added to the conversational agent's TOOL_SPECS.
 *
 * Why separate from tools.ts:
 *   - The conversational-agent tools (tools.ts / TOOL_SPECS) are the visitor
 *     surface — they must remain byte-identical for staff and visitor sessions.
 *   - These tools carry a bound staffToken + staffName (per-session values
 *     threaded in at agent-build time). Keeping them in a separate builder
 *     function avoids any risk of accidental exposure to the Sonnet agent.
 *   - sm-4 (server-side only tool gating): the connector rejects any mutation
 *     without a valid staff token, but the orchestrator layer provides a
 *     second backstop by never registering these tools for visitor sessions.
 *
 * Smoke-test path:
 *   The connector is the real MCP server. In the T3-3 smoke test the
 *   connector's memory tools are called with a valid staff token (obtained via
 *   the shared-password auth flow). The DB operations hit in-memory stubs —
 *   no real Postgres during the smoke.
 *
 * sm-1: memory management runs on a separate Opus agent.
 * sm-4: tool gating is server-side only; connector hard-rejects unauth'd mutates.
 * T3-3: this file is part of the two-agent routing + memory agent build.
 */

import { FunctionTool } from '@google/adk';
import {
  MemoryStoreInputSchema,
  MemoryStoreOutputSchema,
  MemoryEditInputSchema,
  MemoryEditOutputSchema,
  MemoryRetireInputSchema,
  MemoryRetireOutputSchema,
  MemoryListActiveInputSchema,
  MemoryListActiveOutputSchema,
  MemoryShowHistoryInputSchema,
  MemoryShowHistoryOutputSchema,
  messageOf,
} from '@swoop/common';
import { z } from 'zod';

import type { ConnectorClient } from './client.js';
import { parseToolResult } from './tools.js';

// ---------------------------------------------------------------------------
// Memory tool names — literal constants so nothing goes out of sync with what
// the connector registers.
// ---------------------------------------------------------------------------

export const MEMORY_TOOL_NAMES = {
  MemoryStore: 'memory_store',
  MemoryEdit: 'memory_edit',
  MemoryRetire: 'memory_retire',
  MemoryListActive: 'memory_list_active',
  MemoryShowHistory: 'memory_show_history',
} as const;

export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[keyof typeof MEMORY_TOOL_NAMES];

// ---------------------------------------------------------------------------
// Spec table — mirrors the connector-side memory handler specs.
// ---------------------------------------------------------------------------

interface MemoryToolSpec {
  readonly name: MemoryToolName;
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
}

const MEMORY_TOOL_SPECS: ReadonlyArray<MemoryToolSpec> = [
  {
    name: MEMORY_TOOL_NAMES.MemoryStore,
    inputSchema: MemoryStoreInputSchema,
    outputSchema: MemoryStoreOutputSchema,
  },
  {
    name: MEMORY_TOOL_NAMES.MemoryEdit,
    inputSchema: MemoryEditInputSchema,
    outputSchema: MemoryEditOutputSchema,
  },
  {
    name: MEMORY_TOOL_NAMES.MemoryRetire,
    inputSchema: MemoryRetireInputSchema,
    outputSchema: MemoryRetireOutputSchema,
  },
  {
    name: MEMORY_TOOL_NAMES.MemoryListActive,
    inputSchema: MemoryListActiveInputSchema,
    outputSchema: MemoryListActiveOutputSchema,
  },
  {
    name: MEMORY_TOOL_NAMES.MemoryShowHistory,
    inputSchema: MemoryShowHistoryInputSchema,
    outputSchema: MemoryShowHistoryOutputSchema,
  },
];

// ---------------------------------------------------------------------------
// Builder params.
// ---------------------------------------------------------------------------

export interface BuildMemoryToolsParams {
  /** The connector client shared with the conversational agent. */
  readonly client: ConnectorClient;
  /**
   * Staff JWT token validated by the orchestrator before entering memory mode.
   * Threaded through to every mutating tool call (sm-4 dual backstop — the
   * connector is the primary gate; this binding ensures the token is always
   * present without the agent needing to construct it).
   */
  readonly staffToken: string;
  /**
   * Staff member's name (from JWT `name` claim). Used as the `author` field
   * on memory mutations so every record carries attribution.
   */
  readonly staffName: string;
  /**
   * Tool descriptions loaded from cms/prompts/memory/tools/<name>.md.
   * Keyed by tool name; used as the FunctionTool description for each memory tool.
   */
  readonly toolDescriptions: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Builder.
// ---------------------------------------------------------------------------

/**
 * Build the five memory CRUD FunctionTools bound to this staff session.
 *
 * Called once when the orchestrator first enters memory mode (chat handler
 * detects `session.staff === true && session.mode === 'memory'`). The
 * returned tools are wired into the Opus memory agent exclusively — they
 * never reach the conversational Sonnet agent.
 *
 * Token + name binding:
 *   The `staffToken` and `staffName` are closed over in each tool's execute
 *   callback. The agent supplies content/id/expectedVersion; this layer
 *   auto-injects the token + attribution so the agent cannot omit them.
 *   sm-4 dual backstop: the connector still validates the token independently.
 */
export function buildMemoryTools({
  client,
  staffToken,
  staffName,
  toolDescriptions,
}: BuildMemoryToolsParams): FunctionTool[] {
  return MEMORY_TOOL_SPECS.map((spec) => buildOneTool(client, spec, staffToken, staffName, toolDescriptions));
}

function buildOneTool(
  client: ConnectorClient,
  spec: MemoryToolSpec,
  staffToken: string,
  staffName: string,
  toolDescriptions: Readonly<Record<string, string>>,
): FunctionTool {
  // Agent-facing parameter schema: STRIP the auto-injected identity fields
  // (`author`, `staffToken`). The execute callback fills them from the validated
  // session (author = JWT name, token = session token), so the agent must
  // neither see them nor be asked for them — otherwise it prompts the staff
  // member for an "author" instead of saving (observed in the T3-3 live smoke,
  // 2026-06-17). Read-only tools have no such fields and pass through unchanged.
  const obj = spec.inputSchema as z.ZodObject<z.ZodRawShape>;
  const omitMask: Record<string, true> = {};
  if (obj.shape && 'author' in obj.shape) omitMask.author = true;
  if (obj.shape && 'staffToken' in obj.shape) omitMask.staffToken = true;
  const agentSchema =
    Object.keys(omitMask).length > 0 ? obj.omit(omitMask as never) : spec.inputSchema;
  const parameters = agentSchema as unknown as never;

  return new FunctionTool({
    name: spec.name,
    description: toolDescriptions[spec.name] ?? spec.name,
    parameters,
    execute: async (rawInput: unknown) => {
      // Auto-inject token + name ONLY into tools whose input schema actually
      // carries these fields (the mutating tools). The read-only tools
      // (memory_list_active, memory_show_history) use z.object({}).strict(),
      // which REJECTS unknown keys — .strict() does NOT strip them (that wrong
      // assumption was the bug: injecting unconditionally made every read-tool
      // call fail orchestrator-side input validation, observed live 2026-06-19).
      // `omitMask` (above) already records which of these fields this tool has.
      const augmented: Record<string, unknown> =
        rawInput && typeof rawInput === 'object'
          ? { ...(rawInput as Record<string, unknown>) }
          : {};
      if (omitMask.staffToken) augmented.staffToken = staffToken;
      if (omitMask.author) augmented.author = staffName;

      // Input validation (orchestrator-side, before network).
      const parsedInput = spec.inputSchema.safeParse(augmented);
      if (!parsedInput.success) {
        return {
          ok: false,
          error: {
            kind: 'input_validation',
            toolName: spec.name,
            message: 'Memory tool arguments did not match the expected schema.',
            details: parsedInput.error.issues,
          },
        };
      }

      // Call the connector.
      let raw;
      try {
        raw = await client.callTool(
          spec.name,
          parsedInput.data as Record<string, unknown>,
        );
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

      // Parse the connector response against the output schema.
      const parsed = parseToolResult(spec.name, spec.outputSchema, raw);
      if (!parsed.ok) {
        return {
          ok: false,
          error: {
            kind: parsed.code === 'tool_error' ? 'connector_error' : 'output_validation',
            toolName: spec.name,
            message: parsed.detail,
          },
        };
      }

      return { ok: true, value: parsed.value };
    },
  });
}
