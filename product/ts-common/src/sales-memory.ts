// -----------------------------------------------------------------------------
// Sales-memory schemas — SM.t1
//
// Three shapes:
//   SalesMemoryRowSchema      — the full DB row as stored in `sales_memory`.
//   SalesMemoryPublicSchema   — the loaded / agent-visible shape (content +
//                               provenance metadata). No internal fields.
//   SalesMemoryVersionRowSchema — one row from `sales_memory_version` (audit log).
//
// MCP tool I/O schemas:
//   MemoryStoreInputSchema / MemoryStoreOutputSchema    — store (create)
//   MemoryEditInputSchema  / MemoryEditOutputSchema     — edit (bump version)
//   MemoryRetireInputSchema / MemoryRetireOutputSchema  — retire (soft-delete)
//   MemoryListActiveInputSchema / MemoryListActiveOutputSchema — list active
//   MemoryShowHistoryInputSchema / MemoryShowHistoryOutputSchema — version history
//
// No embeddings, no pgvector. Memories are a small curated list loaded whole.
// Auth token enforcement seam: tool I/O schemas carry `staffToken` on every
// mutating tool; the connector-side handler enforces presence.
// TODO(sm-t2-auth) — a separate task wires real token validation.
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// Status enum — shared by the row schema and list output.
// -----------------------------------------------------------------------------

export const SalesMemoryStatusSchema = z.enum(["active", "retired"]);
export type SalesMemoryStatus = z.infer<typeof SalesMemoryStatusSchema>;

// -----------------------------------------------------------------------------
// change_kind enum — all mutation types recorded in the version table.
// -----------------------------------------------------------------------------

export const SalesMemoryChangeKindSchema = z.enum([
  "create",
  "edit",
  "retire",
  "restore",
]);
export type SalesMemoryChangeKind = z.infer<typeof SalesMemoryChangeKindSchema>;

// -----------------------------------------------------------------------------
// SalesMemoryRowSchema — mirrors the `sales_memory` table exactly.
// Dates arrive as Date objects from `pg` when the column is TIMESTAMPTZ.
// -----------------------------------------------------------------------------

export const SalesMemoryRowSchema = z
  .object({
    id: z.string().uuid(),
    content: z.string().min(1),
    status: SalesMemoryStatusSchema,
    version: z.number().int().positive(),
    created_by: z.string().min(1),
    created_at: z.date(),
    updated_by: z.string().min(1),
    updated_at: z.date(),
  })
  .strict();
export type SalesMemoryRow = z.infer<typeof SalesMemoryRowSchema>;

// -----------------------------------------------------------------------------
// SalesMemoryPublicSchema — the shape exposed to a loading task / agent.
// camelCase; dates as ISO strings for JSON transport.
// -----------------------------------------------------------------------------

export const SalesMemoryPublicSchema = z
  .object({
    id: z.string().uuid(),
    content: z.string().min(1),
    updatedBy: z.string().min(1),
    updatedAt: z.string(), // ISO 8601
  })
  .strict();
export type SalesMemoryPublic = z.infer<typeof SalesMemoryPublicSchema>;

// -----------------------------------------------------------------------------
// SalesMemoryVersionRowSchema — one row from `sales_memory_version`.
// -----------------------------------------------------------------------------

export const SalesMemoryVersionRowSchema = z
  .object({
    id: z.string().uuid(),
    memory_id: z.string().uuid(),
    version: z.number().int().positive(),
    content: z.string().min(1),
    change_kind: SalesMemoryChangeKindSchema,
    author: z.string().min(1),
    created_at: z.date(),
  })
  .strict();
export type SalesMemoryVersionRow = z.infer<typeof SalesMemoryVersionRowSchema>;

// Public version shape (camelCase, date as ISO string)
export const SalesMemoryVersionPublicSchema = z
  .object({
    id: z.string().uuid(),
    memoryId: z.string().uuid(),
    version: z.number().int().positive(),
    content: z.string().min(1),
    changeKind: SalesMemoryChangeKindSchema,
    author: z.string().min(1),
    createdAt: z.string(), // ISO 8601
  })
  .strict();
export type SalesMemoryVersionPublic = z.infer<
  typeof SalesMemoryVersionPublicSchema
>;

// =============================================================================
// MCP tool I/O schemas
// =============================================================================

// -----------------------------------------------------------------------------
// memory_store — create a new memory entry.
// Requires a valid staff token (enforced connector-side; TODO sm-t2-auth).
// -----------------------------------------------------------------------------

export const MemoryStoreInputSchema = z
  .object({
    content: z.string().min(1).max(4000),
    author: z.string().min(1).describe("Staff member name or identifier"),
    /**
     * Staff identity token. Presence is required for any mutating tool.
     * The connector enforces this at the handler boundary.
     * TODO(sm-t2-auth): a separate task validates this against real tokens.
     */
    staffToken: z.string().min(1).optional(),
  })
  .strict();
