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
 * Seen-tracking (C.goofy-goldstine-13, 2026-06-11):
 *   - Hotels + region_bases returned here get marked as shown in the
 *     orchestrator's seen-set (anti-repetition). The orchestrator's
 *     `extractSeenDelta` handles this by inspecting the `cards` array.
 *   - Trips + tours: carve-out preserved (never marked).
 *
 * Per crosscut plan `03-exec-crosscut-goofy-goldstine-find-options-reshape.md`
 * §3 (Phase 2), decisions C.goofy-goldstine-12..13.
 */

import type pg from 'pg';
import {
  HotelProposalCardSchema,
  RegionBaseProposalCardSchema,
  ShowOptionsInputSchema,
  ShowOptionsOutputSchema,
  TourProposalCardSchema,
  TripProposalCardSchema,
  type ProposalCardPublic,
  type ShowOptionsInput,
  type ShowOptionsOutput,
} from '@swoop/common';

import { resolveImagesByIds } from '../data/resolve-image.js';
import { trimCmsDecorativeWhitespace } from '../data/text-utils.js';
import type { ToolHandlerDeps } from './deps.js';

export async function showOptionsBody(
  input: ShowOptionsInput,
  deps: ToolHandlerDeps,
): Promise<ShowOptionsOutput> {
  // Group the input items by type for efficient batch queries.
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

  const cards = await deps.withClient(async (client) => {
    const [trips, tours, hotels, regionBases] = await Promise.all([
      tripIds.length > 0 ? queryTripsById(client, tripIds) : Promise.resolve([]),
      tourIds.length > 0 ? queryToursById(client, tourIds) : Promise.resolve([]),
      hotelIds.length > 0 ? queryHotelsById(client, hotelIds) : Promise.resolve([]),
      regionBaseIds.length > 0 ? queryRegionBasesById(client, regionBaseIds) : Promise.resolve([]),
    ]);
    return [...trips, ...tours, ...hotels, ...regionBases];
  });

  // Attach group to each card. Preserve the input ordering (sort by position
  // in input.items so primary items come before also_interesting by default).
  const inputOrder = new Map<string, number>();
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]!;
    inputOrder.set(`${item.type}:${item.id}`, i);
  }

  const cardsWithGroup = cards
    .map((card) => {
      const key = `${card.type}:${card.id}`;
      const group = groupMap.get(key) ?? 'primary';
      return { ...card, group } as ProposalCardPublic & { group: 'primary' | 'also_interesting' };
    })
    .sort((a, b) => {
      const aIdx = inputOrder.get(`${a.type}:${a.id}`) ?? 999;
      const bIdx = inputOrder.get(`${b.type}:${b.id}`) ?? 999;
      return aIdx - bIdx;
    });

  return ShowOptionsOutputSchema.parse({ cards: cardsWithGroup });
}

// ---------------------------------------------------------------------------
// By-id query helpers. Each mirrors its filter counterpart but uses
// `WHERE id = ANY($1::int[])` instead of dynamic filter clauses.
// ---------------------------------------------------------------------------

async function queryTripsById(
  client: pg.PoolClient,
  ids: number[],
): Promise<ProposalCardPublic[]> {
  const sql = `
    SELECT id, slug, headline, vibe_line, region, duration_days,
           from_price, currency_code, accommodation_style,
           COALESCE(activity_tags, '{}') AS activity_tags,
           canonical_url, image_id
    FROM trip_card
    WHERE id = ANY($1::int[])
  `;
  const res = await client.query(sql, [ids]);
  const imageIds = res.rows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  return res.rows.map((r) => {
    const image = r.image_id ? (images.get(r.image_id as number) ?? undefined) : undefined;
    const fromPrice = r.from_price !== null && r.from_price !== undefined ? Number(r.from_price) : null;
    return TripProposalCardSchema.parse({
      type: 'trip' as const,
      id: String(r.id),
      ...(r.slug != null ? { slug: r.slug as string } : {}),
      headline: r.headline as string,
      ...(r.vibe_line != null ? { vibeLine: r.vibe_line as string } : {}),
      ...(r.region != null ? { region: r.region as string } : {}),
      ...(r.duration_days != null ? { durationDays: r.duration_days as number } : {}),
      fromPrice,
      ...(r.currency_code != null ? { currencyCode: r.currency_code as string } : {}),
      ...(r.accommodation_style != null ? { accommodationStyle: r.accommodation_style as string } : {}),
      activityTags: (r.activity_tags ?? []) as string[],
      canonicalUrl: r.canonical_url as string,
      ...(image ? { image } : {}),
    });
  });
}

