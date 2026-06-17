// product/ui/src/runtime/dev-model-store.ts
//
// Dev/test-only model-override store (M-PICK-1..6).
//
// Holds JUST the conversational-orchestrator model id the dev has picked from
// the navbar dropdown, so the transport can attach it to the `/chat` body.
// Mirrors the module-scoped pub/sub shape of `parts/fyi-channel.ts`, plus
// tab-scoped persistence so a chosen model survives reloads AND the fresh-chat
// session swap (pick Opus → new session → every turn in it routes to Opus).
//
// Deliberately imports nothing from `orchestrator-adapter.ts`: the adapter
// imports `getDevModelOverride` from here, so keeping this module dependency-
// free avoids an import cycle. The catalogue fetch (which needs the
// orchestrator URL) lives in `model-picker.tsx` instead.
//
// HARD dev gate lives here: every read returns `undefined` in a production
// build (`!import.meta.env.DEV`), so the transport never attaches a model and
// the picker component (also DEV-gated) never mounts. The orchestrator ALSO
// ignores the field and 404s `/models` in production (M-PICK-2/3) — belt and
// braces, no single point of failure.
//
// See planning/03-exec-crosscut-test-mode-model-picker.md.

import { useSyncExternalStore } from "react";

/** Tab-scoped storage key for the picked model id. */
const DEV_MODEL_STORAGE_KEY = "swoop.dev.model";

const listeners = new Set<() => void>();

function readStored(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage.getItem(DEV_MODEL_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

// Cached snapshot so `useSyncExternalStore`'s getSnapshot returns a stable
// primitive between emits (no tearing, no needless re-renders).
let snapshot: string | undefined = readStored();

/**
 * The currently-selected override model id, or `undefined` when none is set
 * (→ the orchestrator uses its env default). Always `undefined` in production
 * builds — the dev gate lives here so every caller (transport included) is
 * covered by one check.
 */
export function getDevModelOverride(): string | undefined {
  if (!import.meta.env.DEV) return undefined;
  return snapshot;
}

/**
 * Set (or clear, with `undefined`) the override and notify subscribers.
 * Persists tab-scoped so the choice survives reloads and the fresh-chat
 * session swap. No-op in production.
 */
export function setDevModelOverride(id: string | undefined): void {
  if (!import.meta.env.DEV) return;
  snapshot = id;
  try {
    if (id === undefined) {
      window.sessionStorage.removeItem(DEV_MODEL_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(DEV_MODEL_STORAGE_KEY, id);
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
 * React binding for the override id. Re-renders on every
 * `setDevModelOverride`. Returns `undefined` in production.
 */
export function useDevModelOverride(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    getDevModelOverride,
    () => undefined, // server snapshot (SSR / tests without a DOM env)
  );
}

/** Test-only reset of subscribers + cached snapshot (re-reads storage). */
export function resetDevModelStore(): void {
  listeners.clear();
  snapshot = readStored();
}
