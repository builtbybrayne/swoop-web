import { describe, it, expect } from 'vitest';
import { buildEnrichPoolConfig, toPgVectorLiteral, fromPgVectorLiteral } from '../pool.js';

describe('buildEnrichPoolConfig', () => {
  it('passes statement_timeout via libpq options', () => {
    const cfg = buildEnrichPoolConfig({ databaseUrl: 'postgresql://x', statementTimeoutMs: 99_999 });
    expect(cfg.options).toBe('-c statement_timeout=99999');
  });

  it('defaults statement_timeout to 60s for ETL', () => {
    const cfg = buildEnrichPoolConfig({ databaseUrl: 'postgresql://x' });
    expect(cfg.options).toBe('-c statement_timeout=60000');
  });

  it('sets application_name', () => {
    const cfg = buildEnrichPoolConfig({ databaseUrl: 'postgresql://x' });
    expect(cfg.application_name).toBe('swoop-enrich');
  });
});

describe('toPgVectorLiteral / fromPgVectorLiteral', () => {
  it('round-trips a small vector', () => {
    const v = [0.1, 0.2, 0.3];
    const literal = toPgVectorLiteral(v);
    expect(literal).toBe('[0.1,0.2,0.3]');
    const back = fromPgVectorLiteral(literal);
    expect(back).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns null for null/empty input', () => {
    expect(fromPgVectorLiteral(null)).toBe(null);
    expect(fromPgVectorLiteral(undefined)).toBe(null);
  });

  it('returns null for malformed input', () => {
    expect(fromPgVectorLiteral('not a vector')).toBe(null);
  });

  it('handles empty vector', () => {
    expect(fromPgVectorLiteral('[]')).toEqual([]);
  });
});
