import { describe, it, expect } from 'vitest';
import {
  BlogPostJobOutputSchema,
  PersonaSummaryOutputSchema,
  BlogTagNormalisationOutputSchema,
  CLASSIFIER_SCHEMAS,
} from '../schemas.js';

describe('BlogPostJobOutputSchema', () => {
  it('accepts valid output', () => {
    const r = BlogPostJobOutputSchema.safeParse({
      primary_job: 'inspire',
      secondary_jobs: ['inform'],
      reasoning: 'travelogue',
    });
    expect(r.success).toBe(true);
  });

  it('accepts default empty secondary_jobs', () => {
    const r = BlogPostJobOutputSchema.safeParse({ primary_job: 'mirror' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid primary_job', () => {
    const r = BlogPostJobOutputSchema.safeParse({ primary_job: 'foo' });
    expect(r.success).toBe(false);
  });

  it('rejects more than 2 secondary_jobs', () => {
    const r = BlogPostJobOutputSchema.safeParse({
      primary_job: 'inspire',
      secondary_jobs: ['inform', 'reassure', 'mirror'],
    });
    expect(r.success).toBe(false);
  });
});

describe('PersonaSummaryOutputSchema', () => {
  it('accepts valid output', () => {
    const r = PersonaSummaryOutputSchema.safeParse({
      persona_summary: 'A retired couple who took the W trek.',
      reviewer_name: 'Margaret W',
      region_hint: 'Patagonia',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty persona_summary', () => {
    const r = PersonaSummaryOutputSchema.safeParse({
      persona_summary: '',
      reviewer_name: 'X',
    });
    expect(r.success).toBe(false);
  });
});

// ImageAnnotationOutputSchema retired 2026-05-02: folded into C.t6's
// unified Vision call. Its replacement schema (with description +
// annotation + 4 tag arrays) lives at
// product/ingestion/src/images/output-schema.ts and is exercised by
// product/ingestion/src/images/__tests__/output-schema.test.ts.

describe('BlogTagNormalisationOutputSchema', () => {
  it('accepts ids + unmapped', () => {
    const r = BlogTagNormalisationOutputSchema.safeParse({
      ntag_ids: [1, 2, 3],
      unmapped_raw_tags: ['featured'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts empty arrays', () => {
    const r = BlogTagNormalisationOutputSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('rejects non-positive ids', () => {
    const r = BlogTagNormalisationOutputSchema.safeParse({ ntag_ids: [0, -1] });
    expect(r.success).toBe(false);
  });
});

describe('CLASSIFIER_SCHEMAS', () => {
  it('exposes the three live classifier names (image-annotation retired 2026-05-02)', () => {
    const keys = Object.keys(CLASSIFIER_SCHEMAS);
    expect(keys).toContain('blog-post-job');
    expect(keys).toContain('persona-summary');
    expect(keys).toContain('blog-tag-normalisation');
    expect(keys).not.toContain('image-annotation');
  });
});
