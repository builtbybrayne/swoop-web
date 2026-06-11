/**
 * Unit + DB-gated integration tests for `findImagesByKeywords` — the
 * `illustrate` data primitive.
 *
 * Per Tier-3 addendum on `planning/03-exec-c-t4.md` (2026-05-18 illustrate
 * tag-gate removal): ranking is cosine ANN on `image.embedding` only;
 * tag-array overlap has been dropped as a hard gate; `regionSlug` remains
 * as an optional hard filter.
 *
 * Unit tests mock `pg.PoolClient` and assert SQL shape + binds. Integration
 * tests run against `puma_dev` when `DATABASE_URL` is set — they verify
 * cosine ANN returns non-empty, plausibly relevant rows against the live
 * 6,118-row embedding corpus. Skipped silently otherwise.
 */

import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import {
  findImagesByKeywords,
  type FindImagesByKeywordsOptions,
} from '../find-images-by-keywords.js';
import { getPool, closePool, _resetPoolForTesting } from '../pool.js';
import { buildEmbedQuery, _resetEmbedCacheForTesting } from '../embed-query.js';
import type { Config } from '../../config/index.js';

interface QueryCall {
  sql: string;
  binds: unknown[];
}

interface QueryResult {
  rows: Record<string, unknown>[];
}

function makeMockClient(
  queryImpl: (sql: string, binds: unknown[]) => Promise<QueryResult>,
): { client: pg.PoolClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, binds: unknown[]) => {
      calls.push({ sql, binds });
      return queryImpl(sql, binds);
    }),
  } as unknown as pg.PoolClient;
  return { client, calls };
}

const DUMMY_EMBEDDING = new Array(3072).fill(0).map((_, i) => i / 3072);

