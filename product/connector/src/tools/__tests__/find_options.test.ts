/**
 * `find_options` handler — discriminated-output contract tests (v1 tranche).
 *
 * Crosscut C.48: the handler returns `cards: ProposalCardPublic[]` — a
 * discriminated union over `trip | tour | hotel | region_base`. v1 wires
 * only `type: 'trip'` live; every card returned MUST carry that discriminator.
 *
 * These tests exercise the handler body with a stubbed `withClient` so they
 * don't need a live `puma_dev` Postgres. SQL-shape correctness against real
 * data is downstream of B.t3a + the v2/v3 tranches.
 */

import { describe, expect, it, vi } from 'vitest';

import { FindOptionsOutputSchema } from '@swoop/common';

import { findOptionsBody } from '../find_options.js';
import type { ToolHandlerDeps } from '../deps.js';

vi.mock('../../data/query-trips.js', () => ({
  queryTripCardsByFilter: vi.fn(),
}));

import { queryTripCardsByFilter } from '../../data/query-trips.js';

const mockQuery = queryTripCardsByFilter as unknown as ReturnType<typeof vi.fn>;

function makeDeps(): ToolHandlerDeps {
  return {
    // The handler hands a sentinel client to the primitive; the mock ignores
    // it. The point is to verify the handler's shape contract, not the SQL.
    withClient: async (fn) => fn({} as unknown as Parameters<ToolHandlerDeps['withClient']>[0] extends (
      arg: infer C,
    ) => unknown
      ? C
      : never),
    embedQuery: async () => new Array(1024).fill(0),
  };
}

describe('find_options handler — v1 discriminated output', () => {
  it('returns cards with `type: "trip"` on every entry (v1 default)', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        type: 'trip' as const,
        id: '1',
        headline: 'A Patagonia trip',
        canonicalUrl: 'https://example.com/trips/1',
        activityTags: [],
      },
      {
        type: 'trip' as const,
        id: '2',
        headline: 'Another Patagonia trip',
        canonicalUrl: 'https://example.com/trips/2',
        activityTags: ['hiking'],
      },
    ]);

    const out = await findOptionsBody(
      { region: 'patagonia', limit: 4 },
      makeDeps(),
    );

    expect(out.count).toBe(2);
    expect(out.cards).toHaveLength(2);
    for (const card of out.cards) {
      expect(card.type).toBe('trip');
    }
  });

  it('validates output against FindOptionsOutputSchema (discriminated union)', async () => {
    mockQuery.mockResolvedValueOnce([
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

    const out = await findOptionsBody({ limit: 4 }, makeDeps());
    expect(() => FindOptionsOutputSchema.parse(out)).not.toThrow();
  });

  it('handles an empty primitive result (count = 0)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const out = await findOptionsBody({ limit: 4 }, makeDeps());
    expect(out).toEqual({ cards: [], count: 0 });
  });

  it('threads structured filters through to the primitive', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await findOptionsBody(
      {
        region: 'patagonia',
        durationMin: 5,
        durationMax: 10,
        budgetBand: 'mid',
        activity: 'hiking',
        accommodationStyle: 'refugios',
        limit: 4,
      },
      makeDeps(),
    );
    expect(mockQuery).toHaveBeenLastCalledWith(
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

  it('accepts preferredType on the input without dispatching off it (v1)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    // v1: preferredType is schema-only; the handler does not yet pick a
    // different primitive based on it. Tours (`preferredType: 'tour'`) still
    // route through the trip primitive in v1 — and return empty since the
    // primitive is the only one wired. This test pins that contract so v2's
    // dispatch swap is a deliberate, visible change.
    const out = await findOptionsBody(
      { preferredType: 'tour', limit: 4 },
      makeDeps(),
    );
    expect(out).toEqual({ cards: [], count: 0 });
    expect(mockQuery).toHaveBeenCalled();
  });
});
