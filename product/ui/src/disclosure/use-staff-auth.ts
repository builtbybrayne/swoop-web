// product/ui/src/disclosure/use-staff-auth.ts
//
// Staff authentication hook (staff-auth task).
//
// Responsibilities:
//   - Persist the staff JWT in `localStorage` so it survives page reloads
//     and cross-tab navigation on the DIRECT widget URL (not in the embedded
//     iframe — Safari ITP / third-party-storage restrictions apply there;
//     the brief is explicit that this is a known limitation).
//   - Expose `getStoredStaffToken()` so the orchestrator transport can attach
//     the token on every /session and /chat request.
//   - Expose `openLoginPopup()` — the single function that opens the password
//     prompt, calls POST /staff/auth, and stores the resulting JWT. Both UI
//     triggers call this.
//   - Wire TWO triggers that both call `openLoginPopup()`:
//       (a) Magic URL param: `?swoop_staff_login=1` on the DIRECT widget URL.
//       (b) Global `window.swoop_login()` function (console fallback recipe).
//   - Hook into the EXISTING consent/bootstrap flow — the token is forwarded
//     on /session (via SessionBootstrapRequestSchema.staffToken) and on every
//     /chat (via ChatRequestSchema.staffToken). The transport reads the stored
//     value before each request; no separate auth surface is built.
//
// The popup itself is a plain browser `prompt()` — minimal, zero-dependency,
// re-triggerable. A richer modal can replace it later without touching
// the token-storage or transport wiring.

import { useEffect, useCallback } from "react";
import { getOrchestratorUrl } from "../runtime/orchestrator-adapter";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** localStorage key for the staff JWT. Prefixed to avoid collisions. */
export const STAFF_TOKEN_KEY = "swoop.staff.token";

/**
 * Read the stored staff JWT from localStorage. Returns `null` if absent or if
 * localStorage is unavailable (privacy mode, third-party iframe context).
 */
export function getStoredStaffToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STAFF_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the staff JWT to localStorage. Silent on failure (storage locked
 * down in private mode — the token stays in memory for the page lifetime
 * via the module-level variable `_inMemoryToken`).
 */
function setStoredStaffToken(token: string): void {
  // Module-level in-memory fallback: even if localStorage is locked down, the
  // current page can still attach the token on outbound requests.
  _inMemoryToken = token;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STAFF_TOKEN_KEY, token);
  } catch {
    // Non-fatal — in-memory copy still works for this page lifetime.
  }
}

/** Clear the stored staff token from both localStorage and the in-memory slot. */
export function clearStoredStaffToken(): void {
  _inMemoryToken = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STAFF_TOKEN_KEY);
  } catch {
    // Non-fatal.
  }
}

// Module-scoped fallback when localStorage is unavailable.
let _inMemoryToken: string | null = null;

/**
 * Get the staff token from either localStorage or the in-memory fallback.
 * The transport calls this before every request so a fresh login propagates
 * on the very next turn without a page reload.
 */
export function readStaffToken(): string | null {
  return getStoredStaffToken() ?? _inMemoryToken;
}

// ---------------------------------------------------------------------------
// POST /staff/auth
// ---------------------------------------------------------------------------

export interface StaffAuthResponse {
  readonly token: string;
  readonly name: string;
  readonly expiresAt: string;
}

/**
 * Call `POST /staff/auth` with the given password and name.
 * Returns the response body on success; throws on network error or non-200.
 */
