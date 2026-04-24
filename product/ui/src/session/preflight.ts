// product/ui/src/session/preflight.ts
//
// Pure preflight probe + trigger constants — D.t6.
//
// Proactive session-liveness probe that lets the UI detect expired sessions
// BEFORE the visitor types, rather than after they hit Send and get a 404.
// Layered on top of D.t5: on expiry, we route through the shared adapter
// error emitter with a `[session_not_found]` marker so the classifier (see
// errors/classify.ts) routes the same way `/chat` 404s already do.
//
// This file is deliberately React-free. The hook that owns mount/focus/idle
// triggers lives in `use-preflight.ts`; this module is pure logic so the
// behavioural contract is unit-testable in isolation.
//
// See planning/03-exec-chat-surface-t6.md §Key implementation notes.

import type { SessionPingResponse } from "@swoop/common";
import { getOrchestratorUrl } from "../runtime/orchestrator-adapter";

export type { SessionPingResponse };

/**
 * Sentinel returned by `probeSession` when the probe itself failed to reach
 * the server (fetch reject / non-2xx). Distinct from `{expired:true}` so the
 * hook can silently suppress probe-flake without cry-wolfing "session
 * expired" at a momentary network blip. Decision D.19 in the Tier 3 plan.
 */
export const NETWORK_ERROR = "network_error" as const;
export type NetworkErrorSentinel = typeof NETWORK_ERROR;

export type ProbeResult = SessionPingResponse | NetworkErrorSentinel;

// ---------------------------------------------------------------------------
// Trigger thresholds
// ---------------------------------------------------------------------------

/**
 * Default idle-interval threshold. Two anchoring numbers:
 *   - Orchestrator in-memory idle TTL is 24h (B.t2); any value much below
 *     that catches expiry before the sweeper fires.
 *   - Natural pauses in a discovery conversation are typically <10 minutes.
 *     At 15 min we're unambiguously past "coming right back" but well short
 *     of the archive window.
 * See plan §D.18.
 */
export const IDLE_PREFLIGHT_MS = 15 * 60 * 1000;

/**
 * Minimum gap between consecutive probes regardless of trigger. Prevents a
 * strict-mode double-invoke or a rapid focus/blur storm from double-firing.
 * Applies across ALL trigger sources; the in-flight guard covers the
 * "overlapping probe" case separately. See plan §D.17.
 */
export const PROBE_DEBOUNCE_MS = 2_000;

// ---------------------------------------------------------------------------
// probeSession — pure helper
// ---------------------------------------------------------------------------

/**
 * Issue a single `GET /session/:id/ping` request and translate the outcome
 * into either the parsed `SessionPingResponse` or the `NETWORK_ERROR`
 * sentinel.
 *
 * Contract:
 *   - 200 with a parseable body → return that body verbatim.
 *   - Any fetch rejection (DNS, connection refused, CORS block) → NETWORK_ERROR.
 *   - Any non-2xx status → NETWORK_ERROR. The endpoint always returns 200 on
 *     good paths (decision D.16), so a non-2xx here is a server fault or
 *     intermediate proxy — not authoritative evidence the session has died.
 *   - JSON parse failure → NETWORK_ERROR for the same reason.
 *
 * AbortError is rethrown as-is so the caller's AbortController contract is
 * observable. All other exceptions collapse to NETWORK_ERROR.
 */
export async function probeSession(
  baseUrl: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const url = `${baseUrl}/session/${encodeURIComponent(sessionId)}/ping`;

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    return NETWORK_ERROR;
  }

  if (!response.ok) {
    return NETWORK_ERROR;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return NETWORK_ERROR;
  }

  if (!isSessionPingResponse(body)) {
    return NETWORK_ERROR;
  }
  return body;
}

/** Narrow unknown → SessionPingResponse. Keeps parse errors defensive. */
function isSessionPingResponse(v: unknown): v is SessionPingResponse {
  if (v === null || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.ok === "boolean" &&
    typeof obj.expired === "boolean" &&
    typeof obj.serverTime === "string"
  );
}

/**
 * Convenience wrapper that resolves the base URL from Vite env in one place,
 * mirroring the pattern in `orchestrator-adapter.ts`. Callers that need to
 * inject a base URL (tests) go through `probeSession` directly.
 */
export function probeCurrentSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  return probeSession(getOrchestratorUrl(), sessionId, signal);
}
