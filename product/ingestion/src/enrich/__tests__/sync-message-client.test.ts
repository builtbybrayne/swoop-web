/**
 * Tests for SyncMessageClient (C.t10) — the synchronous `messages.create`
 * adapter that implements the `BatchClient` interface so dev iteration
 * loops on the enrich pipeline don't have to wait for Anthropic Batches
 * SLA.
 *
 * The mock SDK shape mirrors the one used by anthropic-batch-client.test.ts
 * — minimal `messages.create` surface, no `@anthropic-ai/sdk` typings
 * required at test time.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  SyncMessageClient,
  type AnthropicSyncSdk,
} from '../sync-message-client.js';
import type { BatchRequest } from '../haiku.js';
import { buildBatchPayload, parseSdkSuccessMessage } from '../haiku.js';
import { zodToToolInputSchema } from '../zod-to-json-schema.js';

const TestSchema = z.object({
  result: z.string(),
});

function buildRequest(id: string, overrides: Partial<BatchRequest> = {}): BatchRequest {
  return {
    customId: id,
    systemPrompt: 'sys',
    userMessage: `msg-${id}`,
    outputToolName: 'do_thing',
    outputToolDescription: 'desc',
    outputToolSchema: TestSchema,
    ...overrides,
  };
}

/**
 * Build a mock SDK that returns one tool_use message per request, where the
 * tool input echoes the input customId so the test can correlate ordering.
 * `responder` lets a test customise per-request behaviour (errors, delays).
 */
interface MockCallTrace {
  /** Order in which each call started, by `userMessage`. */
  starts: string[];
  /** Currently in-flight calls, by `userMessage`. */
  inflight: Set<string>;
  /** Max concurrent in-flight observed. */
  maxConcurrent: number;
}

