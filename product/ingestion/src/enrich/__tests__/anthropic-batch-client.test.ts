import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  AnthropicBatchClient,
  waitForBatch,
  type AnthropicBatchSdk,
} from '../anthropic-batch-client.js';
import { buildBatchPayload } from '../haiku.js';
import { zodToToolInputSchema } from '../zod-to-json-schema.js';

const TestSchema = z.object({
  result: z.string(),
});

function makeMockSdk(): AnthropicBatchSdk {
  return {
    messages: {
      batches: {
        create: vi.fn(async () => ({
          id: 'batch_123',
          processing_status: 'in_progress',
        })),
        retrieve: vi.fn(async () => ({
          id: 'batch_123',
          processing_status: 'ended',
          ended_at: new Date().toISOString(),
          request_counts: {
            processing: 0,
            succeeded: 1,
            errored: 0,
            canceled: 0,
            expired: 0,
          },
          results_url: 'https://example.com/results',
        })),
        results: vi.fn(async () => {
          async function* gen() {
            yield {
              custom_id: 'test:1',
              result: {
                type: 'succeeded' as const,
                message: {
                  content: [
                    { type: 'tool_use', name: 'do_thing', input: { result: 'hello' } },
                  ],
                  usage: { input_tokens: 10, output_tokens: 5 },
                },
              },
            };
          }
          return gen();
        }),
      },
    },
  };
}

describe('AnthropicBatchClient', () => {
  it('submit returns batchId + count', async () => {
    const sdk = makeMockSdk();
    const c = new AnthropicBatchClient(sdk);
    const r = await c.submit([
      {
        customId: 'test:1',
        systemPrompt: 'sys',
        userMessage: 'hi',
        outputToolName: 'do_thing',
        outputToolDescription: 'd',
        outputToolSchema: TestSchema,
      },
    ]);
    expect(r.batchId).toBe('batch_123');
    expect(r.count).toBe(1);
    expect(sdk.messages.batches.create).toHaveBeenCalledOnce();
  });

  it('poll returns ended status', async () => {
    const c = new AnthropicBatchClient(makeMockSdk());
    const r = await c.poll('batch_123');
    expect(r.status).toBe('ended');
    expect(r.counts.succeeded).toBe(1);
  });

  it('fetchResults parses tool_use input', async () => {
    const c = new AnthropicBatchClient(makeMockSdk());
    const out = await c.fetchResults('batch_123');
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe('succeeded');
    expect(out[0]!.output).toEqual({ result: 'hello' });
    expect(out[0]!.inputTokens).toBe(10);
    expect(out[0]!.outputTokens).toBe(5);
  });

  it('maps errored result', async () => {
    const sdk: AnthropicBatchSdk = {
      messages: {
        batches: {
          create: vi.fn() as never,
          retrieve: vi.fn() as never,
          results: vi.fn(async () => {
            async function* gen() {
              yield {
                custom_id: 'x',
                result: {
                  type: 'errored' as const,
                  error: { message: 'overloaded', type: 'overloaded_error' },
                },
              };
            }
            return gen();
          }),
        },
      },
    };
    const c = new AnthropicBatchClient(sdk);
    const out = await c.fetchResults('batch_123');
    expect(out[0]!.status).toBe('errored');
    expect(out[0]!.error).toBe('overloaded');
  });
});

describe('waitForBatch', () => {
  it('resolves when poll returns ended', async () => {
    let polls = 0;
    const r = await waitForBatch(
      {
        isBatched: true,
        submit: async () => ({ batchId: 'x', count: 0 }),
        poll: async () => {
          polls += 1;
          return {
            batchId: 'x',
            status: polls < 2 ? 'in_progress' : 'ended',
            counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
          };
        },
        fetchResults: async () => [],
      },
      'x',
      { pollIntervalMs: 1, sleep: () => Promise.resolve(), log: () => {} },
    );
    expect(r.status).toBe('ended');
    expect(polls).toBe(2);
  });

  it('aborts via shouldAbort', async () => {
    await expect(
      waitForBatch(
        {
          isBatched: true,
          submit: async () => ({ batchId: 'x', count: 0 }),
          poll: async () => ({
            batchId: 'x',
            status: 'in_progress',
            counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
          }),
          fetchResults: async () => [],
        },
        'x',
        {
          pollIntervalMs: 1,
          sleep: () => Promise.resolve(),
          shouldAbort: () => true,
          log: () => {},
        },
      ),
    ).rejects.toThrow(/kill-switch/);
  });
});

describe('buildBatchPayload', () => {
  it('shapes a request with tool_choice', () => {
    const p = buildBatchPayload(
      {
        customId: 'cid',
        systemPrompt: 'sys',
        userMessage: 'msg',
        outputToolName: 'do_thing',
        outputToolDescription: 'desc',
        outputToolSchema: TestSchema,
      },
      zodToToolInputSchema(TestSchema),
    );
    expect(p.custom_id).toBe('cid');
    expect(p.params.tool_choice).toEqual({ type: 'tool', name: 'do_thing' });
    expect(p.params.tools[0]!.name).toBe('do_thing');
    expect(p.params.system).toBe('sys');
  });
});
