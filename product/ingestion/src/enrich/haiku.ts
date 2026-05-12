/**
 * Anthropic Haiku 4.5 client — wraps the Message Batches API.
 *
 * Per HITL Q4 ratification 2026-05-01: ALL classifier passes go through
 * the Batches API for the 50% cost discount. Up to 24h latency acceptable
 * for ETL.
 *
 * Docs: https://docs.anthropic.com/en/docs/build-with-claude/batch-processing
 *
 * Lifecycle:
 *   1. submitBatch(requests) → batchId
 *   2. pollBatch(batchId) until processing_status === 'ended'
 *   3. fetchResults(resultsUrl) → per-request results streamed back
 *
 * Failure modes:
 *   - Schema-violation per request: result has `errored` status; caller
 *     decides retry-once-then-fail per the plan §"Open Q11".
 *   - Whole-batch failure: SDK throws; caller surfaces.
 *   - Partial results: per-request status surfaces via `succeeded` /
 *     `errored` / `expired` / `canceled`.
 *
 * Test seam: callers inject a mock client implementing `BatchClient`. The
 * production implementation uses `@anthropic-ai/sdk`'s `messages.batches`
 * surface. We keep the interface narrow so tests don't have to mock the
 * whole SDK.
 *
 * Plan: planning/03-exec-c-t3a.md §"Outputs — haiku.ts" + §"D. Haiku
 * classifier passes".
 */

import type { ZodTypeAny } from 'zod';

export const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * One unit of work for a batch — corresponds to one model call. The
 * `customId` lets the caller correlate results back to source rows.
 */
export interface BatchRequest {
  customId: string;
  systemPrompt: string;
  userMessage: string;
  /** Tool use for structured output. The classifier names ONE tool whose
   * input_schema is the Zod schema (converted to JSON Schema). The model
   * must respond with a tool_use block. */
  outputToolName: string;
  outputToolDescription: string;
  outputToolSchema: ZodTypeAny;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface BatchSubmitResult {
  batchId: string;
  /** Total number of requests in the batch (for cost-ledger accounting). */
  count: number;
}

export interface BatchPollResult {
  batchId: string;
  status: 'in_progress' | 'canceling' | 'ended';
  endedAt?: Date | null;
  /** Per-request tally returned by the API. */
  counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  /** URL where individual results can be fetched once status === 'ended'. */
  resultsUrl?: string | null;
}

export interface BatchResultEntry {
  customId: string;
  status: 'succeeded' | 'errored' | 'canceled' | 'expired';
  /** Parsed structured output from the model's tool_use block; null if errored. */
  output: unknown | null;
  /** Raw error string when status === 'errored'. */
  error?: string;
  /** Token usage for the cost ledger. */
  inputTokens: number;
  outputTokens: number;
}

export interface BatchClient {
  submit(requests: ReadonlyArray<BatchRequest>): Promise<BatchSubmitResult>;
  poll(batchId: string): Promise<BatchPollResult>;
  fetchResults(batchId: string): Promise<BatchResultEntry[]>;
}

/**
 * Convert a Zod schema to a draft-2020-12-compatible JSON Schema for use as
 * an Anthropic tool input_schema. Mirrors the orchestrator's normalisation
 * in `claude-llm.ts` — Zod's stock JSON Schema output is OpenAPI-flavoured,
 * which Anthropic rejects.
 *
 * Pulled here as a small standalone helper rather than imported from the
 * orchestrator, keeping the workspace boundary clean (per the plan
 * §"haiku.ts" — does not import from orchestrator).
 *
 * The full Zod→JSON-Schema conversion is mature in the wider ecosystem
 * (zod-to-json-schema, etc.). We pick the shape we need for classifier
 * outputs: object with primitive + array fields. If a future classifier
 * wants more shapes (oneOf, anyOf), upgrade here.
 */
export { zodToToolInputSchema } from './zod-to-json-schema.js';

/**
 * Build a BatchRequest's payload portion for submission. Used by both the
 * production SDK adapter and the test mock — keeping the construction in
 * one place avoids drift.
 *
 * SyncMessageClient (C.t10) reuses this exact `params` block as the argument
 * to `messages.create`, so the request shape is identical between the
 * batch and sync paths. The `custom_id` envelope is batch-only.
 */
export function buildBatchPayload(req: BatchRequest, jsonSchema: object): {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    temperature: number;
    system: string;
    messages: Array<{ role: 'user'; content: string }>;
    tools: Array<{ name: string; description: string; input_schema: object }>;
    tool_choice: { type: 'tool'; name: string };
  };
} {
  return {
    custom_id: req.customId,
    params: {
      model: req.model ?? DEFAULT_HAIKU_MODEL,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.0,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userMessage }],
      tools: [
        {
          name: req.outputToolName,
          description: req.outputToolDescription,
          input_schema: jsonSchema,
        },
      ],
      tool_choice: { type: 'tool', name: req.outputToolName },
    },
  };
}

/**
 * Parse a successful Anthropic Messages-API response into the shape the
 * `BatchResultEntry` carries — the tool_use input + token usage. Extracted
 * here (C.t10) so the batch adapter (`AnthropicBatchClient.mapSdkResult`)
 * and the sync adapter (`SyncMessageClient`) share one parser.
 *
 * The caller wraps this output in a `BatchResultEntry` with the right
 * `customId` and `status: 'succeeded'`.
 */
export function parseSdkSuccessMessage(message: {
  content: Array<{ type: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}): { output: unknown | null; inputTokens: number; outputTokens: number } {
  const toolUse = (message.content ?? []).find((c) => c.type === 'tool_use');
  const usage = message.usage ?? {};
  return {
    output: toolUse?.input ?? null,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}
