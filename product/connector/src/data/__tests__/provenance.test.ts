/**
 * Unit tests for the provenance projection helpers (crosscut
 * retrieval-provenance plan, Luke L2 + D1, 2026-06-10).
 *
 * Pure utility — narrow failure modes, cheap fixtures, per the product
 * testing posture. The omitted-when-null contract matters: Public schemas
 * expose sourceTitle / publishedAt as OPTIONAL keys, and the token-saving
 * behaviour relies on absent keys, not explicit nulls.
 */

import { describe, expect, it } from 'vitest';

import { provenanceFields, publishedAtIso } from '../provenance.js';

describe('publishedAtIso', () => {
  it('formats a Date to YYYY-MM-DD', () => {
    expect(publishedAtIso(new Date('2011-01-15T10:30:00Z'))).toBe('2011-01-15');
  });

  it('accepts an ISO string', () => {
    expect(publishedAtIso('2019-11-02T00:00:00Z')).toBe('2019-11-02');
  });

  it('returns undefined for null / undefined', () => {
    expect(publishedAtIso(null)).toBeUndefined();
    expect(publishedAtIso(undefined)).toBeUndefined();
  });

  it('returns undefined for an invalid date string', () => {
    expect(publishedAtIso('not-a-date')).toBeUndefined();
  });
});

describe('provenanceFields', () => {
  it('projects both fields when populated', () => {
    expect(
      provenanceFields({
        source_title: 'Patagonia on a Budget',
        source_published_at: new Date('2011-01-15T00:00:00Z'),
      }),
    ).toEqual({
      sourceTitle: 'Patagonia on a Budget',
      publishedAt: '2011-01-15',
    });
  });

  it('omits keys (not nulls) when columns are null — the token-saving contract', () => {
    const out = provenanceFields({ source_title: null, source_published_at: null });
    expect(out).toEqual({});
    expect('sourceTitle' in out).toBe(false);
    expect('publishedAt' in out).toBe(false);
  });

  it('omits blank / whitespace-only titles', () => {
    expect(provenanceFields({ source_title: '   ', source_published_at: null })).toEqual({});
  });

  it('handles each field independently', () => {
    expect(
      provenanceFields({ source_title: 'Torres del Paine Guide', source_published_at: null }),
    ).toEqual({ sourceTitle: 'Torres del Paine Guide' });
    expect(
      provenanceFields({ source_title: null, source_published_at: '2020-03-09' }),
    ).toEqual({ publishedAt: '2020-03-09' });
  });

  it('tolerates rows that lack the columns entirely', () => {
    expect(provenanceFields({})).toEqual({});
  });
});
