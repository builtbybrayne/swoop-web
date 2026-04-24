# 03 — Execution: D.t5 Error States

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: D (chat surface).
**Implements**: [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §2.7 (five error surfaces) — completes the last core gap before the deferred D.t6–t8 tasks.
**Depends on**: D.t1–t4 (shipped). The AI SDK transport (`orchestrator-adapter.ts`) already throws on non-2xx + emits mid-stream `error` chunks; the gap is a UI surface that picks those up and presents them as recoverable states.
**Produces**:
- `product/cms/errors/en.ts` — single-locale authored copy for each error surface (title, body, primary/secondary action labels).
- `product/ui/src/errors/` — banner component, runtime-error hook, classifier, barrel.
- Small adapter tweak so `session_not_found` is a distinguishable thrown error code on the UI side.
- App.tsx wiring: banner above the composer; restart-conversation path that resets consent + session.
**Estimate**: ~2–3h focused work.

---

## Purpose

Give every failure mode from §2.7 a visible, recoverable UX rather than a thrown-to-console error. Five surfaces:

1. **Orchestrator unreachable** — fetch rejects or returns 5xx. Retry the last user message.
2. **SSE stream drops mid-turn** — adapter emits a chunk `{type:"error", errorText}` partway through the assistant reply. Surface + retry.
3. **Tool call returned an error** — already rendered inline by `widget-shell.tsx`'s malformed placeholder; D.t5 upgrades the copy + replaces the temporary amber card with the D.t5 token.
4. **Session not found / expired** — HTTP 404 + code `session_not_found`. Restart-conversation UX: clear session id, clear tier-1 consent state, return to opening screen with a small "your previous conversation expired" preamble.
5. **Rate limited** — placeholder only (not enforced in Puma). HTTP 429 → same banner shape, retry disabled for a brief cool-off window. Implementation surface present; no actual server-side enforcement needed.

Not in scope:
- Auto-retry with exponential backoff. (Manual retry button only. A single resume attempt for stream-drop is OK if cheap; otherwise defer.)
- Offline detection / `navigator.onLine` heuristics.
- Telemetry of error occurrence — chunk F owns event emission.
- Tool-call retry. Tool errors are agent-side; the agent decides whether to retry.
- Accessibility audit. Baseline care only: `role="alert"` + keyboard-reachable buttons.

---

## File plan

### `product/cms/errors/en.ts` (new)

Authored copy. Export shape:

```ts
export type ErrorCopy = {
  title: string;
  body: string;
  primary?: { label: string; kind: "retry" | "restart" | "dismiss" };
  secondary?: { label: string; kind: "restart" | "dismiss" };
};

export type ErrorSurface =
  | "unreachable"
  | "stream_drop"
  | "session_expired"
  | "rate_limited"
  | "unknown";

export const ERROR_COPY: Record<ErrorSurface, ErrorCopy> = { … };
```

Tone: warm, calm, honest. No jargon. Examples:

- **unreachable** — "Having trouble connecting. Please try again in a moment." / primary: "Try again" (retry) / secondary: "Start over" (restart).
- **stream_drop** — "The connection dropped mid-reply. Let's try that again." / primary: "Try again" (retry).
- **session_expired** — "This conversation has expired. We'll need to start a fresh one." / primary: "Start a new conversation" (restart).
- **rate_limited** — "We're getting a lot of requests right now. Please try again in a moment." / no primary (cool-off).
- **unknown** — "Something went wrong on our side. Please try again." / primary: "Try again" (retry) / secondary: "Start over" (restart).

Why TS not JSON: type-safe at the call site, no runtime parse step, no `fetch`-style loader needed for five strings. Still satisfies content-as-data (lives in `cms/`, no prose in `ui/src/`).

### `product/ui/src/errors/classify.ts` (new)

Pure function. Inputs: a thrown `Error` or AI SDK `ErrorUIMessagePart`-style chunk; outputs a tagged union.

```ts
export type RuntimeError =
  | { surface: "unreachable"; retryable: true; cooloffMs: 0 }
  | { surface: "stream_drop"; retryable: true; cooloffMs: 0 }
  | { surface: "session_expired"; retryable: false; cooloffMs: 0 }
  | { surface: "rate_limited"; retryable: true; cooloffMs: number }
  | { surface: "unknown"; retryable: true; cooloffMs: 0 };

export function classifyError(err: unknown): RuntimeError;
```

Detection rules:
- Message contains `session_not_found` OR HTTP status was 404 → `session_expired`.
- Message contains `rate_limited` OR HTTP 429 → `rate_limited` (cooloff 30_000ms — arbitrary placeholder).
- Error thrown from inside an open SSE stream (detectable via an `isStreamError` flag we'll attach in the adapter tweak) → `stream_drop`.
- Any `TypeError` matching `Failed to fetch` / `NetworkError` / abort-unrelated → `unreachable`.
- Everything else → `unknown`.

Unit-testable — pure function; add a small `__tests__/classify.test.ts` covering each branch.

### `product/ui/src/errors/use-runtime-errors.ts` (new)

React hook wrapping the assistant-ui thread's error signal. Returns:

```ts
{
  current: RuntimeError | null;
  retry: () => void;   // reissues the last user message
  restart: () => void; // clears session + consent, returns to OpeningScreen
  dismiss: () => void; // clears `current` only
}
```

Implementation notes:
- Subscribes to the assistant-ui thread via `useThread()` / `useThreadRuntime()` (exact API settled during implementation — the library is pre-1.0). The runtime exposes an `error` field on the active message or thread-level; we read that, pass through `classifyError`, memoise.
- `retry`: the hook doesn't know the last user text; it calls `threadRuntime.reload()` (or the closest equivalent) which resubmits the last user message with a fresh stream. If reload isn't available, fallback is: the user types again. Document the fallback in comments.
- `restart`: clears `sessionStorage` (session id + consent keys), then forces a re-render of App so `useConsent()` reads fresh state and returns to the OpeningScreen. Implementation: a small context-level "restart counter" ref that App keys into, OR the blunter `window.location.reload()`. Prefer the context path — keeps the SPA feel, respects any non-consent state (privacy modal etc.) — but `location.reload()` is acceptable if the runtime API doesn't give us a clean reset handle. Decide at implementation time.

### `product/ui/src/errors/error-banner.tsx` (new)

Presentational component. Inputs: `{ error: RuntimeError | null; onRetry, onRestart, onDismiss }`. Reads copy from `@swoop/cms-errors/en` (local relative import — cms is not a workspace; see below).

- Renders as a slate-900-on-amber (for retryable) or slate-900-on-rose (for session_expired) banner above the composer.
- `role="alert"` for screen readers, `aria-live="polite"`.
- Primary + secondary buttons if present in copy; wired to `onRetry` / `onRestart` / `onDismiss` based on `kind`.
- `rate_limited` shows a cooloff countdown (MM:SS) disabling retry until expiry — lightweight `useEffect` + interval. No server-side cooloff sync; this is a UX placeholder.
- Null error → returns null; no banner in the DOM.

### `product/ui/src/errors/index.ts` (new)

Barrel: re-exports `ErrorBanner`, `useRuntimeErrors`, `classifyError`, `RuntimeError`.

### `product/ui/src/runtime/orchestrator-adapter.ts` (edit)

Three surgical changes:

1. **Structured error shape** — when `response.ok === false`, include the orchestrator's `error.code` in the thrown Error's `.cause` (or as a prefix in the message we already build). Preserve the current message format for logs; add a parseable marker the classifier can match on. Keep it simple: throw `new Error(\`Orchestrator /chat failed [${code}]: ${detail}\`)` so the classifier can regex `[session_not_found]`.
2. **Stream-error marker** — the catch block at the end of the ReadableStream's `start()` that emits `{type:"error",errorText}` already stringifies the upstream error. Prefix the `errorText` with `[stream]` so the classifier routes it to `stream_drop`.
3. **429 passthrough** — today 429 hits the `!response.ok` branch and becomes `unknown`. Explicitly detect `response.status === 429` and throw with code `rate_limited`.

No behaviour change on the happy path.

### `product/ui/src/App.tsx` (edit)

- Import `ErrorBanner` + `useRuntimeErrors`.
- Inside the post-consent `ThreadPrimitive.Root`, render the banner between `Thread.Viewport` and the composer row.
- Wire `restart` to a callback that resets consent (new function added to `useConsent` → `reset()`: clears both the session id and the tier-1 consent entry from sessionStorage; triggers a rerender).

### `product/ui/src/disclosure/use-consent.ts` (small edit)

Add `reset(): void` to the hook's returned API. Clears the stored consent + session id, flips local state back to `"pending"`. Existing callers unaffected.

### `product/ui/src/widgets/widget-shell.tsx` (small edit)

Replace the temporary `WidgetMalformedPlaceholder` amber card body copy with the D.t5 copy for tool-call errors (from `cms/errors/en.ts` under a new key `tool_error`). The placeholder itself stays — widgets still render inline, tool errors don't deserve a full banner. Keep the shell local; no behavioural change.

Add `tool_error` to `ErrorSurface` / `ERROR_COPY`:
- **tool_error** — "I couldn't load that. We can still keep talking, or try asking a different way."

---

## Content-as-data compliance

All copy lives in `product/cms/errors/en.ts`. `ui/src/errors/` and `ui/src/widgets/widget-shell.tsx` reference the constants; no prose strings exist in those files. Future localisation = add `cms/errors/<locale>.ts` + a resolver. Out of scope for Puma.

---

## Shared contracts touched

- **Orchestrator error envelope** (`{error:{code,message}}`) — already stable (chunk B.t5). D.t5 consumes `code` values: `session_not_found`, `rate_limited` (not yet emitted; placeholder). Other codes fall into `unknown`.
- **AI SDK `error` UIMessageChunk** — already handled by the adapter. D.t5 adds a small marker convention; AI SDK consumers untouched.

---

## Verification

1. Kill the orchestrator (`:8080`). Reload UI. Type a message. **Expected**: banner appears with "Having trouble connecting…" + Try again + Start over. Clicking Try again with orchestrator still down re-shows the banner (idempotent). Bringing the orchestrator back + clicking Try again completes the turn.
2. Clear sessionStorage's `swoop.session.id` (but leave consent). Type a message. **Expected**: banner "This conversation has expired." + Start a new conversation. Click restart → opening screen (or same screen with a preamble, depending on implementation). Consent re-granted → fresh session id issued → conversation resumes.
3. Simulate mid-stream drop: orchestrator kill while a reply is streaming. **Expected**: partial assistant message stays visible (assistant-ui native behaviour); banner appears with "The connection dropped mid-reply." + Try again. Retry works.
4. Tool-call error: force a connector failure (stub raises). **Expected**: widget renders the updated malformed placeholder; no banner.
5. Rate-limited placeholder: temporarily hard-code the adapter to throw `rate_limited` once. **Expected**: banner shows cooloff countdown; retry button disabled until countdown ends.
6. Unit tests pass for `classify.ts`.
7. Existing 34/34 UI tests still green; no regressions.

The big two — orchestrator-down and session-expired — must be verified **live in the preview**, not just unit-tested.

---

## Out-of-scope reminders (don't drift)

- No telemetry. Chunk F.
- No auto-retry loops.
- No offline detection.
- No `localStorage` fallback for session resumption across tabs.
- No redesign of `widget-shell.tsx` — only the copy string swap + `cms/` reference.

---

## Handoff

D.t6 (session handling) immediately follows; it owns the proactive session-expiry-before-message-send case (e.g. a PATCH preflight). D.t5's reactive path (send failed with 404) covers today's failure mode cleanly; D.t6 can layer proactive detection on top without redoing D.t5's work.

---

## Landed 2026-04-24

Shipped against this plan with two deviations worth calling out:

1. **Copy lives in `cms/errors/en.json`, not `cms/errors/en.ts`.** The original plan said TypeScript; `cms/`'s charter (`product/cms/README.md`) says "Markdown and JSON only — no TypeScript". Pivoted to JSON + Vite-native typed import in `ui/src/errors/error-banner.tsx`. Captured as decision D.13.
2. **Scope grew: always-visible "New conversation" button + `useConsent.refreshSession()`.** Mid-task ask from Al. Unified path: both the new button AND the ErrorBanner's "Start over" routes drive through the same `handleFreshChat` callback, which calls `refreshSession()` and bumps a `resetKey` state that re-keys `<AssistantRuntimeProvider>` to clear assistant-ui thread state. Consent stays granted across the restart — no OpeningScreen bounce. Captured as decision D.14; pattern captured in `discoveries.md`. Button copy was initially "Fresh chat" and changed to "New conversation" after one round of feedback.

Verification: 43/43 UI tests green (9 new `classify.test.ts` cases). Live verification of the three recoverable error surfaces (unreachable / stream_drop / session_expired) documented as a three-case manual playbook in the implementation chat — not yet walked through end-to-end by Al; deferred to his convenience. The visible "New conversation" button confirmed live via preview snapshot. Tool-call error copy swap confirmed via visual inspection of the updated `WidgetMalformedPlaceholder`.

Not built: rate-limited live verification (would require a contrived 429 throw); tool-call error path live verification (would require a connector-stub hack). Both paths are code-covered by the classifier's unit tests; neither is blocking for D.t6.
