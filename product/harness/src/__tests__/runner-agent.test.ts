/**
 * Unit tests for the H.t8 agent-as-user runner codepath.
 *
 * Coverage:
 *   - Dispatch: userAgent scenarios call the agent runtime, not turns[].
 *   - MaxTurns hard cap: the runner stops at maxTurns even if shouldStop says
 *     keep going.
 *   - Early-stop: when shouldStop returns true, the runner terminates.
 *   - Error path: no agentRuntime supplied -> errored scenario, no crash.
 *
 * We mock the OrchestratorClient + agent runtime entirely — no real HTTP, no
 * real Anthropic. The aim is to verify the runner's wiring, not the SDK.
 */

import { describe, expect, it, vi } from 'vitest';
import { runScenario } from '../runner.js';
import type {
  AgentRuntimeFactory,
  ShouldStopFn,
  UserAgentLike,
} from '../runner.js';
import type { OrchestratorClient, AggregatedResponse } from '../orchestrator-client.js';
import { StubJudge } from '../judge.js';
import { ScenarioSchema, type Scenario } from '../scenario.js';
import type { LoadedScenario } from '../scenario.js';

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function makeAgentScenario(maxTurns: number = 4): LoadedScenario {
  const scenario: Scenario = ScenarioSchema.parse({
    name: 'agent-fixture',
    description: 'Test fixture for the agent-as-user runner codepath.',
    userAgent: {
      persona:
        'You are a 42-year-old testing the harness. You ask short questions.',
      goal: 'Verify the runner dispatches the agent codepath cleanly.',
      terminationCriteria: { maxTurns },
    },
    assertions: [],
  });
  return { file: '/fixtures/agent-fixture.yaml', scenario };
}

function makeAggregated(text: string): AggregatedResponse {
  return {
    utterText: text,
    toolCalls: [],
    structure: {
      utterPartCount: 1,
      fyiPartCount: 0,
      reasoningPartCount: 0,
      toolCallCount: 0,
    },
    rawParts: [],
  };
}

function fakeOrchestratorClient(): OrchestratorClient {
  return {
    createSession: vi
      .fn()
      .mockResolvedValue({
        sessionId: 'sess_test',
        disclosureCopyVersion: 'v1',
      }),
    grantConsent: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi
      .fn()
      .mockImplementation(
        async (_sessionId: string, userMessage: string): Promise<AggregatedResponse> =>
          makeAggregated(`agent reply to: ${userMessage}`),
      ),
  } as unknown as OrchestratorClient;
}

