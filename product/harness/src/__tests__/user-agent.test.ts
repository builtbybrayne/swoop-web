/**
 * Unit tests for the H.t8 user-agent roleplay LLM.
 *
 * Coverage:
 *   - buildSystemPrompt — persona + goal both reach the prompt verbatim.
 *   - buildMessages — first-turn opener; mid-conversation role-flip.
 *   - UserAgent.nextMessage — mocks Anthropic; verifies prompt construction
 *     + parsing of the model's text-block output.
 *   - Empty-response guard — refusals surface as errors.
 *
 * All tests use the `AnthropicLike` fake injected at construction; no real
 * API calls.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildMessages,
  buildSystemPrompt,
  DEFAULT_USER_AGENT_MODEL,
  UserAgent,
  type AnthropicLike,
  type ConversationTurn,
} from '../user-agent.js';

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const PERSONA =
  'You are a 42-year-old office professional planning a 10th anniversary ' +
  'trip to Patagonia. Lodges over camping; warm but cautious; ask clarifying ' +
  'questions.';
const GOAL =
  'Find out what a 10-day Patagonia trip in December could look like and ' +
  'decide whether to speak with a specialist.';

function fakeClient(
  reply: string | { content: ReadonlyArray<{ type: string; text?: string }> },
): AnthropicLike {
  const content =
    typeof reply === 'string' ? [{ type: 'text', text: reply }] : reply.content;
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content }),
    },
  };
}

// ---------------------------------------------------------------------------
// buildSystemPrompt.
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('embeds the persona and goal verbatim', () => {
    const sys = buildSystemPrompt(PERSONA, GOAL);
    expect(sys).toContain(PERSONA);
    expect(sys).toContain(GOAL);
  });

  it('instructs the model to stay in character and output only the message', () => {
    const sys = buildSystemPrompt(PERSONA, GOAL);
    expect(sys.toLowerCase()).toContain('roleplay');
    expect(sys.toLowerCase()).toContain('stay in character');
    expect(sys.toLowerCase()).toContain('only the message');
  });
});

// ---------------------------------------------------------------------------
// buildMessages — role-flip semantics.
// ---------------------------------------------------------------------------

describe('buildMessages — first turn (empty transcript)', () => {
  it('seeds a single user-role primer when the transcript is empty', () => {
    const msgs = buildMessages([], undefined);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content.toLowerCase()).toContain('first');
  });
});

describe('buildMessages — mid-conversation (role-flipped)', () => {
  it('maps prior user-side messages to assistant role + agent replies to user role', () => {
    const transcript: ConversationTurn[] = [
      { user: 'Hi, I want to go to Patagonia.', agent: 'How exciting! When?' },
      { user: 'December, 10 days.', agent: 'Lovely. Self-guided or led?' },
    ];
    const msgs = buildMessages(transcript, 'And what about activity level?');
    // 2 turns × 2 messages each + 1 latest = 5
    expect(msgs).toHaveLength(5);
    expect(msgs[0]).toEqual({
      role: 'assistant',
      content: 'Hi, I want to go to Patagonia.',
    });
    expect(msgs[1]).toEqual({
      role: 'user',
      content: 'How exciting! When?',
    });
    expect(msgs[2]).toEqual({
      role: 'assistant',
      content: 'December, 10 days.',
    });
    expect(msgs[3]).toEqual({
      role: 'user',
      content: 'Lovely. Self-guided or led?',
    });
    expect(msgs[4]).toEqual({
      role: 'user',
      content: 'And what about activity level?',
    });
  });

  it('omits the latest-response trailer when none is supplied', () => {
    const transcript: ConversationTurn[] = [
      { user: 'Hello', agent: 'Hi there!' },
    ];
    const msgs = buildMessages(transcript, undefined);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[1].role).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// UserAgent — construction guards.
// ---------------------------------------------------------------------------

describe('UserAgent — construction', () => {
  it('throws when persona is empty', () => {
    expect(
      () => new UserAgent({ client: fakeClient('x'), persona: '   ', goal: GOAL }),
    ).toThrow(/persona/);
  });

  it('throws when goal is empty', () => {
    expect(
      () =>
        new UserAgent({ client: fakeClient('x'), persona: PERSONA, goal: '' }),
    ).toThrow(/goal/);
  });
});

// ---------------------------------------------------------------------------
// UserAgent.nextMessage.
// ---------------------------------------------------------------------------

describe('UserAgent.nextMessage', () => {
  it('returns the trimmed text of the model reply', async () => {
    const client = fakeClient('  Hello — could you tell me more about lodges?  ');
    const ua = new UserAgent({ client, persona: PERSONA, goal: GOAL });
    const out = await ua.nextMessage({ transcript: [] });
    expect(out).toBe('Hello — could you tell me more about lodges?');
  });

  it('uses the default Sonnet model when none supplied', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const client: AnthropicLike = { messages: { create } };
    const ua = new UserAgent({ client, persona: PERSONA, goal: GOAL });
    await ua.nextMessage({ transcript: [] });
    expect(create).toHaveBeenCalledOnce();
    const body = create.mock.calls[0][0];
    expect(body.model).toBe(DEFAULT_USER_AGENT_MODEL);
  });

  it('honours a per-instance model override', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const client: AnthropicLike = { messages: { create } };
    const ua = new UserAgent({
      client,
      persona: PERSONA,
      goal: GOAL,
      model: 'claude-haiku-4-5-20251001',
    });
    await ua.nextMessage({ transcript: [] });
    const body = create.mock.calls[0][0];
    expect(body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('threads persona + goal through the system prompt', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const client: AnthropicLike = { messages: { create } };
    const ua = new UserAgent({ client, persona: PERSONA, goal: GOAL });
    await ua.nextMessage({ transcript: [] });
    const body = create.mock.calls[0][0];
    expect(body.system).toContain(PERSONA);
    expect(body.system).toContain(GOAL);
  });

  it('builds the messages array with the role-flipped transcript', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'next' }] });
    const client: AnthropicLike = { messages: { create } };
    const ua = new UserAgent({ client, persona: PERSONA, goal: GOAL });
    await ua.nextMessage({
      transcript: [{ user: 'Hello', agent: 'Hi traveller!' }],
      latestAgentResponse: 'What dates work?',
    });
    const body = create.mock.calls[0][0];
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'Hello' });
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'Hi traveller!',
    });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: 'What dates work?',
    });
  });

  it('throws when the model returns no text content (refusal-like)', async () => {
    const client = fakeClient({ content: [] });
    const ua = new UserAgent({ client, persona: PERSONA, goal: GOAL });
    await expect(ua.nextMessage({ transcript: [] })).rejects.toThrow(
      /no text content/,
    );
  });

  it('throws when the model returns only whitespace', async () => {
    const client = fakeClient('   \n\n   ');
    const ua = new UserAgent({ client, persona: PERSONA, goal: GOAL });
    await expect(ua.nextMessage({ transcript: [] })).rejects.toThrow(
      /no text content/,
    );
  });

  it('concatenates multiple text content blocks', async () => {
    const client = fakeClient({
      content: [
        { type: 'text', text: 'Part one. ' },
        { type: 'text', text: 'Part two.' },
        // Tool-use-shaped block (ignored).
        { type: 'tool_use' },
      ],
    });
    const ua = new UserAgent({ client, persona: PERSONA, goal: GOAL });
    const out = await ua.nextMessage({ transcript: [] });
    expect(out).toBe('Part one. Part two.');
  });
});
