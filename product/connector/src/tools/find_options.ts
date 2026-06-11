/**
 * `find_options` handler — Browse options job (agent-private; renders nothing).
 *
 * goofy-goldstine reshape (2026-06-11, C.goofy-goldstine-10..13):
 *
 * find_options is now the agent's BROWSE tool. Returns a compact ranked list
 * (up to 12 BrowseOptions by default) the agent can judge without showing the
 * visitor. Renders NOTHING — the null renderer is registered in the UI.
 *
 * When `query` is supplied (distilled from the conversation), the handler:
 *   1. Embeds it once via `deps.embedQuery` (Gemini 3072d, C.t9 contract).
 *   2. Passes the embedding + query text to the trip + tour primitives.
 *   3. Primitives use RRF hybrid (cosine ANN + ts_rank) for ranking.
 * Hotels/region_bases: unchanged (no embeddings on those tables).
 *
 * The agent iterates browse calls with accumulated `exclude` until satisfied,
 * then calls `show_options` with its curated picks — those are what the
 * visitor sees.
 *
 * Dispatch rules (unchanged from v2/v3):
 *   - 'trip'         → queryTripCardsByFilter (live)
 *   - 'tour'         → queryTourCardsByFilter (live)
 *   - 'hotel'        → queryHotelCardsByFilter (live)
 *   - 'region_base'  → queryRegionBaseCardsByFilter (live)
 *   - undefined      → blendCards — four-way even split, extras to trips
 *
 * Seen-tracking (C.goofy-goldstine-13): exclude-on-entry for hotels/
 * region_bases still fires here (browse never re-offers what visitor saw).
 * mark-on-return moves to show_options — only displayed items get marked.
 * Trip/tour carve-out unchanged.
 */

import type pg from 'pg';
import {
  BrowseOptionSchema,
  FindOptionsInputSchema,
  FindOptionsOutputSchema,
  type BudgetBand,
  type BrowseOption,
  type FindOptionsInput,
  type FindOptionsOutput,
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
  // Embed the query once if supplied. Both trip and tour primitives get the
  // same embedding vector — one Gemini call per find_options invocation.
  let queryEmbedding: number[] | null = null;
  if (input.query && input.query.trim().length > 0) {
    queryEmbedding = await deps.embedQuery(input.query);
  }
  const queryText = input.query ?? null;

  const browseItems = await deps.withClient(async (client) => {
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
      case 'trip': {
        const cards = await queryTripCardsByFilter(client, {
          ...filters,
          excludeIds: excludeIdsForType(input.exclude, 'trip'),
          queryEmbedding,
          queryText,
        });
        return cards.map(cardToBrowseOption);
      }
      case 'tour': {
        const cards = await queryTourCardsByFilter(client, {
          ...filters,
          excludeIds: excludeIdsForType(input.exclude, 'tour'),
          queryEmbedding,
          queryText,
        });
        return cards.map(cardToBrowseOption);
      }
      case 'hotel': {
        const cards = await queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          excludeIds: excludeIdsForType(input.exclude, 'hotel'),
          limit: filters.limit,
        });
        return cards.map(cardToBrowseOption);
      }
      case 'region_base': {
        const cards = await queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          excludeIds: excludeIdsForType(input.exclude, 'region_base'),
          limit: filters.limit,
        });
        return cards.map(cardToBrowseOption);
      }
      case undefined:
      default:
        return blendBrowse(client, filters, input.exclude, queryEmbedding, queryText);
    }
  });

  return FindOptionsOutputSchema.parse({
    options: browseItems,
    count: browseItems.length,
  });
}

/**
 * Project a full ProposalCard to a compact BrowseOption for the agent's eyes.
 * No image hydration — that's the expensive join the agent doesn't need for
 * judging fit. Per C.goofy-goldstine-12.
 */
function cardToBrowseOption(card: {
  type: ProposalType;
  id: string;
  headline: string;
  region?: string;
  durationDays?: number;
  fromPrice?: number | null;
  currencyCode?: string;
  vibeLine?: string;
  // hotel-specific
  location?: string;
}): BrowseOption {
  return BrowseOptionSchema.parse({
    type: card.type,
    id: Number(card.id),
    title: card.headline,
    region: card.region ?? null,
    durationDays: card.durationDays ?? null,
    fromPrice: card.fromPrice ?? null,
    currencyCode: card.currencyCode ?? null,
    line: card.vibeLine ?? null,
  });
}

/**
 * Build a blended compact browse list across all four variants. Quota rule
 * (C.focused-shamir-3): `base = floor(limit/4)`, extras to trips. At the
 * default `limit=12` that's 3 of each variant. At `limit<4`: trips-only.
 *
 * Trip + tour queries get the embedding for hybrid ranking when supplied.
 * Hotels + region_bases: unchanged (no embeddings on those tables).
 *
 * Deficit redistribution: when SOME primitive delivered but total < limit,
 * top up with additional trips.
 */
async function blendBrowse(
  client: pg.PoolClient,
  filters: SharedFilters,
  exclude: FindOptionsInput['exclude'],
  queryEmbedding: number[] | null,
  queryText: string | null,
): Promise<BrowseOption[]> {
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
          queryEmbedding,
          queryText,
        })
      : Promise.resolve([]),
    tourQuota > 0
      ? queryTourCardsByFilter(client, {
          ...filters,
          excludeIds: tourExcludes,
          limit: tourQuota,
          queryEmbedding,
          queryText,
        })
      : Promise.resolve([]),
    hotelQuota > 0
      ? queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          excludeIds: hotelExcludes,
          limit: hotelQuota,
        })
      : Promise.resolve([]),
    regionBaseQuota > 0
      ? queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          excludeIds: regionBaseExcludes,
          limit: regionBaseQuota,
        })
      : Promise.resolve([]),
  ]);

  const out: BrowseOption[] = [
    ...trips.map(cardToBrowseOption),
    ...tours.map(cardToBrowseOption),
    ...hotels.map(cardToBrowseOption),
    ...regionBases.map(cardToBrowseOption),
  ];

  // Deficit redistribution: top up via trips when SOME primitive delivered but
  // total < limit. The seen-ids set excludes trips already returned by the
  // primary query. The exclude list is forwarded unchanged.
  if (out.length > 0 && out.length < filters.limit) {
    const deficit = filters.limit - out.length;
    const moreTrips = await queryTripCardsByFilter(client, {
      ...filters,
      excludeIds: tripExcludes,
      limit: tripQuota + deficit,
      queryEmbedding,
      queryText,
    });
    const seenIds = new Set(
      out.filter((c) => c.type === 'trip').map((c) => c.id),
    );
    for (const t of moreTrips) {
      if (out.length >= filters.limit) break;
      const browseId = Number(t.id);
      if (!seenIds.has(browseId)) {
        out.push(cardToBrowseOption(t));
        seenIds.add(browseId);
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
