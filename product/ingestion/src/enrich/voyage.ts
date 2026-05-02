/**
 * Voyage-3 embedding HTTP client.
 *
 * Locked to `voyage-3` / 1024d per decision C.18. Plan: planning/03-exec-c-t3a.md
 * §"Outputs — voyage.ts" + §"Sub-pass design — Per-source-row embedding".
 *
 * Why a thin local HTTP client and not the `voyageai` SDK?
 *   - The SDK is a Python-first library; the JS surface is thin and inconsistent.
 *   - Voyage's REST API is one POST with two query types (`document` /
 *     `query`). A 60-line fetch wrapper covers it cleanly + makes retries +
 *     batch behaviour observable.
 *   - Avoiding the SDK keeps the dep graph lean (one fewer transitive tree)
 *     and tests trivially mockable via the `fetcher` injection.
 *
 * Behaviour:
 *   - Batched (default 128 docs per call — HITL Q4 in the plan recommends
 *     128 over 256, conservative on rate limits + memory).
 *   - Retries: exponential backoff on 429 / 5xx / network — 3 attempts at
 *     1s / 2s / 4s + jitter. Plan §"voyage.ts" pins this shape.
 *   - Returns one EmbeddingResult per input, in order.
 */

import { messageOf } from '@swoop/common';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

/** Voyage-3 dimensionality, locked per C.18. */
export const VOYAGE_DIMENSIONS = 1024;

/** Voyage-3 model identifier. */
export const VOYAGE_MODEL_ID = 'voyage-3';

/** Default batch size — see plan HITL Q7 (128 over 256, conservative). */
export const DEFAULT_BATCH_SIZE = 128;

/** Max in-flight batches — Plan HITL Q4 calls for 4. */
export const DEFAULT_CONCURRENCY = 4;

/** Retry delays in ms. Three attempts. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export type VoyageInputType = 'document' | 'query';

export interface VoyageEmbedRequest {
  /** Texts to embed, in order. */
  inputs: ReadonlyArray<string>;
  /** Whether these are documents (corpus) or queries. Default 'document'. */
  inputType?: VoyageInputType;
}

export interface VoyageEmbedResult {
  embeddings: number[][];
  /** Total input tokens reported by the API (for cost ledger). */
  totalTokens: number;
}

export interface VoyageFetcher {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface VoyageClientOptions {
  apiKey: string;
  /** Override for tests; defaults to the global `fetch`. */
  fetcher?: VoyageFetcher;
  /** Random jitter generator [0, 1) for retries; injectable for tests. */
  random?: () => number;
  /** Sleep helper (ms); injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Logger override. */
  log?: (msg: string) => void;
}

export class VoyageError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly attempt: number,
  ) {
    super(message);
    this.name = 'VoyageError';
  }
}

/**
 * Voyage-3 client. Batched + retried; no streaming, no caching.
 */
