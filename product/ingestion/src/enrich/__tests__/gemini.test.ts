import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  GeminiClient,
  embedInBatches,
  GEMINI_DIMENSIONS,
  GeminiError,
} from '../gemini.js';

function vec(): number[] {
  return Array(GEMINI_DIMENSIONS).fill(0);
}

function makeOkResponse(n: number): Response {
  // batchEmbedContents response shape:
  //   { embeddings: [{ values: number[] }, ...] }
  const embeddings = Array.from({ length: n }, () => ({ values: vec() }));
  return new Response(JSON.stringify({ embeddings }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GeminiClient', () => {
  it('throws on missing apiKey', () => {
    expect(() => new GeminiClient({ apiKey: '' })).toThrow();
  });

  it('returns empty result for zero inputs without calling the fetcher', async () => {
    const fetcher = vi.fn();
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    const r = await client.embed({ inputs: [] });
    expect(r.embeddings).toEqual([]);
    expect(r.totalTokens).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns embeddings in input order', async () => {
    const fetcher = vi.fn(async () => makeOkResponse(3));
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    const result = await client.embed({ inputs: ['a', 'b', 'c'] });
    expect(result.embeddings).toHaveLength(3);
    expect(result.embeddings[0]).toHaveLength(GEMINI_DIMENSIONS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throws on dimension mismatch', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    await expect(client.embed({ inputs: ['x'] })).rejects.toThrow(/2 dims/);
  });

  it('defaults task_type to RETRIEVAL_DOCUMENT and output_dimensionality to 3072', async () => {
    let captured: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (_url, init) => {
      captured = JSON.parse(init!.body as string) as Record<string, unknown>;
      return makeOkResponse(1);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    await client.embed({ inputs: ['x'] });
    const requests = captured!.requests as Array<Record<string, unknown>>;
    expect(requests).toBeDefined();
    expect(requests[0]!.task_type).toBe('RETRIEVAL_DOCUMENT');
    expect(requests[0]!.output_dimensionality).toBe(GEMINI_DIMENSIONS);
  });

  it('sends task_type RETRIEVAL_QUERY when inputType=query', async () => {
    let captured: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (_url, init) => {
      captured = JSON.parse(init!.body as string) as Record<string, unknown>;
      return makeOkResponse(1);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    await client.embed({ inputs: ['x'], inputType: 'query' });
    const requests = captured!.requests as Array<Record<string, unknown>>;
    expect(requests[0]!.task_type).toBe('RETRIEVAL_QUERY');
  });

  it('sends x-goog-api-key header (not Authorization)', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetcher = vi.fn(async (_url, init) => {
      capturedHeaders = init!.headers as Record<string, string>;
      return makeOkResponse(1);
    });
    const client = new GeminiClient({
      apiKey: 'secret-key',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    await client.embed({ inputs: ['x'] });
    expect(capturedHeaders!['x-goog-api-key']).toBe('secret-key');
    expect(capturedHeaders!.authorization).toBeUndefined();
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return new Response('rate limited', { status: 429 });
      return makeOkResponse(1);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
      random: () => 0,
      log: () => {},
    });
    const r = await client.embed({ inputs: ['x'] });
    expect(r.embeddings).toHaveLength(1);
    expect(calls).toBe(3);
  });

  it('retries on 5xx then succeeds', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls < 2) return new Response('boom', { status: 503 });
      return makeOkResponse(1);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
      random: () => 0,
      log: () => {},
    });
    const r = await client.embed({ inputs: ['x'] });
    expect(r.embeddings).toHaveLength(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('throws non-retryable on 400 without retrying', async () => {
    const fetcher = vi.fn(async () => new Response('bad', { status: 400 }));
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    await expect(client.embed({ inputs: ['x'] })).rejects.toBeInstanceOf(GeminiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries on network error then succeeds', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('ECONNRESET');
      return makeOkResponse(1);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
      random: () => 0,
      log: () => {},
    });
    const r = await client.embed({ inputs: ['x'] });
    expect(r.embeddings).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('estimates totalTokens via approxTokenCount when response carries none', async () => {
    const fetcher = vi.fn(async () => makeOkResponse(2));
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    // 'hello' is 5 chars → ceil(5/4) = 2; 'world!' is 6 → ceil(6/4) = 2; total 4.
    const r = await client.embed({ inputs: ['hello', 'world!'] });
    expect(r.totalTokens).toBe(4);
  });
});

describe('embedInBatches (gemini)', () => {
  it('respects batchSize', async () => {
    const seen: number[] = [];
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { requests: unknown[] };
      seen.push(body.requests.length);
      return makeOkResponse(body.requests.length);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const out = await embedInBatches(client, items, (s) => s, {
      batchSize: 4,
      concurrency: 1,
    });
    expect(out).toHaveLength(10);
    expect(seen).toEqual([4, 4, 2]);
  });

  it('preserves input order across concurrent batches', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { requests: unknown[] };
      return makeOkResponse(body.requests.length);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    const items = Array.from({ length: 6 }, (_, i) => `item-${i}`);
    const out = await embedInBatches(client, items, (s) => s, {
      batchSize: 2,
      concurrency: 3,
    });
    expect(out.map((r) => r.item)).toEqual(items);
  });

  it('aborts when shouldAbort returns true', async () => {
    let batchesCalled = 0;
    const fetcher = vi.fn(async (_url, init) => {
      batchesCalled += 1;
      const body = JSON.parse(init!.body as string) as { requests: unknown[] };
      return makeOkResponse(body.requests.length);
    });
    const client = new GeminiClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
    });
    const items = Array.from({ length: 100 }, (_, i) => `${i}`);
    let calls = 0;
    const out = await embedInBatches(client, items, (s) => s, {
      batchSize: 5,
      concurrency: 1,
      shouldAbort: () => {
        calls += 1;
        return calls > 1;
      },
    });
    expect(batchesCalled).toBeLessThan(20);
    expect(out.length).toBeLessThan(items.length);
  });

  describe('env-var overrides (GEMINI_BATCH_SIZE / GEMINI_CONCURRENCY)', () => {
    const savedBatch = process.env.GEMINI_BATCH_SIZE;
    const savedConc = process.env.GEMINI_CONCURRENCY;

    afterEach(() => {
      if (savedBatch === undefined) delete process.env.GEMINI_BATCH_SIZE;
      else process.env.GEMINI_BATCH_SIZE = savedBatch;
      if (savedConc === undefined) delete process.env.GEMINI_CONCURRENCY;
      else process.env.GEMINI_CONCURRENCY = savedConc;
    });

    it('GEMINI_BATCH_SIZE env var overrides DEFAULT_BATCH_SIZE when option is unset', async () => {
      process.env.GEMINI_BATCH_SIZE = '3';
      const seen: number[] = [];
      const fetcher = vi.fn(async (_url, init) => {
        const body = JSON.parse(init!.body as string) as { requests: unknown[] };
        seen.push(body.requests.length);
        return makeOkResponse(body.requests.length);
      });
      const client = new GeminiClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
      const items = Array.from({ length: 10 }, (_, i) => `${i}`);
      const out = await embedInBatches(client, items, (s) => s, { concurrency: 1 });
      expect(out).toHaveLength(10);
      expect(seen).toEqual([3, 3, 3, 1]);
    });

    it('GEMINI_CONCURRENCY env var overrides DEFAULT_CONCURRENCY when option is unset', async () => {
      process.env.GEMINI_CONCURRENCY = '1';
      let maxInFlight = 0;
      let inFlight = 0;
      const fetcher = vi.fn(async (_url, init) => {
        inFlight += 1;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        const body = JSON.parse(init!.body as string) as { requests: unknown[] };
        return makeOkResponse(body.requests.length);
      });
      const client = new GeminiClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
      const items = Array.from({ length: 20 }, (_, i) => `${i}`);
      await embedInBatches(client, items, (s) => s, { batchSize: 2 });
      expect(maxInFlight).toBe(1);
    });

    it('explicit options.batchSize wins over GEMINI_BATCH_SIZE env var', async () => {
      process.env.GEMINI_BATCH_SIZE = '3';
      const seen: number[] = [];
      const fetcher = vi.fn(async (_url, init) => {
        const body = JSON.parse(init!.body as string) as { requests: unknown[] };
        seen.push(body.requests.length);
        return makeOkResponse(body.requests.length);
      });
      const client = new GeminiClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
      const items = Array.from({ length: 10 }, (_, i) => `${i}`);
      await embedInBatches(client, items, (s) => s, { batchSize: 5, concurrency: 1 });
      // Option=5 wins; env-var=3 ignored.
      expect(seen).toEqual([5, 5]);
    });

    it('non-numeric / non-positive env-var values fall back to default', async () => {
      const fallbackCases = ['', 'banana', '0', '-1', 'NaN'];
      for (const v of fallbackCases) {
        process.env.GEMINI_BATCH_SIZE = v;
        const seen: number[] = [];
        const fetcher = vi.fn(async (_url, init) => {
          const body = JSON.parse(init!.body as string) as { requests: unknown[] };
          seen.push(body.requests.length);
          return makeOkResponse(body.requests.length);
        });
        const client = new GeminiClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
        const items = Array.from({ length: 3 }, (_, i) => `${i}`);
        await embedInBatches(client, items, (s) => s, { concurrency: 1 });
        // Falls back to DEFAULT_BATCH_SIZE (100) → single batch of 3.
        expect(seen).toEqual([3]);
      }
    });
  });
});
