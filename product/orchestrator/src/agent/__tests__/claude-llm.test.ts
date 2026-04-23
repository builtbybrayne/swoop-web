/**
 * ClaudeLlm tests — B.t5.
 *
 * Exercises the Anthropic streaming event → ADK LlmResponse translator end to
 * end, using a stubbed Anthropic client so nothing touches the network.
 *
 * Coverage:
 *   - Text deltas → partial LlmResponse{content.parts[{text}]} (partial:true).
 *   - Thinking deltas → partial LlmResponse with Part.thought === true.
 *     Crucial invariant: reasoning must be emitted as thought so the
 *     translator's filterReasoning stage strips it from SSE (B.t4 handoff).
 *   - Tool use blocks → buffered JSON → LlmResponse with Part.functionCall
 *     once the block closes.
 *   - message_stop → turnComplete: true with a mapped finishReason.
 *   - Abort signal propagates into the client call.
 *   - Error envelope (thrown pre-stream) is surfaced as errorCode/errorMessage
 *     instead of escaping as an exception.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  RawMessageStreamEvent,
  MessageCreateParamsStreaming,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

import { ClaudeLlm, type AnthropicClientLike } from '../claude-llm.js';
import type { LlmRequest, LlmResponse } from '@google/adk';

function streamFrom(events: RawMessageStreamEvent[]): AsyncIterable<RawMessageStreamEvent> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
  };
}

function stubClient(
  events: RawMessageStreamEvent[],
  capture?: { params?: MessageCreateParamsStreaming; signal?: AbortSignal },
): AnthropicClientLike {
  return {
    messages: {
      create: vi.fn(async (params, options) => {
        if (capture) {
          capture.params = params;
          capture.signal = options?.signal;
        }
        return streamFrom(events);
      }),
    },
  };
}

function baseRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'claude-sonnet-4-5-20250929',
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    toolsDict: {},
    liveConnectConfig: {},
    ...overrides,
  } as LlmRequest;
}

async function collect(gen: AsyncGenerator<LlmResponse, void>): Promise<LlmResponse[]> {
  const out: LlmResponse[] = [];
  for await (const r of gen) out.push(r);
  return out;
}

describe('ClaudeLlm.generateContentAsync', () => {
  it('maps text_delta events to partial text LlmResponses and emits turnComplete on message_stop', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: { id: 'm1' } as never },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ', world' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null } as never,
        usage: { output_tokens: 5 } as never,
      },
      { type: 'message_stop' },
    ];
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-5-20250929',
      apiKey: 'test',
      client: stubClient(events),
    });
    const results = await collect(llm.generateContentAsync(baseRequest()));
    // Two text deltas + one turnComplete.
    expect(results).toHaveLength(3);
    expect(results[0]?.content?.parts?.[0]).toEqual({ text: 'Hello' });
    expect(results[0]?.partial).toBe(true);
    expect(results[1]?.content?.parts?.[0]).toEqual({ text: ', world' });
    expect(results[2]?.turnComplete).toBe(true);
    expect(results[2]?.finishReason).toBeDefined();
  });

  it('maps thinking_delta events to Part.thought === true (reasoning invariant)', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: { id: 'm1' } as never },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'considering…' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ];
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-5-20250929',
      apiKey: 'test',
      client: stubClient(events),
    });
    const results = await collect(llm.generateContentAsync(baseRequest()));
    const reasoning = results.find((r) => r.content?.parts?.[0]?.thought === true);
    expect(reasoning).toBeDefined();
    expect(reasoning?.content?.parts?.[0]).toEqual({ text: 'considering…', thought: true });
  });

  it('buffers tool_use input_json_delta and emits functionCall on block_stop', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: { id: 'm1' } as never },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'search',
          input: {},
        } as never,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"glacier"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null } as never,
        usage: { output_tokens: 5 } as never,
      },
      { type: 'message_stop' },
    ];
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-5-20250929',
      apiKey: 'test',
      client: stubClient(events),
    });
    const results = await collect(llm.generateContentAsync(baseRequest()));
    const fc = results.find((r) => r.content?.parts?.[0]?.functionCall);
    expect(fc).toBeDefined();
    expect(fc?.content?.parts?.[0]?.functionCall).toEqual({
      id: 'toolu_1',
      name: 'search',
      args: { query: 'glacier' },
    });
  });

  it('threads the abort signal into the Anthropic client call', async () => {
    const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-5-20250929',
      apiKey: 'test',
      client: stubClient([{ type: 'message_stop' }], capture),
    });
    const controller = new AbortController();
    await collect(llm.generateContentAsync(baseRequest(), false, controller.signal));
    expect(capture.signal).toBe(controller.signal);
  });

  it('surfaces a pre-stream error as an errorCode/errorMessage envelope, not an exception', async () => {
    const client: AnthropicClientLike = {
      messages: {
        create: vi.fn().mockRejectedValue(Object.assign(new Error('upstream 500'), { status: 500 })),
      },
    };
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-5-20250929',
      apiKey: 'test',
      client,
    });
    const results = await collect(llm.generateContentAsync(baseRequest()));
    expect(results).toHaveLength(1);
    expect(results[0]?.errorCode).toBe('500');
    expect(results[0]?.errorMessage).toContain('upstream 500');
    expect(results[0]?.turnComplete).toBe(true);
  });

  it('sends system instruction + messages and includes tools when toolsDict is non-empty', async () => {
    const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
    const events: RawMessageStreamEvent[] = [{ type: 'message_stop' }];
    const fakeTool = {
      _getDeclaration: () => ({
        name: 'search',
        description: 'Search entities.',
        parameters: { properties: { query: { type: 'string' } }, required: ['query'] },
      }),
    };
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-5-20250929',
      apiKey: 'test',
      client: stubClient(events, capture),
    });
    const req = baseRequest({
      contents: [
        { role: 'system', parts: [{ text: 'you are helpful' }] },
        { role: 'user', parts: [{ text: 'hi' }] },
      ],
      toolsDict: { search: fakeTool as never },
    });
    await collect(llm.generateContentAsync(req));
    expect(capture.params?.system).toBe('you are helpful');
    expect(capture.params?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(capture.params?.tools).toBeDefined();
    expect(capture.params?.tools?.[0]?.name).toBe('search');
  });
});
