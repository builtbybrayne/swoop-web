// product/ui/src/session/use-rehydrate.ts
//
// Mount-time history rehydrate hook — D.t9-mount-rehydrate.
//
// Lifecycle:
//   1. Mount with `enabled && sessionId` truthy → fire one `GET
//      /session/:id/history` request.
//   2. Switch on the response:
//        - 200 non-empty → `applied`. Call `replayPartsIntoThread`. Emit
//          `ui.session.rehydrate.applied{partCount, durationMs}`.
//        - 200 empty     → `empty`. No replay call (per HITL: empty replay is
//          a fresh chat, no special case). Emit `…applied{partCount:0}`.
//        - 404           → `expired`. Call `onExpired` so the parent clears
//          sessionStorage + bumps `resetKey`. Emit `…expired`.
//        - 5xx           → `failed`. Emit `…failed{stage:"fetch"}` + route
//          through `emitAdapterError` with the `[rehydrate_failed:fetch_failed]`
//          marker so the D.t5 banner pipeline surfaces the unknown surface.
//        - network throw → `failed`. Same as 5xx but `stage:"network"` and
//          marker `[rehydrate_failed:network_error]` → unreachable surface.
//
// Trigger discipline (per plan §"Implementation detail — useRehydrate"):
//   - Mount only. NOT on `visibilitychange` (HITL Q5 default: no — keeps the
//     hook simple; the side-quest's JTBD is mount-time, not focus-time).
//   - Fire-once guard keyed on `sessionId` — a new id (e.g. after Fresh chat
//     bumps `resetKey`) triggers a fresh probe.
//   - In-flight AbortController so unmount cancels cleanly.
//   - StrictMode resilience: the in-flight ref absorbs double-invoke.
//
// Per HITL ratification 2026-05-12:
//   - 404 UX: soft-fail with notification (executor-choice affordance). This
//     hook signals `expired`; the parent (`App.tsx`) routes via `onExpired`
//     to clear sessionStorage and surface the notification.
//   - Empty replay: no special case — `empty` status is identical to a fresh
//     chat from the visitor's POV.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAssistantRuntime } from "@assistant-ui/react";
import { emitAdapterError } from "../runtime/orchestrator-adapter";
import { emitUiEvent } from "../runtime/emit-ui-event";
import { fetchSessionHistory, type FetchHistoryResult } from "./rehydrate";
import { replayPartsIntoThread } from "./replay-into-thread";

export type RehydrateStatus =
  | "idle"
  | "loading"
  | "applied"
  | "empty"
  | "expired"
  | "failed";

export interface UseRehydrateOptions {
  /**
   * Master gate. Typically `hasConsented` from `useConsent` — pre-consent
   * there's no session id worth rehydrating, and consent is the natural
   * boundary (the side-quest's UX guarantee).
   */
  enabled: boolean;
  /**
   * Server-side session id. Same `sessionStorage` value `useConsent` writes.
   * `null` while pending bootstrap or after a clear.
   */
  sessionId: string | null;
  /**
   * Called after a successful non-empty replay lands. `partCount` carries
   * the rehydrated projection size. Optional — App.tsx uses it for the
   * observability emit alongside the status transition.
   */
  onApplied?: (partCount: number) => void;
  /**
   * Called on 404. Parent is responsible for clearing sessionStorage and
   * bumping `resetKey` (the assistant-ui provider's remount key). The 404
   * notification UX (toast / banner / preamble) is the executor's call per
   * HITL ratification — the parent decides the surface.
   */
  onExpired?: () => void;
}

export interface UseRehydrateResult {
  status: RehydrateStatus;
  /**
   * Manual retry trigger — resets the fire-once guard and re-invokes the
   * effect. Wired through the D.t5 banner's Try-again button. Per the plan:
   * on 404, retry is a no-op because the OpeningScreen takes over; on 5xx /
   * network, retry re-runs the fetch.
   */
  retry: () => void;
}

/**
 * Build the `[rehydrate_failed:<reason>]`-marked error the classifier
 * matches on. Same marker convention D.12's `[session_not_found]` /
 * `[stream]` use. See `errors/classify.ts`.
 */
function buildRehydrateError(reason: "fetch_failed" | "network_error"): Error {
  return new Error(
    `Session rehydrate failed [rehydrate_failed:${reason}]: see emitter for details`,
  );
}

