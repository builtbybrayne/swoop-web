/**
 * Tests for the shared runHandler runtime.
 *
 * Verifies the four code paths called out in 03-exec-c-t4.md §"Error handling":
 *   - input-invalid → ok:false, code:'tool_input_invalid' + event with errorKind
 *   - body throws  → ok:false, code:'handler_threw' + event
 *   - output-invalid → ok:false, code:'tool_output_invalid' + event
 *   - happy path → ok:true, value + event with outputCount
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  runHandler,
  countOutputRows,
  toMcpToolResult,
  type ToolInvokedSink,
} from '../_handler-runtime.js';

const InputSchema = z.object({ q: z.string() });
const OutputSchema = z.object({
  passages: z.array(z.object({ id: z.string() })),
  count: z.number().int().nonnegative(),
});

interface CapturedEvent {
  toolName: string;
  ok: boolean;
  elapsedMs: number;
  outputCount?: number;
  errorKind?: string;
}

function capture(): { sink: ToolInvokedSink; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  return {
    sink: (e) => events.push(e),
    events,
  };
}

describe('runHandler', () => {
  it('returns ok:true and emits tool.invoked on the happy path', async () => {
    const { sink, events } = capture();
    const result = await runHandler(
      'find_inspiring',
      InputSchema,
      OutputSchema,
      async (input) => ({
        passages: [{ id: 'p1' }, { id: 'p2' }],
        count: 2,
      }),
      { q: 'torres' },
      { sessionId: 'sess', sink },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.count).toBe(2);
    }
    expect(events).toHaveLength(1);
    expect(events[0].toolName).toBe('find_inspiring');
    expect(events[0].ok).toBe(true);
    expect(events[0].outputCount).toBe(2);
  });

  it('returns tool_input_invalid on bad input', async () => {
    const { sink, events } = capture();
    const result = await runHandler(
      'find_inspiring',
      InputSchema,
      OutputSchema,
      async () => ({ passages: [], count: 0 }),
      { wrong_field: 1 },
      { sessionId: 'sess', sink },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool_input_invalid');
    }
    expect(events[0].ok).toBe(false);
    expect(events[0].errorKind).toBe('tool_input_invalid');
  });

  it('returns handler_threw and emits when body throws', async () => {
    const { sink, events } = capture();
    const result = await runHandler(
      'find_inspiring',
      InputSchema,
      OutputSchema,
      async () => {
        throw new Error('db down');
      },
      { q: 'x' },
      { sessionId: 'sess', sink },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('handler_threw');
      expect(result.detail).toContain('db down');
    }
    expect(events[0].ok).toBe(false);
    expect(events[0].errorKind).toBe('handler_threw');
  });

  it('returns tool_output_invalid when output fails schema', async () => {
    const { sink, events } = capture();
    const result = await runHandler(
      'find_inspiring',
      InputSchema,
      OutputSchema,
      // intentional: returns a shape that doesn't match OutputSchema
      async () => ({ passages: 'not-an-array', count: -1 }) as never,
      { q: 'x' },
      { sessionId: 'sess', sink },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool_output_invalid');
    }
    expect(events[0].errorKind).toBe('tool_output_invalid');
  });
});

describe('countOutputRows', () => {
  it('counts the standard collection field shapes', () => {
    expect(countOutputRows({ passages: [1, 2, 3] })).toBe(3);
    expect(countOutputRows({ stories: [1] })).toBe(1);
    expect(countOutputRows({ proofs: [] })).toBe(0);
    expect(countOutputRows({ chunks: [1, 2] })).toBe(2);
    expect(countOutputRows({ cards: [1, 2, 3, 4] })).toBe(4);
    expect(countOutputRows({ images: [1] })).toBe(1);
  });

  it('returns undefined for non-collection shapes', () => {
    expect(countOutputRows({ status: 'widget_triggered' })).toBeUndefined();
    expect(countOutputRows(null)).toBeUndefined();
  });
});

describe('toMcpToolResult', () => {
  it('maps ok result to structuredContent + content text', () => {
    const out = toMcpToolResult({
      ok: true,
      value: { foo: 'bar' },
    });
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toEqual({ foo: 'bar' });
    expect(out.content[0].text).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('maps err result to isError:true with code/detail in body', () => {
    const out = toMcpToolResult({
      ok: false,
      code: 'tool_input_invalid',
      detail: 'no q',
    });
    expect(out.isError).toBe(true);
    expect((out.structuredContent as { code?: string }).code).toBe(
      'tool_input_invalid',
    );
  });
});
