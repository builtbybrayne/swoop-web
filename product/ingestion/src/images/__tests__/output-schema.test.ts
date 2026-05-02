/**
 * Unit tests for the output schema + skip-signal helper. Self-contained;
 * no Postgres / Anthropic involvement.
 *
 * Post-fold (2026-05-02): the schema gained four tag arrays
 * (subject_tags, mood_tags, region_tags, tags) — they default to [] so
 * older "two-prose-fields" responses still parse, but a complete model
 * response now includes all six.
 */

import { describe, expect, it } from 'vitest';
import { ImageAnnotationOutputSchema, isSkipSignal } from '../output-schema.js';

describe('ImageAnnotationOutputSchema', () => {
  it('accepts a valid two-prose-field object (tag arrays default to [])', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: 'Granite towers at golden hour.',
      annotation: 'Three peaks lit by sunset, lake foreground.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subject_tags).toEqual([]);
      expect(result.data.mood_tags).toEqual([]);
      expect(result.data.region_tags).toEqual([]);
      expect(result.data.tags).toEqual([]);
    }
  });

  it('accepts a full six-output object (post-fold canonical shape)', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: 'Granite towers at golden hour.',
      annotation: 'Three peaks lit by sunset, lake foreground.',
      subject_tags: ['granite', 'tower', 'lake'],
      mood_tags: ['golden-hour', 'vast'],
      region_tags: ['torres-del-paine'],
      tags: ['clear', 'summer'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subject_tags).toEqual(['granite', 'tower', 'lake']);
      expect(result.data.mood_tags).toEqual(['golden-hour', 'vast']);
      expect(result.data.region_tags).toEqual(['torres-del-paine']);
      expect(result.data.tags).toEqual(['clear', 'summer']);
    }
  });

  it('accepts both prose fields blank — the explicit skip signal', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: '',
      annotation: '',
      subject_tags: [],
      mood_tags: [],
      region_tags: [],
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing description', () => {
    const result = ImageAnnotationOutputSchema.safeParse({ annotation: 'foo' });
    expect(result.success).toBe(false);
  });

  it('rejects missing annotation', () => {
    const result = ImageAnnotationOutputSchema.safeParse({ description: 'foo' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string description', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: 123,
      annotation: 'foo',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-array subject_tags', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: 'd',
      annotation: 'a',
      subject_tags: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string entries inside tag arrays', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: 'd',
      annotation: 'a',
      subject_tags: ['granite', 42],
    });
    expect(result.success).toBe(false);
  });

  it('rejects extra keys (strict)', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: 'foo',
      annotation: 'bar',
      extra: 'oops',
    });
    expect(result.success).toBe(false);
  });
});

describe('isSkipSignal', () => {
  it('returns true when both prose fields are empty strings', () => {
    expect(
      isSkipSignal({
        description: '',
        annotation: '',
        subject_tags: [],
        mood_tags: [],
        region_tags: [],
        tags: [],
      }),
    ).toBe(true);
  });

  it('returns true when both prose fields are whitespace-only (tag arrays ignored)', () => {
    expect(
      isSkipSignal({
        description: '   ',
        annotation: '\n\t  ',
        subject_tags: ['ignored'],
        mood_tags: [],
        region_tags: [],
        tags: [],
      }),
    ).toBe(true);
  });

  it('returns false when description is populated', () => {
    expect(
      isSkipSignal({
        description: 'foo',
        annotation: '',
        subject_tags: [],
        mood_tags: [],
        region_tags: [],
        tags: [],
      }),
    ).toBe(false);
  });

  it('returns false when annotation is populated', () => {
    expect(
      isSkipSignal({
        description: '',
        annotation: 'bar',
        subject_tags: [],
        mood_tags: [],
        region_tags: [],
        tags: [],
      }),
    ).toBe(false);
  });

  it('returns false when both prose fields are populated', () => {
    expect(
      isSkipSignal({
        description: 'foo',
        annotation: 'bar',
        subject_tags: [],
        mood_tags: [],
        region_tags: [],
        tags: [],
      }),
    ).toBe(false);
  });
});
