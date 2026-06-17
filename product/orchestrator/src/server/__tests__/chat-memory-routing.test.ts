/**
 * T3-3 — two-agent routing tests (the Sacred Invariant in code).
 *
 * Drives the full `POST /chat` Express surface (via buildServer + supertest)
 * with:
 *   - a STUB conversational runner (records whether it ran, yields a marker),
 *   - a STUB memory-agent provider (records whether it ran, yields a marker +
 *     optionally a finish_memory tool call),
 *   - a REAL SharedPasswordAuthenticator (so staff JWTs validate end-to-end).
 *
 * Anthropic is never called. These tests assert ROUTING + MODE behaviour, not
 * model output.
 *
 * Contracts under test (from the T3-3 brief):
 *   1. A visitor (no staff token) ALWAYS runs the conversational runner, NEVER
 *      the memory provider — even when the message reads like a memory command.
 *   2. An authenticated staff member running an ordinary turn runs the
 *      conversational runner (staff ≠ memory mode).
 *   3. An authenticated staff member who explicitly asks to remember something
 *      is routed to the memory provider, and session.mode flips to 'memory'.
 *   4. A `finish_memory` tool call from the memory agent flips session.mode
 *      back to 'conversation' AND is swallowed (never reaches the SSE wire).
 *   5. Once in memory mode, subsequent staff turns stay routed to the memory
 *      provider until finish_memory.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner, Event as AdkEvent } from '@google/adk';

import { buildServer } from '../index.js';
import { InMemorySessionStore, type SessionStore } from '../../session/index.js';
import { SharedPasswordAuthenticator } from '../../auth/shared-password-authenticator.js';
import type { MemoryAgentProvider } from '../chat.js';
import type { BuildMemoryAgentResult } from '../../agent/memory-agent.js';

const PASSWORD = 'correct-horse-battery-staple';
const JWT_SECRET = 'a-very-long-jwt-secret-for-testing-purposes-xyz';

// ---------------------------------------------------------------------------
// Stub conversational runner — records invocation, yields one marker text.
// ---------------------------------------------------------------------------

interface ConvRunnerSpy {
  runner: Runner;
  callCount(): number;
}

function makeConvRunner(): ConvRunnerSpy {
  let calls = 0;
  const runner = {
    appName: 'puma-test',
    sessionService: { getSession: async () => null } as unknown as Runner['sessionService'],
    async *runAsync(): AsyncGenerator<AdkEvent, void, undefined> {
      calls += 1;
      // `partial: true` — the live SSE translator runs with
      // suppressNonPartialText, so only partial text deltas reach the wire
      // (mirrors how ClaudeLlm streams). See server.test.ts.
      yield {
        content: { role: 'model', parts: [{ text: 'CONVERSATIONAL_MARKER' }] },
        partial: true,
      } as AdkEvent;
    },
  } as unknown as Runner;
  return { runner, callCount: () => calls };
}

// ---------------------------------------------------------------------------
// Stub memory-agent provider — records invocation, yields a marker text and
// (optionally) a finish_memory tool call. The seeded-runner shape matches what
// the chat handler calls: createSeededRunner({sessionId, transcriptSummary})
// → { runner, sessionId }, then runner.runAsync(...) yields the turn events.
// ---------------------------------------------------------------------------

interface MemoryProviderSpy {
  provider: MemoryAgentProvider;
  buildCount(): number;
  lastStaffName(): string | undefined;
  lastTranscriptSummary(): string | undefined;
  /** Set what the memory agent's turn emits. */
  setTurnEvents(events: AdkEvent[]): void;
}

function makeMemoryProvider(): MemoryProviderSpy {
  let builds = 0;
  let lastName: string | undefined;
  let lastTranscript: string | undefined;
  let turnEvents: AdkEvent[] = [
    {
      content: { role: 'model', parts: [{ text: 'MEMORY_MARKER' }] },
      partial: true,
    } as AdkEvent,
  ];

  const provider: MemoryAgentProvider = ({ staffName }) => {
    builds += 1;
    lastName = staffName;
    const built: BuildMemoryAgentResult = {
      // The agent object is never introspected by the handler — only
      // createSeededRunner is called. A bare cast keeps the stub small.
      agent: {} as BuildMemoryAgentResult['agent'],
      createSeededRunner: async ({ transcriptSummary }) => {
        lastTranscript = transcriptSummary;
        const runner = {
          appName: 'puma-memory-test',
          sessionService: {
            getSession: async () => null,
          } as unknown as Runner['sessionService'],
          async *runAsync(): AsyncGenerator<AdkEvent, void, undefined> {
            for (const e of turnEvents) yield e;
          },
        } as unknown as Runner;
        return { runner, sessionId: 'seeded-session__memory' };
      },
    };
    return built;
  };

  return {
    provider,
    buildCount: () => builds,
    lastStaffName: () => lastName,
    lastTranscriptSummary: () => lastTranscript,
    setTurnEvents: (events) => {
      turnEvents = events;
    },
  };
}

