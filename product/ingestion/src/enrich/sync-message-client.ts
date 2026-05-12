/**
 * Synchronous Anthropic `messages.create` adapter — dev iteration escape
 * hatch from HITL Q4 (decision C.47, plan `03-exec-c-t10.md`).
 *
 * Wraps `@anthropic-ai/sdk`'s `messages.create` surface as a `BatchClient`,
 * so classifier modules can swap between full-rate sync and discounted
 * batched runs without changing their call shape. Production keeps using
 * `AnthropicBatchClient`; this client is opt-in via the `--sync` CLI flag.
 *
 * Design notes:
 *
 * - **Bounded concurrency**: default 5 in-flight requests. Anthropic's
 *   default rate limit on Haiku 4.5 is generous and 5 keeps us well under
 *   the rate-limit fence during a dev loop. Configurable per instance.
 *
 * - **Retries**: per-request, 3 outer attempts at 1s / 2s / 4s with
 *   jitter on 429 / 5xx / network errors. This sits ON TOP of the
 *   Anthropic SDK's own built-in retries (which default to 2 retries
 *   on retryable errors as of 0.90.x). Combined worst-case attempt
 *   count is approximately (1 + outerRetries) * (1 + sdkRetries) ≈ 4 * 3
 *   ≈ 12 attempts, bounded.
 *
 *   Rationale for the redundant layer (per Al, 2026-05-12 ratification):
 *   dev iteration loops are the use case — failures that stall a 5-row
 *   smoke are more painful than the rare case of an over-retried request.
 *   The SDK passes idempotency keys on retries (since 0.20.x) so 5xx
 *   double-bill risk is negligible. Don't strip a layer out under "this
 *   looks redundant" — both layers earn their keep.
 *
 * - **Order preservation**: workers write into `results[i]` indexed by the
 *   request's input position, not push onto a shared array. fetchResults
 *   returns the entries in submit-order regardless of completion order.
 *
 * - **Error mapping**: a non-retryable error (or a retryable one whose
 *   retries are exhausted) becomes a `BatchResultEntry { status: 'errored',
 *   error: <message> }`. The whole submit doesn't fail; the affected entry
 *   surfaces individually so partial batches succeed.
 *
 * - **Cache**: `submit` runs everything synchronously and stashes the
 *   resolved entries in the in-memory `cache` keyed by `batchId`. `poll`
 *   and `fetchResults` are pure reads of that cache — no second SDK call.
 *
 * Test seam (mirrors anthropic-batch-client.ts): the SDK is injected via
 * the `AnthropicSyncSdk` interface. No `@anthropic-ai/sdk` typings at
 * compile time.
 */

import { randomUUID } from 'node:crypto';
import type {
  BatchClient,
  BatchPollResult,
  BatchRequest,
  BatchResultEntry,
  BatchSubmitResult,
} from './haiku.js';
import { buildBatchPayload, parseSdkSuccessMessage } from './haiku.js';
import { zodToToolInputSchema } from './zod-to-json-schema.js';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const DEFAULT_CONCURRENCY = 5;

/**
 * Minimal type for the SDK surface we use — the synchronous
 * `messages.create` path only. Same shape-agnostic pattern as
 * `anthropic-batch-client.ts` so this workspace doesn't need
 * `@anthropic-ai/sdk` typings at compile time.
 */
