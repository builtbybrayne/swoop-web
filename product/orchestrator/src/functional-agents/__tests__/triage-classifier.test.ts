/**
 * Unit tests for the B.t7 triage classifier.
 *
 * Focus areas:
 *   1. `buildTriageClassifier` consumes `getModelFor(config, 'classifier')`,
 *      not the orchestrator's model — the two-layer proof at the unit level.
 *   2. The JSON-output parser is lenient on fence wrappers and stray prose.
 *   3. `applyTriageVerdict` maps postures → discriminated union correctly.
 *   4. Unknown posture / empty response / error envelope all produce a
 *      non-fatal `unclear` fallback that keeps `triage.verdict = "none"`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LlmRequest, LlmResponse } from '@google/adk';
import type { SessionState } from '@swoop/common';

import {
  buildTriageClassifier,
  applyTriageVerdict,
  PLACEHOLDER_REASON_CODE,
  type ClaudeLlmLike,
  type ClassifyResult,
} from '../triage-classifier.js';
import type { Config } from '../../config/index.js';

function testConfig(overrides: Partial<Config> = {}): Config {
  return Object.freeze({
    ANTHROPIC_API_KEY: 'test-key',
    ORCHESTRATOR_MODEL: 'claude-sonnet-4-5-20250929',
    ORCHESTRATOR_TEMPERATURE: 0.7,
    ORCHESTRATOR_MAX_TOKENS: 2048,
    FUNCTIONAL_CLASSIFIER_MODEL: 'claude-haiku-4-5-20251001',
    FUNCTIONAL_CLASSIFIER_TEMPERATURE: 0.2,
    SYSTEM_PROMPT_PATH: '../cms/prompts/why.md',
    SKILLS_DIR: '../cms/skills',
    SESSION_BACKEND: 'in-memory' as const,
    SESSION_TTL_IDLE_HOURS: 24,
    SESSION_TTL_ARCHIVE_DAYS: 7,
    CONNECTOR_URL: 'http://localhost:3001/mcp',
    CONNECTOR_REQUEST_TIMEOUT_MS: 10_000,
    PORT: 8080,
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'] as readonly string[],
    WARM_POOL_SIZE: 0,
    WARM_POOL_TTL_MINUTES: 30,
    PRIMARY_MODEL: 'claude-sonnet-4-5-20250929',
    packageRoot: '/tmp/test',
    systemPromptAbsolutePath: '/tmp/test/cms/prompts/why.md',
    skillsDirAbsolutePath: '/tmp/test/cms/skills',
    isProduction: false,
    ...overrides,
  }) as Config;
}

function makeLlm(responseText: string): {
  llm: ClaudeLlmLike;
  captured: { req?: LlmRequest };
} {
  const captured: { req?: LlmRequest } = {};
  return {
    captured,
    llm: {
      model: 'claude-haiku-4-5-20251001',
      async *generateContentAsync(req: LlmRequest): AsyncGenerator<LlmResponse, void> {
        captured.req = req;
        yield {
          content: { role: 'model', parts: [{ text: responseText }] },
          partial: true,
        };
        yield { turnComplete: true };
      },
    },
  };
}

function blankSession(): SessionState {
  const now = new Date('2026-04-22T12:00:00Z').toISOString();
  return {
    sessionId: 'test-session',
    createdAt: now,
    updatedAt: now,
    conversationHistory: [],
    triage: { verdict: 'none' },
    wishlist: { items: [] },
    consent: {
      conversation: { granted: true, timestamp: now, copyVersion: 'v1' },
      handoff: { granted: false, timestamp: now },
    },
    metadata: {},
  };
}

describe('buildTriageClassifier', () => {
  it('resolves its model from getModelFor("classifier"), not the orchestrator', () => {
    const config = testConfig();
    const { llm } = makeLlm('{}');
    const classifier = buildTriageClassifier({ config, llm });
    expect(classifier.modelId).toBe(config.FUNCTIONAL_CLASSIFIER_MODEL);
    expect(classifier.modelId).not.toBe(config.ORCHESTRATOR_MODEL);
  });

  it('sends system prompt + user content containing the current message', async () => {
    const config = testConfig();
    const { llm, captured } = makeLlm(
      '{"posture":"leaning_qualified","rationale":"explicit budget and dates"}',
    );
    const classifier = buildTriageClassifier({ config, llm });
    const result = await classifier.classify(
      'Honeymoon Patagonia Dec 2026, £10k budget each',
      blankSession(),
    );
    expect(result.posture).toBe('leaning_qualified');
    expect(result.modelUsed).toBe(config.FUNCTIONAL_CLASSIFIER_MODEL);

    // System prompt was delivered (as a system-role Content).
    const sysContent = (captured.req?.contents ?? []).find((c) => c.role === 'system');
    expect(sysContent).toBeDefined();
    const userContent = (captured.req?.contents ?? []).find((c) => c.role === 'user');
    const userText = userContent?.parts?.[0]?.text ?? '';
    expect(userText).toContain('Honeymoon Patagonia');
  });

  it('includes up to two prior user turns as context', async () => {
    const config = testConfig();
    const { llm, captured } = makeLlm('{"posture":"unclear","rationale":"n/a"}');
    const classifier = buildTriageClassifier({ config, llm });
    const session = blankSession();
    const ts = '2026-04-22T12:00:00.000Z';
    session.conversationHistory.push(
      { turnIndex: 0, role: 'user', blockType: 'user_message', text: 'first msg', timestamp: ts },
      { turnIndex: 1, role: 'user', blockType: 'user_message', text: 'second msg', timestamp: ts },
      { turnIndex: 2, role: 'user', blockType: 'user_message', text: 'third msg', timestamp: ts },
    );
    await classifier.classify('new msg', session);
    const userText = (captured.req?.contents ?? []).find((c) => c.role === 'user')?.parts?.[0]
      ?.text;
    // Only the two most recent prior turns should appear (slice(-2)).
    expect(userText).toContain('second msg');
    expect(userText).toContain('third msg');
    expect(userText).not.toContain('first msg');
    expect(userText).toContain('new msg');
  });

  it('parses code-fenced JSON output', async () => {
    const config = testConfig();
    const { llm } = makeLlm(
      '```json\n{"posture":"leaning_backpacker","rationale":"budget"}\n```',
    );
    const classifier = buildTriageClassifier({ config, llm });
    const result = await classifier.classify('cheapest way to see Patagonia?', blankSession());
    expect(result.posture).toBe('leaning_backpacker');
  });

  it('extracts the first JSON object when the model wraps it in prose', async () => {
    const config = testConfig();
    const { llm } = makeLlm(
      'Sure! Here is the JSON: {"posture":"leaning_low_value","rationale":"vague"} — hope this helps.',
    );
    const classifier = buildTriageClassifier({ config, llm });
    const result = await classifier.classify('just browsing', blankSession());
    expect(result.posture).toBe('leaning_low_value');
  });

  it('falls back to `unclear` for unknown posture labels', async () => {
    const config = testConfig();
    const { llm } = makeLlm('{"posture":"gibberish","rationale":"x"}');
    const classifier = buildTriageClassifier({ config, llm });
    const result = await classifier.classify('hello', blankSession());
    expect(result.posture).toBe('unclear');
    expect(result.rationale).toBe('fallback:classifier_parse_failed');
  });

  it('falls back to `unclear` when the classifier surfaces an error envelope', async () => {
    const config = testConfig();
    const llm: ClaudeLlmLike = {
      model: config.FUNCTIONAL_CLASSIFIER_MODEL,
      async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
        yield { errorCode: '500', errorMessage: 'upstream failure', turnComplete: true };
      },
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const classifier = buildTriageClassifier({ config, llm });
    const result = await classifier.classify('hi', blankSession());
    expect(result.posture).toBe('unclear');
    expect(result.rationale).toBe('fallback:classifier_error');
    warnSpy.mockRestore();
  });

  it('ignores thought parts in the streamed response', async () => {
    const config = testConfig();
    const llm: ClaudeLlmLike = {
      model: config.FUNCTIONAL_CLASSIFIER_MODEL,
      async *generateContentAsync(): AsyncGenerator<LlmResponse, void> {
        yield {
          content: { role: 'model', parts: [{ text: 'thinking privately', thought: true }] },
          partial: true,
        };
        yield {
          content: {
            role: 'model',
            parts: [{ text: '{"posture":"unclear","rationale":"ok"}' }],
          },
          partial: true,
        };
        yield { turnComplete: true };
      },
    };
    const classifier = buildTriageClassifier({ config, llm });
    const result = await classifier.classify('hi', blankSession());
    // Parser should NOT see "thinking privately" — that would break JSON.
    expect(result.posture).toBe('unclear');
  });
});

describe('applyTriageVerdict', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  function runMap(posture: ClassifyResult['posture']): SessionState {
    return applyTriageVerdict({
      session: blankSession(),
      result: {
        posture,
        rationale: 'test',
        modelUsed: 'claude-haiku-4-5-20251001',
      },
      now,
    });
  }

  it('leaning_qualified → verdict:"qualified" with placeholder reason', () => {
    const out = runMap('leaning_qualified');
    expect(out.triage.verdict).toBe('qualified');
    if (out.triage.verdict === 'qualified') {
      expect(out.triage.reasonCode).toBe(PLACEHOLDER_REASON_CODE);
      expect(out.triage.reasonText).toContain('leaning_qualified');
      expect(out.triage.decidedAt).toBe(now.toISOString());
    }
  });

  it('leaning_backpacker → verdict:"referred_out"', () => {
    const out = runMap('leaning_backpacker');
    expect(out.triage.verdict).toBe('referred_out');
  });

  it('leaning_low_value → verdict:"disqualified"', () => {
    const out = runMap('leaning_low_value');
    expect(out.triage.verdict).toBe('disqualified');
  });

  it('unclear → verdict:"none" (no reasonCode, no decidedAt)', () => {
    const out = runMap('unclear');
    expect(out.triage.verdict).toBe('none');
  });
});
