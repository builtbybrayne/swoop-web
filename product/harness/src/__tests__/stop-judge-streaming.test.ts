/**
 * Tests for stop-judge's per-event streaming integration.
 *
 * Coverage:
 *   - Without observability, no events emitted (backward compat).
 *   - With observability + YES verdict: stop_judge.invoked + stop_judge.responded
 *     (shouldStop=true) fire in order, anthropicRaw captured.
 *   - With observability + NO verdict: same shape, shouldStop=false.
 *   - With observability + malformed verdict: stop_judge.responded still
 *     emits (shouldStop=false, anthropicRaw captured) before the throw.
 */

import { describe, it, expect, vi } from 'vitest';

import { shouldStop, type AnthropicLike } from '../stop-judge.js';
import type { EventSink, HarnessEvent } from '../events.js';
import type { TerminationCriteria } from '../scenario.js';

class MemorySink implements EventSink {
  readonly events: HarnessEvent[] = [];
  emit(event: HarnessEvent): void {
    this.events.push(event);
  }
}

function fakeClient(replyText: string): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        id: 'msg_stop',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: replyText }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 120, output_tokens: 1 },
      }),
    },
  };
}

const PERSONA = 'A 42yo office professional planning Patagonia.';
const GOAL = 'Decide whether to speak with a specialist.';
const CRITERIA: TerminationCriteria = {
  maxTurns: 8,
  stopWhen: ['handoff form appears', "you've decided"],
};

describe('shouldStop — without observability (backward compat)', () => {
  it('returns YES result without emitting any events', async () => {
    const result = await shouldStop({
      client: fakeClient('YES'),
      persona: PERSONA,
      goal: GOAL,
      terminationCriteria: CRITERIA,
      transcript: [],
      latestAgentResponse: 'The handoff form has just appeared.',
    });
    expect(result).toBe(true);
  });
});

describe('shouldStop — with observability', () => {
  it('YES path: emits invoked + responded(shouldStop=true)', async () => {
    const sink = new MemorySink();
    const result = await shouldStop({
      client: fakeClient('YES'),
      persona: PERSONA,
      goal: GOAL,
      terminationCriteria: CRITERIA,
      transcript: [],
      latestAgentResponse: 'Handoff form is open.',
      observability: { sink, scenarioName: 'scn', turnIndex: 4 },
    });
    expect(result).toBe(true);
    expect(sink.events).toHaveLength(2);
    const [invoked, responded] = sink.events;
    expect(invoked.kind).toBe('stop_judge.invoked');
    if (invoked.kind !== 'stop_judge.invoked') throw new Error('unreachable');
    expect(invoked.turnIndex).toBe(4);
    expect(invoked.latestAgentResponse).toBe('Handoff form is open.');
    expect(invoked.model).toBe('claude-haiku-4-5-20251001');

    expect(responded.kind).toBe('stop_judge.responded');
    if (responded.kind !== 'stop_judge.responded') throw new Error('unreachable');
    expect(responded.shouldStop).toBe(true);
    expect(responded.durationMs).toBeGreaterThanOrEqual(0);
    const raw = responded.anthropicRaw as { id: string };
    expect(raw.id).toBe('msg_stop');
  });

  it('NO path: emits invoked + responded(shouldStop=false)', async () => {
    const sink = new MemorySink();
    const result = await shouldStop({
      client: fakeClient('NO'),
      persona: PERSONA,
      goal: GOAL,
      terminationCriteria: CRITERIA,
      transcript: [],
      latestAgentResponse: "We're still exploring options.",
      observability: { sink, scenarioName: 'scn', turnIndex: 2 },
    });
    expect(result).toBe(false);
    const responded = sink.events[1];
    if (responded?.kind !== 'stop_judge.responded') throw new Error('unreachable');
    expect(responded.shouldStop).toBe(false);
  });

  it('malformed verdict: emits responded(shouldStop=false) before throwing', async () => {
    const sink = new MemorySink();
    await expect(
      shouldStop({
        client: fakeClient('Maybe?'),
        persona: PERSONA,
        goal: GOAL,
        terminationCriteria: CRITERIA,
        transcript: [],
        latestAgentResponse: 'Hmm.',
        observability: { sink, scenarioName: 'scn', turnIndex: 1 },
      }),
    ).rejects.toThrow(/unexpected response/);

    // Both events emitted before the throw — the JSONL is durable.
    expect(sink.events).toHaveLength(2);
    const responded = sink.events[1];
    if (responded?.kind !== 'stop_judge.responded') throw new Error('unreachable');
    expect(responded.shouldStop).toBe(false);
    const raw = responded.anthropicRaw as {
      content: Array<{ type: string; text?: string }>;
    };
    expect(raw.content[0].text).toBe('Maybe?');
  });
});
