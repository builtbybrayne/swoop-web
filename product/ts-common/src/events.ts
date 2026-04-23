// -----------------------------------------------------------------------------
// Observability event envelope + per-type payloads.
//
// Per planning/02-impl-observability.md §2.1 + §2.2.
//
// Shape decisions:
//   - Event is a discriminated union on `eventType` carrying a typed `payload`.
//     Consumers get exhaustive-match safety when switching per event type.
//   - Envelope fields are flat-ish so BigQuery export (§2.4) unnests cleanly.
//   - No PII by default. User message content is represented as
//     { length, sha256 } — actual text never lands in logs.
//   - Chunk F is the author-of-record for this module; A.t2 only stubs the
//     minimum set from §2.2 and chunk F's agent extends.
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

// -----------------------------------------------------------------------------
// Per-event-type schemas.
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
    verdict: z.enum(["qualified", "referred_out", "disqualified"]),
    reasonCode: z.string(),
    reasonText: z.string(),
  }),
});

export const HandoffSubmittedEventSchema = z.object({
  eventType: z.literal("handoff.submitted"),
  ...EventEnvelopeBase,
  payload: z.object({
    handoffId: z.string(),
    verdict: z.enum(["qualified", "referred_out", "disqualified"]),
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
// Event — discriminated union on eventType.
// -----------------------------------------------------------------------------

export const EventSchema = z.discriminatedUnion("eventType", [
  ConversationStartedEventSchema,
  TurnReceivedEventSchema,
  TurnCompletedEventSchema,
  ToolCalledEventSchema,
  ToolReturnedEventSchema,
  TriageDecidedEventSchema,
  HandoffSubmittedEventSchema,
  SessionEndedEventSchema,
  ErrorRaisedEventSchema,
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
