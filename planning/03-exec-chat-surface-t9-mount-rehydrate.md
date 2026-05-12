# 03 — Execution: D.t9-mount-rehydrate — UI-side rehydrate on mount

**Status**: Tier 3 execution plan. Draft, 2026-05-12.
**Chunk**: D (chat surface).
**Implements**: [`01-side-quest-persistence.md`](01-side-quest-persistence.md) §5 W2 (the unparked client side, previously deferred for evidence from W3 host-harness observation; now actionable because the harness has shipped and orchestrator-restart-loses-state is documented as a real problem in [`gotchas.md`](../gotchas.md)) + [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §2.5 / §2.6.
**Pairs with**: [`03-exec-agent-runtime-t11.md`](03-exec-agent-runtime-t11.md) (server-side `GET /session/:id/history` — B.t11). The two plans share a wire contract (response shape, error codes, single rehydration UX story). Authored as a paired delivery so seams stay aligned. This is the **UI-only** half — no orchestrator file is touched here.
**Depends on**:
- B.t11 (the endpoint this plan calls). Strictly ordered — B.t11 ships first.
- D.t1–D.t4 (assistant-ui shell, message-part rendering, consent gate).
- D.t5 (error-banner + classifier + `[session_not_found]` marker convention — the 404 path routes through this existing pipeline).
- D.t6 / D.16 (`usePreflight` + `SessionPingResponse` shape — the same probe-style gating logic that informs the rehydrate-on-mount trigger).
- D.t8 (CSS extension surface + `data-swoop-part` attributes — the rehydrate placeholder respects them).
- D.t14 (`resetKey` / re-key-the-provider pattern documented in `discoveries.md` 2026-04-24 entry — the rehydrate path must not collide with this).
**Blocks**: M1.5 (side-quest persistence) end-to-end verification via the W3 mock-host harness.
**Owner**: single execution agent.
**Status field on completion**: closed when mount-time rehydrate is live, the four UX paths from §"Failure-mode matrix" all verify in the preview, ui tests are green, and a Playwright/Vitest smoke covers the happy + 404 paths.
**Estimate**: ~3–4 h focused work. The big difficulty isn't the fetch — it's the assistant-ui-thread-replay mechanics at 0.12.25 (pre-1.0 API surface; see §"How replay is actually played into the thread" below). Allow contingency for one preview_stop/start cycle if Vite gets stuck (per gotchas.md).

---

## Purpose

B.t11 makes the server side of the persistence side-quest real: a `GET /session/:id/history` that projects the full conversation back through the existing translator. **D.t9-mount-rehydrate is the client half.** On UI mount, if `sessionStorage` already holds a session id (visitor refreshed the page, clicked a link in the surrounding Swoop host page and came back, or just retook focus on the tab), fetch that history, replay the parts into the assistant-ui thread, and land the visitor on the thread surface — not the OpeningScreen. If the server says 404, clear sessionStorage and bounce to OpeningScreen as if a fresh visitor.

The hard part is **assistant-ui at 0.12.25 does not auto-rehydrate thread state on mount.** Even with a clean server-side history endpoint, the client has to actively replay the parts through the runtime. The same author who landed the D.14 `resetKey` pattern (see `discoveries.md` 2026-04-24 entry "Clearing assistant-ui thread state without library internals: re-key the provider + churn the transport") knew this surface well — that work shows the inverse direction (clearing thread state). This task is the forward direction (populating thread state without typing).

The rehydrate path runs **before** the OpeningScreen renders post-consent, and **before** any user turn arrives. It must:
1. Not race the consent-bootstrap path (only ever runs when consent is already granted).
2. Not collide with the D.14 `resetKey` re-mount path (resetKey bump triggers `useMemo` churn that creates a new transport; rehydrate must work *with* that transport, not against it).
3. Not show a noticeable replay flicker on the happy path — but show a tasteful placeholder if the fetch takes more than ~150ms (HITL question).
4. Not double-replay if React StrictMode invokes the effect twice in dev — same in-flight guard pattern as D.17's `usePreflight`.

---

## Outcome

When this task ships:

1. **Happy path — non-empty replay**: visitor refreshes the page (or returns to the iframe after navigating elsewhere). The UI:
   - Reads `swoop.session.id` from `sessionStorage` synchronously.
   - Reads consent from `sessionStorage` synchronously (already exists in `useConsent`).
   - If both present and consent is granted: renders the thread surface immediately (skips OpeningScreen — the rehydrated session implies consent already granted).
   - Fires `GET /session/:id/history` in a mount effect with the in-flight + strict-mode guards.
   - Plays the response `parts` into the assistant-ui thread by adding a synthetic assistant message whose `content` is the parts array (mechanism in §"How replay is actually played into the thread").
   - Emits `ui.session.rehydrate.requested` on fetch start and `ui.session.rehydrate.applied` on successful replay.
2. **Happy path — empty replay**: same flow, but `parts:[]`. The thread surface renders empty (the existing `EmptyState` content), the composer is ready, the visitor types and gets a normal turn. Emits `ui.session.rehydrate.requested` + `ui.session.rehydrate.applied{partCount:0}`.
3. **404 path — session expired**: server returns 404 `session_not_found`. The UI clears both the session id and consent from sessionStorage, bumps `resetKey` (so the assistant-ui provider remounts clean), and routes to OpeningScreen with a one-line preamble: *"Your previous conversation expired — please start a new one."* (HITL question on banner vs preamble — see §"Open HITL"). Emits `ui.session.rehydrate.expired`.
4. **5xx path — server error**: emits `ui.session.rehydrate.failed{stage:"fetch"}`, surfaces D.t5's `unknown` banner via the shared adapter error emitter (D.12) using the `[rehydrate_failed]` marker convention (new — added to `errors/classify.ts`). The visitor sees "Something went wrong — Try again" with the retry button wired to re-invoke the rehydrate fetch.
5. **Network error path**: emits `ui.session.rehydrate.failed{stage:"network"}`, surfaces D.t5's `unreachable` banner via the same emitter route.
6. **Re-entry**: navigating away and back within the same tab (e.g. clicking a link to a Swoop page that the host harness has loaded) triggers the iframe to remount; the rehydrate path fires again with the same session id. The replay is idempotent — running it twice doesn't double the history (the thread runtime is fresh-mounted; what we replay *is* the conversation).
7. **Resilience under StrictMode**: dev-mode double-invoke of the mount effect does not fire two GETs. In-flight guard + ref-tracking matches `use-preflight.ts`'s D.17 pattern.
8. **OpeningScreen is not shown during a happy rehydrate.** The visitor lands directly on the thread surface. This is the *core JTBD* — "keep momentum across navigation" (side-quest §3). A flash of the OpeningScreen before the rehydrate completes is a regression.

**Not outcomes**:
- New server endpoint or new orchestrator file. B.t11 owns that side.
- Cross-session persistence (localStorage). Per side-quest §6 explicitly out of scope.
- Optimistic client-side caching of messages (visitor sees their last message instantly while the fetch races). Per side-quest §6 — defer to post-real-user-signal.
- Rehydration of widget state mid-tool-call (e.g. a partially-filled lead-capture form). The lead-capture widget is stateless after submit; mid-form-fill mid-rehydrate is an edge case for V2.

---

## Architectural principles applied here

- **Rehydration is a read-only projection of server state** (side-quest theme 4). The client never reconstructs from its own memory. If the server forgot, the UI shows fresh.
- **One emitter, one banner** (D.12). Rehydrate failures route through `emitAdapterError` with a new `[rehydrate_failed]` marker the classifier recognises. No second error channel.
- **Mount-time fire-once** (D.17 pattern). In-flight guard + StrictMode resilience.
- **Skip OpeningScreen on rehydrate** is a strict invariant. The whole point of persistence is that the visitor doesn't re-consent every navigation.
- **`resetKey` pattern is preserved**. Rehydrate does NOT bump `resetKey`. The "Start a new conversation" button still does (and the rehydrate path should not race it).
- **Single source of truth on the wire shape**. The replay parts come from `translateAdkStream` server-side; the UI consumes the same `MessagePart` union the live SSE produces. No client-side translation, no client-side validation beyond the existing schema-import at the type level.

---

## File plan

### Files this plan adds

| File | Role |
|---|---|
| `product/ui/src/session/rehydrate.ts` | Pure helper. `fetchSessionHistory(sessionId): Promise<{parts: MessagePart[]} \| {error: 'session_not_found' \| 'fetch_failed' \| 'network_error'}>` — same shape pattern as `preflight.ts`. Reads orchestrator URL via `getOrchestratorUrl()` from `runtime/orchestrator-adapter.ts`. |
| `product/ui/src/session/use-rehydrate.ts` | React hook. `useRehydrate({enabled, sessionId, onApplied, onExpired}): {status: "idle"|"loading"|"applied"|"empty"|"expired"|"failed", retry: () => void}`. Owns the mount-time fire-once effect, in-flight guard, StrictMode resilience, emit calls. Returns status so App can render a placeholder during loading. |
| `product/ui/src/session/__tests__/rehydrate.test.ts` | Unit tests on the pure `fetchSessionHistory` function. Six cases: 200 non-empty, 200 empty, 404, 500, network throw, invalid JSON. Vitest + msw-like fetch stub. |
| `product/ui/src/session/__tests__/use-rehydrate.test.ts` | Hook tests under `@testing-library/react`. Five cases: applies parts on 200, skips fetch when `enabled:false`, fires once under StrictMode double-invoke, calls `onExpired` on 404, surfaces `failed` status on 5xx. |
| `product/ui/src/session/replay-into-thread.ts` | The assistant-ui-specific replay implementation. Single function `replayPartsIntoThread(runtime, parts): void`. See §"How replay is actually played into the thread" below for the API choice — this is the file where the assistant-ui-0.12.25 specifics live, isolated so a library upgrade only touches one file. |

### Files this plan modifies

| File | Change |
|---|---|
| `product/ui/src/App.tsx` | Wire `useRehydrate` between `useConsent` and the conditional render. Add a `rehydrateStatus` state. When `status === "loading"` and the visitor has a session id, render a tasteful "Restoring your conversation…" placeholder instead of the OpeningScreen *and* instead of the empty thread surface (avoids the OpeningScreen flicker). Hook the `onExpired` callback into the same `handleFreshChat` path the error banner uses (so the resetKey bumps + sessionStorage clears cleanly). |
| `product/ui/src/disclosure/use-consent.ts` | Add a new method `clearSilently(): void` — wipes sessionStorage entries without firing the `useConsent` reset events. Used by the 404 path to clean up before the OpeningScreen mounts with the preamble. Existing `reset()` keeps its current semantics; `clearSilently` is the rehydrate-specific path. |
| `product/ui/src/errors/classify.ts` | One new marker convention: `[rehydrate_failed]` → `unknown` (or `unreachable` if upstream marker indicates network). Same pattern as D.12's `[session_not_found]` / `[stream]` / `[rate_limited]`. Tests: two new cases in `classify.test.ts`. |
| `product/ui/src/runtime/orchestrator-adapter.ts` | No changes to the transport itself. `emitAdapterError` is reused — `useRehydrate`'s failure paths call `emitAdapterError(new Error(\`[rehydrate_failed] \${detail}\`))` to land in the existing banner pipeline. |
| `product/ui/src/runtime/emit-ui-event.ts` | Four new event types in the UI emit helper: `ui.session.rehydrate.requested`, `ui.session.rehydrate.applied`, `ui.session.rehydrate.expired`, `ui.session.rehydrate.failed`. F-a's event schema grows correspondingly in `@swoop/common/events.ts` (pair with B.t11's four server-side `session.*` kinds — these are the UI-side mirrors). |
| `product/ts-common/src/events.ts` | Add the four `ui.session.rehydrate.*` kinds to the union. |
| `product/ui/src/session/index.ts` | Barrel re-export of `useRehydrate`, `fetchSessionHistory`, `replayPartsIntoThread`. |
| `product/ui/src/cms/errors/en.json` | No changes — the `[rehydrate_failed]` marker routes to the existing `unknown` / `unreachable` copy. |