async function postStaffAuth(
  password: string,
  name: string,
): Promise<StaffAuthResponse> {
  const baseUrl = getOrchestratorUrl();
  const res = await fetch(`${baseUrl}/staff/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, name }),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = body.error.message;
    } catch {
      // Fall through with status line.
    }
    throw new Error(`Staff authentication failed: ${detail}`);
  }
  return (await res.json()) as StaffAuthResponse;
}

// ---------------------------------------------------------------------------
// Login popup
// ---------------------------------------------------------------------------

/**
 * Open the staff login popup. Prompts for name + password via native
 * `prompt()` dialogs (zero-dep, re-triggerable). On success, stores the JWT
 * and returns the staff name. Returns `null` if the user cancelled. Throws
 * on network / auth failure — callers should catch and surface via `alert`.
 */
export async function openLoginPopup(): Promise<string | null> {
  // First prompt: name (for attribution in the JWT).
  const name = window.prompt("Staff login — your name (for attribution):");
  if (name === null || name.trim().length === 0) return null; // cancelled

  // Second prompt: password.
  const password = window.prompt("Staff password:");
  if (password === null || password.length === 0) return null; // cancelled

  const result = await postStaffAuth(password.trim(), name.trim());
  setStoredStaffToken(result.token);
  return result.name;
}

// ---------------------------------------------------------------------------
// URL-param trigger helper (called once on mount, outside React lifecycle).
// ---------------------------------------------------------------------------

/**
 * If the current URL contains `swoop_staff_login=1`, trigger the login popup
 * and strip the param from the URL bar (so a reload doesn't re-trigger).
 * This is for the DIRECT widget URL — not inside the embedded iframe where
 * third-party storage / ITP applies.
 *
 * Called from `useStaffAuth` on mount via a `useEffect` with empty deps.
 */
async function handleUrlParamLogin(): Promise<void> {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const trigger = url.searchParams.get("swoop_staff_login");
  if (!trigger) return;

  // Strip the param immediately so a reload doesn't re-prompt.
  url.searchParams.delete("swoop_staff_login");
  window.history.replaceState(null, "", url.toString());

  try {
    const staffName = await openLoginPopup();
    if (staffName) {
      // Non-blocking acknowledgement. `alert` is intentional: the param
      // trigger is a one-time setup step; the user expects visual feedback.
      window.alert(`Logged in as ${staffName}. Staff mode is now active.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.alert(`Staff login failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Global `window.swoop_login()` — console fallback.
// ---------------------------------------------------------------------------

/**
 * Attach `window.swoop_login` once. Safe to call multiple times — idempotent.
 *
 * Usage: Inspect → Console → `swoop_login()`
 *
 * Re-triggerable: calling `swoop_login()` again at any point opens a fresh
 * login prompt, which replaces the stored JWT.
 */
function registerGlobalLogin(): void {
  if (typeof window === "undefined") return;
  // Use a type assertion on the window augment to keep TS happy without
  // touching global type declarations in this runtime-only file.
  const win = window as Window & { swoop_login?: () => void };
  if (win.swoop_login) return; // already registered
  win.swoop_login = () => {
    openLoginPopup().then(
      (staffName) => {
        if (staffName) {
          // eslint-disable-next-line no-console
          console.info(`[swoop] Logged in as "${staffName}". Staff mode is now active. Reload to apply to the current session, or start a new conversation.`);
        } else {
          // eslint-disable-next-line no-console
          console.info("[swoop] Staff login cancelled.");
        }
      },
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[swoop] Staff login failed:", err);
      },
    );
  };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * `useStaffAuth` — mounts both triggers once.
 *
 * Call this once at the top of the component tree (App.tsx). It:
 *   1. Registers `window.swoop_login()` on first render.
 *   2. Checks the URL for `?swoop_staff_login=1` and fires the popup if found.
 *
 * No state is exposed — token reads go through `readStaffToken()` which the
 * transport calls imperatively before each request.
 */
export function useStaffAuth(): void {
  // Register the global once, synchronously on first call. Re-registration is
  // idempotent so StrictMode double-invoke is harmless.
  registerGlobalLogin();

  // URL-param trigger — fires once on mount.
  const handleParam = useCallback(async () => {
    await handleUrlParamLogin();
  }, []);

  useEffect(() => {
    void handleParam();
    // Empty deps: fire once on mount, never on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