export interface AnthropicSyncSdk {
  messages: {
    create: (params: {
      model: string;
      max_tokens: number;
      temperature: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
      tools: Array<{ name: string; description: string; input_schema: object }>;
      tool_choice: { type: 'tool'; name: string };
    }) => Promise<{
      content: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export interface SyncMessageClientOptions {
  sdk: AnthropicSyncSdk;
  /** Max in-flight requests against the API. Default 5. */
  concurrency?: number;
  /** Inject for tests — defaults to Math.random. */
  random?: () => number;
  /** Inject for tests — defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Inject for tests — defaults to no-op. */
  log?: (msg: string) => void;
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // @anthropic-ai/sdk errors carry a `.status` field. Node fetch errors
  // bubble up with `code` (ECONNRESET, ETIMEDOUT, etc.).
  const e = err as { status?: number; code?: string; name?: string };
  if (typeof e.status === 'number') {
    return e.status === 429 || (e.status >= 500 && e.status < 600);
  }
  if (typeof e.code === 'string') {
    return (
      e.code === 'ECONNRESET' ||
      e.code === 'ETIMEDOUT' ||
      e.code === 'ECONNREFUSED' ||
      e.code === 'EAI_AGAIN'
    );
  }
  if (typeof e.name === 'string' && e.name === 'AbortError') {
    return true;
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export class SyncMessageClient implements BatchClient {
  /**
   * Sync calls hit the full-rate `messages.create` endpoint. The cost
   * ledger reads this flag in `recordHaiku(..., batched)` to apply (or
   * not apply) the 50% batch discount. Per C.47 / HITL 2026-05-12: false
   * here = full-rate accounting in the ledger.
   */
  readonly isBatched = false;

  private readonly sdk: AnthropicSyncSdk;
  private readonly concurrency: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;
  /** Internal: batchId → cached result entries. */
  private readonly cache: Map<string, BatchResultEntry[]> = new Map();

  constructor(options: SyncMessageClientOptions) {
    this.sdk = options.sdk;
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = options.log ?? (() => {});
  }

  async submit(requests: ReadonlyArray<BatchRequest>): Promise<BatchSubmitResult> {
    const batchId = `sync_${randomUUID().replaceAll('-', '_')}`;
    const results = await this.runWithConcurrency(requests);
    this.cache.set(batchId, results);
    return { batchId, count: requests.length };
  }

  async poll(batchId: string): Promise<BatchPollResult> {
    const results = this.cache.get(batchId);
    if (!results) {
      throw new Error(`SyncMessageClient: unknown batchId ${batchId}`);
    }
    let succeeded = 0;
    let errored = 0;
    for (const r of results) {
      if (r.status === 'succeeded') succeeded += 1;
      else errored += 1;
    }
    return {
      batchId,
      status: 'ended',
      endedAt: new Date(),
      counts: {
        processing: 0,
        succeeded,
        errored,
        canceled: 0,
        expired: 0,
      },
      resultsUrl: null,
    };
  }

  async fetchResults(batchId: string): Promise<BatchResultEntry[]> {
    const results = this.cache.get(batchId);
    if (!results) {
      throw new Error(`SyncMessageClient: unknown batchId ${batchId}`);
    }
    return results;
  }

  /**
   * Bounded-concurrency worker pool. Mirrors the cursor-pull pattern used
   * by the Voyage / Gemini embed batchers (`embedInBatches`) — N workers
   * read from a shared cursor, write results into a fixed-position array.
   */
  private async runWithConcurrency(
    reqs: ReadonlyArray<BatchRequest>,
  ): Promise<BatchResultEntry[]> {
    const results: BatchResultEntry[] = new Array(reqs.length);
    if (reqs.length === 0) return results;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = cursor++;
        if (i >= reqs.length) return;
        results[i] = await this.runOne(reqs[i]!);
      }
    };
    const workers = Array.from(
      { length: Math.min(this.concurrency, reqs.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  }

  private async runOne(req: BatchRequest): Promise<BatchResultEntry> {
    // Build the same params block the batch adapter would use — same
    // shape, same defaults, same tool-choice. The `custom_id` field is
    // ignored on the sync path; we keep `req.customId` directly for
    // the result envelope below.
    const payload = buildBatchPayload(req, zodToToolInputSchema(req.outputToolSchema));
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const message = await this.sdk.messages.create(payload.params);
        const parsed = parseSdkSuccessMessage(message);
        return {
          customId: req.customId,
          status: 'succeeded',
          output: parsed.output,
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
        };
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt === RETRY_DELAYS_MS.length) {
          break;
        }
        const baseDelay = RETRY_DELAYS_MS[attempt]!;
        // Jitter ±25%.
        const jitter = baseDelay * 0.5 * (this.random() - 0.5);
        const delay = Math.max(0, baseDelay + jitter);
        this.log(
          `[enrich/sync] retryable error on ${req.customId} (attempt ${attempt + 1}); sleeping ${Math.round(delay)}ms`,
        );
        await this.sleep(delay);
      }
    }
    return {
      customId: req.customId,
      status: 'errored',
      output: null,
      error: errorMessage(lastError),
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