### Files this plan does NOT touch

- `product/orchestrator/**` — entire server side is B.t11's scope.
- `product/cms/**` — no copy changes (the 404 preamble copy lives in `cms/errors/en.json` if we go banner-fail; lives in OpeningScreen copy as a one-line conditional if we go soft-fail — HITL).
- `product/ts-common/src/streaming.ts` — `MessagePart` union is what we consume; no shape change.

---

## How replay is actually played into the thread

This is the load-bearing implementation detail. Assistant-ui at 0.12.25 has no first-class "rehydrate from history" API. Three candidate mechanisms:

**Option A — `useThreadRuntime().import(...)` (or equivalent thread-runtime-import API).** assistant-ui pre-1.0 exposes a `ThreadRuntime.import(threadState)` shape that accepts a full thread payload. If this API is stable in 0.12.25 (verify at execution time — the discoveries.md entry on the resetKey pattern notes the `aui.*` API is still being rolled out), this is the cleanest path: build a `ThreadState` object with a single rehydrated assistant message whose `content` is the `parts` array, call `import()`, done. The thread renders the parts via the existing `messagePartComponents` registry (D.t2). No transport involvement.

**Option B — push synthetic events through the transport's `UIMessageChunk` channel.** The `orchestrator-adapter.ts` transport already converts `MessagePart` → `UIMessageChunk` for the live SSE path. We could expose a `replay(parts)` method on the transport that emits the chunks synthetically on the same ReadableStream the live path uses. Cleaner protocol-wise but harder to wire — the AI SDK `ChatTransport` contract is request/response-shaped, and pushing chunks without a corresponding `sendMessages` call requires keeping the stream alive in a non-standard way.

