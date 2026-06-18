/**
 * Unit tests for loadConfig's env promotions (config/load.ts).
 *
 * Primary focus: the ORCHESTRATOR_DATABASE_URL ← DATABASE_URL fallback. A
 * single-store deployment (C.18) shares one Postgres URL across the connector
 * and orchestrator, so the orchestrator's URL falls back to the connector's
 * DATABASE_URL when its own var is unset. The promotion runs BEFORE schema
 * parse so the SESSION_BACKEND=postgres / EVENT_SINK=postgres cross-field
 * refines see the resolved value instead of rejecting boot (process.exit(1)).
 *
 * Also covers the long-standing PRIMARY_MODEL → ORCHESTRATOR_MODEL promotion,
 * which previously had no direct test.
 *
 * loadConfig(env) is pure given an env dict (it only reads process.env when the
 * argument is omitted), so we pass fixtures and assert on the returned Config.
 * A minimal valid env is just ANTHROPIC_API_KEY — every other field defaults,
 * and both *_ENABLED flags default false so their refines are satisfied.
 */

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../load.js';

const MINIMAL_VALID_ENV = { ANTHROPIC_API_KEY: 'sk-ant-test' };
const PG_URL = 'postgresql://u:p@localhost:5432/puma_dev';
const PG_URL_ALT = 'postgresql://u:p@localhost:5432/other_db';

describe('loadConfig — ORCHESTRATOR_DATABASE_URL ← DATABASE_URL fallback', () => {
  it('promotes DATABASE_URL into ORCHESTRATOR_DATABASE_URL when the latter is unset', () => {
    const config = loadConfig({
      ...MINIMAL_VALID_ENV,
      SESSION_BACKEND: 'postgres',
      DATABASE_URL: PG_URL,
    });
    expect(config.SESSION_BACKEND).toBe('postgres');
    expect(config.ORCHESTRATOR_DATABASE_URL).toBe(PG_URL);
  });

  it('lets SESSION_BACKEND=postgres boot with only DATABASE_URL set', () => {
    // Pre-fallback the cross-field refine rejected this and loadConfig
    // process.exit(1)'d; reaching the assertion proves the refine saw the
    // promoted value.
    const config = loadConfig({
      ...MINIMAL_VALID_ENV,
      SESSION_BACKEND: 'postgres',
      DATABASE_URL: PG_URL,
    });
    expect(config.ORCHESTRATOR_DATABASE_URL.length).toBeGreaterThan(0);
  });

  it('lets EVENT_SINK=postgres boot with only DATABASE_URL set', () => {
    const config = loadConfig({
      ...MINIMAL_VALID_ENV,
      EVENT_SINK: 'postgres',
      DATABASE_URL: PG_URL,
    });
    expect(config.EVENT_SINK).toBe('postgres');
    expect(config.ORCHESTRATOR_DATABASE_URL).toBe(PG_URL);
  });

  it('prefers an explicit ORCHESTRATOR_DATABASE_URL over DATABASE_URL', () => {
    const config = loadConfig({
      ...MINIMAL_VALID_ENV,
      SESSION_BACKEND: 'postgres',
      ORCHESTRATOR_DATABASE_URL: PG_URL,
      DATABASE_URL: PG_URL_ALT,
    });
    expect(config.ORCHESTRATOR_DATABASE_URL).toBe(PG_URL);
  });

  it('leaves ORCHESTRATOR_DATABASE_URL empty when neither is set (in-memory default)', () => {
    const config = loadConfig({ ...MINIMAL_VALID_ENV });
    expect(config.SESSION_BACKEND).toBe('in-memory');
    expect(config.ORCHESTRATOR_DATABASE_URL).toBe('');
  });
});

describe('loadConfig — PRIMARY_MODEL → ORCHESTRATOR_MODEL promotion', () => {
  it('promotes PRIMARY_MODEL when ORCHESTRATOR_MODEL is unset', () => {
    const config = loadConfig({
      ...MINIMAL_VALID_ENV,
      PRIMARY_MODEL: 'claude-sonnet-4-6',
    });
    expect(config.ORCHESTRATOR_MODEL).toBe('claude-sonnet-4-6');
  });

  it('prefers an explicit ORCHESTRATOR_MODEL over PRIMARY_MODEL', () => {
    const config = loadConfig({
      ...MINIMAL_VALID_ENV,
      ORCHESTRATOR_MODEL: 'claude-opus-4-8',
      PRIMARY_MODEL: 'claude-sonnet-4-6',
    });
    expect(config.ORCHESTRATOR_MODEL).toBe('claude-opus-4-8');
  });
});
