/**
 * Unit tests for the scenario loader + schema.
 *
 * Validates the Zod contract against fixture strings parsed through the YAML
 * loader's Zod-validation step. We don't round-trip through the filesystem
 * here — that's `loadScenarios`'s job and is exercised implicitly by the CLI.
 */

import { describe, expect, it } from 'vitest';
import { ScenarioSchema } from '../scenario.js';

describe('ScenarioSchema', () => {
  it('accepts a minimal valid scenario with assertions', () => {
    const parsed = ScenarioSchema.parse({
      name: 'greeting',
      description: 'Agent greets back warmly.',
      turns: [{ user: 'hi' }],
      assertions: [{ kind: 'contains', text: 'hi' }],
    });
    expect(parsed.name).toBe('greeting');
    if ('turns' in parsed) {
      expect(parsed.turns).toHaveLength(1);
    } else {
      throw new Error('expected scripted scenario');
    }
    expect(parsed.assertions).toHaveLength(1);
    expect(parsed.judge).toBeNull();
  });

  it('defaults assertions to [] when omitted', () => {
    const parsed = ScenarioSchema.parse({
      name: 'stub',
      description: 'Stub scenario — no assertions yet.',
      turns: [{ user: 'say something' }],
    });
    expect(parsed.assertions).toEqual([]);
    expect(parsed.judge).toBeNull();
  });

  it('rejects unknown top-level keys (strict mode)', () => {
    const result = ScenarioSchema.safeParse({
      name: 'oops',
      description: 'extra key',
      turns: [{ user: 'hi' }],
      assertions: [],
      unknownExtra: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty turns[]', () => {
    const result = ScenarioSchema.safeParse({
      name: 'oops',
      description: 'no turns',
      turns: [],
      assertions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown assertion kinds', () => {
    const result = ScenarioSchema.safeParse({
      name: 'oops',
      description: 'bad kind',
      turns: [{ user: 'hi' }],
      assertions: [{ kind: 'made_up_kind', text: 'search' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts the H.t3 tool_call assertion', () => {
    const parsed = ScenarioSchema.parse({
      name: 'tool-call-shape',
      description: 'Verify schema accepts tool_call.',
      turns: [{ user: 'show me options' }],
      assertions: [
        {
          kind: 'tool_call',
          toolName: 'lookup',
          atTurn: 1,
          argsContains: { activity: 'hiking' },
        },
      ],
    });
    expect(parsed.assertions).toHaveLength(1);
    expect(parsed.assertions[0].kind).toBe('tool_call');
  });

  it('accepts the H.t3 triage_verdict assertion', () => {
    const parsed = ScenarioSchema.parse({
      name: 'triage-shape',
      description: 'Verify schema accepts triage_verdict.',
      turns: [{ user: 'hi' }],
      assertions: [
        {
          kind: 'triage_verdict',
          verdict: 'qualified',
          reasonCode: 'group_tour_intent',
        },
      ],
    });
    expect(parsed.assertions[0].kind).toBe('triage_verdict');
  });

  it('accepts the H.t3 handoff_event assertion (defaulting present:true)', () => {
    const parsed = ScenarioSchema.parse({
      name: 'handoff-shape',
      description: 'Verify schema accepts handoff_event.',
      turns: [{ user: 'hi' }],
      assertions: [{ kind: 'handoff_event', verdict: 'qualified' }],
    });
    const a = parsed.assertions[0];
    expect(a.kind).toBe('handoff_event');
    if (a.kind === 'handoff_event') {
      expect(a.present).toBe(true);
    }
  });

  it('accepts the H.t3 disclosure_event assertion', () => {
    const parsed = ScenarioSchema.parse({
      name: 'disclosure-shape',
      description: 'Verify schema accepts disclosure_event.',
      turns: [{ user: 'hi' }],
      assertions: [{ kind: 'disclosure_event', present: true }],
    });
    expect(parsed.assertions[0].kind).toBe('disclosure_event');
  });

  it('accepts the H.t3 response_format assertion', () => {
    const parsed = ScenarioSchema.parse({
      name: 'response-format-shape',
      description: 'Verify schema accepts response_format.',
      turns: [{ user: 'hi' }],
      assertions: [
        {
          kind: 'response_format',
          hasUtter: true,
          hasReasoning: false,
          fyiCount: { min: 0, max: 5 },
        },
      ],
    });
    expect(parsed.assertions[0].kind).toBe('response_format');
  });

  it('rejects a response_format assertion with no fields set', () => {
    const result = ScenarioSchema.safeParse({
      name: 'oops',
      description: 'empty response_format',
      turns: [{ user: 'hi' }],
      assertions: [{ kind: 'response_format' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts the H.t3 judge_rubric assertion', () => {
    const parsed = ScenarioSchema.parse({
      name: 'judge-shape',
      description: 'Verify schema accepts judge_rubric.',
      turns: [{ user: 'hi' }],
      assertions: [
        { kind: 'judge_rubric', rubric: 'Is this on-brand?' },
      ],
    });
    expect(parsed.assertions[0].kind).toBe('judge_rubric');
  });

  it('rejects unknown keys on a tool_call assertion (strict)', () => {
    const result = ScenarioSchema.safeParse({
      name: 'oops',
      description: 'extra key',
      turns: [{ user: 'hi' }],
      assertions: [
        { kind: 'tool_call', toolName: 'lookup', extraKey: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a judge block', () => {
    const parsed = ScenarioSchema.parse({
      name: 'judged',
      description: 'Judge-rated scenario (scaffold: stub only).',
      turns: [{ user: 'hi' }],
      assertions: [],
      judge: { rubric: 'Was the response warm?' },
    });
    expect(parsed.judge).toMatchObject({ rubric: 'Was the response warm?' });
  });

  // -------------------------------------------------------------------------
  // H.t8 — agent-as-user variant.
  // -------------------------------------------------------------------------

  describe('userAgent variant (H.t8)', () => {
    const validPersona =
      'You are a 42-year-old office professional planning a 10th anniversary trip ' +
      'to Patagonia. You prefer lodges over camping, ask clarifying questions, and ' +
      'are open to surprise but cautious about commitments.';
    const validGoal =
      'Find out what a 10-day Patagonia trip in December could look like and ' +
      'decide whether to speak with a specialist.';

    it('accepts a userAgent scenario (no turns)', () => {
      const parsed = ScenarioSchema.parse({
        name: 'anniversary-couple-agent',
        description: '40-something couple celebrating 10 years (agent-driven).',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: {
            maxTurns: 8,
            stopWhen: ['handoff form appears', 'you have everything you need'],
          },
        },
        assertions: [{ kind: 'triage_verdict', verdict: 'qualified' }],
      });
      expect('userAgent' in parsed).toBe(true);
      if ('userAgent' in parsed) {
        expect(parsed.userAgent.persona).toContain('42-year-old');
        expect(parsed.userAgent.terminationCriteria.maxTurns).toBe(8);
      }
    });

    it('defaults terminationCriteria.maxTurns to 8 when omitted', () => {
      const parsed = ScenarioSchema.parse({
        name: 'defaulted-max-turns',
        description: 'Verifies maxTurns default behaviour.',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: {},
        },
      });
      if ('userAgent' in parsed) {
        expect(parsed.userAgent.terminationCriteria.maxTurns).toBe(8);
      }
    });

    it('accepts userAgent with an optional modelOverride', () => {
      const parsed = ScenarioSchema.parse({
        name: 'with-model-override',
        description: 'Per-scenario model override.',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: { maxTurns: 4 },
          modelOverride: 'claude-haiku-4-5-20251001',
        },
      });
      if ('userAgent' in parsed) {
        expect(parsed.userAgent.modelOverride).toBe(
          'claude-haiku-4-5-20251001',
        );
      }
    });

    it('preserves backwards-compat: turns-only scenarios still parse', () => {
      const parsed = ScenarioSchema.parse({
        name: 'still-scripted',
        description: 'Pre-H.t8 scripted scenario still loads.',
        turns: [{ user: 'hello' }],
        assertions: [{ kind: 'contains', text: 'hello' }],
      });
      expect('turns' in parsed).toBe(true);
      if ('turns' in parsed) {
        expect(parsed.turns).toHaveLength(1);
      }
    });

    it('rejects a scenario containing BOTH turns and userAgent (ambiguous)', () => {
      const result = ScenarioSchema.safeParse({
        name: 'ambiguous',
        description: 'Cannot have both shapes.',
        turns: [{ user: 'hi' }],
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: { maxTurns: 4 },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a scenario containing NEITHER turns nor userAgent', () => {
      const result = ScenarioSchema.safeParse({
        name: 'neither',
        description: 'Must have one shape.',
        assertions: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects terminationCriteria.maxTurns below 1', () => {
      const result = ScenarioSchema.safeParse({
        name: 'too-few-turns',
        description: 'maxTurns must be >= 1.',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: { maxTurns: 0 },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects terminationCriteria.maxTurns above 20', () => {
      const result = ScenarioSchema.safeParse({
        name: 'too-many-turns',
        description: 'maxTurns must be <= 20.',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: { maxTurns: 21 },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects too-short persona', () => {
      const result = ScenarioSchema.safeParse({
        name: 'short-persona',
        description: 'Persona must clear the minimum length.',
        userAgent: {
          persona: 'too short',
          goal: validGoal,
          terminationCriteria: { maxTurns: 4 },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects too-short goal', () => {
      const result = ScenarioSchema.safeParse({
        name: 'short-goal',
        description: 'Goal must clear the minimum length.',
        userAgent: {
          persona: validPersona,
          goal: 'short',
          terminationCriteria: { maxTurns: 4 },
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown keys on userAgent block (strict)', () => {
      const result = ScenarioSchema.safeParse({
        name: 'extra-keys',
        description: 'Strict mode catches typos.',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: { maxTurns: 4 },
          extraKey: 'whoops',
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown keys on terminationCriteria (strict)', () => {
      const result = ScenarioSchema.safeParse({
        name: 'extra-criteria-key',
        description: 'Strict mode catches typos.',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: { maxTurns: 4, unknownKey: true },
        },
      });
      expect(result.success).toBe(false);
    });

    it('accepts userAgent without optional stopWhen', () => {
      const parsed = ScenarioSchema.parse({
        name: 'no-stop-when',
        description: 'stopWhen is optional.',
        userAgent: {
          persona: validPersona,
          goal: validGoal,
          terminationCriteria: { maxTurns: 6 },
        },
      });
      if ('userAgent' in parsed) {
        expect(parsed.userAgent.terminationCriteria.stopWhen).toBeUndefined();
      }
    });
  });
});
