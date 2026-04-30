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

export const ChatRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    message: z.string().min(1),
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
  })
  .strict();
export type SessionBootstrapRequest = z.infer<typeof SessionBootstrapRequestSchema>;
