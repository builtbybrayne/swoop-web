/**
 * Vision batches client (BATCH-C.t6) — submits + polls + fetches results
 * from Anthropic's Message Batches API for the C.t6 image-annotation pass.
 *
 * Mirrors `product/ingestion/src/enrich/anthropic-batch-client.ts` (the
 * Haiku batches client built in C.t10). Differences:
 *
 *   - The Vision pipeline returns plain assistant text with a JSON object,
 *     not `tool_use` blocks. Result mapping extracts the first text block
 *     and hands the raw text to the runner, which already runs
 *     `parseAndValidate` against `ImageAnnotationOutputSchema` (one parsing
 *     path for both live + batch modes).
 *
 *   - The request shape is `BatchCreateParams.Request` from the SDK
 *     directly (assembled by `vision-client.ts:buildBatchRequest`), not the
 *     `BatchRequest` shape the Haiku client uses (which carries a Zod
 *     schema for tool-input narrowing).
 *
 * Decisions C.batch-1..3 in `planning/decisions.md`:
 *   - One parsing path for live + batch
 *   - Local interface (not pulled from `enrich/haiku.ts:BatchClient`)
 *   - Local copy of `waitForBatch` rather than shared helper (~15 lines)
 */

import type { BatchCreateParams } from '@anthropic-ai/sdk/resources/messages/batches.js';

/**
 * Minimal SDK surface we depend on. Same shape as the Haiku client's
 * `AnthropicBatchSdk` — keeping it local avoids cross-workspace imports
 * for type-shape we already trust here.
 */
export interface AnthropicBatchSdk {
  messages: {
    batches: {
      create: (params: { requests: object[] }) => Promise<{
        id: string;
        processing_status: string;
        request_counts?: BatchSdkCounts;
      }>;
      retrieve: (id: string) => Promise<{
        id: string;
        processing_status: string;
        ended_at?: string | null;
        request_counts?: BatchSdkCounts;
        results_url?: string | null;
      }>;
      results: (id: string) => Promise<AsyncIterable<BatchSdkResult>>;
    };
  };
}

interface BatchSdkCounts {
  processing?: number;
  succeeded?: number;
  errored?: number;
  canceled?: number;
  expired?: number;
}

export interface BatchSdkResult {
  custom_id: string;
  result:
    | {
        type: 'succeeded';
        message: {
          content: Array<{ type: string; text?: string; [k: string]: unknown }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      }
    | { type: 'errored'; error: { message?: string; type?: string } }
    | { type: 'canceled' }
    | { type: 'expired' };
}

export interface VisionBatchSubmitResult {
  batchId: string;
  /** Number of requests in the batch (for cost-ledger accounting). */
  count: number;
}

export interface VisionBatchPollResult {
  batchId: string;
  status: 'in_progress' | 'canceling' | 'ended';
  endedAt?: Date | null;
  counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  resultsUrl?: string | null;
}

export interface VisionBatchResultEntry {
  customId: string;
  status: 'succeeded' | 'errored' | 'canceled' | 'expired';
  /**
   * Raw assistant text for `succeeded` results; null for non-succeeded.
   * Caller runs `parseAndValidate` (in `run.ts`) on this text to validate
   * the JSON contract and extract annotation fields.
   */
  rawText: string | null;
  /** Operator-readable error string when status === 'errored'. */
  error?: string;
  inputTokens: number;
  outputTokens: number;
}

export interface VisionBatchClient {
  submit(
    requests: ReadonlyArray<BatchCreateParams.Request>,
  ): Promise<VisionBatchSubmitResult>;
  poll(batchId: string): Promise<VisionBatchPollResult>;
  fetchResults(batchId: string): Promise<VisionBatchResultEntry[]>;
}

export class AnthropicVisionBatchClient implements VisionBatchClient {
  constructor(private readonly sdk: AnthropicBatchSdk) {}

  async submit(
    requests: ReadonlyArray<BatchCreateParams.Request>,
  ): Promise<VisionBatchSubmitResult> {
    const created = await this.sdk.messages.batches.create({
      // The SDK accepts the same request shape `vision-client.ts:buildBatchRequest`
      // produces — cast through `unknown` because the SDK's `requests` type
      // is the parameterised generic and our narrow `object[]` is the runtime
      // shape that actually goes on the wire.
      requests: requests as unknown as object[],
    });
    return { batchId: created.id, count: requests.length };
  }

