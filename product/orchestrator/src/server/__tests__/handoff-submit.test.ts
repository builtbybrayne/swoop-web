/**
 * Tests for `POST /handoff/submit` — the orchestrator-side endpoint that
 * receives the lead-capture widget's form submission, enriches against
 * session state, and forwards to `submitHandoff()` in `@swoop/connector`.
 */

import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type {
  HandoffPayload,
  HandoffSubmitRequest,
  HandoffSubmitResponse,
} from '@swoop/common';
import type {
  HandoffStore,
  MailerConfig,
  SaveResult,
} from '@swoop/connector';

import { createHandoffSubmitHandler } from '../handoff-submit.js';
import { InMemorySessionStore } from '../../session/index.js';

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

function makeApp(deps: Parameters<typeof createHandoffSubmitHandler>[0]) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.post('/handoff/submit', createHandoffSubmitHandler(deps));
  return app;
}

function inMemoryHandoffStore(opts: { failOnSave?: boolean } = {}) {
  const saved: HandoffPayload[] = [];
  const store: HandoffStore = {
    async save(payload: HandoffPayload): Promise<SaveResult> {
      if (opts.failOnSave) {
        return { ok: false, reason: 'write_failed', detail: 'simulated' };
      }
      saved.push(payload);
      return {
        ok: true,
        handoffId: payload.handoffId,
        absolutePath: `/tmp/in-memory/${payload.handoffId}.json`,
      };
    },
    async get(id: string) {
      return saved.find((p) => p.handoffId === id) ?? null;
    },
    async list() {
      return saved.map((p) => p.handoffId).sort();
    },
    async delete(id: string) {
      const before = saved.length;
      const filtered = saved.filter((p) => p.handoffId !== id);
      saved.length = 0;
      saved.push(...filtered);
      return { ok: true, deleted: filtered.length !== before };
    },
    async sweep() {
      // Route-handler tests don't exercise retention; satisfy the interface
      // with a no-op success.
      return {
        ok: true,
        scanned: saved.length,
        deleted: 0,
        perVerdict: {
          qualified: 0,
          referred_out: 0,
          disqualified: 0,
          inconclusive: 0,
        },
        skipped: [],
      };
    },
  };
  return { store, saved };
}

function disabledMailer(): MailerConfig {
  return {
    enabled: false, // skip-path keeps tests offline
    templatesDirAbsolutePath: '/tmp/test/cms/templates/handoff',
    fromAddress: '',
    qualifiedRecipient: '',
    referredOutRecipient: '',
    smtp: { host: 'smtp.example.test', port: 465, secure: true },
  };
}

async function bootstrapConsentedSession(): Promise<{
  sessionStore: InMemorySessionStore;
  sessionId: string;
}> {
  const sessionStore = new InMemorySessionStore();
  const state = await sessionStore.create({
    metadata: { entryUrl: 'https://www.swoop-patagonia.com/trips/w-trek' },
    wishlist: {
      items: [
        { entityType: 'trip', slug: 'torres-del-paine-w-trek', noted: 'preferred refugio' },
        { entityType: 'region', slug: 'torres-del-paine' },
      ],
      motivationAnchor: 'first big trekking trip',
    },
  });
  // Grant tier-1 consent (mirrors what `PATCH /session/:id/consent` does).
  await sessionStore.update(state.sessionId, (s) => ({
    ...s,
    consent: {
      ...s.consent,
      conversation: {
        granted: true,
        timestamp: '2026-04-22T09:00:04.000Z',
        copyVersion: 'v1',
      },
    },
  }));
  return { sessionStore, sessionId: state.sessionId };
}

/**
 * Build a valid `HandoffSubmitRequest` body. Defaults to a qualified
 * variant; callers pass overrides to swap to another variant.
 *
 * Per VERDICT-E.t1 (2026-05-13): the schema is now a discriminated union
 * over `verdict`. Spreading `Partial<HandoffSubmitRequest>` over an object
 * literal widens the inferred type beyond what the union's exact variant
 * narrowing accepts. The `as` cast at the return site says "the call site
 * is responsible for passing overrides consistent with the resulting
 * variant"; the actual runtime parse against `HandoffSubmitRequestSchema`
 * is what enforces correctness — and the existing test cases pin every
 * verdict + reasonCode + contact-required combination.
 */