export function useRehydrate(opts: UseRehydrateOptions): UseRehydrateResult {
  const { enabled, sessionId, onApplied, onExpired } = opts;
  const [status, setStatus] = useState<RehydrateStatus>("idle");

  const runtime = useAssistantRuntime({ optional: true });

  // Fire-once guard keyed on sessionId: when the id changes (e.g. fresh chat
  // mints a new one), we want to fire again. Stored as ref so changing it
  // doesn't trigger a re-render.
  const lastFiredForSessionRef = useRef<string | null>(null);
  // In-flight AbortController so unmount + sessionId change both cancel cleanly.
  const inFlightRef = useRef<AbortController | null>(null);
  // Manual retry counter — bumped to re-run the effect.
  const [retryCounter, setRetryCounter] = useState(0);

  // Stable callback refs so we don't re-tear the effect on every render that
  // happens to pass a new inline function. App.tsx's callbacks are stable
  // today, but defending here matches `usePreflight`'s posture.
  const onAppliedRef = useRef(onApplied);
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onAppliedRef.current = onApplied;
    onExpiredRef.current = onExpired;
  }, [onApplied, onExpired]);

  useEffect(() => {
    if (!enabled) return;
    if (!sessionId) return;
    if (!runtime) {
      // Should be impossible — App wires this hook inside the runtime
      // provider. Defensive: if a downstream caller mounts it outside the
      // provider, bail rather than crash.
      // eslint-disable-next-line no-console
      console.warn(
        "[useRehydrate] no AssistantRuntime in context; skipping rehydrate.",
      );
      return;
    }

    // Per-session fire-once: skip if this session id has already been
    // processed and the manual retry counter hasn't advanced.
    if (
      lastFiredForSessionRef.current === sessionId &&
      retryCounter === 0
    ) {
      return;
    }
    lastFiredForSessionRef.current = sessionId;

    // Cancel any prior in-flight probe (StrictMode double-invoke; sessionId
    // changed mid-flight). Abort is idempotent.
    if (inFlightRef.current !== null) {
      inFlightRef.current.abort();
    }
    const controller = new AbortController();
    inFlightRef.current = controller;

    setStatus("loading");
    emitUiEvent({
      eventType: "ui.session.rehydrate.requested",
      sessionId,
      payload: {},
    });

    const startedAt = Date.now();

    fetchSessionHistory(sessionId, controller.signal)
      .then((result: FetchHistoryResult) => {
        // Bail if we were aborted between fetch and resolve — the controller
        // is no longer the active one if the sessionId changed.
        if (inFlightRef.current !== controller) return;
        inFlightRef.current = null;

        if ("parts" in result) {
          const partCount = result.parts.length;
          const durationMs = Date.now() - startedAt;

          if (partCount === 0) {
            // HITL ratification: empty replay = fresh chat. No replay call,
            // no placeholder, no "Welcome back" affordance.
            setStatus("empty");
            emitUiEvent({
              eventType: "ui.session.rehydrate.applied",
              sessionId,
              payload: { partCount: 0, durationMs },
            });
            return;
          }

          try {
            replayPartsIntoThread(runtime, result.parts);
          } catch (err) {
            // Replay itself failed — assistant-ui rejected the import. This
            // is a UI-side bug rather than a server bug; surface through the
            // failure pipeline with a distinct stage so analytics can
            // distinguish it from server / network failures.
            setStatus("failed");
            emitUiEvent({
              eventType: "ui.session.rehydrate.failed",
              sessionId,
              payload: { stage: "replay" },
            });
            emitAdapterError(
              new Error(
                `Session rehydrate failed [rehydrate_failed:fetch_failed]: replay threw: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              ),
            );
            return;
          }

          setStatus("applied");
          emitUiEvent({
            eventType: "ui.session.rehydrate.applied",
            sessionId,
            payload: { partCount, durationMs },
          });
          onAppliedRef.current?.(partCount);
          return;
        }

        switch (result.error) {
          case "session_not_found":
            setStatus("expired");
            emitUiEvent({
              eventType: "ui.session.rehydrate.expired",
              sessionId,
              payload: {},
            });
            onExpiredRef.current?.();
            return;
          case "fetch_failed":
            setStatus("failed");
            emitUiEvent({
              eventType: "ui.session.rehydrate.failed",
              sessionId,
              payload: { stage: "fetch" },
            });
            emitAdapterError(buildRehydrateError("fetch_failed"));
            return;
          case "network_error":
            setStatus("failed");
            emitUiEvent({
              eventType: "ui.session.rehydrate.failed",
              sessionId,
              payload: { stage: "network" },
            });
            emitAdapterError(buildRehydrateError("network_error"));
            return;
        }
      })
      .catch((err: unknown) => {
        // AbortError is the expected path on unmount or sessionId change —
        // don't emit. Any other throw is a defect; surface to dev console.
        if (err instanceof Error && err.name === "AbortError") return;
        if (import.meta.env && import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug(
            "[useRehydrate] fetch promise rejected unexpectedly:",
            err,
          );
        }
      });

    return (): void => {
      if (inFlightRef.current !== null) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
    };
    // We deliberately include `runtime` so re-mounts (e.g. resetKey bump)
    // re-fire. `retryCounter` makes manual retry work. Stable callbacks
    // come from `onAppliedRef` / `onExpiredRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, runtime, retryCounter]);

  const retry = useCallback(() => {
    // Resetting the per-session memo + bumping the counter re-fires the
    // effect with the same id (or the latest one if it's changed).
    lastFiredForSessionRef.current = null;
    setRetryCounter((n) => n + 1);
  }, []);

  return { status, retry };
}
