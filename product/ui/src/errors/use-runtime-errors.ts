// product/ui/src/errors/use-runtime-errors.ts
//
// Hook glue between D.t5's classifier and the rest of the chat surface.
//
// Error source: `subscribeAdapterErrors` in `runtime/orchestrator-adapter.ts`.
// The adapter knows exactly when it's failing (pre-stream throw, mid-stream
// fault, fetch rejection) and emits synchronously. Subscribing here avoids
// digging into assistant-ui's pre-1.0 thread-state internals to detect
// errored messages.
//
// Retry: we re-send the most recent user-text by reading thread state via
// `useThread((s) => s.messages)` and calling `runtime.append({...})`. If no
// user text is in scope (very edge case — never submitted), retry falls back
// to a no-op and the user re-types.
//
// Restart: delegates to a caller-supplied callback (App wires this to
// `useConsent().reset()`). Keeps this hook decoupled from consent state.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useThread, useThreadRuntime } from "@assistant-ui/react";
import { classifyError, type RuntimeError } from "./classify";
import { subscribeAdapterErrors } from "../runtime/orchestrator-adapter";

export interface UseRuntimeErrorsOptions {
  /** Invoked when the user chooses "Start a new conversation". App wires
   *  this to consent reset so the OpeningScreen re-appears. */
  onRestart: () => void;
}

export interface UseRuntimeErrorsResult {
  /** Currently active runtime error, or null if the surface is clean. */
  current: RuntimeError | null;
  /** Resend the most recent user-text. No-op if none exists. */
  retry: () => void;
  /** Clear storage + call the caller-supplied restart callback. */
  restart: () => void;
  /** Dismiss the banner without any action (user chose to move on). */
  dismiss: () => void;
}

export function useRuntimeErrors(
  options: UseRuntimeErrorsOptions,
): UseRuntimeErrorsResult {
  const { onRestart } = options;
  const [current, setCurrent] = useState<RuntimeError | null>(null);
  const threadRuntime = useThreadRuntime({ optional: true });

  // Track the most recent user-text so `retry()` can resubmit without poking
  // at assistant-ui's append-by-index APIs. `useThread` is deprecated in
  // upstream but still the stable surface at 0.12.25; deprecation warnings
  // fire once at dev-time and can be chased in a future upgrade pass.
  const lastUserText = useThread((s) => {
    const messages = s.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "user") continue;
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          return part.text;
        }
      }
    }
    return null;
  });

  useEffect(() => {
    const unsubscribe = subscribeAdapterErrors((err) => {
      setCurrent(classifyError(err));
    });
    return unsubscribe;
  }, []);

  const retry = useCallback(() => {
    if (!threadRuntime || lastUserText == null) {
      setCurrent(null);
      return;
    }
    setCurrent(null);
    // Fire-and-forget; a new failure will re-surface via the emitter.
    void threadRuntime.append({
      role: "user",
      content: [{ type: "text", text: lastUserText }],
    });
  }, [threadRuntime, lastUserText]);

  const restart = useCallback(() => {
    setCurrent(null);
    onRestart();
  }, [onRestart]);

  const dismiss = useCallback(() => {
    setCurrent(null);
  }, []);

  return useMemo(
    () => ({ current, retry, restart, dismiss }),
    [current, retry, restart, dismiss],
  );
}
