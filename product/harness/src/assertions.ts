/**
 * Assertion evaluators.
 *
 * Two layers:
 *   1. Pure deterministic handlers per assertion `kind`. Inputs are the
 *      assertion + a `RunContext` (final utterance, per-turn parts, captured
 *      events, optional final triage). Output is `AssertionOutcome`.
 *   2. The `judge_rubric` handler, which is async and depends on the `Judge`
 *      interface from `judge.ts` (currently `StubJudge`; H.t5 wires Opus).
 *
 * Discriminated-union dispatch is exhaustive: TypeScript catches missing
 * cases at compile time.
 *
 * Notes on event-based assertions:
 *   `handoff_event` and `disclosure_event` consume `RunContext.events`. The
 *   harness CLI today populates that from a `NullEventCapture` (returns []),
 *   so authored scenarios using these kinds will fail with "no event
 *   captured" until the orchestrator-spawn-with-stdout-capture wiring lands
 *   (decision H.14). Tests inject a `MemoryEventCapture` directly to exercise
 *   the handlers fully.
 */

import type { Event } from '@swoop/common';

import type { Judge } from './judge.js';
import type {
  Assertion,
  ContainsAssertion,
  DisclosureEventAssertion,
  HandoffEventAssertion,
  JudgeRubricAssertion,
  NotContainsAssertion,
  ResponseFormatAssertion,
  ToolCallAssertion,
  TriageVerdictAssertion,
} from './scenario.js';

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface AssertionOutcome {
  readonly kind: Assertion['kind'];
  readonly passed: boolean;
  /** Human-readable message describing what was checked + the verdict. */
  readonly message: string;
}

/**
 * Captured tool-call shape produced by `orchestrator-client.ts` during SSE
 * consumption. The wire shape lives on the AI SDK `tool-call` part. We model
 * the load-bearing fields here; extra fields the runtime carries are ignored.
 */
export interface CapturedToolCall {
  readonly turnIndex: number;
  readonly toolName: string;
  readonly input: unknown;
}

/**
 * Per-turn structural counts. Populated by the runner from the SSE stream.
 *
 * Only the FINAL turn's record is consumed by `response_format` (matching the
 * Tier-2 §2.2 "response format" assertion definition). The runner still
 * collects all turns for diagnostic completeness.
 */
export interface TurnStructure {
  readonly utterPartCount: number;
  readonly fyiPartCount: number;
  readonly reasoningPartCount: number;
  readonly toolCallCount: number;
}

/**
 * Final triage state — derived by the runner from session/agent state. Today
 * there's no `/session/:id` introspection endpoint exposing triage, so the
 * runner leaves this `null` and `triage_verdict` assertions fail accordingly.
 * H.t3 declares the contract; later wiring populates it.
 */
export interface FinalTriage {
  readonly verdict:
    | 'qualified'
    | 'referred_out'
    | 'disqualified'
    | 'inconclusive';
  readonly reasonCode?: string;
}

/**
 * Everything an assertion handler might need from a single scenario run.
 * Keeping this in one struct means adding a new assertion kind that needs new
 * input is one field-add here + one handler — no signature churn elsewhere.
 */