  async poll(batchId: string): Promise<VisionBatchPollResult> {
    const r = await this.sdk.messages.batches.retrieve(batchId);
    const counts = r.request_counts ?? {};
    const status =
      r.processing_status === 'in_progress'
        ? 'in_progress'
        : r.processing_status === 'canceling'
          ? 'canceling'
          : 'ended';
    return {
      batchId: r.id,
      status,
      endedAt: r.ended_at ? new Date(r.ended_at) : null,
      counts: {
        processing: counts.processing ?? 0,
        succeeded: counts.succeeded ?? 0,
        errored: counts.errored ?? 0,
        canceled: counts.canceled ?? 0,
        expired: counts.expired ?? 0,
      },
      resultsUrl: r.results_url ?? null,
    };
  }

  async fetchResults(batchId: string): Promise<VisionBatchResultEntry[]> {
    const stream = await this.sdk.messages.batches.results(batchId);
    const out: VisionBatchResultEntry[] = [];
    for await (const r of stream) {
      out.push(this.mapSdkResult(r));
    }
    return out;
  }

  private mapSdkResult(r: BatchSdkResult): VisionBatchResultEntry {
    if (r.result.type === 'succeeded') {
      const text = extractAssistantText(r.result.message.content);
      const usage = r.result.message.usage ?? {};
      return {
        customId: r.custom_id,
        status: 'succeeded',
        rawText: text,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
      };
    }
    const errStr =
      r.result.type === 'errored'
        ? r.result.error.message ?? r.result.error.type ?? 'errored'
        : r.result.type;
    return {
      customId: r.custom_id,
      status: r.result.type,
      rawText: null,
      error: errStr,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

/**
 * Build a real Anthropic SDK client and adapt it to the `AnthropicBatchSdk`
 * shape. Wrapped here so tests never construct a real client; production
 * code calls this once at runtime.
 *
 * The runtime SDK exposes `client.messages.batches.{create,retrieve,results}`
 * directly. We thread the cast at this boundary so the rest of the module
 * works against the narrow `AnthropicBatchSdk` type.
 */
export function adaptVisionSdkForBatches(
  rawClient: unknown,
): AnthropicBatchSdk | null {
  const batches = (rawClient as {
    messages?: { batches?: { create?: unknown; retrieve?: unknown; results?: unknown } };
  })?.messages?.batches;
  if (
    !batches ||
    typeof batches.create !== 'function' ||
    typeof batches.retrieve !== 'function' ||
    typeof batches.results !== 'function'
  ) {
    return null;
  }
  return rawClient as AnthropicBatchSdk;
}

/**
 * Wait for a batch to finish, polling at `pollIntervalMs` (default 30s).
 * Aborts via `shouldAbort` callback (callers wire this to the runner's
 * cancellation signal). Throws on timeout (default 24h — Anthropic's
 * published Batches API SLA upper bound).
 *
 * Local copy of `product/ingestion/src/enrich/anthropic-batch-client.ts:waitForBatch`
 * rather than a shared helper — decision C.batch-3 (allows independent
 * tuning of poll intervals + log prefixes for the Vision pass).
 */
export async function waitForVisionBatch(
  client: VisionBatchClient,
  batchId: string,
  options: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    shouldAbort?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    log?: (msg: string) => void;
  } = {},
): Promise<VisionBatchPollResult> {
  const pollInterval = options.pollIntervalMs ?? 30_000; // 30s default
  const maxWait = options.maxWaitMs ?? 24 * 60 * 60 * 1000; // 24h default
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = options.log ?? (() => {});
  const startedAt = Date.now();
  while (true) {
    const r = await client.poll(batchId);
    if (r.status === 'ended') return r;
    if (options.shouldAbort?.()) {
      throw new Error(
        `[annotate/batch] aborting wait for ${batchId} per kill-switch`,
      );
    }
    if (Date.now() - startedAt > maxWait) {
      throw new Error(
        `[annotate/batch] timed out waiting for ${batchId} after ${maxWait}ms`,
      );
    }
    log(
      `[annotate/batch] ${batchId} status=${r.status} succeeded=${r.counts.succeeded} processing=${r.counts.processing}; sleeping ${pollInterval}ms`,
    );
    await sleep(pollInterval);
  }
}

/**
 * Pull the first non-empty text block out of the response content array.
 * Shared logic with `vision-client.ts:extractAssistantText` but inlined
 * here to keep this file self-contained (the test mocks rely on this
 * extraction being purely local).
 */
function extractAssistantText(
  blocks: Array<{ type: string; text?: string; [k: string]: unknown }>,
): string | null {
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}
