/**
 * Unit tests for `findCustomerTipsByTopic` — the `find_tips` data primitive.
 *
 * Per Tier-3 plan `planning/03-exec-customer-tips-tool.md`. Mocks `pg.PoolClient`
 * so the suite runs without a live `puma_dev` Postgres. SQL-shape correctness
 * against real data is verified downstream by the live-data smoke (plan §5).
 *
 * What we pin here is the *shape* of the query the primitive emits: the bind
 * order ($1 embedding, $2 query, $3 limit, then optional region / excludeIds),
 * the optional `(region = $N OR region IS NULL)` and `id <> ALL($N::int[])`
 * filter clauses, the customer_tip routing through `buildHybridSearchSql`, and
 * the row → CustomerTipPublic mapping.
 */

import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { CustomerTipPublicSchema } from '@swoop/common';

import { findCustomerTipsByTopic } from '../find-customer-tips.js';

interface QueryResult {
  rows: Record<string, unknown>[];
}

function makeMockClient(
  queryImpl: (sql: string, binds: unknown[]) => Promise<QueryResult>,
): pg.PoolClient {
  return {
    query: vi.fn(queryImpl),
  } as unknown as pg.PoolClient;
}

/** A canonical 3072-dim embedding stand-in (length doesn't matter for mocks). */
const EMBEDDING = [0.1, 0.2, 0.3];

describe('findCustomerTipsByTopic', () => {
  it('returns an empty array when the SQL result has no rows', async () => {
    const client = makeMockClient(async () => ({ rows: [] }));
    const out = await findCustomerTipsByTopic(client, EMBEDDING, 'the wind', {
      limit: 4,
    });
    expect(out).toEqual([]);
  });

  it('routes through customer_tip and binds embedding/query/limit in order', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await findCustomerTipsByTopic(client, EMBEDDING, 'handling the wind', {
      limit: 5,
    });

    expect(queryFn).toHaveBeenCalledOnce();
    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    // Hybrid retrieval over the traveller-tip corpus.
    expect(sql).toMatch(/customer_tip/);
    expect(sql).toMatch(/\$1::vector/);
    // $1 is the pgvector literal string, NOT a raw number[].
    expect(binds[0]).toBe('[0.1,0.2,0.3]');
    // $2 query, $3 limit.
    expect(binds[1]).toBe('handling the wind');
    expect(binds[2]).toBe(5);
  });

  it('omits region + excludeIds clauses when neither option is supplied', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await findCustomerTipsByTopic(client, EMBEDDING, 'money', { limit: 4 });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/region = \$/);
    expect(sql).not.toMatch(/<> ALL/);
    // Only the three mandatory binds.
    expect(binds).toHaveLength(3);
  });

  it('adds the region filter (region-agnostic tips still eligible) and trims the bind', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await findCustomerTipsByTopic(client, EMBEDDING, 'food', {
      region: '  el calafate  ',
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    // OR region IS NULL keeps region-agnostic tips in the pool.
    expect(sql).toMatch(/\(region = \$4 OR region IS NULL\)/);
    expect(binds).toHaveLength(4);
    expect(binds[3]).toBe('el calafate');
  });

  it('does NOT add a region clause for a blank/whitespace region', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await findCustomerTipsByTopic(client, EMBEDDING, 'food', {
      region: '   ',
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/region = \$/);
    expect(binds).toHaveLength(3);
  });

  it('adds the anti-repetition exclusion casting ::int[] (not ::uuid[])', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await findCustomerTipsByTopic(client, EMBEDDING, 'safety', {
      excludeIds: [11, 22, 33],
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/id <> ALL\(\$4::int\[\]\)/);
    expect(sql).not.toMatch(/::uuid\[\]/);
    expect(binds).toHaveLength(4);
    expect(binds[3]).toEqual([11, 22, 33]);
  });

  it('threads BOTH region and excludeIds with the correct bind indices', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await findCustomerTipsByTopic(client, EMBEDDING, 'transit', {
      region: 'torres del paine',
      excludeIds: [7],
      limit: 6,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    // Region binds at $4, excludeIds at $5 (region pushed first).
    expect(sql).toMatch(/\(region = \$4 OR region IS NULL\)/);
    expect(sql).toMatch(/id <> ALL\(\$5::int\[\]\)/);
    expect(binds).toHaveLength(5);
    expect(binds[3]).toBe('torres del paine');
    expect(binds[4]).toEqual([7]);
  });

  it('omits the exclusion clause for an empty excludeIds array', async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: queryFn } as unknown as pg.PoolClient;

    await findCustomerTipsByTopic(client, EMBEDDING, 'etiquette', {
      excludeIds: [],
      limit: 4,
    });

    const [sql, binds] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/<> ALL/);
    expect(binds).toHaveLength(3);
  });

  it('maps a populated row to a CustomerTipPublic', async () => {
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 42,
          text: 'Bring windproof everything — the Patagonian gusts are no joke.',
          author_name: 'Sarah',
          region: 'torres del paine',
          rrf_score: 0.031,
        },
      ],
    }));

    const out = await findCustomerTipsByTopic(client, EMBEDDING, 'wind', {
      limit: 4,
    });

    expect(out).toHaveLength(1);
    const tip = out[0]!;
    expect(tip.id).toBe(42);
    expect(tip.text).toBe(
      'Bring windproof everything — the Patagonian gusts are no joke.',
    );
    expect(tip.authorName).toBe('Sarah');
    expect(tip.region).toBe('torres del paine');
    expect(() => CustomerTipPublicSchema.parse(tip)).not.toThrow();
  });

  it('maps an anonymous, region-agnostic row (null author / null region)', async () => {
    const client = makeMockClient(async () => ({
      rows: [
        {
          id: 7,
          text: 'Layer up and keep snacks handy.',
          author_name: null,
          region: null,
          rrf_score: 0.02,
        },
      ],
    }));

    const out = await findCustomerTipsByTopic(client, EMBEDDING, 'food', {
      limit: 4,
    });

    expect(out).toHaveLength(1);
    const tip = out[0]!;
    expect(tip.authorName).toBeNull();
    expect(tip.region).toBeNull();
    expect(() => CustomerTipPublicSchema.parse(tip)).not.toThrow();
  });
});
