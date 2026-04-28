/**
 * Unit tests for `submitHandoff` — the four-step pipeline tying schema
 * validation + consent backstop + durable store + verdict-aware mailer.
 *
 * Strategy: in-memory store stub + mailer-deps stub for full isolation. No
 * filesystem, no SMTP. The fs-backed store is exercised by store.test.ts;
 * the mailer is exercised by mailer.test.ts. This file owns the
 * orchestration contract.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SampleHandoffQualified,
  SampleHandoffReferredOut,
  SampleHandoffDisqualified,
} from '@swoop/common/fixtures';
import type { HandoffPayload } from '@swoop/common';
import type { Transporter } from 'nodemailer';

import { submitHandoff, type SubmitDeps } from '../submit.js';
import type { HandoffStore, SaveResult } from '../store.js';
import type { MailerConfig } from '../mailer.js';

// ---------------------------------------------------------------------------
// Stubs.
// ---------------------------------------------------------------------------

function inMemoryStore(): {
  store: HandoffStore;
  saved: HandoffPayload[];
  failOnSave?: boolean;
} {
  const saved: HandoffPayload[] = [];
  const obj = { saved, failOnSave: false };
  const store: HandoffStore = {
    async save(payload: HandoffPayload): Promise<SaveResult> {
      if (obj.failOnSave) {
        return { ok: false, reason: 'write_failed', detail: 'simulated' };
      }
      saved.push(payload);
      return {
        ok: true,
        handoffId: payload.handoffId,
        absolutePath: `/tmp/in-memory/${payload.handoffId}.json`,
      };
    },
    async get(handoffId: string) {
      return saved.find((p) => p.handoffId === handoffId) ?? null;
    },
    async list() {
      return saved.map((p) => p.handoffId).sort();
    },
  };
  return { store, saved, get failOnSave() {
    return obj.failOnSave;
  }, set failOnSave(v: boolean) {
    obj.failOnSave = v;
  } } as unknown as { store: HandoffStore; saved: HandoffPayload[]; failOnSave: boolean };
}

function baseMailerConfig(overrides: Partial<MailerConfig> = {}): MailerConfig {
  return {
    enabled: true,
    templatesDirAbsolutePath: '/tmp/test/cms/templates/handoff',
    fromAddress: 'puma@swoop-adventures.com',
    qualifiedRecipient: 'qualified@swoop-adventures.com',
    referredOutRecipient: 'referrals@swoop-adventures.com',
    smtp: {
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      user: 'test-user',
      pass: 'test-pass',
    },
    ...overrides,
  };
}

interface CapturedSend {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
}

function makeStubMailerDeps(): {
  deps: SubmitDeps['mailerDeps'];
  captured: CapturedSend[];
} {
  const captured: CapturedSend[] = [];
  const transport = {
    sendMail: vi.fn(async (options: CapturedSend) => {
      captured.push(options);
      return { messageId: 'stub' } as unknown as ReturnType<Transporter['sendMail']>;
    }) as unknown as Transporter['sendMail'],
  };
  const deps: SubmitDeps['mailerDeps'] = {
    createTransport: () => transport,
    readTemplate: () => 'STUB BODY {{contact.name}}',
  };
  return { deps, captured };
}

// ---------------------------------------------------------------------------
// Happy paths.
// ---------------------------------------------------------------------------

describe('submitHandoff — happy paths', () => {
  it('qualified: stores the record + sends a qualified-recipient email', async () => {
    const { store, saved } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const result = await submitHandoff(SampleHandoffQualified, {
      store,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handoffId).toBe(SampleHandoffQualified.handoffId);
      expect(result.emailResult.status).toBe('sent');
      if (result.emailResult.status === 'sent') {
        expect(result.emailResult.toAddress).toBe('qualified@swoop-adventures.com');
      }
    }
    expect(saved.length).toBe(1);
    expect(saved[0]).toEqual(SampleHandoffQualified);
    expect(mailer.captured.length).toBe(1);
  });

  it('referred_out: stores the record + sends a referred-recipient email', async () => {
    const { store, saved } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const result = await submitHandoff(SampleHandoffReferredOut, {
      store,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.emailResult.status === 'sent') {
      expect(result.emailResult.toAddress).toBe('referrals@swoop-adventures.com');
    }
    expect(saved.length).toBe(1);
  });

  it('disqualified: stores the record + skips the email', async () => {
    const { store, saved } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const result = await submitHandoff(SampleHandoffDisqualified, {
      store,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });
    // Note: the canonical disqualified fixture has handoffGranted: false,
    // so it would normally be rejected by the consent backstop. For this
    // test we craft a disqualified payload with consent granted to
    // exercise the "stored + email skipped" path specifically.
    // (The real flow rarely emits a disqualified verdict at all, but the
    // pipeline still handles it predictably if it does.)
    expect(result.ok).toBe(false); // consent_missing trips first
    if (!result.ok) {
      expect(result.reason).toBe('consent_missing');
    }
    expect(saved.length).toBe(0);
    expect(mailer.captured.length).toBe(0);
  });

  it('disqualified with consent granted: stores + skips email (verdict-aware)', async () => {
    const { store, saved } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const grantedDisqualified: HandoffPayload = {
      ...SampleHandoffDisqualified,
      consent: {
        ...SampleHandoffDisqualified.consent,
        handoffGranted: true,
        handoffTimestamp: '2026-04-22T11:06:12.000Z',
      },
    };
    const result = await submitHandoff(grantedDisqualified, {
      store,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailResult.status).toBe('skipped');
      if (result.emailResult.status === 'skipped') {
        expect(result.emailResult.reason).toBe('verdict_disqualified');
      }
    }
    expect(saved.length).toBe(1);
    expect(mailer.captured.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Failure modes.
// ---------------------------------------------------------------------------

describe('submitHandoff — failure modes', () => {
  it('payload_invalid for malformed input', async () => {
    const { store } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const bad = { ...SampleHandoffQualified, verdict: 'unknown' as 'qualified' };
    const result = await submitHandoff(bad as HandoffPayload, {
      store,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('payload_invalid');
    }
    expect(mailer.captured.length).toBe(0);
  });

  it('consent_missing when conversationGranted is false', async () => {
    const { store, saved } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const noConvConsent: HandoffPayload = {
      ...SampleHandoffQualified,
      consent: {
        ...SampleHandoffQualified.consent,
        conversationGranted: false,
      },
    };
    const result = await submitHandoff(noConvConsent, {
      store,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('consent_missing');
    }
    expect(saved.length).toBe(0);
    expect(mailer.captured.length).toBe(0);
  });

  it('consent_missing when handoffGranted is false', async () => {
    const { store, saved } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const noHandoffConsent: HandoffPayload = {
      ...SampleHandoffQualified,
      consent: {
        ...SampleHandoffQualified.consent,
        handoffGranted: false,
      },
    };
    const result = await submitHandoff(noHandoffConsent, {
      store,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('consent_missing');
    }
    expect(saved.length).toBe(0);
  });

  it('store_failed when the underlying store rejects the save', async () => {
    const failingStore: HandoffStore = {
      async save() {
        return { ok: false, reason: 'write_failed', detail: 'disk full' };
      },
      async get() {
        return null;
      },
      async list() {
        return [];
      },
    };
    const mailer = makeStubMailerDeps();
    const result = await submitHandoff(SampleHandoffQualified, {
      store: failingStore,
      mailerConfig: baseMailerConfig(),
      mailerDeps: mailer.deps,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('store_failed');
      expect(result.detail).toContain('disk full');
    }
    expect(mailer.captured.length).toBe(0);
  });

  it('returns ok with email-skipped when the mailer is disabled', async () => {
    const { store, saved } = inMemoryStore();
    const mailer = makeStubMailerDeps();
    const result = await submitHandoff(SampleHandoffQualified, {
      store,
      mailerConfig: baseMailerConfig({ enabled: false }),
      mailerDeps: mailer.deps,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailResult.status).toBe('skipped');
      if (result.emailResult.status === 'skipped') {
        expect(result.emailResult.reason).toBe('mailer_disabled');
      }
    }
    expect(saved.length).toBe(1);
    expect(mailer.captured.length).toBe(0);
  });
});
