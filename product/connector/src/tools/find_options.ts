/**
 * `find_options` handler — Propose options job.
 *
 * The journey moment: visitor is ready to consider concrete options.
 * Output `cards` is polymorphic — a discriminated union over `trip | tour |
 * hotel | region_base` (`ProposalCardPublicSchema` in `@swoop/common`).
 *
 * Tranche history:
 *   - v1 (2026-05-12, decisions C.48–C.51): contract carries all four
 *     variants from day one; handler wires only `type: 'trip'` live.
 *   - v3 (2026-05-13, task BF-FO-v3, decisions C.bf-1..6): hotels +
 *     region_bases land as live data primitives. `preferredType` becomes
 *     dispatching. v2 (tours) remains gated on Swoop content population.
 *
 * Dispatch rules:
 *   - 'hotel'        → queryHotelCardsByFilter (live)
 *   - 'region_base'  → queryRegionBaseCardsByFilter (live)
 *   - 'trip'         → queryTripCardsByFilter (live)
 *   - 'tour'         → queryTripCardsByFilter (v2 fallback; v2 PR swaps
 *                      this branch when Swoop populates the tour table)
 *   - undefined      → blendCards — mixed set across the three live variants
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
} from '@swoop/common';

import { queryTripCardsByFilter } from '../data/query-trips.js';
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
        return queryTripCardsByFilter(client, filters);
      case 'hotel':
        return queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          limit: filters.limit,
        });
      case 'region_base':
        return queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          limit: filters.limit,
        });
      case 'tour':
        // v2 fallback: until Swoop populates the `tour` table, route through
        // the trip primitive so Sonnet's tour-preference still produces
        // *something*. Decision C.bf-6. v2 PR swaps this branch.
        return queryTripCardsByFilter(client, filters);
      case undefined:
      default:
        return blendCards(client, filters);
    }
  });

  return FindOptionsOutputSchema.parse({
    cards,
    count: cards.length,
  });
}

/**
 * Build a blended set across the three live variants. Default ratio for
 * `limit=4`: 2 trips + 1 hotel + 1 region_base. For other limits it
 * proportionalises and skips zero-quota primitives. If a primitive
 * under-delivers, deficits redistribute by querying additional trips
 * (priority order: trip → hotel → region_base; today we only top up
 * trips because they're the most populous live source).
 *
 * Decision C.bf-3.
 */
async function blendCards(
  client: pg.PoolClient,
  filters: SharedFilters,
): Promise<ProposalCardPublic[]> {
  const tripQuota = Math.floor(filters.limit / 2);
  const hotelQuota = Math.ceil((filters.limit - tripQuota) / 2);
  const regionBaseQuota = filters.limit - tripQuota - hotelQuota;

  const [trips, hotels, regionBases] = await Promise.all([
    tripQuota > 0
      ? queryTripCardsByFilter(client, { ...filters, limit: tripQuota })
      : Promise.resolve<ProposalCardPublic[]>([]),
    hotelQuota > 0
      ? queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          limit: hotelQuota,
        })
      : Promise.resolve<ProposalCardPublic[]>([]),
    regionBaseQuota > 0
      ? queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          limit: regionBaseQuota,
        })
      : Promise.resolve<ProposalCardPublic[]>([]),
  ]);

  const out: ProposalCardPublic[] = [...trips, ...hotels, ...regionBases];

  // Deficit redistribution: when SOME primitive delivered but the total is
  // still below limit, query additional trips to top up. The `out.length > 0`
  // guard prevents a wasted second round-trip when every primitive returned
  // empty (in that case there's no data to redistribute toward, and the
  // top-up would just return empty too).
  if (out.length > 0 && out.length < filters.limit) {
    const deficit = filters.limit - out.length;
    const moreTrips =
      (await queryTripCardsByFilter(client, {
        ...filters,
        limit: tripQuota + deficit,
      })) ?? [];
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
