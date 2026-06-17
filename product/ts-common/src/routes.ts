// -----------------------------------------------------------------------------
// Orchestrator HTTP route request schemas.
//
// Centralised here so UI and orchestrator typecheck against the same wire
// shapes, mirroring `HandoffSubmitRequestSchema` in handoff.ts. All schemas
// are `.strict()` — unknown fields are rejected to keep the surface honest.
//
// Theme-A.1 (2026-04-30 code review) — these replace hand-rolled `typeof`
// validation in the corresponding route handlers (`chat.ts`,
// `consent.ts`, `session-bootstrap.ts`).
//
// `SessionBootstrapRequestSchema.entryUrl` is `.url()`-validated, which also
// closes Sec-3 (the prior hand-rolled handler accepted any string,
// propagating arbitrary `javascript:` / `data:` URLs into events and the
// handoff record).
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// POST /chat
// -----------------------------------------------------------------------------

/**
 * Per-message length cap (R4-server, 2026-04-30 code review). 8 000 chars
 * is comfortably above any plausible visitor utterance and well below the
 * `express.json` body limit, so the field cap and the body cap close the
 * unbounded-input vector together. Rejection at this layer means the
 * oversize never reaches event payload sha256 inputs or runner history.
 */
export const CHAT_MESSAGE_MAX = 8_000;

/**
 * Visitor clock context forwarded from the browser on every /chat request
 * (B.t12 — browser timestamp → agent context).
 *
 * `iso`      — `new Date().toISOString()` with UTC offset, e.g. "2026-06-10T17:42:01+01:00".
 * `timeZone` — IANA zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`,
 *              e.g. "Europe/London".
 *
 * Optional so old clients / harness fixtures that predate B.t12 remain valid.
 * Malformed → 400 via the route-boundary Zod parse (`.strict()` stays).
 */
export const ClientTimeSchema = z
  .object({
    iso: z.string().datetime({ offset: true }),
    timeZone: z.string().min(1).max(64),
  })
  .strict();
export type ClientTime = z.infer<typeof ClientTimeSchema>;

export const ChatRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    message: z.string().min(1).max(CHAT_MESSAGE_MAX),
    clientTime: ClientTimeSchema.optional(),
    /**
     * Optional model override for the conversational orchestrator (dev/test
     * only). The orchestrator ignores it unless `NODE_ENV !== 'production'`
     * AND the id is in `MODEL_PICKER_ALLOWLIST`. Bare alias, e.g.
     * `"claude-opus-4-8"`. See
     * planning/03-exec-crosscut-test-mode-model-picker.md.
     */
    model: z.string().min(1).max(128).optional(),
    /**
     * Staff JWT forwarded by the UI on every request when the staff member
     * has authenticated (staff-auth task). Optional so existing sessions
     * without the field round-trip cleanly — absent token → visitor session,
     * no error. The orchestrator validates this server-side and sets
     * session.staff + session.mode; the client value is never trusted as-is.
     *
     * Mirror of how B.t12 added `clientTime` — additive, backward-compatible,
     * `.strict()` accepts it explicitly so malformed fields still 400.
     */
    staffToken: z.string().optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// -----------------------------------------------------------------------------
// PATCH /session/:id/consent
// -----------------------------------------------------------------------------

export const ConsentRequestSchema = z
  .object({
    granted: z.boolean(),
    copyVersion: z.string().min(1),
  })
  .strict();
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

// -----------------------------------------------------------------------------
// POST /session
//
// Body is optional (the route accepts an empty body — `req.body` may be `{}`
// or even undefined depending on the client). Both `entryUrl` and
// `regionInterestHint` are optional metadata hints carried into session state.
// -----------------------------------------------------------------------------

export const SessionBootstrapRequestSchema = z
  .object({
    entryUrl: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//i.test(u), {
        message: "entryUrl must be http(s)",
      })
      .optional(),
    regionInterestHint: z.string().optional(),
    /**
     * Staff JWT forwarded by the UI on session bootstrap (staff-auth task).
     * Optional — absent token gives a normal visitor session. Validated
     * server-side by the orchestrator; the session.staff + session.mode
     * flags are set from the decoded token, never from this field directly.
     */
    staffToken: z.string().optional(),
  })
  .strict();
export type SessionBootstrapRequest = z.infer<typeof SessionBootstrapRequestSchema>;
