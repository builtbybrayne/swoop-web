/**
 * HTTP surface tests — `GET /session/:id/history` (B.t11).
 *
 * Exercises the server-side rehydration projection endpoint: a known active
 * session returns its full UI-facing message-part stream, an unknown session
 * returns 404, and the reasoning-strip + tool-call lifecycle invariants from
 * the live SSE wire are preserved.
 *
 * Strategy:
 *   - Stub the ADK `BaseSessionService` so we can drive a deterministic
 *     event log without spinning up the real `InMemoryRunner` (mirrors the
 *     translator-fixture pattern from `translator/__tests__`). Same Event
 *     factory shape `server.test.ts` already proved out.
 *   - Real Express app via `buildServer` so the route wiring is exercised.
 *   - Real `InMemorySessionStore` so the Puma-side existence gate is the
 *     same code path `/chat`'s 404 hits.
 *
 * Out of scope (per Tier 3 brief):
 *   - Real ADK session-event-replay (the existing translator fixtures are
 *     enough to prove the projection); spinning up an InMemoryRunner here
 *     would tangle this test with B.t1's runner wiring.
 *   - Client-side rehydration (D.t9 — separate workstream).
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner, Event as AdkEvent, BaseSessionService } from '@google/adk';

import { buildServer } from '../index.js';
import { InMemorySessionStore } from '../../session/index.js';

/**
 * Minimal ADK Event factory matching the Event-extends-LlmResponse shape the
 * translator consumes — copy of `mkEvent` in server.test.ts so the two test
 * files don't have to share helpers (each holds its own scaffolding).
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
 * handler: a `getSession` that returns a `{ events }` shape, plus a setter
 * the test uses to seed events. Other `BaseSessionService` methods exist as
 * no-ops so the type check passes.
 */
interface StubSessionService {
  service: BaseSessionService;
  /** Seed events for a given (appName, userId, sessionId) triple. */
  setEvents(sessionId: string, events: AdkEvent[]): void;
  /** Drop the entry so `getSession` returns undefined. */
  drop(sessionId: string): void;
}

function makeStubSessionService(): StubSessionService {
  const sessions = new Map<string, AdkEvent[]>();
  const service = {
    async createSession() {
      // Tests don't drive create through the service stub — the route under
      // test is read-only.
      return { id: '', appName: '', userId: '', state: {}, events: [], lastUpdateTime: 0 };
    },
    async getSession({ sessionId }: { sessionId: string }) {
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

function buildTestApp(): {
  app: Express;
  store: InMemorySessionStore;
  events: StubSessionService;
} {
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

describe('GET /session/:id/history', () => {
  it('returns 200 + parts in correct order for a known session with messages', async () => {
    const { app, store, events } = buildTestApp();
    const session = await store.create();
    events.setEvents(session.sessionId, [
      mkEvent({ content: { role: 'model', parts: [{ text: 'Hello, ' }] } }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Patagonia.' }] } }),
      mkEvent({ turnComplete: true }),
    ]);

    const res = await request(app).get(`/session/${session.sessionId}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      parts: [
        { type: 'text', text: 'Hello, ' },
        { type: 'text', text: 'Patagonia.' },
      ],
    });
  });

  it('returns 404 for an unknown session id', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/session/does-not-exist/history');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });

  it('returns 200 + empty parts array for a consented but turn-empty session', async () => {
    const { app, store, events } = buildTestApp();
    const session = await store.create();
    // ADK session exists with no events. The translator yields nothing; we
    // serialise that as `{ parts: [] }`. This is the "fresh visitor who has
    // consented but not typed" state.
    events.setEvents(session.sessionId, []);

    const res = await request(app).get(`/session/${session.sessionId}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parts: [] });
  });

  it('does NOT include reasoning parts in the response (translator filter invariant)', async () => {
    const { app, store, events } = buildTestApp();
    const session = await store.create();
    // Mix reasoning (Part.thought=true) and visible text events. The
    // reasoning-filter must strip the former before we serialise.
    events.setEvents(session.sessionId, [
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

    const res = await request(app).get(`/session/${session.sessionId}/history`);
    expect(res.status).toBe(200);
    const parts = res.body.parts as Array<{ type: string; text?: string }>;
    expect(parts.every((p) => p.type !== 'reasoning')).toBe(true);
    expect(parts.map((p) => p.text)).toEqual(['Hello.', 'Done.']);
  });

  it('preserves tool-call parts with lifecycle states intact', async () => {
    const { app, store, events } = buildTestApp();
    const session = await store.create();
    // A representative agent turn: text → tool call → tool response → text.
    // The ADK functionCall + functionResponse events become the
    // input-available + output-available tool-call states; we want both
    // present in order and carrying the original toolName / toolCallId.
    events.setEvents(session.sessionId, [
      mkEvent({ content: { role: 'model', parts: [{ text: 'Looking it up. ' }] } }),
      mkEvent({
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'call-1',
                name: 'show_component_detail',
                args: { id: 'ABC' },
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
                name: 'show_component_detail',
                response: { title: 'Mountain View' },
              },
            },
          ],
        },
      }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Done.' }] } }),
      mkEvent({ turnComplete: true }),
    ]);

    const res = await request(app).get(`/session/${session.sessionId}/history`);
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
    expect(inputAvail.toolName).toBe('show_component_detail');
    expect(inputAvail.input).toEqual({ id: 'ABC' });

    const outputAvail = parts[2]!;
    expect(outputAvail.toolCallId).toBe('call-1');
    expect(outputAvail.toolName).toBe('show_component_detail');
    // input is carried forward from the matching input-available event.
    expect(outputAvail.input).toEqual({ id: 'ABC' });
    expect(outputAvail.output).toEqual({ title: 'Mountain View' });
  });

  it('returns 404 when the Puma session has been deleted (e.g. archived/expired path)', async () => {
    // Delete the Puma-side session but leave ADK events behind. The Puma-side
    // existence check is the gate, so this 404s — matches the "session
    // expired" UX path the side-quest plan documents in §5 W2.
    const { app, store, events } = buildTestApp();
    const session = await store.create();
    events.setEvents(session.sessionId, [
      mkEvent({ content: { role: 'model', parts: [{ text: 'hi' }] } }),
      mkEvent({ turnComplete: true }),
    ]);
    await store.delete(session.sessionId);

    const res = await request(app).get(`/session/${session.sessionId}/history`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });

  it('CORS preflight OPTIONS returns 204 with GET in Access-Control-Allow-Methods', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .options('/session/any/history')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toMatch(/\bGET\b/);
  });
});
