/**
 * Unit tests for the vision client. Anthropic SDK is faked end-to-end —
 * the real call would cost money and we want deterministic behaviour for
 * the retry / classify / extract paths.
 */

import { describe, expect, it } from 'vitest';
import {
  annotateImageLive,
  buildBatchRequest,
  buildVisionMessageBody,
  type AnthropicClientLike,
} from '../vision-client.js';

function clientResponding(blocks: Array<{ type: string; [k: string]: unknown }>): AnthropicClientLike {
  return {
    messages: {
      create: async () => ({ content: blocks, stop_reason: 'end_turn' }),
    },
  };
}

function clientThrowing(err: unknown): AnthropicClientLike {
  return {
    messages: {
      create: async () => {
        throw err;
      },
    },
  };
}

describe('buildVisionMessageBody', () => {
  it('attaches the image as a URL block + text reminder', () => {
    const body = buildVisionMessageBody({
      systemPrompt: 'do the thing',
      imageUrl: 'https://imgix.example/cat.jpg',
    });
    expect(body.messages).toHaveLength(1);
    const userContent = body.messages[0]?.content as unknown as Array<{
      type: string;
      [k: string]: unknown;
    }>;
    expect(userContent[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://imgix.example/cat.jpg' },
    });
    expect((userContent[1] as { type: string; text: string }).text).toMatch(/JSON object/);
    expect(body.system).toBe('do the thing');
  });

  it('honours model + maxTokens + temperature overrides', () => {
    const body = buildVisionMessageBody({
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 256,
      temperature: 0.0,
    });
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0);
  });
});

describe('buildBatchRequest', () => {
  it('produces a {custom_id, params} request with the imageId echoed', () => {
    const req = buildBatchRequest({
      imageId: 4242,
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(req.custom_id).toBe('image-4242');
    expect(req.params.model).toMatch(/^claude-/);
    expect(req.params.system).toBe('sys');
  });
});

describe('annotateImageLive', () => {
  it('extracts the first text block as rawText', async () => {
    const result = await annotateImageLive({
      client: clientResponding([{ type: 'text', text: '{"description":"a","annotation":"b"}' }]),
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rawText).toBe('{"description":"a","annotation":"b"}');
    }
  });

  it('skips empty text blocks and returns the first non-empty one', async () => {
    const result = await annotateImageLive({
      client: clientResponding([
        { type: 'text', text: '' },
        { type: 'text', text: 'hello' },
      ]),
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(result.ok).toBe(true);
  });

  it('returns no_text_block when the response carries no text', async () => {
    const result = await annotateImageLive({
      client: clientResponding([{ type: 'tool_use', id: 'x' }]),
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no_text_block/);
      expect(result.retryable).toBe(true);
    }
  });

  it('classifies 429 as retryable transient', async () => {
    const err = Object.assign(new Error('rate-limited'), { status: 429 });
    const result = await annotateImageLive({
      client: clientThrowing(err),
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.reason).toMatch(/transient_429/);
    }
  });

  it('classifies 500 as retryable transient', async () => {
    const err = Object.assign(new Error('boom'), { status: 503 });
    const result = await annotateImageLive({
      client: clientThrowing(err),
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it('classifies 400 as terminal (not retryable)', async () => {
    const err = Object.assign(new Error('bad request'), { status: 400 });
    const result = await annotateImageLive({
      client: clientThrowing(err),
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.reason).toMatch(/terminal_400/);
    }
  });

  it('classifies a network-style error (no status) as retryable', async () => {
    const result = await annotateImageLive({
      client: clientThrowing(new Error('socket hang up')),
      systemPrompt: 'sys',
      imageUrl: 'https://x/y.jpg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.reason).toMatch(/network/);
    }
  });
});
