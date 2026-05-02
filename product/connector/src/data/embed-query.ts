/**
 * Voyage-3 single-text embedding helper for visitor utterances.
 *
 * Per decision C.18 (Voyage-3 / 1024d). Each conversational tool's vector
 * primitive composes this once per call to turn the visitor's free-text input
 * into a search vector.
 *
 * Behaviour:
 *   - Process-lifetime in-process cache keyed on input text. Visitor utterances
 *     repeat within a session ("torres del paine" reaches several tools); the
 *     cache cuts redundant Voyage calls.
 *   - 1024-dimensionality enforced at the boundary. If Voyage returns a vector
 *     of any other length, throw — this is a contract drift, not something to
 *     paper over.
 *   - Fail-fast on missing VOYAGE_API_KEY at call time (not at config load —
 *     handlers that don't need embedding must still boot).
 *
 * The handler-registration boot path partial-applies a Config-bound version
 * into `HandlerDeps`; tests inject their own deterministic embedding function
 * and never call this module.
 */

import type { Config } from '../config/index.js';

export const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
export const VOYAGE_QUERY_DIM = 1024 as const;
export const VOYAGE_MODEL = 'voyage-3' as const;

/** Function signature for embedding visitor utterances. */
export type EmbedQueryFn = (text: string) => Promise<number[]>;

/** Module-level cache; cleared by `_resetEmbedCacheForTesting`. */
const cache = new Map<string, number[]>();

interface VoyageResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

/**
 * Build an `EmbedQueryFn` bound to the given config. Returns the cached vector
 * for repeated identical inputs within the process lifetime.
 *
 * Throws when VOYAGE_API_KEY is missing — handlers that hit this path without
 * an API key will see a clear error instead of a silent zero vector.
 */
export function buildEmbedQuery(
  config: Config,
  fetcher: typeof fetch = fetch,
): EmbedQueryFn {
  return async function embedQuery(text: string): Promise<number[]> {
    const cached = cache.get(text);
    if (cached) return cached;

    if (!config.VOYAGE_API_KEY) {
      throw new Error(
        '[connector/embed-query] VOYAGE_API_KEY not configured; cannot embed visitor input.',
      );
    }

    const res = await fetcher(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input: [text],
        model: VOYAGE_MODEL,
        input_type: 'query',
      }),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new Error(
        `[connector/embed-query] Voyage HTTP ${res.status}: ${body}`,
      );
    }

    const json = (await res.json()) as VoyageResponse;
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== VOYAGE_QUERY_DIM) {
      throw new Error(
        `[connector/embed-query] Voyage returned an unexpected vector shape (length=${vec?.length ?? 'undefined'}; expected ${VOYAGE_QUERY_DIM}).`,
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
