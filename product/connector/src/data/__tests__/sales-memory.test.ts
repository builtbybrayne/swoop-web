/**
 * Unit tests for sales-memory data primitives.
 *
 * Per product/CLAUDE.md testing approach: unit tests only where failure modes
 * are narrow and fixtures are cheap. Mocks `pg.PoolClient` so the suite runs
 * without a live `puma_dev` Postgres.
 *
 * What is pinned here:
 *   - createMemory: two-insert (sales_memory + sales_memory_version) in one
 *     transaction, returns public shape.
 *   - editMemory: optimistic-concurrency UPDATE + version row; rejects on
 *     version mismatch (SalesMemoryVersionConflictError); rejects on not-found
 *     (SalesMemoryNotFoundError).
 *   - retireMemory: UPDATE to retired + version row; rejects on not-found.
 *   - listActiveMemories: SELECT projection to SalesMemoryPublic array.
 *   - getMemoryHistory: version row projection; throws on empty result.
 *
 * DB-gated integration tests (the describeIfItest block at the bottom) exercise
 * the real SQL against a throwaway Postgres with migration 021 applied — the
 * store<->schema contract the mocks above cannot verify. They run ONLY when
 * DATABASE_URL names a disposable DB (name contains "itest"); any other value
 * (including puma_dev) skips cleanly. Runbook is in the block's header comment.
 *
 * SM.t1 (sales-memory store + CRUD, connector side).
 */

import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

import {
  createMemory,
  editMemory,
  retireMemory,
  listActiveMemories,
  getMemoryHistory,
  SalesMemoryVersionConflictError,
  SalesMemoryNotFoundError,
} from '../sales-memory.js';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

interface MockCall {
  sql: string;
  params?: unknown[];
}

/**
 * Build a PoolClient mock whose `query` implementation is provided by the
 * caller. Captures all calls in `calls` for assertion.
 */
function makeMockClient(
  queryImpl: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>,
): { client: pg.PoolClient; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql: sql.trim(), params });
      return queryImpl(sql.trim(), params);
    }),
  } as unknown as pg.PoolClient;
  return { client, calls };
}

/** A minimal Date that pg would return for TIMESTAMPTZ columns. */
const NOW = new Date('2026-06-16T12:00:00.000Z');

/** A sample UUID for re-use across tests. */
const MEMORY_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const VERSION_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

// ---------------------------------------------------------------------------
// createMemory
// ---------------------------------------------------------------------------

