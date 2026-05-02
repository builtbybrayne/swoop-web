import { describe, it, expect, vi } from 'vitest';
import { VoyageClient, embedInBatches, VOYAGE_DIMENSIONS, VoyageError } from '../voyage.js';

function vec(): number[] {
  return Array(VOYAGE_DIMENSIONS).fill(0);
}

function makeOkResponse(n: number): Response {
  const data = Array.from({ length: n }, (_, i) => ({ embedding: vec(), index: i }));
  return new Response(JSON.stringify({ data, usage: { total_tokens: n * 10 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('VoyageClient', () => {
  it('throws on missing apiKey', () => {
    expect(() => new VoyageClient({ apiKey: '' })).toThrow();
  });

  it('returns embeddings on happy path', async () => {
    const fetcher = vi.fn(async () => makeOkResponse(2));
    const client = new VoyageClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
    const result = await client.embed({ inputs: ['a', 'b'] });
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(VOYAGE_DIMENSIONS);
    expect(result.totalTokens).toBe(20);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns empty result for zero inputs', async () => {
    const fetcher = vi.fn();
    const client = new VoyageClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
    const r = await client.embed({ inputs: [] });
    expect(r.embeddings).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('rate limited', { status: 429 });
      return makeOkResponse(1);
    });
    const client = new VoyageClient({
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

  it('retries on 5xx then succeeds', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls < 2) return new Response('boom', { status: 503 });
      return makeOkResponse(1);
    });
    const client = new VoyageClient({
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

  it('exhausts retries on persistent 500', async () => {
    const fetcher = vi.fn(async () => new Response('boom', { status: 500 }));
    const client = new VoyageClient({
      apiKey: 'k',
      fetcher,
      sleep: () => Promise.resolve(),
      random: () => 0,
      log: () => {},
    });
    await expect(client.embed({ inputs: ['x'] })).rejects.toBeInstanceOf(VoyageError);
  });

  it('throws non-retryable on 400', async () => {
    const fetcher = vi.fn(async () => new Response('bad', { status: 400 }));
    const client = new VoyageClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
    await expect(client.embed({ inputs: ['x'] })).rejects.toBeInstanceOf(VoyageError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throws on dim mismatch', async () => {
    const fetcher = vi.fn(
      async () => new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2], index: 0 }], usage: { total_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new VoyageClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
    await expect(client.embed({ inputs: ['x'] })).rejects.toThrow(/has 2 dims/);
  });
});

describe('embedInBatches', () => {
  it('respects batchSize', async () => {
    const seen: number[] = [];
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { input: string[] };
      seen.push(body.input.length);
      return makeOkResponse(body.input.length);
    });
    const client = new VoyageClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const out = await embedInBatches(client, items, (s) => s, { batchSize: 4, concurrency: 1 });
    expect(out).toHaveLength(10);
    expect(seen).toEqual([4, 4, 2]);
  });

  it('preserves input order across concurrent batches', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { input: string[] };
      return makeOkResponse(body.input.length);
    });
    const client = new VoyageClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
    const items = Array.from({ length: 6 }, (_, i) => `item-${i}`);
    const out = await embedInBatches(client, items, (s) => s, { batchSize: 2, concurrency: 3 });
    expect(out.map((r) => r.item)).toEqual(items);
  });

  it('aborts when shouldAbort returns true', async () => {
    let batchesCalled = 0;
    const fetcher = vi.fn(async (_url, init) => {
      batchesCalled += 1;
      const body = JSON.parse(init!.body as string) as { input: string[] };
      return makeOkResponse(body.input.length);
    });
    const client = new VoyageClient({ apiKey: 'k', fetcher, sleep: () => Promise.resolve() });
    const items = Array.from({ length: 100 }, (_, i) => `${i}`);
    let calls = 0;
    const out = await embedInBatches(client, items, (s) => s, {
      batchSize: 5,
      concurrency: 1,
      shouldAbort: () => {
        calls += 1;
        return calls > 1; // abort after the first batch.
      },
    });
    expect(batchesCalled).toBeLessThan(20); // would be 20 if we ran all batches.
    expect(out.length).toBeLessThan(items.length);
  });
});
