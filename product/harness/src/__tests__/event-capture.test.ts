/**
 * Unit tests for the EventCapture helpers.
 *
 * Covers:
 *   NullEventCapture       — always returns [].
 *   MemoryEventCapture     — push + filter by sessionId, schema-validate
 *                            on `pushRaw`.
 *   StreamingEventCapture  — newline-delimited JSON over a Node Readable;
 *                            valid lines parsed + buffered, malformed lines
 *                            silently ignored, partial-line + multi-chunk
 *                            decoding handled.
 */

import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  MemoryEventCapture,
  NullEventCapture,
  StreamingEventCapture,
} from '../event-capture.js';
import type { Event } from '@swoop/common';

const SESSION = 'sess_evcap_1';

function startedEvent(sessionId: string = SESSION): Event {
  return {
    eventType: 'conversation.started',
    eventVersion: 1,
    timestamp: '2026-04-28T12:00:00.000Z',
    sessionId,
    turnIndex: 0,
    actor: 'system',
    payload: {},
  };
}

function turnReceivedEvent(sessionId: string = SESSION): Event {
  return {
    eventType: 'turn.received',
    eventVersion: 1,
    timestamp: '2026-04-28T12:00:01.000Z',
    sessionId,
    turnIndex: 1,
    actor: 'user',
    payload: { userMessageLength: 5, userMessageSha256: 'abc' },
  };
}

describe('NullEventCapture', () => {
  it('always returns an empty array', () => {
    const cap = new NullEventCapture();
    expect(cap.eventsForSession(SESSION)).toEqual([]);
    expect(cap.eventsForSession('any-other')).toEqual([]);
  });
});

describe('MemoryEventCapture', () => {
  it('returns events filtered by sessionId in arrival order', () => {
    const cap = new MemoryEventCapture();
    cap.push(startedEvent('sess_a'));
    cap.push(startedEvent('sess_b'));
    cap.push(turnReceivedEvent('sess_a'));

    const a = cap.eventsForSession('sess_a');
    expect(a).toHaveLength(2);
    expect(a[0].eventType).toBe('conversation.started');
    expect(a[1].eventType).toBe('turn.received');

    expect(cap.eventsForSession('sess_b')).toHaveLength(1);
    expect(cap.eventsForSession('nobody')).toHaveLength(0);
  });

  it('clear() drops everything', () => {
    const cap = new MemoryEventCapture();
    cap.push(startedEvent());
    expect(cap.all()).toHaveLength(1);
    cap.clear();
    expect(cap.all()).toHaveLength(0);
  });

  describe('pushRaw', () => {
    it('accepts a valid event', () => {
      const cap = new MemoryEventCapture();
      const ok = cap.pushRaw(startedEvent());
      expect(ok).toBe(true);
      expect(cap.all()).toHaveLength(1);
    });

    it('rejects a structurally-invalid event (wrong eventType)', () => {
      const cap = new MemoryEventCapture();
      const ok = cap.pushRaw({
        eventType: 'made.up.kind',
        eventVersion: 1,
        timestamp: '2026-04-28T12:00:00.000Z',
        sessionId: SESSION,
        turnIndex: null,
        actor: 'system',
        payload: {},
      });
      expect(ok).toBe(false);
      expect(cap.all()).toHaveLength(0);
    });

    it('rejects junk', () => {
      const cap = new MemoryEventCapture();
      expect(cap.pushRaw('not an object')).toBe(false);
      expect(cap.pushRaw(null)).toBe(false);
      expect(cap.pushRaw({ random: 'stuff' })).toBe(false);
      expect(cap.all()).toHaveLength(0);
    });
  });
});

describe('StreamingEventCapture', () => {
  it('parses a single complete line', async () => {
    const stream = Readable.from([JSON.stringify(startedEvent()) + '\n']);
    const cap = new StreamingEventCapture();
    cap.attach(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.eventsForSession(SESSION)).toHaveLength(1);
  });

  it('parses two lines arriving in one chunk', async () => {
    const chunk =
      JSON.stringify(startedEvent()) +
      '\n' +
      JSON.stringify(turnReceivedEvent()) +
      '\n';
    const stream = Readable.from([chunk]);
    const cap = new StreamingEventCapture();
    cap.attach(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.eventsForSession(SESSION)).toHaveLength(2);
  });

  it('handles a line split across chunks', async () => {
    const line = JSON.stringify(startedEvent());
    const split = Math.floor(line.length / 2);
    const chunks = [line.slice(0, split), line.slice(split) + '\n'];
    const stream = Readable.from(chunks);
    const cap = new StreamingEventCapture();
    cap.attach(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.eventsForSession(SESSION)).toHaveLength(1);
  });

  it('flushes a final line with no trailing newline at end-of-stream', async () => {
    const line = JSON.stringify(startedEvent()); // no trailing \n
    const stream = Readable.from([line]);
    const cap = new StreamingEventCapture();
    cap.attach(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.eventsForSession(SESSION)).toHaveLength(1);
  });

  it('silently ignores non-JSON lines', async () => {
    const chunk =
      'this is a boot log line without JSON\n' +
      JSON.stringify(startedEvent()) +
      '\n';
    const stream = Readable.from([chunk]);
    const cap = new StreamingEventCapture();
    cap.attach(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.all()).toHaveLength(1);
  });

  it('silently ignores JSON that does not match the event schema', async () => {
    const chunk =
      JSON.stringify({ random: 'object' }) +
      '\n' +
      JSON.stringify(startedEvent()) +
      '\n';
    const stream = Readable.from([chunk]);
    const cap = new StreamingEventCapture();
    cap.attach(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.all()).toHaveLength(1);
  });

  it('skips empty lines', async () => {
    const stream = Readable.from(['\n\n' + JSON.stringify(startedEvent()) + '\n\n']);
    const cap = new StreamingEventCapture();
    cap.attach(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.all()).toHaveLength(1);
  });

  it('constructor wiring: passing a stream attaches automatically', async () => {
    const stream = Readable.from([JSON.stringify(startedEvent()) + '\n']);
    const cap = new StreamingEventCapture(stream);
    await new Promise((r) => stream.on('end', r));
    expect(cap.all()).toHaveLength(1);
  });
});
