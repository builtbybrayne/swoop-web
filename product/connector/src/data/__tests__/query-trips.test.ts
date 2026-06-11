/**
 * Unit tests for `queryTripCardsByFilter` — focused on the 2026-06-11
 * filter-sparsity hot-patch sibling extension (accommodation_style is 0/649
 * populated in puma_dev; its ILIKE clause guaranteed zero results) plus the
 * still-live viable filters. Mirrors `query-hotels.test.ts`'s mock shape.
 * See planning/reviews/2026-06-11-widget-emptiness-diagnosis.md §3 M1.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type pg from 'pg';

import { queryTripCardsByFilter } from '../query-trips.js';

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

describe('queryTripCardsByFilter', () => {
  it('accepts accommodationStyle without adding it to the SQL (trip_card.accommodation_style 0/649 populated — 2026-06-11 sibling extension)', async () => {
    // Live proof at diagnosis time: TdP trips matching the region filter = 151
    // without the style clause, 0 with it ("lodge-based trip" → zero results).
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryTripCardsByFilter(client, {
      accommodationStyle: 'lodge',
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(binds).not.toContain('%lodge%');
    expect(sql).not.toMatch(/accommodation_style\s+ILIKE/);
  });

  it('still threads the viable filters: region (517/649) + activity (466/649)', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryTripCardsByFilter(client, {
      region: 'torres del paine',
      activity: 'hiking',
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/region\s+ILIKE/);
    expect(sql).toMatch(/= ANY\(activity_tags\)/);
    expect(binds).toContain('%torres del paine%');
    expect(binds).toContain('hiking');
  });

  it('budgetBand composes the NULL-tolerant soft clause (unpriced trips pass)', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryTripCardsByFilter(client, { budgetBand: 'mid', limit: 4 });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/from_price IS NULL OR from_price <=/);
    expect(binds).toContain(5_000);
  });
});
