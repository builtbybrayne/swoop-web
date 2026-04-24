// product/ui/src/session/use-preflight.ts
//
// React hook wiring the preflight probe to the D.t5 error pipeline — D.t6.
//
// Triggers (plan §D.17):
//   1. Mount: fire once the moment `enabled && sessionId` go truthy.
//   2. `visibilitychange` → visible: re-probe when the tab returns to focus.
//   3. Long-idle interval: every `idleMs` (default 15 min) belt-and-braces
//      for a tab left visible but untouched.
//
// Decision routing (plan §D.19):
//   - `{ok:true, expired:false}`   → silent.
//   - `{ok:false, expired:true}`   → emitAdapterError with `[session_not_found]`.
//     Classifier matches the marker and routes to `session_expired`.
//   - `"network_error"` sentinel   → silent. `/chat` is the authoritative
//     failure-surface path; a flaky probe must not cry-wolf.
//
// Concurrency:
//   - At most one probe in flight at any moment. Subsequent triggers while
//     one is active no-op.
//   - A 2s debounce across ALL trigger sources absorbs strict-mode double
//     invokes and rapid focus/blur storms.
//   - `AbortController` cancels the in-flight probe on unmount / consent
//     transition.
//
// No-id edge case (plan §Verification live #1 note):
//   - If `enabled && sessionId == null`, we treat that as "already expired"
//     and emit the marker directly without probing. The orchestrator has no
//     such session to probe; the UI should reflect that without a round trip.

import { useEffect, useRef } from "react";
import { emitAdapterError } from "../runtime/orchestrator-adapter";
import {
  IDLE_PREFLIGHT_MS,
  NETWORK_ERROR,
  PROBE_DEBOUNCE_MS,
  probeCurrentSession,
} from "./preflight";

export interface UsePreflightOptions {
  /**
   * Master gate. Typically `hasConsented` from `useConsent` — pre-consent
   * there's no session id worth probing, and the consent gate is the
   * natural boundary (plan §D.20).
   */
  enabled: boolean;
  /**
   * Current server-side session id. `null` when not yet bootstrapped or
   * when it's been cleared client-side (edge case: sessionStorage wiped
   * by devtools mid-visit). See §No-id edge case above.
   */
  sessionId: string | null;
  /**
   * Override for the long-idle interval. Defaults to `IDLE_PREFLIGHT_MS`.
   * Exposed for tests; no production caller uses it today.
   */
  idleMs?: number;
}

/** Shape of the `[session_not_found]`-marked error the hook emits. */
function buildExpiredError(reason: string): Error {
  // `[session_not_found]` is what `errors/classify.ts` matches on — any
  // string that includes this marker routes to the `session_expired`
  // surface. Keep the prefix exact.
  return new Error(`Preflight: session expired [session_not_found]: ${reason}`);
}

export function usePreflight(opts: UsePreflightOptions): void {
  const { enabled, sessionId } = opts;
  const idleMs = opts.idleMs ?? IDLE_PREFLIGHT_MS;

  // Refs rather than state: we don't need re-renders, only cross-callback
  // coordination. `useRef`-backed mutability is the React-idiomatic way to
  // express "imperative coordination between effects".
  const inFlightRef = useRef<AbortController | null>(null);
  const lastProbeAtRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);

  // Keep the latest enabled/sessionId accessible inside long-lived handlers
  // (visibilitychange listener, idle interval) without re-subscribing every
  // render. React gives us `useRef + sync update` as the idiomatic pattern.
  const enabledRef = useRef(enabled);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    enabledRef.current = enabled;
    sessionIdRef.current = sessionId;
  }, [enabled, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    // Don't wire triggers while disabled; the hook is a no-op until
    // `enabled` flips true. Re-evaluated on every dep change.
    if (!enabled) return;

    /**
     * Run one probe subject to the debounce + in-flight guards. Safe to call
     * from any trigger; no-ops when another probe is in progress or when
     * the last probe landed within `PROBE_DEBOUNCE_MS`.
     */
    const runProbe = (): void => {
      if (!mountedRef.current) return;
      if (!enabledRef.current) return;

      // In-flight guard: if a probe is already running, the caller's
      // trigger can wait for the next window.
      if (inFlightRef.current !== null) return;

      const now = Date.now();
      if (now - lastProbeAtRef.current < PROBE_DEBOUNCE_MS) return;
      lastProbeAtRef.current = now;

      const currentId = sessionIdRef.current;
      if (currentId == null) {
        // No id to probe — the server can't know about a session that was
        // never minted. Treat as expired: visitor needs to re-consent /
        // refresh to get a new id. This matches how `orchestrator-adapter`
        // treats "no id in storage" on `/chat`.
        emitAdapterError(buildExpiredError("no session id in client state"));
        return;
      }

      const controller = new AbortController();
      inFlightRef.current = controller;

      probeCurrentSession(currentId, controller.signal)
        .then((result) => {
          if (!mountedRef.current) return;
          if (result === NETWORK_ERROR) {
            // Silent. `/chat` is the authoritative channel — if the probe
            // is blocked but the server is alive, the next user message
            // gets the correct signal via D.t5's `unreachable` path.
            if (import.meta.env && import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.debug(
                "[preflight] probe network_error — suppressed (not surfaced to banner)",
              );
            }
            return;
          }
          if (result.expired) {
            emitAdapterError(buildExpiredError("probe returned expired:true"));
            return;
          }
          // ok: session live — no UI action.
        })
        .catch((err: unknown) => {
          // Abort is the expected path on unmount; don't emit.
          if (err instanceof Error && err.name === "AbortError") return;
          if (import.meta.env && import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[preflight] probe threw unexpectedly:", err);
          }
        })
        .finally(() => {
          // Only clear if this controller is still the active one — a
          // subsequent trigger might have spawned a new controller if our
          // debounce window has since passed (not reachable today, but
          // defensive).
          if (inFlightRef.current === controller) {
            inFlightRef.current = null;
          }
        });
    };

    // Mount trigger — fire once on the effect's initial run. React 18
    // strict mode double-invokes this effect in dev; the debounce (and
    // in-flight guard) absorbs the second run cleanly.
    runProbe();

    // Visibility trigger.
    const onVisibility = (): void => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        runProbe();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    // Idle trigger. setInterval is cleared on cleanup; no re-arm logic on
    // visibility change because `runProbe`'s debounce handles the "came
    // back after hours" case correctly — the first probe fires via the
    // visibility listener, further idle ticks are no-ops until `idleMs`
    // elapses again.
    const idleTimerId: ReturnType<typeof setInterval> = setInterval(
      runProbe,
      idleMs,
    );

    return (): void => {
      mountedRef.current = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      clearInterval(idleTimerId);
      if (inFlightRef.current !== null) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
    };
    // `sessionId` is deliberately excluded from the dep list: changes to it
    // are read via `sessionIdRef` without re-running the whole effect (and
    // tearing down listeners). `enabled` IS a dep because flipping it
    // false requires full teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idleMs]);
}
