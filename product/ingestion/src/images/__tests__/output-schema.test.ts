/**
 * Unit tests for the output schema + skip-signal helper. Self-contained;
 * no Postgres / Anthropic involvement.
 */

import { describe, expect, it } from 'vitest';
import { ImageAnnotationOutputSchema, isSkipSignal } from '../output-schema.js';

describe('ImageAnnotationOutputSchema', () => {
  it('accepts a valid {description, annotation} object', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: 'Granite towers at golden hour.',
      annotation: 'Three peaks lit by sunset, lake foreground.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts both fields blank — the explicit skip signal', () => {
    const result = ImageAnnotationOutputSchema.safeParse({
      description: '',
      annotation: '',
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
  it('returns true when both fields are empty strings', () => {
    expect(isSkipSignal({ description: '', annotation: '' })).toBe(true);
  });

  it('returns true when both fields are whitespace-only', () => {
    expect(isSkipSignal({ description: '   ', annotation: '\n\t  ' })).toBe(true);
  });

  it('returns false when description is populated', () => {
    expect(isSkipSignal({ description: 'foo', annotation: '' })).toBe(false);
  });

  it('returns false when annotation is populated', () => {
    expect(isSkipSignal({ description: '', annotation: 'bar' })).toBe(false);
  });

  it('returns false when both are populated', () => {
    expect(isSkipSignal({ description: 'foo', annotation: 'bar' })).toBe(false);
  });
});
