/**
 * block-parser tests.
 *
 * State-machine `<fyi>` extraction. Covers every failure mode named in
 * planning/02-impl-agent-runtime.md §2.5a for the parser that was actually
 * built (scoped to `<fyi>` only, per decision B.9 in decisions.md):
 *
 *   - Inline tags (no newline required).
 *   - 0 / 1 / many blocks per stream.
 *   - Partial blocks split across feed() calls.
 *   - Tag-like literal text that isn't a tag (`<foo>`, `<`, `<<fyi>`).
 *   - Unterminated `<fyi>` at end().
 *   - Text containing `<` inside an `<fyi>` body.
 */

import { describe, it, expect } from 'vitest';

import type { MessagePart } from '@swoop/common';

import { BlockParser } from '../block-parser.js';

const FIXED_NOW = () => new Date('2026-04-22T12:00:00.000Z');

function runFull(input: string): MessagePart[] {
  const p = new BlockParser({ now: FIXED_NOW });
  return [...p.feed(input), ...p.end()];
}

describe('BlockParser — happy paths', () => {
  it('emits a single TextPart for plain text with no tags', () => {
    expect(runFull('Hello, Patagonia.')).toEqual([
      { type: 'text', text: 'Hello, Patagonia.' },
    ]);
  });

  it('emits nothing for an empty stream', () => {
    expect(runFull('')).toEqual([]);
  });

  it('extracts a single <fyi> block inline', () => {
    expect(runFull('before<fyi>Checking trips…</fyi>after')).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'data-fyi',
        data: { message: 'Checking trips…', timestamp: '2026-04-22T12:00:00.000Z' },
      },
      { type: 'text', text: 'after' },
    ]);
  });

  it('extracts multiple <fyi> blocks in order', () => {
    const out = runFull('A<fyi>one</fyi>B<fyi>two</fyi>C');
    expect(out).toEqual([
      { type: 'text', text: 'A' },
      { type: 'data-fyi', data: { message: 'one', timestamp: '2026-04-22T12:00:00.000Z' } },
      { type: 'text', text: 'B' },
      { type: 'data-fyi', data: { message: 'two', timestamp: '2026-04-22T12:00:00.000Z' } },
      { type: 'text', text: 'C' },
    ]);
  });

  it('handles <fyi> at the very start and end', () => {
    expect(runFull('<fyi>start</fyi><fyi>end</fyi>')).toEqual([
      { type: 'data-fyi', data: { message: 'start', timestamp: '2026-04-22T12:00:00.000Z' } },
      { type: 'data-fyi', data: { message: 'end', timestamp: '2026-04-22T12:00:00.000Z' } },
    ]);
  });

  it('handles an <fyi> body containing a `<` that is not a tag', () => {
    // `<x` inside the body should not be mistaken for `</fyi>` and should not
    // be stripped.
    expect(runFull('<fyi>a < b</fyi>')).toEqual([
      { type: 'data-fyi', data: { message: 'a < b', timestamp: '2026-04-22T12:00:00.000Z' } },
    ]);
  });
});

/**
 * Adjacent TextParts coalesce semantically in the wire representation — the
 * SSE consumer concatenates runs of `text` parts into a single assistant
 * utterance. For char-by-char streaming tests, collapsing adjacent TextParts
 * before assertion models the observable behaviour rather than the
 * buffer-boundary artefacts.
 */
function coalesceText(parts: MessagePart[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.type === 'text' && last && last.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + p.text };
    } else {
      out.push(p);
    }
  }
  return out;
}

