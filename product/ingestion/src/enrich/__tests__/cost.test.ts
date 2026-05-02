import { describe, it, expect } from 'vitest';
import {
  CostLedger,
  approxTokenCount,
  USD_TO_GBP,
  HAIKU_INPUT_PER_MILLION_USD,
  BATCH_DISCOUNT,
  VOYAGE_INPUT_PER_MILLION_USD,
} from '../cost.js';

describe('approxTokenCount', () => {
  it('returns 0 for empty', () => {
    expect(approxTokenCount('')).toBe(0);
  });

  it('approximates ~1 token per 4 chars', () => {
    // 'hello world' = 11 chars → ceil(11/4) = 3
    expect(approxTokenCount('hello world')).toBe(3);
  });
});

describe('CostLedger', () => {
  it('records voyage spend in GBP', () => {
    const warns: string[] = [];
    const errs: string[] = [];
    const ledger = new CostLedger({ hardCapGbp: 100, softWarningGbp: 50, warn: (m) => warns.push(m), err: (m) => errs.push(m) });
    ledger.recordVoyage('voyage:tag', 1_000_000, 1);
    const expectedUsd = VOYAGE_INPUT_PER_MILLION_USD;
    const expectedGbp = expectedUsd * USD_TO_GBP;
    expect(ledger.totalGbp()).toBeCloseTo(expectedGbp, 6);
  });

  it('applies batch discount to Haiku', () => {
    const ledger = new CostLedger({ hardCapGbp: 100, softWarningGbp: 50 });
    ledger.recordHaiku('haiku:blog_post_job', 1_000_000, 0, 1, true);
    const inputUsd = HAIKU_INPUT_PER_MILLION_USD;
    const expectedGbp = inputUsd * BATCH_DISCOUNT * USD_TO_GBP;
    expect(ledger.totalGbp()).toBeCloseTo(expectedGbp, 6);
  });

  it('full price when batched=false', () => {
    const ledger = new CostLedger({ hardCapGbp: 100, softWarningGbp: 50 });
    ledger.recordHaiku('haiku:blog_post_job', 1_000_000, 0, 1, false);
    const expectedGbp = HAIKU_INPUT_PER_MILLION_USD * USD_TO_GBP;
    expect(ledger.totalGbp()).toBeCloseTo(expectedGbp, 6);
  });

  it('shouldAbort when total ≥ hard cap', () => {
    const ledger = new CostLedger({ hardCapGbp: 0.001, softWarningGbp: 0 });
    expect(ledger.shouldAbort()).toBe(false);
    ledger.recordVoyage('voyage:tag', 1_000_000, 1);
    expect(ledger.shouldAbort()).toBe(true);
  });

  it('fires soft warning exactly once', () => {
    const warns: string[] = [];
    const ledger = new CostLedger({
      hardCapGbp: 1000,
      softWarningGbp: 0.0000001,
      warn: (m) => warns.push(m),
    });
    ledger.recordVoyage('voyage:tag', 1_000_000, 1);
    ledger.recordVoyage('voyage:tag', 1_000_000, 1);
    const softWarnings = warns.filter((w) => w.includes('soft warning'));
    expect(softWarnings.length).toBe(1);
  });

  it('summary breaks down per-pass', () => {
    const ledger = new CostLedger({ hardCapGbp: 100, softWarningGbp: 50 });
    ledger.recordVoyage('voyage:tag', 100, 1);
    ledger.recordHaiku('haiku:blog_post_job', 200, 50, 1, true);
    const s = ledger.summary();
    expect(s.perPass['voyage:tag']).toBeDefined();
    expect(s.perPass['haiku:blog_post_job']).toBeDefined();
    expect(s.perPass['voyage:tag']!.requests).toBe(1);
    expect(s.perPass['haiku:blog_post_job']!.requests).toBe(1);
  });
});