export interface RunContext {
  readonly sessionId: string;
  readonly finalUtterance: string;
  readonly perTurnStructure: readonly TurnStructure[];
  readonly toolCalls: readonly CapturedToolCall[];
  readonly events: readonly Event[];
  readonly finalTriage: FinalTriage | null;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Evaluate a single assertion against a run context. Async because the
 * `judge_rubric` kind awaits the Judge; deterministic kinds resolve
 * synchronously but get wrapped in `Promise.resolve` for shape uniformity.
 *
 * Never throws — returns a structured outcome so the reporter can summarise
 * everything a scenario touched.
 */
export async function evaluateAssertion(
  assertion: Assertion,
  context: RunContext,
  judge: Judge,
): Promise<AssertionOutcome> {
  switch (assertion.kind) {
    case 'contains':
      return evaluateContains(assertion, context);
    case 'not_contains':
      return evaluateNotContains(assertion, context);
    case 'tool_call':
      return evaluateToolCall(assertion, context);
    case 'triage_verdict':
      return evaluateTriageVerdict(assertion, context);
    case 'handoff_event':
      return evaluateHandoffEvent(assertion, context);
    case 'disclosure_event':
      return evaluateDisclosureEvent(assertion, context);
    case 'response_format':
      return evaluateResponseFormat(assertion, context);
    case 'judge_rubric':
      return evaluateJudgeRubric(assertion, context, judge);
  }
}

/**
 * Evaluate every assertion in a scenario against the run context. Returns
 * one outcome per assertion, in authored order.
 */
export async function evaluateAll(
  assertions: readonly Assertion[],
  context: RunContext,
  judge: Judge,
): Promise<AssertionOutcome[]> {
  const outcomes: AssertionOutcome[] = [];
  for (const a of assertions) {
    outcomes.push(await evaluateAssertion(a, context, judge));
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Per-kind handlers (deterministic).
// ---------------------------------------------------------------------------

function evaluateContains(
  a: ContainsAssertion,
  ctx: RunContext,
): AssertionOutcome {
  const haystack = ctx.finalUtterance.toLowerCase();
  const needle = a.text.toLowerCase();
  const hit = haystack.includes(needle);
  return {
    kind: 'contains',
    passed: hit,
    message: hit
      ? `final utterance contains "${a.text}"`
      : `final utterance does NOT contain "${a.text}"`,
  };
}

function evaluateNotContains(
  a: NotContainsAssertion,
  ctx: RunContext,
): AssertionOutcome {
  const haystack = ctx.finalUtterance.toLowerCase();
  const needle = a.text.toLowerCase();
  const hit = haystack.includes(needle);
  return {
    kind: 'not_contains',
    passed: !hit,
    message: !hit
      ? `final utterance does NOT contain "${a.text}" (as expected)`
      : `final utterance unexpectedly contains "${a.text}"`,
  };
}

function evaluateToolCall(
  a: ToolCallAssertion,
  ctx: RunContext,
): AssertionOutcome {
  // Filter calls that match the toolName (and the optional turn).
  const candidates = ctx.toolCalls.filter((c) => {
    if (c.toolName !== a.toolName) return false;
    if (a.atTurn !== undefined && c.turnIndex !== a.atTurn) return false;
    return true;
  });

  if (candidates.length === 0) {
    const where = a.atTurn !== undefined ? ` on turn ${a.atTurn}` : '';
    return {
      kind: 'tool_call',
      passed: false,
      message: `expected tool call to "${a.toolName}"${where}; saw ${ctx.toolCalls.length} tool call(s) total`,
    };
  }

  // If no argsContains, the existence of any candidate is enough.
  if (!a.argsContains) {
    const where = a.atTurn !== undefined ? ` on turn ${a.atTurn}` : '';
    return {
      kind: 'tool_call',
      passed: true,
      message: `tool "${a.toolName}" was called${where} (${candidates.length} match(es))`,
    };
  }

  // argsContains: at least one candidate must satisfy partial-match.
  const required = a.argsContains;
  const match = candidates.find((c) => partialMatch(c.input, required));
  if (match) {
    return {
      kind: 'tool_call',
      passed: true,
      message: `tool "${a.toolName}" was called with args matching ${formatJsonShort(required)}`,
    };
  }

  // Diagnostic — show the first candidate's input so authors can debug.
  const sample = candidates[0]?.input;
  return {
    kind: 'tool_call',
    passed: false,
    message: `tool "${a.toolName}" was called but no call's args matched ${formatJsonShort(required)} (first candidate input: ${formatJsonShort(sample)})`,
  };
}

function evaluateTriageVerdict(
  a: TriageVerdictAssertion,
  ctx: RunContext,
): AssertionOutcome {
  if (!ctx.finalTriage) {
    return {
      kind: 'triage_verdict',
      passed: false,
      message: `expected triage verdict "${a.verdict}" but the run captured no final triage state`,
    };
  }
  if (ctx.finalTriage.verdict !== a.verdict) {
    return {
      kind: 'triage_verdict',
      passed: false,
      message: `expected triage verdict "${a.verdict}" but the final triage was "${ctx.finalTriage.verdict}"`,
    };
  }
  if (a.reasonCode !== undefined) {
    if (ctx.finalTriage.reasonCode !== a.reasonCode) {
      return {
        kind: 'triage_verdict',
        passed: false,
        message: `triage verdict matched ("${a.verdict}") but reasonCode differed: expected "${a.reasonCode}", saw "${ctx.finalTriage.reasonCode ?? '<none>'}"`,
      };
    }
    return {
      kind: 'triage_verdict',
      passed: true,
      message: `triage verdict is "${a.verdict}" with reasonCode "${a.reasonCode}"`,
    };
  }
  return {
    kind: 'triage_verdict',
    passed: true,
    message: `triage verdict is "${a.verdict}"`,
  };
}

function evaluateHandoffEvent(
  a: HandoffEventAssertion,
  ctx: RunContext,
): AssertionOutcome {
  const matches = ctx.events.filter(
    (e) =>
      e.eventType === 'handoff.submitted' && e.payload.verdict === a.verdict,
  );

  // present:false — assert that NO event of this kind fired.
  if (!a.present) {
    if (matches.length === 0) {
      return {
        kind: 'handoff_event',
        passed: true,
        message: `no handoff.submitted{verdict=${a.verdict}} event was emitted (as expected)`,
      };
    }
    return {
      kind: 'handoff_event',
      passed: false,
      message: `expected NO handoff.submitted{verdict=${a.verdict}} but ${matches.length} fired`,
    };
  }

  // present:true — assert at least one (optionally at-or-after a turn).
  if (matches.length === 0) {
    return {
      kind: 'handoff_event',
      passed: false,
      message: `no handoff.submitted{verdict=${a.verdict}} event was captured`,
    };
  }
  if (a.atTurnOrLater !== undefined) {
    const onOrAfter = matches.filter(
      (e) => e.turnIndex !== null && e.turnIndex >= a.atTurnOrLater!,
    );
    if (onOrAfter.length === 0) {
      const turns = matches
        .map((e) => (e.turnIndex === null ? '<no turn>' : String(e.turnIndex)))
        .join(', ');
      return {
        kind: 'handoff_event',
        passed: false,
        message: `handoff.submitted{verdict=${a.verdict}} fired but on turn(s) [${turns}]; expected at-or-after turn ${a.atTurnOrLater}`,
      };
    }
    return {
      kind: 'handoff_event',
      passed: true,
      message: `handoff.submitted{verdict=${a.verdict}} fired on turn ${onOrAfter[0].turnIndex} (>= ${a.atTurnOrLater})`,
    };
  }
  return {
    kind: 'handoff_event',
    passed: true,
    message: `handoff.submitted{verdict=${a.verdict}} fired (${matches.length} match(es))`,
  };
}

function evaluateDisclosureEvent(
  a: DisclosureEventAssertion,
  ctx: RunContext,
): AssertionOutcome {
  const matches = ctx.events.filter(
    (e) =>
      e.eventType === 'consent.granted' && e.payload.tier === 'conversation',
  );
  if (a.present) {
    if (matches.length === 0) {
      return {
        kind: 'disclosure_event',
        passed: false,
        message:
          'no consent.granted{tier=conversation} event was captured (disclosure pairing missing)',
      };
    }
    return {
      kind: 'disclosure_event',
      passed: true,
      message: `consent.granted{tier=conversation} fired (${matches.length} match(es))`,
    };
  }
  if (matches.length > 0) {
    return {
      kind: 'disclosure_event',
      passed: false,
      message: `expected NO consent.granted{tier=conversation} but ${matches.length} fired`,
    };
  }
  return {
    kind: 'disclosure_event',
    passed: true,
    message:
      'no consent.granted{tier=conversation} event fired (as expected)',
  };
}

function evaluateResponseFormat(
  a: ResponseFormatAssertion,
  ctx: RunContext,
): AssertionOutcome {
  // Use the FINAL turn's structure record. If there are no turns (errored
  // run that still got far enough to evaluate assertions), fall back to a
  // zero-record so checks resolve deterministically.
  const last = ctx.perTurnStructure[ctx.perTurnStructure.length - 1] ?? {
    utterPartCount: 0,
    fyiPartCount: 0,
    reasoningPartCount: 0,
    toolCallCount: 0,
  };

  const failures: string[] = [];

  if (a.hasUtter !== undefined) {
    const observed = last.utterPartCount > 0;
    if (observed !== a.hasUtter) {
      failures.push(
        `hasUtter: expected ${a.hasUtter}, observed ${observed} (${last.utterPartCount} utter part(s))`,
      );
    }
  }
  if (a.hasReasoning !== undefined) {
    const observed = last.reasoningPartCount > 0;
    if (observed !== a.hasReasoning) {
      failures.push(
        `hasReasoning: expected ${a.hasReasoning}, observed ${observed} (${last.reasoningPartCount} reasoning part(s) — reasoning should never reach the harness; B.t4 invariant)`,
      );
    }
  }
  if (a.fyiCount) {
    const c = last.fyiPartCount;
    if (a.fyiCount.min !== undefined && c < a.fyiCount.min) {
      failures.push(
        `fyiCount: ${c} < min ${a.fyiCount.min}`,
      );
    }
    if (a.fyiCount.max !== undefined && c > a.fyiCount.max) {
      failures.push(
        `fyiCount: ${c} > max ${a.fyiCount.max}`,
      );
    }
  }

  if (failures.length === 0) {
    return {
      kind: 'response_format',
      passed: true,
      message: `response format ok (utter=${last.utterPartCount}, reasoning=${last.reasoningPartCount}, fyi=${last.fyiPartCount})`,
    };
  }
  return {
    kind: 'response_format',
    passed: false,
    message: `response format failure(s): ${failures.join('; ')}`,
  };
}

async function evaluateJudgeRubric(
  a: JudgeRubricAssertion,
  ctx: RunContext,
  judge: Judge,
): Promise<AssertionOutcome> {
  try {
    const verdict = await judge.evaluate(a.rubric, ctx.finalUtterance, {
      model: a.model,
    });
    return {
      kind: 'judge_rubric',
      passed: verdict.passed,
      message: verdict.passed
        ? `judge passed: ${verdict.reasoning}`
        : `judge failed: ${verdict.reasoning}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      kind: 'judge_rubric',
      passed: false,
      message: `judge errored: ${reason}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Partial-match: every key in `expected` must be present in `actual`.
 * Object-typed values recurse with the same partial semantics — so an
 * `argsContains: { filters: { activity: 'hiking' } }` will match an actual
 * tool input of `{ filters: { activity: 'hiking', month: 'march' }, limit: 5 }`.
 * Extra keys at every level are allowed.
 *
 * Arrays match by exact length + element-wise `deepEqual` (no partial match
 * on arrays — author should pass the whole list when they care). Primitive
 * comparison is `===`. `null` matches `null` only.
 */
function partialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return actual === expected;
  if (typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (actual.length !== expected.length) return false;
    return expected.every((e, i) => deepEqual(actual[i], e));
  }
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    return false;
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  for (const key of Object.keys(e)) {
    if (!(key in a)) return false;
    if (!partialMatch(a[key], e[key])) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

function formatJsonShort(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return '<unserializable>';
  }
}
