/**
 * consent-greeting-prewarm — greeting-branch tests.
 *
 * Drives the full `POST /chat` Express surface (buildServer + supertest) with:
 *   - a STUB default (conversational) runner — records invocation + the
 *     `newMessage` it received,
 *   - a STUB greeting runner — records invocation + the `newMessage`,
 *   - a fixed greeting prompt string.
 *
 * Anthropic is never called. These tests assert the GREETING BRANCH routing +
 * the HARD INVARIANT that a non-greeting turn is byte-identical to today.
 *
 * Contracts under test (from the consent-greeting-prewarm brief):
 *   1. `greeting:true` + both deps wired → runs the GREETING runner with the
 *      greeting PROMPT as the user content (NOT the request message), and the
 *      default runner never runs.
 *   2. The greeting turn records NO synthetic user message in
 *      conversationHistory (skip appendUserMessage), but DOES persist the
 *      agent's hello (warm-up that replays on reload).
 *   3. HARD INVARIANT: a normal turn (`greeting` absent) runs the DEFAULT
 *      runner, records the user message, and never touches the greeting runner.
 *   4. `greeting:true` with the greeting deps NOT wired falls through to the
 *      normal path (default runner, user message recorded) — additive, safe.
 *   5. The greeting still requires consent (the gate runs before the branch).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Runner, Event as AdkEvent } from '@google/adk';

import { buildServer } from '../index.js';
import { InMemorySessionStore, type SessionStore } from '../../session/index.js';

const GREETING_PROMPT = 'GREETING_PROMPT_BODY — say a short warm hello.';

// ---------------------------------------------------------------------------
// Stub runner — records invocation count + the newMessage text it received,
// yields one marker text part. `partial: true` mirrors how ClaudeLlm streams
// (the live translator runs with suppressNonPartialText).
// ---------------------------------------------------------------------------

interface RunnerSpy {
  runner: Runner;
  callCount(): number;
  lastUserText(): string | undefined;
}

function makeRunner(marker: string): RunnerSpy {
  let calls = 0;
  let lastText: string | undefined;
  const runner = {
    appName: 'puma-test',
    sessionService: { getSession: async () => null } as unknown as Runner['sessionService'],
    runAsync(args: { newMessage: { parts?: Array<{ text?: string }> } }): AsyncGenerator<
      AdkEvent,
      void,
      undefined
    > {
      calls += 1;
      lastText = (args.newMessage.parts ?? [])
        .map((p) => p.text ?? '')
        .join('');
      async function* gen(): AsyncGenerator<AdkEvent, void, undefined> {
        yield {
          content: { role: 'model', parts: [{ text: marker }] },
          partial: true,
        } as AdkEvent;
      }
      return gen();
    },
  } as unknown as Runner;
  return { runner, callCount: () => calls, lastUserText: () => lastText };
}

// ---------------------------------------------------------------------------
// App builder + helpers.
// ---------------------------------------------------------------------------

function buildApp(opts?: { wireGreeting?: boolean }): {
  app: Express;
  store: SessionStore;
  conv: RunnerSpy;
  greeting: RunnerSpy;
} {
  const store = new InMemorySessionStore();
  const conv = makeRunner('CONVERSATIONAL_MARKER');
  const greeting = makeRunner('GREETING_MARKER');

  const app = buildServer({
    sessionStore: store,
    runner: conv.runner,
    corsAllowedOrigins: ['http://localhost:5173'],
    version: 'test',
    ...(opts?.wireGreeting === false
      ? {}
      : { greetingRunner: greeting.runner, greetingPrompt: GREETING_PROMPT }),
  });

  return { app, store, conv, greeting };
}

async function bootstrapAndConsent(app: Express): Promise<string> {
  const res = await request(app).post('/session').send({});
  const sessionId = res.body.sessionId as string;
  await request(app)
    .patch(`/session/${sessionId}/consent`)
    .send({ granted: true, copyVersion: 'v1' });
  return sessionId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /chat — greeting branch (consent-greeting-prewarm)', () => {
  describe('greeting deps wired', () => {
    let app: Express;
    let store: SessionStore;
    let conv: RunnerSpy;
    let greeting: RunnerSpy;

    beforeEach(() => {
      ({ app, store, conv, greeting } = buildApp());
    });

    it('runs the greeting runner with the greeting PROMPT, never the default runner', async () => {
      const sessionId = await bootstrapAndConsent(app);
      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: '​__swoop_greeting__', greeting: true });

      expect(res.status).toBe(200);
      expect(res.text).toContain('GREETING_MARKER');
      expect(res.text).not.toContain('CONVERSATIONAL_MARKER');
      expect(greeting.callCount()).toBe(1);
      expect(conv.callCount()).toBe(0);
      // The greeting runner saw the cms greeting prompt as its user content,
      // NOT the request marker message.
      expect(greeting.lastUserText()).toBe(GREETING_PROMPT);
      expect(greeting.lastUserText()).not.toContain('__swoop_greeting__');
    });

    it('records NO synthetic user message but DOES persist the agent hello', async () => {
      const sessionId = await bootstrapAndConsent(app);
      await request(app)
        .post('/chat')
        .send({ sessionId, message: '​__swoop_greeting__', greeting: true });

      const state = await store.get(sessionId);
      const history = state?.conversationHistory ?? [];
      // No user turn was recorded (appendUserMessage skipped).
      expect(history.some((e) => e.role === 'user')).toBe(false);
      // The agent's hello WAS persisted (the warm-up that replays on reload).
      const agentText = history
        .filter((e) => e.role === 'agent' && e.blockType === 'utter')
        .map((e) => e.text)
        .join('');
      expect(agentText).toContain('GREETING_MARKER');
    });

    it('still requires consent — greeting before consent is rejected', async () => {
      const res = await request(app).post('/session').send({});
      const sessionId = res.body.sessionId as string;
      // No consent granted.
      const chat = await request(app)
        .post('/chat')
        .send({ sessionId, message: '​__swoop_greeting__', greeting: true });

      expect(chat.status).toBe(403);
      expect(greeting.callCount()).toBe(0);
      expect(conv.callCount()).toBe(0);
    });
  });

  describe('HARD INVARIANT — non-greeting turn is byte-identical to today', () => {
    it('a normal turn runs the default runner and records the user message', async () => {
      const { app, store, conv, greeting } = buildApp();
      const sessionId = await bootstrapAndConsent(app);

      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'Tell me about Patagonia' });

      expect(res.status).toBe(200);
      expect(res.text).toContain('CONVERSATIONAL_MARKER');
      expect(conv.callCount()).toBe(1);
      // The greeting runner is NEVER touched by a normal turn.
      expect(greeting.callCount()).toBe(0);

      // The user message WAS recorded (appendUserMessage ran as before).
      const state = await store.get(sessionId);
      const userTurns = (state?.conversationHistory ?? []).filter(
        (e) => e.role === 'user',
      );
      expect(userTurns).toHaveLength(1);
      expect(userTurns[0]?.text).toBe('Tell me about Patagonia');
    });

    it('greeting:false also takes the normal path (default runner, user recorded)', async () => {
      const { app, store, conv, greeting } = buildApp();
      const sessionId = await bootstrapAndConsent(app);

      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: 'A real question', greeting: false });

      expect(res.status).toBe(200);
      expect(conv.callCount()).toBe(1);
      expect(greeting.callCount()).toBe(0);
      const state = await store.get(sessionId);
      expect(
        (state?.conversationHistory ?? []).filter((e) => e.role === 'user'),
      ).toHaveLength(1);
    });
  });

  describe('greeting deps NOT wired (visitor-only / unit-test deploy)', () => {
    it('greeting:true falls through to the default runner and records the user message', async () => {
      const { app, store, conv } = buildApp({ wireGreeting: false });
      const sessionId = await bootstrapAndConsent(app);

      const res = await request(app)
        .post('/chat')
        .send({ sessionId, message: '​__swoop_greeting__', greeting: true });

      expect(res.status).toBe(200);
      // No greeting runner wired → the flag is ignored; the marker runs as a
      // normal (if odd) turn on the default runner.
      expect(res.text).toContain('CONVERSATIONAL_MARKER');
      expect(conv.callCount()).toBe(1);
      const state = await store.get(sessionId);
      expect(
        (state?.conversationHistory ?? []).filter((e) => e.role === 'user'),
      ).toHaveLength(1);
    });
  });
});
