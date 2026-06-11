/**
 * Unit tests for `queryHotelCardsByFilter` — the v3 hotel data primitive.
 *
 * Per Tier-3 plan `planning/03-exec-crosscut-find-options-v3-backfill.md`
 * (task code BF-FO-v3). Mocks `pg.PoolClient` so the suite runs without a
 * live `puma_dev` Postgres. SQL-shape correctness against real data is
 * verified downstream by the live-data smoke (plan §5).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type pg from 'pg';

import { HotelProposalCardSchema } from '@swoop/common';

import { queryHotelCardsByFilter } from '../query-hotels.js';

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

describe('queryHotelCardsByFilter', () => {
  it('returns an empty array when the SQL result has no rows', async () => {
    const client = makeMockClient(async () => ({ rows: [] }));
    const out = await queryHotelCardsByFilter(client, { limit: 4 });
    expect(out).toEqual([]);
  });

  it('threads region filter into the bind array (ILIKE %region%)', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryHotelCardsByFilter(client, {
      region: 'torres del paine',
      limit: 4,
    });

    expect(queryFn).toHaveBeenCalledOnce();
    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ILIKE/);
    expect(binds).toContain('%torres del paine%');
  });

  it('accepts accommodationStyle without adding it to the SQL (no dedicated source column for hotel accommodation style)', async () => {
    // accommodationStyle is accepted-and-ignored: there is no dedicated
    // accommodation-style column on hotel in the source data. The field is
    // carried on the schema for forward compatibility but not filtered in SQL.
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryHotelCardsByFilter(client, {
      accommodationStyle: 'lodge',
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    // No accommodationStyle bind or ILIKE against h.description.
    expect(binds).not.toContain('%lodge%');
    expect(sql).not.toMatch(/h\.description\s+ILIKE/);
  });

  it('threads budgetBand into a price-ceiling HAVING clause', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    // budget band 'mid' → ceiling 800 per-night (per-night scale; recalibrated
    // from the trip-scale 5000 GBP at C.goofy-goldstine plan §2.3).
    await queryHotelCardsByFilter(client, {
      budgetBand: 'mid',
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/HAVING|having/);
    expect(binds).toContain(800);
  });

  it('does NOT add a HAVING clause when budgetBand is luxury (POSITIVE_INFINITY ceiling)', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryHotelCardsByFilter(client, {
      budgetBand: 'luxury',
      limit: 4,
    });

    const [sql] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/HAVING/i);
  });

  it('maps a populated row to a HotelProposalCard with image hydration', async () => {
    mockResolveImages.mockResolvedValueOnce(
      new Map([
        [
          501,
          {
            id: 501,
            canonicalUrl: 'https://swoop-patagonia.imgix.net/hotel.jpg',
            altText: 'lodge',
            description: 'a lodge',
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
          slug: 'tierra-patagonia',
          headline: 'Tierra Patagonia',
          vibe_line_source:
            'A wilderness lodge perched on the edge of Torres del Paine. ' +
            'The bar has a fireplace.',
          star_rating: 5,
          canonical_url:
            'https://www.swoop-patagonia.com/chile/torres-del-paine/lodges/tierra-patagonia',
          page_id: 99,
          location: 'Torres del Paine',
          region: 'Patagonia',
          from_price: 480,
          currency_code: 'USD',
          page_image_id: 501,
        },
      ],
    }));

    const out = await queryHotelCardsByFilter(client, { limit: 4 });

    expect(out).toHaveLength(1);
    const card = out[0]!;
    // Discriminator pinned.
    expect(card.type).toBe('hotel');
    // pricingUnit literal pinned (v1 contract requires it on every hotel).
    expect(card.pricingUnit).toBe('per_night');
    expect(card.id).toBe('12');
    expect(card.slug).toBe('tierra-patagonia');
    expect(card.headline).toBe('Tierra Patagonia');
    // Full pass-through (UI handles clamping + expansion) per
    // planning/03-exec-crosscut-brave-pare-card-expandable-prose.md.
    expect(card.vibeLine).toBe(
      'A wilderness lodge perched on the edge of Torres del Paine. ' +
        'The bar has a fireplace.',
    );
    expect(card.starRating).toBe(5);
    expect(card.location).toBe('Torres del Paine');
    expect(card.region).toBe('Patagonia');
    expect(card.fromPrice).toBe(480);
    expect(card.currencyCode).toBe('USD');
    expect(card.canonicalUrl).toBe(
      'https://www.swoop-patagonia.com/chile/torres-del-paine/lodges/tierra-patagonia',
    );
    expect(card.image).toBeDefined();
    expect(card.image?.id).toBe(501);
    // Schema parse round-trip must succeed.
    expect(() => HotelProposalCardSchema.parse(card)).not.toThrow();
  });

  it('returns a card with no `image` field when page_image_id is null', async () => {
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 33,
          slug: 'rio-serrano',
          headline: 'Rio Serrano',
          vibe_line_source: null,
          star_rating: 4,
          canonical_url:
            'https://www.swoop-patagonia.com/chile/torres-del-paine/hotels/rio-serrano',
          page_id: null,
          location: 'Torres del Paine',
          region: 'Patagonia',
          from_price: 320,
          currency_code: 'USD',
          page_image_id: null,
        },
      ],
    }));

    const out = await queryHotelCardsByFilter(client, { limit: 4 });

    expect(out).toHaveLength(1);
    expect(out[0]!.image).toBeUndefined();
    // No vibeLine when description is null.
    expect(out[0]!.vibeLine).toBeUndefined();
  });

  it('skips a row that lacks both canonical_url AND slug (no deep-link possible)', async () => {
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 77,
          slug: null,
          headline: 'Mystery Hotel',
          vibe_line_source: null,
          star_rating: null,
          canonical_url: null,
          page_id: null,
          location: null,
          region: null,
          from_price: null,
          currency_code: null,
          page_image_id: null,
        },
      ],
    }));

    const out = await queryHotelCardsByFilter(client, { limit: 4 });
    expect(out).toEqual([]);
  });

  it('clamps star_rating values outside 1-5 to undefined (defensive against dirty source data)', async () => {
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 88,
          slug: 'unknown-star',
          headline: 'Unknown Stars',
          vibe_line_source: null,
          star_rating: 9, // bogus
          canonical_url:
            'https://www.swoop-patagonia.com/chile/x/hotels/unknown-star',
          page_id: null,
          location: null,
          region: null,
          from_price: null,
          currency_code: null,
          page_image_id: null,
        },
        {
          id: 89,
          slug: 'zero-star',
          headline: 'Zero Stars',
          vibe_line_source: null,
          star_rating: 0, // out of range
          canonical_url:
            'https://www.swoop-patagonia.com/chile/x/hotels/zero-star',
          page_id: null,
          location: null,
          region: null,
          from_price: null,
          currency_code: null,
          page_image_id: null,
        },
      ],
    }));

    const out = await queryHotelCardsByFilter(client, { limit: 4 });
    expect(out).toHaveLength(2);
    expect(out[0]!.starRating).toBeUndefined();
    expect(out[1]!.starRating).toBeUndefined();
  });

  it('passes the limit through to LIMIT bind', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await queryHotelCardsByFilter(client, { limit: 7 });

    const [, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(binds[binds.length - 1]).toBe(7);
  });
});
