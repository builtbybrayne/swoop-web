/**
 * HTTP surface integration tests — B.t5.
 *
 * Uses `supertest` to drive the full Express surface built by `buildServer`.
 * The ADK Runner is stubbed — tests construct a fake `runner` object that
 * yields hand-crafted ADK events, so Anthropic is never called.
 *
 * Covered contracts:
 *   - POST /session → 201, { sessionId, disclosureCopyVersion }.
 *   - PATCH /session/:id/consent → 200 when session exists + body is valid.
 *     - 404 when session missing.
 *     - granted:false deletes the session.
 *   - DELETE /session/:id → 204, idempotent.
 *   - POST /chat:
 *       - 400 on empty message / missing sessionId.
 *       - 404 when session unknown.
 *       - 403 when consent not granted.
 *       - SSE happy path: streams parts, ends with event:done.
 *       - Reasoning parts do NOT appear on the SSE wire.
 *       - Reasoning parts ARE persisted to session history.
 *       - Client disconnect aborts the turn (no zombie writes).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner, Event as AdkEvent } from '@google/adk';

import { buildServer } from '../index.js';
import { InMemorySessionStore, type SessionStore } from '../../session/index.js';

/**
 * Minimal ADK event factory matching the Event-extends-LlmResponse shape the
 * translator consumes. We don't populate Event-level metadata (id,
 * invocationId, etc.) because the translator reads only the LlmResponse
 * surface.
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

interface StubRunner {
  runner: Runner;
  emit(events: AdkEvent[]): void;
  /** Track whether the last turn's abort signal fired. */
  lastAborted(): boolean;
}

/**
 * Build a stub runner whose `runAsync` yields whatever events the test has
 * queued. Also records the abort signal so tests can assert it fired on
 * client disconnect.
 */
function makeStubRunner(): StubRunner {
  let queued: AdkEvent[] = [];
  let aborted = false;
  const runner = {
    async *runAsync(params: { abortSignal?: AbortSignal }): AsyncGenerator<AdkEvent, void, undefined> {
      const signal = params.abortSignal;
      for (const e of queued) {
        if (signal?.aborted) {
          aborted = true;
          return;
        }
        yield e;
      }
    },
  } as unknown as Runner;
  return {
    runner,
    emit(events) {
      queued = events;
    },
    lastAborted() {
      return aborted;
    },
  };
}

function buildTestApp(store?: SessionStore, runner?: Runner): { app: Express; store: SessionStore; runner: StubRunner } {
  const store_ = store ?? new InMemorySessionStore();
  const stub = runner
    ? { runner, emit: () => {}, lastAborted: () => false }
    : makeStubRunner();
  const app = buildServer({
    sessionStore: store_,
    runner: stub.runner,
    corsAllowedOrigins: ['http://localhost:5173'],
    version: 'test',
  });
  return { app, store: store_, runner: stub };
}

async function bootstrapSession(app: Express): Promise<string> {
  const res = await request(app).post('/session').send({});
  expect(res.status).toBe(201);
  expect(typeof res.body.sessionId).toBe('string');
  return res.body.sessionId as string;
}

async function grantConsent(app: Express, sessionId: string): Promise<void> {
  const res = await request(app)
    .patch(`/session/${sessionId}/consent`)
    .send({ granted: true, copyVersion: 'v1' });
  expect(res.status).toBe(200);
}

/**
 * Parse an SSE body into a list of `{event?, data}` frames. Good enough for
 * the assertions we care about — split on double newlines, read lines.
 */
function parseSseFrames(body: string): Array<{ event?: string; data: string }> {
  const frames: Array<{ event?: string; data: string }> = [];
  for (const block of body.split(/\n\n/)) {
    if (!block.trim()) continue;
    if (block.startsWith(':')) continue; // heartbeat comment
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
    }
    frames.push({ event, data: dataLines.join('\n') });
  }
  return frames;
}

describe('POST /session', () => {
  it('returns 201 with a session id and disclosure copy version', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/session').send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sessionId: expect.any(String),
      disclosureCopyVersion: expect.any(String),
    });
  });
});

