import { describe, expect, it, vi } from 'vitest';
import type { Runner } from '@google/adk';

import { createRunnerRegistry } from '../runner-registry.js';
import { modelAcceptsSamplingParams } from '../claude-llm.js';
import type { BuildAgentResult } from '../factory.js';

const DEFAULT_RUNNER = { __id: 'default' } as unknown as Runner;
const VARIANT_RUNNER = { __id: 'variant' } as unknown as Runner;
const FAKE_AGENT = { name: 'fake' } as unknown as BuildAgentResult['agent'];
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_THINKING = true;

function makeRegistry(opts: { modelEnabled?: boolean; thinkingEnabled?: boolean } = {}) {
  const buildAgentFor = vi.fn(
    async (_modelId: string, _thinkingEnabled: boolean): Promise<BuildAgentResult> => ({
      agent: FAKE_AGENT,
      skills: [],
    }),
  );
  const buildRunner = vi.fn((_agent: BuildAgentResult['agent']): Runner => VARIANT_RUNNER);
  const registry = createRunnerRegistry({
    defaultRunner: DEFAULT_RUNNER,
    defaultModelId: DEFAULT_MODEL,
    defaultThinking: DEFAULT_THINKING,
    modelOverridesEnabled: opts.modelEnabled ?? true,
    thinkingOverridesEnabled: opts.thinkingEnabled ?? true,
    allowlist: ['claude-opus-4-8', 'claude-sonnet-4-6'],
    buildAgentFor,
    buildRunner,
  });
  return { registry, buildAgentFor, buildRunner };
}

describe('createRunnerRegistry — model dimension (M-PICK)', () => {
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

  it('returns the default runner when model overrides are disabled, even for an allow-listed id', async () => {
    const { registry, buildAgentFor } = makeRegistry({ modelEnabled: false });
    expect(await registry.getRunner('claude-opus-4-8')).toBe(DEFAULT_RUNNER);
    expect(buildAgentFor).not.toHaveBeenCalled();
  });

  it('builds + returns a variant runner for an allow-listed id (thinking defaults)', async () => {
    const { registry, buildAgentFor, buildRunner } = makeRegistry();
    expect(await registry.getRunner('claude-opus-4-8')).toBe(VARIANT_RUNNER);
    expect(buildAgentFor).toHaveBeenCalledWith('claude-opus-4-8', DEFAULT_THINKING);
    expect(buildRunner).toHaveBeenCalledWith(FAKE_AGENT);
  });

  it('caches variant runners — builds once across concurrent + repeat calls', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    const [a, b] = await Promise.all([
      registry.getRunner('claude-opus-4-8'),
      registry.getRunner('claude-opus-4-8'),
    ]);
    const c = await registry.getRunner('claude-opus-4-8');
    expect(a).toBe(VARIANT_RUNNER);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(buildAgentFor).toHaveBeenCalledTimes(1);
  });
});

describe('createRunnerRegistry — thinking dimension (TT-1)', () => {
  it('builds a variant when thinking differs from the default (TT toggle off)', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    expect(await registry.getRunner(undefined, false)).toBe(VARIANT_RUNNER);
    expect(buildAgentFor).toHaveBeenCalledWith(DEFAULT_MODEL, false);
  });

  it('returns the default runner when the thinking override equals the default', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    expect(await registry.getRunner(undefined, DEFAULT_THINKING)).toBe(DEFAULT_RUNNER);
    expect(buildAgentFor).not.toHaveBeenCalled();
  });

  it('ignores the thinking override when thinking overrides are disabled (production)', async () => {
    const { registry, buildAgentFor } = makeRegistry({ thinkingEnabled: false });
    expect(await registry.getRunner(undefined, false)).toBe(DEFAULT_RUNNER);
    expect(buildAgentFor).not.toHaveBeenCalled();
  });

  it('composes model + thinking into one variant', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    expect(await registry.getRunner('claude-opus-4-8', false)).toBe(VARIANT_RUNNER);
    expect(buildAgentFor).toHaveBeenCalledWith('claude-opus-4-8', false);
  });

  it('keys the cache by (model, thinking) — distinct thinking → distinct build', async () => {
    const { registry, buildAgentFor } = makeRegistry();
    await registry.getRunner('claude-opus-4-8', true);
    await registry.getRunner('claude-opus-4-8', false);
    await registry.getRunner('claude-opus-4-8', false); // repeat → cached
    expect(buildAgentFor).toHaveBeenCalledTimes(2);
    expect(buildAgentFor).toHaveBeenNthCalledWith(1, 'claude-opus-4-8', true);
    expect(buildAgentFor).toHaveBeenNthCalledWith(2, 'claude-opus-4-8', false);
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
