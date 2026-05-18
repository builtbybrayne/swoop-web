/**
 * Unit tests for the H.t8 Haiku-backed stop-judge.
 *
 * Coverage:
 *   - YES parsing (case-insensitive, whitespace-tolerant).
 *   - NO parsing.
 *   - Throw on unexpected output (operator awareness).
 *   - Prompt construction: persona, goal, stopWhen criteria, transcript all
 *     reach the prompt verbatim.
 *   - Default model is the pinned Haiku ID; per-call override works.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildStopJudgeSystemPrompt,
  buildStopJudgeUserPayload,
  DEFAULT_STOP_JUDGE_MODEL,
  shouldStop,
  type AnthropicLike,
} from '../stop-judge.js';
import type { ConversationTurn } from '../user-agent.js';
import type { TerminationCriteria } from '../scenario.js';

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const PERSONA =
  'A 42-year-old anniversary planner who prefers lodges, asks clarifying ' +
  'questions, warm tone.';
const GOAL = 'Decide whether to speak with a Swoop specialist.';
const CRITERIA: TerminationCriteria = {
  maxTurns: 8,
  stopWhen: ['handoff form appears', 'you have everything you need'],
};

function fakeClient(reply: string): AnthropicLike {
  return {
    messages: {
      create: vi
        .fn()
        .mockResolvedValue({ content: [{ type: 'text', text: reply }] }),
    },
  };
}

const baseReq = {
  persona: PERSONA,
  goal: GOAL,
  terminationCriteria: CRITERIA,
  transcript: [] as readonly ConversationTurn[],
  latestAgentResponse: 'Tell me more about what you are looking for.',
};

// ---------------------------------------------------------------------------
// buildStopJudgeSystemPrompt.
// ---------------------------------------------------------------------------

describe('buildStopJudgeSystemPrompt', () => {
  it('embeds persona, goal, and each stopWhen entry verbatim', () => {
    const sys = buildStopJudgeSystemPrompt(PERSONA, GOAL, CRITERIA);
    expect(sys).toContain(PERSONA);
    expect(sys).toContain(GOAL);
    expect(sys).toContain('handoff form appears');
    expect(sys).toContain('you have everything you need');
  });

  it('mentions maxTurns', () => {
    const sys = buildStopJudgeSystemPrompt(PERSONA, GOAL, CRITERIA);
    expect(sys).toContain('maxTurns: 8');
  });

  it('locks the response format to YES or NO', () => {
    const sys = buildStopJudgeSystemPrompt(PERSONA, GOAL, CRITERIA);
    expect(sys).toMatch(/YES or NO/);
  });

  it('handles missing stopWhen gracefully', () => {
    const sys = buildStopJudgeSystemPrompt(PERSONA, GOAL, { maxTurns: 4 });
    expect(sys).toContain('none specified');
  });

  it('handles empty stopWhen array gracefully', () => {
    const sys = buildStopJudgeSystemPrompt(PERSONA, GOAL, {
      maxTurns: 4,
      stopWhen: [],
    });
    expect(sys).toContain('none specified');
  });
});

// ---------------------------------------------------------------------------
// buildStopJudgeUserPayload.
// ---------------------------------------------------------------------------

describe('buildStopJudgeUserPayload', () => {
  it('shows "(no prior turns)" when the transcript is empty', () => {
    const out = buildStopJudgeUserPayload([], 'Hello!');
    expect(out).toContain('(no prior turns)');
    expect(out).toContain('Hello!');
  });

  it('lists each turn as Visitor / Assistant pair', () => {
    const transcript: ConversationTurn[] = [
      { user: 'Hi', agent: 'Welcome!' },
      { user: 'I want to go to Patagonia', agent: 'When?' },
    ];
    const out = buildStopJudgeUserPayload(transcript, 'December');
    expect(out).toContain('Turn 1:');
    expect(out).toContain('Visitor: Hi');
    expect(out).toContain('Assistant: Welcome!');
    expect(out).toContain('Turn 2:');
    expect(out).toContain('Visitor: I want to go to Patagonia');
    expect(out).toContain('Assistant: When?');
    expect(out).toContain('December');
  });

  it('puts the latest agent response under its own header', () => {
    const out = buildStopJudgeUserPayload([], 'most recent reply');
    expect(out).toMatch(/Latest assistant response[\s\S]+most recent reply/);
  });
});

// ---------------------------------------------------------------------------
// shouldStop.
// ---------------------------------------------------------------------------

describe('shouldStop', () => {
  it('returns true when Haiku replies YES', async () => {
    const client = fakeClient('YES');
    expect(await shouldStop({ ...baseReq, client })).toBe(true);
  });

  it('returns false when Haiku replies NO', async () => {
    const client = fakeClient('NO');
    expect(await shouldStop({ ...baseReq, client })).toBe(false);
  });

  it('tolerates lowercase yes', async () => {
    const client = fakeClient('yes');
    expect(await shouldStop({ ...baseReq, client })).toBe(true);
  });

  it('tolerates surrounding whitespace and newlines', async () => {
    const client = fakeClient('  \n  NO  \n');
    expect(await shouldStop({ ...baseReq, client })).toBe(false);
  });

  it('throws on unexpected output (forces operator awareness)', async () => {
    const client = fakeClient('Maybe.');
    await expect(shouldStop({ ...baseReq, client })).rejects.toThrow(
      /unexpected response/,
    );
  });

  it('throws on empty model output', async () => {
    const client: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [] }),
      },
    };
    await expect(shouldStop({ ...baseReq, client })).rejects.toThrow(
      /unexpected response/,
    );
  });

  it('uses the default Haiku model when none supplied', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'NO' }] });
    const client: AnthropicLike = { messages: { create } };
    await shouldStop({ ...baseReq, client });
    expect(create.mock.calls[0][0].model).toBe(DEFAULT_STOP_JUDGE_MODEL);
  });

  it('honours a per-call model override', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'NO' }] });
    const client: AnthropicLike = { messages: { create } };
    await shouldStop({
      ...baseReq,
      client,
      model: 'claude-sonnet-4-5-20250929',
    });
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-4-5-20250929');
  });

  it('passes persona + goal + criteria + transcript + latest response through to the API call', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'NO' }] });
    const client: AnthropicLike = { messages: { create } };
    const transcript: ConversationTurn[] = [
      { user: 'Hi', agent: 'Hello!' },
    ];
    await shouldStop({
      ...baseReq,
      client,
      transcript,
      latestAgentResponse: 'What dates?',
    });
    const body = create.mock.calls[0][0];
    expect(body.system).toContain(PERSONA);
    expect(body.system).toContain(GOAL);
    expect(body.system).toContain('handoff form appears');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('Hi');
    expect(body.messages[0].content).toContain('Hello!');
    expect(body.messages[0].content).toContain('What dates?');
  });

  it('uses temperature=0 and max_tokens=5 for stable yes/no decisions', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'NO' }] });
    const client: AnthropicLike = { messages: { create } };
    await shouldStop({ ...baseReq, client });
    const body = create.mock.calls[0][0];
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(5);
  });
});
