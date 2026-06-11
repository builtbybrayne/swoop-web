/**
 * Unit tests for `queryTourCardsByFilter` — focused on the 2026-06-11
 * filter-sparsity hot-patch sibling extension (activity_tags is {} and
 * accommodation_style NULL on all 11 tour rows; both hard clauses guaranteed
 * zero results) plus the deliberately-soft clauses that remain. Mirrors
 * `query-hotels.test.ts`'s mock shape.
 * See planning/reviews/2026-06-11-widget-emptiness-diagnosis.md §3 M1.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type pg from 'pg';

import { queryTourCardsByFilter } from '../query-tour-cards.js';

vi.mock('../resolve-image.js', () => ({
  resolveImageById: vi.fn(),
  resolveImagesByIds: vi.fn(),
}));

import { resolveImagesByIds } from '../resolve-image.js';

const mockResolveImages = resolveImagesByIds as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  mockResolveImages.mockReset();
  mockResolveImages.mockResolvedValue(new Map());
});

describe('queryTourCardsByFilter', () => {
  it('accepts activity without adding it to the SQL (tour_card.activity_tags {} on all 11 rows — 2026-06-11 sibling extension)', async () => {
    // "kayaking tours" → 0 of 11 under the former `= ANY(activity_tags)`
    // hard clause; the agent reads activityTags off returned cards instead.
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryTourCardsByFilter(client, { activity: 'kayaking', limit: 4 });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(binds).not.toContain('kayaking');
    expect(sql).not.toMatch(/= ANY\(activity_tags\)\s+/);
    expect(sql).not.toMatch(/WHERE[\s\S]*activity_tags/);
  });

  it('accepts accommodationStyle without adding it to the SQL (NULL on all 11 rows — 2026-06-11 sibling extension)', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryTourCardsByFilter(client, {
      accommodationStyle: 'lodge',
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(binds).not.toContain('%lodge%');
    expect(sql).not.toMatch(/accommodation_style\s+ILIKE/);
  });

  it('budgetBand + groupSizeMax keep their NULL-tolerant soft clauses (unpriced/unsized tours pass)', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryTourCardsByFilter(client, {
      budgetBand: 'mid',
      groupSizeMax: 12,
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/from_price IS NULL OR from_price <=/);
    expect(sql).toMatch(/group_size_max IS NULL OR group_size_max <=/);
    expect(binds).toContain(5_000);
    expect(binds).toContain(12);
  });
});
