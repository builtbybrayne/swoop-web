/**
 * Unit tests for the SeenItems shared helpers.
 *
 * Plan: planning/03-exec-crosscut-anti-repetition.md §2.8.
 *
 * Scope:
 *   - defaultEmptySeenItems returns every dedup-eligible type as []
 *   - SeenItems schema rejects unknown keys via z.object default behaviour
 *     (we don't assert strict-mode rejection — the schema is not .strict()
 *     because round-tripping through ADK session state may attach metadata).
 *   - mergeSeen union-merges, de-dupes, leaves untouched keys alone.
 *   - mergeSeen with an empty delta is a no-op shape clone.
 *   - mergeSeen ignores delta keys with empty arrays.
 *   - trip / tour keys are NOT present on the schema (the carve-out is
 *     structural, per the plan).
 */

import { describe, expect, it } from 'vitest';
import { defaultEmptySeenItems, mergeSeen, SeenItemsSchema } from '../seen-items.js';

describe('defaultEmptySeenItems', () => {
  it('returns every dedup-eligible per-type array empty', () => {
    const empty = defaultEmptySeenItems();
    expect(empty).toEqual({
      inspire_passage: [],
      customer_story: [],
      trust_proof: [],
      inform_chunk: [],
      image: [],
      blog_post: [],
      hotel: [],
      region_base: [],
      customer_tip: [],
    });
  });

  it('does NOT include trip or tour keys (saleable-surface carve-out)', () => {
    const empty = defaultEmptySeenItems() as Record<string, unknown>;
    expect(empty.trip).toBeUndefined();
    expect(empty.tour).toBeUndefined();
  });
});

describe('SeenItemsSchema', () => {
  it('parses defaultEmptySeenItems cleanly', () => {
    const parsed = SeenItemsSchema.parse(defaultEmptySeenItems());
    expect(parsed.inspire_passage).toEqual([]);
  });

  it('defaults missing fields to empty arrays', () => {
    const parsed = SeenItemsSchema.parse({});
    expect(parsed.inspire_passage).toEqual([]);
    expect(parsed.image).toEqual([]);
  });

  it('parses populated arrays', () => {
    const parsed = SeenItemsSchema.parse({
      inspire_passage: ['uuid-a', 'uuid-b'],
      image: ['https://cdn.example.com/x.jpg'],
    });
    expect(parsed.inspire_passage).toEqual(['uuid-a', 'uuid-b']);
    expect(parsed.image).toEqual(['https://cdn.example.com/x.jpg']);
  });

  it('defaults the whole field to an empty shape when missing entirely', () => {
    // SeenItemsSchema.default({}) — undefined input produces a full empty shape.
    const parsed = SeenItemsSchema.parse(undefined);
    expect(parsed.inspire_passage).toEqual([]);
    expect(parsed.image).toEqual([]);
  });
});

describe('mergeSeen', () => {
  it('union-merges a delta into a base, de-duplicating', () => {
    const base = defaultEmptySeenItems();
    base.inspire_passage = ['a', 'b'];
    const out = mergeSeen(base, { inspire_passage: ['b', 'c'] });
    expect(out.inspire_passage.sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves untouched keys alone', () => {
    const base = defaultEmptySeenItems();
    base.inspire_passage = ['a'];
    base.image = ['url-1'];
    const out = mergeSeen(base, { inspire_passage: ['b'] });
    expect(out.image).toEqual(['url-1']);
  });

  it('returns a new object (does not mutate the base)', () => {
    const base = defaultEmptySeenItems();
    base.inspire_passage = ['a'];
    const out = mergeSeen(base, { inspire_passage: ['b'] });
    expect(base.inspire_passage).toEqual(['a']);
    expect(out).not.toBe(base);
  });

  it('ignores delta keys with empty / missing arrays', () => {
    const base = defaultEmptySeenItems();
    base.inspire_passage = ['a'];
    const out = mergeSeen(base, { inspire_passage: [], image: undefined });
    expect(out.inspire_passage).toEqual(['a']);
    expect(out.image).toEqual([]);
  });

  it('merges multiple types at once', () => {
    const base = defaultEmptySeenItems();
    const out = mergeSeen(base, {
      inspire_passage: ['p1'],
      image: ['https://cdn.example.com/x.jpg'],
      hotel: ['12', '13'],
    });
    expect(out.inspire_passage).toEqual(['p1']);
    expect(out.image).toEqual(['https://cdn.example.com/x.jpg']);
    expect(out.hotel).toEqual(['12', '13']);
  });

  it('empty delta produces a shape-equal output', () => {
    const base = defaultEmptySeenItems();
    base.inspire_passage = ['a'];
    const out = mergeSeen(base, {});
    expect(out).toEqual(base);
  });
});
