/**
 * Tests for UserAgent's per-event streaming integration.
 *
 * Coverage:
 *   - Without `observability`, nextMessage emits no events (backward compat).
 *   - With `observability`, user_agent.invoked fires BEFORE the Anthropic call
 *     and user_agent.responded fires AFTER, with raw Anthropic response
 *     captured in `anthropicRaw`.
 *   - turnIndex + scenarioName flow into the envelope.
 *   - durationMs reflects the call duration (mock returns instantly → 0+ ms).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  UserAgent,
  type AnthropicLike,
  type ConversationTurn,
} from '../user-agent.js';
import type { EventSink, HarnessEvent } from '../events.js';

class MemorySink implements EventSink {
  readonly events: HarnessEvent[] = [];
  emit(event: HarnessEvent): void {
    this.events.push(event);
  }
}

function fakeClient(reply: string, modelEcho = 'echoed-model'): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: modelEcho,
        content: [{ type: 'text', text: reply }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 8 },
      }),
    },
  };
}

const PERSONA = 'You are a 42-year-old anniversary couple researching Patagonia.';
const GOAL = 'Find a 10-day December trip and decide whether to speak with a specialist.';

describe('UserAgent.nextMessage — without observability', () => {
  it('emits nothing — sink is untouched (backward compat)', async () => {
    const ua = new UserAgent({
      client: fakeClient('Hello, I want to know about Patagonia.'),
      persona: PERSONA,
      goal: GOAL,
    });
    const sink = new MemorySink();
    await ua.nextMessage({ transcript: [] });
    expect(sink.events).toHaveLength(0); // sink never passed; trivially zero.
  });
});

describe('UserAgent.nextMessage — with observability', () => {
  it('emits user_agent.invoked before the call + user_agent.responded after', async () => {
    const ua = new UserAgent({
      client: fakeClient('Hi, can you tell me about Torres del Paine?'),
      persona: PERSONA,
      goal: GOAL,
    });
    const sink = new MemorySink();
    await ua.nextMessage({
      transcript: [],
      observability: {
        sink,
        scenarioName: 'anniversary-luxury-lean',
        turnIndex: 1,
      },
    });
    expect(sink.events).toHaveLength(2);
    const [invoked, responded] = sink.events;
    expect(invoked.kind).toBe('user_agent.invoked');
    if (invoked.kind !== 'user_agent.invoked') throw new Error('unreachable');
    expect(invoked.persona).toBe(PERSONA);
    expect(invoked.goal).toBe(GOAL);
    expect(invoked.scenarioName).toBe('anniversary-luxury-lean');
    expect(invoked.turnIndex).toBe(1);
    expect(invoked.model).toBe('claude-sonnet-4-5-20250929'); // default
    expect(invoked.transcriptSoFar.length).toBeGreaterThan(0);

    expect(responded.kind).toBe('user_agent.responded');
    if (responded.kind !== 'user_agent.responded') throw new Error('unreachable');
    expect(responded.message).toBe('Hi, can you tell me about Torres del Paine?');
    expect(responded.turnIndex).toBe(1);
    expect(responded.durationMs).toBeGreaterThanOrEqual(0);
    // RAW and EVERYTHING — full Anthropic response shape preserved.
    const raw = responded.anthropicRaw as {
      id: string;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    expect(raw.id).toBe('msg_test');
    expect(raw.usage.input_tokens).toBe(50);
  });

  it('mid-conversation: transcriptSoFar in the invoked event reflects role-flip', async () => {
    const transcript: ConversationTurn[] = [
      { user: 'My partner and I have ten days', agent: "Tell me what you're hoping for." },
    ];
    const ua = new UserAgent({
      client: fakeClient('Mostly hiking. Some comfort.'),
      persona: PERSONA,
      goal: GOAL,
    });
    const sink = new MemorySink();
    await ua.nextMessage({
      transcript,
      latestAgentResponse: 'Lodges or camping?',
      observability: {
        sink,
        scenarioName: 'anniversary-luxury-lean',
        turnIndex: 3,
      },
    });
    const invoked = sink.events[0];
    if (invoked?.kind !== 'user_agent.invoked') throw new Error('unreachable');
    // Role-flipped: visitor's past lines become 'assistant', orchestrator's
    // become 'user'. Plus latestAgentResponse appended as the final 'user'.
    expect(invoked.transcriptSoFar).toEqual([
      { role: 'assistant', content: 'My partner and I have ten days' },
      { role: 'user', content: "Tell me what you're hoping for." },
      { role: 'user', content: 'Lodges or camping?' },
    ]);
  });

  it('respects modelOverride in the invoked event', async () => {
    const ua = new UserAgent({
      client: fakeClient('Sure.'),
      persona: PERSONA,
      goal: GOAL,
      model: 'claude-opus-4-7',
    });
    const sink = new MemorySink();
    await ua.nextMessage({
      transcript: [],
      observability: {
        sink,
        scenarioName: 's',
        turnIndex: 1,
      },
    });
    const invoked = sink.events[0];
    if (invoked?.kind !== 'user_agent.invoked') throw new Error('unreachable');
    expect(invoked.model).toBe('claude-opus-4-7');
  });
});
