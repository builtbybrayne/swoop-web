/**
 * Sales-memory loader — T3-4.
 *
 * Reads the active sales-memory set from the connector on every invocation
 * and assembles a STABLE, deterministic block for injection into the system
 * instruction. Implements decision sm-6.
 *
 * Design constraints (from 02-impl-sales-memory.md §2.5 + 03-exec-t4):
 *
 * 1. CONNECTOR PATH ONLY — calls `memory_list_active` via the ConnectorClient.
 *    MUST NOT query Postgres directly from the orchestrator (decision E.11:
 *    the connector owns the data + Postgres; the orchestrator is a consumer).
 *
 * 2. NO APP-LEVEL CACHE — the active set is read on every `loadSalesMemoryBlock`
 *    call. Because the store is the DB, every Cloud Run instance folds in a write
 *    on its next turn with zero per-instance cache to invalidate (sm-6).
 *
 * 3. BYTE-IDENTICAL between writes — the active set is rendered in a STABLE,
 *    deterministic order (same order the connector returns it: created_at DESC
 *    then id ASC as a tiebreak). Each memory is rendered with a fixed template.
 *    Between writes, the assembled text is byte-identical → the Anthropic prompt
 *    cache (cache_control: ephemeral on the system block in claude-llm.ts, Perf-1)
 *    keeps hitting. A write changes one row → the assembled text changes → exactly
 *    one cache-bust, then steady again.
 *
 * 4. AUTHORITATIVE FRAMING — the block carries a header marking these entries as
 *    current authoritative sales knowledge the agent MAY state as fact, NOT as
 *    illustrative shape-guidance (which is 00_why.md's reflex). Without this the
 *    agent hedges on the very facts we inject.
 *    NOTE: the header copy/voice is T3-5 (Alastair's editorial domain). This file
 *    ships a minimal TODO(T3-5) placeholder header that carries the STRUCTURAL
 *    signal (authoritative, dated) while leaving the final wording for T3-5.
 *
 * 5. TIMESTAMPS + AUTHOR in-block — each entry is rendered as:
 *      "(noted <YYYY-MM-DD> by <author>)"
 *    so the agent can weigh age against the per-turn dateline (B.t12 / B.poincare-1).
 *
 * sm-6, E.11, Perf-1.
 */

import { MemoryListActiveOutputSchema, messageOf } from '@swoop/common';
import type { SalesMemoryPublic } from '@swoop/common';
import type { ConnectorClient } from '../connector/client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The connector tool name for listing the active sales-memory set.
 * Matches `memoryListActiveSpec.name` in connector/src/tools/memory_list_active.ts.
 * Declared here rather than imported from memory-tools.ts to keep the loading
 * path free of the write-tools dependency — this module is read-only.
 */
const MEMORY_LIST_ACTIVE_TOOL = 'memory_list_active' as const;

/**
 * Separator used between the header and the memory entries in the block.
 * Fixed so the rendered text is deterministic.
 */
const BLOCK_SEPARATOR = '\n\n';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the active sales-memory set from the connector and render it as a
 * string block suitable for splicing into the system instruction.
 *
 * Returns an empty string when there are no active memories, so the
 * instruction is unchanged in that case (no dangling header).
 *
 * @param client  The connector MCP client. Called via `callTool` so no direct
 *                Postgres access is needed in the orchestrator (decision E.11).
 *
 * @throws        If the connector call fails or the response fails schema
 *                validation. Callers should catch and fall back to an empty
 *                block so a connector hiccup doesn't break every user turn.
 */
export async function loadSalesMemoryBlock(client: ConnectorClient, header: string): Promise<string> {
  const raw = await client.callTool(MEMORY_LIST_ACTIVE_TOOL, {});

  // Parse the connector response via the same schema used by the connector-side
  // handler. Throws on schema mismatch — caller decides fallback strategy.
  const parsed = parseMemoryListActiveResult(raw);

  return assembleMemoryBlock(parsed.memories, header);
}

// ---------------------------------------------------------------------------
// Assembly — deterministic, cache-stable
// ---------------------------------------------------------------------------

/**
 * Assemble the sales-memory block from a list of active memories.
 *
 * Exported for direct testing (no connector needed — just pass a fake list).
 *
 * ORDER: the connector returns memories in `created_at DESC, id ASC` order
 * (listActiveMemories in connector/src/data/sales-memory.ts). We preserve
 * that order here — do not sort again — so the rendered text is byte-identical
 * to what the previous call produced for the same DB state.
 *
 * If `memories` is empty, returns an empty string so nothing is appended to
 * the instruction (no dangling header + separator).
 */
export function assembleMemoryBlock(memories: readonly SalesMemoryPublic[], header: string): string {
  if (memories.length === 0) return '';

  const entries = memories
    .map((m) => renderMemoryEntry(m))
    .join('\n');

  return header + BLOCK_SEPARATOR + entries;
}

/**
 * Render one memory entry as a single line.
 *
 * Format: "- <content> (noted <YYYY-MM-DD> by <author>)"
 *
 * The date is truncated to YYYY-MM-DD (the ISO 8601 date portion of the
 * `updated_at` ISO string). This is stable: same ISO string → same date
 * prefix every time.
 */
export function renderMemoryEntry(memory: SalesMemoryPublic): string {
  const datePart = memory.updatedAt.slice(0, 10); // YYYY-MM-DD, always ASCII-stable
  return `- ${memory.content} (noted ${datePart} by ${memory.updatedBy})`;
}

// ---------------------------------------------------------------------------
// Connector response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the raw connector `CallToolRawResult` from `memory_list_active`.
 *
 * Tries `structuredContent` first (the MCP 2025-03 canonical path), then falls
 * back to parsing the first text content block as JSON (older connector shape).
 * Throws on parse failure with a clear message.
 */
function parseMemoryListActiveResult(
  raw: { structuredContent?: Record<string, unknown>; content?: ReadonlyArray<{ type: string; text?: string }> },
): import('@swoop/common').MemoryListActiveOutput {
  let candidate: unknown;

  if (raw.structuredContent && Object.keys(raw.structuredContent).length > 0) {
    candidate = raw.structuredContent;
  } else if (raw.content) {
    const textBlock = raw.content.find((b) => b.type === 'text' && typeof b.text === 'string');
    if (textBlock?.text) {
      try {
        candidate = JSON.parse(textBlock.text);
      } catch (err) {
        throw new Error(
          `[sales-memory-loader] Failed to parse connector text content as JSON: ${messageOf(err)}`,
        );
      }
    }
  }

  if (!candidate) {
    throw new Error(
      '[sales-memory-loader] memory_list_active returned no usable content (empty structuredContent and no text block).',
    );
  }

  // The connector returns an error envelope { ok: false, code, detail } when the
  // tool itself failed (e.g. the sales_memory table is missing, or a DB error).
  // Surface that real cause instead of validating the envelope against the
  // success schema and emitting a confusing "Unrecognized key 'ok'" message.
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'ok' in candidate &&
    (candidate as { ok: unknown }).ok === false
  ) {
    const env = candidate as { code?: unknown; detail?: unknown };
    const detail = typeof env.detail === 'string' ? env.detail : undefined;
    const code = typeof env.code === 'string' ? env.code : undefined;
    throw new Error(
      `[sales-memory-loader] memory_list_active failed on the connector: ${detail ?? code ?? 'unknown error'}`,
    );
  }

  const result = MemoryListActiveOutputSchema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(
      `[sales-memory-loader] memory_list_active response failed schema validation: ${issues}`,
    );
  }

  return result.data;
}
