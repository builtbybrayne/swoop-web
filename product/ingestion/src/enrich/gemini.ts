/**
 * Gemini-embedding-001 HTTP client.
 *
 * Locked to `gemini-embedding-001` / 3072d per decision C.46
 * (supersedes C.18). Plan: planning/03-exec-c-t9.md §"Implementation steps —
 * Step 4 — Implement GeminiClient".
 *
 * Why a thin local HTTP client and not the `@google/genai` SDK call surface?
 *   - The Voyage predecessor (now retired) used the same shape: one `fetch`
 *     wrapper covers it cleanly + makes retries + batch behaviour observable.
 *   - The `batchEmbedContents` REST endpoint is straightforward and unlike
 *     the SDK is trivially mockable via the `fetcher` injection.
 *   - Keeping the dep graph lean past the SDK's own surface keeps the test
 *     story tight.
 *
 * Behaviour:
 *   - Batched (default 100 docs per call — HITL Q3 in the plan ratified 100).
 *   - Retries: exponential backoff on 429 / 5xx / network — 3 attempts at
 *     1s / 2s / 4s + jitter. Plan §"voyage.ts" pinned this shape; we copy.
 *   - Returns one embedding per input, in order.
 *   - Auth: `x-goog-api-key: <apiKey>` header (Google AI Studio API key route).
 *   - Token usage: response carries no token count. We estimate via
 *     `approxTokenCount` (1 token ≈ 4 chars). HITL Q5 ratified.
 */

import { messageOf } from '@swoop/common';
import { approxTokenCount } from './cost.js';

/** Endpoint for `batchEmbedContents` on `gemini-embedding-001`. */
export const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents';

/** Gemini-embedding-001 dimensionality, locked per C.46. */
export const GEMINI_DIMENSIONS = 3072;

/** Gemini-embedding-001 model identifier. */
export const GEMINI_MODEL_ID = 'gemini-embedding-001';

/** Default batch size — see plan HITL Q3 (100). */
export const DEFAULT_BATCH_SIZE = 100;

/** Max in-flight batches — HITL Q4 ratified 4. */
export const DEFAULT_CONCURRENCY = 4;

/** Retry delays in ms. Three attempts. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export type GeminiInputType = 'document' | 'query';

export interface GeminiEmbedRequest {
  /** Texts to embed, in order. */
  inputs: ReadonlyArray<string>;
  /** Whether these are documents (corpus) or queries. Default 'document'. */
  inputType?: GeminiInputType;
}

export interface GeminiEmbedResult {
  embeddings: number[][];
  /**
   * Estimated input tokens via approxTokenCount. The batchEmbedContents
   * response does not include token usage, so this is a 1-token-per-4-chars
   * estimate, not API-reported. Plan HITL Q5 ratified accepting the
   * approximation; the ledger is a cap-not-billing instrument.
   */
  totalTokens: number;
}

export interface GeminiFetcher {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface GeminiClientOptions {
  apiKey: string;
  /** Override for tests; defaults to the global `fetch`. */
  fetcher?: GeminiFetcher;
  /** Random jitter generator [0, 1) for retries; injectable for tests. */
  random?: () => number;
  /** Sleep helper (ms); injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Logger override. */
  log?: (msg: string) => void;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly attempt: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Map our public `'document' | 'query'` input type to Gemini's task_type enum.
 * Task types matter for retrieval quality — they steer the encoder toward
 * symmetric (query) vs asymmetric (document) similarity geometry.
 */
function geminiTaskType(t: GeminiInputType): string {
  return t === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
}

/**
 * gemini-embedding-001 client. Batched + retried; no streaming, no caching.
 */
export class GeminiClient {
  private readonly apiKey: string;
  private readonly fetcher: GeminiFetcher;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(options: GeminiClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'GeminiClient: apiKey required (set GEMINI_API_KEY in env).',
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
   * Embed an array of texts via `batchEmbedContents`. Returns embeddings in
   * the same order. Caller is responsible for slicing into batches.
   */
  async embed(req: GeminiEmbedRequest): Promise<GeminiEmbedResult> {
    if (req.inputs.length === 0) {
      return { embeddings: [], totalTokens: 0 };
    }
    const taskType = geminiTaskType(req.inputType ?? 'document');
    const body = {
      requests: req.inputs.map((text) => ({
        model: `models/${GEMINI_MODEL_ID}`,
        content: { parts: [{ text }] },
        task_type: taskType,
        output_dimensionality: GEMINI_DIMENSIONS,
      })),
    };

    let lastError: GeminiError | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await this.fetcher(GEMINI_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
        });
        if (response.status === 429 || response.status >= 500) {
          const text = await safeText(response);
          lastError = new GeminiError(
            `Gemini HTTP ${response.status}: ${text.slice(0, 200)}`,
            response.status,
            attempt,
          );
          if (attempt < RETRY_DELAYS_MS.length) {
            const baseDelay = RETRY_DELAYS_MS[attempt]!;
            const jitter = baseDelay * 0.25 * this.random();
            this.log(
              `[gemini] HTTP ${response.status}; retry attempt ${attempt + 1} after ${(baseDelay + jitter).toFixed(0)}ms`,
            );
            await this.sleep(baseDelay + jitter);
            continue;
          }
          throw lastError;
        }
        if (!response.ok) {
          const text = await safeText(response);
          throw new GeminiError(
            `Gemini HTTP ${response.status} (non-retryable): ${text.slice(0, 500)}`,
            response.status,
            attempt,
          );
        }
        const json = (await response.json()) as GeminiApiResponse;
        const embeddings = (json.embeddings ?? []).map((e) => e.values);
        if (embeddings.length !== req.inputs.length) {
          throw new GeminiError(
            `Gemini returned ${embeddings.length} embeddings for ${req.inputs.length} inputs`,
            response.status,
            attempt,
          );
        }
        for (let i = 0; i < embeddings.length; i++) {
          if (embeddings[i]!.length !== GEMINI_DIMENSIONS) {
            throw new GeminiError(
              `Gemini embedding ${i} has ${embeddings[i]!.length} dims (expected ${GEMINI_DIMENSIONS})`,
              response.status,
              attempt,
            );
          }
        }
        let totalTokens = 0;
        for (const text of req.inputs) totalTokens += approxTokenCount(text);
        return { embeddings, totalTokens };
      } catch (err) {
        if (err instanceof GeminiError) {
          const retryable =
            err.status === 429 || (err.status !== undefined && err.status >= 500);
          if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
          lastError = err;
          continue;
        }
        // Network / fetch error → retry.
        const baseDelay =
          RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
        const jitter = baseDelay * 0.25 * this.random();
        const reason = messageOf(err);
        lastError = new GeminiError(`Gemini fetch failed: ${reason}`, undefined, attempt);
        if (attempt < RETRY_DELAYS_MS.length) {
          this.log(
            `[gemini] fetch error: ${reason}; retry attempt ${attempt + 1} after ${(baseDelay + jitter).toFixed(0)}ms`,
          );
          await this.sleep(baseDelay + jitter);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new GeminiError('Gemini: unknown error', undefined, -1);
  }
}

interface GeminiApiResponse {
  embeddings?: Array<{ values: number[] }>;
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
  client: GeminiClient,
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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, worker),
  );
  // Re-sort to original input order (worker concurrency may have shuffled).
  const order = new Map<T, number>();
  items.forEach((item, i) => order.set(item, i));
  results.sort((a, b) => (order.get(a.item) ?? 0) - (order.get(b.item) ?? 0));
  return results;
}
