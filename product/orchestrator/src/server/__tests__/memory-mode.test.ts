/**
 * T3-3 — explicit memory-request detector unit tests (sm-3).
 *
 * The detector is the gate that decides whether a STAFF turn is an explicit
 * memory-management instruction. It must be CONSERVATIVE: incidental uses of
 * "remember" must NOT trip it (the confirm-before-write step is the safety net,
 * but we still don't want to yank the staff member into memory mode on a false
 * positive every other turn).
 */

import { describe, it, expect } from 'vitest';
import { isExplicitMemoryExit, isExplicitMemoryRequest } from '../memory-mode.js';

describe('isExplicitMemoryRequest', () => {
  describe('positive — explicit memory-management instructions', () => {
    const positives = [
      'Please remember that the refugios book out 6 months ahead.',
      'remember this: tours carry no listed prices',
      'Can you remember that December is peak season?',
      'Save this as a memory for next time.',
      'add a memory about the W trek',
      'Update the memory about pricing — it changed.',
      'forget that, it is no longer accurate',
      'retire that memory please',
      'what do you remember so far?',
      'list your memories',
      'show me your memories',
      'go into memory mode',
      'Let us enter memory mode now',
      // Broadened intent detection (sm-3 relaxed for staff, 2026-06-19) — natural
      // formulations the fixed phrase list missed.
      'To remember: refugios peak season is January and they book up fast.',
      'Remember the refugios book out months ahead.',
      'Note: tours carry no listed prices anywhere.',
      'jot this down: October is shoulder season',
    ];
    for (const msg of positives) {
      it(`matches: "${msg}"`, () => {
        expect(isExplicitMemoryRequest(msg)).toBe(true);
      });
    }
  });

  describe('negative — incidental or unrelated text must NOT match', () => {
    const negatives = [
      "I'll remember to pack warm layers for the trek.",
      'I remember when I visited Torres del Paine in 2019.',
      'Remind me how long the W trek takes?',
      'What is the best time to visit Patagonia?',
      'Do you have any trips in March?',
      'That sounds memorable!',
      'The memory of that sunset stays with me.',
      'Tell me about the refugios.',
      // Staff testing the visitor flow must not be yanked into memory mode.
      'Then tell me about kayaking.',
      'Can I book January refugios last-minute?',
      '',
      '   ',
    ];
    for (const msg of negatives) {
      it(`does not match: "${msg}"`, () => {
        expect(isExplicitMemoryRequest(msg)).toBe(false);
      });
    }
  });

  it('is case-insensitive and whitespace-robust', () => {
    expect(isExplicitMemoryRequest('REMEMBER THAT it snows in winter')).toBe(true);
    expect(isExplicitMemoryRequest('please    remember   that  X')).toBe(true);
    expect(isExplicitMemoryRequest('\n\tadd a memory\n')).toBe(true);
  });
});

describe('isExplicitMemoryExit (sm-3 hard backstop)', () => {
  describe('positive — explicit "leave memory mode" instructions', () => {
    const positives = [
      'exit memory mode',
      'Please leave memory mode now.',
      'quit memory mode',
      'stop memory mode',
      "ok that's everything, back to testing",
      'Let us get back to the agent.',
      'return to testing please',
      'done with memory for now',
      'switch back to the agent',
    ];
    for (const msg of positives) {
      it(`matches: "${msg}"`, () => {
        expect(isExplicitMemoryExit(msg)).toBe(true);
      });
    }
  });

  describe('negative — non-exit text must NOT match', () => {
    const negatives = [
      // Entry/admin phrases are not exits.
      'add a memory about the W trek',
      'remember that December is peak season',
      'what do you remember so far?',
      // Incidental uses of "back" / "testing" / "memory".
      'Can we go back to the pricing question?',
      'I was testing the booking flow earlier.',
      'That sunset is a core memory.',
      '',
      '   ',
    ];
    for (const msg of negatives) {
      it(`does not match: "${msg}"`, () => {
        expect(isExplicitMemoryExit(msg)).toBe(false);
      });
    }
  });

  it('is case-insensitive and whitespace-robust', () => {
    expect(isExplicitMemoryExit('EXIT MEMORY MODE')).toBe(true);
    expect(isExplicitMemoryExit('back    to   testing')).toBe(true);
  });
});
