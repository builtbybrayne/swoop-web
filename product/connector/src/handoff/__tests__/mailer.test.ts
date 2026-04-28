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

  it('labels marketing consent based on the granted flag', () => {
    // Both fixtures have marketingGranted: false → "declined".
    const declined = preparePayloadForTemplate(SampleHandoffQualified);
    expect(declined.marketingConsentLabel).toBe('declined');

    // Disqualified fixture omits marketing fields → "not asked".
    const notAsked = preparePayloadForTemplate(SampleHandoffDisqualified);
    expect(notAsked.marketingConsentLabel).toBe('not asked');
  });
});