export type MemoryStoreInput = z.infer<typeof MemoryStoreInputSchema>;

export const MemoryStoreOutputSchema = z
  .object({
    memory: SalesMemoryPublicSchema,
  })
  .strict();
export type MemoryStoreOutput = z.infer<typeof MemoryStoreOutputSchema>;

// -----------------------------------------------------------------------------
// memory_edit — edit an existing memory (bumps version, inserts version row).
// Optimistic concurrency: caller must supply the current version number.
// Requires a valid staff token (enforced connector-side; TODO sm-t2-auth).
// -----------------------------------------------------------------------------

export const MemoryEditInputSchema = z
  .object({
    id: z.string().uuid(),
    content: z.string().min(1).max(4000),
    /**
     * The version the caller believes is current. If the DB row has already
     * advanced beyond this, the write is rejected (optimistic concurrency).
     */
    expectedVersion: z.number().int().positive(),
    author: z.string().min(1).describe("Staff member name or identifier"),
    /** Staff identity token. TODO(sm-t2-auth) — enforced connector-side. */
    staffToken: z.string().min(1).optional(),
  })
  .strict();
export type MemoryEditInput = z.infer<typeof MemoryEditInputSchema>;

export const MemoryEditOutputSchema = z
  .object({
    memory: SalesMemoryPublicSchema,
  })
  .strict();
export type MemoryEditOutput = z.infer<typeof MemoryEditOutputSchema>;

// -----------------------------------------------------------------------------
// memory_retire — soft-delete: sets status='retired', appends version row.
// Requires a valid staff token (enforced connector-side; TODO sm-t2-auth).
// -----------------------------------------------------------------------------

export const MemoryRetireInputSchema = z
  .object({
    id: z.string().uuid(),
    author: z.string().min(1).describe("Staff member name or identifier"),
    /** Staff identity token. TODO(sm-t2-auth) — enforced connector-side. */
    staffToken: z.string().min(1).optional(),
  })
  .strict();
export type MemoryRetireInput = z.infer<typeof MemoryRetireInputSchema>;

export const MemoryRetireOutputSchema = z
  .object({
    id: z.string().uuid(),
    status: SalesMemoryStatusSchema,
  })
  .strict();
export type MemoryRetireOutput = z.infer<typeof MemoryRetireOutputSchema>;

// -----------------------------------------------------------------------------
// memory_list_active — list all active memories (for loading / review).
// Read-only; no staff token required.
// -----------------------------------------------------------------------------

export const MemoryListActiveInputSchema = z.object({}).strict();
export type MemoryListActiveInput = z.infer<typeof MemoryListActiveInputSchema>;

export const MemoryListActiveOutputSchema = z
  .object({
    memories: z.array(SalesMemoryPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryListActiveOutput = z.infer<
  typeof MemoryListActiveOutputSchema
>;

// -----------------------------------------------------------------------------
// memory_show_history — version history for a single memory entry.
// Read-only; no staff token required.
// -----------------------------------------------------------------------------

export const MemoryShowHistoryInputSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
export type MemoryShowHistoryInput = z.infer<
  typeof MemoryShowHistoryInputSchema
>;

export const MemoryShowHistoryOutputSchema = z
  .object({
    memoryId: z.string().uuid(),
    versions: z.array(SalesMemoryVersionPublicSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryShowHistoryOutput = z.infer<
  typeof MemoryShowHistoryOutputSchema
>;

// -----------------------------------------------------------------------------
// finish_memory — signal the Opus memory agent emits when memory work is done.
//
// The orchestrator watches for this tool call in the memory-agent turn stream
// and flips session.mode back to 'conversation'. The Opus agent is instructed
// to emit this when the staff member's turn is no longer a memory instruction.
//
// No body content needed — the signal itself is the message. The output carries
// a brief confirmation string the agent may echo in its handback turn.
//
// sm-3 (explicit handback). sm-9 (memory agent runs in a separate session and
// emits this into that session — the orchestrator intercepts via the translated
// stream before writing to the conversational session).
// -----------------------------------------------------------------------------

export const FinishMemoryInputSchema = z
  .object({
    /**
     * Optional brief summary of what was done, for the orchestrator's
     * confirmation to the staff member. Example: "Saved 1 new memory."
     * If omitted the orchestrator emits a generic "Memory session closed."
     */
    summary: z.string().max(200).optional(),
  })
  .strict();
export type FinishMemoryInput = z.infer<typeof FinishMemoryInputSchema>;

export const FinishMemoryOutputSchema = z
  .object({
    /** Always 'ok' — the orchestrator sets mode='conversation' before returning. */
    status: z.literal("ok"),
  })
  .strict();
export type FinishMemoryOutput = z.infer<typeof FinishMemoryOutputSchema>;
