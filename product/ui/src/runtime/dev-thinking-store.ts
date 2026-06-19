// product/ui/src/runtime/dev-thinking-store.ts
//
// Dev/test-only native-thinking-override store (TT-1..TT-5).
//
// Holds JUST the boolean the dev has chosen from the navbar checkbox, so the
// transport can attach `thinkingEnabled` to the `/chat` body. Mirrors the
// module-scoped pub/sub + tab-scoped persistence of `dev-model-store.ts` (pick
// thinking-off → new session → every turn in it runs with thinking off).
//
// `undefined` = no override → the orchestrator uses its
// `ORCHESTRATOR_THINKING_ENABLED` default. The HARD gate (`isDevToolsEnabled()`)
// lives here so every read is covered by one check; the orchestrator ALSO
// ignores the field outside non-production (TT-3/TT-4) — belt and braces.
//
// See planning/03-exec-crosscut-test-mode-thinking-toggle.md.

import { useSyncExternalStore } from "react";

import { isDevToolsEnabled } from "./dev-tools";

/** Tab-scoped storage key for the thinking override. */
const DEV_THINKING_STORAGE_KEY = "swoop.dev.thinking";

const listeners = new Set<() => void>();

function readStored(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(DEV_THINKING_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

// Cached snapshot so `useSyncExternalStore`'s getSnapshot returns a stable
// primitive between emits (no tearing, no needless re-renders).
let snapshot: boolean | undefined = readStored();

/**
 * The currently-selected thinking override, or `undefined` when none is set
 * (→ the orchestrator uses its env default). Always `undefined` when dev tools
 * are disabled — the gate lives here so every caller (transport included) is
 * covered by one check.
 */
export function getDevThinkingOverride(): boolean | undefined {
  if (!isDevToolsEnabled()) return undefined;
  return snapshot;
}

/**
 * Set (or clear, with `undefined`) the override and notify subscribers.
 * Persists tab-scoped so the choice survives reloads and the fresh-chat session
 * swap. No-op when dev tools are disabled.
 */
export function setDevThinkingOverride(value: boolean | undefined): void {
  if (!isDevToolsEnabled()) return;
  snapshot = value;
  try {
    if (value === undefined) {
      window.sessionStorage.removeItem(DEV_THINKING_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(DEV_THINKING_STORAGE_KEY, value ? "true" : "false");
    }
  } catch {
    // Storage unavailable (private mode): the in-memory snapshot still drives
    // the current tab session.
  }
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // A subscriber throwing must not break the emitter.
    }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React binding for the override. Re-renders on every `setDevThinkingOverride`.
 * Returns `undefined` when dev tools are disabled / no override is set.
 */
export function useDevThinkingOverride(): boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    getDevThinkingOverride,
    () => undefined, // server snapshot (SSR / tests without a DOM env)
  );
}

/** Test-only reset of subscribers + cached snapshot (re-reads storage). */
export function resetDevThinkingStore(): void {
  listeners.clear();
  snapshot = readStored();
}
