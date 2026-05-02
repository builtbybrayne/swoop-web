// product/ui/src/runtime/handoff-client.ts
//
// Client for `POST /handoff/submit` (E.t3). Called by the lead-capture
// widget when the visitor submits their contact details.
//
// Why a separate module from `orchestrator-adapter.ts`:
//   - The adapter speaks the chat SSE protocol; this is a discrete JSON
//     POST. Different lifecycle, different error shape.
//   - Keeps the widget thin — it composes the request body from its own
//     state (args + form), hands off to this helper, branches on the
//     `HandoffSubmitResponse` shape.
//
// The helper reads the current session id from sessionStorage (same key
// the orchestrator-adapter uses) so the caller doesn't need to plumb it.

import { messageOf } from "@swoop/common";
import type {
  HandoffSubmitRequest,
  HandoffSubmitResponse,
} from "@swoop/common";

import { SESSION_STORAGE_KEY } from "./orchestrator-adapter";

/** Resolve the orchestrator base URL from Vite env, falling back to dev. */
function resolveOrchestratorUrl(): string {
  const url = import.meta.env.VITE_ORCHESTRATOR_URL;
  return typeof url === "string" && url.length > 0
    ? url
    : "http://localhost:8080";
}

/** Tab-scoped session id store (same convention as the chat adapter). */
function readSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * POST a handoff-submit request to the orchestrator. Always returns a
 * `HandoffSubmitResponse` — network errors / non-JSON responses are
 * normalised into `{ ok: false, reason: 'internal_error', ... }` so the
 * caller has a single shape to switch on.
 *
 * The caller supplies everything except the `sessionId`; this helper reads
 * it from sessionStorage.
 */
export async function postHandoffSubmit(
  body: Omit<HandoffSubmitRequest, "sessionId">,
): Promise<HandoffSubmitResponse> {
  const sessionId = readSessionId();
  if (!sessionId) {
    return {
      ok: false,
      reason: "session_not_found",
      detail: "no session id in storage",
    };
  }

  const fullBody: HandoffSubmitRequest = { ...body, sessionId };
  let res: Response;
  try {
    res = await fetch(`${resolveOrchestratorUrl()}/handoff/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(fullBody),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "internal_error",
      detail: messageOf(err),
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return {
      ok: false,
      reason: "internal_error",
      detail: `non-JSON response (status ${res.status})`,
    };
  }

  // Trust the orchestrator's typed response shape; widget tests assert on
  // it. If a future schema change breaks the contract, the consumer-side
  // error path will surface the mismatch as a runtime crash, which is the
  // right loud failure mode for a contract violation.
  return parsed as HandoffSubmitResponse;
}
