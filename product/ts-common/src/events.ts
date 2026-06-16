// -----------------------------------------------------------------------------
// Observability event envelope + per-type payloads.
//
// Per planning/02-impl-observability.md §2.1 + §2.2 and
// planning/03-exec-observability-a.md (F-a).
//
// Shape decisions:
//   - Event is a discriminated union on `eventType` carrying a typed `payload`.
//     Consumers get exhaustive-match safety when switching per event type.
//   - Envelope fields are flat-ish so BigQuery export (§2.4) unnests cleanly.
//   - No PII by default. User message content is represented as
//     { length, sha256 } — actual text never lands in logs.
//   - `eventVersion` starts at 1; schema changes per kind bump that kind's
//     version; we do NOT renumber the whole set on each addition.
//   - Existing (A.t2) payloads must not change shape — only new kinds get
//     added. A.t2's fixture round-trip test commits to the stub; breaking
//     the original nine would be an unforced version bump.
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// Actor enum — who emitted the event.
// -----------------------------------------------------------------------------

export const EventActorSchema = z.enum(["agent", "user", "system", "connector", "ui"]);
export type EventActor = z.infer<typeof EventActorSchema>;

// -----------------------------------------------------------------------------
// Common envelope. Event-specific payload lives alongside, typed per event.
// `event_version` starts at 1; schema changes bump this per event type.
// -----------------------------------------------------------------------------