**Option C — fake a `sendMessages` and short-circuit the network call.** Call the transport's `sendMessages` with a fake user message; intercept inside the transport to skip the POST and emit the stored parts instead. Hackiest; not worth it.

**Recommendation: Option A**, with Option B as fallback. Verify the `import` (or equivalent) API exists in 0.12.25 at execution time. If not, Option B's "synthetic chunks through transport" path is the cleanest fallback. Option C is rejected outright — too clever, too fragile.

The replay implementation lives entirely in `product/ui/src/session/replay-into-thread.ts` — one file, one function. A library upgrade or API discovery is one file's worth of churn.

### What the rehydrated message looks like

Assistant-ui thinks in messages. One synthetic assistant message holds the entire history's worth of parts:

```ts
// Conceptual shape — exact `Message` interface name and field names depend on
// the assistant-ui version. Verify at execution.
{
  id: "rehydrated",
  role: "assistant",
  content: parts,             // MessagePart[] — text / data-fyi / tool-call
  createdAt: new Date(0),     // epoch — sentinel for "this is replayed history"
}
```

The existing `MessagePrimitive.Parts components={messagePartComponents}` registry in `App.tsx` renders this exactly the way it renders any live message. Text parts stream-text. `data-fyi` parts render as the ephemeral side-channel. Tool-call parts render via D.t3's per-tool widgets — including the result widgets (`input-available` + `output-available` are present for completed tool calls in the projected history).

