/**
 * Tests for the visitor-query embedder.
 *
 * Per the C.t9 2026-05-13 visitor-query Voyage-holdover addendum: the
 * connector's query-time embedder is gemini-embedding-001 / 3072d, matching
 * the corpus storage (halfvec(3072) via migration 009).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildEmbedQuery,
  GEMINI_QUERY_ENDPOINT,
  GEMINI_QUERY_DIM,
  _resetEmbedCacheForTesting,
} from '../embed-query.js';
import type { Config } from '../../config/index.js';

function configWith(overrides: Partial<Config> = {}): Config {
  return {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/puma_dev',
    PG_POOL_MAX: 10,
    PG_IDLE_TIMEOUT_MS: 30_000,
    PG_STATEMENT_TIMEOUT_MS: 10_000,
    PORT: 3002,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    TOOLS_PROMPT_DIR: '../cms/prompts/tools',
    GEMINI_API_KEY: 'test-key',
    NODE_ENV: 'test',
    ...overrides,
  } as Config;
}

function vectorOfDim(dim: number, fill = 0.01): number[] {
  return Array.from({ length: dim }, () => fill);
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  _resetEmbedCacheForTesting();
});

describe('buildEmbedQuery (Gemini-embedding-001 / 3072d)', () => {
  it('calls Gemini and returns the 3072d vector', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ embedding: { values: vectorOfDim(GEMINI_QUERY_DIM, 0.1) } }),
    );
    const embed = buildEmbedQuery(configWith(), fetcher as unknown as typeof fetch);

    const vec = await embed('torres del paine');
    expect(vec).toHaveLength(GEMINI_QUERY_DIM);
    expect(vec[0]).toBe(0.1);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(GEMINI_QUERY_ENDPOINT);
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('test-key');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.task_type).toBe('RETRIEVAL_QUERY');
    expect(body.output_dimensionality).toBe(GEMINI_QUERY_DIM);
    expect(body.content.parts[0].text).toBe('torres del paine');
  });

  it('caches repeated identical inputs (one HTTP call for two embeds)', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ embedding: { values: vectorOfDim(GEMINI_QUERY_DIM, 0.2) } }),
    );
    const embed = buildEmbedQuery(configWith(), fetcher as unknown as typeof fetch);

    const a = await embed('w trek');
    const b = await embed('w trek');
    expect(a).toBe(b); // same reference (cached)
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throws fast when GEMINI_API_KEY is missing — no HTTP call', async () => {
    const fetcher = vi.fn();
    const embed = buildEmbedQuery(
      configWith({ GEMINI_API_KEY: undefined } as Partial<Config>),
      fetcher as unknown as typeof fetch,
    );

    await expect(embed('anything')).rejects.toThrow(
      /GEMINI_API_KEY not configured/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('throws with body excerpt on non-2xx Gemini response', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('Quota exceeded for project foo (per-minute TPM)', {
          status: 429,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const embed = buildEmbedQuery(configWith(), fetcher as unknown as typeof fetch);

    await expect(embed('patagonia')).rejects.toThrow(
      /Gemini HTTP 429: Quota exceeded/,
    );
  });

  it('throws when Gemini returns a vector of the wrong length', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ embedding: { values: vectorOfDim(1024) } }),
    );
    const embed = buildEmbedQuery(configWith(), fetcher as unknown as typeof fetch);

    await expect(embed('mismatch')).rejects.toThrow(
      /unexpected vector shape \(length=1024; expected 3072\)/,
    );
  });

  it('throws when Gemini returns no embedding field', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'bad input' } }),
    );
    const embed = buildEmbedQuery(configWith(), fetcher as unknown as typeof fetch);

    await expect(embed('missing-embedding')).rejects.toThrow(
      /unexpected vector shape \(length=undefined/,
    );
  });
});
