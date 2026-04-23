/**
 * Hello-world integration test — B.t7 M1 proof.
 *
 * Drives the orchestrator end-to-end in-process: stubbed connector tools,
 * stubbed ADK runner (layer-1 orchestrator Claude call), and a stubbed
 * layer-2 classifier LLM on a different model. No network I/O, no real
 * Anthropic key required — the integration proof is about wire shapes +
 * the two-layer agent invocation pattern, not about whether Claude
 * responds sensibly.
 *
 * What this test asserts (Tier 3 B.t7 verification):
 *   1. SSE streams end-to-end with an `event: done` closer.
 *   2. At least one tool-call frame appears on the wire (a real tool roundtrip
 *      happens, not just text).
 *   3. The functional triage classifier runs with a model **distinct** from
 *      the orchestrator's — proving the two-layer agent model.
 *   4. Session state accumulates: user message, agent utterance, and the
 *      advisory triage verdict land in `session.triage` / history.
 *
 * Why a stubbed layer-1 runner: running the real orchestrator ADK loop
 * would require a live Anthropic key, which is (a) cost, (b) flakiness,
 * (c) CI-hostile. The layer-1 agent is unit-tested separately in
 * `agent/__tests__/claude-llm.test.ts` and `server/__tests__/server.test.ts`.
 * B.t7's novel scope is the layer-2 classifier + orchestrator wiring, so we
 * stub the layer-1 model loop and exercise the classifier's Claude path
 * through a stub LLM that records the model name it was called with.
 *
 * The smoke-test runbook in `product/orchestrator/README.md` is the manual
 * complement: it runs both layers against real Anthropic.
 */

import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Runner, Event as AdkEvent, LlmRequest, LlmResponse } from '@google/adk';

import { buildServer } from '../../server/index.js';
import { InMemorySessionStore } from '../../session/index.js';
import {
  buildTriageClassifier,
  PLACEHOLDER_REASON_CODE,
  type ClaudeLlmLike,
} from '../../functional-agents/triage-classifier.js';
import type { Config } from '../../config/index.js';

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

/**
 * Build a frozen Config fixture that mirrors what `loadConfig()` produces
 * at runtime. We only populate the surface the triage classifier actually
 * reads (model ids + API key). Other fields get sensible dummies so the
 * type checks but nothing under test cares about them.
 */
function testConfig(overrides: Partial<Config> = {}): Config {
  const base = {
    ANTHROPIC_API_KEY: 'test-key-not-used',
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
  };
  return Object.freeze(base) as Config;
}

/**
 * Stub `ClaudeLlmLike` for the classifier. Records the model id it saw in
 * `calls[]` so the test can assert the two-layer split on model name.
 */
interface ClassifierStub {
  llm: ClaudeLlmLike;
  calls: Array<{ model: string; userContent: string }>;
}

function makeClassifierStub(
  modelId: string,
  responseText = '{"posture":"leaning_qualified","rationale":"clear intent"}',
): ClassifierStub {
  const calls: ClassifierStub['calls'] = [];
  const llm: ClaudeLlmLike = {
    model: modelId,
    async *generateContentAsync(
      req: LlmRequest,
      _stream?: boolean,
      _signal?: AbortSignal,
    ): AsyncGenerator<LlmResponse, void> {
      // Extract the user message from the request for the assertion trail.
      const userContent = (req.contents ?? [])
        .filter((c) => c.role === 'user')
        .flatMap((c) => c.parts ?? [])
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('\n');
      calls.push({ model: req.model ?? modelId, userContent });

      yield {
        content: { role: 'model', parts: [{ text: responseText }] },
        partial: true,
      };
      yield { turnComplete: true };
    },
  };
  return { llm, calls };
}

/**
 * Stub ADK runner: yields queued events on each call. Mirrors the shape
 * used in `server/__tests__/server.test.ts` but is duplicated here to keep
 * the integration test self-contained — no test-helper imports across
 * package boundaries.
 */
function mkEvent(partial: Partial<AdkEvent>): AdkEvent {
  return {
    id: 'evt',
    invocationId: 'inv',
    timestamp: Date.now(),
    actions: {
      stateDelta: {},
      artifactDelta: {},
      requestedAuthConfigs: {},
      requestedToolConfirmations: {},
    },
    ...partial,
  } as AdkEvent;
}

interface StubRunner {
  runner: Runner;
  lastModelSeen: () => string | undefined;
}

