// product/ui/src/session/rehydrate.ts
//
// Pure helper: `GET /session/:id/history` against the orchestrator and
// translate the outcome into a shape `useRehydrate` can dispatch on. Same
// posture as `preflight.ts` — React-free so unit tests target the contract
// without a JSDOM hop.
//
// Wire contract (paired with planning/03-exec-agent-runtime-t11.md — B.t11):
//
//   GET /session/<sessionId>/history
//
//   200 OK  { parts: MessagePart[] }                  — happy path (any length,
//                                                       including empty array)
//   404     { error: { code: "session_not_found",
//                      message: string } }            — unknown / deleted /
//                                                       desynced / pre-consent
//   500     { error: { code: "internal_error", ... }} — server fault
//   503     { error: { code: "unavailable", ... }}    — post-M4 only; routed
//                                                       through fetch_failed
//                                                       here so the UI surface
//                                                       collapses cleanly today
//   network throw                                     — DNS / CORS / refused
//
// Outcome shape mirrors `preflight.ts`'s discriminator-free union: a single
// `{parts}` happy result, four `{error: <reason>}` failure paths. The caller
// (`useRehydrate`) translates the union into the public `RehydrateStatus`.
//
// Per D.t9-mount-rehydrate plan §"Files this plan adds".
// Per HITL ratification 2026-05-12: 404 = soft-fail to OpeningScreen with a
// notification (no manual click); empty replay = no special case (treated as
// fresh chat).

import type { MessagePart } from "@swoop/common";
import { getOrchestratorUrl } from "../runtime/orchestrator-adapter";

/**
 * The four mutually-exclusive verdicts a single `fetchSessionHistory` call
 * collapses to. Keep additions to this union narrow — `useRehydrate` switches
 * exhaustively on it.
 */
export type FetchHistoryResult =
  | { readonly parts: readonly MessagePart[] }
  | { readonly error: "session_not_found" }
  | { readonly error: "fetch_failed" }
  | { readonly error: "network_error" };

/**
 * Type-narrowing predicate. Tests + the hook both consume.
 */
export function isFetchHistorySuccess(
  result: FetchHistoryResult,
): result is { readonly parts: readonly MessagePart[] } {
  return "parts" in result;
}

/**
 * Issue a single `GET /session/<sessionId>/history` and translate the outcome
 * into a `FetchHistoryResult`.
 *
 * Contract:
 *   - 200 with a parseable body containing `{parts: MessagePart[]}` →
 *     `{parts}`. Empty array is the happy path with `parts.length === 0`.
 *   - 404 with `error.code === "session_not_found"` → `{error:"session_not_found"}`.
 *   - Any other non-2xx → `{error:"fetch_failed"}` (5xx and unexpected 4xx
 *     both fall here; UI doesn't differentiate beyond the surface).
 *   - Body present but parse failure → `{error:"fetch_failed"}` (we got a
 *     response, but it isn't usable — server fault from the UI's POV).
 *   - Fetch throw (DNS / connection refused / CORS) → `{error:"network_error"}`.
 *
 * `AbortError` is rethrown as-is so the caller's AbortController contract is
 * observable; all other errors collapse into the sentinel set.
 *
 * @param baseUrl   Orchestrator base URL.
 * @param sessionId The session id to project. URL-encoded internally.
 * @param signal    Optional AbortSignal. Triggers `AbortError`.
 */
export async function fetchSessionHistoryAt(
  baseUrl: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<FetchHistoryResult> {
  const url = `${baseUrl}/session/${encodeURIComponent(sessionId)}/history`;

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    return { error: "network_error" };
  }

  if (response.status === 404) {
    // The body MAY carry `{error:{code:"session_not_found",...}}` per B.t11's
    // envelope, but we don't require it — the 404 itself is authoritative.
    // Best-effort body drain to release the connection; ignore parse errors.
    try {
      await response.json();
    } catch {
      // Body not JSON — fine, the status is enough.
    }
    return { error: "session_not_found" };
  }

  if (!response.ok) {
    // Any other non-2xx is a server fault (500, 503, unexpected 4xx). Drain
    // the body so the fetch doesn't dangle; we don't differentiate beyond
    // routing through the `unknown` surface via `[rehydrate_failed:fetch_failed]`.
    try {
      await response.json();
    } catch {
      // Same — body shape isn't load-bearing for this branch.
    }
    return { error: "fetch_failed" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { error: "fetch_failed" };
  }

  if (!isHistoryResponse(body)) {
    return { error: "fetch_failed" };
  }
  return { parts: body.parts };
}

/**
 * Convenience wrapper that resolves the base URL via Vite env. Mirrors
 * `probeCurrentSession` in `preflight.ts` — the call site doesn't need to
 * know where the orchestrator lives.
 */
export function fetchSessionHistory(
  sessionId: string,
  signal?: AbortSignal,
): Promise<FetchHistoryResult> {
  return fetchSessionHistoryAt(getOrchestratorUrl(), sessionId, signal);
}

/** Defensive shape guard. `MessagePart` itself is validated only structurally
 *  — full schema validation happens at the orchestrator boundary; here we
 *  only require the wrapper. A drifted server payload still routes through
 *  `fetch_failed` rather than crashing the hook. */
function isHistoryResponse(
  v: unknown,
): v is { readonly parts: readonly MessagePart[] } {
  if (v === null || typeof v !== "object") return false;
  const obj = v as { parts?: unknown };
  return Array.isArray(obj.parts);
}