describe('BlockParser — streaming robustness', () => {
  it('accepts partial blocks split across many feed() calls (char-by-char)', () => {
    const p = new BlockParser({ now: FIXED_NOW });
    const out: MessagePart[] = [];
    // Split `before<fyi>Loading…</fyi>after` char-by-char.
    const input = 'before<fyi>Loading…</fyi>after';
    for (const ch of input) {
      out.push(...p.feed(ch));
    }
    out.push(...p.end());
    // Per-char feeding legitimately fragments outside text into multiple
    // TextParts — downstream concatenates. Assert on the coalesced view.
    expect(coalesceText(out)).toEqual([
      { type: 'text', text: 'before' },
      { type: 'data-fyi', data: { message: 'Loading…', timestamp: '2026-04-22T12:00:00.000Z' } },
      { type: 'text', text: 'after' },
    ]);
  });

  it('accepts the open tag split mid-character-boundary', () => {
    const p = new BlockParser({ now: FIXED_NOW });
    const out: MessagePart[] = [];
    out.push(...p.feed('hello <'));
    out.push(...p.feed('fyi>'));
    out.push(...p.feed('msg'));
    out.push(...p.feed('</fyi>'));
    out.push(...p.feed(' tail'));
    out.push(...p.end());
    expect(out).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'data-fyi', data: { message: 'msg', timestamp: '2026-04-22T12:00:00.000Z' } },
      { type: 'text', text: ' tail' },
    ]);
  });

  it('accepts the close tag split mid-character-boundary', () => {
    const p = new BlockParser({ now: FIXED_NOW });
    const out: MessagePart[] = [];
    out.push(...p.feed('<fyi>body</'));
    out.push(...p.feed('fyi'));
    out.push(...p.feed('>'));
    out.push(...p.feed('trailer'));
    out.push(...p.end());
    expect(out).toEqual([
      { type: 'data-fyi', data: { message: 'body', timestamp: '2026-04-22T12:00:00.000Z' } },
      { type: 'text', text: 'trailer' },
    ]);
  });
});

describe('BlockParser — tag-like literals', () => {
  it('passes a non-fyi tag through as literal text', () => {
    expect(runFull('hello <foo>world')).toEqual([
      { type: 'text', text: 'hello <foo>world' },
    ]);
  });

  it('passes a lone `<` through as literal text', () => {
    expect(runFull('one < two')).toEqual([{ type: 'text', text: 'one < two' }]);
  });

  it('handles `<<fyi>` correctly (first `<` literal, second opens tag)', () => {
    expect(runFull('<<fyi>x</fyi>')).toEqual([
      { type: 'text', text: '<' },
      { type: 'data-fyi', data: { message: 'x', timestamp: '2026-04-22T12:00:00.000Z' } },
    ]);
  });

  it('handles a near-miss open tag `<fy` followed by junk', () => {
    expect(runFull('<fybad')).toEqual([{ type: 'text', text: '<fybad' }]);
  });

  it('handles a near-miss close tag `</fy` inside a body', () => {
    expect(runFull('<fyi>a</fybad</fyi>')).toEqual([
      {
        type: 'data-fyi',
        data: { message: 'a</fybad', timestamp: '2026-04-22T12:00:00.000Z' },
      },
    ]);
  });
});

describe('BlockParser — defensive end() behaviour', () => {
  it('flushes a dangling `<` at end as literal text', () => {
    expect(runFull('tail <')).toEqual([{ type: 'text', text: 'tail <' }]);
  });

  it('flushes a partial open tag at end as literal text', () => {
    expect(runFull('x<fy')).toEqual([{ type: 'text', text: 'x<fy' }]);
  });

  it('flushes an unterminated <fyi> body at end as a data-fyi part', () => {
    expect(runFull('before<fyi>unterminated')).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'data-fyi',
        data: { message: 'unterminated', timestamp: '2026-04-22T12:00:00.000Z' },
      },
    ]);
  });

  it('flushes an unterminated <fyi> with partial close tag at end', () => {
    expect(runFull('<fyi>body</fy')).toEqual([
      {
        type: 'data-fyi',
        data: { message: 'body</fy', timestamp: '2026-04-22T12:00:00.000Z' },
      },
    ]);
  });
});