const EventEnvelopeBase = {
  eventVersion: z.number().int().positive(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  turnIndex: z.number().int().nonnegative().nullable(),
  actor: EventActorSchema,
};

// Shared verdict enum, reused by several event payloads.
const VerdictEnum = z.enum([
  "qualified",
  "referred_out",
  "disqualified",
  "inconclusive",
]);

// -----------------------------------------------------------------------------
// Per-event-type schemas — A.t2 stubs (keep unchanged).
// -----------------------------------------------------------------------------

export const ConversationStartedEventSchema = z.object({
  eventType: z.literal("conversation.started"),
  ...EventEnvelopeBase,
  payload: z.object({
    entryUrl: z.string().url().optional(),
    variantId: z.string().optional(),
    warmPoolHit: z.boolean().optional(),
  }),
});

export const TurnReceivedEventSchema = z.object({
  eventType: z.literal("turn.received"),
  ...EventEnvelopeBase,
  payload: z.object({
    userMessageLength: z.number().int().nonnegative(),
    userMessageSha256: z.string(),
  }),
});

export const TurnCompletedEventSchema = z.object({
  eventType: z.literal("turn.completed"),
  ...EventEnvelopeBase,
  payload: z.object({
    utterLength: z.number().int().nonnegative(),
    fyiCount: z.number().int().nonnegative(),
    reasoningCount: z.number().int().nonnegative(),
    adjunctCount: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  }),
});

export const ToolCalledEventSchema = z.object({
  eventType: z.literal("tool.called"),
  ...EventEnvelopeBase,
  payload: z.object({
    toolName: z.string(),
    toolCallId: z.string(),
    inputSha256: z.string(),
  }),
});

export const ToolReturnedEventSchema = z.object({
  eventType: z.literal("tool.returned"),
  ...EventEnvelopeBase,
  payload: z.object({
    toolName: z.string(),
    toolCallId: z.string(),
    outcome: z.enum(["ok", "error"]),
    latencyMs: z.number().int().nonnegative(),
    outputSize: z.number().int().nonnegative().optional(),
  }),
});

export const TriageDecidedEventSchema = z.object({
  eventType: z.literal("triage.decided"),
  ...EventEnvelopeBase,
  payload: z.object({
    verdict: VerdictEnum,
    reasonCode: z.string(),
    reasonText: z.string(),
  }),
});

export const HandoffSubmittedEventSchema = z.object({
  eventType: z.literal("handoff.submitted"),
  ...EventEnvelopeBase,
  payload: z.object({
    handoffId: z.string(),
    verdict: VerdictEnum,
    consentConversationGranted: z.boolean(),
    consentHandoffGranted: z.boolean(),
    consentMarketingGranted: z.boolean().optional(),
    emailDeliveryStatus: z.enum(["sent", "skipped", "deferred", "bounced"]).optional(),
  }),
});

export const SessionEndedEventSchema = z.object({
  eventType: z.literal("session.ended"),
  ...EventEnvelopeBase,
  payload: z.object({
    durationMs: z.number().int().nonnegative(),
    turnCount: z.number().int().nonnegative(),
    finalTriageVerdict: z.enum([
      "none",
      "qualified",
      "referred_out",
      "disqualified",
      "inconclusive",
    ]),
    terminationReason: z.enum(["user_closed", "idle_timeout", "error"]),
  }),
});

export const ErrorRaisedEventSchema = z.object({
  eventType: z.literal("error.raised"),
  ...EventEnvelopeBase,
  payload: z.object({
    errorType: z.string(),
    chunk: z.enum(["B", "C", "D", "E", "F", "system"]),
    sanitisedContext: z.string().optional(),
  }),
});

// -----------------------------------------------------------------------------
// Per-event-type schemas — F-a additions (new kinds from §2.2 of chunk F
// Tier 2 + the F-a execution plan).
// -----------------------------------------------------------------------------

const ConsentTierEnum = z.enum(["conversation", "handoff", "marketing"]);

export const ConsentGrantedEventSchema = z.object({
  eventType: z.literal("consent.granted"),
  ...EventEnvelopeBase,
  payload: z.object({
    tier: ConsentTierEnum,
    copyVersion: z.string().optional(),
  }),
});

export const ConsentDeclinedEventSchema = z.object({
  eventType: z.literal("consent.declined"),
  ...EventEnvelopeBase,
  payload: z.object({
    tier: ConsentTierEnum,
    copyVersion: z.string().optional(),
  }),
});

// NB: a `tool.failed` kind was defined here originally (F-a) but never emitted
// — tool failures surface via `tool.returned{outcome:"error"}` (orchestrator
// boundary) + `tool.invoked{ok:false, errorKind}` (connector). Retired in F-c
// (decision F.sink-5) to keep the schema honest about what actually fires.

export const HandoffTriggeredEventSchema = z.object({
  eventType: z.literal("handoff.triggered"),
  ...EventEnvelopeBase,
  payload: z.object({
    verdict: VerdictEnum,
    widgetToken: z.string(),
  }),
});

// -----------------------------------------------------------------------------
// Handoff email lifecycle (H3, 2026-04-30 code review).
//
// Emitted by `submitHandoff` immediately after `sendHandoffEmail` so an SMTP
// outage / template-read failure / verdict-skip leaves a structured signal in
// the observability stream. Closes the documented-but-phantom event family
// referenced by `connector/handoff/mailer.ts:43-44`.
// -----------------------------------------------------------------------------

export const HandoffEmailSentEventSchema = z.object({
  eventType: z.literal("handoff.email.sent"),
  ...EventEnvelopeBase,
  payload: z.object({
    handoffId: z.string(),
    verdict: VerdictEnum,
    toAddress: z.string(),
    subjectHash: z.string(),
  }),
});

export const HandoffEmailSkippedEventSchema = z.object({
  eventType: z.literal("handoff.email.skipped"),
  ...EventEnvelopeBase,
  payload: z.object({
    handoffId: z.string(),
    verdict: VerdictEnum,
    reason: z.enum([
      "mailer_disabled",
      "verdict_disqualified",
      "verdict_inconclusive",
    ]),
  }),
});

export const HandoffEmailFailedEventSchema = z.object({
  eventType: z.literal("handoff.email.failed"),
  ...EventEnvelopeBase,
  payload: z.object({
    handoffId: z.string(),
    verdict: VerdictEnum,
    errorCategory: z.enum(["template_read", "smtp", "unknown"]),
    sanitisedContext: z.string().max(500),
  }),
});

// -----------------------------------------------------------------------------
// Handoff retention sweeper lifecycle (E.t6, 2026-05-12).
//
// Emitted by `sweepHandoffs` (connector) around each sweep pass. One
// `started` event at the run kickoff, one `completed` event on success with
// per-verdict deletion counts + duration, or one `failed` event on error
// with `errorCategory` + sanitisedContext.
//
// PII discipline: counts only — no handoffIds, no email addresses, no record
// content. Same posture as the `handoff.email.*` family. Counsel-facing
// implication: retention enforcement is observably running without leaking
// which visitors got deleted.
//
// The `sessionId` envelope field is hard-coded to `'system'` — the sweep is
// not visitor-scoped. The actor is `'connector'` because the side-effect
// owner is `@swoop/connector` per E.11.
// -----------------------------------------------------------------------------

export const HandoffRetentionSweepStartedEventSchema = z.object({
  eventType: z.literal("handoff.retention.sweep.started"),
  ...EventEnvelopeBase,
  payload: z.object({
    runId: z.string().uuid(),
    /** sha256 of the policy values; a config change is visible in the stream. */
    policyDigest: z.string(),
    /** Today: 'fs' (FsHandoffStore interim). Post-IAM: 'postgres'. */
    storeKind: z.enum(["fs", "postgres"]),
  }),
});

export const HandoffRetentionSweepCompletedEventSchema = z.object({
  eventType: z.literal("handoff.retention.sweep.completed"),
  ...EventEnvelopeBase,
  payload: z.object({
    runId: z.string().uuid(),
    scanned: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    perVerdict: z.object({
      qualified: z.number().int().nonnegative(),
      referred_out: z.number().int().nonnegative(),
      disqualified: z.number().int().nonnegative(),
      inconclusive: z.number().int().nonnegative(),
    }),
    skippedCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export const HandoffRetentionSweepFailedEventSchema = z.object({
  eventType: z.literal("handoff.retention.sweep.failed"),
  ...EventEnvelopeBase,
  payload: z.object({
    runId: z.string().uuid(),
    /**
     * `list_failed`  — store.list() threw.
     * `sweep_failed` — store.sweep() returned `{ ok: false, … }` (or threw —
     *                  the wrapper catches and tags `unknown`).
     * `unknown`      — caught error outside the documented contract.
     */
    errorCategory: z.enum(["list_failed", "sweep_failed", "unknown"]),
    /** Truncated to ≤500 chars; no PII per the "counts-only" posture. */
    sanitisedContext: z.string().max(500),
    partial: z
      .object({
        scanned: z.number().int().nonnegative(),
        deleted: z.number().int().nonnegative(),
      })
      .optional(),
  }),
});

/**
 * Emitted when the ADK skill primitive loads a skill file. B.t9 territory —
 * deferred — but the schema slot lands now so G's skill authors can write
 * assertions against it.
 */
export const SkillLoadedEventSchema = z.object({
  eventType: z.literal("skill.loaded"),
  ...EventEnvelopeBase,
  payload: z.object({
    skillName: z.string(),
    triggerContext: z.string(),
  }),
});

export const UiWidgetRenderedEventSchema = z.object({
  eventType: z.literal("ui.widget_rendered"),
  ...EventEnvelopeBase,
  payload: z.object({
    widgetType: z.string(),
    toolName: z.string(),
    turnIndex: z.number().int().nonnegative(),
  }),
});

export const UiConversationOpenedEventSchema = z.object({
  eventType: z.literal("ui.conversation_opened"),
  ...EventEnvelopeBase,
  payload: z.object({
    source: z.string(),
    uaCategory: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional(),
  }),
});

export const UiConversationClosedEventSchema = z.object({
  eventType: z.literal("ui.conversation_closed"),
  ...EventEnvelopeBase,
  payload: z.object({
    closeReason: z.enum(["explicit_close", "tab_close", "navigation", "restart"]),
    finalState: z.string().optional(),
  }),
});

/**
 * `session.expired` carries two distinct emit sites:
 *   - Sweeper-driven lifecycle expiry (in-memory store idle / archive paths).
 *     Payload `{cause: "idle_timeout" | "archive_to_delete"}`.
 *   - 404 from the B.t11 session-history projection (and any other
 *     session-id-fronting probe that decides the session is gone).
 *     Payload `{gate: "puma" | "adk" | "consent"}` — names which store
 *     responded with "no such session" so post-launch analytics can
 *     distinguish unknown-id from desync from pre-consent.
 *
 * The wire-level 404 in /session/:id/history conflates all three gates as
 * `session_not_found` (matches D.16's /ping rationale); the observability
 * channel keeps them distinct.
 *
 * Both shapes pass through one discriminated payload — readers branch on
 * which field is populated. Adding new variants here does NOT bump
 * eventVersion (the union widens; old consumers continue to switch on
 * `cause` and ignore the `gate` arm).
 */
export const SessionExpiredEventSchema = z.object({
  eventType: z.literal("session.expired"),
  ...EventEnvelopeBase,
  payload: z.union([
    z.object({
      cause: z.enum(["idle_timeout", "archive_to_delete"]),
    }),
    z.object({
      gate: z.enum(["puma", "adk", "consent"]),
    }),
  ]),
});

// -----------------------------------------------------------------------------
// B.t11 — session history projection observability (rehydration path).
//
// Per planning/03-exec-agent-runtime-t11.md §"Observability — four new event
// kinds". Emitted inline by the GET /session/:id/history handler so the
// signal lives at the site (mirrors the B.18 warm-pool emit-at-the-site
// convention). The fourth — `session.expired` — extends the existing schema
// above to also carry a `gate` discriminator (puma | adk | consent).
// -----------------------------------------------------------------------------

export const SessionRehydratedEventSchema = z.object({
  eventType: z.literal("session.rehydrated"),
  ...EventEnvelopeBase,
  payload: z.object({
    partCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export const SessionReplayEmptyEventSchema = z.object({
  eventType: z.literal("session.replay.empty"),
  ...EventEnvelopeBase,
  payload: z.object({
    eventCount: z.number().int().nonnegative(),
  }),
});

export const SessionReplayFailedEventSchema = z.object({
  eventType: z.literal("session.replay.failed"),
  ...EventEnvelopeBase,
  payload: z.object({
    stage: z.enum(["adk_fetch", "translator"]),
    errorMessage: z.string(),
  }),
});

// -----------------------------------------------------------------------------
// D.t9-mount-rehydrate — UI-side rehydrate-on-mount lifecycle events.
//
// Mirrors B.t11's server-side `session.rehydrated` / `session.replay.empty` /
// `session.expired` family from the UI's vantage point. Four kinds:
//
//   ui.session.rehydrate.requested — fetch started (after sessionId + consent
//                                     gate cleared).
//   ui.session.rehydrate.applied   — 200 OK; `partCount` is the size of the
//                                     replayed projection. 0 is a valid value
//                                     (consented + zero turns, e.g. warm-pool
//                                     hit; per HITL ratification 2026-05-12
//                                     this is treated as a fresh chat, not a
//                                     special case).
//   ui.session.rehydrate.expired   — 404 session_not_found; sessionStorage
//                                     cleared and OpeningScreen surface routed.
//   ui.session.rehydrate.failed    — 5xx / network. `stage` discriminates the
//                                     bucket so analytics can split server
//                                     fault from network fault.
//
// All four pass `actor: "ui"` per envelope conventions.
// -----------------------------------------------------------------------------

export const UiSessionRehydrateRequestedEventSchema = z.object({
  eventType: z.literal("ui.session.rehydrate.requested"),
  ...EventEnvelopeBase,
  payload: z.object({}),
});

export const UiSessionRehydrateAppliedEventSchema = z.object({
  eventType: z.literal("ui.session.rehydrate.applied"),
  ...EventEnvelopeBase,
  payload: z.object({
    partCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
});

export const UiSessionRehydrateExpiredEventSchema = z.object({
  eventType: z.literal("ui.session.rehydrate.expired"),
  ...EventEnvelopeBase,
  payload: z.object({}),
});

export const UiSessionRehydrateFailedEventSchema = z.object({
  eventType: z.literal("ui.session.rehydrate.failed"),
  ...EventEnvelopeBase,
  payload: z.object({
    stage: z.enum(["fetch", "network", "replay"]),
  }),
});

export const WarmPoolHitEventSchema = z.object({
  eventType: z.literal("warm_pool.hit"),
  ...EventEnvelopeBase,
  payload: z.object({
    poolSizeAtClaim: z.number().int().nonnegative(),
    waitTimeMs: z.number().int().nonnegative(),
  }),
});

export const WarmPoolMissEventSchema = z.object({
  eventType: z.literal("warm_pool.miss"),
  ...EventEnvelopeBase,
  payload: z.object({
    poolSizeAtClaim: z.number().int().nonnegative(),
  }),
});

// -----------------------------------------------------------------------------
// Connector-side tool invocation envelope (C.t4 / Q5).
//
// One shared event with a `toolName` discriminator (per HITL ratification of
// 03-exec-c-t4.md Q5 — eight separate event kinds is dilution). Emitted by the
// connector's `runHandler` wrapper around every tool call: input validated,
// body executed, output validated, ok/elapsed/output_count summarised.
//
// `errorKind` is populated only when `ok === false`:
//   - `tool_input_invalid`   — Zod parse on input failed.
//   - `tool_output_invalid`  — Zod parse on output failed (defence in depth).
//   - `handler_threw`        — handler body threw.
//
// This is distinct from the orchestrator-side `tool.called` / `tool.returned`
// pair which lives at the agent ↔ connector boundary; `tool.invoked` lives
// inside the connector and survives even if the orchestrator hangs up.
// -----------------------------------------------------------------------------

export const ToolInvokedEventSchema = z.object({
  eventType: z.literal("tool.invoked"),
  ...EventEnvelopeBase,
  payload: z.object({
    /** Tool name string (e.g. "find_inspiring", "handoff_submit"). */
    toolName: z.string(),
    /** Wall-clock duration of the body() execution in milliseconds. */
    elapsedMs: z.number().int().nonnegative(),
    /** True iff input validated, body returned, output validated. */
    ok: z.boolean(),
    /**
     * Count of result rows returned by the body — `passages.length`,
     * `cards.length`, `images.length`, etc. Set to 0 when the tool returns
     * a non-collection shape (handoff / handoff_submit).
     */
    outputCount: z.number().int().nonnegative().optional(),
    /** Populated when `ok === false`. */
    errorKind: z
      .enum(["tool_input_invalid", "tool_output_invalid", "handler_threw"])
      .optional(),
  }),
});
export type ToolInvokedEvent = z.infer<typeof ToolInvokedEventSchema>;

// -----------------------------------------------------------------------------
// Event — discriminated union on eventType.
// -----------------------------------------------------------------------------

export const EventSchema = z.discriminatedUnion("eventType", [
  // A.t2 stubs
  ConversationStartedEventSchema,
  TurnReceivedEventSchema,
  TurnCompletedEventSchema,
  ToolCalledEventSchema,
  ToolReturnedEventSchema,
  TriageDecidedEventSchema,
  HandoffSubmittedEventSchema,
  SessionEndedEventSchema,
  ErrorRaisedEventSchema,
  // F-a additions
  ConsentGrantedEventSchema,
  ConsentDeclinedEventSchema,
  HandoffTriggeredEventSchema,
  HandoffEmailSentEventSchema,
  HandoffEmailSkippedEventSchema,
  HandoffEmailFailedEventSchema,
  // E.t6 — handoff retention sweeper lifecycle
  HandoffRetentionSweepStartedEventSchema,
  HandoffRetentionSweepCompletedEventSchema,
  HandoffRetentionSweepFailedEventSchema,
  SkillLoadedEventSchema,
  UiWidgetRenderedEventSchema,
  UiConversationOpenedEventSchema,
  UiConversationClosedEventSchema,
  SessionExpiredEventSchema,
  WarmPoolHitEventSchema,
  WarmPoolMissEventSchema,
  // C.t4 — connector-side tool invocation summary
  ToolInvokedEventSchema,
  // B.t11 — server-side session history projection (rehydration) observability
  SessionRehydratedEventSchema,
  SessionReplayEmptyEventSchema,
  SessionReplayFailedEventSchema,
  // D.t9-mount-rehydrate — UI-side rehydrate lifecycle (paired with B.t11)
  UiSessionRehydrateRequestedEventSchema,
  UiSessionRehydrateAppliedEventSchema,
  UiSessionRehydrateExpiredEventSchema,
  UiSessionRehydrateFailedEventSchema,
]);
export type Event = z.infer<typeof EventSchema>;

// Per-type convenience inferreds.
export type ConversationStartedEvent = z.infer<typeof ConversationStartedEventSchema>;
export type TurnReceivedEvent = z.infer<typeof TurnReceivedEventSchema>;
export type TurnCompletedEvent = z.infer<typeof TurnCompletedEventSchema>;
export type ToolCalledEvent = z.infer<typeof ToolCalledEventSchema>;
export type ToolReturnedEvent = z.infer<typeof ToolReturnedEventSchema>;
export type TriageDecidedEvent = z.infer<typeof TriageDecidedEventSchema>;
export type HandoffSubmittedEvent = z.infer<typeof HandoffSubmittedEventSchema>;
export type SessionEndedEvent = z.infer<typeof SessionEndedEventSchema>;
export type ErrorRaisedEvent = z.infer<typeof ErrorRaisedEventSchema>;
export type ConsentGrantedEvent = z.infer<typeof ConsentGrantedEventSchema>;
export type ConsentDeclinedEvent = z.infer<typeof ConsentDeclinedEventSchema>;
export type HandoffTriggeredEvent = z.infer<typeof HandoffTriggeredEventSchema>;
export type HandoffEmailSentEvent = z.infer<typeof HandoffEmailSentEventSchema>;
export type HandoffEmailSkippedEvent = z.infer<typeof HandoffEmailSkippedEventSchema>;
export type HandoffEmailFailedEvent = z.infer<typeof HandoffEmailFailedEventSchema>;
export type HandoffRetentionSweepStartedEvent = z.infer<
  typeof HandoffRetentionSweepStartedEventSchema
>;
export type HandoffRetentionSweepCompletedEvent = z.infer<
  typeof HandoffRetentionSweepCompletedEventSchema
>;
export type HandoffRetentionSweepFailedEvent = z.infer<
  typeof HandoffRetentionSweepFailedEventSchema
>;
export type SkillLoadedEvent = z.infer<typeof SkillLoadedEventSchema>;
export type UiWidgetRenderedEvent = z.infer<typeof UiWidgetRenderedEventSchema>;
export type UiConversationOpenedEvent = z.infer<typeof UiConversationOpenedEventSchema>;
export type UiConversationClosedEvent = z.infer<typeof UiConversationClosedEventSchema>;
export type SessionExpiredEvent = z.infer<typeof SessionExpiredEventSchema>;
export type WarmPoolHitEvent = z.infer<typeof WarmPoolHitEventSchema>;
export type WarmPoolMissEvent = z.infer<typeof WarmPoolMissEventSchema>;
export type SessionRehydratedEvent = z.infer<typeof SessionRehydratedEventSchema>;
export type SessionReplayEmptyEvent = z.infer<typeof SessionReplayEmptyEventSchema>;
export type SessionReplayFailedEvent = z.infer<typeof SessionReplayFailedEventSchema>;
export type UiSessionRehydrateRequestedEvent = z.infer<
  typeof UiSessionRehydrateRequestedEventSchema
>;
export type UiSessionRehydrateAppliedEvent = z.infer<
  typeof UiSessionRehydrateAppliedEventSchema
>;
export type UiSessionRehydrateExpiredEvent = z.infer<
  typeof UiSessionRehydrateExpiredEventSchema
>;
export type UiSessionRehydrateFailedEvent = z.infer<
  typeof UiSessionRehydrateFailedEventSchema
>;
