/**
 * Tests for runScenario's per-event streaming integration.
 *
 * Coverage:
 *   - Without `sink` in deps, runScenario emits no events (backward compat).
 *   - With `sink`, a scripted scenario emits in order:
 *     scenario.started → session.created → consent.granted →
 *     user.message.sent (per turn) → scenario.completed
 *   - An errored scenario emits scenario.started + error + scenario.completed
 *     (status: errored), with error stack preserved.
 *
 * Mocking strategy:
 *   - Fake OrchestratorClient + StubJudge + MemorySink — no Anthropic + no
 *     fetch needed for these lifecycle tests.
 */

import { describe, it, expect, vi } from 'vitest';

import { runScenario, type RunScenarioDeps } from '../runner.js';
import type { OrchestratorClient } from '../orchestrator-client.js';
import type { Judge } from '../judge.js';
import type { EventSink, HarnessEvent } from '../events.js';
import type { LoadedScenario } from '../scenario.js';

class MemorySink implements EventSink {
  readonly events: HarnessEvent[] = [];
  emit(event: HarnessEvent): void {
    this.events.push(event);
  }
}

const STUB_JUDGE: Judge = {
  async evaluate() {
    return { passed: true, reasoning: 'stub' };
  },
};

function fakeClient(opts: {
  sessionId?: string;
  disclosureCopyVersion?: string;
  agentReply?: string;
  sendThrows?: Error;
}): OrchestratorClient {
  return {
    createSession: vi.fn().mockResolvedValue({
      sessionId: opts.sessionId ?? 'sess_lifecycle',
      disclosureCopyVersion: opts.disclosureCopyVersion ?? 'copy_v1',
    }),
    grantConsent: vi.fn().mockResolvedValue(undefined),
    sendMessage: opts.sendThrows
      ? vi.fn().mockRejectedValue(opts.sendThrows)
      : vi.fn().mockResolvedValue({
          utterText: opts.agentReply ?? 'hello back',
          toolCalls: [],
          rawParts: [],
          structure: {
            utterPartCount: 1,
            fyiPartCount: 0,
            reasoningPartCount: 0,
            toolCallCount: 0,
          },
        }),
  } as unknown as OrchestratorClient;
}

function loadedScripted(name: string, turns: string[]): LoadedScenario {
  return {
    file: `/fake/scenarios/${name}.yaml`,
    scenario: {
      name,
      description: `${name} test`,
      turns: turns.map((u) => ({ user: u })),
      assertions: [],
      judge: null,
    },
  } as LoadedScenario;
}

// ---------------------------------------------------------------------------
// Lifecycle emit on scripted path.
// ---------------------------------------------------------------------------

describe('runScenario — scripted, with sink', () => {
  it('emits the full lifecycle event sequence in order', async () => {
    const sink = new MemorySink();
    const deps: RunScenarioDeps = {
      client: fakeClient({ sessionId: 'sess_X' }),
      judge: STUB_JUDGE,
      sink,
    };
    const result = await runScenario(
      loadedScripted('hello-flow', ['hi', 'second turn']),
      deps,
    );
    expect(result.status).toBe('passed');

    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'scenario.started',
      'session.created',
      'consent.granted',
      'user.message.sent',
      'user.message.sent',
      'scenario.completed',
    ]);

    // scenario.started carries the right shape + file + name.
    const started = sink.events[0];
    if (started.kind !== 'scenario.started') throw new Error('unreachable');
    expect(started.scenarioShape).toBe('scripted');
    expect(started.file).toBe('/fake/scenarios/hello-flow.yaml');
    expect(started.scenarioName).toBe('hello-flow');

    // session.created carries sessionId + disclosureCopyVersion.
    const session = sink.events[1];
    if (session.kind !== 'session.created') throw new Error('unreachable');
    expect(session.sessionId).toBe('sess_X');
    expect(session.disclosureCopyVersion).toBe('copy_v1');

    // user.message.sent events have turn-indexed envelopes + the right text.
    const t1 = sink.events[3];
    const t2 = sink.events[4];
    if (t1.kind !== 'user.message.sent') throw new Error('unreachable');
    if (t2.kind !== 'user.message.sent') throw new Error('unreachable');
    expect(t1.turnIndex).toBe(1);
    expect(t1.message).toBe('hi');
    expect(t2.turnIndex).toBe(2);
    expect(t2.message).toBe('second turn');

    // scenario.completed: status + duration + summary.
    const done = sink.events[5];
    if (done.kind !== 'scenario.completed') throw new Error('unreachable');
    expect(done.status).toBe('passed');
    expect(done.durationMs).toBeGreaterThanOrEqual(0);
    expect(done.summary).toContain('PASSED hello-flow');
  });

  it('propagates sink as ObservabilityContext into sendMessage', async () => {
    const sink = new MemorySink();
    const client = fakeClient({});
    const deps: RunScenarioDeps = {
      client,
      judge: STUB_JUDGE,
      sink,
    };
    await runScenario(loadedScripted('check-obs-prop', ['hi']), deps);

    expect(client.sendMessage).toHaveBeenCalledWith(
      'sess_lifecycle',
      'hi',
      expect.objectContaining({
        sink,
        scenarioName: 'check-obs-prop',
        turnIndex: 1,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Backward compat — no sink, no emits.
// ---------------------------------------------------------------------------

describe('runScenario — without sink (backward compat)', () => {
  it('emits nothing — the sink is never touched', async () => {
    const sink = new MemorySink();
    const deps: RunScenarioDeps = {
      client: fakeClient({}),
      judge: STUB_JUDGE,
      // no sink
    };
    await runScenario(loadedScripted('no-sink', ['hi']), deps);
    expect(sink.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Errored scenarios — error + completed events still emit.
// ---------------------------------------------------------------------------

describe('runScenario — error path', () => {
  it('emits scenario.started + error + scenario.completed(errored) when sendMessage throws', async () => {
    const sink = new MemorySink();
    const boom = new Error('boom from mock');
    const deps: RunScenarioDeps = {
      client: fakeClient({ sendThrows: boom }),
      judge: STUB_JUDGE,
      sink,
    };
    const result = await runScenario(loadedScripted('explody', ['hi']), deps);
    expect(result.status).toBe('errored');

    const kinds = sink.events.map((e) => e.kind);
    // Lifecycle: started → session.created → consent.granted → user.message.sent
    // → error → scenario.completed(errored).
    expect(kinds).toContain('error');
    expect(kinds[kinds.length - 1]).toBe('scenario.completed');

    const err = sink.events.find((e) => e.kind === 'error');
    if (err?.kind !== 'error') throw new Error('unreachable');
    expect(err.message).toContain('boom from mock');
    expect(err.phase).toBe('runScenario');
    // Stack is preserved (Error instance gives us .stack).
    expect(err.stack).toBeDefined();

    const done = sink.events[sink.events.length - 1];
    if (done?.kind !== 'scenario.completed') throw new Error('unreachable');
    expect(done.status).toBe('errored');
    expect(done.summary).toContain('ERROR explody');
  });
});
