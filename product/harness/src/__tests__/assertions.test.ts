/**
 * Unit tests for the v1 assertion matchers.
 *
 * Scope per H.t1: `contains` + `not_contains` against the final utterance
 * string, case-insensitive substring. H.t3 extends the discriminated union
 * with tool-call / triage / event / judge kinds and adds tests alongside.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateAll,
  evaluateAssertion,
  type AssertionOutcome,
} from '../assertions.js';

describe('evaluateAssertion', () => {
  describe('contains', () => {
    it('passes when the needle is present', () => {
      const out = evaluateAssertion(
        { kind: 'contains', text: 'hello' },
        'Hello there, traveller.',
      );
      expect(out.passed).toBe(true);
      expect(out.kind).toBe('contains');
    });

    it('is case-insensitive', () => {
      const out = evaluateAssertion(
        { kind: 'contains', text: 'PATAGONIA' },
        'planning a trip to patagonia next winter',
      );
      expect(out.passed).toBe(true);
    });

    it('fails when the needle is absent', () => {
      const out = evaluateAssertion(
        { kind: 'contains', text: 'specialist' },
        'that costs £5,000 exactly',
      );
      expect(out.passed).toBe(false);
      expect(out.message).toMatch(/does NOT contain/);
    });
  });

  describe('not_contains', () => {
    it('passes when the needle is absent', () => {
      const out = evaluateAssertion(
        { kind: 'not_contains', text: 'the exact price is' },
        'a W trek runs in the £2,000–4,000 range, depending on the season',
      );
      expect(out.passed).toBe(true);
    });

    it('fails when the needle is present', () => {
      const out = evaluateAssertion(
        { kind: 'not_contains', text: 'the exact price is' },
        'The exact price is £2,750.',
      );
      expect(out.passed).toBe(false);
      expect(out.message).toMatch(/unexpectedly contains/);
    });
  });
});

describe('evaluateAll', () => {
  it('preserves authored order', () => {
    const outcomes: AssertionOutcome[] = evaluateAll(
      [
        { kind: 'contains', text: 'hello' },
        { kind: 'not_contains', text: 'email address' },
      ],
      'Hello traveller — what draws you to Patagonia?',
    );
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].kind).toBe('contains');
    expect(outcomes[0].passed).toBe(true);
    expect(outcomes[1].kind).toBe('not_contains');
    expect(outcomes[1].passed).toBe(true);
  });

  it('returns empty when there are no assertions', () => {
    expect(evaluateAll([], 'any text')).toEqual([]);
  });
});
