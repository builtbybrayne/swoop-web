/**
 * `find_options` handler — browse output contract tests + dispatch.
 *
 * goofy-goldstine reshape (2026-06-11): the handler now returns
 * `options: BrowseOption[]` — compact (id, title, region, durationDays,
 * fromPrice, line) rather than full ProposalCards. Full cards are the
 * domain of show_options.
 *
 * v3 dispatch (BF-FO-v3): hotels + region_bases land as live data
 * primitives. Handler dispatches on `preferredType`:
 *   - 'hotel'        → queryHotelCardsByFilter
 *   - 'region_base'  → queryRegionBaseCardsByFilter
 *   - 'trip'         → queryTripCardsByFilter
 *   - 'tour'         → queryTourCardsByFilter
 *   - undefined      → blendBrowse (mixed set across all four variants)
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
vi.mock('../../data/query-tour-cards.js', () => ({
  queryTourCardsByFilter: vi.fn(),
}));
vi.mock('../../data/query-hotels.js', () => ({
  queryHotelCardsByFilter: vi.fn(),
}));
vi.mock('../../data/query-region-bases.js', () => ({
  queryRegionBaseCardsByFilter: vi.fn(),
}));

import { queryTripCardsByFilter } from '../../data/query-trips.js';
import { queryTourCardsByFilter } from '../../data/query-tour-cards.js';
import { queryHotelCardsByFilter } from '../../data/query-hotels.js';
import { queryRegionBaseCardsByFilter } from '../../data/query-region-bases.js';

const mockTrips = queryTripCardsByFilter as unknown as ReturnType<typeof vi.fn>;
const mockTours = queryTourCardsByFilter as unknown as ReturnType<typeof vi.fn>;
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
const TOUR_CARD = {
  type: 'tour' as const,
  id: '9',
  headline: 'Best of Patagonia',
  canonicalUrl: 'https://example.com/tours/best-chile-argentina',
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
  mockTours.mockReset();
  mockHotels.mockReset();
  mockRegionBases.mockReset();
});

describe('find_options handler — browse output (goofy-goldstine reshape)', () => {
  it('returns options with `type: "trip"` on every entry when preferredType is "trip"', async () => {
    mockTrips.mockResolvedValueOnce([
      { ...TRIP_CARD, id: '1' },
      { ...TRIP_CARD, id: '2', activityTags: ['hiking'] },
    ]);

    const out = await findOptionsBody(
      { region: 'patagonia', preferredType: 'trip', limit: 12 },
      makeDeps(),
    );

    expect(out.count).toBe(2);
    expect(out.options).toHaveLength(2);
    for (const option of out.options) {
      expect(option.type).toBe('trip');
    }
  });

  it('validates trip output against FindOptionsOutputSchema (compact browse)', async () => {
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
      { preferredType: 'trip', limit: 12 },
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
      { preferredType: 'hotel', region: 'torres del paine', limit: 12 },
      makeDeps(),
    );

    expect(mockHotels).toHaveBeenCalledOnce();
    expect(mockTrips).not.toHaveBeenCalled();
    expect(mockRegionBases).not.toHaveBeenCalled();
    expect(out.count).toBe(1);
    expect(out.options[0]!.type).toBe('hotel');
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
      { preferredType: 'region_base', limit: 12 },
      makeDeps(),
    );

    expect(mockRegionBases).toHaveBeenCalledOnce();
    expect(mockTrips).not.toHaveBeenCalled();
    expect(mockHotels).not.toHaveBeenCalled();
    expect(out.options[0]!.type).toBe('region_base');
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

  it('preferredType "tour" routes to queryTourCardsByFilter only (v2-live, C.focused-shamir-2)', async () => {
    mockTours.mockResolvedValueOnce([TOUR_CARD]);

    const out = await findOptionsBody(
      { preferredType: 'tour', limit: 12 },
      makeDeps(),
    );

    expect(mockTours).toHaveBeenCalledOnce();
    expect(mockTrips).not.toHaveBeenCalled();
    expect(mockHotels).not.toHaveBeenCalled();
    expect(mockRegionBases).not.toHaveBeenCalled();
    expect(out.options[0]!.type).toBe('tour');
    expect(() => FindOptionsOutputSchema.parse(out)).not.toThrow();
  });

  it('preferredType unset → blend across all four live variants (4-way, C.focused-shamir-3)', async () => {
    mockTrips.mockResolvedValueOnce([{ ...TRIP_CARD, id: '101' }]);
    mockTours.mockResolvedValueOnce([{ ...TOUR_CARD, id: '9' }]);
    mockHotels.mockResolvedValueOnce([{ ...HOTEL_CARD, id: '201' }]);
    mockRegionBases.mockResolvedValueOnce([{ ...REGION_BASE_CARD, id: '301' }]);

    const out = await findOptionsBody({ limit: 4 }, makeDeps());

    expect(mockTrips).toHaveBeenCalledOnce();
    expect(mockTours).toHaveBeenCalledOnce();
    expect(mockHotels).toHaveBeenCalledOnce();
    expect(mockRegionBases).toHaveBeenCalledOnce();
    expect(out.count).toBe(4);
    expect(out.options.map((c) => c.type).sort()).toEqual([
      'hotel',
      'region_base',
      'tour',
      'trip',
    ]);
    expect(() => FindOptionsOutputSchema.parse(out)).not.toThrow();
  });

  it('blend ratio at limit=4: 1 of each variant (trip=1, tour=1, hotel=1, region_base=1)', async () => {
    mockTrips.mockResolvedValueOnce([]);
    mockTours.mockResolvedValueOnce([]);
    mockHotels.mockResolvedValueOnce([]);
    mockRegionBases.mockResolvedValueOnce([]);

    await findOptionsBody({ limit: 4 }, makeDeps());

    expect(mockTrips.mock.calls[0]![1]).toMatchObject({ limit: 1 });
    expect(mockTours.mock.calls[0]![1]).toMatchObject({ limit: 1 });
    expect(mockHotels.mock.calls[0]![1]).toMatchObject({ limit: 1 });
    expect(mockRegionBases.mock.calls[0]![1]).toMatchObject({ limit: 1 });
  });

  it('blend deficit: when sub-quotas under-deliver, redistribute by querying extra trips', async () => {
    // First call (quota=1 at limit=4) returns 1 trip. Top-up returns more.
    mockTrips
      .mockResolvedValueOnce([{ ...TRIP_CARD, id: '101' }])
      .mockResolvedValueOnce([
        { ...TRIP_CARD, id: '101' }, // duplicate (should be filtered)
        { ...TRIP_CARD, id: '102' },
        { ...TRIP_CARD, id: '103' },
        { ...TRIP_CARD, id: '104' },
      ]);
    mockTours.mockResolvedValueOnce([]);
    mockHotels.mockResolvedValueOnce([]);
    mockRegionBases.mockResolvedValueOnce([]);

    const out = await findOptionsBody({ limit: 4 }, makeDeps());

    // Top-up fires (trips called twice).
    expect(mockTrips).toHaveBeenCalledTimes(2);
    // No duplicate ids in the output.
    const ids = out.options.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.count).toBeLessThanOrEqual(4);
  });

  it('blend at limit=2 falls back to trips-only (rare at default limit=12)', async () => {
    // base = floor(2/4) = 0, remainder = 2 → tripQuota = 2, others = 0.
    mockTrips.mockResolvedValueOnce([]);

    await findOptionsBody({ limit: 2 }, makeDeps());

    expect(mockTrips.mock.calls[0]![1]).toMatchObject({ limit: 2 });
    expect(mockTours).not.toHaveBeenCalled();
    expect(mockHotels).not.toHaveBeenCalled();
    expect(mockRegionBases).not.toHaveBeenCalled();
  });

  it('handles an empty primitive result (count = 0) for hotel branch', async () => {
    mockHotels.mockResolvedValueOnce([]);
    const out = await findOptionsBody(
      { preferredType: 'hotel', limit: 12 },
      makeDeps(),
    );
    expect(out).toEqual({ options: [], count: 0 });
  });

  it('handles an empty primitive result (count = 0) for region_base branch', async () => {
    mockRegionBases.mockResolvedValueOnce([]);
    const out = await findOptionsBody(
      { preferredType: 'region_base', limit: 12 },
      makeDeps(),
    );
    expect(out).toEqual({ options: [], count: 0 });
  });
});

describe('find_options handler — agent-supplied exclude (C.focused-shamir-5)', () => {
  it('passes type-filtered excludeIds to the matching primitive', async () => {
    mockTrips.mockResolvedValueOnce([]);

    await findOptionsBody(
      {
        preferredType: 'trip',
        limit: 4,
        exclude: [
          { type: 'trip', id: '369' },
          { type: 'trip', id: '422' },
        ],
      },
      makeDeps(),
    );

    expect(mockTrips.mock.calls[0]![1]).toMatchObject({
      excludeIds: [369, 422],
    });
  });

  it('cross-type isolation: a trip exclude does NOT bleed into the tour primitive', async () => {
    mockTours.mockResolvedValueOnce([]);

    await findOptionsBody(
      {
        preferredType: 'tour',
        limit: 4,
        exclude: [
          { type: 'trip', id: '369' }, // wrong type — must be ignored
          { type: 'tour', id: '9' }, // correct type — must be applied
        ],
      },
      makeDeps(),
    );

    expect(mockTours.mock.calls[0]![1]).toMatchObject({
      excludeIds: [9],
    });
    expect(mockTrips).not.toHaveBeenCalled();
  });

  it('blend splits the exclude list across all four primitives by type', async () => {
    mockTrips.mockResolvedValueOnce([]);
    mockTours.mockResolvedValueOnce([]);
    mockHotels.mockResolvedValueOnce([]);
    mockRegionBases.mockResolvedValueOnce([]);

    await findOptionsBody(
      {
        limit: 4,
        exclude: [
          { type: 'trip', id: '100' },
          { type: 'tour', id: '9' },
          { type: 'hotel', id: '44' },
          { type: 'region_base', id: '7' },
          { type: 'trip', id: '101' },
        ],
      },
      makeDeps(),
    );

    expect(mockTrips.mock.calls[0]![1]).toMatchObject({
      excludeIds: [100, 101],
    });
    expect(mockTours.mock.calls[0]![1]).toMatchObject({ excludeIds: [9] });
    expect(mockHotels.mock.calls[0]![1]).toMatchObject({ excludeIds: [44] });
    expect(mockRegionBases.mock.calls[0]![1]).toMatchObject({
      excludeIds: [7],
    });
  });

  it('missing exclude (undefined) flows through as empty arrays — no crash', async () => {
    mockTrips.mockResolvedValueOnce([]);

    await findOptionsBody(
      { preferredType: 'trip', limit: 4 },
      makeDeps(),
    );

    expect(mockTrips.mock.calls[0]![1]).toMatchObject({ excludeIds: [] });
  });
});