function makeMockSdk(opts: {
  responder?: (
    userMessage: string,
    attempt: number,
  ) => Promise<{
    content: Array<{ type: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  }>;
}): { sdk: AnthropicSyncSdk; trace: MockCallTrace; attempts: Map<string, number> } {
  const trace: MockCallTrace = {
    starts: [],
    inflight: new Set(),
    maxConcurrent: 0,
  };
  const attempts = new Map<string, number>();
  const responder =
    opts.responder ??
    (async (userMessage) => ({
      content: [
        { type: 'tool_use', name: 'do_thing', input: { result: `ok:${userMessage}` } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
  const sdk: AnthropicSyncSdk = {
    messages: {
      create: vi.fn(async (params) => {
        const um = params.messages[0]!.content;
        const a = (attempts.get(um) ?? 0) + 1;
        attempts.set(um, a);
        trace.starts.push(um);
        trace.inflight.add(um + '#' + a);
        trace.maxConcurrent = Math.max(trace.maxConcurrent, trace.inflight.size);
        try {
          return await responder(um, a);
        } finally {
          trace.inflight.delete(um + '#' + a);
        }
      }),
    },
  };
  return { sdk, trace, attempts };
}

describe('SyncMessageClient', () => {
  it('1) submit runs each request through messages.create and returns a sync_-prefixed batchId', async () => {
    const { sdk, trace } = makeMockSdk({});
    const c = new SyncMessageClient({ sdk, sleep: () => Promise.resolve() });
    const reqs = [buildRequest('a'), buildRequest('b'), buildRequest('c')];
    const r = await c.submit(reqs);
    expect(r.count).toBe(3);
    expect(r.batchId).toMatch(/^sync_/);
    expect(trace.starts).toHaveLength(3);
    expect(sdk.messages.create).toHaveBeenCalledTimes(3);
  });

  it('2) fetchResults returns parsed entries in input order with correct customId mapping', async () => {
    const { sdk } = makeMockSdk({});
    const c = new SyncMessageClient({ sdk, sleep: () => Promise.resolve() });
    const reqs = [buildRequest('row:1'), buildRequest('row:2'), buildRequest('row:3')];
    const sub = await c.submit(reqs);
    const out = await c.fetchResults(sub.batchId);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.customId)).toEqual(['row:1', 'row:2', 'row:3']);
    expect(out.every((e) => e.status === 'succeeded')).toBe(true);
    expect(out[0]!.output).toEqual({ result: 'ok:msg-row:1' });
    expect(out[1]!.output).toEqual({ result: 'ok:msg-row:2' });
    expect(out[2]!.output).toEqual({ result: 'ok:msg-row:3' });
  });

  it('3) poll returns ended immediately for a known batchId', async () => {
    const { sdk } = makeMockSdk({});
    const c = new SyncMessageClient({ sdk, sleep: () => Promise.resolve() });
    const reqs = [buildRequest('x'), buildRequest('y')];
    const sub = await c.submit(reqs);
    const p = await c.poll(sub.batchId);
    expect(p.status).toBe('ended');
    expect(p.counts.succeeded).toBe(2);
    expect(p.counts.errored).toBe(0);
  });

  it('4) concurrency cap is respected', async () => {
    // Build a responder that holds each call open until released, so we can
    // observe how many run in parallel.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const responder = async (userMessage: string) => {
      await gate;
      return {
        content: [
          { type: 'tool_use', name: 'do_thing', input: { result: userMessage } },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    };
    const { sdk, trace } = makeMockSdk({ responder });
    const c = new SyncMessageClient({
      sdk,
      concurrency: 5,
      sleep: () => Promise.resolve(),
    });
    const reqs = Array.from({ length: 20 }, (_, i) => buildRequest(`r${i}`));
    const submitPromise = c.submit(reqs);
    // Let the worker pool ramp up; this many microtasks should be enough.
    await new Promise((r) => setTimeout(r, 20));
    expect(trace.maxConcurrent).toBeLessThanOrEqual(5);
    expect(trace.maxConcurrent).toBeGreaterThan(0);
    release!();
    const sub = await submitPromise;
    expect(sub.count).toBe(20);
    expect(trace.maxConcurrent).toBeLessThanOrEqual(5);
  });

  it('5) a per-request 429 is retried until success', async () => {
    const responder = async (userMessage: string, attempt: number) => {
      if (userMessage === 'msg-flaky' && attempt <= 2) {
        const err = new Error('rate limited') as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return {
        content: [
          { type: 'tool_use', name: 'do_thing', input: { result: `ok:${userMessage}` } },
        ],
        usage: { input_tokens: 3, output_tokens: 3 },
      };
    };
    const { sdk, attempts } = makeMockSdk({ responder });
    const c = new SyncMessageClient({
      sdk,
      sleep: () => Promise.resolve(),
    });
    const sub = await c.submit([buildRequest('flaky'), buildRequest('ok')]);
    const out = await c.fetchResults(sub.batchId);
    expect(out[0]!.status).toBe('succeeded');
    expect(out[0]!.customId).toBe('flaky');
    expect(out[0]!.output).toEqual({ result: 'ok:msg-flaky' });
    expect(out[1]!.status).toBe('succeeded');
    expect(attempts.get('msg-flaky')).toBe(3);
    expect(attempts.get('msg-ok')).toBe(1);
  });

  it('6) a non-retryable 4xx error surfaces as status: errored', async () => {
    const responder = async () => {
      const err = new Error('bad request') as Error & { status: number };
      err.status = 400;
      throw err;
    };
    const { sdk, attempts } = makeMockSdk({ responder });
    const c = new SyncMessageClient({
      sdk,
      sleep: () => Promise.resolve(),
    });
    const sub = await c.submit([buildRequest('bad')]);
    const out = await c.fetchResults(sub.batchId);
    expect(out[0]!.status).toBe('errored');
    expect(out[0]!.error).toMatch(/bad request|400/);
    expect(attempts.get('msg-bad')).toBe(1);
  });

  it('7) unknown batchId throws on poll and fetchResults', async () => {
    const { sdk } = makeMockSdk({});
    const c = new SyncMessageClient({ sdk, sleep: () => Promise.resolve() });
    await expect(c.poll('made-up-batch-id')).rejects.toThrow(/unknown batchId/);
    await expect(c.fetchResults('made-up-batch-id')).rejects.toThrow(/unknown batchId/);
  });

  it('8) reuses buildBatchPayload params shape for messages.create', async () => {
    const { sdk } = makeMockSdk({});
    const c = new SyncMessageClient({ sdk, sleep: () => Promise.resolve() });
    const req = buildRequest('shape-check', { temperature: 0.5, maxTokens: 999 });
    await c.submit([req]);
    // The mock SDK records the exact params passed in.
    const expectedParams = buildBatchPayload(req, zodToToolInputSchema(TestSchema)).params;
    const actualCall = (sdk.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(actualCall.model).toBe(expectedParams.model);
    expect(actualCall.max_tokens).toBe(expectedParams.max_tokens);
    expect(actualCall.temperature).toBe(expectedParams.temperature);
    expect(actualCall.system).toBe(expectedParams.system);
    expect(actualCall.messages).toEqual(expectedParams.messages);
    expect(actualCall.tools).toEqual(expectedParams.tools);
    expect(actualCall.tool_choice).toEqual(expectedParams.tool_choice);
  });

  it('9) token usage from the API response is recorded per entry', async () => {
    const responder = async (userMessage: string) => ({
      content: [
        { type: 'tool_use', name: 'do_thing', input: { result: userMessage } },
      ],
      usage: { input_tokens: 123, output_tokens: 45 },
    });
    const { sdk } = makeMockSdk({ responder });
    const c = new SyncMessageClient({ sdk, sleep: () => Promise.resolve() });
    const sub = await c.submit([buildRequest('u1'), buildRequest('u2')]);
    const out = await c.fetchResults(sub.batchId);
    expect(out[0]!.inputTokens).toBe(123);
    expect(out[0]!.outputTokens).toBe(45);
    expect(out[1]!.inputTokens).toBe(123);
    expect(out[1]!.outputTokens).toBe(45);
  });

  it('parseSdkSuccessMessage helper carries through both client paths', () => {
    // Belt-and-braces: the helper is shared between batch + sync;
    // verify the shape one more time at the test seam.
    const parsed = parseSdkSuccessMessage({
      content: [{ type: 'tool_use', name: 't', input: { x: 1 } }],
      usage: { input_tokens: 7, output_tokens: 8 },
    });
    expect(parsed).toEqual({ output: { x: 1 }, inputTokens: 7, outputTokens: 8 });
  });
});
