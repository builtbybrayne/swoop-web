/**
 * `find_options` handler — Propose options job.
 *
 * The journey moment: visitor is ready to consider concrete options.
 * Output `cards` is polymorphic — a discriminated union over `trip | tour |
 * hotel | region_base` (`ProposalCardPublicSchema` in `@swoop/common`).
 *
 * Tranche history:
 *   - v1 (2026-05-12, C.48–C.51): contract carries all four variants; only
 *     `type: 'trip'` wired live.
 *   - v3 (2026-05-13, C.bf-1..6): hotels + region_bases land as live data
 *     primitives. `preferredType` becomes dispatching.
 *   - v2 (2026-05-15, C.focused-shamir-{2..5}): tours go live (C.focused-shamir-2
 *     supersedes C.bf-6); `blendCards` becomes a four-way even split with extras
 *     to trips (C.focused-shamir-3 supersedes C.bf-3); all primitives use
 *     `ORDER BY RANDOM()` for variety (C.focused-shamir-4); agent can pass an
 *     `exclude` list to omit cards it doesn't want repeated (C.focused-shamir-5).
 *
 * Dispatch rules:
 *   - 'trip'         → queryTripCardsByFilter (live)
 *   - 'tour'         → queryTourCardsByFilter (live, v2)
 *   - 'hotel'        → queryHotelCardsByFilter (live)
 *   - 'region_base'  → queryRegionBaseCardsByFilter (live)
 *   - undefined      → blendCards — four-way even split, extras to trips
 *
 * Pure SQL filter — no vector retrieval (per C.t4 plan §"Components"). No
 * defence against missing rows: empty result is the correct outcome.
 */

import type pg from 'pg';
import {
  FindOptionsInputSchema,
  FindOptionsOutputSchema,
  type BudgetBand,
  type FindOptionsInput,
  type FindOptionsOutput,
  type ProposalCardPublic,
  type ProposalType,
} from '@swoop/common';

import { queryTripCardsByFilter } from '../data/query-trips.js';
import { queryTourCardsByFilter } from '../data/query-tour-cards.js';
import { queryHotelCardsByFilter } from '../data/query-hotels.js';
import { queryRegionBaseCardsByFilter } from '../data/query-region-bases.js';
import type { ToolHandlerDeps } from './deps.js';

interface SharedFilters {
  region?: string | null;
  durationMin?: number | null;
  durationMax?: number | null;
  budgetBand?: BudgetBand | null;
  activity?: string | null;
  accommodationStyle?: string | null;
  limit: number;
}

/**
 * Split the agent-supplied `exclude` list (Array<{type, id}>) into per-type
 * arrays of numeric ids. Each primitive's id space is distinct, so the lists
 * don't cross-pollute. Per C.focused-shamir-5.
 */
function excludeIdsForType(
  exclude: FindOptionsInput['exclude'],
  type: ProposalType,
): number[] {
  if (!exclude) return [];
  const out: number[] = [];
  for (const e of exclude) {
    if (e.type !== type) continue;
    const n = Number(e.id);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export async function findOptionsBody(
  input: FindOptionsInput,
  deps: ToolHandlerDeps,
): Promise<FindOptionsOutput> {
  const cards = await deps.withClient(async (client) => {
    const filters: SharedFilters = {
      region: input.region,
      durationMin: input.durationMin,
      durationMax: input.durationMax,
      budgetBand: input.budgetBand,
      activity: input.activity,
      accommodationStyle: input.accommodationStyle,
      limit: input.limit,
    };

    switch (input.preferredType) {
      case 'trip':
        return queryTripCardsByFilter(client, {
          ...filters,
          excludeIds: excludeIdsForType(input.exclude, 'trip'),
        });
      case 'tour':
        return queryTourCardsByFilter(client, {
          ...filters,
          excludeIds: excludeIdsForType(input.exclude, 'tour'),
        });
      case 'hotel':
        return queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          excludeIds: excludeIdsForType(input.exclude, 'hotel'),
          limit: filters.limit,
        });
      case 'region_base':
        return queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          excludeIds: excludeIdsForType(input.exclude, 'region_base'),
          limit: filters.limit,
        });
      case undefined:
      default:
        return blendCards(client, filters, input.exclude);
    }
  });

  return FindOptionsOutputSchema.parse({
    cards,
    count: cards.length,
  });
}

