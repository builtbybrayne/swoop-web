// product/ui/src/session/use-greeting.ts
//
// Consent-triggered greeting pre-warm — UI trigger (consent-greeting-prewarm,
// PW-1/PW-2). Sibling of `useRehydrate` / `usePreflight`.
//
// JTBD: the moment the visitor consents to a FRESH session, fire ONE internal
// "warm hello" turn during the dead time before they type. That turn warms the
// model session, lets the agent's natural skill-load happen, and streams a
// short hello so there's presence while they read + compose.
//
// Fresh-session guard (PW-2): greet iff consent is granted AND there is no
// prior conversation this session. We reuse the EXACT signal `useRehydrate`
// already computes from `GET /session/:id/history` (B.t11) — its `status`:
//   - "empty"   → consented, zero prior turns. This covers BOTH a brand-new
//                 active grant (fresh session id, no history) AND a reload that
//                 restored consent before any turn. Greet.
//   - "applied" → prior history replayed into the thread. Do NOT greet (don't
//                 hello into an existing conversation).
//   - "expired"/"failed"/"loading"/"idle" → not a confirmed-fresh session;
//                 do nothing (the rehydrate/expiry paths own those).
// Reusing rehydrate's verdict avoids a second history fetch and keeps the
// "is this session fresh?" decision in one place.
//
// Mechanism: assistant-ui is driven natively so the hello streams through the
// same transport → runtime flow as any turn (PW-1 Shape A, no `key`-bump
// remount — App.tsx documents that remounting breaks the composer). We:
//   1. `armGreetingTurn()` — arm the transport's one-shot flag so the very next
//      `/chat` POST carries `greeting: true` (the transport can't read
//      assistant-ui `runConfig`; see orchestrator-adapter.ts for why).
//   2. `runtime.thread.append({ role: "user", content: [{ type: "text",
//      text: GREETING_USER_MARKER }] })` — drives one turn. The marker is the
//      synthetic user message; `MessageView` suppresses its bubble, and the
//      orchestrator's greeting branch ignores it (runs the cms greeting prompt)
//      and records NO user turn server-side.
//
// One-shot ref guard keyed on session id absorbs React strict-mode double
// invocation and re-renders — the greeting fires at most once per fresh
// session. No race protection (PW-6, out of scope): if the visitor sends a
// first message before the hello returns, both turns run.

import { useEffect, useRef } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";
import { GREETING_USER_MARKER } from "@swoop/common";
import { armGreetingTurn } from "../runtime/orchestrator-adapter";
import type { RehydrateStatus } from "./use-rehydrate";

/**
 * Pure predicate: is `text` (the joined text of a user message) the synthetic
 * greeting marker that must be suppressed in the UI (PW-4)? Exported so
 * `App.tsx`'s `MessageView` guard and its test share ONE definition of the
 * suppression rule (covers both the live optimistic user message and any
 * replayed projection). Trim-compared so trailing/leading whitespace from a
 * round-trip never breaks the match.
 */
export function isGreetingMarkerText(text: string): boolean {
  return text.trim() === GREETING_USER_MARKER.trim();
}

export interface UseGreetingOptions {
  /**
   * Master gate. Typically `hasConsented` from `useConsent` — pre-consent
   * there is no session to warm.
   */
  enabled: boolean;
  /**
   * Server-side session id (same `sessionStorage` value `useConsent` writes).
   * `null` while pending bootstrap or after a clear — no greeting fires.
   */
  sessionId: string | null;
  /**
   * The assistant-ui runtime to drive the greeting turn through. Passed in by
   * the parent (App holds it from `useChatRuntime`); this hook runs at
   * App-level outside `AssistantRuntimeProvider`, so it can't reach the runtime
   * via context — same reason `useRehydrate` takes it as a prop.
   */
  runtime: AssistantRuntime | null;
  /**
   * `useRehydrate`'s status — our fresh-session signal. We greet only on
   * "empty" (consented session with zero prior turns). Threading the sibling
   * hook's verdict in keeps the freshness decision single-sourced and avoids a
   * duplicate history fetch.
   */
  rehydrateStatus: RehydrateStatus;
}

export function useGreeting(opts: UseGreetingOptions): void {
  const { enabled, sessionId, runtime, rehydrateStatus } = opts;

  // Fire-once guard keyed on session id: a new id (fresh chat) re-arms the
  // greeting for that session. Stored as a ref so flipping it never triggers a
  // re-render and so strict-mode's double-invoke can't double-fire.
  const greetedForSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!sessionId) return;
    if (!runtime) return;
    // Only greet a confirmed-fresh session (rehydrate found no prior turns).
    if (rehydrateStatus !== "empty") return;
    // Already greeted this session — absorb strict-mode / re-render re-runs.
    if (greetedForSessionRef.current === sessionId) return;
    greetedForSessionRef.current = sessionId;

    // Arm the transport's one-shot flag BEFORE the append so the resulting
    // `/chat` POST carries `greeting: true`. Order matters: append synchronously
    // kicks the transport.
    armGreetingTurn();
    runtime.thread.append({
      role: "user",
      content: [{ type: "text", text: GREETING_USER_MARKER }],
    });
    // No cleanup: the turn, once kicked, owns its own lifecycle through the
    // transport. We deliberately do not abort it on unmount — a brief greeting
    // is cheap and aborting mid-warm would waste the work.
  }, [enabled, sessionId, runtime, rehydrateStatus]);
}
