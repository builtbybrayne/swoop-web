/**
 * HTTP surface tests — `GET /session/:id/history` (B.t11).
 *
 * Exercises the server-side rehydration projection endpoint: a known active
 * session returns its full UI-facing message-part stream, an unknown session
 * returns 404, and the reasoning-strip + tool-call lifecycle invariants from
 * the live SSE wire are preserved. The event-emit tests assert the four
 * observability emits (rehydrated / replay.empty / replay.failed / expired)
 * land with envelope-valid payloads per the F-a discriminated union.
 *
 * Strategy:
 *   - Stub the ADK `BaseSessionService` so we can drive a deterministic
 *     event log without spinning up the real `InMemoryRunner` (mirrors the
 *     translator-fixture pattern from `translator/__tests__`). Same Event
 *     factory shape `server.test.ts` already proved out.
 *   - Real Express app via `buildServer` so the route wiring is exercised.
 *   - Real `InMemorySessionStore` so the Puma-side existence gate is the
 *     same code path `/chat`'s 404 hits.
 *   - `setEventSink` / `resetEventSink` capture every emit; the seven
 *     salvaged tests stay agnostic of the sink, and three event-emit
 *     tests assert the new envelope shapes.
 *
 * Out of scope (per Tier 3 brief):
 *   - Real ADK session-event-replay (the existing translator fixtures are
 *     enough to prove the projection); spinning up an InMemoryRunner here
 *     would tangle this test with B.t14's runner wiring.
 *   - Client-side rehydration (D.t9-mount-rehydrate — separate workstream).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner, Event as AdkEvent, BaseSessionService } from '@google/adk';
import {
  EventSchema,
  resetEventSink,
  setEventSink,
  type Event,
} from '@swoop/common';

import { buildServer } from '../index.js';
import { InMemorySessionStore } from '../../session/index.js';

/**
 * Minimal ADK Event factory matching the Event-extends-LlmResponse shape the
 * translator consumes — local copy of `mkEvent` in server.test.ts so the two
 * test files don't have to share helpers (each holds its own scaffolding).
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

/**
 * In-memory ADK session-service stub. Just enough surface for the history
 * handler: a `getSession` that returns a `{events}` shape, plus a setter
 * the test uses to seed events. Other `BaseSessionService` methods exist as
 * no-ops so the type check passes.
 */
interface StubSessionService {
  service: BaseSessionService;
  /** Seed events for a given (appName, userId, sessionId) triple. */
  setEvents(sessionId: string, events: AdkEvent[]): void;
  /** Drop the entry so `getSession` returns undefined. */
  drop(sessionId: string): void;
  /** Make `getSession` throw — for the 500 path coverage. */
  throwOnGet(error: Error): void;
}

function makeStubSessionService(): StubSessionService {
  const sessions = new Map<string, AdkEvent[]>();
  let throwErr: Error | null = null;
  const service = {
    async createSession() {
      // Tests don't drive create through the service stub — the route under
      // test is read-only.
      return { id: '', appName: '', userId: '', state: {}, events: [], lastUpdateTime: 0 };
    },
    async getSession({ sessionId }: { sessionId: string }) {
      if (throwErr) throw throwErr;
      const events = sessions.get(sessionId);
      if (events === undefined) return undefined;
      return {
        id: sessionId,
        appName: 'puma-orchestrator',
        userId: 'anonymous',
        state: {},
        events,
        lastUpdateTime: Date.now(),
      };
    },
    async listSessions() {
      return { sessions: [] };
    },
    async deleteSession() {
      // no-op
    },
    async appendEvent({ event }: { event: AdkEvent }) {
      return event;
    },
  } as unknown as BaseSessionService;
  return {
    service,
    setEvents(sessionId, events) {
      sessions.set(sessionId, events);
    },
    drop(sessionId) {
      sessions.delete(sessionId);
    },
    throwOnGet(error) {
      throwErr = error;
    },
  };
}

/**
 * Build a runner-shaped object that exposes the stub session service and
 * appName the way `Runner` does. We never call `runAsync` from this test
 * file (history is read-only) so the type cast is safe at runtime.
 */
function makeStubRunner(sessionService: BaseSessionService): Runner {
  return {
    appName: 'puma-orchestrator',
    sessionService,
    async *runAsync(): AsyncGenerator<AdkEvent, void, undefined> {
      // never yields — `/chat` is not under test here.
    },
  } as unknown as Runner;
}

interface TestApp {
  app: Express;
  store: InMemorySessionStore;
  events: StubSessionService;
}

async function buildTestApp(): Promise<TestApp> {
  const store = new InMemorySessionStore();
  const events = makeStubSessionService();
  const runner = makeStubRunner(events.service);
  const app = buildServer({
    sessionStore: store,
    runner,
    corsAllowedOrigins: ['http://localhost:5173'],
    version: 'test',
    userId: 'anonymous',
  });
  return { app, store, events };
}

