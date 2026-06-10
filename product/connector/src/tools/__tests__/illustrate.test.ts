/**
 * `illustrate` handler — default-count contract tests.
 *
 * The load-bearing assertion: when the agent omits `count`, the handler asks
 * the data primitive for exactly ONE image (decision D.poincare-3,
 * planning/03-exec-crosscut-magical-poincare-visual-channel.md — one hero
 * image per conversational moment; multi-image is agent-explicit). The tool
 * description teaches the default; this test pins the enforcement.
 *
 * Mirrors find_tips.test.ts: the data primitive is stubbed so no live
 * `puma_dev` Postgres is needed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { IllustrateOutputSchema } from '@swoop/common';

import { illustrateBody } from '../illustrate.js';
import type { ToolHandlerDeps } from '../deps.js';

vi.mock('../../data/find-images-by-keywords.js', () => ({
  findImagesByKeywords: vi.fn(),
}));

import { findImagesByKeywords } from '../../data/find-images-by-keywords.js';

const mockFind = findImagesByKeywords as unknown as ReturnType<typeof vi.fn>;

/** Records the embedded query so we can assert the keywords get embedded. */
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

const IMAGE = {
  id: 'image_glacier_001',
  url: 'https://cdn.example.com/puma-fixtures/glacier.jpg',
  altText: 'Blue glacier wall at midday',
};

beforeEach(() => {
  mockFind.mockReset();
  embeddedQueries = [];
});

describe('illustrate handler', () => {
  it('defaults to limit 1 when the agent omits count (one hero image)', async () => {
    mockFind.mockResolvedValueOnce([IMAGE]);

    const out = await illustrateBody(
      { keywords: ['glacier', 'ice'] },
      makeDeps(),
    );

    expect(embeddedQueries).toEqual(['glacier ice']);
    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockFind.mock.calls[0][2]).toMatchObject({ limit: 1 });
    expect(out.images).toHaveLength(1);
    expect(() => IllustrateOutputSchema.parse(out)).not.toThrow();
  });

  it('threads an explicit count through as the limit (agent-explicit multi-image)', async () => {
    mockFind.mockResolvedValueOnce([
      IMAGE,
      { ...IMAGE, id: 'image_glacier_002' },
      { ...IMAGE, id: 'image_glacier_003' },
    ]);

    await illustrateBody(
      {
        keywords: ['granite towers', 'beech forest'],
        count: 3,
        regionSlug: 'torres-del-paine',
        excludeCanonicalUrls: ['https://cdn.example.com/seen.jpg'],
      },
      makeDeps(),
    );

    expect(mockFind.mock.calls[0][2]).toMatchObject({
      limit: 3,
      regionSlug: 'torres-del-paine',
      excludeCanonicalUrls: ['https://cdn.example.com/seen.jpg'],
    });
  });
});
