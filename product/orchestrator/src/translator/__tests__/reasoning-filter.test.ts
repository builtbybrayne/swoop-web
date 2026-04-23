/**
 * reasoning-filter tests.
 *
 * The reasoning invariant (planning/02-impl-agent-runtime.md §2.4) is a hard
 * requirement — no reasoning part ever appears in the outbound iterator. The
 * filter is the enforcement point; these tests prove it.
 */

import { describe, it, expect } from 'vitest';

import type { MessagePart } from '@swoop/common';

import { filterReasoning } from '../reasoning-filter.js';

async function* fromArray<T>(arr: readonly T[]): AsyncGenerator<T, void, void> {
  for (const v of arr) yield v;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('filterReasoning', () => {
  it('passes non-reasoning parts through unchanged', async () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: ' world' },
    ];
    const out = await collect(filterReasoning(fromArray(parts)));
    expect(out).toEqual(parts);
  });

  it('strips reasoning parts from the outbound stream', async () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'visible' },
      { type: 'reasoning', text: 'secret thought' },
      { type: 'text', text: 'also visible' },
    ];
    const out = await collect(filterReasoning(fromArray(parts)));
    expect(out).toEqual([
      { type: 'text', text: 'visible' },
      { type: 'text', text: 'also visible' },
    ]);
  });

  it('hands filtered reasoning parts to the sink in order', async () => {
    const parts: MessagePart[] = [
      { type: 'reasoning', text: 'first' },
      { type: 'text', text: 't' },
      { type: 'reasoning', text: 'second' },
    ];
    const sunk: MessagePart[] = [];
    await collect(filterReasoning(fromArray(parts), (p) => sunk.push(p)));
    expect(sunk).toEqual([
      { type: 'reasoning', text: 'first' },
      { type: 'reasoning', text: 'second' },
    ]);
  });

  it('never yields a reasoning part for a stream containing only reasoning', async () => {
    const parts: MessagePart[] = [
      { type: 'reasoning', text: 'a' },
      { type: 'reasoning', text: 'b' },
    ];
    const out = await collect(filterReasoning(fromArray(parts)));
    expect(out).toEqual([]);
  });

  it('uses a no-op sink when none is supplied (no crash)', async () => {
    const parts: MessagePart[] = [{ type: 'reasoning', text: 'x' }];
    await expect(collect(filterReasoning(fromArray(parts)))).resolves.toEqual([]);
  });
});
