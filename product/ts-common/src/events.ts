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
const VerdictEnum = z.enum(["qualified", "referred_out", "disqualified"]);

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
    finalTriageVerdict: z.enum(["none", "qualified", "referred_out", "disqualified"]),
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

/**
 * Distinct from `tool.returned{outcome: "error"}`: carries the richer error
 * category surface for spot-checks without parsing text. `tool.returned` is
 * still the cardinal "every call lands here" signal; `tool.failed` is the
 * opt-in richer event for failing calls.
 */
export const ToolFailedEventSchema = z.object({
  eventType: z.literal("tool.failed"),
  ...EventEnvelopeBase,
  payload: z.object({
    toolName: z.string(),
    toolCallId: z.string(),
    errorCategory: z.enum(["validation", "upstream", "timeout", "unknown"]),
    latencyMs: z.number().int().nonnegative(),
  }),
});

export const HandoffTriggeredEventSchema = z.object({
  eventType: z.literal("handoff.triggered"),
  ...EventEnvelopeBase,
  payload: z.object({
    verdict: VerdictEnum,
    widgetToken: z.string(),
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

export const SessionExpiredEventSchema = z.object({
  eventType: z.literal("session.expired"),
  ...EventEnvelopeBase,
  payload: z.object({
    cause: z.enum(["idle_timeout", "archive_to_delete"]),
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
  ToolFailedEventSchema,
  HandoffTriggeredEventSchema,
  SkillLoadedEventSchema,
  UiWidgetRenderedEventSchema,
  UiConversationOpenedEventSchema,
  UiConversationClosedEventSchema,
  SessionExpiredEventSchema,
  WarmPoolHitEventSchema,
  WarmPoolMissEventSchema,
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
export type ToolFailedEvent = z.infer<typeof ToolFailedEventSchema>;
export type HandoffTriggeredEvent = z.infer<typeof HandoffTriggeredEventSchema>;
export type SkillLoadedEvent = z.infer<typeof SkillLoadedEventSchema>;
export type UiWidgetRenderedEvent = z.infer<typeof UiWidgetRenderedEventSchema>;
export type UiConversationOpenedEvent = z.infer<typeof UiConversationOpenedEventSchema>;
export type UiConversationClosedEvent = z.infer<typeof UiConversationClosedEventSchema>;
export type SessionExpiredEvent = z.infer<typeof SessionExpiredEventSchema>;
export type WarmPoolHitEvent = z.infer<typeof WarmPoolHitEventSchema>;
export type WarmPoolMissEvent = z.infer<typeof WarmPoolMissEventSchema>;
