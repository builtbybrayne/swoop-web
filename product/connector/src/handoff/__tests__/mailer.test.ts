/**
 * Unit tests for the handoff mailer (E.t3).
 *
 * Strategy:
 *   - Inject `MailerDeps.createTransport` to capture the SendMailOptions
 *     without touching real SMTP.
 *   - Inject `MailerDeps.readTemplate` to feed in template fixtures so the
 *     tests don't depend on the on-disk `cms/templates/handoff/*` files
 *     (those are content-as-data — exercised separately at integration time).
 *   - Use the canonical fixtures from `@swoop/common/fixtures` for the
 *     payload shapes.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SampleHandoffQualified,
  SampleHandoffReferredOut,
  SampleHandoffDisqualified,
} from '@swoop/common/fixtures';
import type { Transporter } from 'nodemailer';

import { sendHandoffEmail, preparePayloadForTemplate, type MailerConfig } from '../mailer.js';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function baseConfig(overrides: Partial<MailerConfig> = {}): MailerConfig {
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

function makeStubTransport(opts: { throwOnSend?: boolean } = {}): {
  transport: Pick<Transporter, 'sendMail'>;
  captured: CapturedSend[];
} {
  const captured: CapturedSend[] = [];
  const sendMail = vi.fn(async (options: CapturedSend) => {
    captured.push(options);
    if (opts.throwOnSend) {
      throw new Error('upstream-smtp-error');
    }
    return { messageId: 'stub-id' } as unknown as ReturnType<Transporter['sendMail']>;
  }) as unknown as Transporter['sendMail'];
  return {
    transport: { sendMail },
    captured,
  };
}

const STUB_QUALIFIED_TEMPLATE = `QUALIFIED LEAD
Name:  {{contact.name}}
Email: {{contact.email}}
Verdict: {{verdict}} ({{reason.code}})
Activities: {{visitorActivities}}
Wishlist:
{{wishlistFormatted}}
Motivation: {{motivationAnchor}}
`;

const STUB_REFERRED_TEMPLATE = `REFERRED OUT
Name: {{contact.name}}
Reason: {{reason.code}}
Why: {{reason.text}}
`;

function readTemplate(filePath: string): string {
  if (filePath.endsWith('qualified.md')) return STUB_QUALIFIED_TEMPLATE;
  if (filePath.endsWith('referred-out.md')) return STUB_REFERRED_TEMPLATE;
  throw new Error(`unexpected template path: ${filePath}`);
}

// ---------------------------------------------------------------------------
// Skip behaviours.
// ---------------------------------------------------------------------------

describe('sendHandoffEmail — skip behaviours', () => {
  it('returns `skipped/mailer_disabled` when config.enabled is false', async () => {
    const stub = makeStubTransport();
    const result = await sendHandoffEmail(
      SampleHandoffQualified,
      baseConfig({ enabled: false }),
      { createTransport: () => stub.transport, readTemplate },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'mailer_disabled' });
    expect(stub.captured.length).toBe(0);
  });

  it('returns `skipped/verdict_disqualified` for disqualified payloads, even when enabled', async () => {
    const stub = makeStubTransport();
    const result = await sendHandoffEmail(
      SampleHandoffDisqualified,
      baseConfig(),
      { createTransport: () => stub.transport, readTemplate },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'verdict_disqualified' });
    expect(stub.captured.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Qualified happy path.
// ---------------------------------------------------------------------------

describe('sendHandoffEmail — qualified', () => {
  it('routes to qualifiedRecipient with verdict-aware subject + body', async () => {
    const stub = makeStubTransport();
    const config = baseConfig();
    const result = await sendHandoffEmail(SampleHandoffQualified, config, {
      createTransport: () => stub.transport,
      readTemplate,
    });

    expect(result).toEqual({
      status: 'sent',
      toAddress: config.qualifiedRecipient,
      subject: 'Swoop lead — Ada Ríos (qualified, ready_booking_named_trip)',
    });
    expect(stub.captured.length).toBe(1);

    const sent = stub.captured[0]!;
    expect(sent.from).toBe(config.fromAddress);
    expect(sent.to).toBe(config.qualifiedRecipient);
    expect(sent.subject).toContain('Ada Ríos');
    expect(sent.subject).toContain('qualified');
    expect(sent.text).toContain('Name:  Ada Ríos');
    expect(sent.text).toContain('Email: ada.rios@example.com');
    expect(sent.text).toContain('Verdict: qualified (ready_booking_named_trip)');
    expect(sent.text).toContain('Activities: trekking, photography');
    expect(sent.text).toContain('- torres-del-paine-w-trek (trip)');
    expect(sent.text).toContain('Motivation: First big trekking trip');
  });
});

// ---------------------------------------------------------------------------
// Referred-out path + recipient fallback.
// ---------------------------------------------------------------------------

describe('sendHandoffEmail — referred_out', () => {
  it('routes to referredOutRecipient when set', async () => {
    const stub = makeStubTransport();
    const config = baseConfig();
    const result = await sendHandoffEmail(SampleHandoffReferredOut, config, {
      createTransport: () => stub.transport,
      readTemplate,
    });

    expect(result.status).toBe('sent');
    if (result.status === 'sent') {
      expect(result.toAddress).toBe(config.referredOutRecipient);
      expect(result.subject).toBe(
        'Swoop referral — Bruno Carvalho (referred_out, below_profit_floor)',
      );
    }
    const sent = stub.captured[0]!;
    expect(sent.text).toContain('Reason: below_profit_floor');
    expect(sent.text).toContain('Why: Visitor asked about a 3-night stopover');
  });

  it('falls back to qualifiedRecipient when referredOutRecipient is empty', async () => {
    const stub = makeStubTransport();
    const config = baseConfig({ referredOutRecipient: '' });
    const result = await sendHandoffEmail(SampleHandoffReferredOut, config, {
      createTransport: () => stub.transport,
      readTemplate,
    });

    expect(result.status).toBe('sent');
    if (result.status === 'sent') {
      expect(result.toAddress).toBe(config.qualifiedRecipient);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure modes.
// ---------------------------------------------------------------------------

describe('sendHandoffEmail — failure modes', () => {
  it('returns `failed/template_read_failed` when the template file is missing', async () => {
    const stub = makeStubTransport();
    const result = await sendHandoffEmail(SampleHandoffQualified, baseConfig(), {
      createTransport: () => stub.transport,
      readTemplate: () => {
        throw new Error('ENOENT: no such file');
      },
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('template_read_failed');
      expect(result.reason).toContain('ENOENT');
    }
    expect(stub.captured.length).toBe(0);
  });

  it('returns `failed/smtp_send_failed` when the transporter throws', async () => {
    const stub = makeStubTransport({ throwOnSend: true });
    const result = await sendHandoffEmail(SampleHandoffQualified, baseConfig(), {
      createTransport: () => stub.transport,
      readTemplate,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('smtp_send_failed');
      expect(result.reason).toContain('upstream-smtp-error');
    }
  });
});

// ---------------------------------------------------------------------------
// preparePayloadForTemplate (white-box: the formatting helper the mailer uses).
// ---------------------------------------------------------------------------

describe('preparePayloadForTemplate', () => {
  it('formats the activity + region arrays as comma-separated strings', () => {
    const data = preparePayloadForTemplate(SampleHandoffQualified);
    expect(data.visitorActivities).toBe('trekking, photography');
    expect(data.visitorRegions).toBe('torres-del-paine');
  });

  it('renders the wishlist as bulleted multi-line text with note suffix', () => {
    const data = preparePayloadForTemplate(SampleHandoffQualified);
    expect(data.wishlistFormatted).toBe(
      '  - torres-del-paine-w-trek (trip) — Preferred refugio-based, not camping.\n' +
        '  - torres-del-paine (region)',
    );
  });

  it('uses "(none surfaced)" placeholder for empty activity / region lists', () => {
    const data = preparePayloadForTemplate(SampleHandoffDisqualified);
    expect(data.visitorActivities).toBe('(none surfaced)');
    expect(data.visitorRegions).toBe('(none surfaced)');
  });

  it('uses placeholder text when wishlist is empty', () => {
    const data = preparePayloadForTemplate(SampleHandoffDisqualified);
    expect(data.wishlistFormatted).toBe('  (none surfaced during the conversation)');
  });

  it('renders missing optional contact fields as em-dash', () => {
    // SampleHandoffQualified has no `phone`. `formatOptional` should turn
    // undefined into the em-dash sentinel.
    const data = preparePayloadForTemplate(SampleHandoffQualified);
    expect(data.contactPhoneOrDash).toBe('—');
  });

  it('renders contactPreferredMethod as em-dash when absent from contact (U2 — widget no longer sends it)', () => {
    // The lead-capture widget no longer sends `preferredMethod` in the POST body
    // (2026-06-10 magical-poincare handoff-form round 2). `formatOptional` must
    // render `—` so the template row stays legible rather than showing blank.
    const payloadWithoutPreference = {
      ...SampleHandoffQualified,
      contact: {
        ...SampleHandoffQualified.contact,
        preferredMethod: undefined,
      },
    };
    const data = preparePayloadForTemplate(payloadWithoutPreference);
    expect(data.contactPreferredMethod).toBe('—');
  });

  it('labels marketing consent based on the granted flag', () => {
    // Both fixtures have marketingGranted: false → "declined".
    const declined = preparePayloadForTemplate(SampleHandoffQualified);
    expect(declined.marketingConsentLabel).toBe('declined');

    // Disqualified fixture omits marketing fields → "not asked".
    const notAsked = preparePayloadForTemplate(SampleHandoffDisqualified);
    expect(notAsked.marketingConsentLabel).toBe('not asked');
  });
});

// ---------------------------------------------------------------------------
// R3 (defence-in-depth) — control-char stripping in subject + template-bound
// fields. Schema-level newline rejection in @swoop/common is the primary
// guard; these tests pin the second-line scrub the mailer applies in case
// a future caller hands us partially-validated input.
// ---------------------------------------------------------------------------

describe('mailer R3 control-character defence-in-depth', () => {
  it('subject has no raw CR / LF even when contact.name contains them', async () => {
    const stub = makeStubTransport();
    const tainted = {
      ...SampleHandoffQualified,
      contact: {
        ...SampleHandoffQualified.contact,
        // Bypass the schema by building the payload object directly — we're
        // testing what the mailer does if it ever receives unsanitised input.
        name: 'Foo\r\nBcc: attacker@example.com',
      },
    };
    const result = await sendHandoffEmail(tainted, baseConfig(), {
      createTransport: () => stub.transport,
      readTemplate,
    });
    expect(result.status).toBe('sent');
    const sent = stub.captured[0]!;
    expect(sent.subject).toBeDefined();
    // The header-injection vector is the literal CR / LF that would let an
    // attacker terminate the Subject: header and start a new one. With those
    // stripped the residual `Bcc: …` text is harmless plain content.
    expect(sent.subject).not.toContain('\r');
    expect(sent.subject).not.toContain('\n');
    // Original visible name segment survives.
    expect(sent.subject).toContain('Foo');
  });

  it('subject strips CR / LF for referred_out variant too', async () => {
    const stub = makeStubTransport();
    const tainted = {
      ...SampleHandoffReferredOut,
      contact: {
        ...SampleHandoffReferredOut.contact,
        name: 'Bruno\r\nX-Injected: yes',
      },
    };
    const result = await sendHandoffEmail(tainted, baseConfig(), {
      createTransport: () => stub.transport,
      readTemplate,
    });
    expect(result.status).toBe('sent');
    const sent = stub.captured[0]!;
    expect(sent.subject).not.toMatch(/[\r\n]/);
  });

  it('preparePayloadForTemplate scrubs control chars from contact + motivationAnchor + reason.text', () => {
    const tainted = {
      ...SampleHandoffQualified,
      contact: {
        ...SampleHandoffQualified.contact,
        name: 'Ada\r\nBcc: x@y.z',
        phone: '+44\r\nfoo',
      },
      motivationAnchor: 'a\r\nb',
      reason: { code: 'ready_booking_named_trip' as const, text: 'why\r\nlines' },
    };
    const data = preparePayloadForTemplate(tainted);
    const contact = data.contact as { name: string; phone?: string };
    expect(contact.name).not.toMatch(/[\r\n]/);
    expect(contact.name).toBe('AdaBcc: x@y.z');
    expect(contact.phone).not.toMatch(/[\r\n]/);
    expect(data.motivationAnchor).not.toMatch(/[\r\n]/);
    const reason = data.reason as { text: string };
    expect(reason.text).not.toMatch(/[\r\n]/);
    expect(data.contactPhoneOrDash).not.toMatch(/[\r\n]/);
  });

  it('clean canonical fixture survives the scrub unchanged', () => {
    const data = preparePayloadForTemplate(SampleHandoffQualified);
    expect((data.contact as { name: string }).name).toBe(
      SampleHandoffQualified.contact.name,
    );
    expect(data.motivationAnchor).toBe(SampleHandoffQualified.motivationAnchor);
    expect((data.reason as { text: string }).text).toBe(
      SampleHandoffQualified.reason.text,
    );
  });
});