// ---------------------------------------------------------------------------
// App builder + helpers.
// ---------------------------------------------------------------------------

function buildApp(opts?: {
  withStaffAuth?: boolean;
  withMemoryProvider?: boolean;
}): {
  app: Express;
  store: SessionStore;
  conv: ConvRunnerSpy;
  memory: MemoryProviderSpy;
} {
  const store = new InMemorySessionStore();
  const conv = makeConvRunner();
  const memory = makeMemoryProvider();

  const authenticator =
    opts?.withStaffAuth === false
      ? null
      : new SharedPasswordAuthenticator({ password: PASSWORD, jwtSecret: JWT_SECRET });

  const app = buildServer({
    sessionStore: store,
    runner: conv.runner,
    corsAllowedOrigins: ['http://localhost:5173'],
    version: 'test',
    staffAuthenticator: authenticator,
    memoryAgentProvider:
      opts?.withMemoryProvider === false ? undefined : memory.provider,
  });

  return { app, store, conv, memory };
}

async function bootstrapAndConsent(app: Express): Promise<string> {
  const res = await request(app).post('/session').send({});
  const sessionId = res.body.sessionId as string;
  await request(app)
    .patch(`/session/${sessionId}/consent`)
    .send({ granted: true, copyVersion: 'v1' });
  return sessionId;
}