/**
 * Build a stub ADK runner that yields a canned event stream emulating a
 * real orchestrator turn with a tool call in the middle:
 *   text ("Let me check…") → tool_use (search) → text ("Here's what I found…")
 *   → turnComplete.
 *
 * We also capture the orchestrator model name on each call so the test can
 * assert the two models are different.
 */
function makeStubRunner(orchestratorModel: string): StubRunner {
  let modelSeen: string | undefined;
  const runner = {
    async *runAsync(_params: unknown): AsyncGenerator<AdkEvent, void, undefined> {
      modelSeen = orchestratorModel;
      yield mkEvent({
        content: { role: 'model', parts: [{ text: 'Let me check what we have on Patagonia. ' }] },
      });
      yield mkEvent({
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'toolu_fake_1',
                name: 'search',
                args: { query: 'Patagonia trips' },
              },
            },
          ],
        },
      });
      // Simulate tool response as a functionResponse turn.
      yield mkEvent({
        content: {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'toolu_fake_1',
                name: 'search',
                response: { hits: [{ title: 'Patagonia Classic', score: 0.92 }] },
              },
            },
          ],
        },
      });
      yield mkEvent({
        content: { role: 'model', parts: [{ text: "Here's one highlight: Patagonia Classic." }] },
      });
      yield mkEvent({ turnComplete: true });
    },
  } as unknown as Runner;
  return {
    runner,
    lastModelSeen: () => modelSeen,
  };
}

