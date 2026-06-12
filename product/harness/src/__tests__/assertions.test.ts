/**
 * Unit tests for the H.t3 assertion catalogue.
 *
 * Covers every kind in the discriminated union:
 *   contains / not_contains  (legacy H.t1)
 *   tool_call                (hits, misses, atTurn, argsContains)
 *   triage_verdict           (matches, mismatches, with/without reasonCode)
 *   handoff_event            (present + absent + atTurnOrLater)
 *   disclosure_event         (present + absent)
 *   response_format          (hasUtter / hasReasoning / fyiCount bounds)
 *   judge_rubric             (stub passes → asserts pass; stub fails → fails)
 *
 * `RunContext` is hand-built per test rather than going through the runner —
 * runner integration is exercised via the orchestrator client in CI.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateAll,
  evaluateAssertion,
  type AssertionOutcome,
  type CapturedToolCall,
  type RunContext,
} from '../assertions.js';
import type { Judge, JudgeVerdict } from '../judge.js';
import { StubJudge } from '../judge.js';
import type { Event } from '@swoop/common';

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    sessionId: 'sess_1',
    finalUtterance: '',
    perTurnStructure: [],
    toolCalls: [],
    events: [],
    finalTriage: null,
    ...overrides,
  };
}

function lookupCall(
  turnIndex: number,
  input: Record<string, unknown> = {},
): CapturedToolCall {
  return { turnIndex, toolName: 'lookup', input };
}

function triageDecidedEvent(
  verdict: 'qualified' | 'referred_out' | 'disqualified',
  reasonCode: string,
  turnIndex: number | null = 1,
): Event {
  return {
    eventType: 'triage.decided',
    eventVersion: 1,
    timestamp: '2026-04-28T12:00:00.000Z',
    sessionId: 'sess_1',
    turnIndex,
    actor: 'agent',
    payload: { verdict, reasonCode, reasonText: 'fixture' },
  };
}

function handoffSubmittedEvent(
  verdict: 'qualified' | 'referred_out' | 'disqualified',
  turnIndex: number | null,
): Event {
  return {
    eventType: 'handoff.submitted',
    eventVersion: 1,
    timestamp: '2026-04-28T12:00:00.000Z',
    sessionId: 'sess_1',
    turnIndex,
    actor: 'connector',
    payload: {
      handoffId: 'h_fixture',
      verdict,
      consentConversationGranted: true,
      consentHandoffGranted: true,
    },
  };
}

function consentGrantedEvent(
  tier: 'conversation' | 'handoff' | 'marketing',
): Event {
  return {
    eventType: 'consent.granted',
    eventVersion: 1,
    timestamp: '2026-04-28T12:00:00.000Z',
    sessionId: 'sess_1',
    turnIndex: 0,
    actor: 'ui',
    payload: { tier },
  };
}

const stubJudge = new StubJudge();

// ---------------------------------------------------------------------------
// contains / not_contains — preserved from H.t1.
// ---------------------------------------------------------------------------

describe('contains', () => {
  it('passes when the needle is present', async () => {
    const out = await evaluateAssertion(
      { kind: 'contains', text: 'hello' },
      ctx({ finalUtterance: 'Hello there, traveller.' }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
    expect(out.kind).toBe('contains');
  });

  it('is case-insensitive', async () => {
    const out = await evaluateAssertion(
      { kind: 'contains', text: 'PATAGONIA' },
      ctx({ finalUtterance: 'planning a trip to patagonia next winter' }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when the needle is absent', async () => {
    const out = await evaluateAssertion(
      { kind: 'contains', text: 'specialist' },
      ctx({ finalUtterance: 'that costs £5,000 exactly' }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/does NOT contain/);
  });
});

describe('not_contains', () => {
  it('passes when the needle is absent', async () => {
    const out = await evaluateAssertion(
      { kind: 'not_contains', text: 'the exact price is' },
      ctx({
        finalUtterance:
          'a W trek runs in the £2,000–4,000 range, depending on the season',
      }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when the needle is present', async () => {
    const out = await evaluateAssertion(
      { kind: 'not_contains', text: 'the exact price is' },
      ctx({ finalUtterance: 'The exact price is £2,750.' }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/unexpectedly contains/);
  });
});

// ---------------------------------------------------------------------------
// tool_call.
// ---------------------------------------------------------------------------

describe('tool_call', () => {
  it('passes when the named tool was called on any turn', async () => {
    const out = await evaluateAssertion(
      { kind: 'tool_call', toolName: 'lookup' },
      ctx({ toolCalls: [lookupCall(1, { activity: 'hiking' })] }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
    expect(out.message).toMatch(/lookup/);
  });

  it('fails when the named tool was never called', async () => {
    const out = await evaluateAssertion(
      { kind: 'tool_call', toolName: 'illustrate' },
      ctx({ toolCalls: [lookupCall(1)] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/expected tool call to "illustrate"/);
  });

  it('respects atTurn — passes when the call happened on the right turn', async () => {
    const out = await evaluateAssertion(
      { kind: 'tool_call', toolName: 'lookup', atTurn: 2 },
      ctx({ toolCalls: [lookupCall(1), lookupCall(2, { activity: 'hiking' })] }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('respects atTurn — fails when the call was on a different turn', async () => {
    const out = await evaluateAssertion(
      { kind: 'tool_call', toolName: 'lookup', atTurn: 2 },
      ctx({ toolCalls: [lookupCall(1)] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/on turn 2/);
  });

  it('argsContains — passes when partial args match', async () => {
    const out = await evaluateAssertion(
      {
        kind: 'tool_call',
        toolName: 'lookup',
        argsContains: { activity: 'hiking' },
      },
      ctx({
        toolCalls: [
          lookupCall(1, { activity: 'hiking', region: 'patagonia', limit: 5 }),
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
    expect(out.message).toMatch(/args matching/);
  });

  it('argsContains — fails when the args do not match', async () => {
    const out = await evaluateAssertion(
      {
        kind: 'tool_call',
        toolName: 'lookup',
        argsContains: { activity: 'hiking' },
      },
      ctx({ toolCalls: [lookupCall(1, { activity: 'kayaking' })] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/no call's args matched/);
  });

  it('argsContains — supports nested partial-match', async () => {
    const out = await evaluateAssertion(
      {
        kind: 'tool_call',
        toolName: 'lookup',
        argsContains: { filters: { activity: 'hiking' } },
      },
      ctx({
        toolCalls: [
          lookupCall(1, {
            filters: { activity: 'hiking', month: 'march' },
            limit: 5,
          }),
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tool_call_order.
// ---------------------------------------------------------------------------

/** Arbitrary-name CapturedToolCall for order tests. */
function namedCall(toolName: string, turnIndex: number): CapturedToolCall {
  return { turnIndex, toolName, input: {} };
}

