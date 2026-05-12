/**
 * Production Anthropic Batches API adapter.
 *
 * Wraps `@anthropic-ai/sdk`'s `messages.batches` surface as a `BatchClient`.
 * Tests use a hand-rolled mock implementing the same interface (no SDK
 * required); production swaps this in.
 *
 * Per HITL Q4 ratification 2026-05-01: ALL classifier passes go through the
 * Batches API. 50% cost discount, up to 24h latency.
 *
 * Docs: https://docs.anthropic.com/en/docs/build-with-claude/batch-processing
 */

import type {
  BatchClient,
  BatchPollResult,
  BatchRequest,
  BatchResultEntry,
  BatchSubmitResult,
} from './haiku.js';
import { buildBatchPayload, parseSdkSuccessMessage } from './haiku.js';
import { zodToToolInputSchema } from './zod-to-json-schema.js';

/**
 * Minimal type for the SDK surface we use. We don't depend on the SDK
 * shape directly so we can run typecheck without `@anthropic-ai/sdk`
 * installed in this workspace; the `factory` argument provides the SDK
 * client at runtime.
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

interface BatchSdkResult {
  custom_id: string;
  result:
    | {
        type: 'succeeded';
        message: {
          content: Array<{ type: string; name?: string; input?: unknown }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      }
    | { type: 'errored'; error: { message?: string; type?: string } }
    | { type: 'canceled' }
    | { type: 'expired' };
}

export class AnthropicBatchClient implements BatchClient {
  /**
   * Calls route through Anthropic's Batches API, which applies the 50%
   * discount per the published pricing. The cost ledger keys discount
   * logic off this flag — see `CostLedger.recordHaiku(..., batched)`.
   */
  readonly isBatched = true;

  constructor(private readonly sdk: AnthropicBatchSdk) {}

  async submit(requests: ReadonlyArray<BatchRequest>): Promise<BatchSubmitResult> {
    const payloads = requests.map((r) => buildBatchPayload(r, zodToToolInputSchema(r.outputToolSchema)));
    const created = await this.sdk.messages.batches.create({ requests: payloads });
    return { batchId: created.id, count: requests.length };
  }

  async poll(batchId: string): Promise<BatchPollResult> {
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

  async fetchResults(batchId: string): Promise<BatchResultEntry[]> {
    const stream = await this.sdk.messages.batches.results(batchId);
    const out: BatchResultEntry[] = [];
    for await (const r of stream) {
      out.push(this.mapSdkResult(r));
    }
    return out;
  }

  private mapSdkResult(r: BatchSdkResult): BatchResultEntry {
    if (r.result.type === 'succeeded') {
      const parsed = parseSdkSuccessMessage(r.result.message);
      return {
        customId: r.custom_id,
        status: 'succeeded',
        output: parsed.output,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
      };
    }
    const errStr =
      r.result.type === 'errored'
        ? r.result.error.message ?? r.result.error.type ?? 'errored'
        : r.result.type;
    return {
      customId: r.custom_id,
      status: r.result.type as 'errored' | 'canceled' | 'expired',
      output: null,
      error: errStr,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

/**
 * Wait for a batch to finish, polling at the given interval. Returns the
 * final poll result. Aborts via the optional shouldAbort callback —
 * callers wire this to the cost-cap kill-switch.
 */
export async function waitForBatch(
  client: BatchClient,
  batchId: string,
  options: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    shouldAbort?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    log?: (msg: string) => void;
  } = {},
): Promise<BatchPollResult> {
  const pollInterval = options.pollIntervalMs ?? 30_000; // 30s default
  const maxWait = options.maxWaitMs ?? 24 * 60 * 60 * 1000; // 24h default
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = options.log ?? (() => {});
  const startedAt = Date.now();
  while (true) {
    const r = await client.poll(batchId);
    if (r.status === 'ended') return r;
    if (options.shouldAbort?.()) {
      throw new Error(`[enrich/batch] aborting wait for ${batchId} per kill-switch`);
    }
    if (Date.now() - startedAt > maxWait) {
      throw new Error(`[enrich/batch] timed out waiting for ${batchId} after ${maxWait}ms`);
    }
    log(
      `[enrich/batch] ${batchId} status=${r.status} succeeded=${r.counts.succeeded} processing=${r.counts.processing}; sleeping ${pollInterval}ms`,
    );
    await sleep(pollInterval);
  }
}