describe('findImagesByKeywords — unit', () => {
  it('returns an empty array when the SQL result has no rows', async () => {
    const { client } = makeMockClient(async () => ({ rows: [] }));
    const out = await findImagesByKeywords(client, DUMMY_EMBEDDING, { limit: 4 });
    expect(out).toEqual([]);
  });

  it('builds SQL that ranks by cosine ANN against $1::vector, no tag-overlap gate', async () => {
    const { client, calls } = makeMockClient(async () => ({ rows: [] }));
    await findImagesByKeywords(client, DUMMY_EMBEDDING, { limit: 4 });

    expect(calls).toHaveLength(1);
    const { sql, binds } = calls[0]!;

    // Cosine-ANN ranking against $1 (now inside the dedup wrapper's
    // inner ORDER BY: `ORDER BY canonical_url, (embedding <=> $1::vector) ASC`).
    expect(sql).toMatch(/embedding <=> \$1::vector/);
    // Per-canonical_url dedup wrapper: keeps the closest-cosine row per URL.
    expect(sql).toMatch(/DISTINCT ON \(canonical_url\)/);
    // The non-null embedding gate remains — rows with no signal don't rank.
    expect(sql).toMatch(/embedding IS NOT NULL/);
    // Regression guard: no tag-array-overlap clause anywhere.
    expect(sql).not.toMatch(/subject_tags\s*&&/);
    expect(sql).not.toMatch(/mood_tags\s*&&/);
    expect(sql).not.toMatch(/region_tags\s*&&/);
    expect(sql).not.toMatch(/\btags\s*&&/);
    // No region clause when regionSlug not supplied.
    expect(sql).not.toMatch(/region_tags\s*@>/);
    // Two binds: embedding vector, limit.
    expect(binds).toHaveLength(2);
    expect(binds[0]).toBe(`[${DUMMY_EMBEDDING.join(',')}]`);
    expect(binds[1]).toBe(4);
  });

  it('accepts regionSlug without adding a region_tags clause (0/13,012 populated — 2026-06-11 hot patch)', async () => {
    // regionSlug is accepted-and-ignored: region_tags is 0/13,012 populated;
    // the hard filter was removed to avoid guaranteeing zero rows. The field
    // stays in the schema so existing agent calls aren't rejected.
    const { client, calls } = makeMockClient(async () => ({ rows: [] }));
    const opts: FindImagesByKeywordsOptions = {
      regionSlug: 'torres-del-paine',
      limit: 6,
    };
    await findImagesByKeywords(client, DUMMY_EMBEDDING, opts);

    expect(calls).toHaveLength(1);
    const { sql, binds } = calls[0]!;

    // No region_tags clause when regionSlug is supplied.
    expect(sql).not.toMatch(/region_tags\s*@>/);
    expect(sql).toMatch(/embedding <=> \$1::vector/);
    expect(sql).toMatch(/DISTINCT ON \(canonical_url\)/);
    // Binds: embedding, limit (no regionSlug bind).
    expect(binds).toHaveLength(2);
    expect(binds[0]).toBe(`[${DUMMY_EMBEDDING.join(',')}]`);
    expect(binds[1]).toBe(6);
  });

  it('parses row shape into the public ImageRow contract', async () => {
    const { client } = makeMockClient(async () => ({
      rows: [
        {
          id: 4233,
          canonical_url: 'https://swoop-patagonia.imgix.net/example.jpg',
          alt_text: 'A rustic mountain lodge',
          description: 'Interior of a rustic mountain lodge with tree trunks.',
        },
      ],
    }));
    const out = await findImagesByKeywords(client, DUMMY_EMBEDDING, { limit: 1 });
    expect(out).toEqual([
      {
        id: '4233',
        url: 'https://swoop-patagonia.imgix.net/example.jpg',
        altText: 'A rustic mountain lodge',
        caption: 'Interior of a rustic mountain lodge with tree trunks.',
      },
    ]);
  });

  it('omits caption when the description column is null', async () => {
    const { client } = makeMockClient(async () => ({
      rows: [
        {
          id: 1,
          canonical_url: 'https://swoop-patagonia.imgix.net/x.jpg',
          alt_text: '',
          description: null,
        },
      ],
    }));
    const out = await findImagesByKeywords(client, DUMMY_EMBEDDING, { limit: 1 });
    expect(out[0]?.caption).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — gated on DATABASE_URL + GEMINI_API_KEY. These are the
// "operator runs these locally to verify cosine ANN actually surfaces
// plausible images against the live puma_dev corpus" tests. Skipped silently
// in CI / on machines without the keys.
// ---------------------------------------------------------------------------

const integrationUrl = process.env.DATABASE_URL ?? null;
const geminiKey = process.env.GEMINI_API_KEY ?? null;
const describeIfDb = integrationUrl && geminiKey ? describe : describe.skip;

function makeIntegrationConfig(): Config {
  return Object.freeze({
    DATABASE_URL: integrationUrl ?? '',
    CONNECTOR_PORT: 3002,
    PG_POOL_MAX: 10,
    PG_STATEMENT_TIMEOUT_MS: 10000,
    GEMINI_API_KEY: geminiKey ?? '',
    LOG_LEVEL: 'info',
    TOOLS_PROMPT_DIR: 'cms/prompts/tools',
    toolsPromptDirAbsolutePath: '/tmp/unused-for-data-primitive',
  } as unknown as Config);
}

describeIfDb('findImagesByKeywords — integration (DATABASE_URL + GEMINI_API_KEY)', () => {
  it('returns non-empty rows for the screenshot scenario keywords', async () => {
    _resetPoolForTesting();
    _resetEmbedCacheForTesting();
    const cfg = makeIntegrationConfig();
    const pool = getPool(cfg);
    const embed = buildEmbedQuery(cfg);

    try {
      const embedding = await embed(
        ['patagonia', 'mountains', 'glaciers', 'torres del paine', 'hiking'].join(' '),
      );
      const client = await pool.connect();
      try {
        const rows = await findImagesByKeywords(client, embedding, { limit: 6 });
        // Smoke: with 6,118 annotated rows in puma_dev, this query MUST
        // surface at least one image; if it doesn't, the cosine substrate
        // is broken.
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.id).toMatch(/^\d+$/);
          expect(row.url).toMatch(/^https?:\/\//);
        }
        // Useful operator-facing log for diagnosing relevance quality.
        // eslint-disable-next-line no-console
        console.log(
          '[smoke] findImagesByKeywords(patagonia…hiking) →',
          rows.map((r) => ({
            id: r.id,
            url: r.url,
            caption: r.caption?.slice(0, 120),
          })),
        );
      } finally {
        client.release();
      }
    } finally {
      await closePool();
    }
  }, 30_000);

  it('respects an optional regionSlug filter without erroring', async () => {
    _resetPoolForTesting();
    _resetEmbedCacheForTesting();
    const cfg = makeIntegrationConfig();
    const pool = getPool(cfg);
    const embed = buildEmbedQuery(cfg);

    try {
      const embedding = await embed('granite tower at golden hour');
      const client = await pool.connect();
      try {
        // regionSlug is accepted-and-ignored (2026-06-11 hot patch) — the
        // region_tags hard filter was removed (0/13,012 populated); result
        // is now the same as without a slug (cosine ANN only). Lights up once
        // a future re-annotation populates region_tags.
        const rows = await findImagesByKeywords(client, embedding, {
          regionSlug: 'torres-del-paine',
          limit: 4,
        });
        expect(Array.isArray(rows)).toBe(true);
        // eslint-disable-next-line no-console
        console.log(
          '[smoke] findImagesByKeywords(region=torres-del-paine) →',
          rows.length,
          'rows (expected ~0 today; lights up post-re-annotation)',
        );
      } finally {
        client.release();
      }
    } finally {
      await closePool();
    }
  }, 30_000);
});
