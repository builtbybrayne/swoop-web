/**
 * Upsert helper unit test — exercises the SQL string we generate from a spec
 * without hitting Postgres. Uses a fake PoolClient that captures the
 * (sql, params) pair.
 *
 * The integration coverage (real INSERT … ON CONFLICT against puma_dev) lives
 * in the end-to-end smoke verification, not unit tests — per the chunk-C
 * convention captured in `product/connector/src/data/README.md`. But the SQL
 * shape (column quoting, EXCLUDED. references, no-update column exclusion)
 * is testable cheaply here and worth pinning.
 */

import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { upsertBatch } from '../upsert.js';

function fakeClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as pg.PoolClient;
  return { client, calls };
}

describe('upsertBatch', () => {
  it('builds INSERT … ON CONFLICT … DO UPDATE with quoted columns', async () => {
    const { client, calls } = fakeClient();
    await upsertBatch(client, {
      table: 'page',
      conflictKeys: ['id'],
      columns: ['id', 'title', 'canonical_url'],
      rows: [
        { id: 1, title: 'A', canonical_url: 'https://x/a' },
        { id: 2, title: 'B', canonical_url: 'https://x/b' },
      ],
    });
    expect(calls).toHaveLength(1);
    const sql = calls[0]!.sql;
    expect(sql).toContain('INSERT INTO "page" ("id", "title", "canonical_url")');
    expect(sql).toContain('VALUES ($1, $2, $3), ($4, $5, $6)');
    expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET');
    expect(sql).toContain('"title" = EXCLUDED."title"');
    expect(sql).toContain('"canonical_url" = EXCLUDED."canonical_url"');
    // ID is the conflict key — must NOT appear in the SET clause.
    expect(sql).not.toContain('"id" = EXCLUDED."id"');
    expect(calls[0]!.params).toEqual([1, 'A', 'https://x/a', 2, 'B', 'https://x/b']);
  });

  it('respects noUpdateColumns to protect downstream-owned columns', async () => {
    const { client, calls } = fakeClient();
    await upsertBatch(client, {
      table: 'image',
      conflictKeys: ['id'],
      columns: ['id', 'canonical_url', 'description'],
      // pretend `description` is owned by another pass — exclude from UPDATE.
      noUpdateColumns: ['description'],
      rows: [{ id: 1, canonical_url: 'https://x', description: 'd' }],
    });
    const sql = calls[0]!.sql;
    expect(sql).toContain('"canonical_url" = EXCLUDED."canonical_url"');
    expect(sql).not.toContain('"description" = EXCLUDED."description"');
  });

  it('emits ON CONFLICT DO NOTHING when no updatable columns', async () => {
    const { client, calls } = fakeClient();
    await upsertBatch(client, {
      table: 'simple',
      conflictKeys: ['id'],
      columns: ['id'],
      rows: [{ id: 1 }, { id: 2 }],
    });
    expect(calls[0]!.sql).toContain('ON CONFLICT ("id") DO NOTHING');
  });

  it('returns 0 written for empty rows and skips the query', async () => {
    const { client, calls } = fakeClient();
    const r = await upsertBatch(client, {
      table: 't',
      conflictKeys: ['id'],
      columns: ['id'],
      rows: [],
    });
    expect(r.written).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('passes through unspecified columns as null params', async () => {
    const { client, calls } = fakeClient();
    await upsertBatch(client, {
      table: 't',
      conflictKeys: ['id'],
      columns: ['id', 'optional'],
      // optional missing from the row object — should land as null.
      rows: [{ id: 1 }],
    });
    expect(calls[0]!.params).toEqual([1, null]);
  });
});