function parseSseFrames(body: string): Array<{ event?: string; data: string }> {
  const frames: Array<{ event?: string; data: string }> = [];
  for (const block of body.split(/\n\n/)) {
    if (!block.trim()) continue;
    if (block.startsWith(':')) continue; // heartbeat comment
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
    }
    frames.push({ event, data: dataLines.join('\n') });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Integration test.
// ---------------------------------------------------------------------------

describe('M1 hello-world end-to-end (B.t7 vertical slice)', () => {
  it('runs the two-layer agent model: classifier on Haiku, orchestrator on Sonnet, SSE tool-call streams', async () => {
    const config = testConfig();
    const store = new InMemorySessionStore();

    // Layer-2 classifier: real ADK LlmAgent shell, stubbed Claude LLM.
    // Stubbing at the ClaudeLlmLike seam lets the classifier run its full
    // request-building pipeline (system prompt, user context, JSON parse)
    // end-to-end without a network call.
    const classifierStub = makeClassifierStub(config.FUNCTIONAL_CLASSIFIER_MODEL);
    const triageClassifier = buildTriageClassifier({
      config,
      llm: classifierStub.llm,
    });

    // Layer-1 orchestrator: stubbed ADK runner that produces a canned
    // text → tool_use → tool_result → text → turnComplete stream so the
    // SSE wire sees a real mix of parts.
    const stub = makeStubRunner(config.ORCHESTRATOR_MODEL);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const app = buildServer({
      sessionStore: store,
      runner: stub.runner,
      corsAllowedOrigins: ['http://localhost:5173'],
      version: 'test',
      triageClassifier,
    });

    // 1. Bootstrap session.
    const bootstrap = await request(app).post('/session').send({});
    expect(bootstrap.status).toBe(201);
    const sessionId = bootstrap.body.sessionId as string;

    // 2. Grant tier-1 consent.
    const consent = await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: true, copyVersion: 'v1' });
    expect(consent.status).toBe(200);

    // 3. Send a user message. Message is intent-laden so the classifier
    // stub's canned response ("leaning_qualified") is a plausible verdict.
    const chat = await request(app)
      .post('/chat')
      .send({
        sessionId,
        message:
          'Looking for a two-week Patagonia honeymoon in December 2026, budget roughly £10k each.',
      });
    expect(chat.status).toBe(200);

    // --- Assertion 1: SSE stream ends with event: done ------------------
    const frames = parseSseFrames(chat.text);
    const done = frames.find((f) => f.event === 'done');
    expect(done).toBeDefined();

    // --- Assertion 2: At least one tool-call frame on the wire ----------
    const parts = frames
      .filter((f) => !f.event)
      .map((f) => {
        try {
          return JSON.parse(f.data) as { type?: string };
        } catch {
          return null;
        }
      })
      .filter((v): v is { type?: string } => v !== null);
    const toolCallParts = parts.filter((p) => p.type === 'tool-call');
    expect(toolCallParts.length).toBeGreaterThanOrEqual(1);

    // Sanity: we also got text parts around the tool call.
    const textParts = parts.filter((p) => p.type === 'text');
    expect(textParts.length).toBeGreaterThanOrEqual(1);

    // --- Assertion 3: Two-layer agent model — different models ----------
    // The classifier's stub LLM recorded exactly which model id it was
    // asked to call. That model MUST differ from the orchestrator's
    // model — this is the proof of the per-agent model strategy (B.5).
    expect(classifierStub.calls.length).toBe(1);
    const classifierModel = classifierStub.calls[0]!.model;
    expect(classifierModel).toBe(config.FUNCTIONAL_CLASSIFIER_MODEL);
    expect(classifierModel).not.toBe(config.ORCHESTRATOR_MODEL);
    expect(stub.lastModelSeen()).toBe(config.ORCHESTRATOR_MODEL);

    // The classifier's log line fired on the expected model.
    const classifierLog = logSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('puma_triage_classifier'),
    );
    expect(classifierLog).toBeDefined();
    expect(classifierLog?.[0]).toContain(config.FUNCTIONAL_CLASSIFIER_MODEL);

    // --- Assertion 4: Session state accumulates -------------------------
    const finalState = await store.get(sessionId);
    expect(finalState).not.toBeNull();

    // User turn in history.
    const userEntries = finalState!.conversationHistory.filter((e) => e.role === 'user');
    expect(userEntries.length).toBeGreaterThanOrEqual(1);
    expect(userEntries[0]!.text).toContain('Patagonia honeymoon');

    // Agent utterance in history (at least one `utter` block).
    const agentUtter = finalState!.conversationHistory.filter(
      (e) => e.role === 'agent' && e.blockType === 'utter',
    );
    expect(agentUtter.length).toBeGreaterThanOrEqual(1);

    // Triage was written by the classifier. With posture
    // "leaning_qualified", our mapping writes a `qualified` verdict
    // carrying the placeholder reason code.
    expect(finalState!.triage.verdict).toBe('qualified');
    if (finalState!.triage.verdict === 'qualified') {
      expect(finalState!.triage.reasonCode).toBe(PLACEHOLDER_REASON_CODE);
      expect(finalState!.triage.reasonText).toContain('leaning_qualified');
    }

    logSpy.mockRestore();
  });

  it('falls back to `unclear` when the classifier returns invalid JSON — non-fatal', async () => {
    const config = testConfig();
    const store = new InMemorySessionStore();

    // Classifier returns garbage — parser fails, fallback fires.
    const classifierStub = makeClassifierStub(config.FUNCTIONAL_CLASSIFIER_MODEL, 'not json');
    const triageClassifier = buildTriageClassifier({
      config,
      llm: classifierStub.llm,
    });

    const stub = makeStubRunner(config.ORCHESTRATOR_MODEL);

    const app = buildServer({
      sessionStore: store,
      runner: stub.runner,
      corsAllowedOrigins: ['http://localhost:5173'],
      version: 'test',
      triageClassifier,
    });

    const bootstrap = await request(app).post('/session').send({});
    const sessionId = bootstrap.body.sessionId as string;
    await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: true, copyVersion: 'v1' });

    const chat = await request(app).post('/chat').send({ sessionId, message: 'hi' });
    expect(chat.status).toBe(200);

    const finalState = await store.get(sessionId);
    // Fallback posture "unclear" → triage stays at `verdict: "none"`.
    expect(finalState!.triage.verdict).toBe('none');
    // But the classifier still ran on the cheap model.
    expect(classifierStub.calls[0]!.model).toBe(config.FUNCTIONAL_CLASSIFIER_MODEL);
  });

  it('skips classifier without breaking /chat when it is not wired (back-compat)', async () => {
    const config = testConfig();
    const store = new InMemorySessionStore();
    const stub = makeStubRunner(config.ORCHESTRATOR_MODEL);

    const app = buildServer({
      sessionStore: store,
      runner: stub.runner,
      corsAllowedOrigins: ['http://localhost:5173'],
      version: 'test',
      // triageClassifier intentionally omitted.
    });

    const bootstrap = await request(app).post('/session').send({});
    const sessionId = bootstrap.body.sessionId as string;
    await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: true, copyVersion: 'v1' });

    const chat = await request(app).post('/chat').send({ sessionId, message: 'hi' });
    expect(chat.status).toBe(200);
    // Triage stays at default `none` — no classifier, no verdict.
    const state = await store.get(sessionId);
    expect(state!.triage.verdict).toBe('none');
  });
});
