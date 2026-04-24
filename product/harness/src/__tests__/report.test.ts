/**
 * Unit tests for the markdown + JSON reporters.
 *
 * Reporters are deterministic (no wall-clock, no IDs, no colour) so snapshot
 * tests would be overkill. Assert on load-bearing invariants.
 */

import { describe, expect, it } from 'vitest';
import { formatJson, formatMarkdown, summarise } from '../report.js';
import type { ScenarioResult } from '../runner.js';

const PASSED: ScenarioResult = {
  file: '/abs/product/harness/scenarios/000-greeting.yaml',
  name: 'greeting',
  description: 'Agent greets warmly.',
  status: 'passed',
  durationMs: 1234,
  turns: [
    {
      user: 'hi',
      utterText: 'Hello traveller!',
      toolCallCount: 0,
      rawPartCount: 3,
    },
  ],
  assertions: [
    { kind: 'contains', passed: true, message: 'ok' },
    { kind: 'not_contains', passed: true, message: 'ok' },
  ],
  judge: null,
};

const FAILED: ScenarioResult = {
  file: '/abs/product/harness/scenarios/002-pricing-refusal.yaml',
  name: 'pricing-refusal',
  description: 'Agent should hedge.',
  status: 'failed',
  durationMs: 2500,
  turns: [
    {
      user: 'exact price please',
      utterText: 'The exact price is £2,750.',
      toolCallCount: 0,
      rawPartCount: 2,
    },
  ],
  assertions: [
    {
      kind: 'not_contains',
      passed: false,
      message: 'final utterance unexpectedly contains "the exact price is"',
    },
  ],
  judge: null,
};

const ERRORED: ScenarioResult = {
  file: '/abs/product/harness/scenarios/010-triage-qualified.yaml',
  name: 'triage-qualified',
  description: 'Stub placeholder.',
  status: 'errored',
  durationMs: 50,
  turns: [],
  assertions: [],
  judge: null,
  error: 'POST /session fetch failed: ECONNREFUSED',
};

describe('summarise', () => {
  it('counts each status bucket', () => {
    expect(summarise([PASSED, FAILED, ERRORED])).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      errored: 1,
      durationMs: 1234 + 2500 + 50,
    });
  });
});

describe('formatMarkdown', () => {
  it('includes the update-in-place comment marker (first line)', () => {
    const md = formatMarkdown([PASSED]);
    expect(md.split('\n')[0]).toBe('<!-- swoop-harness-report -->');
  });

  it('emits a heading per scenario', () => {
    const md = formatMarkdown([PASSED, FAILED, ERRORED]);
    expect(md).toMatch(/## \[PASS\] greeting/);
    expect(md).toMatch(/## \[FAIL\] pricing-refusal/);
    expect(md).toMatch(/## \[ERROR\] triage-qualified/);
  });

  it('shows the non-gating disclaimer so reviewers do not panic on a red run', () => {
    const md = formatMarkdown([FAILED]);
    expect(md).toMatch(/Non-gating/);
  });

  it('strips absolute paths back to product-relative when it can', () => {
    const md = formatMarkdown([PASSED]);
    expect(md).toMatch(/product\/harness\/scenarios\/000-greeting\.yaml/);
    expect(md).not.toMatch(/\/abs\//);
  });
});

describe('formatJson', () => {
  it('produces a stable summary + results shape', () => {
    const json = formatJson([PASSED, FAILED], new Date('2026-04-24T13:22:00Z'));
    expect(json.summary.total).toBe(2);
    expect(json.summary.passed).toBe(1);
    expect(json.summary.failed).toBe(1);
    expect(json.generatedAt).toBe('2026-04-24T13:22:00.000Z');
    expect(json.results).toHaveLength(2);
  });
});