async function queryToursById(
  client: pg.PoolClient,
  ids: number[],
): Promise<ProposalCardPublic[]> {
  const sql = `
    SELECT id, slug, headline, vibe_line, region, day_count, duration_days,
           group_size_max, from_price, currency_code, accommodation_style,
           COALESCE(activity_tags, '{}') AS activity_tags,
           canonical_url, image_id
    FROM tour_card
    WHERE id = ANY($1::int[])
  `;
  const res = await client.query(sql, [ids]);
  const imageIds = res.rows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  return res.rows.map((r) => {
    const image = r.image_id ? (images.get(r.image_id as number) ?? undefined) : undefined;
    const fromPrice = r.from_price !== null && r.from_price !== undefined ? Number(r.from_price) : null;
    return TourProposalCardSchema.parse({
      type: 'tour' as const,
      id: String(r.id),
      ...(r.slug != null ? { slug: r.slug as string } : {}),
      headline: r.headline as string,
      ...(r.vibe_line != null ? { vibeLine: r.vibe_line as string } : {}),
      ...(r.region != null ? { region: r.region as string } : {}),
      ...(r.duration_days != null ? { durationDays: r.duration_days as number } : {}),
      ...(r.group_size_max != null ? { groupSizeMax: r.group_size_max as number } : {}),
      ...(r.day_count != null && (r.day_count as number) > 0 ? { dayCount: r.day_count as number } : {}),
      fromPrice,
      ...(r.currency_code != null ? { currencyCode: r.currency_code as string } : {}),
      ...(r.accommodation_style != null ? { accommodationStyle: r.accommodation_style as string } : {}),
      activityTags: (r.activity_tags ?? []) as string[],
      canonicalUrl: r.canonical_url as string,
      ...(image ? { image } : {}),
    });
  });
}

async function queryHotelsById(
  client: pg.PoolClient,
  ids: number[],
): Promise<ProposalCardPublic[]> {
  // Mirrors queryHotelCardsByFilter's SELECT + JOIN shape, scoped by id list.
  const sql = `
    SELECT
      h.id,
      h.slug,
      h.name AS headline,
      h.star_rating,
      h.accommodation_style,
      p.canonical_url,
      p.image_id,
      COALESCE(p.summary, p.intro_text) AS vibe_line_source,
      loc.name AS location_name,
      MIN(hp.price) AS from_price,
      MIN(hp.currency_code) AS currency_code
    FROM hotel h
    LEFT JOIN page p ON p.id = h.page_id
    LEFT JOIN location loc ON loc.id = h.location_id
    LEFT JOIN hotel_pricing hp ON hp.hotel_id = h.id
    WHERE h.id = ANY($1::int[])
    GROUP BY h.id, h.slug, h.name, h.star_rating, h.accommodation_style,
             p.canonical_url, p.image_id, p.summary, p.intro_text, loc.name
  `;
  const res = await client.query(sql, [ids]);
  const imageIds = res.rows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  return res.rows
    .filter((r) => r.canonical_url != null)
    .map((r) => {
      const image = r.image_id ? (images.get(r.image_id as number) ?? undefined) : undefined;
      const vibeLine = trimCmsDecorativeWhitespace(r.vibe_line_source as string | null | undefined);
      const fromPrice = r.from_price !== null && r.from_price !== undefined ? Number(r.from_price) : null;
      const starRating = (() => {
        if (r.star_rating === null || r.star_rating === undefined) return undefined;
        const n = Number(r.star_rating);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 5) return undefined;
        return n;
      })();
      return HotelProposalCardSchema.parse({
        type: 'hotel' as const,
        id: String(r.id),
        ...(r.slug != null ? { slug: r.slug as string } : {}),
        headline: r.headline as string,
        ...(vibeLine !== undefined ? { vibeLine } : {}),
        ...(r.location_name != null ? { location: r.location_name as string } : {}),
        ...(starRating !== undefined ? { starRating } : {}),
        ...(r.accommodation_style != null ? { accommodationStyle: r.accommodation_style as string } : {}),
        fromPrice,
        ...(r.currency_code != null ? { currencyCode: r.currency_code as string } : {}),
        canonicalUrl: r.canonical_url as string,
        ...(image ? { image } : {}),
      });
    });
}

