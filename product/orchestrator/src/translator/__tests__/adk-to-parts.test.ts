/**
 * adk-to-parts tests.
 *
 * Exercises the core mapping from ADK `Event` (which extends LlmResponse with
 * genai Content/Part) to shared MessageParts. Covers:
 *
 *   - Plain text events -> TextPart.
 *   - Thought events (Part.thought === true) -> ReasoningPart.
 *   - FunctionCall events -> ToolCallPart{ state: 'input-available' }.
 *   - FunctionResponse events -> ToolCallPart{ state: 'output-available' }
 *     with carried-forward `input` from the matching earlier call.
 *   - Error envelopes -> surfaced as an [error] TextPart (never silently dropped).
 *   - `<fyi>` embedded in text -> extracted via BlockParser.
 *   - Contract compliance: every emitted part parses against MessagePartSchema.
 *   - Reasoning parts emitted BEFORE the filter, confirming the filter (not
 *     this mapper) is the strip point.
 */

import { describe, it, expect } from 'vitest';

import type { MessagePart } from '@swoop/common';
import { MessagePartSchema } from '@swoop/common';

import { adkEventsToParts } from '../adk-to-parts.js';
import { translateAdkStream } from '../index.js';
import {
  errorEvent,
  functionCallEvent,
  functionResponseEvent,
  stream,
  textEvent,
  thoughtEvent,
  turnCompleteEvent,
} from './fixtures/adk-events.js';

const FIXED_NOW = () => new Date('2026-04-22T12:00:00.000Z');

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('adkEventsToParts — event-type coverage', () => {
  it('maps a single text event to a TextPart', async () => {
    const events = stream([textEvent('Hello, Patagonia.'), turnCompleteEvent()]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts).toEqual([{ type: 'text', text: 'Hello, Patagonia.' }]);
  });

  it('maps a thought event to a ReasoningPart (pre-filter)', async () => {
    const events = stream([thoughtEvent('Considering options…'), turnCompleteEvent()]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts).toEqual([{ type: 'reasoning', text: 'Considering options…' }]);
  });

  it('maps a function call to ToolCallPart{state:"input-available"}', async () => {
    const events = stream([
      functionCallEvent({ id: 'fc-1', name: 'show_component_list', args: { region: 'patagonia' } }),
      turnCompleteEvent(),
    ]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts).toEqual([
      {
        type: 'tool-call',
        state: 'input-available',
        toolCallId: 'fc-1',
        toolName: 'show_component_list',
        input: { region: 'patagonia' },
      },
    ]);
  });

  it('maps a function response to ToolCallPart{state:"output-available"} with carried-forward input', async () => {
    const events = stream([
      functionCallEvent({ id: 'fc-2', name: 'illustrate', args: { subject: 'glacier' } }),
      functionResponseEvent({ id: 'fc-2', name: 'illustrate', response: { url: 'https://x/y' } }),
      turnCompleteEvent(),
    ]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts).toEqual([
      {
        type: 'tool-call',
        state: 'input-available',
        toolCallId: 'fc-2',
        toolName: 'illustrate',
        input: { subject: 'glacier' },
      },
      {
        type: 'tool-call',
        state: 'output-available',
        toolCallId: 'fc-2',
        toolName: 'illustrate',
        input: { subject: 'glacier' },
        output: { url: 'https://x/y' },
      },
    ]);
  });

  it('surfaces error envelopes as a prefixed TextPart (never silently drops)', async () => {
    const events = stream([errorEvent('RATE_LIMIT', 'Too many requests'), turnCompleteEvent()]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts).toEqual([{ type: 'text', text: '[error:RATE_LIMIT] Too many requests' }]);
  });
});

describe('adkEventsToParts — <fyi> extraction through the BlockParser', () => {
  it('extracts an inline <fyi> from a single text event', async () => {
    const events = stream([
      textEvent('Let me check. <fyi>Loading trips…</fyi> Here are some options.'),
      turnCompleteEvent(),
    ]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts).toEqual([
      { type: 'text', text: 'Let me check. ' },
      {
        type: 'data-fyi',
        data: { message: 'Loading trips…', timestamp: '2026-04-22T12:00:00.000Z' },
      },
      { type: 'text', text: ' Here are some options.' },
    ]);
  });

  it('extracts an <fyi> that straddles two text events', async () => {
    const events = stream([
      textEvent('before <fyi>Checking', { partial: true }),
      textEvent(' availability</fyi> after', { partial: true }),
      turnCompleteEvent(),
    ]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts).toEqual([
      { type: 'text', text: 'before ' },
      {
        type: 'data-fyi',
        data: { message: 'Checking availability', timestamp: '2026-04-22T12:00:00.000Z' },
      },
      { type: 'text', text: ' after' },
    ]);
  });
});

describe('adkEventsToParts — contract compliance', () => {
  it('every emitted part parses against the shared MessagePartSchema', async () => {
    const events = stream([
      thoughtEvent('planning'),
      textEvent('Hi <fyi>Checking…</fyi> there.'),
      functionCallEvent({ id: 'c1', name: 'get_library_data', args: {} }),
      functionResponseEvent({ id: 'c1', name: 'get_library_data', response: { ok: true } }),
      errorEvent('SOFT', 'minor'),
      turnCompleteEvent(),
    ]);
    const parts = await collect(adkEventsToParts(events, { now: FIXED_NOW }));
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) {
      expect(() => MessagePartSchema.parse(p)).not.toThrow();
    }
  });
});

describe('translateAdkStream — end-to-end (mapper + reasoning filter)', () => {
  it('strips reasoning parts entirely from the outbound stream', async () => {
    const events = stream([
      thoughtEvent('internal plan'),
      textEvent('visible one'),
      thoughtEvent('internal two'),
      textEvent(' visible two'),
      turnCompleteEvent(),
    ]);
    const parts = await collect(translateAdkStream(events, { now: FIXED_NOW }));
    expect(parts).toEqual([
      { type: 'text', text: 'visible one' },
      { type: 'text', text: ' visible two' },
    ]);
    for (const p of parts) {
      // Hard invariant: no reasoning reaches outbound.
      expect(p.type).not.toBe('reasoning');
    }
  });

  it('passes reasoning parts to the onFiltered sink (session-history hook)', async () => {
    const events = stream([
      thoughtEvent('first thought'),
      textEvent('reply'),
      thoughtEvent('second thought'),
      turnCompleteEvent(),
    ]);
    const sunk: MessagePart[] = [];
    await collect(
      translateAdkStream(events, {
        now: FIXED_NOW,
        onFiltered: (p) => sunk.push(p),
      }),
    );
    expect(sunk).toEqual([
      { type: 'reasoning', text: 'first thought' },
      { type: 'reasoning', text: 'second thought' },
    ]);
  });

  it('preserves tool-call lifecycle ordering through the filter', async () => {
    const events = stream([
      textEvent('Looking it up. '),
      functionCallEvent({ id: 'a', name: 'show_component_detail', args: { id: 'X' } }),
      thoughtEvent('internal reasoning about the tool result'),
      functionResponseEvent({ id: 'a', name: 'show_component_detail', response: { title: 'T' } }),
      textEvent('Done.'),
      turnCompleteEvent(),
    ]);
    const parts = await collect(translateAdkStream(events, { now: FIXED_NOW }));
    const states = parts
      .filter((p): p is Extract<MessagePart, { type: 'tool-call' }> => p.type === 'tool-call')
      .map((p) => p.state);
    expect(states).toEqual(['input-available', 'output-available']);
    // No reasoning leaked.
    expect(parts.some((p) => p.type === 'reasoning')).toBe(false);
  });
});