**Edge case**: streaming-state widgets (a tool call that was mid-execution when the orchestrator died) only have `input-available` in the projection — `output-available` never landed. The widget should render its "loading" state. D.t3 widgets already handle this — they branch on the lifecycle state. No special-case needed.

**Why one synthetic message and not many**: trying to reconstruct the original per-turn message boundaries from the ADK event log is fiddly (ADK events don't always cleanly partition into "messages" in assistant-ui's sense), error-prone (one mis-aligned turn breaks the visual flow), and unnecessary for the rehydration UX — what matters is that the visitor sees their history, not that the chat looks pixel-identical to the moment-before-refresh state. If F-chunk telemetry post-launch shows users confused by the single-message collapse, revisit. Default leaning: one message, one render, one truth source.

---

## Implementation detail — `useRehydrate`

Structure mirrors `usePreflight` (D.t6):

```ts
export interface UseRehydrateOptions {
  enabled: boolean;
  sessionId: string | null;
  onApplied?: (partCount: number) => void;
  onExpired?: () => void;
}

export type RehydrateStatus =
  | "idle"
  | "loading"
  | "applied"      // happy path, parts replayed
  | "empty"        // 200 with parts:[]
  | "expired"      // 404; sessionStorage cleared; OpeningScreen renders next
  | "failed";      // 5xx / network

export function useRehydrate(opts: UseRehydrateOptions): {
  status: RehydrateStatus;
  retry: () => void;
} { /* … */ }
```

Effect logic:
1. **Skip when not enabled or no sessionId** — `useEffect` returns early.
2. **Fire-once guard** — a `useRef<boolean>(false)` set true on first invocation, cleared on `enabled` flipping false. Same as `usePreflight`.
3. **In-flight guard** — a `useRef<AbortController | null>(null)` keeps the active fetch; second invocation aborts the first (StrictMode double-invoke abort is harmless).
4. **Status transitions**:
   - On effect run with guard satisfied: `setStatus("loading")`, emit `ui.session.rehydrate.requested`.
   - Fetch via `fetchSessionHistory(sessionId)`:
     - `{parts:[]}` → `setStatus("empty")`, emit `…applied{partCount:0}`. No replay call.
     - `{parts:[…]}` → call `replayPartsIntoThread(runtime, parts)`, `setStatus("applied")`, emit `…applied{partCount}`, call `onApplied(partCount)`.
     - `{error:"session_not_found"}` → `setStatus("expired")`, emit `…expired`, call `onExpired()`. The parent's `onExpired` does `clearSilently()` + `setResetKey(k => k+1)` so the OpeningScreen renders next.
     - `{error:"fetch_failed"}` → `setStatus("failed")`, emit `…failed{stage:"fetch"}`, `emitAdapterError(new Error("[rehydrate_failed:fetch_failed] …"))`.
     - `{error:"network_error"}` → `setStatus("failed")`, emit `…failed{stage:"network"}`, `emitAdapterError(new Error("[rehydrate_failed:network_error] …"))`.