async function queryRegionBasesById(
  client: pg.PoolClient,
  ids: number[],
): Promise<ProposalCardPublic[]> {
  const sql = `
    WITH area_trip_count AS (
      SELECT region_id AS area_id, COUNT(*)::int AS trip_count
      FROM trip
      WHERE region_id IS NOT NULL
      GROUP BY region_id
    ),
    area_page AS (
      SELECT DISTINCT ON (a.id)
        a.id AS area_id,
        p.id AS page_id,
        p.canonical_url,
        p.image_id,
        p.summary,
        p.intro_text
      FROM area a
      LEFT JOIN page p
        ON (p.alias = a.alias AND p.parent_id IS NOT NULL)
        OR p.canonical_url LIKE '%/' || a.alias
      WHERE p.id IS NOT NULL
      ORDER BY a.id, (CASE WHEN p.alias = a.alias THEN 0 ELSE 1 END), p.id
    )
    SELECT
      a.id,
      a.alias,
      a.name AS headline,
      country.name AS country_name,
      ap.canonical_url,
      ap.image_id,
      COALESCE(ap.summary, ap.intro_text) AS vibe_line_source,
      atc.trip_count AS nearby_trips_count
    FROM area a
    LEFT JOIN country         ON country.id = a.country_id
    INNER JOIN area_page ap   ON ap.area_id = a.id
    INNER JOIN area_trip_count atc ON atc.area_id = a.id
    WHERE a.id = ANY($1::int[])
  `;
  const res = await client.query(sql, [ids]);
  const usableRows = res.rows.filter((r) => r.canonical_url != null);
  const imageIds = usableRows.map((r) => r.image_id as number | null);
  const images = await resolveImagesByIds(client, imageIds);

  return usableRows.map((r) => {
    const image = r.image_id ? (images.get(r.image_id as number) ?? undefined) : undefined;
    const vibeLine = trimCmsDecorativeWhitespace(r.vibe_line_source as string | null | undefined);
    const nearbyTripsCount = r.nearby_trips_count !== null ? Number(r.nearby_trips_count) : 0;
    return RegionBaseProposalCardSchema.parse({
      type: 'region_base' as const,
      id: String(r.id),
      ...(r.alias != null ? { slug: r.alias as string } : {}),
      headline: r.headline as string,
      ...(vibeLine !== undefined ? { vibeLine } : {}),
      ...(r.country_name != null ? { region: r.country_name as string } : {}),
      fromPrice: null,
      canonicalUrl: r.canonical_url as string,
      nearbyTripsCount,
      ...(image ? { image } : {}),
    });
  });
}

export const showOptionsSpec = {
  name: 'show_options' as const,
  inputSchema: ShowOptionsInputSchema,
  outputSchema: ShowOptionsOutputSchema,
};
