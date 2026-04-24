/**
 * Assertion evaluators (H.t1 scope: `contains` / `not_contains`).
 *
 * Both operate on a single aggregated string — the final assistant utterance
 * text from the last turn. Case-insensitive substring matching: that's the
 * floor for v1. H.t3 extends the discriminated union with tool-call, triage,
 * event, disclosure, and judge-rubric assertions without changing this
 * module's callers.
 */

import type { Assertion } from './scenario.js';

export interface AssertionOutcome {
  readonly kind: Assertion['kind'];
  readonly passed: boolean;
  /** Human-readable message describing what was checked + the verdict. */
  readonly message: string;
}

/**
 * Evaluate a single assertion against the final utterance text.
 * Never throws — returns a structured outcome so the reporter can summarise
 * everything a scenario touched.
 */
export function evaluateAssertion(
  assertion: Assertion,
  finalUtterance: string,
): AssertionOutcome {
  const haystack = finalUtterance.toLowerCase();
  const needle = assertion.text.toLowerCase();
  const hit = haystack.includes(needle);

  switch (assertion.kind) {
    case 'contains':
      return {
        kind: 'contains',
        passed: hit,
        message: hit
          ? `final utterance contains "${assertion.text}"`
          : `final utterance does NOT contain "${assertion.text}"`,
      };
    case 'not_contains':
      return {
        kind: 'not_contains',
        passed: !hit,
        message: !hit
          ? `final utterance does NOT contain "${assertion.text}" (as expected)`
          : `final utterance unexpectedly contains "${assertion.text}"`,
      };
  }
}

/**
 * Evaluate every assertion in a scenario against the final utterance. Returns
 * one outcome per assertion, in authored order.
 */
export function evaluateAll(
  assertions: readonly Assertion[],
  finalUtterance: string,
): AssertionOutcome[] {
  return assertions.map((a) => evaluateAssertion(a, finalUtterance));
}
