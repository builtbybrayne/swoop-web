// product/ui/src/disclosure/use-consent.ts
//
// Hook managing the tier-1 (conversation-opening) consent state for the chat
// surface.
//
// Responsibilities:
//   - Track whether the current visitor has already granted tier-1 consent in
//     this tab (persisted via `sessionStorage` so reloads don't re-prompt).
//   - Expose a `grantConsent()` function that drives the paired bootstrap +
//     consent handshake against the orchestrator:
//         1) `POST /session`                  → { sessionId, disclosureCopyVersion }
//         2) `PATCH /session/:id/consent`     ← echo copyVersion back
//     On success, stores the session id and flips local state to "granted".
//   - Expose a `declineConsent()` that closes the surface cleanly with no
//     network I/O and no persisted state (per D.t4 plan §"No thanks must
//     actually leave").
//
// Tier-2 (handoff) consent lives in `widgets/lead-capture.tsx`, not here.
// See planning/03-exec-chat-surface-t4.md.

import { useCallback, useEffect, useState } from "react";
import {
  SESSION_STORAGE_KEY,
  getOrchestratorUrl,
} from "../runtime/orchestrator-adapter";

/** Tab-scoped flag indicating the visitor already granted tier-1 consent. */
export const CONSENT_STORAGE_KEY = "swoop.consent.tier1";

/** Copy-version echoed back in the consent grant; audit trail per E.4. */
export const CONSENT_COPY_VERSION_KEY = "swoop.consent.copyVersion";

/** Signal emitted to the parent host when the visitor declines. */
export const DECLINE_POSTMESSAGE_TYPE = "swoop.discovery.declined";

export type ConsentStatus =
  | { state: "pending" }
  | { state: "granting" }
  | { state: "granted"; sessionId: string; copyVersion: string }
  | { state: "declined" }
  | { state: "error"; message: string };

export interface UseConsentResult {
  /** Current state of the consent handshake. */
  status: ConsentStatus;
  /** True if the visitor has granted consent this tab. */
  hasConsented: boolean;
  /** True while the network handshake is in flight. */
  isGranting: boolean;
  /** True once the visitor has actively declined — parent host should unmount. */
  hasDeclined: boolean;
  /**
   * Continue handler: bootstraps session + writes consent to the orchestrator.
   * Safe to call multiple times — bails if already granting or granted.
   */
  grantConsent: () => Promise<void>;
  /**
   * No-thanks handler: closes the surface cleanly with no network traffic,
   * no session id, no persisted state. Posts a message so parent iframes can
   * listen and unmount if they wish.
   */
  declineConsent: () => void;
}

function readStoredConsent(): {
  sessionId: string;
  copyVersion: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const granted = window.sessionStorage.getItem(CONSENT_STORAGE_KEY);
    const sessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    const copyVersion = window.sessionStorage.getItem(
      CONSENT_COPY_VERSION_KEY,
    );
    if (granted === "true" && sessionId && copyVersion) {
      return { sessionId, copyVersion };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredConsent(sessionId: string, copyVersion: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    window.sessionStorage.setItem(CONSENT_STORAGE_KEY, "true");
    window.sessionStorage.setItem(CONSENT_COPY_VERSION_KEY, copyVersion);
  } catch {
    // Non-fatal — consent still holds for this render lifetime, but won't
    // survive a reload. Acceptable degradation.
  }
}

async function postSession(baseUrl: string): Promise<{
  sessionId: string;
  disclosureCopyVersion: string;
}> {
  const res = await fetch(`${baseUrl}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(
      `Session bootstrap failed: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as {
    sessionId?: string;
    id?: string;
    disclosureCopyVersion?: string;
  };
  const sessionId = body.sessionId ?? body.id;
  if (!sessionId) throw new Error("Session bootstrap response missing session id");
  // Fall back to "v1" if the orchestrator omits the version — matches the
  // placeholder copy revision used below.
  const disclosureCopyVersion = body.disclosureCopyVersion ?? "v1";
  return { sessionId, disclosureCopyVersion };
}

async function patchConsent(
  baseUrl: string,
  sessionId: string,
  copyVersion: string,
): Promise<void> {
  const res = await fetch(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}/consent`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ granted: true, copyVersion }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Consent grant failed: ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Controls tier-1 consent state for the chat surface.
 *
 * On mount, re-hydrates from `sessionStorage` so reload preserves the
 * dismissed-opening-screen state (per D.t4 plan §Verification 4).
 */
export function useConsent(): UseConsentResult {
  const [status, setStatus] = useState<ConsentStatus>(() => {
    const stored = readStoredConsent();
    if (stored) {
      return {
        state: "granted",
        sessionId: stored.sessionId,
        copyVersion: stored.copyVersion,
      };
    }
    return { state: "pending" };
  });

  // Re-check storage on mount in case SSR / strict-mode double-invoke causes
  // the initial read to return stale. No-op in 99% of cases. Guards on
  // `status.state` so the effect is idempotent under strict-mode double
  // invocation.
  useEffect(() => {
    if (status.state !== "pending") return;
    const stored = readStoredConsent();
    if (stored) {
      setStatus({
        state: "granted",
        sessionId: stored.sessionId,
        copyVersion: stored.copyVersion,
      });
    }
  }, [status.state]);

  const grantConsent = useCallback(async (): Promise<void> => {
    // Idempotent: bail if already running or already granted.
    setStatus((prev) => {
      if (prev.state === "granting" || prev.state === "granted") return prev;
      return { state: "granting" };
    });
    try {
      const baseUrl = getOrchestratorUrl();
      const { sessionId, disclosureCopyVersion } = await postSession(baseUrl);
      await patchConsent(baseUrl, sessionId, disclosureCopyVersion);
      writeStoredConsent(sessionId, disclosureCopyVersion);
      setStatus({
        state: "granted",
        sessionId,
        copyVersion: disclosureCopyVersion,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus({ state: "error", message });
    }
  }, []);

  const declineConsent = useCallback((): void => {
    // No network. No sessionStorage writes. No analytics. "No" means no.
    setStatus({ state: "declined" });
    if (typeof window !== "undefined") {
      try {
        // Give the parent host (if embedded) a chance to unmount the iframe.
        window.parent?.postMessage({ type: DECLINE_POSTMESSAGE_TYPE }, "*");
      } catch {
        // Cross-origin throws are expected and benign.
      }
    }
  }, []);

  return {
    status,
    hasConsented: status.state === "granted",
    isGranting: status.state === "granting",
    hasDeclined: status.state === "declined",
    grantConsent,
    declineConsent,
  };
}
