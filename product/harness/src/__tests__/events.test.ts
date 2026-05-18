/**
 * Tests for HarnessEvent + EventSink — per-event streaming substrate.
 *
 * Coverage:
 *   - NullEventSink swallows events without throwing.
 *   - FileEventSink writes one JSON line per emit; lines are independently
 *     parseable as JSON.
 *   - FileEventSink appends — multiple emits all show up in order.
 *   - FileEventSink against a missing parent directory throws (no auto-mkdir).
 *   - The discriminated union is exhaustive — a switch over `kind` with
 *     `never`-narrowing compiles for every member.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  envelope,
  FileEventSink,
  NullEventSink,
  type HarnessEvent,
} from '../events.js';

describe('NullEventSink', () => {
  it('swallows every event without throwing', () => {
    const sink = new NullEventSink();
    sink.emit({
      kind: 'scenario.started',
      ...envelope('foo'),
      file: '/tmp/x.yaml',
      scenarioShape: 'agent',
    });
    sink.emit({
      kind: 'scenario.completed',
      ...envelope('foo'),
      status: 'passed',
      durationMs: 1,
      summary: 'PASS foo in 1ms',
    });
    // No assertion beyond "didn't throw" — sink is opaque by design.
    expect(true).toBe(true);
  });
});

describe('FileEventSink', () => {
  let tmp: string;
  let path: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'events-test-'));
    path = join(tmp, 'scenario.jsonl');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes one JSON line per emit; each line parses independently', () => {
    const sink = new FileEventSink(path);
    sink.emit({
      kind: 'scenario.started',
      ...envelope('alpha'),
      file: '/tmp/alpha.yaml',
      scenarioShape: 'agent',
    });
    sink.emit({
      kind: 'session.created',
      ...envelope('alpha'),
      sessionId: 'sid-1',
      disclosureCopyVersion: 'v1',
    });

    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const events = lines.map((l) => JSON.parse(l) as HarnessEvent);
    expect(events[0]?.kind).toBe('scenario.started');
    expect(events[1]?.kind).toBe('session.created');
    expect(events[0]?.scenarioName).toBe('alpha');
    expect(events[1]?.scenarioName).toBe('alpha');
  });

  it('appends — multiple emits preserve order, no truncation', () => {
    const sink = new FileEventSink(path);
    for (let i = 1; i <= 10; i++) {
      sink.emit({
        kind: 'assertion.evaluated',
        ...envelope('alpha', i),
        assertionKind: 'contains',
        passed: true,
        reason: `iteration ${i}`,
      });
    }
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(10);
    lines.forEach((l, idx) => {
      const event = JSON.parse(l);
      expect(event.reason).toBe(`iteration ${idx + 1}`);
      expect(event.turnIndex).toBe(idx + 1);
    });
  });

  it('throws synchronously when the parent directory does not exist', () => {
    const missing = join(tmp, 'no-such-dir', 'scenario.jsonl');
    const sink = new FileEventSink(missing);
    expect(() =>
      sink.emit({
        kind: 'scenario.started',
        ...envelope('alpha'),
        file: '/tmp/alpha.yaml',
        scenarioShape: 'agent',
      }),
    ).toThrow(/ENOENT/);
  });

  it('preserves raw Anthropic payloads (the "RAW and EVERYTHING" requirement)', () => {
    const sink = new FileEventSink(path);
    const rawAnthropicResponse = {
      id: 'msg_01ABC',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I am a roleplayed visitor.' }],
      model: 'claude-sonnet-4-5-20250929',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1234, output_tokens: 12 },
    };
    sink.emit({
      kind: 'user_agent.responded',
      ...envelope('alpha', 1),
      message: 'I am a roleplayed visitor.',
      durationMs: 1500,
      anthropicRaw: rawAnthropicResponse,
    });
    const [line] = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const event = JSON.parse(line!) as Extract<
      HarnessEvent,
      { kind: 'user_agent.responded' }
    >;
    expect(event.anthropicRaw).toEqual(rawAnthropicResponse);
  });

  it('writes successfully into a freshly-mkdir-d directory', () => {
    // Mirror the CLI's pattern: caller mkdirs the parent before constructing
    // the sink. This is the happy path it should support.
    const nested = join(tmp, 'scenarios');
    mkdirSync(nested, { recursive: true });
    const sink = new FileEventSink(join(nested, 'beta.jsonl'));
    sink.emit({
      kind: 'scenario.started',
      ...envelope('beta'),
      file: '/tmp/beta.yaml',
      scenarioShape: 'scripted',
    });
    const written = readFileSync(join(nested, 'beta.jsonl'), 'utf8');
    expect(written).toContain('"kind":"scenario.started"');
    expect(written).toContain('"scenarioName":"beta"');
    expect(written.endsWith('\n')).toBe(true);
  });
});

describe('envelope', () => {
  it('produces an ISO 8601 timestamp', () => {
    const env = envelope('foo');
    expect(env.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('includes turnIndex when supplied', () => {
    const env = envelope('foo', 3);
    expect(env.turnIndex).toBe(3);
  });

  it('omits turnIndex when not supplied', () => {
    const env = envelope('foo');
    expect('turnIndex' in env).toBe(false);
  });
});

describe('HarnessEvent discriminated union', () => {
  it('compile-time: a switch over kind is exhaustive', () => {
    // Type-level test — this function will fail to typecheck if a kind is
    // added to the union without a corresponding branch here. At runtime
    // it's just a no-op.
    function check(e: HarnessEvent): string {
      switch (e.kind) {
        case 'scenario.started':
        case 'session.created':
        case 'consent.granted':
        case 'user_agent.invoked':
        case 'user_agent.responded':
        case 'user.message.sent':
        case 'agent.sse.frame':
        case 'agent.response.aggregated':
        case 'stop_judge.invoked':
        case 'stop_judge.responded':
        case 'assertion.evaluated':
        case 'judge.invoked':
        case 'judge.responded':
        case 'error':
        case 'timeout':
        case 'scenario.completed':
          return e.kind;
        default: {
          // `never`-narrowing fails to compile if any kind is unhandled above.
          const _exhaustive: never = e;
          return _exhaustive;
        }
      }
    }
    // Trivially exercise one branch at runtime.
    expect(
      check({
        kind: 'scenario.started',
        ...envelope('x'),
        file: '/x',
        scenarioShape: 'agent',
      }),
    ).toBe('scenario.started');
  });
});