async function staffLogin(app: Express): Promise<string> {
  const res = await request(app)
    .post('/staff/auth')
    .send({ password: PASSWORD, name: 'Alice' });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

function sseText(body: string): string {
  // The full SSE body as one string; marker assertions only need substring.
  return body;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /chat — two-agent routing (T3-3)', () => {
  describe('visitor sessions (no staff token) — Sacred Invariant', () => {
    let app: Express;
    let conv: ConvRunnerSpy;
    let memory: MemoryProviderSpy;
    let store: SessionStore;

    beforeEach(() => {
      ({ app, conv, memory, store } = buildApp());
    });

    it('runs the conversational runner, never the memory provider', async () => {
      const sessionId = await bootstrapAndConsent(app);
      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'Tell me about Patagonia' });

      expect(res.status).toBe(200);
      expect(sseText(res.text)).toContain('CONVERSATIONAL_MARKER');
      expect(conv.callCount()).toBe(1);
      expect(memory.buildCount()).toBe(0);
    });

    it('does NOT enter memory mode even when the message reads like a memory command', async () => {
      const sessionId = await bootstrapAndConsent(app);
      // A bare visitor typing "remember that the W trek is popular" must NOT
      // be routed to memory — the confirm step never even gets a chance because
      // the visitor is not staff.
      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'remember that the W trek is popular' });

      expect(res.status).toBe(200);
      expect(memory.buildCount()).toBe(0);
      expect(conv.callCount()).toBe(1);

      const state = await store.get(sessionId);
      expect(state?.mode).toBe('conversation');
      expect(state?.staff).toBe(false);
    });
  });

  describe('authenticated staff sessions', () => {
    let app: Express;
    let conv: ConvRunnerSpy;
    let memory: MemoryProviderSpy;
    let store: SessionStore;

    beforeEach(() => {
      ({ app, conv, memory, store } = buildApp());
    });

    it('runs the conversational runner for an ordinary staff turn (staff ≠ memory mode)', async () => {
      const sessionId = await bootstrapAndConsent(app);
      const token = await staffLogin(app);

      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'What trips do you have in March?', staffToken: token });

      expect(res.status).toBe(200);
      expect(sseText(res.text)).toContain('CONVERSATIONAL_MARKER');
      expect(conv.callCount()).toBe(1);
      expect(memory.buildCount()).toBe(0);

      const state = await store.get(sessionId);
      expect(state?.staff).toBe(true);
      expect(state?.mode).toBe('conversation');
    });

    it('routes to the memory provider when staff explicitly asks to remember', async () => {
      const sessionId = await bootstrapAndConsent(app);
      const token = await staffLogin(app);

      const res = await request(app)
        .post('/chat')
        .send({
          sessionId,
          message: 'Please remember that the refugios book out 6 months ahead.',
          staffToken: token,
        });

      expect(res.status).toBe(200);
      expect(sseText(res.text)).toContain('MEMORY_MARKER');
      expect(sseText(res.text)).not.toContain('CONVERSATIONAL_MARKER');
      expect(memory.buildCount()).toBe(1);
      expect(conv.callCount()).toBe(0);
      // The provider was built with the validated staff name (attribution).
      expect(memory.lastStaffName()).toBe('Alice');

      const state = await store.get(sessionId);
      expect(state?.mode).toBe('memory');
    });

    it('seeds the memory agent with the conversation transcript (sm-9)', async () => {
      const sessionId = await bootstrapAndConsent(app);
      const token = await staffLogin(app);

      // First an ordinary turn so the transcript has content.
      await request(app)
        .post('/chat')
        .send({ sessionId, message: 'Hello there', staffToken: token });

      // Then enter memory mode.
      await request(app)
        .post('/chat')
        .send({ sessionId, message: 'remember that tours have no listed prices', staffToken: token });

      const transcript = memory.lastTranscriptSummary();
      expect(transcript).toBeDefined();
      // The earlier visitor + agent turns are present in the seed.
      expect(transcript).toContain('Hello there');
      expect(transcript).toContain('CONVERSATIONAL_MARKER');
    });

    it('stays in memory mode for subsequent staff turns until finish_memory', async () => {
      const sessionId = await bootstrapAndConsent(app);
      const token = await staffLogin(app);

      // Enter memory mode.
      await request(app)
        .post('/chat')
        .send({ sessionId, message: 'add a memory about seasonality', staffToken: token });
      expect((await store.get(sessionId))?.mode).toBe('memory');

      // A follow-up turn that is NOT an explicit trigger still routes to memory
      // because the session is already in memory mode.
      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'yes, save it', staffToken: token });

      expect(res.status).toBe(200);
      expect(sseText(res.text)).toContain('MEMORY_MARKER');
      expect(memory.buildCount()).toBe(2);
      expect(conv.callCount()).toBe(0);
      expect((await store.get(sessionId))?.mode).toBe('memory');
    });
  });

  describe('finish_memory handback (sm-3)', () => {
    it('flips mode back to conversation and swallows the finish_memory tool call', async () => {
      const { app, store, conv, memory } = buildApp();
      const sessionId = await bootstrapAndConsent(app);
      const token = await staffLogin(app);

      // The memory agent's turn ends by emitting finish_memory.
      memory.setTurnEvents([
        // Partial text reaches the wire; the functionCall (non-partial, like a
        // real tool call) is what the handler intercepts + swallows.
        {
          content: { role: 'model', parts: [{ text: 'Saved. Anything else?' }] },
          partial: true,
        } as AdkEvent,
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { id: 'fc1', name: 'finish_memory', args: {} } }],
          },
        } as AdkEvent,
      ]);

      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'remember that and we are done', staffToken: token });

      expect(res.status).toBe(200);
      // The natural-language text streamed.
      expect(sseText(res.text)).toContain('Saved. Anything else?');
      // The finish_memory tool call was swallowed — it never hit the wire.
      expect(sseText(res.text)).not.toContain('finish_memory');

      // Mode flipped back to conversation for the NEXT turn.
      expect((await store.get(sessionId))?.mode).toBe('conversation');

      // And the next turn indeed routes back to the conversational runner.
      const res2 = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'great, what about December?', staffToken: token });
      expect(sseText(res2.text)).toContain('CONVERSATIONAL_MARKER');
      expect(conv.callCount()).toBe(1);
      // The memory provider was built once (the first turn), not the second.
      expect(memory.buildCount()).toBe(1);
    });
  });

  describe('graceful fallback', () => {
    it('falls back to the conversational runner when no memory provider is wired', async () => {
      // Staff auth on, but provider deliberately absent (visitor-only deploy).
      const { app, store, conv, memory } = buildApp({ withMemoryProvider: false });
      const sessionId = await bootstrapAndConsent(app);
      const token = await staffLogin(app);

      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'remember that prices change seasonally', staffToken: token });

      expect(res.status).toBe(200);
      // Mode still flips (the staff member asked), but with no provider the
      // turn falls through to the conversational runner rather than erroring.
      expect(memory.buildCount()).toBe(0);
      expect(conv.callCount()).toBe(1);
      expect(sseText(res.text)).toContain('CONVERSATIONAL_MARKER');
      // Mode is recorded as memory (the explicit ask was honoured); a later
      // turn with a provider wired would then route to memory.
      expect((await store.get(sessionId))?.mode).toBe('memory');
    });
  });
});
