/**
 * Vitest suite for the blog fetch pipeline.
 *
 * No real network calls — the run() orchestrator accepts an injectable
 * `fetcher` and `sleep` so we can drive every code path deterministically.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BLOG_ENDPOINT,
  ManifestSchema,
  buildPostsUrl,
  computeRelevanceCutoff,
  fetchPageWithRetry,
  parseArgs,
  readPriorFloor,
  run,
  toFolderStamp,
  type HttpFetcher,
  type HttpResponse,
  type Manifest,
} from '../fetch.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function makeTempDataRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'puma-blog-ingest-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Build a tiny stub WP post payload satisfying the fields we actually
 * read; rest of the API surface is irrelevant for these tests.
 */
function makePost(overrides: Partial<{ id: number; date: string; modified: string }>): Record<string, unknown> {
  return {
    id: 1,
    date: '2024-06-01T10:00:00',
    modified: '2024-06-01T10:00:00',
    title: { rendered: 'Test post' },
    content: { rendered: '<p>Body</p>' },
    ...overrides,
  };
}

/**
 * Helper that captures every URL the fetcher saw.
 */
interface MockFetcher {
  fetcher: HttpFetcher;
  calls: string[];
}

function recordingFetcher(handler: (url: string, callIndex: number) => HttpResponse | Promise<HttpResponse>): MockFetcher {
  const calls: string[] = [];
  const fetcher: HttpFetcher = async (url) => {
    const idx = calls.length;
    calls.push(url);
    return await handler(url, idx);
  };
  return { fetcher, calls };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return { status: 200, headers, body };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to incremental mode', () => {
    expect(parseArgs([])).toEqual({ mode: 'incremental', since: null, dryRun: false });
  });

  it('parses --backfill', () => {
    expect(parseArgs(['--backfill'])).toEqual({ mode: 'backfill', since: null, dryRun: false });
  });

  it('parses --since=YYYY-MM-DD', () => {
    expect(parseArgs(['--since=2024-01-01'])).toEqual({
      mode: 'explicit-since',
      since: '2024-01-01',
      dryRun: false,
    });
  });

  it('parses --dry-run', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ mode: 'incremental', since: null, dryRun: true });
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--what'])).toThrow(/Unknown flag/);
  });

  it('rejects --since with no value', () => {
    expect(() => parseArgs(['--since='])).toThrow(/--since requires a value/);
  });
});

// ---------------------------------------------------------------------------
// computeRelevanceCutoff + buildPostsUrl + toFolderStamp
// ---------------------------------------------------------------------------

describe('pure helpers', () => {
  it('computeRelevanceCutoff is exactly 5 years before now', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    expect(computeRelevanceCutoff(now)).toBe('2021-04-28T12:00:00Z');
  });

  it('buildPostsUrl includes the expected query params', () => {
    const url = buildPostsUrl({
      page: 2,
      after: '2021-04-28T12:00:00Z',
      modifiedAfter: '2025-01-01T00:00:00',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(BLOG_ENDPOINT);
    expect(parsed.searchParams.get('per_page')).toBe('100');
    expect(parsed.searchParams.get('orderby')).toBe('modified');
    expect(parsed.searchParams.get('order')).toBe('asc');
    expect(parsed.searchParams.get('_embed')).toBe('true');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.get('after')).toBe('2021-04-28T12:00:00Z');
    expect(parsed.searchParams.get('modified_after')).toBe('2025-01-01T00:00:00');
  });

  it('buildPostsUrl omits modified_after when null', () => {
    const url = buildPostsUrl({ page: 1, after: '2021-04-28T12:00:00Z', modifiedAfter: null });
    expect(new URL(url).searchParams.has('modified_after')).toBe(false);
  });

  it('toFolderStamp produces compact UTC stamp', () => {
    expect(toFolderStamp(new Date('2026-04-28T13:45:09.123Z'))).toBe('20260428T134509Z');
  });
});

// ---------------------------------------------------------------------------
// fetchPageWithRetry
// ---------------------------------------------------------------------------

