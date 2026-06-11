/**
 * `show_options` handler — Visitor-facing curation (10th tool).
 *
 * After the agent has browsed privately with `find_options`, it calls
 * `show_options` with the ids of the options it has curated. This handler
 * hydrates full ProposalCards (with images) and returns them grouped into
 * primary / also_interesting.
 *
 * This is what the visitor sees. Nothing renders from find_options
 * (the browse tool); everything renders from show_options.
 *
 * Hydration goes through the by-id variants exported by the four
 * `data/query-*.ts` files — same SELECT + row-mapper as the filter paths,
 * so browse and show can never drift (plan §3.2; the first cut kept local
 * SQL copies here and live-verify caught a column drift within hours).
 *
 * Seen-tracking (C.goofy-goldstine-13, 2026-06-11):
 *   - Hotels + region_bases returned here get marked as shown in the
 *     orchestrator's seen-set (anti-repetition). The orchestrator's
 *     `extractSeenDelta` handles this by inspecting the `cards` array.
 *   - Trips + tours: carve-out preserved (never marked).
 *
 * Per crosscut plan `03-exec-crosscut-goofy-goldstine-find-options-reshape.md`
 * §3 (Phase 2), decisions C.goofy-goldstine-12..13.
 */

import {
  ShowOptionsInputSchema,
  ShowOptionsOutputSchema,
  type ProposalCardPublic,
  type ShowOptionsInput,
  type ShowOptionsOutput,
} from '@swoop/common';

import { queryTripCardsByIds } from '../data/query-trips.js';
import { queryTourCardsByIds } from '../data/query-tour-cards.js';
import { queryHotelCardsByIds } from '../data/query-hotels.js';
import { queryRegionBaseCardsByIds } from '../data/query-region-bases.js';
import type { ToolHandlerDeps } from './deps.js';

export async function showOptionsBody(
  input: ShowOptionsInput,
  deps: ToolHandlerDeps,
): Promise<ShowOptionsOutput> {
  // Group the input items by type for batched by-id queries.
  const tripIds: number[] = [];
  const tourIds: number[] = [];
  const hotelIds: number[] = [];
  const regionBaseIds: number[] = [];
  const groupMap = new Map<string, 'primary' | 'also_interesting'>();

  for (const item of input.items) {
    const key = `${item.type}:${item.id}`;
    groupMap.set(key, item.group);
    switch (item.type) {
      case 'trip': tripIds.push(item.id); break;
      case 'tour': tourIds.push(item.id); break;
      case 'hotel': hotelIds.push(item.id); break;
      case 'region_base': regionBaseIds.push(item.id); break;
    }
  }

  // Sequential awaits — a single pg client cannot execute queries in
  // parallel (pg pipelines them and the pattern is deprecated, removed in
  // pg@9). Each by-id helper early-returns [] on an empty id list.
  const cards: ProposalCardPublic[] = await deps.withClient(
    async (client) => [
      ...(await queryTripCardsByIds(client, tripIds)),
      ...(await queryTourCardsByIds(client, tourIds)),
      ...(await queryHotelCardsByIds(client, hotelIds)),
      ...(await queryRegionBaseCardsByIds(client, regionBaseIds)),
    ],
  );

  // Attach group to each card and restore the agent's curation order
  // (input.items position) — primary items typically lead.
  const inputOrder = new Map<string, number>();
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]!;
    inputOrder.set(`${item.type}:${item.id}`, i);
  }

  const cardsWithGroup = cards
    .map((card) => {
      const key = `${card.type}:${card.id}`;
      const group = groupMap.get(key) ?? 'primary';
      return { ...card, group } as ProposalCardPublic & {
        group: 'primary' | 'also_interesting';
      };
    })
    .sort((a, b) => {
      const aIdx = inputOrder.get(`${a.type}:${a.id}`) ?? 999;
      const bIdx = inputOrder.get(`${b.type}:${b.id}`) ?? 999;
      return aIdx - bIdx;
    });

  return ShowOptionsOutputSchema.parse({ cards: cardsWithGroup });
}

export const showOptionsSpec = {
  name: 'show_options' as const,
  inputSchema: ShowOptionsInputSchema,
  outputSchema: ShowOptionsOutputSchema,
};
