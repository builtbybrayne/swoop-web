// -----------------------------------------------------------------------------
// Session state — what the agent loop holds across turns.
//
// Per planning/02-impl-agent-runtime.md §2.6 + planning/02-impl-handoff-and-compliance.md §2.3.
//
// Key shape decisions:
//   - Triage state is a discriminated union on `verdict` so consumers get
//     exhaustive-match safety. `null` verdict is modelled as `{ verdict: "none" }`
//     rather than nullable fields so the union stays clean.
//   - Consent state carries a `copyVersion` alongside the boolean + timestamp.
//     GDPR-adjacent consent needs to be traceable back to the exact copy the
//     visitor saw (chunk E §2.6 authors versioned copy files).
//   - Tier-1 `conversation` consent is REQUIRED for the orchestrator to accept
//     any user turn (chunk B §2.6 + chunk E §2.3). Tier-2 `handoff` consent
//     gates `handoff_submit`. Marketing consent is optional and orthogonal.
// -----------------------------------------------------------------------------

import { z } from "zod";

import { SeenItemsSchema } from "./seen-items.js";

// -----------------------------------------------------------------------------
// Conversation-history entry — a minimal stub. The real ADK SessionService
// manages full history; this shape is what Puma exposes to code that reads
// session state directly (observability, eval harness). Block types (§2.5a of
// chunk B) map through here.
// -----------------------------------------------------------------------------

export const ConversationEntrySchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  role: z.enum(["user", "agent", "system"]),
  blockType: z.enum(["utter", "reasoning", "fyi", "adjunct", "user_message"]),
  text: z.string(),
  timestamp: z.string().datetime(),
});
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;

// -----------------------------------------------------------------------------
// Triage state — discriminated union so consumers get exhaustive-match safety.
//
// Why union-on-verdict rather than { verdict: nullable, reason: nullable }:
// ensures the "no verdict yet" case has no stray reason field, and qualified /
// referred_out / disqualified can evolve per-verdict structure later without
// breaking the null branch.
// -----------------------------------------------------------------------------

export const TriageStateNoneSchema = z.object({
  verdict: z.literal("none"),
});

export const TriageStateQualifiedSchema = z.object({
  verdict: z.literal("qualified"),
  reasonCode: z.string(),
  reasonText: z.string(),
  decidedAt: z.string().datetime(),
});

export const TriageStateReferredOutSchema = z.object({
  verdict: z.literal("referred_out"),
  reasonCode: z.string(),
  reasonText: z.string(),
  decidedAt: z.string().datetime(),
});

export const TriageStateDisqualifiedSchema = z.object({
  verdict: z.literal("disqualified"),
  reasonCode: z.string(),
  reasonText: z.string(),
  decidedAt: z.string().datetime(),
});

// `inconclusive` (HITL Q5, 2026-04-30): Path 7 visitors — agent never reaches
// confidence to qualify, refer-out, or disqualify. Mirrors the disqualified
// variant; downstream consequences (no email, 90-day retention) are the same
// per E.3 / E.7 patterns. Final reason-code taxonomy lives in
// HandoffPayload.reason.code (per-verdict enum); session-side stays freeform
// per the decoupling rationale in planning/03-exec-handoff-t1.md.
export const TriageStateInconclusiveSchema = z.object({
  verdict: z.literal("inconclusive"),
  reasonCode: z.string(),
  reasonText: z.string(),
  decidedAt: z.string().datetime(),
});

export const TriageStateSchema = z.discriminatedUnion("verdict", [
  TriageStateNoneSchema,
  TriageStateQualifiedSchema,
  TriageStateReferredOutSchema,
  TriageStateDisqualifiedSchema,
  TriageStateInconclusiveSchema,
]);
export type TriageState = z.infer<typeof TriageStateSchema>;

// -----------------------------------------------------------------------------
// Consent state (chunk E §2.3).
//
// Each tier is a { granted, timestamp, copyVersion? } object. `copyVersion`
// points at the versioned content file the visitor saw — essential for
// responding to a GDPR audit months later.
// -----------------------------------------------------------------------------

