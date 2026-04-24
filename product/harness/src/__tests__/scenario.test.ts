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
      assertions: [{ kind: 'tool_call', text: 'search' }],
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