function validRequestBody(
  sessionId: string,
  overrides: Record<string, unknown> = {},
): HandoffSubmitRequest {
  return {
    sessionId,
    verdict: 'qualified',
    reasonCode: 'ready_booking_named_trip',
    reasonText: 'Visitor asked how to book the W-Trek for November.',
    motivationAnchor: 'first big trekking trip',
    contact: {
      name: 'Ada Ríos',
      email: 'ada.rios@example.com',
      preferredMethod: 'email',
    },
    consent: {
      handoffGranted: true,
      handoffTimestamp: '2026-04-22T09:07:19.000Z',
      marketingGranted: false,
      consentCopyVersion: 'consent-handoff/v1',
    },
    ...overrides,
  } as HandoffSubmitRequest;
}

// ---------------------------------------------------------------------------
// Happy path.
// ---------------------------------------------------------------------------

describe('POST /handoff/submit — happy paths', () => {
  it('qualified: enriches against session state, persists, returns ok with skipped email (mailer disabled)', async () => {
    const { sessionStore, sessionId } = await bootstrapConsentedSession();
    const handoff = inMemoryHandoffStore();
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });

    const res = await request(app).post('/handoff/submit').send(validRequestBody(sessionId));

    expect(res.status).toBe(200);
    const body = res.body as HandoffSubmitResponse;
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect(body.handoffId).toMatch(/^handoff_[a-zA-Z0-9_]+$/);
      expect(body.emailStatus).toBe('skipped');
      expect(body.emailReason).toBe('mailer_disabled');
    }

    // Durable record landed.
    expect(handoff.saved.length).toBe(1);
    const saved = handoff.saved[0]!;
    if (saved.verdict !== 'qualified') {
      throw new Error(`expected qualified, got ${saved.verdict}`);
    }
    expect(saved.contact).toEqual({
      name: 'Ada Ríos',
      email: 'ada.rios@example.com',
      preferredMethod: 'email',
    });
    expect(saved.reason.code).toBe('ready_booking_named_trip');
    expect(saved.reason.text).toContain('W-Trek');
    expect(saved.session.sessionId).toBe(sessionId);
    expect(saved.session.entryUrl).toBe('https://www.swoop-patagonia.com/trips/w-trek');
    expect(saved.consent.conversationGranted).toBe(true);
    expect(saved.consent.conversationTimestamp).toBe('2026-04-22T09:00:04.000Z');
    expect(saved.consent.handoffGranted).toBe(true);
    expect(saved.consent.consentCopyVersion).toBe('consent-handoff/v1');

    // Wishlist mapped from session (noted → note).
    expect(saved.wishlist).toEqual([
      { entityType: 'trip', slug: 'torres-del-paine-w-trek', note: 'preferred refugio' },
      { entityType: 'region', slug: 'torres-del-paine' },
    ]);

    expect(saved.motivationAnchor).toBe('first big trekking trip');
  });

  it('referred_out: persists with referred_out variant, no contact-required failure', async () => {
    const { sessionStore, sessionId } = await bootstrapConsentedSession();
    const handoff = inMemoryHandoffStore();
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app)
      .post('/handoff/submit')
      .send(
        validRequestBody(sessionId, {
          verdict: 'referred_out',
          reasonCode: 'below_profit_floor',
          reasonText: 'Stopover-only enquiry; below the profit floor.',
        }),
      );

    expect(res.status).toBe(200);
    expect(handoff.saved[0]!.verdict).toBe('referred_out');
  });

  it('disqualified: persists without contact field (per .strict() schema)', async () => {
    const { sessionStore, sessionId } = await bootstrapConsentedSession();
    const handoff = inMemoryHandoffStore();
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app)
      .post('/handoff/submit')
      .send(
        validRequestBody(sessionId, {
          verdict: 'disqualified',
          reasonCode: 'proxy_to_claude',
          reasonText: 'Visitor used the chat to ask about a Python script.',
          contact: undefined,
        }),
      );

    expect(res.status).toBe(200);
    const saved = handoff.saved[0]!;
    expect(saved.verdict).toBe('disqualified');
    expect(saved).not.toHaveProperty('contact');
  });
});

