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
    expect(parsed.turns).toHaveLength(1);
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
});