/**
 * Helper — create a Puma session in a consented state. `InMemorySessionStore`
 * defaults `consent.conversation.granted` to false; the rehydrate handler
 * 404s on ungranted consent, so the happy-path tests need it flipped.
 */
async function createConsentedSession(
  store: InMemorySessionStore,
): Promise<{ sessionId: string }> {
  const created = await store.create();
  const granted = await store.update(created.sessionId, (s) => ({
    ...s,
    consent: {
      ...s.consent,
      conversation: {
        granted: true,
        timestamp: new Date().toISOString(),
        copyVersion: 'v1',
      },
    },
  }));
  return { sessionId: granted.sessionId };
}

// ---------------------------------------------------------------------------
// Event-sink capture — every test's `beforeEach` installs a ring-buffer
// sink; `afterEach` resets so a misbehaving test can't leak into the next.
// Mirrors the B.t10 warm-pool tests' hygiene.
// ---------------------------------------------------------------------------

let captured: Event[] = [];
beforeEach(() => {
  captured = [];
  setEventSink((event) => {
    captured.push(event);
  });
});
afterEach(() => {
  resetEventSink();
});

describe('GET /session/:id/history', () => {
  // -------------------------------------------------------------------------
  // Seven salvaged tests from commit 6d31124 — handler-shape coverage.
  // -------------------------------------------------------------------------

  it('returns 200 + parts in correct order for a known session with messages', async () => {
    const { app, store, events } = await buildTestApp();
    const { sessionId } = await createConsentedSession(store);
    events.setEvents(sessionId, [
      mkEvent({ content: { role: 'model', parts: [{ text: 'Hello, ' }] } }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Patagonia.' }] } }),
      mkEvent({ turnComplete: true }),
    ]);

    const res = await request(app).get(`/session/${sessionId}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      parts: [
        { type: 'text', text: 'Hello, ' },
        { type: 'text', text: 'Patagonia.' },
      ],
    });
  });

  it('returns 404 for an unknown session id', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/session/does-not-exist/history');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });

  it('returns 200 + empty parts array for a consented but turn-empty session', async () => {
    const { app, store, events } = await buildTestApp();
    const { sessionId } = await createConsentedSession(store);
    // ADK session exists with no events. The translator yields nothing; we
    // serialise that as `{parts: []}`. This is the "fresh visitor who has
    // consented but not typed" state and the warm-pool-claim state alike.
    events.setEvents(sessionId, []);

    const res = await request(app).get(`/session/${sessionId}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parts: [] });
  });

  it('does NOT include reasoning parts in the response (translator filter invariant)', async () => {
    const { app, store, events } = await buildTestApp();
    const { sessionId } = await createConsentedSession(store);
    // Mix reasoning (Part.thought=true) and visible text events. The
    // reasoning-filter must strip the former before we serialise.
    events.setEvents(sessionId, [
      mkEvent({
        content: { role: 'model', parts: [{ text: 'deliberating…', thought: true }] },
      }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Hello.' }] } }),
      mkEvent({
        content: { role: 'model', parts: [{ text: 'more thinking', thought: true }] },
      }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Done.' }] } }),
      mkEvent({ turnComplete: true }),
    ]);

    const res = await request(app).get(`/session/${sessionId}/history`);
    expect(res.status).toBe(200);
    const parts = res.body.parts as Array<{ type: string; text?: string }>;
    expect(parts.every((p) => p.type !== 'reasoning')).toBe(true);
    expect(parts.map((p) => p.text)).toEqual(['Hello.', 'Done.']);
  });

  it('preserves tool-call parts with lifecycle states intact', async () => {
    const { app, store, events } = await buildTestApp();
    const { sessionId } = await createConsentedSession(store);
    // A representative agent turn: text → tool call → tool response → text.
    // The ADK functionCall + functionResponse events become the
    // input-available + output-available tool-call states; we want both
    // present in order and carrying the original toolName / toolCallId.
    events.setEvents(sessionId, [
      mkEvent({ content: { role: 'model', parts: [{ text: 'Looking it up. ' }] } }),
      mkEvent({
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'call-1',
                name: 'find_options',
                args: { destination: 'Torres del Paine' },
              },
            },
          ],
        },
      }),
      mkEvent({
        content: {
          role: 'model',
          parts: [
            {
              functionResponse: {
                id: 'call-1',
                name: 'find_options',
                response: { cards: [{ title: 'W Trek' }] },
              },
            },
          ],
        },
      }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Done.' }] } }),
      mkEvent({ turnComplete: true }),
    ]);

    const res = await request(app).get(`/session/${sessionId}/history`);
    expect(res.status).toBe(200);
    const parts = res.body.parts as Array<{
      type: string;
      state?: string;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      text?: string;
    }>;

    // Order: text, tool input-available, tool output-available, text.
    expect(parts.map((p) => `${p.type}${p.state ? ':' + p.state : ''}`)).toEqual([
      'text',
      'tool-call:input-available',
      'tool-call:output-available',
      'text',
    ]);

    const inputAvail = parts[1]!;
    expect(inputAvail.toolCallId).toBe('call-1');
    expect(inputAvail.toolName).toBe('find_options');
    expect(inputAvail.input).toEqual({ destination: 'Torres del Paine' });

    const outputAvail = parts[2]!;
    expect(outputAvail.toolCallId).toBe('call-1');
    expect(outputAvail.toolName).toBe('find_options');
    // input is carried forward from the matching input-available event.
    expect(outputAvail.input).toEqual({ destination: 'Torres del Paine' });
    expect(outputAvail.output).toEqual({ cards: [{ title: 'W Trek' }] });
  });

  it('returns 404 when the Puma session has been deleted (e.g. archived/expired path)', async () => {
    // Delete the Puma-side session but leave ADK events behind. The Puma-
    // side existence check is the gate, so this 404s — matches the "session
    // expired" UX path the side-quest plan documents in §5 W2.
    const { app, store, events } = await buildTestApp();
    const { sessionId } = await createConsentedSession(store);
    events.setEvents(sessionId, [
      mkEvent({ content: { role: 'model', parts: [{ text: 'hi' }] } }),
      mkEvent({ turnComplete: true }),
    ]);
    await store.delete(sessionId);

    const res = await request(app).get(`/session/${sessionId}/history`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });

  it('CORS preflight OPTIONS returns 204 with GET in Access-Control-Allow-Methods', async () => {
    const { app } = await buildTestApp();
    const res = await request(app)
      .options('/session/any/history')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toMatch(/\bGET\b/);
  });

  // -------------------------------------------------------------------------
  // Three new tests beyond the 6d31124 salvage — observability emit coverage
  // per the Tier 3 plan §"Tests added beyond 6d31124".
  // -------------------------------------------------------------------------

  it('emits session.rehydrated on non-empty replay with partCount + eventCount + durationMs', async () => {
    const { app, store, events } = await buildTestApp();
    const { sessionId } = await createConsentedSession(store);
    events.setEvents(sessionId, [
      mkEvent({ content: { role: 'model', parts: [{ text: 'one ' }] } }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'two ' }] } }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'three' }] } }),
      mkEvent({ turnComplete: true }),
    ]);

    const res = await request(app).get(`/session/${sessionId}/history`);
    expect(res.status).toBe(200);

    const rehydrated = captured.filter((e) => e.eventType === 'session.rehydrated');
    expect(rehydrated).toHaveLength(1);
    const ev = rehydrated[0]!;
    // Envelope round-trips through the F-a discriminated union.
    expect(EventSchema.safeParse(ev).success).toBe(true);
    expect(ev.sessionId).toBe(sessionId);
    expect(ev.actor).toBe('system');
    expect(ev.turnIndex).toBeNull();
    // partCount counts non-reasoning, non-fyi visible text parts here (3);
    // eventCount counts ADK events seeded (4 incl. the turnComplete tick).
    if (ev.eventType === 'session.rehydrated') {
      expect(ev.payload.partCount).toBe(3);
      expect(ev.payload.eventCount).toBe(4);
      expect(ev.payload.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('emits session.replay.empty on 200 + zero parts', async () => {
    const { app, store, events } = await buildTestApp();
    const { sessionId } = await createConsentedSession(store);
    events.setEvents(sessionId, []);

    const res = await request(app).get(`/session/${sessionId}/history`);
    expect(res.status).toBe(200);

    const empty = captured.filter((e) => e.eventType === 'session.replay.empty');
    expect(empty).toHaveLength(1);
    const ev = empty[0]!;
    expect(EventSchema.safeParse(ev).success).toBe(true);
    expect(ev.sessionId).toBe(sessionId);
    if (ev.eventType === 'session.replay.empty') {
      expect(ev.payload.eventCount).toBe(0);
    }
    // session.rehydrated must NOT also fire on the empty path.
    expect(captured.some((e) => e.eventType === 'session.rehydrated')).toBe(false);
  });

  it('emits session.expired with gate=puma on unknown id', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/session/never-existed/history');
    expect(res.status).toBe(404);

    const expired = captured.filter((e) => e.eventType === 'session.expired');
    expect(expired).toHaveLength(1);
    const ev = expired[0]!;
    expect(EventSchema.safeParse(ev).success).toBe(true);
    expect(ev.sessionId).toBe('never-existed');
    if (ev.eventType === 'session.expired' && 'gate' in ev.payload) {
      expect(ev.payload.gate).toBe('puma');
    } else {
      throw new Error('expected session.expired payload to carry gate=puma');
    }
  });
});
