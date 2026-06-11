/**
 * `get_pricing` — raw pricing matrix tool (tenth tool).
 *
 * Returns hotel package pricing or trip headline prices exactly as Swoop
 * authored them, stamped with the capture date. No interpretation, no
 * normalisation — that happens at conversation time per the raw-data principle
 * (Alastair 2026-06-11 HITL session).
 *
 * Hotel prices are package prices for N nights per room type and season, in
 * the hotel's own authored currency. Trip prices are headline "from" prices.
 *
 * Scoping: by ids, by region (ILIKE), or full-matrix fallback when neither is
 * supplied. Full-matrix covers ~26 priced hotels (~8–15K tokens) — allowed but
 * agents should prefer scoped calls when context is comparative.
 *
 * Plan: planning/03-exec-crosscut-goofy-goldstine-pricing-data.md §2.4.
 * Decision C.goofy-goldstine-3.
 */

import type pg from 'pg';
import {
  GetPricingInputSchema,
  GetPricingOutputSchema,
  type GetPricingInput,
  type GetPricingOutput,
} from '@swoop/common';
import type { ToolHandlerDeps } from './deps.js';

export const getPricingSpec = {
  name: 'get_pricing' as const,
  inputSchema: GetPricingInputSchema,
  outputSchema: GetPricingOutputSchema,
};

// ---------------------------------------------------------------------------
// Handler body
// ---------------------------------------------------------------------------

export async function getPricingBody(
  input: GetPricingInput,
  deps: ToolHandlerDeps,
  capturedAt: string,
): Promise<GetPricingOutput> {
  return deps.withClient(async (client) => {
    if (input.target === 'hotel') {
      return fetchHotelPricing(client, input, capturedAt);
    } else {
      return fetchTripPricing(client, input, capturedAt);
    }
  });
}

// ---------------------------------------------------------------------------
// Hotel pricing fetch
// ---------------------------------------------------------------------------

interface HotelPricingDbRow {
  hotel_id: number;
  hotel_name: string;
  hotel_location: string | null;
  currency_code: string | null;
  room_name: string | null;
  season: string | null;
  nights: number | null;
  price: number;
}

async function fetchHotelPricing(
  client: pg.PoolClient,
  input: GetPricingInput,
  capturedAt: string,
): Promise<GetPricingOutput> {
  const binds: unknown[] = [];
  const whereClauses: string[] = [];

  if (input.ids && input.ids.length > 0) {
    binds.push(input.ids);
    whereClauses.push(`h.id = ANY($${binds.length}::int[])`);
  }
  if (input.region) {
    binds.push(`%${input.region}%`);
    const ref = `$${binds.length}`;
    whereClauses.push(
      `(area.alias ILIKE ${ref} OR area.name ILIKE ${ref} OR loc.name ILIKE ${ref})`,
    );
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT
      h.id                              AS hotel_id,
      h.name                            AS hotel_name,
      COALESCE(loc.name, area.name)     AS hotel_location,
      hp.currency_code,
      hr.name                           AS room_name,
      hp.season,
      hp.nights,
      hp.price
    FROM hotel h
    LEFT JOIN location loc  ON loc.id = h.location_id
    LEFT JOIN area          ON area.id = h.area_id
    JOIN hotel_pricing hp   ON hp.hotel_id = h.id
    JOIN hotel_room hr      ON hr.id = hp.room_id
    ${where}
    ORDER BY h.id, hr.name, hp.season, hp.nights
  `;

  const res = await client.query<HotelPricingDbRow>(sql, binds);

  // Group rows by hotel_id.
  const hotelMap = new Map<
    number,
    {
      id: number;
      name: string;
      location: string | null;
      currencyCode: string | null;
      rows: Array<{ room: string; season: string | null; nights: number | null; price: number }>;
    }
  >();

  for (const row of res.rows) {
    let hotel = hotelMap.get(row.hotel_id);
    if (!hotel) {
      hotel = {
        id: row.hotel_id,
        name: row.hotel_name,
        location: row.hotel_location ?? null,
        currencyCode: row.currency_code ?? null,
        rows: [],
      };
      hotelMap.set(row.hotel_id, hotel);
    }
    hotel.rows.push({
      room: row.room_name ?? '(unnamed room)',
      season: row.season ?? null,
      nights: row.nights ?? null,
      price: Number(row.price),
    });
  }

  return GetPricingOutputSchema.parse({
    capturedAt,
    hotels: [...hotelMap.values()],
  });
}

// ---------------------------------------------------------------------------
// Trip pricing fetch
// ---------------------------------------------------------------------------

interface TripPricingDbRow {
  id: number;
  title: string;
  from_price: number | null;
  currency_code: string | null;
}

async function fetchTripPricing(
  client: pg.PoolClient,
  input: GetPricingInput,
  capturedAt: string,
): Promise<GetPricingOutput> {
  const binds: unknown[] = [];
  const whereClauses: string[] = ['t.from_price IS NOT NULL'];

  if (input.ids && input.ids.length > 0) {
    binds.push(input.ids);
    whereClauses.push(`t.id = ANY($${binds.length}::int[])`);
  }
  if (input.region) {
    binds.push(`%${input.region}%`);
    const ref = `$${binds.length}`;
    whereClauses.push(
      `(area.alias ILIKE ${ref} OR area.name ILIKE ${ref})`,
    );
  }

  const where = `WHERE ${whereClauses.join(' AND ')}`;

  const sql = `
    SELECT
      t.id,
      t.title,
      t.from_price,
      t.currency_code
    FROM trip t
    LEFT JOIN area ON area.id = t.region_id
    ${where}
    ORDER BY t.id
  `;

  const res = await client.query<TripPricingDbRow>(sql, binds);

  return GetPricingOutputSchema.parse({
    capturedAt,
    trips: res.rows.map((r) => ({
      id: r.id,
      title: r.title,
      fromPrice: r.from_price !== null ? Number(r.from_price) : null,
      currencyCode: r.currency_code ?? null,
    })),
  });
}
