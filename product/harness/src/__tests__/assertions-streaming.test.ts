/**
 * Tests for assertions.ts streaming integration.
 *
 * Coverage:
 *   - Without observability, evaluateAll behaves identically to today (no
 *     sink interaction; backward compat).
 *   - With observability, evaluateAll emits one `assertion.evaluated` event
 *     per assertion, after the handler returns, carrying kind + passed +
 *     reason.
 *   - For `judge_rubric` assertions, `judge.invoked` fires BEFORE
 *     judge.evaluate is called and `judge.responded` fires AFTER, even when
 *     the judge throws (so the JSONL log preserves the attempt).
 */

import { describe, it, expect } from 'vitest';

import { evaluateAll } from '../assertions.js';
import type { Assertion } from '../scenario.js';
import type { RunContext } from '../assertions.js';
import type { Judge } from '../judge.js';
import type { EventSink, HarnessEvent } from '../events.js';

class MemorySink implements EventSink {
  readonly events: HarnessEvent[] = [];
  emit(event: HarnessEvent): void {
    this.events.push(event);
  }
}

const NULL_CONTEXT: RunContext = {
  sessionId: 'sess_x',
  finalUtterance: 'hello world',
  perTurnStructure: [],
  toolCalls: [],
  events: [],
  finalTriage: null,
};

const PASSING_JUDGE: Judge = {
  async evaluate(_rubric, _response) {
    return {
      passed: true,
      reasoning: 'looks good',
      rawResponse: 'PASS\nlooks good',
    };
  },
};

const FAILING_JUDGE: Judge = {
  async evaluate() {
    return {
      passed: false,
      reasoning: 'missed the mark',
      rawResponse: 'FAIL\nmissed the mark',
    };
  },
};

const THROWING_JUDGE: Judge = {
  async evaluate() {
    throw new Error('judge api 500');
  },
};

describe('evaluateAll — without observability (backward compat)', () => {
  it('emits no events; outcomes unchanged', async () => {
    const sink = new MemorySink();
    const assertions: Assertion[] = [
      { kind: 'contains', text: 'hello' },
      { kind: 'not_contains', text: 'goodbye' },
    ];
    const outcomes = await evaluateAll(assertions, NULL_CONTEXT, PASSING_JUDGE);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.passed)).toBe(true);
    expect(sink.events).toHaveLength(0); // sink not passed in
  });
});

describe('evaluateAll — with observability', () => {
  it('emits assertion.evaluated per assertion, in order', async () => {
    const sink = new MemorySink();
    const assertions: Assertion[] = [
      { kind: 'contains', text: 'hello' },
      { kind: 'contains', text: 'world' },
      { kind: 'not_contains', text: 'goodbye' },
    ];
    await evaluateAll(assertions, NULL_CONTEXT, PASSING_JUDGE, {
      sink,
      scenarioName: 'three-assert',
    });
    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'assertion.evaluated',
      'assertion.evaluated',
      'assertion.evaluated',
    ]);
    // First two are 'contains'; third is 'not_contains'.
    const events = sink.events as Extract<
      HarnessEvent,
      { kind: 'assertion.evaluated' }
    >[];
    expect(events[0].assertionKind).toBe('contains');
    expect(events[0].passed).toBe(true);
    expect(events[2].assertionKind).toBe('not_contains');
  });

  it('judge_rubric: emits judge.invoked → judge.responded → assertion.evaluated (PASS)', async () => {
    const sink = new MemorySink();
    const assertions: Assertion[] = [
      { kind: 'judge_rubric', rubric: 'Is the response warm?' },
    ];
    await evaluateAll(assertions, NULL_CONTEXT, PASSING_JUDGE, {
      sink,
      scenarioName: 'judged',
    });
    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'judge.invoked',
      'judge.responded',
      'assertion.evaluated',
    ]);

    const invoked = sink.events[0];
    if (invoked.kind !== 'judge.invoked') throw new Error('unreachable');
    expect(invoked.rubric).toBe('Is the response warm?');
    expect(invoked.finalUtterance).toBe('hello world');
    expect(invoked.model).toBe('(judge-default)');

    const responded = sink.events[1];
    if (responded.kind !== 'judge.responded') throw new Error('unreachable');
    expect(responded.passed).toBe(true);
    expect(responded.reasoning).toBe('looks good');
    expect(responded.anthropicRaw).toBe('PASS\nlooks good');
    expect(responded.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('judge_rubric: emits judge.responded with passed=false when judge fails', async () => {
    const sink = new MemorySink();
    const assertions: Assertion[] = [
      { kind: 'judge_rubric', rubric: 'Is the response on-brand?' },
    ];
    await evaluateAll(assertions, NULL_CONTEXT, FAILING_JUDGE, {
      sink,
      scenarioName: 'judged-fail',
    });
    const responded = sink.events[1];
    if (responded.kind !== 'judge.responded') throw new Error('unreachable');
    expect(responded.passed).toBe(false);
    expect(responded.reasoning).toBe('missed the mark');
  });

  it('judge_rubric: emits judge.responded even when judge throws', async () => {
    const sink = new MemorySink();
    const assertions: Assertion[] = [
      { kind: 'judge_rubric', rubric: 'rubric' },
    ];
    await evaluateAll(assertions, NULL_CONTEXT, THROWING_JUDGE, {
      sink,
      scenarioName: 'judged-throw',
    });
    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'judge.invoked',
      'judge.responded',
      'assertion.evaluated',
    ]);
    const responded = sink.events[1];
    if (responded.kind !== 'judge.responded') throw new Error('unreachable');
    expect(responded.passed).toBe(false);
    expect(responded.reasoning).toContain('judge threw');
    expect(responded.reasoning).toContain('judge api 500');
  });

  it('judge_rubric: honours model override in invoked event', async () => {
    const sink = new MemorySink();
    const assertions: Assertion[] = [
      {
        kind: 'judge_rubric',
        rubric: 'rubric',
        model: 'claude-opus-4-7',
      },
    ];
    await evaluateAll(assertions, NULL_CONTEXT, PASSING_JUDGE, {
      sink,
      scenarioName: 'judged-override',
    });
    const invoked = sink.events[0];
    if (invoked.kind !== 'judge.invoked') throw new Error('unreachable');
    expect(invoked.model).toBe('claude-opus-4-7');
  });
});
