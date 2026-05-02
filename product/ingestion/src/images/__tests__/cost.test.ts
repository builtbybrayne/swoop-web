/**
 * Unit tests for the cost estimator + budget gate. Postgres is mocked
 * via a tiny client double — no live DB required.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PER_CALL_USD,
  BATCHES_DISCOUNT,
  estimateCost,
  fitsBudget,
  formatCostEstimate,
} from '../cost.js';

interface FakeClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: { n: number }[] }>;
}

function clientReturning(n: number): FakeClient {
  return {
    query: async () => ({ rows: [{ n }] }),
  };
}

describe('estimateCost', () => {
  it('multiplies candidate count by per-call default', async () => {
    const est = await estimateCost(clientReturning(1000) as never);
    expect(est.candidates).toBe(1000);
    expect(est.perCallUsdLive).toBe(DEFAULT_PER_CALL_USD);
    expect(est.perCallUsdBatches).toBeCloseTo(DEFAULT_PER_CALL_USD * BATCHES_DISCOUNT);
    expect(est.totalUsdLive).toBe(5);
    expect(est.totalUsdBatches).toBe(2.5);
  });

  it('honours per-call override', async () => {
    const est = await estimateCost(clientReturning(2000) as never, 0.01);
    expect(est.perCallUsdLive).toBe(0.01);
    expect(est.totalUsdLive).toBe(20);
    expect(est.totalUsdBatches).toBe(10);
  });

  it('handles zero candidates without divide-by-zero / NaN', async () => {
    const est = await estimateCost(clientReturning(0) as never);
    expect(est.candidates).toBe(0);
    expect(est.totalUsdLive).toBe(0);
    expect(est.totalUsdBatches).toBe(0);
  });
});

describe('fitsBudget', () => {
  const baseEstimate = {
    candidates: 6700,
    perCallUsdLive: 0.005,
    perCallUsdBatches: 0.0025,
    totalUsdLive: 33.5,
    totalUsdBatches: 16.75,
  };

  it('passes when projected ≤ budget (batches mode default)', () => {
    const r = fitsBudget(baseEstimate, 25);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/projected \$16.75/);
    expect(r.reason).toMatch(/budget \$25.00/);
  });

  it('refuses when projected > budget', () => {
    const r = fitsBudget(baseEstimate, 10);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/projected \$16.75 > budget \$10.00/);
    expect(r.reason).toMatch(/--limit/);
  });

  it('uses live numbers when mode=live', () => {
    const r = fitsBudget(baseEstimate, 20, { mode: 'live' });
    expect(r.ok).toBe(false); // 33.5 > 20
    const r2 = fitsBudget(baseEstimate, 40, { mode: 'live' });
    expect(r2.ok).toBe(true);
  });
});

describe('formatCostEstimate', () => {
  it('renders both live + batches lines', () => {
    const text = formatCostEstimate(
      {
        candidates: 6700,
        perCallUsdLive: 0.005,
        perCallUsdBatches: 0.0025,
        totalUsdLive: 33.5,
        totalUsdBatches: 16.75,
      },
      { mode: 'batches' },
    );
    expect(text).toContain('candidates: 6,700');
    expect(text).toContain('live API');
    expect(text).toContain('Batches API');
    expect(text).toContain('$33.50');
    expect(text).toContain('$16.75');
    expect(text).toContain('batches mode');
  });
});
