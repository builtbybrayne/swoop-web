/**
 * gemini-embedding-001 single-text embedding helper for visitor utterances.
 *
 * Per decision C.46 (supersedes C.18's Voyage-3 line) the corpus stores
 * `halfvec(3072)` vectors via migration 009. The visitor's query vector must
 * match — same model, same dim, same task-type family — or cosine similarity
 * across the index produces noise.
 *
 * Per the C.t9 visitor-query Voyage-holdover addendum (2026-05-13): this
 * module replaces the prior Voyage-3 / 1024d implementation. Zero Voyage
 * dependency in the live system.
 *
 * Behaviour:
 *   - Process-lifetime in-process cache keyed on input text. Visitor utterances
 *     repeat within a session ("torres del paine" reaches several tools); the
 *     cache cuts redundant Gemini calls.
 *   - 3072-dimensionality enforced at the boundary. If Gemini returns a vector
 *     of any other length, throw — this is a contract drift, not something to
 *     paper over.
 *   - Task-type `RETRIEVAL_QUERY` so the encoder steers toward symmetric
 *     query/document geometry (mirrors the ingestion side's
 *     `RETRIEVAL_DOCUMENT` choice — both halves of the same retrieval contract).
 *   - Fail-fast on missing GEMINI_API_KEY at call time (not at config load —
 *     handlers that don't need embedding must still boot).
 *
 * The handler-registration boot path partial-applies a Config-bound version
 * into `HandlerDeps`; tests inject their own deterministic embedding function
 * and never call this module.
 */

import type { Config } from '../config/index.js';

/** Endpoint for `embedContent` on `gemini-embedding-001` (single text). */
export const GEMINI_QUERY_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

/** Output dimensionality, locked to match corpus storage (halfvec(3072)). */
export const GEMINI_QUERY_DIM = 3072 as const;

/** Gemini-embedding-001 model id (identical to the ingestion-side constant). */
export const GEMINI_QUERY_MODEL = 'gemini-embedding-001' as const;

/** Function signature for embedding visitor utterances. */
export type EmbedQueryFn = (text: string) => Promise<number[]>;

/** Module-level cache; cleared by `_resetEmbedCacheForTesting`. */
const cache = new Map<string, number[]>();

interface GeminiEmbedContentResponse {
  embedding?: { values?: number[] };
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Build an `EmbedQueryFn` bound to the given config. Returns the cached vector
 * for repeated identical inputs within the process lifetime.
 *
 * Throws when GEMINI_API_KEY is missing — handlers that hit this path without
 * an API key will see a clear error instead of a silent zero vector.
 */
export function buildEmbedQuery(
  config: Config,
  fetcher: typeof fetch = fetch,
): EmbedQueryFn {
  return async function embedQuery(text: string): Promise<number[]> {
    const cached = cache.get(text);
    if (cached) return cached;

    if (!config.GEMINI_API_KEY) {
      throw new Error(
        '[connector/embed-query] GEMINI_API_KEY not configured; cannot embed visitor input.',
      );
    }

    const res = await fetcher(GEMINI_QUERY_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        task_type: 'RETRIEVAL_QUERY',
        output_dimensionality: GEMINI_QUERY_DIM,
      }),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new Error(
        `[connector/embed-query] Gemini HTTP ${res.status}: ${body}`,
      );
    }

    const json = (await res.json()) as GeminiEmbedContentResponse;
    const vec = json.embedding?.values;
    if (!Array.isArray(vec) || vec.length !== GEMINI_QUERY_DIM) {
      throw new Error(
        `[connector/embed-query] Gemini returned an unexpected vector shape (length=${vec?.length ?? 'undefined'}; expected ${GEMINI_QUERY_DIM}).`,
      );
    }
    cache.set(text, vec);
    return vec;
  };
}

/** Test-only — clear the embedding cache between tests. */
export function _resetEmbedCacheForTesting(): void {
  cache.clear();
}
