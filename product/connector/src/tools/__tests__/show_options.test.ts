/**
 * Unit tests for the `show_options` handler — grouping, curation-order
 * preservation, and the empty-id fast path. SQL correctness is covered by
 * live verification against puma_dev (the by-id queries share their
 * SELECT + mapper with the filter paths in data/query-*.ts).
 */

import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { showOptionsBody, showOptionsSpec } from '../show_options.js';
import type { ToolHandlerDeps } from '../deps.js';

/**
 * Stub client routing each by-id query to a canned row set. Routes on the
 * target table name in the SQL text — stable across the shared
 * SELECT-block constants.
 */
function makeStubClient(rowsByTable: Record<string, unknown[]>): pg.PoolClient {
  return {
    query: vi.fn(async (sql: string) => {
      if (/FROM\s+trip_card/i.test(sql)) return { rows: rowsByTable.trip_card ?? [] };
      if (/FROM\s+tour_card/i.test(sql)) return { rows: rowsByTable.tour_card ?? [] };
      if (/FROM\s+hotel\b/i.test(sql)) return { rows: rowsByTable.hotel ?? [] };
      if (/FROM\s+area\b/i.test(sql)) return { rows: rowsByTable.area ?? [] };
      if (/FROM\s+image/i.test(sql)) return { rows: rowsByTable.image ?? [] };
      return { rows: [] };
    }),
  } as unknown as pg.PoolClient;
}

function makeDeps(client: pg.PoolClient): ToolHandlerDeps {
  return {
    withClient: async (fn) => fn(client),
    embedQuery: vi.fn(async () => new Array(3072).fill(0)),
  };
}

const tripRow = {
  id: 7,
  slug: 'w-trek',
  headline: 'W Trek',
  vibe_line: null,
  region: 'Torres del Paine',
  duration_days: 5,
  from_price: '2150',
  currency_code: 'GBP',
  accommodation_style: null,
  activity_tags: ['hiking'],
  canonical_url: 'https://www.swoop-patagonia.com/trips/w-trek',
  image_id: null,
};

const tourRow = {
  id: 3,
  slug: 'classic',
  headline: 'Patagonia Classic',
  vibe_line: null,
  region: 'Southern Patagonia',
  day_count: 12,
  duration_days: 12,
  group_size_max: 8,
  from_price: '4850',
  currency_code: 'GBP',
  accommodation_style: null,
  activity_tags: [],
  canonical_url: 'https://www.swoop-patagonia.com/tours/classic',
  image_id: null,
};

describe('showOptionsBody', () => {
  it('hydrates cards, attaches group, and preserves the curation order', async () => {
    const client = makeStubClient({ trip_card: [tripRow], tour_card: [tourRow] });
    const out = await showOptionsBody(
      {
        items: [
          { type: 'tour', id: 3, group: 'primary' },
          { type: 'trip', id: 7, group: 'also_interesting' },
        ],
      },
      makeDeps(client),
    );

    expect(out.cards).toHaveLength(2);
    // Curation order: tour first (input position 0), trip second — NOT the
    // type-batched DB return order (trips would otherwise lead).
    expect(out.cards[0]).toMatchObject({ type: 'tour', id: '3', group: 'primary' });
    expect(out.cards[1]).toMatchObject({
      type: 'trip',
      id: '7',
      group: 'also_interesting',
    });
  });

  it('skips queries for types with no requested ids (empty fast path)', async () => {
    const client = makeStubClient({ trip_card: [tripRow] });
    await showOptionsBody(
      { items: [{ type: 'trip', id: 7, group: 'primary' }] },
      makeDeps(client),
    );
    const sqlCalls = (client.query as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]),
    );
    // Only the trip_card by-id query (plus its image resolution) fired.
    expect(sqlCalls.some((s) => /FROM\s+trip_card/i.test(s))).toBe(true);
    expect(sqlCalls.some((s) => /FROM\s+tour_card/i.test(s))).toBe(false);
    expect(sqlCalls.some((s) => /FROM\s+hotel\b/i.test(s))).toBe(false);
  });

  it('drops ids the DB no longer knows (no padding, no throw)', async () => {
    const client = makeStubClient({ trip_card: [tripRow] });
    const out = await showOptionsBody(
      {
        items: [
          { type: 'trip', id: 7, group: 'primary' },
          { type: 'trip', id: 999999, group: 'primary' },
        ],
      },
      makeDeps(client),
    );
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]!.id).toBe('7');
  });

  it('spec advertises the show_options contract', () => {
    expect(showOptionsSpec.name).toBe('show_options');
    expect(showOptionsSpec.inputSchema).toBeDefined();
    expect(showOptionsSpec.outputSchema).toBeDefined();
  });
});