5. **Retry**: `retry()` resets the fire-once guard and re-runs the effect manually. Called from D.t5's banner Try-again button via the `onRestart`/`onRetry` plumbing. (HITL: should retry on 404 attempt to re-bootstrap a session, or just route to OpeningScreen? Default leaning: route to OpeningScreen; 404 means there's no resurrection possible.)

### Where the hook lives in App.tsx

The current `App.tsx` post-D.t6 structure:

```tsx
const consent = useConsent();
const { hasConsented, hasDeclined } = consent;
const transport = useMemo(() => createOrchestratorTransport(), [resetKey]);
const runtime = useChatRuntime({ transport });

usePreflight({ enabled: hasConsented, sessionId: consent.status.state === "granted" ? consent.status.sessionId : null });

// NEW: rehydrate.
const rehydrate = useRehydrate({
  enabled: hasConsented,
  sessionId: consent.status.state === "granted" ? consent.status.sessionId : null,
  onApplied: (n) => emitUiEvent({ eventType: "ui.session.rehydrate.applied", payload: { partCount: n } }),
  onExpired: () => {
    consent.clearSilently();
    setResetKey((k) => k + 1);
  },
});

return (
  <AssistantRuntimeProvider key={resetKey} runtime={runtime}>
    {!hasConsented ? (
      <>
        <OpeningScreen {...} preamble={rehydrate.status === "expired" ? "Your previous conversation expired — please start a new one." : undefined} />
        <PrivacyInfoModal {...} />
      </>
    ) : rehydrate.status === "loading" ? (
      <RehydratePlaceholder />     // see below
    ) : (
      <ThreadSurface onRestart={handleFreshChat} onFreshChat={handleFreshChat} />
    )}
  </AssistantRuntimeProvider>
);
```

`RehydratePlaceholder` is a tiny component — same chrome (`<ChromeBadge />`), a centered "Restoring your conversation…" string, no composer. Renders for max ~500ms on the happy path (LAN-local fetch + render); the visitor doesn't see a flash because the placeholder *is* the in-between state. If the fetch takes longer, the placeholder remains.

### Replay timing relative to runtime initialisation

The runtime is initialised by `useChatRuntime({ transport })` synchronously on the App's render. By the time `useRehydrate`'s effect fires (which is after the render commits), the runtime is fully constructed and ready to accept an `import()` call. No race; no special ordering needed.

**Critical**: `resetKey` is in the dep list of the transport `useMemo`. Bumping it churns the transport and creates a new runtime instance. The rehydrate effect must NOT bump `resetKey` on the happy path — the runtime would be torn down before the replay reaches it. The 404 path bumps `resetKey` *after* the OpeningScreen takes over (which happens because `hasConsented` flipped to false via `clearSilently`), so the bump there is safe.

### Interaction with D.14 `resetKey` and "New conversation" button

The "New conversation" button calls `handleFreshChat` which: emits `ui.conversation_closed`, calls `consent.refreshSession()`, bumps `resetKey`. After the bump, the rehydrate effect's `useEffect` re-runs because its dep (`sessionId`) just changed (refreshSession overwrote the stored id). The fresh session has zero history → `200 {parts:[]}` → status `empty` → nothing visible to the visitor (they see a clean composer ready for their first message, as expected). The mount-rehydrate fire-once guard is keyed on the *current* `sessionId`, not on a "have we ever rehydrated?" flag — so a new sessionId triggers a fresh fire.

This is the correct behaviour. Verified by test: `use-rehydrate.test.ts` includes a case for "sessionId changes → effect re-runs". Same shape as `use-preflight.test.ts`'s session-id-change case.

---

## Failure-mode matrix

Mirrors B.t11's matrix from the UI side:

| Server response | UI status | Visitor sees | Side-effects |
|---|---|---|---|
| `200 {parts:[…]}` | `applied` | Thread surface with prior conversation | Emit `ui.session.rehydrate.applied{partCount:N}` |
| `200 {parts:[]}` | `empty` | Thread surface, empty state, composer ready | Emit `…applied{partCount:0}` |
| `404 session_not_found` | `expired` | OpeningScreen with preamble ("Your previous conversation expired …") | Clear sessionStorage; bump `resetKey`; emit `…expired` |
| `500 internal_error` | `failed` | Thread surface (empty) + D.t5 `unknown` banner with Try-again | Emit `…failed{stage:"fetch"}` + `emitAdapterError("[rehydrate_failed:fetch_failed] …")` |
| Network throw / abort | `failed` | Thread surface (empty) + D.t5 `unreachable` banner with Try-again | Emit `…failed{stage:"network"}` + `emitAdapterError("[rehydrate_failed:network_error] …")` |
| 503 unavailable (post-M4) | `failed` | Same as 500 | Same |