// ---------------------------------------------------------------------------
// Failure modes.
// ---------------------------------------------------------------------------

describe('POST /handoff/submit — failure modes', () => {
  it('400 invalid_request when the body fails the wire schema', async () => {
    const { sessionStore } = await bootstrapConsentedSession();
    const handoff = inMemoryHandoffStore();
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app).post('/handoff/submit').send({ verdict: 'unknown' });
    expect(res.status).toBe(400);
    expect((res.body as HandoffSubmitResponse).ok).toBe(false);
    if (!res.body.ok) {
      expect(res.body.reason).toBe('invalid_request');
    }
  });

  it('404 session_not_found when the session id does not exist', async () => {
    const sessionStore = new InMemorySessionStore();
    const handoff = inMemoryHandoffStore();
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app)
      .post('/handoff/submit')
      .send(validRequestBody('does-not-exist'));
    expect(res.status).toBe(404);
    if (!res.body.ok) {
      expect(res.body.reason).toBe('session_not_found');
    }
  });

  it('403 consent_required when tier-1 consent was never granted', async () => {
    const sessionStore = new InMemorySessionStore();
    const state = await sessionStore.create({});
    const handoff = inMemoryHandoffStore();
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app)
      .post('/handoff/submit')
      .send(validRequestBody(state.sessionId));
    expect(res.status).toBe(403);
    if (!res.body.ok) {
      expect(res.body.reason).toBe('consent_required');
    }
  });

  it('400 invalid_request when verdict is qualified but no contact is supplied', async () => {
    const { sessionStore, sessionId } = await bootstrapConsentedSession();
    const handoff = inMemoryHandoffStore();
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app)
      .post('/handoff/submit')
      .send(validRequestBody(sessionId, { contact: undefined }));
    expect(res.status).toBe(400);
    if (!res.body.ok) {
      expect(res.body.reason).toBe('invalid_request');
      // Per VERDICT-E.t1 (2026-05-13): the schema is a discriminated union,
      // so a qualified payload missing `contact` fails with the Zod path-
      // prefixed `contact: Required` (variant-specific) rather than a
      // custom "contact is required" string. Both phrasings point at the
      // same shape mismatch.
      expect(res.body.detail).toMatch(/contact/i);
      expect(res.body.detail).toMatch(/required/i);
    }
  });

  it('500 store_failed when the underlying store rejects the save', async () => {
    const { sessionStore, sessionId } = await bootstrapConsentedSession();
    const handoff = inMemoryHandoffStore({ failOnSave: true });
    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app).post('/handoff/submit').send(validRequestBody(sessionId));
    expect(res.status).toBe(500);
    if (!res.body.ok) {
      expect(res.body.reason).toBe('store_failed');
    }
  });

  it('emits a handoff.submitted event on success', async () => {
    const { sessionStore, sessionId } = await bootstrapConsentedSession();
    const handoff = inMemoryHandoffStore();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const app = makeApp({
      sessionStore,
      handoffStore: handoff.store,
      mailerConfig: disabledMailer(),
    });
    const res = await request(app).post('/handoff/submit').send(validRequestBody(sessionId));
    expect(res.status).toBe(200);

    const eventLine = logSpy.mock.calls.find(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].includes('"eventType":"handoff.submitted"'),
    );
    expect(eventLine).toBeDefined();
    expect(eventLine?.[0]).toContain('"verdict":"qualified"');
    expect(eventLine?.[0]).toContain('"emailDeliveryStatus":"skipped"');

    // H3 (2026-04-30 review): a handoff.email.* event lands alongside
    // handoff.submitted. With the mailer disabled, that's email.skipped
    // reason mailer_disabled.
    const emailEventLine = logSpy.mock.calls.find(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].includes('"eventType":"handoff.email.skipped"'),
    );
    expect(emailEventLine).toBeDefined();
    expect(emailEventLine?.[0]).toContain('"reason":"mailer_disabled"');
    expect(emailEventLine?.[0]).toContain('"verdict":"qualified"');

    logSpy.mockRestore();
  });
});
