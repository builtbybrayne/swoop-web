// product/ui/src/parts/reasoning-guard.ts
//
// Dev-mode safety net for decision D.9: `<reasoning>` blocks must NEVER reach
// the browser. The orchestrator's translator (chunk B, task t4) strips them
// before writing to the outbound SSE stream; this file is the client-side
// tripwire that catches translator regressions fast.
//
// Behaviour:
//   - Development (import.meta.env.DEV === true): throws a loud error with a
//     pointer to the fix site. Crashes the render so it shows up in the
//     normal React error overlay; agents can't miss it.
//   - Production (DEV === false): silently drops the part by rendering null.
//     Users never see reasoning, and a lingering translator bug downgrades
//     gracefully rather than white-screening the surface.
//
// Wiring: `parts/index.ts` installs `ReasoningGuard` as the `Reasoning`
// component in the `MessagePrimitive.Parts` component map. Any part whose
// `type === "reasoning"` is routed through here.
//
// Not a filter: if this ever fires in production, the right fix is in chunk
// B's translator, not additional filtering here.

import { createElement, type ReactElement } from "react";

/**
 * The canonical error message. Kept in a constant so the test can assert on
 * it without duplicating the pointer to chunk B.
 */
export const REASONING_GUARD_MESSAGE =
  "[swoop.ui] reasoning part reached the UI. " +
  "This violates decision D.9 — reasoning blocks must be stripped by the " +
  "orchestrator translator before hitting the SSE stream. " +
  "Fix in product/orchestrator (chunk B, t4 translator), not here. " +
  "See planning/02-impl-agent-runtime.md §2.4.";

/**
 * Returns whether the current environment is development.
 *
 * Wrapped so tests can vi.stubEnv the flag without the production-mode branch
 * being dead-code-eliminated. Vite inlines `import.meta.env.DEV` as a literal
 * boolean at build time; in vitest the inline is dynamic (env is provided at
 * test runtime), which is the behaviour we want for the guard test.
 */
export function isDevEnvironment(): boolean {
  // `import.meta.env` is defined by Vite and by Vitest's vite-node runner.
  //
  // We prefer `MODE` over `DEV` because `vi.stubEnv` can override string
  // keys but not the boolean `DEV` flag cleanly — the prod-mode test needs
  // MODE to be the authority. Production Vite builds set
  // `MODE === "production"` (and `DEV === false`), so the behaviour is
  // identical to checking `DEV` for real users.
  //
  // Falling back to NODE_ENV keeps this safe in a vanilla Node context (e.g.
  // if the module is ever imported outside Vite tooling).
  const meta = import.meta as unknown as {
    env?: { DEV?: boolean; MODE?: string };
  };
  if (typeof meta.env?.MODE === "string") {
    return meta.env.MODE !== "production";
  }
  if (typeof meta.env?.DEV === "boolean") return meta.env.DEV;
  return (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * assistant-ui Reasoning component. In dev mode, throwing from the render
 * function surfaces via React's error boundary / overlay. In prod, we render
 * nothing.
 *
 * Signature matches `ReasoningMessagePartComponent` from @assistant-ui/core
 * but we ignore the props — no reasoning content should ever be shown.
 *
 * Kept as a factory-style function (not a JSX-returning component) so the
 * `.ts` extension is honest — no TSX features needed.
 */
export function ReasoningGuard(_props?: unknown): null {
  if (isDevEnvironment()) {
    throw new Error(REASONING_GUARD_MESSAGE);
  }
  return null;
}

ReasoningGuard.displayName = "ReasoningGuard";

/**
 * Convenience wrapper used from tests that want to render the guard without
 * JSX. Returns a React element (dev mode throws before element construction).
 */
export function createReasoningGuardElement(): ReactElement | null {
  if (isDevEnvironment()) {
    throw new Error(REASONING_GUARD_MESSAGE);
  }
  return createElement(ReasoningGuard);
}