describe('tool_call_order', () => {
  const order = { kind: 'tool_call_order', first: 'find_options', second: 'show_options' } as const;

  it('passes when first precedes second', async () => {
    const out = await evaluateAssertion(
      order,
      ctx({ toolCalls: [namedCall('find_options', 1), namedCall('show_options', 1)] }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
    expect(out.message).toMatch(/precedes/);
  });

  it('fails when second fires before any first (even if a later pair complies)', async () => {
    const out = await evaluateAssertion(
      order,
      ctx({
        toolCalls: [
          namedCall('show_options', 1),
          namedCall('find_options', 2),
          namedCall('show_options', 2),
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/fired before/);
  });

  it('fails when first never fires', async () => {
    const out = await evaluateAssertion(
      order,
      ctx({ toolCalls: [namedCall('show_options', 1)] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/"find_options" never called/);
  });

  it('fails when second never fires', async () => {
    const out = await evaluateAssertion(
      order,
      ctx({ toolCalls: [namedCall('find_options', 1)] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/"show_options" never called/);
  });

  it('ignores unrelated tools between the pair', async () => {
    const out = await evaluateAssertion(
      order,
      ctx({
        toolCalls: [
          namedCall('find_options', 1),
          namedCall('illustrate', 1),
          namedCall('show_options', 2),
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// triage_verdict.
// ---------------------------------------------------------------------------

describe('triage_verdict', () => {
  it('passes when the verdict matches', async () => {
    const out = await evaluateAssertion(
      { kind: 'triage_verdict', verdict: 'qualified' },
      ctx({ finalTriage: { verdict: 'qualified', reasonCode: 'group_tour_intent' } }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when the verdict differs', async () => {
    const out = await evaluateAssertion(
      { kind: 'triage_verdict', verdict: 'qualified' },
      ctx({ finalTriage: { verdict: 'disqualified', reasonCode: 'backpacker_no_budget' } }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/expected triage verdict "qualified"/);
  });

  it('fails when no triage was captured at all', async () => {
    const out = await evaluateAssertion(
      { kind: 'triage_verdict', verdict: 'qualified' },
      ctx(),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/no final triage state/);
  });

  it('reasonCode — passes when it matches', async () => {
    const out = await evaluateAssertion(
      {
        kind: 'triage_verdict',
        verdict: 'qualified',
        reasonCode: 'group_tour_intent',
      },
      ctx({ finalTriage: { verdict: 'qualified', reasonCode: 'group_tour_intent' } }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
    expect(out.message).toMatch(/reasonCode "group_tour_intent"/);
  });

  it('reasonCode — fails when the verdict is right but reasonCode differs', async () => {
    const out = await evaluateAssertion(
      {
        kind: 'triage_verdict',
        verdict: 'qualified',
        reasonCode: 'bespoke_request',
      },
      ctx({ finalTriage: { verdict: 'qualified', reasonCode: 'group_tour_intent' } }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/reasonCode differed/);
  });
});

// ---------------------------------------------------------------------------
// handoff_event.
// ---------------------------------------------------------------------------

describe('handoff_event', () => {
  it('passes when present:true and the event fired with matching verdict', async () => {
    const out = await evaluateAssertion(
      { kind: 'handoff_event', verdict: 'qualified', present: true },
      ctx({ events: [handoffSubmittedEvent('qualified', 4)] }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when present:true and no event fired', async () => {
    const out = await evaluateAssertion(
      { kind: 'handoff_event', verdict: 'qualified', present: true },
      ctx(),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/no handoff.submitted/);
  });

  it('fails when present:true but only a different-verdict event fired', async () => {
    const out = await evaluateAssertion(
      { kind: 'handoff_event', verdict: 'qualified', present: true },
      ctx({ events: [handoffSubmittedEvent('disqualified', 4)] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
  });

  it('passes when present:false and no event fired', async () => {
    const out = await evaluateAssertion(
      { kind: 'handoff_event', verdict: 'qualified', present: false },
      ctx(),
      stubJudge,
    );
    expect(out.passed).toBe(true);
    expect(out.message).toMatch(/as expected/);
  });

  it('fails when present:false but the event did fire', async () => {
    const out = await evaluateAssertion(
      { kind: 'handoff_event', verdict: 'qualified', present: false },
      ctx({ events: [handoffSubmittedEvent('qualified', 4)] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
  });

  it('atTurnOrLater — passes when the event fired on a later turn', async () => {
    const out = await evaluateAssertion(
      {
        kind: 'handoff_event',
        verdict: 'qualified',
        present: true,
        atTurnOrLater: 3,
      },
      ctx({ events: [handoffSubmittedEvent('qualified', 4)] }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('atTurnOrLater — fails when the event fired earlier', async () => {
    const out = await evaluateAssertion(
      {
        kind: 'handoff_event',
        verdict: 'qualified',
        present: true,
        atTurnOrLater: 3,
      },
      ctx({ events: [handoffSubmittedEvent('qualified', 1)] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/expected at-or-after turn 3/);
  });
});

// ---------------------------------------------------------------------------
// disclosure_event.
// ---------------------------------------------------------------------------

describe('disclosure_event', () => {
  it('passes when present:true and the consent.granted{conversation} fired', async () => {
    const out = await evaluateAssertion(
      { kind: 'disclosure_event', present: true },
      ctx({ events: [consentGrantedEvent('conversation')] }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when present:true but only handoff-tier consent fired', async () => {
    const out = await evaluateAssertion(
      { kind: 'disclosure_event', present: true },
      ctx({ events: [consentGrantedEvent('handoff')] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
  });

  it('passes when present:false and no consent event fired', async () => {
    const out = await evaluateAssertion(
      { kind: 'disclosure_event', present: false },
      ctx(),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when present:false but the event did fire', async () => {
    const out = await evaluateAssertion(
      { kind: 'disclosure_event', present: false },
      ctx({ events: [consentGrantedEvent('conversation')] }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// response_format.
// ---------------------------------------------------------------------------

describe('response_format', () => {
  it('passes when hasUtter:true and the final turn had >=1 utter part', async () => {
    const out = await evaluateAssertion(
      { kind: 'response_format', hasUtter: true },
      ctx({
        perTurnStructure: [
          {
            utterPartCount: 3,
            fyiPartCount: 1,
            reasoningPartCount: 0,
            toolCallCount: 0,
          },
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when hasUtter:true but no utter parts were captured', async () => {
    const out = await evaluateAssertion(
      { kind: 'response_format', hasUtter: true },
      ctx({
        perTurnStructure: [
          {
            utterPartCount: 0,
            fyiPartCount: 0,
            reasoningPartCount: 0,
            toolCallCount: 0,
          },
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/hasUtter/);
  });

  it('passes when hasReasoning:false and reasoning is correctly stripped', async () => {
    const out = await evaluateAssertion(
      { kind: 'response_format', hasReasoning: false },
      ctx({
        perTurnStructure: [
          {
            utterPartCount: 2,
            fyiPartCount: 0,
            reasoningPartCount: 0,
            toolCallCount: 0,
          },
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fails when hasReasoning:false but reasoning leaked through (B.t4 invariant break)', async () => {
    const out = await evaluateAssertion(
      { kind: 'response_format', hasReasoning: false },
      ctx({
        perTurnStructure: [
          {
            utterPartCount: 2,
            fyiPartCount: 0,
            reasoningPartCount: 1,
            toolCallCount: 0,
          },
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/B\.t4 invariant/);
  });

  it('fyiCount — passes when within bounds', async () => {
    const out = await evaluateAssertion(
      { kind: 'response_format', fyiCount: { min: 1, max: 3 } },
      ctx({
        perTurnStructure: [
          {
            utterPartCount: 1,
            fyiPartCount: 2,
            reasoningPartCount: 0,
            toolCallCount: 0,
          },
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
  });

  it('fyiCount — fails when below min', async () => {
    const out = await evaluateAssertion(
      { kind: 'response_format', fyiCount: { min: 1 } },
      ctx({
        perTurnStructure: [
          {
            utterPartCount: 1,
            fyiPartCount: 0,
            reasoningPartCount: 0,
            toolCallCount: 0,
          },
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/< min 1/);
  });

  it('fyiCount — fails when above max', async () => {
    const out = await evaluateAssertion(
      { kind: 'response_format', fyiCount: { max: 1 } },
      ctx({
        perTurnStructure: [
          {
            utterPartCount: 1,
            fyiPartCount: 5,
            reasoningPartCount: 0,
            toolCallCount: 0,
          },
        ],
      }),
      stubJudge,
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/> max 1/);
  });
});

// ---------------------------------------------------------------------------
// judge_rubric.
// ---------------------------------------------------------------------------

class FailingJudge implements Judge {
  async evaluate(_rubric: string, _response: string): Promise<JudgeVerdict> {
    return { passed: false, reasoning: 'rubric not met' };
  }
}

class ThrowingJudge implements Judge {
  async evaluate(_rubric: string, _response: string): Promise<JudgeVerdict> {
    throw new Error('upstream model unreachable');
  }
}

describe('judge_rubric', () => {
  it('passes when the (stub) judge returns passed:true', async () => {
    const out = await evaluateAssertion(
      { kind: 'judge_rubric', rubric: 'on-brand?' },
      ctx({ finalUtterance: 'warmth and adventure' }),
      stubJudge,
    );
    expect(out.passed).toBe(true);
    expect(out.message).toMatch(/judge passed/);
  });

  it('fails when the judge returns passed:false', async () => {
    const out = await evaluateAssertion(
      { kind: 'judge_rubric', rubric: 'on-brand?' },
      ctx({ finalUtterance: 'corporate boilerplate' }),
      new FailingJudge(),
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/judge failed: rubric not met/);
  });

  it('fails (without crashing) when the judge throws', async () => {
    const out = await evaluateAssertion(
      { kind: 'judge_rubric', rubric: 'on-brand?' },
      ctx({ finalUtterance: 'whatever' }),
      new ThrowingJudge(),
    );
    expect(out.passed).toBe(false);
    expect(out.message).toMatch(/judge errored: upstream model unreachable/);
  });
});

// ---------------------------------------------------------------------------
// evaluateAll — preserves authored order.
// ---------------------------------------------------------------------------

describe('evaluateAll', () => {
  it('preserves authored order across mixed kinds', async () => {
    const outcomes: AssertionOutcome[] = await evaluateAll(
      [
        { kind: 'contains', text: 'hello' },
        { kind: 'not_contains', text: 'email address' },
        { kind: 'tool_call', toolName: 'lookup' },
      ],
      ctx({
        finalUtterance: 'Hello traveller — what draws you to Patagonia?',
        toolCalls: [lookupCall(1)],
      }),
      stubJudge,
    );
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0].kind).toBe('contains');
    expect(outcomes[0].passed).toBe(true);
    expect(outcomes[1].kind).toBe('not_contains');
    expect(outcomes[1].passed).toBe(true);
    expect(outcomes[2].kind).toBe('tool_call');
    expect(outcomes[2].passed).toBe(true);
  });

  it('returns empty when there are no assertions', async () => {
    expect(await evaluateAll([], ctx(), stubJudge)).toEqual([]);
  });
});

// Ensure the unused-import linter is happy with the triage helper used in
// other suites — keep it referenced by exporting nothing-but-touching here.
void triageDecidedEvent;
