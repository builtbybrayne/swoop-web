/**
 * `find_options` handler — discriminated-output contract tests + v3 dispatch.
 *
 * Crosscut C.48: the handler returns `cards: ProposalCardPublic[]` — a
 * discriminated union over `trip | tour | hotel | region_base`.
 *
 * v1 (2026-05-12): only `type: 'trip'` live; every card returned MUST carry
 * that discriminator regardless of `preferredType`.
 *
 * v3 (2026-05-13 — task BF-FO-v3): hotels + region_bases land as live data
 * primitives. Handler dispatches on `preferredType`:
 *   - 'hotel'        → queryHotelCardsByFilter
 *   - 'region_base'  → queryRegionBaseCardsByFilter
 *   - 'trip'         → queryTripCardsByFilter (regression)
 *   - 'tour'         → queryTripCardsByFilter (v2-fallback pin; v2 swaps to tours)
 *   - undefined      → blendCards (mixed set across trip/hotel/region_base)
 *
 * These tests exercise the handler body with stubbed primitives so they
 * don't need a live `puma_dev` Postgres. SQL-shape correctness against
 * real data is downstream of the live-data smoke (plan §5).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FindOptionsOutputSchema } from '@swoop/common';

import { findOptionsBody } from '../find_options.js';
import type { ToolHandlerDeps } from '../deps.js';

vi.mock('../../data/query-trips.js', () => ({
  queryTripCardsByFilter: vi.fn(),
}));
vi.mock('../../data/query-hotels.js', () => ({
  queryHotelCardsByFilter: vi.fn(),
}));
vi.mock('../../data/query-region-bases.js', () => ({
  queryRegionBaseCardsByFilter: vi.fn(),
}));

import { queryTripCardsByFilter } from '../../data/query-trips.js';
import { queryHotelCardsByFilter } from '../../data/query-hotels.js';
import { queryRegionBaseCardsByFilter } from '../../data/query-region-bases.js';

const mockTrips = queryTripCardsByFilter as unknown as ReturnType<typeof vi.fn>;
const mockHotels = queryHotelCardsByFilter as unknown as ReturnType<typeof vi.fn>;
const mockRegionBases = queryRegionBaseCardsByFilter as unknown as ReturnType<
  typeof vi.fn
>;

function makeDeps(): ToolHandlerDeps {
  return {
    withClient: async (fn) =>
      fn({} as unknown as Parameters<ToolHandlerDeps['withClient']>[0] extends (
        arg: infer C,
      ) => unknown
        ? C
        : never),
    embedQuery: async () => new Array(1024).fill(0),
  };
}

const TRIP_CARD = {
  type: 'trip' as const,
  id: '1',
  headline: 'A Patagonia trip',
  canonicalUrl: 'https://example.com/trips/1',
  activityTags: [],
};
const HOTEL_CARD = {
  type: 'hotel' as const,
  id: '12',
  headline: 'Tierra Patagonia',
  canonicalUrl: 'https://example.com/hotels/12',
  pricingUnit: 'per_night' as const,
};
const REGION_BASE_CARD = {
  type: 'region_base' as const,
  id: '7',
  headline: 'El Calafate',
  canonicalUrl: 'https://example.com/regions/el-calafate',
  fromPrice: null,
  nearbyTripsCount: 8,
};

beforeEach(() => {
  mockTrips.mockReset();
  mockHotels.mockReset();
  mockRegionBases.mockReset();
});

describe('find_options handler — v1 discriminated output', () => {
  it('returns cards with `type: "trip"` on every entry when preferredType is "trip"', async () => {
    mockTrips.mockResolvedValueOnce([
      { ...TRIP_CARD, id: '1' },
      { ...TRIP_CARD, id: '2', activityTags: ['hiking'] },
    ]);

    const out = await findOptionsBody(
      { region: 'patagonia', preferredType: 'trip', limit: 4 },
      makeDeps(),
    );

    expect(out.count).toBe(2);
    expect(out.cards).toHaveLength(2);
    for (const card of out.cards) {
      expect(card.type).toBe('trip');
    }
  });

  it('validates trip output against FindOptionsOutputSchema (discriminated union)', async () => {
    mockTrips.mockResolvedValueOnce([
      {
        type: 'trip' as const,
        id: '42',
        headline: 'Torres del Paine W',
        canonicalUrl: 'https://example.com/trips/42',
        activityTags: ['hiking'],
        durationDays: 7,
        fromPrice: 2150,
        currencyCode: 'GBP',
      },
    ]);

    const out = await findOptionsBody(
      { preferredType: 'trip', limit: 4 },
      makeDeps(),
    );
    expect(() => FindOptionsOutputSchema.parse(out)).not.toThrow();
  });

  it('threads structured filters through to the trip primitive', async () => {
    mockTrips.mockResolvedValueOnce([]);
    await findOptionsBody(
      {
        region: 'patagonia',
        durationMin: 5,
        durationMax: 10,
        budgetBand: 'mid',
        activity: 'hiking',
        accommodationStyle: 'refugios',
        preferredType: 'trip',
        limit: 4,
      },
      makeDeps(),
    );
    expect(mockTrips).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        region: 'patagonia',
        durationMin: 5,
        durationMax: 10,
        budgetBand: 'mid',
        activity: 'hiking',
        accommodationStyle: 'refugios',
        limit: 4,
      }),
    );
  });
});

describe('find_options handler — v3 dispatch (BF-FO-v3)', () => {
  it('preferredType "hotel" routes to queryHotelCardsByFilter only', async () => {
    mockHotels.mockResolvedValueOnce([HOTEL_CARD]);

    const out = await findOptionsBody(
      { preferredType: 'hotel', region: 'torres del paine', limit: 4 },
      makeDeps(),
    );

    expect(mockHotels).toHaveBeenCalledOnce();
    expect(mockTrips).not.toHaveBeenCalled();
    expect(mockRegionBases).not.toHaveBeenCalled();
    expect(out.count).toBe(1);
    expect(out.cards[0]!.type).toBe('hotel');
    expect(() => FindOptionsOutputSchema.parse(out)).not.toThrow();
  });

  it('preferredType "hotel" passes region/budgetBand/accommodationStyle but NOT trip-only filters', async () => {
    mockHotels.mockResolvedValueOnce([]);

    await findOptionsBody(
      {
        preferredType: 'hotel',
        region: 'torres del paine',
        budgetBand: 'premium',
        accommodationStyle: 'lodge',
        durationMin: 5,
        durationMax: 10,
        activity: 'hiking',
        limit: 3,
      },
      makeDeps(),
    );

    const lastCall = mockHotels.mock.calls[0] as [unknown, Record<string, unknown>];
    const opts = lastCall[1];
    expect(opts).toMatchObject({
      region: 'torres del paine',
      budgetBand: 'premium',
      accommodationStyle: 'lodge',
      limit: 3,
    });
    expect(opts).not.toHaveProperty('durationMin');
    expect(opts).not.toHaveProperty('durationMax');
    expect(opts).not.toHaveProperty('activity');
  });

  it('preferredType "region_base" routes to queryRegionBaseCardsByFilter only', async () => {
    mockRegionBases.mockResolvedValueOnce([REGION_BASE_CARD]);

    const out = await findOptionsBody(
      { preferredType: 'region_base', limit: 4 },
      makeDeps(),
    );

    expect(mockRegionBases).toHaveBeenCalledOnce();
    expect(mockTrips).not.toHaveBeenCalled();
    expect(mockHotels).not.toHaveBeenCalled();
    expect(out.cards[0]!.type).toBe('region_base');
    expect(() => FindOptionsOutputSchema.parse(out)).not.toThrow();
  });

  it('preferredType "region_base" passes only region + limit (other filters ignored)', async () => {
    mockRegionBases.mockResolvedValueOnce([]);

    await findOptionsBody(
      {
        preferredType: 'region_base',
        region: 'patagonia',
        budgetBand: 'mid',
        accommodationStyle: 'lodge',
        durationMin: 5,
        activity: 'hiking',
        limit: 4,
      },
      makeDeps(),
    );

    const lastCall = mockRegionBases.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    const opts = lastCall[1];
    expect(opts).toMatchObject({ region: 'patagonia', limit: 4 });
    expect(opts).not.toHaveProperty('budgetBand');
    expect(opts).not.toHaveProperty('accommodationStyle');
    expect(opts).not.toHaveProperty('durationMin');
    expect(opts).not.toHaveProperty('activity');
  });

  it('preferredType "tour" falls back to the trip primitive (v2 fallback pin — decision C.bf-6)', async () => {
    mockTrips.mockResolvedValueOnce([TRIP_CARD]);

    const out = await findOptionsBody(
      { preferredType: 'tour', limit: 4 },
      makeDeps(),
    );

    expect(mockTrips).toHaveBeenCalledOnce();
    expect(mockHotels).not.toHaveBeenCalled();
    expect(mockRegionBases).not.toHaveBeenCalled();
    expect(out.cards[0]!.type).toBe('trip');
  });

  it('preferredType unset → blend across all three live primitives', async () => {
    mockTrips.mockResolvedValueOnce([
      { ...TRIP_CARD, id: '101' },
      { ...TRIP_CARD, id: '102' },
    ]);
    mockHotels.mockResolvedValueOnce([{ ...HOTEL_CARD, id: '201' }]);
    mockRegionBases.mockResolvedValueOnce([{ ...REGION_BASE_CARD, id: '301' }]);

    const out = await findOptionsBody({ limit: 4 }, makeDeps());

    expect(mockTrips).toHaveBeenCalledOnce();
    expect(mockHotels).toHaveBeenCalledOnce();
    expect(mockRegionBases).toHaveBeenCalledOnce();
    expect(out.count).toBe(4);
    expect(out.cards.map((c) => c.type).sort()).toEqual([
      'hotel',
      'region_base',
      'trip',
      'trip',
    ]);
    expect(() => FindOptionsOutputSchema.parse(out)).not.toThrow();
  });

  it('blend ratio for limit=4: trips=2, hotels=1, region_bases=1 (quota threading)', async () => {
    mockTrips.mockResolvedValueOnce([]);
    mockHotels.mockResolvedValueOnce([]);
    mockRegionBases.mockResolvedValueOnce([]);

    await findOptionsBody({ limit: 4 }, makeDeps());

    expect(mockTrips.mock.calls[0]![1]).toMatchObject({ limit: 2 });
    expect(mockHotels.mock.calls[0]![1]).toMatchObject({ limit: 1 });
    expect(mockRegionBases.mock.calls[0]![1]).toMatchObject({ limit: 1 });
  });

  it('blend deficit: when sub-quotas under-deliver, redistribute by querying extra trips', async () => {
    // First call (quota=2) returns 1 trip. Second call (top-up) returns 2 more.
    mockTrips
      .mockResolvedValueOnce([{ ...TRIP_CARD, id: '101' }])
      .mockResolvedValueOnce([
        { ...TRIP_CARD, id: '101' }, // duplicate (should be filtered)
        { ...TRIP_CARD, id: '102' },
        { ...TRIP_CARD, id: '103' },
      ]);
    mockHotels.mockResolvedValueOnce([]);
    mockRegionBases.mockResolvedValueOnce([]);

    const out = await findOptionsBody({ limit: 4 }, makeDeps());

    expect(mockTrips).toHaveBeenCalledTimes(2);
    // No duplicate ids in the output.
    const ids = out.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.count).toBeLessThanOrEqual(4);
  });

  it('blend respects limit=2 (1 trip + 1 hotel, no region_base)', async () => {
    mockTrips.mockResolvedValueOnce([]);
    mockHotels.mockResolvedValueOnce([]);
    mockRegionBases.mockResolvedValueOnce([]);

    await findOptionsBody({ limit: 2 }, makeDeps());

    expect(mockTrips.mock.calls[0]![1]).toMatchObject({ limit: 1 });
    expect(mockHotels.mock.calls[0]![1]).toMatchObject({ limit: 1 });
    expect(mockRegionBases).not.toHaveBeenCalled();
  });

  it('handles an empty primitive result (count = 0) for hotel branch', async () => {
    mockHotels.mockResolvedValueOnce([]);
    const out = await findOptionsBody(
      { preferredType: 'hotel', limit: 4 },
      makeDeps(),
    );
    expect(out).toEqual({ cards: [], count: 0 });
  });

  it('handles an empty primitive result (count = 0) for region_base branch', async () => {
    mockRegionBases.mockResolvedValueOnce([]);
    const out = await findOptionsBody(
      { preferredType: 'region_base', limit: 4 },
      makeDeps(),
    );
    expect(out).toEqual({ cards: [], count: 0 });
  });
});