export class VoyageClient {
  private readonly apiKey: string;
  private readonly fetcher: VoyageFetcher;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(options: VoyageClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'VoyageClient: apiKey required (set VOYAGE_API_KEY in env).',
      );
    }
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.random = options.random ?? Math.random;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = options.log ?? ((msg) => console.log(msg));
  }

  /**
   * Embed an array of texts. Returns embeddings in the same order.
   * Caller is responsible for slicing into batches.
   */
  async embed(req: VoyageEmbedRequest): Promise<VoyageEmbedResult> {
    if (req.inputs.length === 0) {
      return { embeddings: [], totalTokens: 0 };
    }
    const body = {
      input: req.inputs,
      model: VOYAGE_MODEL_ID,
      input_type: req.inputType ?? 'document',
    };
    let lastError: VoyageError | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await this.fetcher(VOYAGE_API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (response.status === 429 || response.status >= 500) {
          // Retryable.
          const text = await safeText(response);
          lastError = new VoyageError(
            `Voyage HTTP ${response.status}: ${text.slice(0, 200)}`,
            response.status,
            attempt,
          );
          if (attempt < RETRY_DELAYS_MS.length) {
            const baseDelay = RETRY_DELAYS_MS[attempt]!;
            const jitter = baseDelay * 0.25 * this.random();
            this.log(
              `[voyage] HTTP ${response.status}; retry attempt ${attempt + 1} after ${(baseDelay + jitter).toFixed(0)}ms`,
            );
            await this.sleep(baseDelay + jitter);
            continue;
          }
          throw lastError;
        }
        if (!response.ok) {
          const text = await safeText(response);
          throw new VoyageError(
            `Voyage HTTP ${response.status} (non-retryable): ${text.slice(0, 500)}`,
            response.status,
            attempt,
          );
        }
        const json = (await response.json()) as VoyageApiResponse;
        const embeddings = (json.data ?? [])
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
        if (embeddings.length !== req.inputs.length) {
          throw new VoyageError(
            `Voyage returned ${embeddings.length} embeddings for ${req.inputs.length} inputs`,
            response.status,
            attempt,
          );
        }
        for (let i = 0; i < embeddings.length; i++) {
          if (embeddings[i]!.length !== VOYAGE_DIMENSIONS) {
            throw new VoyageError(
              `Voyage embedding ${i} has ${embeddings[i]!.length} dims (expected ${VOYAGE_DIMENSIONS})`,
              response.status,
              attempt,
            );
          }
        }
        const totalTokens = json.usage?.total_tokens ?? 0;
        return { embeddings, totalTokens };
      } catch (err) {
        if (err instanceof VoyageError) {
          // Distinguish retryable (429/5xx, marked above) from non-retryable
          // (400/401/etc.). Non-retryable always rethrows immediately —
          // there's no point hammering the API with the same bad request.
          const retryable =
            err.status === 429 || (err.status !== undefined && err.status >= 500);
          if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
          lastError = err;
          continue;
        }
        // Network / fetch error → retry.
        const baseDelay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
        const jitter = baseDelay * 0.25 * this.random();
        const reason = messageOf(err);
        lastError = new VoyageError(`Voyage fetch failed: ${reason}`, undefined, attempt);
        if (attempt < RETRY_DELAYS_MS.length) {
          this.log(
            `[voyage] fetch error: ${reason}; retry attempt ${attempt + 1} after ${(baseDelay + jitter).toFixed(0)}ms`,
          );
          await this.sleep(baseDelay + jitter);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new VoyageError('Voyage: unknown error', undefined, -1);
  }
}

interface VoyageApiResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens?: number };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Run an embed pass over `items` with batching + concurrency.
 *
 * Yields results as `{item, embedding}` tuples so the caller can persist
 * each batch as it comes back. Caller is responsible for breaking on cost
 * cap (caller checks ledger between batches).
 */
export async function embedInBatches<T>(
  client: VoyageClient,
  items: ReadonlyArray<T>,
  toText: (item: T) => string,
  options: {
    batchSize?: number;
    concurrency?: number;
    onBatchComplete?: (batchInputTokens: number, batchSize: number) => void;
    /** Returning true aborts before the next batch (cap kill-switch). */
    shouldAbort?: () => boolean;
  } = {},
): Promise<Array<{ item: T; embedding: number[] }>> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const shouldAbort = options.shouldAbort ?? (() => false);

  // Build batches.
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const results: Array<{ item: T; embedding: number[] }> = [];
  // Run batches with bounded concurrency.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (shouldAbort()) return;
      const idx = cursor++;
      if (idx >= batches.length) return;
      const batch = batches[idx]!;
      const inputs = batch.map(toText);
      const out = await client.embed({ inputs, inputType: 'document' });
      for (let j = 0; j < batch.length; j++) {
        results.push({ item: batch[j]!, embedding: out.embeddings[j]! });
      }
      options.onBatchComplete?.(out.totalTokens, batch.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  // Re-sort to original input order (worker concurrency may have shuffled).
  // Build an index from item identity.
  const order = new Map<T, number>();
  items.forEach((item, i) => order.set(item, i));
  results.sort((a, b) => (order.get(a.item) ?? 0) - (order.get(b.item) ?? 0));
  return results;
}