function fakeRuntime(
  options: {
    userMessages?: string[];
    stopAfter?: number; // 1-indexed turn at which shouldStop returns true
  } = {},
): {
  factory: AgentRuntimeFactory;
  userAgent: UserAgentLike & {
    nextMessage: ReturnType<typeof vi.fn>;
  };
  shouldStop: ReturnType<typeof vi.fn>;
} {
  const messages = options.userMessages ?? [
    'user 1',
    'user 2',
    'user 3',
    'user 4',
    'user 5',
    'user 6',
  ];
  let callIndex = 0;
  const nextMessage = vi.fn().mockImplementation(async () => {
    const msg = messages[callIndex] ?? `user ${callIndex + 1}`;
    callIndex += 1;
    return msg;
  });
  const userAgent: UserAgentLike & { nextMessage: typeof nextMessage } = {
    nextMessage,
  };
  let stopCallIndex = 0;
  const shouldStop = vi.fn(async (_req: Parameters<ShouldStopFn>[0]) => {
    stopCallIndex += 1;
    if (options.stopAfter !== undefined && stopCallIndex >= options.stopAfter)
      return true;
    return false;
  });
  const factory: AgentRuntimeFactory = {
    build: () => ({ userAgent, shouldStop }),
  };
  return { factory, userAgent, shouldStop };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('runScenario — agent-as-user dispatch', () => {
  it('routes userAgent scenarios through the agent codepath', async () => {
    const loaded = makeAgentScenario(2);
    const client = fakeOrchestratorClient();
    const { factory, userAgent } = fakeRuntime();
    const result = await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory,
    });
    expect(result.status).not.toBe('errored');
    expect(userAgent.nextMessage).toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenCalled();
  });

  it('hard-caps at maxTurns even when shouldStop never returns true', async () => {
    const loaded = makeAgentScenario(3);
    const client = fakeOrchestratorClient();
    const { factory, userAgent } = fakeRuntime();
    const result = await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory,
    });
    expect(result.turns).toHaveLength(3);
    expect(userAgent.nextMessage).toHaveBeenCalledTimes(3);
    expect(client.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('terminates early when shouldStop returns true', async () => {
    const loaded = makeAgentScenario(8);
    const client = fakeOrchestratorClient();
    // stopAfter=2 → shouldStop returns true on its 2nd call (after turn 2).
    const { factory, userAgent, shouldStop } = fakeRuntime({ stopAfter: 2 });
    const result = await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory,
    });
    expect(result.turns).toHaveLength(2);
    expect(userAgent.nextMessage).toHaveBeenCalledTimes(2);
    expect(shouldStop).toHaveBeenCalledTimes(2);
  });

  it('does not call shouldStop on the final turn (maxTurns reached)', async () => {
    const loaded = makeAgentScenario(2);
    const client = fakeOrchestratorClient();
    const { factory, shouldStop } = fakeRuntime();
    await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory,
    });
    // 2 turns total — shouldStop is called once (after turn 1), but not
    // after turn 2 because we hit the hard cap.
    expect(shouldStop).toHaveBeenCalledTimes(1);
  });

  it('errors cleanly when no agentRuntime is supplied', async () => {
    const loaded = makeAgentScenario(2);
    const client = fakeOrchestratorClient();
    const result = await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      // agentRuntime intentionally omitted
    });
    expect(result.status).toBe('errored');
    expect(result.error).toMatch(/agentRuntime/);
    // Orchestrator session was never created — we error before that.
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it('errors cleanly when the user-agent throws (e.g. refusal)', async () => {
    const loaded = makeAgentScenario(2);
    const client = fakeOrchestratorClient();
    const userAgent: UserAgentLike = {
      nextMessage: vi.fn().mockRejectedValue(new Error('persona refused')),
    };
    const shouldStop: ShouldStopFn = async () => false;
    const factory: AgentRuntimeFactory = {
      build: () => ({ userAgent, shouldStop }),
    };
    const result = await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory,
    });
    expect(result.status).toBe('errored');
    expect(result.error).toMatch(/persona refused/);
  });

  it('records user messages from the user-agent verbatim in turnResults', async () => {
    const loaded = makeAgentScenario(2);
    const client = fakeOrchestratorClient();
    const { factory } = fakeRuntime({
      userMessages: ['hello world', 'second turn here'],
    });
    const result = await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory,
    });
    expect(result.turns[0].user).toBe('hello world');
    expect(result.turns[1].user).toBe('second turn here');
  });

  it('passes the growing transcript to shouldStop', async () => {
    const loaded = makeAgentScenario(3);
    const client = fakeOrchestratorClient();
    const { factory, shouldStop } = fakeRuntime();
    await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory,
    });
    // shouldStop called after turn 1 and turn 2 (not after turn 3 — hard cap).
    expect(shouldStop).toHaveBeenCalledTimes(2);
    const firstCall = shouldStop.mock.calls[0][0];
    expect(firstCall.transcript).toHaveLength(0);
    expect(firstCall.latestAgentResponse).toContain('agent reply to:');
    const secondCall = shouldStop.mock.calls[1][0];
    expect(secondCall.transcript).toHaveLength(1);
  });
});

// Sanity: existing scripted path still routes correctly. We don't fully
// test it here (assertions.test + the orchestrator-client tests cover the
// scripted contract) — just verify dispatch.
describe('runScenario — scripted dispatch (sanity)', () => {
  it('routes scripted scenarios through the existing codepath', async () => {
    const scenario = ScenarioSchema.parse({
      name: 'scripted-sanity',
      description: 'Verify scripted scenarios still dispatch.',
      turns: [{ user: 'hi' }],
    });
    const loaded: LoadedScenario = {
      file: '/fixtures/scripted.yaml',
      scenario,
    };
    const client = fakeOrchestratorClient();
    const { factory, userAgent } = fakeRuntime();
    const result = await runScenario(loaded, {
      client,
      judge: new StubJudge(),
      agentRuntime: factory, // supplied but should not be touched
    });
    expect(result.status).toBe('passed');
    expect(client.sendMessage).toHaveBeenCalledWith('sess_test', 'hi');
    expect(userAgent.nextMessage).not.toHaveBeenCalled();
  });
});