/**
 * Build a blended set across all four variants. Quota rule (C.focused-shamir-3,
 * supersedes C.bf-3): `base = floor(limit/4)`, extras to trips. At the default
 * `limit=4` that's 1 of each variant (trip + tour + hotel + region_base). At
 * `limit=8`: 2 of each. At `limit<4`: drops to trips-only (Sonnet's default is
 * 4 so this is rare).
 *
 * Deficit redistribution: when SOME primitive delivered but the total is still
 * below limit, query additional trips to top up. Trips remain the most populous
 * source and the natural deficit-filler.
 */
async function blendCards(
  client: pg.PoolClient,
  filters: SharedFilters,
  exclude: FindOptionsInput['exclude'],
): Promise<ProposalCardPublic[]> {
  const base = Math.floor(filters.limit / 4);
  const remainder = filters.limit - base * 4;
  const tripQuota = base + remainder; // trips absorb the remainder
  const tourQuota = base;
  const hotelQuota = base;
  const regionBaseQuota = base;

  const tripExcludes = excludeIdsForType(exclude, 'trip');
  const tourExcludes = excludeIdsForType(exclude, 'tour');
  const hotelExcludes = excludeIdsForType(exclude, 'hotel');
  const regionBaseExcludes = excludeIdsForType(exclude, 'region_base');

  const [trips, tours, hotels, regionBases] = await Promise.all([
    tripQuota > 0
      ? queryTripCardsByFilter(client, {
          ...filters,
          excludeIds: tripExcludes,
          limit: tripQuota,
        })
      : Promise.resolve<ProposalCardPublic[]>([]),
    tourQuota > 0
      ? queryTourCardsByFilter(client, {
          ...filters,
          excludeIds: tourExcludes,
          limit: tourQuota,
        })
      : Promise.resolve<ProposalCardPublic[]>([]),
    hotelQuota > 0
      ? queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          excludeIds: hotelExcludes,
          limit: hotelQuota,
        })
      : Promise.resolve<ProposalCardPublic[]>([]),
    regionBaseQuota > 0
      ? queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          excludeIds: regionBaseExcludes,
          limit: regionBaseQuota,
        })
      : Promise.resolve<ProposalCardPublic[]>([]),
  ]);

  const out: ProposalCardPublic[] = [
    ...trips,
    ...tours,
    ...hotels,
    ...regionBases,
  ];

  // Deficit redistribution: top up via trips when SOME primitive delivered but
  // total < limit. The seen-ids set excludes trips already returned by the
  // primary query so we don't duplicate. The exclude list is forwarded
  // unchanged — agent-supplied excludes always hold.
  if (out.length > 0 && out.length < filters.limit) {
    const deficit = filters.limit - out.length;
    const moreTrips = await queryTripCardsByFilter(client, {
      ...filters,
      excludeIds: tripExcludes,
      limit: tripQuota + deficit,
    });
    const seenIds = new Set(
      out.filter((c) => c.type === 'trip').map((c) => c.id),
    );
    for (const t of moreTrips) {
      if (out.length >= filters.limit) break;
      if (!seenIds.has(t.id)) {
        out.push(t);
        seenIds.add(t.id);
      }
    }
  }

  return out.slice(0, filters.limit);
}

export const findOptionsSpec = {
  name: 'find_options' as const,
  inputSchema: FindOptionsInputSchema,
  outputSchema: FindOptionsOutputSchema,
};
