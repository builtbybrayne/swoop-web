/**
 * Unit tests for `queryRegionBaseCardsByFilter` — the v3 region-base data
 * primitive. Mocks `pg.PoolClient` so the suite runs without a live
 * `puma_dev` Postgres.
 *
 * Per Tier-3 plan `planning/03-exec-crosscut-find-options-v3-backfill.md`
 * §2.2 (task code BF-FO-v3-3).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type pg from 'pg';

import { RegionBaseProposalCardSchema } from '@swoop/common';

import { queryRegionBaseCardsByFilter } from '../query-region-bases.js';

vi.mock('../resolve-image.js', () => ({
  resolveImageById: vi.fn(),
  resolveImagesByIds: vi.fn(),
}));

import { resolveImagesByIds } from '../resolve-image.js';

const mockResolveImages = resolveImagesByIds as unknown as ReturnType<
  typeof vi.fn
>;

interface QueryResult {
  rows: Record<string, unknown>[];
}

function makeMockClient(
  queryImpl: (sql: string, binds: unknown[]) => Promise<QueryResult>,
): pg.PoolClient {
  return {
    query: vi.fn(queryImpl),
  } as unknown as pg.PoolClient;
}

beforeEach(() => {
  mockResolveImages.mockReset();
  mockResolveImages.mockResolvedValue(new Map());
});

describe('queryRegionBaseCardsByFilter', () => {
  it('returns an empty array when the SQL result has no rows', async () => {
    const client = makeMockClient(async () => ({ rows: [] }));
    const out = await queryRegionBaseCardsByFilter(client, { limit: 4 });
    expect(out).toEqual([]);
  });

  it('threads region filter into the bind array (ILIKE %region%)', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryRegionBaseCardsByFilter(client, {
      region: 'patagonia',
      limit: 4,
    });

    expect(queryFn).toHaveBeenCalledOnce();
    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ILIKE/);
    expect(binds).toContain('%patagonia%');
  });

  it('maps a populated row to a RegionBaseProposalCard with image hydration', async () => {
    mockResolveImages.mockResolvedValueOnce(
      new Map([
        [
          77,
          {
            id: 77,
            canonicalUrl: 'https://swoop-patagonia.imgix.net/el-calafate.jpg',
            altText: 'glacier town',
            description: 'glacier town',
            subjectTags: [],
            moodTags: [],
            regionTags: [],
          },
        ],
      ]),
    );
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 12,
          alias: 'el-calafate',
          headline: 'El Calafate',
          country_name: 'Argentina',
          canonical_url:
            'https://www.swoop-patagonia.com/argentina/el-calafate',
          image_id: 77,
          vibe_line_source:
            'A glacier town on the southern edge of Lago Argentino. ' +
            'Great base for Perito Moreno.',
          nearby_trips_count: 8,
        },
      ],
    }));

    const out = await queryRegionBaseCardsByFilter(client, { limit: 4 });

    expect(out).toHaveLength(1);
    const card = out[0]!;
    // Discriminator pinned.
    expect(card.type).toBe('region_base');
    expect(card.id).toBe('12');
    expect(card.slug).toBe('el-calafate');
    expect(card.headline).toBe('El Calafate');
    expect(card.region).toBe('Argentina');
    expect(card.vibeLine).toBe(
      'A glacier town on the southern edge of Lago Argentino.',
    );
    expect(card.canonicalUrl).toBe(
      'https://www.swoop-patagonia.com/argentina/el-calafate',
    );
    expect(card.nearbyTripsCount).toBe(8);
    // region_bases have no price — fromPrice must be null so the UI drops
    // the price line (per v1 rule).
    expect(card.fromPrice).toBeNull();
    expect(card.currencyCode).toBeUndefined();
    expect(card.image).toBeDefined();
    expect(card.image?.id).toBe(77);
    // Schema parse round-trip must succeed.
    expect(() => RegionBaseProposalCardSchema.parse(card)).not.toThrow();
  });

  it('returns a card with no `image` field when image_id is null', async () => {
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 22,
          alias: 'puerto-natales',
          headline: 'Puerto Natales',
          country_name: 'Chile',
          canonical_url:
            'https://www.swoop-patagonia.com/chile/puerto-natales',
          image_id: null,
          vibe_line_source: null,
          nearby_trips_count: 3,
        },
      ],
    }));

    const out = await queryRegionBaseCardsByFilter(client, { limit: 4 });

    expect(out).toHaveLength(1);
    expect(out[0]!.image).toBeUndefined();
    // No vibeLine when source is null.
    expect(out[0]!.vibeLine).toBeUndefined();
  });

  it('coerces nearby_trips_count to a number (handles bigint-typed pg return)', async () => {
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 5,
          alias: 'ushuaia',
          headline: 'Ushuaia',
          country_name: 'Argentina',
          canonical_url: 'https://www.swoop-patagonia.com/argentina/ushuaia',
          image_id: null,
          vibe_line_source: null,
          // pg returns COUNT(*) as a string by default — defensive coercion test.
          nearby_trips_count: '12',
        },
      ],
    }));

    const out = await queryRegionBaseCardsByFilter(client, { limit: 4 });

    expect(out[0]!.nearbyTripsCount).toBe(12);
    expect(typeof out[0]!.nearbyTripsCount).toBe('number');
  });

  it('passes the limit through to LIMIT bind', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryRegionBaseCardsByFilter(client, { limit: 5 });

    const [, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(binds[binds.length - 1]).toBe(5);
  });

  it('coerces nearby_trips_count to 0 when null (defensive)', async () => {
    // This can happen if the area_trip_count CTE has no row for an area —
    // but the SQL's WHERE atc.trip_count >= 1 should prevent it surfacing.
    // The mapper still defends against null defensively.
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 99,
          alias: 'bariloche',
          headline: 'Bariloche',
          country_name: 'Argentina',
          canonical_url:
            'https://www.swoop-patagonia.com/argentina/bariloche',
          image_id: null,
          vibe_line_source: null,
          nearby_trips_count: null,
        },
      ],
    }));

    const out = await queryRegionBaseCardsByFilter(client, { limit: 4 });
    expect(out[0]!.nearbyTripsCount).toBe(0);
  });
});