The `failed` cases land on the thread surface, not the OpeningScreen — the rationale is that consent was given, the session id is locally trusted (the server may just be temporarily unreachable), and bouncing the visitor to re-consent every time the network glitches would be hostile. Try-again retries the fetch, not the bootstrap.

---

## UX timing — the perceived rehydrate

Side-quest decision SQ.3: *"Skeleton/spinner in the thread area for ≤500ms then show the rehydrated thread; no opening-screen flash."*

Concretely:
- The fetch starts in a `useEffect` that fires synchronously after mount.
- Mount-to-effect-fire is sub-millisecond in React.
- On localhost, fetch round-trip is single-digit ms; on production behind a CDN, ~50–150ms.
- The `RehydratePlaceholder` renders during the loading window — exactly the affordance SQ.3 specified.

**Anti-pattern to avoid**: showing the OpeningScreen for an instant before the rehydrate completes. This is the regression the side-quest exists to prevent. The gate is: `if hasConsented && (rehydrate.status === "idle" || rehydrate.status === "loading") → RehydratePlaceholder`. The `idle` state covers the gap between render and effect fire; the `loading` state covers the in-flight fetch.

**The "Restoring your conversation…" string**: HITL question on whether this lives in cms or inline. Default: lives inline (one string, two words, not material content). Surface to Al if he wants it CMS'd.

---

## Test plan

### Unit tests (Vitest, in `product/ui/src/session/__tests__/`)

`rehydrate.test.ts` — 6 cases on the pure `fetchSessionHistory`:

| # | Name | What it proves |
|---|---|---|
| 1 | `returns parts on 200 + valid body` | Happy path. |
| 2 | `returns empty parts on 200 + empty array` | Distinguishable success. |
| 3 | `returns {error:"session_not_found"} on 404` | 404 path. |
| 4 | `returns {error:"fetch_failed"} on 500` | 5xx path. |
| 5 | `returns {error:"network_error"} on fetch throw` | Network. |
| 6 | `returns {error:"fetch_failed"} on invalid JSON` | Server returned 200 but parse fails. |

`use-rehydrate.test.ts` — 5 cases under `@testing-library/react`:

| # | Name | What it proves |
|---|---|---|
| 1 | `applies parts and calls onApplied on 200` | Status transitions correctly; `replayPartsIntoThread` is called once with the right args. |
| 2 | `skips fetch when enabled:false` | Effect bails early; no network call. |
| 3 | `fires once under React StrictMode double-invoke` | In-flight guard works. |
| 4 | `calls onExpired and sets status="expired" on 404` | 404 wires the parent's clear-and-bump path. |
| 5 | `sets status="failed" and emits adapter error on 5xx` | Error pipeline works. |

`classify.test.ts` — 2 new cases:

| # | Name |
|---|---|
| 1 | `routes [rehydrate_failed:fetch_failed] to surface=unknown` |
| 2 | `routes [rehydrate_failed:network_error] to surface=unreachable` |

### Integration smoke (Playwright or Vitest browser — whichever the `@swoop/ui` workspace currently runs)

`product/ui/src/__tests__/rehydrate.smoke.test.ts`:

1. Boot the test orchestrator (in-process via the harness pattern from H.11 — `:8080` running). Seed a session with three turns of history.
2. Open the UI page. Pre-populate sessionStorage with the session id + consent.
3. Reload. Assert: no OpeningScreen appears; the thread surface renders with three messages worth of content visible.
4. Manually clear the server-side session (DELETE `/session/:id`). Reload again. Assert: OpeningScreen renders with the "previous conversation expired" preamble.

If the ui workspace doesn't have a browser-test infrastructure today (it currently uses Vitest only, per status), keep this as a documented manual smoke — see §"Live smoke" below.

---

## Decisions to log (post-implementation)

To append to `planning/decisions.md`:

- **D.26** — Rehydrate is fire-once-on-mount via a hook (`useRehydrate`), not part of `useConsent` or the transport. Rationale: independent lifecycle, testable in isolation, mirrors `usePreflight`. Swap cost: low.
- **D.27** — Replay implementation lives in one file (`replay-into-thread.ts`). Isolated assistant-ui-version-specific code. Rationale: library upgrade impact is one file. Swap cost: zero.
- **D.28** — One synthetic assistant message holds the entire replayed history, not per-turn message reconstruction. Rationale: simpler, no boundary-detection logic, visitor sees their history (the JTBD). Revisit if F-chunk telemetry shows confusion. Swap cost: low.
- **D.29** — `[rehydrate_failed:<reason>]` marker convention extends D.12's pattern; classifier routes to `unknown` or `unreachable` based on reason. Swap cost: low.
- **D.30** — 404 path soft-fails to OpeningScreen with a one-line preamble — NOT a banner — because consent must be re-granted and the OpeningScreen is the consent surface. (If HITL goes the other way, this decision flips to "banner with Start-over button"; the implementation is one branch either way.) Swap cost: low.
- **D.31** — Rehydrate runs even when the session ends up being warm-pool-empty (B.t10 hit). The empty `200 {parts:[]}` is the correct happy path; the placeholder shows briefly; visitor lands on the thread surface ready to type. Swap cost: zero.

---

## HITL ratification record (2026-05-12)

Two items closed via HITL on 2026-05-12; five remain open.

### Closed

1. **404 UX: soft-fail vs banner-fail.** ✅ **Ratified: soft-fail to OpeningScreen with a small notification.** Auto-clear `sessionStorage`, route to OpeningScreen, surface a brief notification acknowledging the previous conversation expired. No manual click required to start over. The notification's visual register is the UI executor's call (toast / banner / preamble — pick the most appropriate D.t8-consistent affordance). Mirrors B.t11 ratification (paired question).

2. **Empty replay UX.** ✅ **Ratified: no special case.** A consented zero-turn rehydrated session === a fresh chat. Show the thread directly. Standard empty state. No "Restoring…" placeholder, no "Welcome back" affordance. Mirrors B.t11 ratification (paired question).

### Still open