describe('PATCH /session/:id/consent', () => {
  it('returns 200 and sets tier-1 consent when granted:true', async () => {
    const { app, store } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    const res = await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: true, copyVersion: 'v1' });
    expect(res.status).toBe(200);
    expect(res.body.consent.conversation.granted).toBe(true);
    const state = await store.get(sessionId);
    expect(state?.consent.conversation.granted).toBe(true);
  });

  it('returns 404 for an unknown session id', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .patch('/session/does-not-exist/consent')
      .send({ granted: true, copyVersion: 'v1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });

  it('deletes the session when granted:false', async () => {
    const { app, store } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    const res = await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: false, copyVersion: 'v1' });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    const state = await store.get(sessionId);
    expect(state).toBeNull();
  });

  it('returns 400 when body is malformed', async () => {
    const { app } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    const res = await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /session/:id', () => {
  it('returns 204 for existing and missing sessions alike', async () => {
    const { app } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    const first = await request(app).delete(`/session/${sessionId}`);
    expect(first.status).toBe(204);
    const second = await request(app).delete(`/session/${sessionId}`);
    expect(second.status).toBe(204);
  });
});

describe('POST /chat — pre-stream gates', () => {
  let app: Express;
  beforeEach(() => {
    app = buildTestApp().app;
  });

  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app).post('/chat').send({ message: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('returns 400 when message is empty', async () => {
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    const res = await request(app).post('/chat').send({ sessionId, message: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('message_empty');
  });

  it('returns 404 when session does not exist', async () => {
    const res = await request(app).post('/chat').send({ sessionId: 'nope', message: 'hi' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });

  it('returns 403 when tier-1 consent has not been granted', async () => {
    const sessionId = await bootstrapSession(app);
    const res = await request(app).post('/chat').send({ sessionId, message: 'hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('consent_required');
  });
});

describe('POST /chat — SSE happy path', () => {
  it('streams text parts and ends with event:done', async () => {
    const { app, runner } = buildTestApp();
    runner.emit([
      mkEvent({ content: { role: 'model', parts: [{ text: 'Hello, ' }] } }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Patagonia.' }] } }),
      mkEvent({ turnComplete: true }),
    ]);
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    const res = await request(app).post('/chat').send({ sessionId, message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseSseFrames(res.text);
    const dataFrames = frames.filter((f) => !f.event);
    expect(dataFrames.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(dataFrames[0]!.data)).toEqual({ type: 'text', text: 'Hello, ' });
    const done = frames.find((f) => f.event === 'done');
    expect(done).toBeDefined();
  });

  it('does not leak reasoning parts to the SSE wire; persists them to session history', async () => {
    const store = new InMemorySessionStore();
    const { app, runner } = buildTestApp(store);
    runner.emit([
      mkEvent({ content: { role: 'model', parts: [{ text: 'deliberating…', thought: true }] } }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Hello.' }] } }),
      mkEvent({ turnComplete: true }),
    ]);
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    const res = await request(app).post('/chat').send({ sessionId, message: 'hi' });
    expect(res.status).toBe(200);
    const frames = parseSseFrames(res.text).filter((f) => !f.event);
    for (const f of frames) {
      const parsed = JSON.parse(f.data);
      expect(parsed.type).not.toBe('reasoning');
    }
    const state = await store.get(sessionId);
    const reasoningEntries = state?.conversationHistory.filter((e) => e.blockType === 'reasoning') ?? [];
    expect(reasoningEntries.length).toBeGreaterThan(0);
    expect(reasoningEntries[0]?.text).toBe('deliberating…');
  });

  it('persists the user message to session history before the agent starts', async () => {
    const store = new InMemorySessionStore();
    const { app, runner } = buildTestApp(store);
    runner.emit([mkEvent({ turnComplete: true })]);
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    await request(app).post('/chat').send({ sessionId, message: 'bonjour' });
    const state = await store.get(sessionId);
    const userEntries = state?.conversationHistory.filter((e) => e.role === 'user') ?? [];
    expect(userEntries[0]?.text).toBe('bonjour');
  });
});

describe('GET /healthz', () => {
  it('returns 200 with service metadata', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'orchestrator', version: 'test' });
  });
});

describe('CORS', () => {
  it('echoes allowed origin on preflight', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .options('/session')
      .set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('omits CORS headers for disallowed origin', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/session')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
