import { describe, expect, it, vi } from 'vitest';
import type { Runner } from '@google/adk';

import { createRunnerRegistry } from '../runner-registry.js';
import { modelAcceptsSamplingParams } from '../claude-llm.js';
import type { BuildAgentResult } from '../factory.js';

const DEFAULT_RUNNER = { __id: 'default' } as unknown as Runner;
const PER_MODEL_RUNNER = { __id: 'per-model' } as unknown as Runner;
const FAKE_AGENT = { name: 'fake' } as unknown as BuildAgentResult['agent'];
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

function makeRegistry(opts: { enabled?: boolean } = {}) {
  const buildAgentFor = vi.fn(
    async (_modelId: string): Promise<BuildAgentResult> => ({ agent: FAKE_AGENT, skills: [] }),
  );
  const buildRunner = vi.fn((_agent: BuildAgentResult['agent']): Runner => PER_MODEL_RUNNER);
  const registry = createRunnerRegistry({
    defaultRunner: DEFAULT_RUNNER,
    defaultModelId: DEFAULT_MODEL,
    enabled: opts.enabled ?? true,
    allowlist: ['claude-opus-4-8', 'claude-sonnet-4-6'],
    buildAgentFor,
    buildRunner,
  });
  return { registry, buildAgentFor, buildRunner };
}

describe('createRunnerRegistry — gating', () => {
  it('returns the default runner when no override is supplied', async () => {
    const { registry, buildAgentFor, buildRunner } = makeRegistry();
    expect(await registry.getRunner(undefined)).toBe(DEFAULT_RUNNER);
    expect(buildAgentFor).not.toHaveBeenCalled();
    expect(buildRunner).not.toHaveBeenCalled();
  });

  it('returns the default runner when the override equals the default model', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    expect(await registry.getRunner(DEFAULT_MODEL)).toBe(DEFAULT_RUNNER);
    expect(buildAgentFor).not.toHaveBeenCalled();
  });

  it('returns the default runner for a non-allow-listed id (never builds)', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    expect(await registry.getRunner('claude-opus-4-7')).toBe(DEFAULT_RUNNER);
    expect(buildAgentFor).not.toHaveBeenCalled();
  });

  it('returns the default runner when the picker is disabled, even for an allow-listed id', async () => {
    const { registry, buildAgentFor } = makeRegistry({ enabled: false });
    expect(await registry.getRunner('claude-opus-4-8')).toBe(DEFAULT_RUNNER);
    expect(buildAgentFor).not.toHaveBeenCalled();
  });

  it('builds + returns a per-model runner for an allow-listed id', async () => {
    const { registry, buildAgentFor, buildRunner } = makeRegistry();
    expect(await registry.getRunner('claude-opus-4-8')).toBe(PER_MODEL_RUNNER);
    expect(buildAgentFor).toHaveBeenCalledWith('claude-opus-4-8');
    expect(buildRunner).toHaveBeenCalledWith(FAKE_AGENT);
  });

  it('caches per-model runners — builds once across concurrent + repeat calls', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    const [a, b] = await Promise.all([
      registry.getRunner('claude-opus-4-8'),
      registry.getRunner('claude-opus-4-8'),
    ]);
    const c = await registry.getRunner('claude-opus-4-8');
    expect(a).toBe(PER_MODEL_RUNNER);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(buildAgentFor).toHaveBeenCalledTimes(1);
  });
});

describe('modelAcceptsSamplingParams (the temperature-400 guard)', () => {
  it.each([
    ['claude-sonnet-4-5-20250929', true],
    ['claude-sonnet-4-6', true],
    ['claude-opus-4-6', true],
    ['claude-haiku-4-5', true],
    ['claude-opus-4-7', false],
    ['claude-opus-4-8', false],
    ['claude-opus-4-9', false], // forward-safe: opus minor >= 7
    ['claude-fable-5', false],
  ] as const)('%s -> %s', (id, expected) => {
    expect(modelAcceptsSamplingParams(id)).toBe(expected);
  });
});