describe('fetchPageWithRetry', () => {
  it('succeeds on first attempt with no retries', async () => {
    const { fetcher, calls } = recordingFetcher(() => jsonResponse([], { 'x-wp-totalpages': '0' }));
    const result = await fetchPageWithRetry('https://example/x', {
      fetcher,
      sleep: async () => undefined,
    });
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(0);
    expect(calls.length).toBe(1);
  });

  it('retries 5xx and succeeds on the third attempt', async () => {
    let n = 0;
    const { fetcher, calls } = recordingFetcher(() => {
      n++;
      if (n < 3) return { status: 503, headers: {}, body: null };
      return jsonResponse([{ id: 1, date: '2024-01-01T00:00:00', modified: '2024-01-01T00:00:00' }]);
    });
    const result = await fetchPageWithRetry('https://example/x', {
      fetcher,
      sleep: async () => undefined,
    });
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(calls.length).toBe(3);
  });

  it('throws when all three 5xx attempts fail', async () => {
    const { fetcher, calls } = recordingFetcher(() => ({ status: 503, headers: {}, body: null }));
    await expect(
      fetchPageWithRetry('https://example/x', { fetcher, sleep: async () => undefined }),
    ).rejects.toThrow(/Retries exhausted/);
    expect(calls.length).toBe(3);
  });

  it('retries network errors', async () => {
    let n = 0;
    const { fetcher } = recordingFetcher(() => {
      n++;
      if (n === 1) throw new Error('ECONNRESET');
      return jsonResponse([]);
    });
    const result = await fetchPageWithRetry('https://example/x', {
      fetcher,
      sleep: async () => undefined,
    });
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(1);
  });

  it('honours Retry-After on 429 then succeeds', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const { fetcher } = recordingFetcher(() => {
      n++;
      if (n === 1) return { status: 429, headers: { 'retry-after': '0' }, body: null };
      return jsonResponse([]);
    });
    const result = await fetchPageWithRetry('https://example/x', {
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.status).toBe(200);
    expect(sleeps).toEqual([0]);
  });

  it('throws RateLimitError if 429 repeats', async () => {
    const { fetcher } = recordingFetcher(() => ({
      status: 429,
      headers: { 'retry-after': '0' },
      body: null,
    }));
    await expect(
      fetchPageWithRetry('https://example/x', {
        fetcher,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/429 after retry/);
  });

  it('does not retry 4xx (other than 429)', async () => {
    const { fetcher, calls } = recordingFetcher(() => ({ status: 404, headers: {}, body: null }));
    await expect(
      fetchPageWithRetry('https://example/x', { fetcher, sleep: async () => undefined }),
    ).rejects.toThrow(/HTTP 404/);
    expect(calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Manifest schema validation
// ---------------------------------------------------------------------------

describe('ManifestSchema', () => {
  it('accepts a well-formed manifest', () => {
    const m: Manifest = {
      ingested_at: '2026-04-28T12:00:00Z',
      mode: 'backfill',
      endpoint: BLOG_ENDPOINT,
      params_used: {
        per_page: 100,
        orderby: 'modified',
        order: 'asc',
        _embed: true,
        after: '2021-04-28T12:00:00Z',
        modified_after: null,
      },
      relevance_cutoff: '2021-04-28T12:00:00Z',
      pages_fetched: 0,
      post_count: 0,
      earliest_published: null,
      latest_published: null,
      earliest_modified_seen: null,
      latest_modified_seen: null,
      duration_ms: 50,
      errors: [],
    };
    expect(() => ManifestSchema.parse(m)).not.toThrow();
  });

  it('rejects bad ingested_at format', () => {
    const m = {
      ingested_at: 'not-a-stamp',
      mode: 'backfill',
      endpoint: BLOG_ENDPOINT,
      params_used: {
        per_page: 100,
        orderby: 'modified',
        order: 'asc',
        _embed: true,
        after: '2021-04-28T12:00:00Z',
        modified_after: null,
      },
      relevance_cutoff: '2021-04-28T12:00:00Z',
      pages_fetched: 0,
      post_count: 0,
      earliest_published: null,
      latest_published: null,
      earliest_modified_seen: null,
      latest_modified_seen: null,
      duration_ms: 50,
      errors: [],
    };
    expect(() => ManifestSchema.parse(m)).toThrow();
  });

  it('rejects unknown mode', () => {
    expect(() =>
      ManifestSchema.parse({
        ingested_at: '2026-04-28T12:00:00Z',
        mode: 'something',
        endpoint: BLOG_ENDPOINT,
        params_used: {
          per_page: 100,
          orderby: 'modified',
          order: 'asc',
          _embed: true,
          after: '2021-04-28T12:00:00Z',
          modified_after: null,
        },
        relevance_cutoff: '2021-04-28T12:00:00Z',
        pages_fetched: 0,
        post_count: 0,
        earliest_published: null,
        latest_published: null,
        earliest_modified_seen: null,
        latest_modified_seen: null,
        duration_ms: 50,
        errors: [],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// readPriorFloor
// ---------------------------------------------------------------------------

describe('readPriorFloor', () => {
  it('returns null when raw root absent', () => {
    const dataRoot = makeTempDataRoot();
    expect(readPriorFloor(path.join(dataRoot, 'raw'))).toBeNull();
  });

  it('returns null when manifest has errors recorded', () => {
    const rawRoot = path.join(makeTempDataRoot(), 'raw');
    const folder = path.join(rawRoot, '20260101T000000Z');
    mkdirSync(folder, { recursive: true });
    const manifest = {
      ingested_at: '2026-01-01T00:00:00Z',
      mode: 'incremental',
      endpoint: BLOG_ENDPOINT,
      params_used: {
        per_page: 100,
        orderby: 'modified',
        order: 'asc',
        _embed: true,
        after: '2021-01-01T00:00:00Z',
        modified_after: null,
      },
      relevance_cutoff: '2021-01-01T00:00:00Z',
      pages_fetched: 1,
      post_count: 0,
      earliest_published: null,
      latest_published: null,
      earliest_modified_seen: null,
      latest_modified_seen: '2025-12-30T00:00:00',
      duration_ms: 100,
      errors: [{ page: 2, kind: 'fetch_failed', detail: 'boom' }],
    };
    writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
    expect(readPriorFloor(rawRoot)).toBeNull();
  });

  it('returns latest_modified_seen for a clean manifest', () => {
    const rawRoot = path.join(makeTempDataRoot(), 'raw');
    const folder = path.join(rawRoot, '20260101T000000Z');
    mkdirSync(folder, { recursive: true });
    const manifest = {
      ingested_at: '2026-01-01T00:00:00Z',
      mode: 'incremental',
      endpoint: BLOG_ENDPOINT,
      params_used: {
        per_page: 100,
        orderby: 'modified',
        order: 'asc',
        _embed: true,
        after: '2021-01-01T00:00:00Z',
        modified_after: null,
      },
      relevance_cutoff: '2021-01-01T00:00:00Z',
      pages_fetched: 1,
      post_count: 1,
      earliest_published: '2025-12-30T00:00:00',
      latest_published: '2025-12-30T00:00:00',
      earliest_modified_seen: '2025-12-30T00:00:00',
      latest_modified_seen: '2025-12-30T00:00:00',
      duration_ms: 100,
      errors: [],
    };
    writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
    expect(readPriorFloor(rawRoot)).toBe('2025-12-30T00:00:00');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: run() with mocked fetcher
// ---------------------------------------------------------------------------

describe('run() — backfill mode', () => {
  it('walks all pages, writes manifest + ndjson, applies 5y cutoff to URL', async () => {
    const dataRoot = makeTempDataRoot();
    const now = new Date('2026-04-28T12:00:00Z');
    const expectedCutoff = '2021-04-28T12:00:00Z';

    const page1 = Array.from({ length: 100 }, (_, i) =>
      makePost({ id: i + 1, date: '2022-06-01T10:00:00', modified: '2024-06-01T10:00:00' }),
    );
    const page2 = Array.from({ length: 8 }, (_, i) =>
      makePost({ id: 101 + i, date: '2025-12-01T10:00:00', modified: '2025-12-15T10:00:00' }),
    );

    const { fetcher, calls } = recordingFetcher((_url, idx) => {
      if (idx === 0) return jsonResponse(page1, { 'x-wp-totalpages': '2', 'x-wp-total': '108' });
      if (idx === 1) return jsonResponse(page2, { 'x-wp-totalpages': '2', 'x-wp-total': '108' });
      return jsonResponse([]);
    });

    const result = await run({
      args: { mode: 'backfill', since: null, dryRun: false },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });

    // 5-year cutoff applied to *every* request URL.
    for (const url of calls) {
      expect(new URL(url).searchParams.get('after')).toBe(expectedCutoff);
      // Backfill: no modified_after.
      expect(new URL(url).searchParams.has('modified_after')).toBe(false);
    }
    expect(calls.length).toBe(2);

    // Manifest.
    expect(result.manifest.mode).toBe('backfill');
    expect(result.manifest.relevance_cutoff).toBe(expectedCutoff);
    expect(result.manifest.params_used.modified_after).toBeNull();
    expect(result.manifest.pages_fetched).toBe(2);
    expect(result.manifest.post_count).toBe(108);
    expect(result.manifest.errors).toEqual([]);

    // Files written.
    const folder = result.runFolder!;
    const ndjson = readFileSync(path.join(folder, 'posts.ndjson'), 'utf8');
    const lines = ndjson.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(108);
    for (const l of lines) {
      // Each line parses as JSON.
      expect(() => JSON.parse(l)).not.toThrow();
    }
    const manifestOnDisk = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    expect(() => ManifestSchema.parse(manifestOnDisk)).not.toThrow();
    expect(statSync(path.join(folder, 'log.txt')).size).toBeGreaterThan(0);
  });
});

describe('run() — incremental mode', () => {
  it('reads latest_modified_seen from prior manifest and applies modified_after', async () => {
    const dataRoot = makeTempDataRoot();
    const rawRoot = path.join(dataRoot, 'raw');
    const priorFolder = path.join(rawRoot, '20260101T000000Z');
    mkdirSync(priorFolder, { recursive: true });

    const priorFloor = '2026-01-01T00:00:00';
    const priorManifest = {
      ingested_at: '2026-01-01T00:00:00Z',
      mode: 'incremental',
      endpoint: BLOG_ENDPOINT,
      params_used: {
        per_page: 100,
        orderby: 'modified',
        order: 'asc',
        _embed: true,
        after: '2021-01-01T00:00:00Z',
        modified_after: null,
      },
      relevance_cutoff: '2021-01-01T00:00:00Z',
      pages_fetched: 2,
      post_count: 108,
      earliest_published: '2021-12-01T00:00:00',
      latest_published: '2025-12-31T00:00:00',
      earliest_modified_seen: '2021-12-01T00:00:00',
      latest_modified_seen: priorFloor,
      duration_ms: 5000,
      errors: [],
    };
    writeFileSync(path.join(priorFolder, 'manifest.json'), JSON.stringify(priorManifest));

    const now = new Date('2026-04-28T12:00:00Z');
    const expectedCutoff = '2021-04-28T12:00:00Z';
    const newPosts = [
      makePost({ id: 999, date: '2024-06-01T10:00:00', modified: '2026-04-15T10:00:00' }),
    ];

    const { fetcher, calls } = recordingFetcher((_url, idx) => {
      if (idx === 0) return jsonResponse(newPosts, { 'x-wp-totalpages': '1', 'x-wp-total': '1' });
      return jsonResponse([]);
    });

    const result = await run({
      args: { mode: 'incremental', since: null, dryRun: false },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });

    // Cutoff applied AND modified_after applied from prior floor.
    expect(calls.length).toBe(1);
    const u = new URL(calls[0]);
    expect(u.searchParams.get('after')).toBe(expectedCutoff);
    expect(u.searchParams.get('modified_after')).toBe(priorFloor);

    expect(result.manifest.mode).toBe('incremental');
    expect(result.manifest.params_used.modified_after).toBe(priorFloor);
    expect(result.manifest.post_count).toBe(1);
  });

  it('falls back to backfill behaviour with warning when no prior manifest', async () => {
    const dataRoot = makeTempDataRoot();
    const now = new Date('2026-04-28T12:00:00Z');
    const { fetcher } = recordingFetcher(() =>
      jsonResponse([makePost({})], { 'x-wp-totalpages': '1' }),
    );
    const result = await run({
      args: { mode: 'incremental', since: null, dryRun: false },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });
    expect(result.manifest.params_used.modified_after).toBeNull();
  });
});

describe('run() — retry & error handling', () => {
  it('records a page in errors[] when all three attempts fail; run continues to next page', async () => {
    const dataRoot = makeTempDataRoot();
    const now = new Date('2026-04-28T12:00:00Z');
    let pagesSeen = 0;
    const { fetcher } = recordingFetcher((url) => {
      const page = new URL(url).searchParams.get('page');
      if (page === '1') {
        // First page: succeeds with totalpages=2 but tells us 2 pages.
        pagesSeen++;
        return jsonResponse(
          [makePost({ id: 1, date: '2025-01-01T00:00:00', modified: '2025-01-01T00:00:00' })],
          { 'x-wp-totalpages': '2', 'x-wp-total': '2' },
        );
      }
      // Page 2: always 503 — three retries exhaust.
      return { status: 503, headers: {}, body: null };
    });
    const result = await run({
      args: { mode: 'backfill', since: null, dryRun: false },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });
    expect(pagesSeen).toBe(1);
    expect(result.manifest.errors.length).toBe(1);
    expect(result.manifest.errors[0]).toMatchObject({ page: 2, kind: 'fetch_failed' });
    expect(result.manifest.pages_fetched).toBe(1); // page 2 didn't succeed
    expect(result.manifest.post_count).toBe(1);
  });

  it('third attempt success → no error recorded', async () => {
    const dataRoot = makeTempDataRoot();
    const now = new Date('2026-04-28T12:00:00Z');
    let attempt = 0;
    const { fetcher } = recordingFetcher(() => {
      attempt++;
      if (attempt < 3) return { status: 503, headers: {}, body: null };
      return jsonResponse([makePost({})], { 'x-wp-totalpages': '1' });
    });
    const result = await run({
      args: { mode: 'backfill', since: null, dryRun: false },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });
    expect(result.manifest.errors).toEqual([]);
    expect(result.manifest.post_count).toBe(1);
  });
});

describe('run() — schema drift', () => {
  it('records malformed posts in errors[] and skips them', async () => {
    const dataRoot = makeTempDataRoot();
    const now = new Date('2026-04-28T12:00:00Z');
    const goodPost = makePost({ id: 1 });
    const malformed = { id: 2, title: 'no modified field' };
    const { fetcher } = recordingFetcher(() =>
      jsonResponse([goodPost, malformed], { 'x-wp-totalpages': '1', 'x-wp-total': '2' }),
    );
    const result = await run({
      args: { mode: 'backfill', since: null, dryRun: false },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });
    expect(result.manifest.post_count).toBe(1); // only the good one
    expect(result.manifest.errors.length).toBe(1);
    expect(result.manifest.errors[0]).toMatchObject({ kind: 'malformed_post' });
    // NDJSON has only the good post.
    const lines = readFileSync(path.join(result.runFolder!, 'posts.ndjson'), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).id).toBe(1);
  });
});

describe('run() — dry-run mode', () => {
  it('does not write any files; only fetches page 1', async () => {
    const dataRoot = makeTempDataRoot();
    const now = new Date('2026-04-28T12:00:00Z');
    const { fetcher, calls } = recordingFetcher(() =>
      jsonResponse([makePost({})], { 'x-wp-totalpages': '5' }),
    );
    const result = await run({
      args: { mode: 'incremental', since: null, dryRun: true },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });
    expect(result.runFolder).toBeNull();
    // No raw/ folder created.
    expect(() => readdirSync(path.join(dataRoot, 'raw'))).toThrow();
    // Only one fetch despite totalpages=5.
    expect(calls.length).toBe(1);
  });
});

describe('run() — 5-year cutoff is non-negotiable', () => {
  it('every URL fetched has after=cutoff regardless of mode', async () => {
    const dataRoot = makeTempDataRoot();
    const now = new Date('2026-04-28T12:00:00Z');
    const expectedCutoff = '2021-04-28T12:00:00Z';

    const { fetcher, calls } = recordingFetcher((_url, idx) => {
      const totalPages = '2';
      const posts =
        idx === 0
          ? [makePost({ id: 1, date: '2024-06-01T10:00:00', modified: '2024-06-01T10:00:00' })]
          : [makePost({ id: 2, date: '2025-06-01T10:00:00', modified: '2025-06-01T10:00:00' })];
      return jsonResponse(posts, { 'x-wp-totalpages': totalPages, 'x-wp-total': '2' });
    });

    await run({
      args: { mode: 'explicit-since', since: '2024-01-01', dryRun: false },
      dataRoot,
      fetcher,
      sleep: async () => undefined,
      now,
    });

    expect(calls.length).toBe(2);
    for (const url of calls) {
      const u = new URL(url);
      expect(u.searchParams.get('after')).toBe(expectedCutoff);
      // explicit-since overrides modified_after.
      expect(u.searchParams.get('modified_after')).toBe('2024-01-01');
    }
  });
});
