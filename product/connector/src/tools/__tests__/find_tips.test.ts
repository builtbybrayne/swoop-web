/**
 * `find_tips` handler — embed-then-retrieve contract tests.
 *
 * find_tips is the 9th MCP tool (second shape of the Inform job): it returns
 * short, attributed, first-person traveller tips via hybrid RRF over
 * `customer_tip`. The handler embeds `topic`, then threads
 * `region` / `limit` / `excludeIds` into the `findCustomerTipsByTopic`
 * primitive inside one `withClient`.
 *
 * These tests stub the data primitive so they don't need a live `puma_dev`
 * Postgres. SQL-shape correctness against real data is downstream of the
 * live-data smoke (plan §5).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FindTipsOutputSchema } from '@swoop/common';

import { findTipsBody } from '../find_tips.js';
import type { ToolHandlerDeps } from '../deps.js';

vi.mock('../../data/find-customer-tips.js', () => ({
  findCustomerTipsByTopic: vi.fn(),
}));

import { findCustomerTipsByTopic } from '../../data/find-customer-tips.js';

const mockFind = findCustomerTipsByTopic as unknown as ReturnType<typeof vi.fn>;

/** Records the embedded query so we can assert the topic is what gets embedded. */
let embeddedQueries: string[] = [];

function makeDeps(): ToolHandlerDeps {
  return {
    withClient: async (fn) =>
      fn({} as unknown as Parameters<ToolHandlerDeps['withClient']>[0] extends (
        arg: infer C,
      ) => unknown
        ? C
        : never),
    embedQuery: async (text: string) => {
      embeddedQueries.push(text);
      return new Array(3072).fill(0);
    },
  };
}

const TIP = {
  id: 1,
  text: 'Bring windproof everything — the Patagonian gusts are no joke.',
  authorName: 'Sarah',
  topicTags: ['packing', 'weather'],
  region: 'torres del paine',
};

beforeEach(() => {
  mockFind.mockReset();
  embeddedQueries = [];
});

describe('find_tips handler', () => {
  it('embeds the topic and returns tips + count', async () => {
    mockFind.mockResolvedValueOnce([
      { ...TIP, id: 1 },
      { ...TIP, id: 2, authorName: null, region: null },
    ]);

    const out = await findTipsBody(
      { topic: 'what should I pack', limit: 4 },
      makeDeps(),
    );

    expect(embeddedQueries).toEqual(['what should I pack']);
    expect(out.count).toBe(2);
    expect(out.tips).toHaveLength(2);
    expect(() => FindTipsOutputSchema.parse(out)).not.toThrow();
  });

  it('threads region, limit and excludeIds through to the primitive', async () => {
    mockFind.mockResolvedValueOnce([]);

    await findTipsBody(
      {
        topic: 'money',
        region: 'el calafate',
        limit: 3,
        excludeIds: [11, 22],
      },
      makeDeps(),
    );

    const lastCall = mockFind.mock.calls[0] as [
      unknown,
      number[],
      string,
      Record<string, unknown>,
    ];
    // (client, embedding, query, opts)
    expect(lastCall[2]).toBe('money');
    expect(lastCall[3]).toMatchObject({
      region: 'el calafate',
      limit: 3,
      excludeIds: [11, 22],
    });
  });

  it('handles an empty primitive result (count = 0)', async () => {
    mockFind.mockResolvedValueOnce([]);
    const out = await findTipsBody(
      { topic: 'is the wind that bad', limit: 4 },
      makeDeps(),
    );
    expect(out).toEqual({ tips: [], count: 0 });
  });

  it('passes undefined region/excludeIds straight through (no crash)', async () => {
    mockFind.mockResolvedValueOnce([{ ...TIP }]);

    await findTipsBody({ topic: 'food', limit: 4 }, makeDeps());

    const opts = (mockFind.mock.calls[0] as [unknown, unknown, unknown, Record<string, unknown>])[3];
    expect(opts).toMatchObject({ limit: 4 });
    expect(opts.region).toBeUndefined();
    expect(opts.excludeIds).toBeUndefined();
  });
});
