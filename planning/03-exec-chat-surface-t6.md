# 03 — Execution: D.t6 Proactive session handling

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: D (chat surface).
**Implements**: [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §2.5 (session id handling) + §2.7 (the SSE-reconnection open question) — layers proactive detection on top of D.t5's reactive 404 path.
**Depends on**:
- D.t5 (shipped) — ErrorBanner + `useRuntimeErrors` + adapter error emitter (`emitAdapterError` / `subscribeAdapterErrors`) + classifier's `[session_not_found]` marker convention. D.t6 reuses all four unchanged.
- `useConsent` API surface (`refreshSession` + `reset`) — also shipped in D.t5.
- E.t1 (planning in parallel, planner-e1f) — reserves `SessionPingResponse` in `@swoop/common`.
**Produces**:
- `product/ui/src/session/preflight.ts` — pure preflight probe (`GET /session/:id/ping`) + trigger orchestration (mount + visibilitychange + idle interval).
- `product/ui/src/session/use-preflight.ts` — React hook wiring the probe to the shared adapter error emitter and respecting consent state.
- `product/ui/src/session/index.ts` — barrel.
- `product/ui/src/session/__tests__/preflight.test.ts` — classifier-equivalent unit coverage (response branches, trigger dedupe, idle debounce).
- `product/orchestrator/src/server/session-ping.ts` — new `GET /session/:id/ping` handler.
- Route wiring edit in `product/orchestrator/src/server/index.ts` + CORS `Access-Control-Allow-Methods` already covers `GET`.
- Small edit to `product/ui/src/App.tsx` to mount the preflight hook inside the post-consent subtree.
- No new cms/ copy — the preflight reuses D.t5's `session_expired` surface via the shared emitter.
**Estimate**: ~2–3h focused work. Roughly half on the UI side (triggers + idle debounce + hook), a quarter on the new endpoint, a quarter on tests + wiring.

---

## Purpose

D.t5's error UX is reactive: the visitor types, `/chat` returns 404, the banner surfaces `session_expired`. That's correct but slightly hostile — the visitor composed a message into a dead session before learning it was dead, and their intent evaporates when they click "Start a new conversation" (the typed text is not preserved; see §Out-of-scope). D.t6 moves the detection earlier:

1. **Preflight on app mount**, **on tab focus**, and **after a long idle**. The visitor sees the expired state *before* typing, so the first thing they do in a new-focus session is reconsent + get a fresh id — not lose an enquiry they just wrote.
2. **SSE reconnection**: scope is **client-driven, manual only** (decision D.15 below). The orchestrator's `/chat` stream is request-scoped (`reconnectToStream` in the adapter returns `null`); genuine stateful resumption would require a server-side change to persist streams across reconnects, which is out of scope for Puma. The adapter's existing `[stream]` marker and D.t5's banner with a Retry button stay the path.

D.t6 is deliberately a thin layer — it re-uses every D.t5 surface (classifier, emitter, banner, copy) and adds one new probe endpoint plus three new triggers.

### Not in scope

- Auto-retry or auto-refresh. When the preflight says expired we surface the banner; the visitor clicks "Start a new conversation" (which already routes through `handleFreshChat` → `refreshSession` per D.14). No silent session rebirth.
- Stateful SSE resumption (retry tokens, `Last-Event-ID`, server-side stream buffering). Would require a chunk-B session-ledger rework; revisit post-M1 if dropped streams prove common.
- Preserving the visitor's in-flight composer text across a restart. Adjacent nicety; not wired by D.t6. Captured as a candidate for `inbox.md` — add there if Al agrees.
- Preflight on SPA route change. Puma's UI is a single route (iframe-hosted). If D.2 ever flips (cross-page persistence), revisit.
- Telemetry of preflight outcomes. Chunk F.
- Configuration of trigger thresholds via the CMS. Module-level constants are fine for Puma; promote to config if a second tuning lands.

---

## Concrete decisions this plan closes

| # | Question | Decision | Rationale (see §Key notes for full) |
|---|---|---|---|
| D.15 | SSE reconnection policy | **Client-driven, manual only (status quo).** Adapter `reconnectToStream` stays `() => null`. Dropped streams route through D.t5's `[stream]` → `stream_drop` banner + Retry. | Server-side resumption needs a ledger B doesn't have; Puma's stream-drop rate is expected low and manual retry is honest. Revisit if F's telemetry proves it bites. |
| D.16 | Preflight endpoint shape | **`GET /session/:id/ping` returning 200 + `SessionPingResponse`** (shape reserved with planner-e1f). Always 200 — `{ok, expired, serverTime}` payload carries the verdict; non-existent ids return `{ok:false, expired:true}`. | Avoids HTTP 404 semantics (browser/CORS edge cases for a routine probe). Discriminator lives in the body. |
| D.17 | Preflight triggers | **Mount + `visibilitychange` (visible only) + long idle (15 min default)**. Debounced: at most one in-flight probe; coalesce within 2s. | Best-case one probe per visitor-return. Long-idle threshold matches typical tab-left-open scenarios without chattering. |
| D.18 | Long-idle threshold | **15 minutes default**, exposed as a module-level `IDLE_PREFLIGHT_MS` constant (no env var for Puma — bump with a code-review PR). | Longer than natural pauses in a discovery conversation; well short of the 24h orchestrator idle TTL so we catch expiry before the sweeper. |
| D.19 | Preflight failure path | **Surface `session_expired` via the shared adapter emitter** (D.12 pattern) — single wire, no new UX affordance. Network errors from the probe itself are silent (don't promote probe flake to full banner). | Preserves D.12's single-wire invariant. Probe flake (network blip) would otherwise cry-wolf; real expiry still surfaces via `/chat` 404 if the probe is blocked/suppressed. |
| D.20 | Preflight scope | **Only runs post-consent.** Pre-consent there's no session id to probe. | The consent gate is the natural boundary; probing pre-consent would mean probing `null`. |

---

## File plan

| File | New / edit | Role |
|---|---|---|
| `product/ui/src/session/preflight.ts` | new | Pure fn `probeSession(baseUrl, sessionId, signal?)` → `SessionPingResponse \| "network_error"`. No React. |
| `product/ui/src/session/use-preflight.ts` | new | Hook `usePreflight({ enabled, sessionId, idleMs? })`. Owns triggers, debouncing, in-flight tracking, emitter wiring. |
| `product/ui/src/session/index.ts` | new | Barrel: re-exports `usePreflight`, `probeSession`, `IDLE_PREFLIGHT_MS`. |
| `product/ui/src/session/__tests__/preflight.test.ts` | new | Vitest. See §Verification. |
| `product/orchestrator/src/server/session-ping.ts` | new | Handler for `GET /session/:id/ping`. Reads `sessionStore.get`, returns `{ok, expired, serverTime}`. Does NOT touch / bump `updatedAt`. |
| `product/orchestrator/src/server/__tests__/session-ping.test.ts` | new | Supertest coverage: known id → 200 ok, unknown id → 200 expired, archived id → 200 expired. |
| `product/orchestrator/src/server/index.ts` | edit | Register `app.get('/session/:id/ping', createSessionPingHandler(...))`. |
| `product/ui/src/App.tsx` | edit | Mount `usePreflight({ enabled: hasConsented, sessionId: consent.status.sessionId })` inside the post-consent branch. |
| `planning/decisions.md` | edit (by executing agent) | Add D.15–D.20 entries per the table above. |

No edits to D.t5 files. No edits to `ts-common/` in this plan — the shape negotiation lives in E.t1 / planner-e1f's territory.

---

## Key implementation notes

### UI side — triggers, debouncing, emitter wiring

**`probeSession(baseUrl, sessionId, signal?)`** is a pure helper: `fetch(GET /session/:id/ping)`, parse as `SessionPingResponse`, return the parsed object. On `fetch` reject or non-2xx, return the sentinel string `"network_error"`. Keeping probe flake distinct from expiry is what lets the hook suppress "probe failed" from cry-wolfing into the banner.

**`usePreflight({ enabled, sessionId, idleMs })`**:
- Mount trigger: on first render where `enabled === true && sessionId != null`, fire a probe.
- Visibility trigger: `document.addEventListener("visibilitychange", ...)`, probe when `document.visibilityState === "visible"` AND the last probe was more than ~2s ago (debounce — strict-mode double-invoke + fast focus/blur can double-fire otherwise).
- Idle trigger: `setInterval` keyed to `IDLE_PREFLIGHT_MS` (default 15 minutes). Interval is cleared on hide/unmount and re-armed on visible.
- In-flight guard: at most one probe concurrently; a second trigger during an active probe no-ops.
- Decision routing:
  - `{ok:true, expired:false}` → no-op.
  - `{ok:false, expired:true}` → `emitAdapterError(new Error("Preflight: session expired [session_not_found]"))`. The `[session_not_found]` marker is what D.t5's classifier matches on (no classifier edit needed).
  - `"network_error"` → silent. Log to `console.debug` in dev; do NOT emit to the banner. If the probe can't reach the server, the next user message will; D.t5's `unreachable` path handles that honestly.
- `AbortController` cleanup on unmount + on consent transitions (hook unmounts with the post-consent subtree after "New conversation", then remounts).

**App wiring** (edit to `App.tsx`): call `usePreflight({ enabled: hasConsented, sessionId: consent.status.state === "granted" ? consent.status.sessionId : null })` inside the `ThreadSurface` or at App level inside the `hasConsented` branch. Prefer inside `ThreadSurface` so the hook lifecycles with the restart remount pattern from D.14.

### Orchestrator side — the probe endpoint

**`GET /session/:id/ping`**:
- Reads the session id from the URL param (already URL-encoded by the client via `encodeURIComponent`).
- Calls `sessionStore.get(id)`. Because the existing `SessionStore.get` returns archived sessions too, we must inspect for archival explicitly — the interface doesn't expose `archivedAt` directly on `SessionState`. Options:
  - (a) Extend the interface with a `status(id): 'active'|'archived'|'missing'` method. Cleaner long-term but invasive.
  - (b) Add a tiny `isArchived(state): boolean` helper on each adapter, surfaced on the interface. Moderate.
  - (c) In `session-ping.ts` just treat `get(id) === null` as expired and `non-null` as live for Puma. Consistent with how chunk E's deletion runbook thinks about "usable session" today. If the archival distinction matters to the UX later, promote the interface.
- Chose (c) for D.t6 — minimum surface, no interface churn. Aligns with chunk B §2.6a's "archived sessions are read-only; they don't accept new turns", which is what the visitor cares about. An archived session will fail `/chat`'s consent gate anyway, so conflating with "expired" from the UI's POV is correct.
- Response: `200 OK` with `{ok: get(id) !== null, expired: get(id) === null, serverTime: new Date().toISOString()}` (one `get` call, cached in a local).
- Does NOT bump `updatedAt` — a probe is not an interaction. If we accidentally bumped, the idle sweeper would never archive a session whose tab is left open, defeating its purpose.
- CORS: global middleware already allows GET; no new headers needed.
- Rate limiting: none in Puma (out of scope). The probe is cheap and client-debounced.

### Error-banner integration — why the emitter is the right seam

D.12 made the module-level emitter the single wire for comms failures. D.t6 extends that: preflight is another comms failure channel, so emitting `new Error("... [session_not_found]")` slots in without inventing a second route to the banner. No ErrorBanner changes, no new copy, no classifier edits. The banner's "Start a new conversation" button already routes through `handleFreshChat` → `refreshSession()` — exactly what we want for a preflight-detected expiry.

Important invariant: **the preflight emits only on `expired: true`**. Network failure of the probe itself (`"network_error"` sentinel) stays silent. Rationale: a probe that fails because the visitor's Wi-Fi blinked is not evidence the session is dead; it's evidence the probe is unreliable. `/chat` is the authoritative path and handles its own failures via the existing D.t5 channel.

### Reconnection policy — the honest answer

Today the adapter's `reconnectToStream` returns `null`: AI SDK treats the stream as unresumable. A dropped SSE surfaces as `[stream]` → `stream_drop` banner + Retry button; clicking retry resubmits the last user-text by reading thread state (per `useRuntimeErrors.retry`).

A true server-driven reconnect would need: (1) orchestrator to persist stream state across HTTP connections keyed on a token, (2) a `Last-Event-ID`-style replay contract, (3) assistant-ui thread-state coordination so resumption doesn't double-render. That's non-trivial and Puma's operational profile (single request-scoped conversation turns, low latency) doesn't demand it.

D.15's default is **status quo + observe**. Chunk F's event stream will carry `stream_drop` occurrences. If the rate ends up meaningful in real traffic, revisit post-M1 with a B-chunk change proposal. For now: the `[stream]` → manual-retry path is the policy and D.t6 does not extend it.

### Idle threshold — 15 minutes rationale

Two anchoring numbers:
- **Orchestrator `idleTtlMs` default**: 24h (B.t2 `in-memory.ts`). So any threshold much below 24h catches expiry before the sweeper.
- **Natural discovery pause**: a visitor reads a widget, walks away for coffee, returns. Typical pause <10 min. At 15 min we're unambiguously past "coming right back" but well short of the archive window.

Chose 15min (`IDLE_PREFLIGHT_MS = 15 * 60 * 1000`). Exported from `session/preflight.ts` for visibility; no env override (promotion to `.env` is a one-liner when/if it's needed). The `visibilitychange` trigger is the more frequent check in practice — the idle interval is a belt-and-braces catch for the "tab left visible but untouched" case (paused mid-scroll) which `visibilitychange` doesn't cover.

### Concurrency / strict-mode safety

React 18 strict mode invokes effects twice. The in-flight guard + 2s debounce means the second effect run no-ops cleanly. The `AbortController` cleanup in the effect's return handles unmount mid-probe. Unit tests cover both paths.

---

## Shared contracts touched

- **`SessionPingResponse`** in `@swoop/common` — reserved via planner-e1f; D.t6 consumes. If E.t1 ships a different field name (e.g. `{exists, status: 'active'|'expired'}`), D.t6 mirrors that; the shape is still carries `ok`/`expired`-equivalent semantics.
- **`OrchestratorErrorCode`** in `product/orchestrator/src/server/errors.ts` — no change. Preflight never emits an error envelope; it always returns 200.
- **Adapter error emitter** (`emitAdapterError` / `subscribeAdapterErrors` in `runtime/orchestrator-adapter.ts`) — consumed, not changed.
- **Classifier markers** (`[session_not_found]` / `[stream]` / `[rate_limited]`) — consumed, not changed.

---

## Coordination with parallel planners

- **planner-e1f** (E.t1 + F-a): `SessionPingResponse` contract negotiated via SendMessage. Shape: `{ok: boolean, expired: boolean, serverTime: string}`. If e1f needs a different name/location, this plan's single import line swaps; nothing else moves.
- **planner-d7** (D.t7 mobile reflow): no overlap. App.tsx edit here is a one-line hook call inside the existing `ThreadSurface`; if D.t7 also edits App.tsx, the two diffs should merge trivially (different concerns).
- **planner-h**: no overlap.

If E.t1 doesn't land before D.t6 ships, fallback: define the `SessionPingResponse` interface locally in `session/preflight.ts` with the documented shape, annotated `// TODO(E.t1): move to @swoop/common when the shared type lands.`

---

## Verification

### Unit (Vitest, in `product/ui/src/session/__tests__/preflight.test.ts`)
1. `probeSession` returns parsed body on 200.
2. `probeSession` returns `"network_error"` on fetch reject.
3. `probeSession` returns `"network_error"` on non-2xx (since the endpoint always emits 200 on good paths).
4. `usePreflight` emits via `emitAdapterError` with the `[session_not_found]` marker when the probe returns `{ok:false, expired:true}`.
5. `usePreflight` does NOT emit when the probe returns `{ok:true, expired:false}`.
6. `usePreflight` does NOT emit on `"network_error"`.
7. Debounce: two `visibilitychange` events within 2s fire exactly one probe.
8. In-flight guard: a second trigger during an active probe does not start a second fetch (mock with a pending promise).
9. Unmount cancels the probe via AbortController (assert `signal.aborted === true` inside the mocked fetch).

### Unit (Vitest, in `product/orchestrator/src/server/__tests__/session-ping.test.ts`)
1. Known active id → 200 + `{ok:true, expired:false, serverTime}`.
2. Unknown id → 200 + `{ok:false, expired:true, serverTime}`.
3. Archived id (store returns non-null) → 200 + `{ok:true, expired:false}` — per decision (c) above we conflate archived with live; this test documents that choice.
4. Probe does not bump `updatedAt` (snapshot before / after a `get` + `probe` call).
5. CORS: OPTIONS `/session/:id/ping` returns 204 with `Access-Control-Allow-Methods` including `GET`.

### Live (preview)
1. Open a conversation, note the session id in sessionStorage. Clear it manually (`sessionStorage.removeItem("swoop.session.id")`). Alt-tab away, come back. **Expected**: the `visibilitychange` trigger fires a probe, probe returns `{ok:false, expired:true}` (no id → treated as expired via the "id is missing client-side" branch — see note below), banner surfaces `session_expired` **without the visitor typing**.

   *Note on the "no id" edge case*: if the client has no id at all, there's nothing to probe. The hook treats `sessionId == null` post-consent as "already expired" and emits directly. Tested in unit #4 variant.

2. Kill + restart the orchestrator (which wipes the in-memory store per gotcha). Alt-tab back to the UI. **Expected**: probe returns `{ok:false, expired:true}`, banner appears, click "Start a new conversation" → `refreshSession` runs → fresh session minted → conversation resumes.

3. Leave the tab visible and idle for 16 minutes with the orchestrator still running. **Expected**: idle-interval probe fires, returns `{ok:true}`, no banner.

4. Leave the tab visible and idle for 16 minutes with the orchestrator down (simulate). **Expected**: probe returns `"network_error"`, no banner. Type a message → D.t5's `unreachable` banner appears (existing path).

The two load-bearing live checks are #1 (visibility-triggered expiry-before-typing) and #2 (restart recovery flow).

### Regression
- 43/43 UI tests green. D.t5 classifier tests untouched (no classifier edits).
- Orchestrator existing route tests unaffected (new route; existing suite doesn't call it).

---

## Out-of-scope reminders (don't drift)

- No automatic session-rebirth on preflight expiry. Visitor clicks.
- No composer-text preservation across restart — candidate for inbox, not in this task.
- No server-side SSE resumption tokens. Status quo on dropped streams.
- No telemetry — chunk F.
- No preflight on every keystroke / every SPA route change. Three triggers, debounced.
- No env/CMS configuration of thresholds. Module constant.
- No changes to D.t5 UX (copy, banner, classifier).
- No `SessionStore` interface extension for archival distinction — adapter-agnostic `get()` null-check suffices.

---

## Handoff

After D.t6 lands, the only remaining deferred D chunks are D.t7 (mobile reflow pass — planner-d7's Tier 3) and D.t8 (handover doc — brand extension surface, embed instructions). D.t6 closes the final correctness gap in the chat surface; D.t7 and D.t8 are polish + delivery paperwork. No further chat-surface work sits between D.t6 and M3.