3. **Where does the "previous conversation expired" notification string live?** Inline vs `cms/errors/en.json` (extend with a `rehydrate` section). Default: inline (it's chrome, not content). Surface to Al.
4. **Retry behaviour on 5xx — silent backoff or visible Try-again?** Plan defaults visible — the D.t5 banner already has a retry button; reuse. Surface only if Al wants auto-retry.
5. **Should the rehydrate hook also fire on `visibilitychange→visible`?** D.17's `usePreflight` does — the same "tab regained focus" trigger could trigger a re-rehydrate if the server has appended (e.g. another tab drove turns; impossible in Phase 1 since session ids are tab-scoped). Default: no — mount only. Surface if a real cross-tab need appears.
6. **Telemetry on rehydrate latency**: should `ui.session.rehydrate.applied` carry `durationMs`? Adds a stopwatch around the fetch. Plan defaults yes (mirrors B.t11's server-side `durationMs`). Surface only if pushback.
7. **What about widget rehydration of in-progress lead-capture forms?** A visitor mid-form-fill who navigates away loses the form state. Plan defaults: form re-renders empty (the agent's args replay; the visitor types again). Surface to Al if real users complain.

---

## Verification

### Fresh-install gate (per memory: "verify swarm-merged work against a fresh install")

After merging to the trunk:

```bash
cd /Users/al/Studio/projects/swoop_web
rm -rf product/node_modules product/*/node_modules
cd product && npm install
npm run typecheck
npm test --workspaces --if-present
```

All workspaces must be green. Specific UI tally after this task lands: previous count + ~13 (6 + 5 + 2 new tests across the three new files).

### Live smoke (per gotchas.md preview_stop/preview_start pattern)

1. `mcp__Claude_Preview__preview_stop` then `mcp__Claude_Preview__preview_start` to clear any stale Vite modules (per the gotchas.md "Vite HMR sometimes serves stale modules" entry).
2. **Happy path — non-empty replay**:
   - Open the preview, complete OpeningScreen consent, type a message, wait for the assistant reply.
   - Reload the tab (browser refresh, NOT closing the tab — sessionStorage survives the refresh).
   - **Expected**: OpeningScreen does NOT appear. The thread surface renders with the prior message + reply visible. The composer is ready. No banner.
   - Check the orchestrator logs for `session.rehydrated` event.
   - Check the UI's `emitUiEvent` console output for `ui.session.rehydrate.requested` + `ui.session.rehydrate.applied{partCount:>=2}`.
3. **Happy path — empty replay**:
   - Open the preview, complete OpeningScreen consent, do NOT type anything.
   - Reload the tab.
   - **Expected**: OpeningScreen does NOT appear. The thread surface renders empty (standard empty state). The composer is ready.
4. **404 path — session expired**:
   - Open the preview, complete consent, type a message, wait for reply.
   - Restart the orchestrator (kill the tsx-watch, re-run). This wipes the in-memory session.
   - Reload the UI tab.
   - **Expected**: brief `RehydratePlaceholder` shown for ~150ms while the GET fires, then the OpeningScreen appears with the preamble *"Your previous conversation expired — please start a new one."*
   - Check the UI emits: `ui.session.rehydrate.requested` + `ui.session.rehydrate.expired`.
   - SessionStorage should be empty by the time the OpeningScreen renders.
5. **5xx path**:
   - Open the preview, complete consent, type a message.
   - Briefly stop the orchestrator (kill the process, leave the UI alone).
   - Reload the UI.
   - **Expected**: D.t5 `unreachable` banner appears on the thread surface with Try-again. The thread is empty.
   - Bring the orchestrator back up. Click Try-again.
   - **Expected**: the rehydrate re-fires; if the session id is still valid (which it isn't post-restart, so this becomes the 404 path), the OpeningScreen renders with the preamble. If the session id was valid (e.g. flaky network rather than restart), the thread populates.
6. **StrictMode**: with React strict mode on in dev, verify the orchestrator logs show exactly ONE `session.rehydrated` event per mount, not two.
7. **Interaction with "New conversation" button**: after a successful rehydrate, click "New conversation". The thread should clear, sessionStorage should hold a new session id, and the rehydrate should fire once more for that new id (returning `parts:[]`).

### Integration test naming convention

Follows the established `@swoop/ui` convention:
- Unit tests next to the file: `product/ui/src/session/__tests__/rehydrate.test.ts`, `use-rehydrate.test.ts`.
- Smoke test (if browser infra exists): `product/ui/src/__tests__/rehydrate.smoke.test.ts`.

### CI

GitHub Actions ci.yml runs Vitest across all workspaces. No new workflow needed. No new env vars (the rehydrate path reads `VITE_ORCHESTRATOR_URL` the transport already configures).

### Commit shape

Atomic commits when this lands:

```
feat(ui,common): D.t9-mount-rehydrate — mount-time history rehydrate

Adds useRehydrate hook + fetchSessionHistory helper + replayPartsIntoThread
function. On mount, if sessionStorage holds a session id and consent is
granted, fetches GET /session/:id/history (B.t11), replays the parts
through the assistant-ui runtime, and lands the visitor on the thread
surface — no OpeningScreen flash.

404 path soft-fails to OpeningScreen with a one-line preamble; 5xx +
network errors route through D.t5's existing banner via emitAdapterError
with a new [rehydrate_failed:<reason>] marker the classifier recognises.

Adds four UI-side observability event kinds:
ui.session.rehydrate.{requested,applied,expired,failed} — mirrors B.t11's
server-side session.* emits.

Replay implementation isolated in product/ui/src/session/replay-into-thread.ts
so assistant-ui 0.12.25's pre-1.0 API surface is contained to one file.

Per planning/03-exec-chat-surface-t9-mount-rehydrate.md.
Per planning/01-side-quest-persistence.md §5 W2.
```

```
docs(planning): D.t9-mount-rehydrate — Tier 3 plan for UI-side rehydrate on mount
```

---

## Cross-references

- Pairs with [`03-exec-agent-runtime-t11.md`](03-exec-agent-runtime-t11.md) (server half).
- Side-quest origin: [`01-side-quest-persistence.md`](01-side-quest-persistence.md) §5 W2.
- Tier 2 home: [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §2.5 (session id handling) + §2.6 (cross-page persistence; the field this plan unparks).
- Pattern parallels:
  - D.12 (adapter error emitter — same channel for rehydrate failures).
  - D.14 (`resetKey` pattern — must not collide; the 404 path uses it, the happy path does not).
  - D.17 / D.18 / D.20 (`usePreflight` triggers / debounce / in-flight guard — same shape).
  - D.16 (`/session/:id/ping` 200-with-body and 404-conflation rationale — the rehydrate endpoint inherits the same conflation).
- Discoveries entry on assistant-ui clearing (2026-04-24 — inverse direction; this plan is the forward direction).
- Discoveries entry on AI SDK v6 `DefaultChatTransport` can't talk to Puma (2026-04-23 — custom transport implication; the rehydrate path reads the same transport's URL helper).
- Gotchas entry on "Session state is in-memory — orchestrator restart kills all active sessions" (the root cause this plan addresses).