export const ConsentRecordSchema = z.object({
  granted: z.boolean(),
  timestamp: z.string().datetime(),
  copyVersion: z.string().optional(),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const ConsentStateSchema = z.object({
  // Tier 1: conversation consent. Required before ANY user-message history
  // is written to session state; the orchestrator refuses turns without it.
  conversation: ConsentRecordSchema,
  // Tier 2: handoff consent. Captured inside the lead-capture widget before
  // handoff_submit fires.
  handoff: ConsentRecordSchema,
  // Optional: marketing opt-in. Unticked by default; orthogonal to the above.
  marketing: ConsentRecordSchema.optional(),
});
export type ConsentState = z.infer<typeof ConsentStateSchema>;

// -----------------------------------------------------------------------------
// Wishlist-in-progress — what the handoff payload will carry if the
// conversation converts. Shape firms up during chunk E Tier 3.
// -----------------------------------------------------------------------------

export const WishlistItemSchema = z.object({
  entityType: z.enum(["trip", "tour", "region", "story"]),
  slug: z.string(),
  noted: z.string().optional(),
});
export type WishlistItem = z.infer<typeof WishlistItemSchema>;

export const WishlistSchema = z.object({
  items: z.array(WishlistItemSchema).default([]),
  motivationAnchor: z.string().optional(),
});
export type Wishlist = z.infer<typeof WishlistSchema>;

// -----------------------------------------------------------------------------
// Session metadata — the "how did this visitor get here" hints.
// -----------------------------------------------------------------------------

export const SessionMetadataSchema = z.object({
  entryUrl: z.string().url().optional(),
  regionInterestHint: z.string().optional(),
  variantId: z.string().optional(),
  warmPoolHit: z.boolean().optional(),
});
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

// -----------------------------------------------------------------------------
// SessionState — the top-level shape.
// -----------------------------------------------------------------------------

export const SessionStateSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  conversationHistory: z.array(ConversationEntrySchema).default([]),
  triage: TriageStateSchema,
  wishlist: WishlistSchema,
  consent: ConsentStateSchema,
  metadata: SessionMetadataSchema,
  // Anti-repetition state — per-type sets of "already shown to the visitor
  // this session". Per planning/03-exec-crosscut-anti-repetition.md
  // (HITL-ratified 2026-05-27). Optional + defaulted so sessions persisted
  // before the field landed (in-memory adapter) round-trip cleanly.
  seenItems: SeenItemsSchema,
  // B.t12 — latest visitor clock from the browser. Optional + additive so
  // sessions without the field (pre-B.t12) round-trip without error.
  // Updated on every /chat request; the orchestrator reads it to inject a
  // per-turn dateline into the user-message envelope (never into the cached
  // system prefix — that would bust the Anthropic prompt cache).
  clientTime: z
    .object({
      iso: z.string().datetime({ offset: true }),
      timeZone: z.string().min(1).max(64),
    })
    .optional(),
  // Staff authentication state — set by the orchestrator when a valid
  // staff JWT is presented on /session or /chat. Optional + additive so
  // anonymous visitor sessions (the vast majority) round-trip cleanly.
  //
  // `staff: true` — the session holder presented a valid staff token.
  // `mode`        — routing hint for later agent-selection logic:
  //   'conversation' (default) — normal discovery flow.
  //   'memory'                 — staff-authored memory agent (future task).
  //
  // A later task reads these to route turns to the memory agent; this task
  // only sets them. Invalid/expired/absent token → staff stays false,
  // mode stays 'conversation'. Server-side validation is the ONLY trust
  // boundary — never propagate a client-supplied flag directly.
  staff: z.boolean().optional().default(false),
  mode: z.enum(["conversation", "memory"]).optional().default("conversation"),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// -----------------------------------------------------------------------------
// SessionPingResponse — the `GET /session/:id/ping` preflight probe (D.t6).
//
// Shape reserved here ahead of D.t6 landing (see
// planning/03-exec-chat-surface-t6.md §Shared contracts). Kept in ts-common so
// both the UI client-side helper and the orchestrator handler typecheck
// against the same contract.
//
// Contract:
//   - The endpoint always returns HTTP 200 — the `ok` / `expired` fields
//     carry the verdict. Avoiding 404 for a routine probe dodges browser /
//     CORS edge cases.
//   - `ok: true, expired: false` → session is usable.
//   - `ok: false, expired: true` → session is unknown or archived; UI
//     classifies as `session_not_found` via the adapter error emitter.
//   - `serverTime` is ISO-8601; the UI ignores it today but it's a cheap
//     hook for future clock-skew diagnostics.
// -----------------------------------------------------------------------------

export const SessionPingResponseSchema = z.object({
  ok: z.boolean(),
  expired: z.boolean(),
  serverTime: z.string().datetime(),
});
export type SessionPingResponse = z.infer<typeof SessionPingResponseSchema>;
