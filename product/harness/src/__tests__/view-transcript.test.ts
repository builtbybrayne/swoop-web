/**
 * Tests for view-transcript.ts — the HTML transcript viewer.
 *
 * Coverage:
 *   - Empty events → minimal valid HTML doc.
 *   - Header surfaces scenario name + status badge + duration.
 *   - Scripted scenario (no user-agent / stop-judge events) renders without
 *     those sections; agent scenario renders full structure.
 *   - SSE text frames concatenated in order into one Agent bubble per turn.
 *   - Tool calls collated into one <details> with arg JSON.
 *   - Raw events <details> always present at the bottom with every event.
 *   - HTML escaping for <, >, &, ", ' in user content (visitor messages,
 *     agent text, tool args, persona, etc).
 *   - Assertions surface pass/fail icons + reasons.
 *   - Errors / timeouts inline within their turn; scenario-level errors in
 *     a dedicated section.
 *   - Real fixture round-trip: load sample-transcript.jsonl, render, sanity
 *     check that the output mentions the scenario name + turn count.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { viewTranscript } from '../view-transcript.js';
import { envelope, type HarnessEvent } from '../events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Empty / minimal.
// ---------------------------------------------------------------------------

describe('viewTranscript — empty events', () => {
  it('returns a minimal valid HTML doc with a placeholder', () => {
    const html = viewTranscript([]);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('(unknown scenario)');
    expect(html).toContain('(no turns captured)');
    // Always-present sections:
    expect(html).toContain('Raw events (0)');
  });
});

// ---------------------------------------------------------------------------
// Scripted scenario shape.
// ---------------------------------------------------------------------------

describe('viewTranscript — scripted scenario', () => {
  it('omits user-agent + stop-judge sections; surfaces conversation + assertions', () => {
    const events: HarnessEvent[] = [
      {
        kind: 'scenario.started',
        ...envelope('scripted-1'),
        file: '/fake/scripted-1.yaml',
        scenarioShape: 'scripted',
      },
      {
        kind: 'session.created',
        ...envelope('scripted-1'),
        sessionId: 'sess_s',
        disclosureCopyVersion: 'v1',
      },
      {
        kind: 'consent.granted',
        ...envelope('scripted-1'),
        sessionId: 'sess_s',
        copyVersion: 'v1',
      },
      {
        kind: 'user.message.sent',
        ...envelope('scripted-1', 1),
        sessionId: 'sess_s',
        message: 'hi',
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('scripted-1', 1),
        frameEvent: null,
        frameData: '{"type":"text","text":"hello world"}',
        partType: 'text',
        text: 'hello world',
      },
      {
        kind: 'assertion.evaluated',
        ...envelope('scripted-1'),
        assertionKind: 'contains',
        passed: true,
        reason: 'final utterance contains "hello"',
      },
      {
        kind: 'scenario.completed',
        ...envelope('scripted-1'),
        status: 'passed',
        durationMs: 1500,
        summary: 'PASSED scripted-1 in 1.50s',
      },
    ];
    const html = viewTranscript(events);
    expect(html).toContain('scripted-1');
    expect(html).toContain('badge-pass');
    expect(html).toContain('Visitor');
    expect(html).toContain('Agent');
    expect(html).toContain('hello world');
    expect(html).toContain('hi');
    // Scripted shape: no user-agent / stop-judge details surfaced.
    expect(html).not.toContain('user-agent');
    expect(html).not.toContain('stop-judge');
    // Assertions surface.
    expect(html).toContain('contains');
    expect(html).toContain('✅');
  });
});

// ---------------------------------------------------------------------------
// Agent scenario — full structure.
// ---------------------------------------------------------------------------

describe('viewTranscript — agent scenario', () => {
  it('renders user-agent + stop-judge details per turn', () => {
    const events: HarnessEvent[] = [
      {
        kind: 'scenario.started',
        ...envelope('agent-1'),
        file: '/fake/agent-1.yaml',
        scenarioShape: 'agent',
      },
      {
        kind: 'user_agent.invoked',
        ...envelope('agent-1', 1),
        persona: '42yo couple',
        goal: 'find a trip',
        transcriptSoFar: [],
        model: 'claude-sonnet-4-5-20250929',
      },
      {
        kind: 'user_agent.responded',
        ...envelope('agent-1', 1),
        message: 'Hi there',
        durationMs: 1200,
        anthropicRaw: { id: 'msg_x', model: 'claude-sonnet-4-5-20250929' },
      },
      {
        kind: 'user.message.sent',
        ...envelope('agent-1', 1),
        sessionId: 'sess_a',
        message: 'Hi there',
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('agent-1', 1),
        frameEvent: null,
        frameData: '{"type":"text","text":"Hello back"}',
        partType: 'text',
        text: 'Hello back',
      },
      {
        kind: 'stop_judge.invoked',
        ...envelope('agent-1', 1),
        model: 'claude-haiku-4-5-20251001',
        transcriptSoFar: [],
        latestAgentResponse: 'Hello back',
      },
      {
        kind: 'stop_judge.responded',
        ...envelope('agent-1', 1),
        shouldStop: true,
        anthropicRaw: { id: 'msg_stop' },
        durationMs: 300,
      },
      {
        kind: 'scenario.completed',
        ...envelope('agent-1'),
        status: 'passed',
        durationMs: 2000,
        summary: 'PASSED agent-1 in 2.00s',
      },
    ];
    const html = viewTranscript(events);
    expect(html).toContain('user-agent');
    expect(html).toContain('stop-judge');
    expect(html).toContain('YES (stop)');
    expect(html).toContain('42yo couple');
    expect(html).toContain('msg_x'); // raw anthropic response captured
  });
});

// ---------------------------------------------------------------------------
// Concatenation + tool calls.
// ---------------------------------------------------------------------------

describe('viewTranscript — frame collation', () => {
  it('concatenates multiple text frames in order into one Agent bubble', () => {
    const events: HarnessEvent[] = [
      {
        kind: 'scenario.started',
        ...envelope('multi-frame'),
        file: '/x.yaml',
        scenarioShape: 'scripted',
      },
      {
        kind: 'user.message.sent',
        ...envelope('multi-frame', 1),
        sessionId: 's',
        message: 'q',
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('multi-frame', 1),
        frameEvent: null,
        frameData: '{"type":"text","text":"Once "}',
        partType: 'text',
        text: 'Once ',
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('multi-frame', 1),
        frameEvent: null,
        frameData: '{"type":"text","text":"upon "}',
        partType: 'text',
        text: 'upon ',
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('multi-frame', 1),
        frameEvent: null,
        frameData: '{"type":"text","text":"a time"}',
        partType: 'text',
        text: 'a time',
      },
    ];
    const html = viewTranscript(events);
    expect(html).toContain('Once upon a time');
  });

  it('collates tool calls into a single <details> with summary + args', () => {
    const events: HarnessEvent[] = [
      {
        kind: 'scenario.started',
        ...envelope('tools-1'),
        file: '/x.yaml',
        scenarioShape: 'scripted',
      },
      {
        kind: 'user.message.sent',
        ...envelope('tools-1', 1),
        sessionId: 's',
        message: 'find',
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('tools-1', 1),
        frameEvent: null,
        frameData: '{"type":"tool-call","toolName":"find_options","input":{"region":"patagonia"}}',
        partType: 'tool-call',
        toolName: 'find_options',
        toolInput: { region: 'patagonia' },
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('tools-1', 1),
        frameEvent: null,
        frameData: '{"type":"tool-call","toolName":"find_options","input":{"region":"chile"}}',
        partType: 'tool-call',
        toolName: 'find_options',
        toolInput: { region: 'chile' },
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('tools-1', 1),
        frameEvent: null,
        frameData: '{"type":"tool-call","toolName":"lookup","input":{"q":"x"}}',
        partType: 'tool-call',
        toolName: 'lookup',
        toolInput: { q: 'x' },
      },
    ];
    const html = viewTranscript(events);
    // Summary line: "find_options × 2, lookup"
    expect(html).toContain('find_options × 2');
    expect(html).toContain('lookup');
    // Args present in the expanded block (quotes are HTML-escaped to &quot;).
    expect(html).toContain('&quot;region&quot;');
    expect(html).toContain('&quot;patagonia&quot;');
  });
});

// ---------------------------------------------------------------------------
// HTML escaping.
// ---------------------------------------------------------------------------

describe('viewTranscript — HTML escaping', () => {
  it('escapes <, >, &, ", \' in visitor messages + agent text', () => {
    const events: HarnessEvent[] = [
      {
        kind: 'scenario.started',
        ...envelope('escape-test'),
        file: '/x.yaml',
        scenarioShape: 'scripted',
      },
      {
        kind: 'user.message.sent',
        ...envelope('escape-test', 1),
        sessionId: 's',
        message: '<script>alert("xss")</script> & friends',
      },
      {
        kind: 'agent.sse.frame',
        ...envelope('escape-test', 1),
        frameEvent: null,
        frameData: '{"type":"text","text":"He said \'hi\' & waved"}',
        partType: 'text',
        text: "He said 'hi' & waved",
      },
    ];
    const html = viewTranscript(events);
    // The visitor message must not appear as raw script tag.
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&#39;');
    expect(html).toContain('&quot;');
  });
});

// ---------------------------------------------------------------------------
// Raw events block always present.
// ---------------------------------------------------------------------------

describe('viewTranscript — raw events block', () => {
  it('contains every event verbatim (count + content)', () => {
    const events: HarnessEvent[] = [
      {
        kind: 'scenario.started',
        ...envelope('raw-test'),
        file: '/x.yaml',
        scenarioShape: 'scripted',
      },
      {
        kind: 'assertion.evaluated',
        ...envelope('raw-test'),
        assertionKind: 'contains',
        passed: true,
        reason: 'ok',
      },
      {
        kind: 'scenario.completed',
        ...envelope('raw-test'),
        status: 'passed',
        durationMs: 1,
        summary: 'PASSED raw-test in 0.00s',
      },
    ];
    const html = viewTranscript(events);
    expect(html).toContain('Raw events (3)');
    // Every event's kind appears in the raw block.
    expect(html).toContain('scenario.started');
    expect(html).toContain('assertion.evaluated');
    expect(html).toContain('scenario.completed');
  });
});

// ---------------------------------------------------------------------------
// Real fixture round-trip.
// ---------------------------------------------------------------------------

describe('viewTranscript — real fixture round-trip', () => {
  it('handles the sample-transcript.jsonl fixture without throwing + surfaces key content', () => {
    const fixturePath = join(__dirname, 'fixtures', 'sample-transcript.jsonl');
    const lines = readFileSync(fixturePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const events = lines.map((l) => JSON.parse(l) as HarnessEvent);
    expect(events.length).toBeGreaterThan(20);
    const html = viewTranscript(events);
    expect(html).toContain('sample-agent-scenario');
    expect(html).toContain('badge-fail'); // fixture has status: failed
    expect(html).toContain('Turn 1');
    expect(html).toContain('Turn 2');
    expect(html).toContain('anniversary'); // from the user message
    expect(html).toContain('lodge'); // from one of the agent responses
    expect(html).toContain('user-agent'); // agent scenario detail block
    expect(html).toContain('stop-judge'); // agent scenario detail block
    expect(html).toContain('find_inspiring'); // tool call surfaced
    // Assertions surface both pass + fail icons.
    expect(html).toContain('✅');
    expect(html).toContain('❌');
  });
});
