/**
 * `POST /handoff/submit` — orchestrator-side endpoint for the lead-capture
 * widget's form submission (E.t3).
 *
 * Flow:
 *   1. Validate the request body against `HandoffSubmitRequestSchema`.
 *   2. Look up the session — 404 if unknown.
 *   3. Verify tier-1 (conversation) consent on the session — 403 otherwise.
 *   4. Enrich the request into a full `HandoffPayload`:
 *      - Generate a `handoffId`.
 *      - Combine tier-1 consent (from session state) with tier-2 (from body).
 *      - Snapshot session metadata: createdAt → conversationStartedAt, now →
 *        handoffSubmittedAt, history length → turnCount, metadata.entryUrl.
 *      - Pull `wishlist` items from session state (mapping `noted` → `note`).
 *      - Default `visitorProfile` to empty when no signal exists today; future
 *        chunks will populate it from the triage classifier or a psych agent.
 *   5. Hand the enriched payload to `submitHandoff()` from `@swoop/connector`,
 *      which validates against `HandoffPayloadSchema`, runs the consent
 *      backstop, persists durably, and sends the verdict-aware email.
 *   6. Emit a `handoff.submitted` event for chunk F observability.
 *   7. Return a typed `HandoffSubmitResponse` (success or structured failure).
 *
 * No SSE here — this is a discrete user action, not part of the chat stream.
 * The widget POSTs and awaits a JSON response.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import {
  HandoffSubmitRequestSchema,
  emitEvent,
  messageOf,
  type HandoffPayload,
  type HandoffPayloadDisqualified,
  type HandoffPayloadInconclusive,
  type HandoffPayloadQualified,
  type HandoffPayloadReferredOut,
  type HandoffSubmitResponse,
  type SessionState,
} from '@swoop/common';
import {
  submitHandoff,
  type MailerConfig,
  type HandoffStore,
} from '@swoop/connector';

import type { SessionStore } from '../session/index.js';
import { sendError } from './errors.js';

export interface HandoffSubmitDeps {
  readonly sessionStore: SessionStore;
  readonly handoffStore: HandoffStore;
  readonly mailerConfig: MailerConfig;
  readonly now?: () => Date;
}

export function createHandoffSubmitHandler(
  deps: HandoffSubmitDeps,
): (req: Request, res: Response) => Promise<void> {
  const clock = deps.now ?? (() => new Date());

  return async function handleHandoffSubmit(req, res) {
    // ---- 1. Validate body ------------------------------------------------
    const parsed = HandoffSubmitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      const body: HandoffSubmitResponse = {
        ok: false,
        reason: 'invalid_request',
        detail,
      };
      res.status(400).json(body);
      return;
    }
    const reqBody = parsed.data;

    // ---- 2. Look up session ---------------------------------------------
    const session = await deps.sessionStore.get(reqBody.sessionId);
    if (!session) {
      const body: HandoffSubmitResponse = {
        ok: false,
        reason: 'session_not_found',
        detail: `No session with id ${reqBody.sessionId}`,
      };
      res.status(404).json(body);
      return;
    }

    // ---- 3. Tier-1 consent gate (server is the source of truth) ---------
    if (!session.consent.conversation.granted) {
      const body: HandoffSubmitResponse = {
        ok: false,
        reason: 'consent_required',
        detail: 'tier-1 (conversation) consent has not been granted on this session',
      };
      res.status(403).json(body);
      return;
    }

    // ---- 4. Enrich into a full HandoffPayload ---------------------------
    let payload: HandoffPayload;
    try {
      payload = enrichPayload({ reqBody, session, now: clock() });
    } catch (err) {
      const message = messageOf(err);
      const body: HandoffSubmitResponse = {
        ok: false,
        reason: 'invalid_request',
        detail: `enrichment failed: ${message}`,
      };
      res.status(400).json(body);
      return;
    }

    // ---- 5. Submit via the connector pipeline ----------------------------
    const submitResult = await submitHandoff(payload, {
      store: deps.handoffStore,
      mailerConfig: deps.mailerConfig,
    });

    if (!submitResult.ok) {
      // submitHandoff already validated the payload (belt + braces) and
      // checked the consent gate. Map its reason space onto the wire shape.
      const body: HandoffSubmitResponse = {
        ok: false,
        reason: submitResult.reason === 'payload_invalid'
          ? 'invalid_request'
          : submitResult.reason === 'consent_missing'
            ? 'consent_missing'
            : 'store_failed',
        detail: submitResult.detail,
      };
      // 422 for consent / payload issues, 500 for store failure.
      const status =
        submitResult.reason === 'store_failed' ? 500 : 422;
      res.status(status).json(body);
      return;
    }

    // ---- 6. Observability event ------------------------------------------
    emitEvent({
      eventType: 'handoff.submitted',
      eventVersion: 1,
      timestamp: clock().toISOString(),
      sessionId: session.sessionId,
      turnIndex: null,
      actor: 'user',
      payload: {
        handoffId: submitResult.handoffId,
        verdict: payload.verdict,
        consentConversationGranted: payload.consent.conversationGranted,
        consentHandoffGranted: payload.consent.handoffGranted,
        emailDeliveryStatus:
          submitResult.emailResult.status === 'sent'
            ? 'sent'
            : submitResult.emailResult.status === 'failed'
              ? 'bounced'
              : 'skipped',
      },
    });

    // ---- 7. Success response --------------------------------------------
    const body: HandoffSubmitResponse = {
      ok: true,
      handoffId: submitResult.handoffId,
      emailStatus:
        submitResult.emailResult.status === 'sent'
          ? 'sent'
          : submitResult.emailResult.status === 'failed'
            ? 'failed'
            : 'skipped',
      ...(submitResult.emailResult.status !== 'sent' && 'reason' in submitResult.emailResult
        ? { emailReason: submitResult.emailResult.reason }
        : {}),
    };
    res.status(200).json(body);
  };
}

// ---------------------------------------------------------------------------
// Enrichment.
//
// Builds the full HandoffPayload from (a) the widget's submission body and
// (b) the server-side session snapshot. Throws on shape mismatches the schema
// would catch later — surfacing them here gives a tidier 400 response than a
// generic Zod validation failure inside `submitHandoff`.
// ---------------------------------------------------------------------------

interface EnrichArgs {
  readonly reqBody: import('@swoop/common').HandoffSubmitRequest;
  readonly session: SessionState;
  readonly now: Date;
}

function enrichPayload(args: EnrichArgs): HandoffPayload {
  const { reqBody, session, now } = args;
  const handoffId = generateHandoffId(session.sessionId);

  const consent = {
    conversationGranted: session.consent.conversation.granted,
    conversationTimestamp: session.consent.conversation.timestamp,
    handoffGranted: reqBody.consent.handoffGranted,
    handoffTimestamp: reqBody.consent.handoffTimestamp,
    ...(reqBody.consent.consentCopyVersion !== undefined
      ? { consentCopyVersion: reqBody.consent.consentCopyVersion }
      : {}),
  };

  const sessionMeta = {
    sessionId: session.sessionId,
    conversationStartedAt: session.createdAt,
    handoffSubmittedAt: now.toISOString(),
    turnCount: session.conversationHistory.length,
    ...(session.metadata.entryUrl ? { entryUrl: session.metadata.entryUrl } : {}),
    ...(session.metadata.variantId ? { variantId: session.metadata.variantId } : {}),
    rawConversationRef: session.sessionId,
  };

  // Wishlist mapping. SessionState.wishlist.items has `noted` (typo or
  // historical accident); HandoffWishlistEntry uses `note`. We map across.
  const wishlist = session.wishlist.items.map((item) => ({
    entityType: item.entityType,
    slug: item.slug,
    ...(item.noted ? { note: item.noted } : {}),
  }));

  // Visitor profile defaults — no signal source today (triage classifier
  // doesn't populate this yet). Future chunks fill in from a psych agent.
  const visitorProfile = {
    activityInclination: [] as string[],
    regionInterest: session.metadata.regionInterestHint
      ? [session.metadata.regionInterestHint]
      : [],
    budgetBand: 'unknown' as const,
  };

  const motivationAnchor =
    reqBody.motivationAnchor ?? session.wishlist.motivationAnchor ?? '';

  // Two visitor-influenced fields land on the durable payload as-is from
  // the wire (frosty-leavitt-handoff-form-polish, 2026-05-19):
  //   - visitorPrecis: the logistical-only summary the visitor was shown
  //     inside the lead-capture form. Persisted for audit; NEVER reaches
  //     the email body (mailer renders `additionalNotes`, not this).
  //   - additionalNotes: free text from the visitor's "Anything else?"
  //     textarea. Renders into the specialist email via the new
  //     `additionalNotesOrNone` mailer template field.
  const common = {
    handoffId,
    visitorProfile,
    wishlist,
    motivationAnchor,
    ...(reqBody.visitorPrecis ? { visitorPrecis: reqBody.visitorPrecis } : {}),
    ...(reqBody.additionalNotes ? { additionalNotes: reqBody.additionalNotes } : {}),
    consent,
    session: sessionMeta,
  };

  switch (reqBody.verdict) {
    case 'qualified': {
      if (!reqBody.contact) {
        throw new Error('contact is required when verdict is qualified');
      }
      const out: HandoffPayloadQualified = {
        verdict: 'qualified',
        contact: reqBody.contact,
        // Reason-code is a per-verdict enum; we cast through unknown because
        // the request body declares it as a string. The submitHandoff
        // pipeline re-validates against HandoffPayloadSchema and will reject
        // any unknown code.
        reason: { code: reqBody.reasonCode as never, text: reqBody.reasonText },
        ...common,
      };
      return out;
    }
    case 'referred_out': {
      if (!reqBody.contact) {
        throw new Error('contact is required when verdict is referred_out');
      }
      const out: HandoffPayloadReferredOut = {
        verdict: 'referred_out',
        contact: reqBody.contact,
        reason: { code: reqBody.reasonCode as never, text: reqBody.reasonText },
        ...common,
      };
      return out;
    }
    case 'disqualified': {
      const out: HandoffPayloadDisqualified = {
        verdict: 'disqualified',
        reason: { code: reqBody.reasonCode as never, text: reqBody.reasonText },
        ...common,
      };
      return out;
    }
    case 'inconclusive': {
      // No contact field on inconclusive — same as disqualified per HITL Q5.
      // Agent never reached confidence to surface the lead-capture widget.
      const out: HandoffPayloadInconclusive = {
        verdict: 'inconclusive',
        reason: { code: reqBody.reasonCode as never, text: reqBody.reasonText },
        ...common,
      };
      return out;
    }
  }
}

function generateHandoffId(sessionId: string): string {
  // Format: `handoff_<short-uuid>` keeps the id filesystem-safe (matches
  // FsHandoffStore.HANDOFF_ID_PATTERN) and short enough to grep. The session
  // id is intentionally NOT embedded — handoff records are independently
  // discoverable, and a leaked store dir shouldn't reveal session ids.
  void sessionId;
  return `handoff_${randomUUID().replaceAll('-', '_')}`;
}

// Re-export so `sendError` is available if the route is wired through a
// shared error path later. Currently each branch sends a typed
// `HandoffSubmitResponse` body directly.
export { sendError };
