/**
 * Tests for the Postgres pool helpers.
 *
 * Two tiers:
 *
 * (1) Pure-config tests for `buildPoolConfig` — always run; no DB needed.
 *     These guard the mapping from validated Config → pg.PoolConfig.
 *
 * (2) Integration tests against a real Postgres — only run when
 *     `DATABASE_URL` is set (mirrors the gotchas.md guidance for the local
 *     puma_dev DB). They're skipped silently in CI / on machines without
 *     Postgres.app, so the suite stays green everywhere; they're the
 *     local-dev affordance an operator runs to verify the pool boots and
 *     `SELECT 1` round-trips through `withPgClient`.
 *
 * No mocks of `pg`. Mocking the pool tends to invent bugs that don't exist
 * (the real failure modes are connection-leak shapes that mocks paper over).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPoolConfig, closePool, getPool, withPgClient, _resetPoolForTesting } from '../pool.js';
import type { Config } from '../../config/index.js';

const VALID_URL = 'postgresql://al:pick-a-password@localhost:5432/puma_dev';

function makeConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = Object.freeze({
    DATABASE_URL: VALID_URL,
    CONNECTOR_PORT: 3002,
    PG_POOL_MAX: 10,
    PG_POOL_IDLE_MS: 30_000,
    PG_STATEMENT_TIMEOUT_MS: 10_000,
    TOOLS_PROMPT_DIR: '../cms/prompts/tools',
    PRICES_CAPTURED_AT: '2026-04-27',
    NODE_ENV: 'development' as const,
    packageRoot: '/tmp/fake-package-root',
    migrationsDirAbsolutePath: '/tmp/fake-package-root/migrations',
    toolsPromptDirAbsolutePath: '/tmp/fake-package-root/cms/prompts/tools',
    isProduction: false,
  });
  return Object.freeze({ ...base, ...overrides });
}

describe('buildPoolConfig', () => {
  it('maps DATABASE_URL → connectionString', () => {
    const cfg = makeConfig();
    const out = buildPoolConfig(cfg);
    expect(out.connectionString).toBe(VALID_URL);
  });

  it('passes through PG_POOL_MAX and PG_POOL_IDLE_MS', () => {
    const cfg = makeConfig({ PG_POOL_MAX: 25, PG_POOL_IDLE_MS: 60_000 });
    const out = buildPoolConfig(cfg);
    expect(out.max).toBe(25);
    expect(out.idleTimeoutMillis).toBe(60_000);
  });

  it('sets application_name to swoop-connector', () => {
    const cfg = makeConfig();
    const out = buildPoolConfig(cfg);
    expect(out.application_name).toBe('swoop-connector');
  });

  it('passes statement_timeout via libpq startup options', () => {
    // The on('connect') handler that USED to do this raced with pg's
    // internal driver init queries. The libpq -c options approach applies
    // the timeout before the first user query runs, no race.
    const cfg = makeConfig({ PG_STATEMENT_TIMEOUT_MS: 7_500 });
    const out = buildPoolConfig(cfg);
    expect(out.options).toContain('statement_timeout=7500');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — gated on DATABASE_URL. These are the "operator runs
// these locally to verify the pool actually boots" tests.
// ---------------------------------------------------------------------------

const integrationUrl = process.env.DATABASE_URL ?? null;
const describeIfDb = integrationUrl ? describe : describe.skip;

describeIfDb('pool — integration (requires DATABASE_URL)', () => {
  beforeEach(() => {
    _resetPoolForTesting();
  });

  afterEach(async () => {
    await closePool();
  });

  it('getPool returns the same instance on repeat calls', () => {
    const cfg = makeConfig({ DATABASE_URL: integrationUrl ?? VALID_URL });
    const a = getPool(cfg);
    const b = getPool(cfg);
    expect(a).toBe(b);
  });

  it('withPgClient runs SELECT 1 and releases', async () => {
    const cfg = makeConfig({ DATABASE_URL: integrationUrl ?? VALID_URL });
    const result = await withPgClient(cfg, async (client) => {
      const r = await client.query('SELECT 1::int AS one');
      return r.rows[0]?.one;
    });
    expect(result).toBe(1);
  });

  it('closePool is idempotent', async () => {
    const cfg = makeConfig({ DATABASE_URL: integrationUrl ?? VALID_URL });
    getPool(cfg);
    await closePool();
    // Second close must not throw.
    await expect(closePool()).resolves.toBeUndefined();
  });
});
