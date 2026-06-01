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

import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner, Event as AdkEvent } from '@google/adk';
import { CHAT_MESSAGE_MAX, setEventSink, resetEventSink, type Event } from '@swoop/common';

import { buildServer } from '../index.js';
import { InMemorySessionStore, type SessionStore } from '../../session/index.js';
import type { TriageClassifier } from '../../functional-agents/triage-classifier.js';

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

function buildTestApp(
  store?: SessionStore,
  runner?: Runner,
  triageClassifier?: TriageClassifier,
): { app: Express; store: SessionStore; runner: StubRunner } {
  const store_ = store ?? new InMemorySessionStore();
  const stub = runner
    ? { runner, emit: () => {}, lastAborted: () => false }
    : makeStubRunner();
  const app = buildServer({
    sessionStore: store_,
    runner: stub.runner,
    corsAllowedOrigins: ['http://localhost:5173'],
    version: 'test',
    triageClassifier,
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

  it('accepts a valid entryUrl and persists it onto session metadata', async () => {
    const { app, store } = buildTestApp();
    const res = await request(app)
      .post('/session')
      .send({ entryUrl: 'https://www.swoop-patagonia.com/trips/w-trek' });
    expect(res.status).toBe(201);
    const state = await store.get(res.body.sessionId);
    expect(state?.metadata.entryUrl).toBe('https://www.swoop-patagonia.com/trips/w-trek');
  });

  it('returns 400 when entryUrl is not a valid URL (Theme-A.1 / Sec-3)', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/session')
      .send({ entryUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('returns 400 when extra fields are sent (strict schema)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/session').send({ unexpected: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
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

  it('returns 400 when copyVersion is missing (Theme-A.1)', async () => {
    const { app } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    const res = await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('returns 400 when extra fields are sent (strict schema)', async () => {
    const { app } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    const res = await request(app)
      .patch(`/session/${sessionId}/consent`)
      .send({ granted: true, copyVersion: 'v1', extra: 'no' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
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

  it('returns 400 when message is not a string (Theme-A.1)', async () => {
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    const res = await request(app).post('/chat').send({ sessionId, message: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('returns 400 when extra fields are sent (strict schema)', async () => {
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    const res = await request(app)
      .post('/chat')
      .send({ sessionId, message: 'hi', extra: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });
});

describe('POST /chat — SSE happy path', () => {
  it('streams text parts and ends with event:done', async () => {
    const { app, runner } = buildTestApp();
    // Assistant text streams as `partial: true` deltas — this mirrors the real
    // ClaudeLlm contract. The live SSE path runs with suppressNonPartialText,
    // which drops the end-of-turn non-partial aggregate (ADK-persistence copy);
    // only the partial deltas reach the wire and session history.
    runner.emit([
      mkEvent({ content: { role: 'model', parts: [{ text: 'Hello, ' }] }, partial: true }),
      mkEvent({ content: { role: 'model', parts: [{ text: 'Patagonia.' }] }, partial: true }),
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
      mkEvent({ content: { role: 'model', parts: [{ text: 'Hello.' }] }, partial: true }),
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

describe('Security headers (helmet)', () => {
  it('sets CSP, HSTS, Referrer-Policy on a normal response', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);

    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('frame-ancestors http://localhost:5173');

    const hsts = res.headers['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toMatch(/max-age=\d+/);
    expect(hsts).toContain('includeSubDomains');

    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('does not set X-Frame-Options (CSP frame-ancestors supersedes it)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/healthz');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('falls back to frame-ancestors none when no origins configured', async () => {
    const store = new InMemorySessionStore();
    const stub = makeStubRunner();
    const app = buildServer({
      sessionStore: store,
      runner: stub.runner,
      corsAllowedOrigins: [],
      version: 'test',
    });
    const res = await request(app).get('/healthz');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
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

// ---------------------------------------------------------------------------
// R4-server (2026-04-30 review) — body-limit + per-message length cap.
// Body cap was lowered from 64kb → 16kb; field cap added at 8 000 chars on
// `ChatRequestSchema.message`. The two checks compose: oversized JSON
// bodies bounce at the parser, oversized message text bounces at Zod.
// ---------------------------------------------------------------------------

describe('POST /chat — body and message limits (R4-server)', () => {
  it('returns 413 when the request body exceeds the 16kb limit', async () => {
    const { app } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    // 18 KB raw — well above the 16 KB body limit, well below the
    // theoretical Express default. The serialiser pads with the JSON
    // envelope; raw payload size is what trips the parser.
    const oversized = 'a'.repeat(18 * 1024);
    const res = await request(app)
      .post('/chat')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ sessionId, message: oversized }));
    expect(res.status).toBe(413);
  });

  it('returns 400 when the message field exceeds CHAT_MESSAGE_MAX', async () => {
    const { app } = buildTestApp();
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    // CHAT_MESSAGE_MAX + 1 chars, but inside the 16 KB body cap so we hit
    // the schema layer rather than the parser.
    const overCap = 'b'.repeat(CHAT_MESSAGE_MAX + 1);
    const res = await request(app).post('/chat').send({ sessionId, message: overCap });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    // The field path narrows down the offending key for the UI.
    expect(JSON.stringify(res.body)).toContain('message');
  });

  it('accepts a message at exactly CHAT_MESSAGE_MAX', async () => {
    const { app, runner } = buildTestApp();
    runner.emit([mkEvent({ turnComplete: true })]);
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    const res = await request(app)
      .post('/chat')
      .send({ sessionId, message: 'c'.repeat(CHAT_MESSAGE_MAX) });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Perf-3 (2026-04-30 review) — skip the triage classifier on turn 1; still
// fire on turn 2+. The verdict from turn N is read on turn N+1.
// ---------------------------------------------------------------------------

interface CountingClassifier extends TriageClassifier {
  callCount: number;
}

function makeCountingClassifier(): CountingClassifier {
  let calls = 0;
  const classifier: CountingClassifier = {
    modelId: 'stub-haiku',
    callCount: 0,
    async classify() {
      calls += 1;
      classifier.callCount = calls;
      return {
        posture: 'unclear',
        rationale: 'stub',
        modelUsed: 'stub-haiku',
      };
    },
  };
  return classifier;
}

describe('POST /chat — Perf-3 turn-1 triage skip', () => {
  it('skips the classifier on turn 1', async () => {
    const classifier = makeCountingClassifier();
    const { app, runner } = buildTestApp(undefined, undefined, classifier);
    runner.emit([
      mkEvent({ content: { role: 'model', parts: [{ text: 'hi' }] }, partial: true }),
      mkEvent({ turnComplete: true }),
    ]);
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    const res = await request(app).post('/chat').send({ sessionId, message: 'hello' });
    expect(res.status).toBe(200);
    expect(classifier.callCount).toBe(0);
  });

  it('runs the classifier on turn 2', async () => {
    const classifier = makeCountingClassifier();
    const { app, runner } = buildTestApp(undefined, undefined, classifier);
    runner.emit([mkEvent({ turnComplete: true })]);
    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);
    // Turn 1 — skipped.
    await request(app).post('/chat').send({ sessionId, message: 'hello' });
    expect(classifier.callCount).toBe(0);
    // Turn 2 — classifier fires.
    runner.emit([mkEvent({ turnComplete: true })]);
    await request(app).post('/chat').send({ sessionId, message: 'tell me more' });
    expect(classifier.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test-1 (2026-04-30 review) — /chat error-path coverage.
//
// Three scenarios:
//   (a) mid-stream throw inside the runner — `event: error` SSE frame
//       emitted, `error.raised` event captured, history not corrupted.
//   (b) client disconnect — request socket closed mid-stream; runner
//       observes the abort signal; no zombie writes follow.
//   (c) connector-unreachable — modelled as a thrown error before any
//       events stream (the surface emerging from `runAsync` is identical
//       whether the runner blew up or the connector did); SSE error frame
//       + `error.raised` event captured, session state remains intact.
//
// (b) is exercised against a real `http.Server` because supertest's
// transport doesn't expose a clean way to close the request socket
// mid-flight. (a) and (c) work fine through supertest because the runner
// throws synchronously inside `for await`.
// ---------------------------------------------------------------------------

describe('POST /chat — error path coverage (Test-1)', () => {
  let captured: Event[] = [];

  beforeEach(() => {
    captured = [];
    setEventSink((e) => {
      captured.push(e);
    });
  });

  afterEach(() => {
    resetEventSink();
  });

  it('mid-stream runner throw → event:error frame and error.raised event (a)', async () => {
    // Runner yields one good text event, then throws. The translator's
    // `for await` surfaces the throw to the chat handler's catch arm,
    // which writes `event: error` and emits the structured event.
    const store = new InMemorySessionStore();
    const runner = {
      async *runAsync(): AsyncGenerator<AdkEvent, void, undefined> {
        yield mkEvent({ content: { role: 'model', parts: [{ text: 'partial ' }] }, partial: true });
        throw new Error('runner exploded mid-stream');
      },
    } as unknown as Runner;
    const app = buildServer({
      sessionStore: store,
      runner,
      corsAllowedOrigins: ['http://localhost:5173'],
      version: 'test',
    });

    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);

    const res = await request(app).post('/chat').send({ sessionId, message: 'hi' });
    expect(res.status).toBe(200);
    const frames = parseSseFrames(res.text);
    const errorFrame = frames.find((f) => f.event === 'error');
    expect(errorFrame).toBeDefined();
    const parsed = JSON.parse(errorFrame!.data);
    // SSE error frame shape: flat `{code, message}` per writeSseError.
    expect(parsed.code).toBe('internal_error');
    expect(parsed.message).toContain('runner exploded');

    const errorRaised = captured.find(
      (e): e is Event & { eventType: 'error.raised' } => e.eventType === 'error.raised',
    );
    expect(errorRaised).toBeDefined();
    expect((errorRaised!.payload as { errorType: string }).errorType).toBe(
      'chat_turn_failed',
    );

    // Session state stays valid — the user message persisted, runner failure
    // didn't corrupt history.
    const state = await store.get(sessionId);
    expect(state).not.toBeNull();
    expect(state!.conversationHistory.some((e) => e.role === 'user')).toBe(true);
  });

  it('client disconnect aborts the runner cleanly (b)', async () => {
    // Spin up a real http.Server so we can close the request socket
    // mid-stream — supertest's transport buffers responses and doesn't
    // expose a portable mid-flight abort.
    const { createServer } = await import('node:http');
    const aborted = { fired: false };
    const release = { pending: null as null | (() => void) };

    const store = new InMemorySessionStore();
    const runner = {
      async *runAsync(params: { abortSignal?: AbortSignal }): AsyncGenerator<AdkEvent, void, undefined> {
        // Attach the abort listener up front — before the first yield —
        // so the listener exists by the time the chat handler's
        // `res.on('close')` fires the controller. (Earlier iterations of
        // this test caught a real bug here: the chat handler was
        // listening on `req.on('close')`, which Express 5 fires before
        // the handler runs because the body parser has already drained
        // the request stream. Switching to `res.on('close')` gave us a
        // signal that fires when the *response* socket actually closes —
        // which is what we care about for mid-stream cancel.)
        const sig = params.abortSignal;
        if (sig) {
          if (sig.aborted) aborted.fired = true;
          sig.addEventListener('abort', () => {
            aborted.fired = true;
            release.pending?.();
          });
        }
        // Partial delta so it survives the live path's suppressNonPartialText
        // filter and reaches the wire — the client waits on this first `data`
        // frame before destroying the socket to trigger the abort.
        yield mkEvent({ content: { role: 'model', parts: [{ text: 'streaming ' }] }, partial: true });
        await new Promise<void>((resolve) => {
          release.pending = resolve;
        });
      },
    } as unknown as Runner;

    const app = buildServer({
      sessionStore: store,
      runner,
      corsAllowedOrigins: ['http://localhost:5173'],
      version: 'test',
    });

    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port bound');
    const port = address.port;

    // Fire a real HTTP POST against the listening server. Once the SSE
    // stream is open we destroy the client socket — that sends FIN, which
    // Express surfaces as `req.on('close')`. The chat handler's
    // `onClientClose` then aborts the controller, which the runner's
    // listener observes.
    const http = await import('node:http');
    const reqClose = new Promise<void>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/chat',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.once('data', () => {
            // Destroying the socket directly forces an immediate close —
            // `req.destroy()` alone can leave the FIN queued.
            req.socket?.destroy();
            resolve();
          });
          res.on('end', () => resolve());
          res.on('error', () => resolve());
        },
      );
      req.on('error', () => resolve());
      req.end(JSON.stringify({ sessionId, message: 'hi' }));
    });

    await reqClose;
    // Allow the server's `req.on('close')` handler + abortController to
    // propagate through the runner's signal listener.
    await new Promise((r) => setTimeout(r, 250));
    // Release any lingering deferred so the generator can settle and the
    // test doesn't leak a Promise.
    release.pending?.();
    await new Promise((r) => setTimeout(r, 50));

    expect(aborted.fired).toBe(true);
    // Session is still readable — disconnect doesn't corrupt state.
    const state = await store.get(sessionId);
    expect(state).not.toBeNull();

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 10_000);

  it('connector-unreachable surfaces as event:error + error.raised (c)', async () => {
    // Model the "MCP connector throws on tool call" failure as a thrown
    // error inside the runner — the orchestrator's translator path is the
    // same surface for any thrown exception emerging from `runAsync`. The
    // assertion is that the user-facing wire shape matches: SSE error
    // frame plus a structured `error.raised` event with the right type.
    const store = new InMemorySessionStore();
    const runner = {
      async *runAsync(): AsyncGenerator<AdkEvent, void, undefined> {
        // Yield zero events; immediately throw a connector-shaped error.
        if (false as boolean) yield mkEvent({});
        throw new Error('ECONNREFUSED 127.0.0.1:3001 (connector unreachable)');
      },
    } as unknown as Runner;
    const app = buildServer({
      sessionStore: store,
      runner,
      corsAllowedOrigins: ['http://localhost:5173'],
      version: 'test',
    });

    const sessionId = await bootstrapSession(app);
    await grantConsent(app, sessionId);

    const res = await request(app)
      .post('/chat')
      .send({ sessionId, message: 'find me a w-trek' });
    expect(res.status).toBe(200);
    const frames = parseSseFrames(res.text);
    const errorFrame = frames.find((f) => f.event === 'error');
    expect(errorFrame).toBeDefined();
    const parsed = JSON.parse(errorFrame!.data);
    expect(parsed.code).toBe('internal_error');
    expect(parsed.message).toContain('ECONNREFUSED');

    const errorRaised = captured.find(
      (e): e is Event & { eventType: 'error.raised' } => e.eventType === 'error.raised',
    );
    expect(errorRaised).toBeDefined();
    expect((errorRaised!.payload as { errorType: string }).errorType).toBe(
      'chat_turn_failed',
    );

    const state = await store.get(sessionId);
    expect(state).not.toBeNull();
  });
});