describe('createMemory', () => {
  it('starts a transaction, inserts into sales_memory, inserts version row, commits', async () => {
    const { client, calls } = makeMockClient(async (sql) => {
      if (sql.includes('INSERT INTO sales_memory')) {
        return {
          rows: [{
            id: MEMORY_ID,
            content: 'Patagonia is best Dec–Feb',
            status: 'active',
            version: 1,
            created_by: 'Alice',
            created_at: NOW,
            updated_by: 'Alice',
            updated_at: NOW,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await createMemory(client, {
      content: 'Patagonia is best Dec–Feb',
      author: 'Alice',
    });

    // Transaction shape: BEGIN, INSERT sales_memory, INSERT version, COMMIT
    expect(calls[0]?.sql).toMatch(/^BEGIN/i);
    expect(calls[1]?.sql).toMatch(/INSERT INTO sales_memory/i);
    expect(calls[2]?.sql).toMatch(/INSERT INTO sales_memory_version/i);
    expect(calls[3]?.sql).toMatch(/^COMMIT/i);

    // Version row binds: $1=memory_id, $2=content, $3=author
    // ('create' and version=1 are hardcoded in the SQL string itself)
    const versionBinds = calls[2]?.params as unknown[];
    expect(versionBinds[0]).toBe(MEMORY_ID);
    expect(versionBinds[1]).toBe('Patagonia is best Dec–Feb');
    expect(versionBinds[2]).toBe('Alice');
    // change_kind='create' is in the SQL, not the binds array
    expect(calls[2]?.sql).toMatch(/'create'/i);

    // Public shape
    expect(result.id).toBe(MEMORY_ID);
    expect(result.content).toBe('Patagonia is best Dec–Feb');
    expect(result.updatedBy).toBe('Alice');
    expect(result.updatedAt).toBe(NOW.toISOString());
  });

  it('rolls back and rethrows on INSERT error', async () => {
    const { client, calls } = makeMockClient(async (sql) => {
      if (sql.includes('INSERT INTO sales_memory')) {
        throw new Error('DB error');
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      createMemory(client, { content: 'x', author: 'Alice' }),
    ).rejects.toThrow('DB error');

    expect(calls.some((c) => /^ROLLBACK/i.test(c.sql))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// editMemory
// ---------------------------------------------------------------------------

describe('editMemory', () => {
  it('begins, updates sales_memory with version bump, inserts version row, commits', async () => {
    const { client, calls } = makeMockClient(async (sql) => {
      if (sql.includes('UPDATE sales_memory')) {
        return {
          rows: [{
            id: MEMORY_ID,
            content: 'Updated content',
            status: 'active',
            version: 2,
            created_by: 'Alice',
            created_at: NOW,
            updated_by: 'Bob',
            updated_at: NOW,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await editMemory(client, {
      id: MEMORY_ID,
      content: 'Updated content',
      expectedVersion: 1,
      author: 'Bob',
    });

    expect(calls[0]?.sql).toMatch(/^BEGIN/i);

    // UPDATE must reference expectedVersion in WHERE clause
    const updateSql = calls[1]?.sql ?? '';
    expect(updateSql).toMatch(/UPDATE sales_memory/i);
    const updateBinds = calls[1]?.params as unknown[];
    // $1=content, $2=newVersion=2, $3=author, $4=id, $5=expectedVersion=1
    expect(updateBinds[0]).toBe('Updated content');
    expect(updateBinds[1]).toBe(2); // newVersion = expectedVersion + 1
    expect(updateBinds[2]).toBe('Bob');
    expect(updateBinds[3]).toBe(MEMORY_ID);
    expect(updateBinds[4]).toBe(1); // expectedVersion

    // Version row: change_kind='edit' is in the SQL; binds are [memory_id, newVersion, content, author]
    const versionSql = calls[2]?.sql ?? '';
    expect(versionSql).toMatch(/INSERT INTO sales_memory_version/i);
    expect(versionSql).toMatch(/'edit'/i);
    const versionBinds = calls[2]?.params as unknown[];
    expect(versionBinds[0]).toBe(MEMORY_ID); // $1 memory_id
    expect(versionBinds[1]).toBe(2);          // $2 newVersion
    expect(versionBinds[2]).toBe('Updated content'); // $3 content
    expect(versionBinds[3]).toBe('Bob');       // $4 author

    expect(calls[3]?.sql).toMatch(/^COMMIT/i);

    expect(result.content).toBe('Updated content');
    expect(result.updatedBy).toBe('Bob');
  });

  it('throws SalesMemoryVersionConflictError when UPDATE rowCount=0 and row exists', async () => {
    // UPDATE returns 0 rows (version mismatch); peek SELECT returns actual version 3.
    let callIndex = 0;
    const { client } = makeMockClient(async (sql) => {
      if (/^BEGIN/i.test(sql) || /^ROLLBACK/i.test(sql) || /^COMMIT/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE sales_memory')) {
        callIndex++;
        return { rows: [], rowCount: 0 }; // mismatch
      }
      if (sql.includes('SELECT version')) {
        return { rows: [{ version: 3 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    void callIndex; // suppress unused warning
    await expect(
      editMemory(client, {
        id: MEMORY_ID,
        content: 'x',
        expectedVersion: 1,
        author: 'Bob',
      }),
    ).rejects.toThrow(SalesMemoryVersionConflictError);
  });

  it('throws SalesMemoryNotFoundError when UPDATE rowCount=0 and peek finds nothing', async () => {
    const { client } = makeMockClient(async (sql) => {
      if (/^BEGIN/i.test(sql) || /^ROLLBACK/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      // Both UPDATE and peek SELECT return empty
      return { rows: [], rowCount: 0 };
    });

    await expect(
      editMemory(client, {
        id: MEMORY_ID,
        content: 'x',
        expectedVersion: 1,
        author: 'Bob',
      }),
    ).rejects.toThrow(SalesMemoryNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// retireMemory
// ---------------------------------------------------------------------------

describe('retireMemory', () => {
  it('begins, updates status to retired, inserts retire version row, commits', async () => {
    const { client, calls } = makeMockClient(async (sql) => {
      if (sql.includes('UPDATE sales_memory')) {
        return {
          rows: [{
            id: MEMORY_ID,
            version: 2,
            content: 'Some memory',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await retireMemory(client, {
      id: MEMORY_ID,
      author: 'Carol',
    });

    expect(calls[0]?.sql).toMatch(/^BEGIN/i);
    expect(calls[1]?.sql).toMatch(/UPDATE sales_memory/i);
    expect(calls[1]?.sql).toMatch(/status.*=.*'retired'/i);

    // Version row: change_kind='retire' is hardcoded in the SQL string.
    // Binds are [$1=memory_id, $2=version, $3=content, $4=author].
    expect(calls[2]?.sql).toMatch(/'retire'/i);
    const versionBinds = calls[2]?.params as unknown[];
    expect(versionBinds[0]).toBe(MEMORY_ID); // $1 memory_id
    expect(versionBinds[3]).toBe('Carol');    // $4 author
    expect(calls[3]?.sql).toMatch(/^COMMIT/i);

    expect(result.id).toBe(MEMORY_ID);
    expect(result.status).toBe('retired');
  });

  it('throws SalesMemoryNotFoundError when UPDATE finds no row', async () => {
    const { client } = makeMockClient(async (sql) => {
      if (/^BEGIN/i.test(sql) || /^ROLLBACK/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      retireMemory(client, { id: MEMORY_ID, author: 'Carol' }),
    ).rejects.toThrow(SalesMemoryNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// listActiveMemories
// ---------------------------------------------------------------------------

describe('listActiveMemories', () => {
  it('returns an empty array when no active memories exist', async () => {
    const { client } = makeMockClient(async () => ({ rows: [], rowCount: 0 }));
    const result = await listActiveMemories(client);
    expect(result).toEqual([]);
  });

  it('maps rows to SalesMemoryPublic shape', async () => {
    const { client, calls } = makeMockClient(async () => ({
      rows: [
        {
          id: MEMORY_ID,
          content: 'Dec–Feb is peak season',
          updated_by: 'Alice',
          updated_at: NOW,
        },
      ],
      rowCount: 1,
    }));

    const result = await listActiveMemories(client);

    // One SELECT, no transaction wrapper needed for reads
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/SELECT/i);
    expect(calls[0]?.sql).toMatch(/WHERE status = 'active'/i);
    // Stable order
    expect(calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i);

    expect(result).toHaveLength(1);
    const mem = result[0]!;
    expect(mem.id).toBe(MEMORY_ID);
    expect(mem.content).toBe('Dec–Feb is peak season');
    expect(mem.updatedBy).toBe('Alice');
    expect(mem.updatedAt).toBe(NOW.toISOString());
  });

  it('returns multiple rows in the order the DB gives them (DESC by created_at)', async () => {
    const ID2 = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
    const { client } = makeMockClient(async () => ({
      rows: [
        { id: MEMORY_ID, content: 'Newer', updated_by: 'X', updated_at: NOW },
        { id: ID2, content: 'Older', updated_by: 'Y', updated_at: NOW },
      ],
      rowCount: 2,
    }));

    const result = await listActiveMemories(client);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(MEMORY_ID);
    expect(result[1]?.id).toBe(ID2);
  });
});

// ---------------------------------------------------------------------------
// getMemoryHistory
// ---------------------------------------------------------------------------

describe('getMemoryHistory', () => {
  it('throws SalesMemoryNotFoundError when version table has no rows for id', async () => {
    const { client } = makeMockClient(async () => ({ rows: [], rowCount: 0 }));
    await expect(getMemoryHistory(client, MEMORY_ID)).rejects.toThrow(
      SalesMemoryNotFoundError,
    );
  });

  it('maps version rows to SalesMemoryVersionPublic shape ordered by version ASC', async () => {
    const { client, calls } = makeMockClient(async () => ({
      rows: [
        {
          id: VERSION_ID,
          memory_id: MEMORY_ID,
          version: 1,
          content: 'Original content',
          change_kind: 'create',
          author: 'Alice',
          created_at: NOW,
        },
        {
          id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
          memory_id: MEMORY_ID,
          version: 2,
          content: 'Edited content',
          change_kind: 'edit',
          author: 'Bob',
          created_at: NOW,
        },
      ],
      rowCount: 2,
    }));

    const result = await getMemoryHistory(client, MEMORY_ID);

    expect(calls[0]?.sql).toMatch(/ORDER BY version ASC/i);
    expect(calls[0]?.params).toEqual([MEMORY_ID]);

    expect(result).toHaveLength(2);
    const v1 = result[0]!;
    expect(v1.memoryId).toBe(MEMORY_ID);
    expect(v1.version).toBe(1);
    expect(v1.changeKind).toBe('create');
    expect(v1.author).toBe('Alice');
    expect(v1.createdAt).toBe(NOW.toISOString());

    const v2 = result[1]!;
    expect(v2.changeKind).toBe('edit');
    expect(v2.content).toBe('Edited content');
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration tests — exercise the REAL SQL against Postgres.
//
// These are the store<->schema contract tests the mocks above cannot provide:
// real column names, the CHECK + UNIQUE constraints, TIMESTAMPTZ/UUID
// round-trips, and DB-level optimistic concurrency.
//
// They are DESTRUCTIVE (TRUNCATE the sales_memory tables in beforeEach), so
// they run ONLY when DATABASE_URL names an obviously-throwaway DB (name
// contains "itest"). Any other DATABASE_URL — including puma_dev — skips
// cleanly, so a normal `npm test` (no DATABASE_URL) and a dev shell that
// happens to export puma_dev both skip rather than clobber anything.
//
// Runbook (throwaway DB):
//   createdb puma_sm_itest
//   # connector/.env has dotenv override:true pointing at puma_dev, so run the
//   # migrator from a dir with NO .env to let an inline DATABASE_URL win:
//   (cd /tmp && DATABASE_URL=postgresql://USER@localhost:5432/puma_sm_itest \
//      <repo>/product/node_modules/.bin/tsx \
//      <repo>/product/connector/src/migrate.ts up)
//   DATABASE_URL=postgresql://USER@localhost:5432/puma_sm_itest \
//      npx vitest run src/data/__tests__/sales-memory.test.ts
//   dropdb puma_sm_itest
// ---------------------------------------------------------------------------

function integrationDbName(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

const integrationUrl = process.env['DATABASE_URL'] ?? null;
const integrationDb = integrationDbName(integrationUrl);
// Defence-in-depth: only an "itest"-named DB is ever treated as disposable.
const runIntegration = integrationUrl !== null && /itest/i.test(integrationDb);
const describeIfItest = runIntegration ? describe : describe.skip;

describeIfItest(
  'sales-memory — integration (real Postgres; requires an *itest* DATABASE_URL)',
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: integrationUrl! });
    });

    afterAll(async () => {
      await pool?.end();
    });

    beforeEach(async () => {
      // Safe: this block only runs for an itest-named DB (see runIntegration).
      await pool.query('TRUNCATE sales_memory, sales_memory_version CASCADE');
    });

    async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    }

    it('createMemory inserts an active row + a create version row, returns the public shape', async () => {
      const created = await withClient((c) =>
        createMemory(c, { content: 'Patagonia peaks Dec–Feb', author: 'Alice' }),
      );
      expect(created).toMatchObject({ content: 'Patagonia peaks Dec–Feb', updatedBy: 'Alice' });
      expect(typeof created.id).toBe('string');
      expect(typeof created.updatedAt).toBe('string');

      const live = await pool.query(
        'SELECT status, version, created_by, updated_by FROM sales_memory WHERE id = $1',
        [created.id],
      );
      expect(live.rows[0]).toMatchObject({
        status: 'active',
        version: 1,
        created_by: 'Alice',
        updated_by: 'Alice',
      });

      const versions = await pool.query(
        'SELECT version, change_kind, author, content FROM sales_memory_version WHERE memory_id = $1',
        [created.id],
      );
      expect(versions.rows).toEqual([
        { version: 1, change_kind: 'create', author: 'Alice', content: 'Patagonia peaks Dec–Feb' },
      ]);
    });

    it('listActiveMemories orders newest-first by created_at', async () => {
      const older = await withClient((c) => createMemory(c, { content: 'older', author: 'A' }));
      await withClient((c) => createMemory(c, { content: 'newer', author: 'A' }));
      // Force a deterministic gap so the assertion never depends on sub-ms ties.
      await pool.query("UPDATE sales_memory SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [
        older.id,
      ]);

      const active = await withClient((c) => listActiveMemories(c));
      expect(active.map((m) => m.content)).toEqual(['newer', 'older']);
    });

    it('listActiveMemories excludes retired rows', async () => {
      const keep = await withClient((c) => createMemory(c, { content: 'keep', author: 'A' }));
      const drop = await withClient((c) => createMemory(c, { content: 'drop', author: 'A' }));
      await withClient((c) => retireMemory(c, { id: drop.id, author: 'A' }));

      const active = await withClient((c) => listActiveMemories(c));
      expect(active.map((m) => m.id)).toEqual([keep.id]);
    });

    it('editMemory bumps the version, updates content, appends an edit version row', async () => {
      const created = await withClient((c) => createMemory(c, { content: 'v1', author: 'A' }));
      const edited = await withClient((c) =>
        editMemory(c, { id: created.id, content: 'v2', expectedVersion: 1, author: 'B' }),
      );
      expect(edited).toMatchObject({ content: 'v2', updatedBy: 'B' });

      const live = await pool.query('SELECT status, version, updated_by FROM sales_memory WHERE id = $1', [
        created.id,
      ]);
      expect(live.rows[0]).toMatchObject({ status: 'active', version: 2, updated_by: 'B' });

      const history = await withClient((c) => getMemoryHistory(c, created.id));
      expect(history.map((h) => [h.version, h.changeKind])).toEqual([
        [1, 'create'],
        [2, 'edit'],
      ]);
    });

    it('editMemory rejects a stale expectedVersion (conflict) and commits nothing', async () => {
      const created = await withClient((c) => createMemory(c, { content: 'v1', author: 'A' }));
      await withClient((c) =>
        editMemory(c, { id: created.id, content: 'v2', expectedVersion: 1, author: 'A' }),
      );
      // version is now 2; editing again with expectedVersion 1 must conflict.
      await expect(
        withClient((c) =>
          editMemory(c, { id: created.id, content: 'v3', expectedVersion: 1, author: 'A' }),
        ),
      ).rejects.toBeInstanceOf(SalesMemoryVersionConflictError);

      // The failed edit left no trace: content/version unchanged, no v3 history row.
      const live = await pool.query('SELECT version, content FROM sales_memory WHERE id = $1', [created.id]);
      expect(live.rows[0]).toMatchObject({ version: 2, content: 'v2' });
      const history = await withClient((c) => getMemoryHistory(c, created.id));
      expect(history.map((h) => h.version)).toEqual([1, 2]);
    });

    it('editMemory throws SalesMemoryNotFoundError for an unknown id', async () => {
      await expect(
        withClient((c) =>
          editMemory(c, { id: MEMORY_ID, content: 'x', expectedVersion: 1, author: 'A' }),
        ),
      ).rejects.toBeInstanceOf(SalesMemoryNotFoundError);
    });

    it('retireMemory soft-deletes (status=retired, version bump, retire row) and drops from listActive', async () => {
      const created = await withClient((c) => createMemory(c, { content: 'temp', author: 'A' }));
      const result = await withClient((c) => retireMemory(c, { id: created.id, author: 'B' }));
      expect(result).toEqual({ id: created.id, status: 'retired' });

      const live = await pool.query('SELECT status, version FROM sales_memory WHERE id = $1', [created.id]);
      expect(live.rows[0]).toMatchObject({ status: 'retired', version: 2 });

      expect(await withClient((c) => listActiveMemories(c))).toEqual([]);

      const history = await withClient((c) => getMemoryHistory(c, created.id));
      expect(history.map((h) => h.changeKind)).toEqual(['create', 'retire']);
    });

    it('retireMemory throws SalesMemoryNotFoundError for an unknown id', async () => {
      await expect(
        withClient((c) => retireMemory(c, { id: MEMORY_ID, author: 'A' })),
      ).rejects.toBeInstanceOf(SalesMemoryNotFoundError);
    });

    it('getMemoryHistory throws SalesMemoryNotFoundError when no version rows exist', async () => {
      await expect(withClient((c) => getMemoryHistory(c, MEMORY_ID))).rejects.toBeInstanceOf(
        SalesMemoryNotFoundError,
      );
    });

    it('enforces UNIQUE(memory_id, version) — the invariant the concurrency design relies on', async () => {
      const created = await withClient((c) => createMemory(c, { content: 'v1', author: 'A' }));
      // A second row at (memory_id, version=1) must violate the unique constraint.
      await expect(
        pool.query(
          `INSERT INTO sales_memory_version (memory_id, version, content, change_kind, author)
           VALUES ($1, 1, 'dup', 'edit', 'A')`,
          [created.id],
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  },
);
