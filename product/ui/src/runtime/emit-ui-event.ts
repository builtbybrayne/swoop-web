// product/ui/src/runtime/emit-ui-event.ts
//
// Thin UI wrapper around `@swoop/common`'s `emitEvent` (F-a). Call sites in
// the chat surface know a payload + a kind; they should not have to
// re-derive the envelope every time.
//
// Responsibilities:
//   - Pull the current session id from `sessionStorage` via the adapter's
//     shared reader, falling back to `"unknown"` when a UI event fires
//     before the bootstrap handshake completes (e.g. mount-time
//     `ui.conversation_opened`).
//   - Fill in `eventVersion: 1`, `timestamp: now()`, `actor: "ui"`, and
//     `turnIndex: null` unless the caller passes one.
//   - Hand the finished envelope to `emitEvent`, which runs its own Zod
//     validation and falls back to an `error.raised` fingerprint on drift.
//
// Non-goals:
//   - No orchestrator-side event kinds (tool.*, triage.*, conversation.*) —
//     those are server-emitted. This wrapper is strictly for the UI surface.
//   - No persistence / no batching. F-a's default sink is `console.log`
//     which the browser surfaces in devtools; that's enough for Puma M1.

import { emitEvent, type Event } from "@swoop/common";
import { readStoredSessionId } from "./orchestrator-adapter";

/**
 * Kinds this wrapper knows how to emit. A subset of the full union —
 * everything else is orchestrator-side.
 */
type UiEvent = Extract<
  Event,
  {
    eventType:
      | "ui.conversation_opened"
      | "ui.conversation_closed"
      | "ui.widget_rendered"
      | "consent.granted"
      | "consent.declined";
  }
>;

/** Shape the caller supplies: everything except the envelope the wrapper fills. */
type UiEventInput = {
  [K in UiEvent["eventType"]]: {
    eventType: K;
    payload: Extract<UiEvent, { eventType: K }>["payload"];
    /** Optional. Defaults to `null` (session-level rather than turn-level). */
    turnIndex?: number | null;
    /** Optional override for the envelope session id — only tests need this. */
    sessionId?: string;
  };
}[UiEvent["eventType"]];

export function emitUiEvent(input: UiEventInput): void {
  const sessionId =
    input.sessionId ?? readStoredSessionId() ?? "unknown";
  const envelope = {
    eventType: input.eventType,
    eventVersion: 1,
    timestamp: new Date().toISOString(),
    sessionId,
    turnIndex: input.turnIndex ?? null,
    actor: "ui",
    payload: input.payload,
  } as UiEvent;
  emitEvent(envelope);
}
