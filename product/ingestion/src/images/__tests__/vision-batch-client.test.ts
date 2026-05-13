/**
 * Unit tests for the Vision batches client (BATCH-C.t6). The Anthropic SDK
 * surface is faked end-to-end — same approach as `vision-client.test.ts`
 * (no real API calls, deterministic behaviour for the wiring path).
 *
 * Per Tier-3 plan `planning/03-exec-c-t6-batches-submission.md` §2.3.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AnthropicVisionBatchClient,
  waitForVisionBatch,
  type AnthropicBatchSdk,
  type BatchSdkResult,
} from '../vision-batch-client.js';

function makeSdk(overrides: {
  create?: AnthropicBatchSdk['messages']['batches']['create'];
  retrieve?: AnthropicBatchSdk['messages']['batches']['retrieve'];
  results?: AnthropicBatchSdk['messages']['batches']['results'];
}): AnthropicBatchSdk {
  return {
    messages: {
      batches: {
        create:
          overrides.create ??
          (async () => ({
            id: 'batch_unused',
            processing_status: 'in_progress',
          })),
        retrieve:
          overrides.retrieve ??
          (async () => ({
            id: 'batch_unused',
            processing_status: 'ended',
          })),
        results:
          overrides.results ??
          (async () =>
            (async function* () {
              // no results
            })()),
      },
    },
  };
}

async function* asyncIter<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe('AnthropicVisionBatchClient.submit', () => {
  it('calls sdk.messages.batches.create with the requests payload + returns batchId + count', async () => {
    const createFn = vi.fn(async () => ({
      id: 'batch_abc',
      processing_status: 'in_progress',
    }));
    const sdk = makeSdk({ create: createFn });
    const client = new AnthropicVisionBatchClient(sdk);

    const requests = [
      {
        custom_id: 'image-1',
        params: { model: 'm', max_tokens: 512, messages: [] },
      },
      {
        custom_id: 'image-2',
        params: { model: 'm', max_tokens: 512, messages: [] },
      },
    ] as unknown as Parameters<typeof client.submit>[0];

    const result = await client.submit(requests);

    expect(createFn).toHaveBeenCalledOnce();
    expect(result).toEqual({ batchId: 'batch_abc', count: 2 });
  });
});

describe('AnthropicVisionBatchClient.poll', () => {
  it('maps "in_progress" status to "in_progress"', async () => {
    const sdk = makeSdk({
      retrieve: async () => ({
        id: 'b1',
        processing_status: 'in_progress',
        request_counts: { processing: 3, succeeded: 1 },
      }),
    });
    const out = await new AnthropicVisionBatchClient(sdk).poll('b1');
    expect(out.batchId).toBe('b1');
    expect(out.status).toBe('in_progress');
    expect(out.counts.processing).toBe(3);
    expect(out.counts.succeeded).toBe(1);
    expect(out.counts.errored).toBe(0);
  });

  it('maps "canceling" status to "canceling"', async () => {
    const sdk = makeSdk({
      retrieve: async () => ({ id: 'b1', processing_status: 'canceling' }),
    });
    const out = await new AnthropicVisionBatchClient(sdk).poll('b1');
    expect(out.status).toBe('canceling');
  });

  it('maps "ended" + endedAt + resultsUrl', async () => {
    const sdk = makeSdk({
      retrieve: async () => ({
        id: 'b1',
        processing_status: 'ended',
        ended_at: '2026-05-13T14:00:00Z',
        results_url: 'https://api.example/results/b1',
        request_counts: { succeeded: 10, errored: 1 },
      }),
    });
    const out = await new AnthropicVisionBatchClient(sdk).poll('b1');
    expect(out.status).toBe('ended');
    expect(out.endedAt).toBeInstanceOf(Date);
    expect(out.endedAt?.toISOString()).toBe('2026-05-13T14:00:00.000Z');
    expect(out.resultsUrl).toBe('https://api.example/results/b1');
    expect(out.counts.succeeded).toBe(10);
    expect(out.counts.errored).toBe(1);
  });

  it('treats any unknown processing_status as "ended"', async () => {
    const sdk = makeSdk({
      retrieve: async () => ({ id: 'b1', processing_status: 'archived' }),
    });
    const out = await new AnthropicVisionBatchClient(sdk).poll('b1');
    expect(out.status).toBe('ended');
  });
});

describe('AnthropicVisionBatchClient.fetchResults', () => {
  it('maps succeeded results to {status, rawText, tokens}', async () => {
    const succeeded: BatchSdkResult = {
      custom_id: 'image-42',
      result: {
        type: 'succeeded',
        message: {
          content: [
            { type: 'text', text: '{"description":"a glacier","annotation":"x"}' },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
    };
    const sdk = makeSdk({
      results: async () => asyncIter([succeeded]),
    });
    const out = await new AnthropicVisionBatchClient(sdk).fetchResults('b1');
    expect(out).toHaveLength(1);
    const entry = out[0]!;
    expect(entry.customId).toBe('image-42');
    expect(entry.status).toBe('succeeded');
    expect(entry.rawText).toBe('{"description":"a glacier","annotation":"x"}');
    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(50);
    expect(entry.error).toBeUndefined();
  });

  it('maps errored results to {status: "errored", error, rawText: null}', async () => {
    const errored: BatchSdkResult = {
      custom_id: 'image-99',
      result: {
        type: 'errored',
        error: { message: 'overloaded', type: 'overloaded_error' },
      },
    };
    const sdk = makeSdk({ results: async () => asyncIter([errored]) });
    const out = await new AnthropicVisionBatchClient(sdk).fetchResults('b1');
    const entry = out[0]!;
    expect(entry.status).toBe('errored');
    expect(entry.error).toBe('overloaded');
    expect(entry.rawText).toBeNull();
    expect(entry.inputTokens).toBe(0);
  });

  it('maps canceled results to {status: "canceled", rawText: null}', async () => {
    const sdk = makeSdk({
      results: async () =>
        asyncIter([
          {
            custom_id: 'image-7',
            result: { type: 'canceled' },
          } as BatchSdkResult,
        ]),
    });
    const out = await new AnthropicVisionBatchClient(sdk).fetchResults('b1');
    expect(out[0]!.status).toBe('canceled');
    expect(out[0]!.rawText).toBeNull();
  });

  it('maps expired results to {status: "expired", rawText: null}', async () => {
    const sdk = makeSdk({
      results: async () =>
        asyncIter([
          {
            custom_id: 'image-8',
            result: { type: 'expired' },
          } as BatchSdkResult,
        ]),
    });
    const out = await new AnthropicVisionBatchClient(sdk).fetchResults('b1');
    expect(out[0]!.status).toBe('expired');
    expect(out[0]!.rawText).toBeNull();
  });

  it('returns succeeded result with rawText=null when no text block present (defensive)', async () => {
    const noText: BatchSdkResult = {
      custom_id: 'image-100',
      result: {
        type: 'succeeded',
        message: {
          content: [{ type: 'thinking', text: 'internal' }],
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    };
    const sdk = makeSdk({ results: async () => asyncIter([noText]) });
    const out = await new AnthropicVisionBatchClient(sdk).fetchResults('b1');
    expect(out[0]!.status).toBe('succeeded');
    expect(out[0]!.rawText).toBeNull();
  });
});

describe('waitForVisionBatch', () => {
  it('returns the first ended poll result; sleeps between in_progress polls', async () => {
    let pollCount = 0;
    const sdk = makeSdk({
      retrieve: async () => {
        pollCount += 1;
        return {
          id: 'b1',
          processing_status: pollCount < 3 ? 'in_progress' : 'ended',
          request_counts: { succeeded: pollCount * 2 },
        };
      },
    });
    const client = new AnthropicVisionBatchClient(sdk);
    const sleeps: number[] = [];
    const out = await waitForVisionBatch(client, 'b1', {
      pollIntervalMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(pollCount).toBe(3);
    expect(out.status).toBe('ended');
    expect(sleeps).toEqual([100, 100]);
  });

  it('throws when shouldAbort returns true mid-wait', async () => {
    const sdk = makeSdk({
      retrieve: async () => ({ id: 'b1', processing_status: 'in_progress' }),
    });
    const client = new AnthropicVisionBatchClient(sdk);
    let calls = 0;
    await expect(
      waitForVisionBatch(client, 'b1', {
        pollIntervalMs: 0,
        sleep: async () => {},
        shouldAbort: () => {
          calls += 1;
          return calls >= 1;
        },
      }),
    ).rejects.toThrow(/kill-switch|abort/i);
  });
});
