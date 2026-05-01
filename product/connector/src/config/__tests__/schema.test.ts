/**
 * Tests for the @swoop/connector config schema.
 *
 * Validates:
 *   - Happy path with all required fields.
 *   - Defaults applied correctly.
 *   - DATABASE_URL stricter validation per HITL Q5 (scheme allowlist + db name).
 *   - Pool tunable bounds enforced.
 *
 * Same shape as the orchestrator's schema tests; covers the contract C.t3+
 * tasks will silently inherit.
 */

import { describe, expect, it } from 'vitest';
import { configSchema } from '../schema.js';

const VALID_URL = 'postgresql://al:pick-a-password@localhost:5432/puma_dev';

describe('connector config schema — happy paths', () => {
  it('parses a minimal env with just DATABASE_URL', () => {
    const parsed = configSchema.safeParse({ DATABASE_URL: VALID_URL });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DATABASE_URL).toBe(VALID_URL);
      expect(parsed.data.CONNECTOR_PORT).toBe(3002);
      expect(parsed.data.PG_POOL_MAX).toBe(10);
      expect(parsed.data.PG_POOL_IDLE_MS).toBe(30_000);
      expect(parsed.data.PG_STATEMENT_TIMEOUT_MS).toBe(10_000);
      expect(parsed.data.NODE_ENV).toBe('development');
    }
  });

  it('coerces numeric strings for pool tunables', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: VALID_URL,
      CONNECTOR_PORT: '4000',
      PG_POOL_MAX: '25',
      PG_POOL_IDLE_MS: '60000',
      PG_STATEMENT_TIMEOUT_MS: '5000',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.CONNECTOR_PORT).toBe(4000);
      expect(parsed.data.PG_POOL_MAX).toBe(25);
      expect(parsed.data.PG_POOL_IDLE_MS).toBe(60_000);
      expect(parsed.data.PG_STATEMENT_TIMEOUT_MS).toBe(5_000);
    }
  });

  it('accepts the postgres:// scheme as well as postgresql://', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: 'postgres://al@localhost:5432/puma_dev',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('connector config schema — DATABASE_URL stricter validation (HITL Q5)', () => {
  it('rejects when DATABASE_URL is missing', () => {
    const parsed = configSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'DATABASE_URL')).toBe(true);
    }
  });

  it('rejects when DATABASE_URL is empty', () => {
    const parsed = configSchema.safeParse({ DATABASE_URL: '' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-URL string', () => {
    const parsed = configSchema.safeParse({ DATABASE_URL: 'not-a-url' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an http:// URL — wrong scheme', () => {
    const parsed = configSchema.safeParse({ DATABASE_URL: 'https://example.com/puma_dev' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('\n');
      expect(msg).toMatch(/postgres/i);
    }
  });

  it('rejects a javascript: URL — wrong scheme (mirrors Sec-3 fix shape)', () => {
    const parsed = configSchema.safeParse({ DATABASE_URL: 'javascript:alert(1)' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a postgres URL with no database name in the path', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: 'postgresql://al:pick-a-password@localhost:5432/',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a postgres URL with a multi-segment database path', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: 'postgresql://al:pick-a-password@localhost:5432/db/extra',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('connector config schema — pool tunable bounds', () => {
  it('rejects PG_POOL_MAX below 1', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: VALID_URL,
      PG_POOL_MAX: '0',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects PG_POOL_MAX above 100', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: VALID_URL,
      PG_POOL_MAX: '101',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects PG_STATEMENT_TIMEOUT_MS below 1000', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: VALID_URL,
      PG_STATEMENT_TIMEOUT_MS: '500',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts PG_POOL_IDLE_MS of 0 (immediate release)', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: VALID_URL,
      PG_POOL_IDLE_MS: '0',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('connector config schema — NODE_ENV', () => {
  it('rejects unknown NODE_ENV values', () => {
    const parsed = configSchema.safeParse({
      DATABASE_URL: VALID_URL,
      NODE_ENV: 'staging',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts development / test / production', () => {
    for (const env of ['development', 'test', 'production'] as const) {
      const parsed = configSchema.safeParse({ DATABASE_URL: VALID_URL, NODE_ENV: env });
      expect(parsed.success).toBe(true);
    }
  });
});
