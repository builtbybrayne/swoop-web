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

import {
  ClaudeLlm,
  buildThinkingFragment,
  modelUsesAdaptiveThinking,
  type AnthropicClientLike,
} from '../claude-llm.js';
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
    // Two partial text deltas + one consolidated NON-partial text aggregate
    // (for session persistence) + one turnComplete.
    expect(results).toHaveLength(4);
    expect(results[0]?.content?.parts?.[0]).toEqual({ text: 'Hello' });
    expect(results[0]?.partial).toBe(true);
    expect(results[1]?.content?.parts?.[0]).toEqual({ text: ', world' });
    expect(results[1]?.partial).toBe(true);
    // The aggregate carries the FULL text and is non-partial so ADK's runner
    // appends it to the session (it only persists `!partial` events). Without
    // it the model never sees its own prior turns.
    expect(results[2]?.content?.parts?.[0]).toEqual({ text: 'Hello, world' });
    expect(results[2]?.partial).toBeFalsy();
    expect(results[2]?.turnComplete).toBeFalsy();
    expect(results[3]?.turnComplete).toBe(true);
    expect(results[3]?.finishReason).toBeDefined();
  });

  it('does NOT emit a separate text aggregate on a tool-call turn (replay-structure invariant)', async () => {
    // A turn that emits text then a tool_use must persist as a SINGLE assistant
    // event (the non-partial functionCall). Emitting an extra text event would
    // create two consecutive assistant events that break Anthropic message
    // structure on replay. So no non-partial plain-text aggregate is produced.
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start', message: { id: 'm1' } as never },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check.' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} } as never,
      },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 1 },
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
    // No non-partial plain-text part: the only non-partial content carrier is
    // the functionCall.
    const nonPartialText = results.filter(
      (r) => r.partial !== true && typeof r.content?.parts?.[0]?.text === 'string',
    );
    expect(nonPartialText).toHaveLength(0);
    expect(results.find((r) => r.content?.parts?.[0]?.functionCall)).toBeDefined();
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
    // Perf-1 (2026-04-30 review): system is sent as a single text block with
    // a `cache_control: ephemeral` marker so the static prefix is cached.
    expect(capture.params?.system).toEqual([
      {
        type: 'text',
        text: 'you are helpful',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(capture.params?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(capture.params?.tools).toBeDefined();
    expect(capture.params?.tools?.[0]?.name).toBe('search');
  });

  // Perf-1 (2026-04-30 review): explicit assertions that prompt-cache breakpoints
  // land at the right positions. Anthropic charges full price for any byte
  // beyond the last `cache_control` marker, so placement is the contract.
  describe('Perf-1: prompt caching (cache_control placement)', () => {
    it('attaches cache_control: ephemeral to the system text block', async () => {
      const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
      const llm = new ClaudeLlm({
        model: 'claude-sonnet-4-5-20250929',
        apiKey: 'test',
        client: stubClient([{ type: 'message_stop' }], capture),
      });
      await collect(
        llm.generateContentAsync(
          baseRequest({
            contents: [
              { role: 'system', parts: [{ text: 'You are Puma.' }] },
              { role: 'user', parts: [{ text: 'hi' }] },
            ],
          }),
        ),
      );
      expect(Array.isArray(capture.params?.system)).toBe(true);
      const sys = capture.params?.system as Array<{
        type: string;
        text: string;
        cache_control?: { type: string };
      }>;
      expect(sys).toHaveLength(1);
      expect(sys[0]?.cache_control).toEqual({ type: 'ephemeral' });
      expect(sys[0]?.text).toBe('You are Puma.');
    });

    it('attaches cache_control: ephemeral to ONLY the last tool entry', async () => {
      const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
      const mkTool = (name: string) => ({
        _getDeclaration: () => ({
          name,
          description: `Tool ${name}.`,
          parameters: { properties: {}, required: [] },
        }),
      });
      const llm = new ClaudeLlm({
        model: 'claude-sonnet-4-5-20250929',
        apiKey: 'test',
        client: stubClient([{ type: 'message_stop' }], capture),
      });
      await collect(
        llm.generateContentAsync(
          baseRequest({
            toolsDict: {
              search: mkTool('search') as never,
              find_someone_who: mkTool('find_someone_who') as never,
              get_skill: mkTool('get_skill') as never,
            },
          }),
        ),
      );
      const tools = capture.params?.tools as Array<{
        name: string;
        cache_control?: { type: string };
      }>;
      expect(tools).toHaveLength(3);
      // Only the LAST tool carries the breakpoint — Anthropic caches the
      // prefix up to and including the marker, so one breakpoint at the end
      // covers the whole tool list (and the system block before it).
      expect(tools[0]?.cache_control).toBeUndefined();
      expect(tools[1]?.cache_control).toBeUndefined();
      expect(tools[2]?.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('omits system / tools cleanly when neither is supplied (no spurious cache_control)', async () => {
      const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
      const llm = new ClaudeLlm({
        model: 'claude-sonnet-4-5-20250929',
        apiKey: 'test',
        client: stubClient([{ type: 'message_stop' }], capture),
      });
      await collect(
        llm.generateContentAsync(
          baseRequest({
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
            toolsDict: {},
          }),
        ),
      );
      // No system instruction in the request => no `system` field on params.
      expect(capture.params?.system).toBeUndefined();
      expect(capture.params?.tools).toBeUndefined();
    });
  });
});

// RL.1/RL.2/RL.4 — native thinking. Pure mapping surface (per-family) plus the
// request-shape wiring. See planning/03-exec-crosscut-reasoning-leak-native-thinking.md.
describe('modelUsesAdaptiveThinking', () => {
  const cases: Array<[string, boolean]> = [
    ['claude-sonnet-4-6', true],
    ['claude-opus-4-6', true],
    ['claude-opus-4-8', true],
    ['claude-fable-5', true],
    ['claude-sonnet-4-5-20250929', false],
    ['claude-sonnet-4-0', false],
    ['claude-opus-4-5-20251101', false],
    ['claude-haiku-4-5-20251001', false],
  ];
  it.each(cases)('%s -> %s', (model, expected) => {
    expect(modelUsesAdaptiveThinking(model)).toBe(expected);
  });
});

describe('buildThinkingFragment', () => {
  it('returns {} when disabled, regardless of model', () => {
    expect(buildThinkingFragment('claude-sonnet-4-6', { enabled: false, maxTokens: 8192 })).toEqual({});
    expect(
      buildThinkingFragment('claude-sonnet-4-5-20250929', { enabled: false, maxTokens: 8192 }),
    ).toEqual({});
  });

  it('uses adaptive thinking for Sonnet 4.6 (no effort by default)', () => {
    expect(buildThinkingFragment('claude-sonnet-4-6', { enabled: true, maxTokens: 8192 })).toEqual({
      thinking: { type: 'adaptive' },
    });
  });

  it('adds output_config.effort for adaptive models when effort is set', () => {
    expect(
      buildThinkingFragment('claude-opus-4-8', { enabled: true, effort: 'medium', maxTokens: 8192 }),
    ).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
  });

  it('uses adaptive for the Fable family', () => {
    expect(buildThinkingFragment('claude-fable-5', { enabled: true, maxTokens: 8192 })).toEqual({
      thinking: { type: 'adaptive' },
    });
  });

  it('falls back to legacy enabled+budget for Sonnet 4.5; budget < max_tokens, >= 1024, no effort', () => {
    const frag = buildThinkingFragment('claude-sonnet-4-5-20250929', {
      enabled: true,
      effort: 'high', // ignored on the legacy path — effort errors on 4.5
      maxTokens: 8192,
    });
    expect(frag).toEqual({ thinking: { type: 'enabled', budget_tokens: 4096 } });
    expect('output_config' in frag).toBe(false);
  });

  it('clamps the legacy budget to >= 1024 and < max_tokens for small max_tokens', () => {
    const frag = buildThinkingFragment('claude-haiku-4-5-20251001', {
      enabled: true,
      maxTokens: 1536,
    });
    const budget = (frag.thinking as { type: 'enabled'; budget_tokens: number }).budget_tokens;
    expect(budget).toBeGreaterThanOrEqual(1024);
    expect(budget).toBeLessThan(1536);
  });
});

describe('ClaudeLlm thinking wiring (request shape)', () => {
  it('includes adaptive thinking in the request when enabled', async () => {
    const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-6',
      apiKey: 'test',
      thinkingEnabled: true,
      client: stubClient([{ type: 'message_stop' }], capture),
    });
    await collect(llm.generateContentAsync(baseRequest({ model: 'claude-sonnet-4-6' })));
    expect(capture.params?.thinking).toEqual({ type: 'adaptive' });
  });

  it('omits thinking and output_config entirely when disabled', async () => {
    const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-6',
      apiKey: 'test',
      thinkingEnabled: false,
      client: stubClient([{ type: 'message_stop' }], capture),
    });
    await collect(llm.generateContentAsync(baseRequest({ model: 'claude-sonnet-4-6' })));
    expect(capture.params?.thinking).toBeUndefined();
    expect(capture.params?.output_config).toBeUndefined();
  });

  it('wires effort into output_config when set and thinking is on', async () => {
    const capture: { params?: MessageCreateParamsStreaming; signal?: AbortSignal } = {};
    const llm = new ClaudeLlm({
      model: 'claude-sonnet-4-6',
      apiKey: 'test',
      thinkingEnabled: true,
      effort: 'low',
      client: stubClient([{ type: 'message_stop' }], capture),
    });
    await collect(llm.generateContentAsync(baseRequest({ model: 'claude-sonnet-4-6' })));
    expect(capture.params?.output_config).toEqual({ effort: 'low' });
  });
});
