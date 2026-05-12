# 03 — Execution: B.t11 — Server-side session history projection endpoint

**Status**: Tier 3 execution plan. Draft, 2026-05-12.
**Chunk**: B (agent runtime).
**Implements**: [`01-side-quest-persistence.md`](01-side-quest-persistence.md) §5 W1 (the unparked server side) + [`02-impl-agent-runtime.md`](02-impl-agent-runtime.md) §2.5 / §2.6 (read-only projection of stored session state through the existing translator).
**Pairs with**: [`03-exec-chat-surface-t9-mount-rehydrate.md`](03-exec-chat-surface-t9-mount-rehydrate.md) (UI-side rehydrate on mount — D.t9-mount-rehydrate). The two plans share a wire contract (response shape, error codes, rehydration UX guarantees). Authored as a paired delivery so seams stay aligned.
**Depends on**:
- B.t2 (`SessionStore` interface + `InMemorySessionStore`, including the R2 `MutexSessionStore` wrapper).
- B.t4 (`translateAdkStream` + `filterReasoning` — reasoning-strip invariant lives here).
- B.t5 (`buildServer` factory, `sendError` helper, error envelope shape `{error:{code,message}}`).
- B.t14 (`/chat` runs the ADK `InMemoryRunner` with the Puma-session ↔ ADK-session coordination — the source of truth for the event log we project).
- C.t1 + C.31 (Postgres migration sequencing convention — zero-padded prefix, forward-only, plain SQL).
- F-a (`emitEvent` + the event-kind discriminated union — we add new kinds here).
- E.t2 / E.12 (FsHandoffStore → PostgresHandoffStore trajectory — the pattern this plan mirrors for sessions).
**Blocks**: D.t9-mount-rehydrate (the client cannot rehydrate without this endpoint), full M1.5 closure of the side-quest persistence workstream.
**Owner**: single execution agent.
**Status field on completion**: closed when the endpoint is live, 7+ tests green, observability emits land, fresh-install verification per [`gotchas.md`](../gotchas.md) preview_stop/start pattern documents the live smoke.
**Salvage**: commit `6d31124` (reverted at `9974984`) carries ~80% of the implementation shape. The handler, the test scaffolding, and the 7-test list below all come from there. What changed since the revert: (a) Postgres lock-in via C.18 / B.22 / E.10 / C.23 means the framing has to mention the Postgres-aware retry trajectory even though Phase 1 stays on ADK in-memory + `InMemorySessionStore`; (b) `_dev` DB and migrations 001–008 are now live, so the migration this plan adds slots in at 009 (or whatever the next free prefix is at execution time — check `ls product/connector/migrations/` first); (c) the response contract refines slightly to surface `expired` vs `unknown` as one 404 (consistent with `/session/:id/ping`'s D.16 conflation rationale).
**Estimate**: ~3 h focused work for the endpoint + tests + observability + migration scaffold. Migration content is empty for Phase 1 (no new tables yet — the session state still lives in-memory); the migration file exists so the C.31 forward-only chain stays unbroken when B.22's `PostgresSessionService` lands.

---

## Purpose

Today's failure mode is documented in [`gotchas.md`](../gotchas.md) under "Session state is in-memory — orchestrator restart kills all active sessions": every tsx-watch restart and every deploy invalidates every `sessionId` in every visitor's `sessionStorage`. The visitor sees a `/chat` 404, the D.t5 banner offers "Start a new conversation", they have to clear storage and re-consent. That's the right UX for a *truly* expired session — it's the wrong UX for "the server has the history but the UI hasn't asked for it".

The fix is two-sided. **B.t11 (this plan) is the server half.** A `GET /session/:id/history` endpoint returns the full UI-facing `MessagePart[]` stream for a known session by replaying the ADK session's stored events through the existing translator (B.t4) — same translator, same reasoning-strip filter, same wire shape as the live SSE. The UI half (D.t9-mount-rehydrate) calls this on mount and plays the parts into the assistant-ui thread.

This plan does **not** flip session storage to Postgres. That's B.22's post-M4 work — a custom Postgres `SessionService` writing to the same Cloud SQL instance the retrieval and handoff stores live in (single-store philosophy per C.18 + E.10 + C.23). What this plan does is **make the projection endpoint Postgres-ready** — when B.22 lands, the only thing that changes in `session-history.ts` is which `SessionStore` adapter `buildServer` was constructed with. The endpoint's contract, its error codes, its observability kinds, and its 404 conflation rules all stay identical.

**Why the reverted commit isn't a drop-in**: the original `6d31124` predates the C.18 / B.22 / E.10 / C.23 Postgres lock-in. Its docstrings reference "the eventual Firestore migration" (a phrase now scrubbed from the side-quest plan per C.23). Its `SessionHistoryDeps` carries `sessionService: BaseSessionService` directly from the ADK runner — fine for Phase 1, but the framing in this plan promotes the "ADK session as the lossless event log" pattern explicitly so that the post-M4 swap to a Postgres-backed `BaseSessionService` (B.22) is one config change and not a re-architecture. The code shape carries; the framing tightens.

---

## Outcome

When this task ships:

1. `GET /session/:id/history` returns `200 { parts: MessagePart[] }` for a known active session — full conversation history projected through the same translator pipeline as the live SSE.
2. Unknown ids, deleted Puma sessions, and ADK-side desync all return `404 { error: { code: 'session_not_found', message } }`. The conflation matches `/session/:id/ping`'s D.16 rationale: the UI doesn't need to distinguish "never existed" from "expired" — both route to the same "start a new conversation" affordance.
3. Empty consented sessions (consent granted, no turns yet) return `200 { parts: [] }`. Distinguishable from 404 — the client knows the session is alive even before the visitor has typed.
4. Reasoning parts are **never** in the response. The invariant from chunk B §2.4 — chunk B Tier 2 — is preserved by reusing `translateAdkStream` which composes `adkEventsToParts` with `filterReasoning`. If a reasoning part ever appears on the wire, it's the same translator bug the live SSE would surface, not a behavioural choice of this endpoint.
5. Tool-call lifecycle states (`input-streaming` / `input-available` / `output-available`) replay in the same order the live SSE would have emitted them. Tool-call ids, names, inputs, outputs all carry through.
6. New observability events: `session.rehydrated` (200 path, any non-empty replay), `session.replay.empty` (200 path, zero parts), `session.replay.failed` (5xx path). `session.expired` is emitted for the 404 path. All four land in F-a's discriminated union; the schemas live in `@swoop/common/events`.
7. A no-op forward-only migration file (`009_session_history_observability.sql` or next free prefix at execution time) lands in `product/connector/migrations/` so the chain stays unbroken when B.22's `PostgresSessionService` lands and wants a table to write to. The file is annotated to explain that Phase 1 session state is in-memory; the table will arrive in the B.22 swap.
8. Warm-pool integration: claiming a warm session id (B.t10 LIFO stack) shorts the projection endpoint cleanly. The warm session has no Puma turns yet → 200 + `{parts:[]}`. No special case in code; just a consequence of the projection being a pure read.

**Not outcomes**:
- New session storage abstraction. The `HandoffStore` interface (E.t2) has a clean `FsHandoffStore` interim → `PostgresHandoffStore` post-IAM trajectory; we mirror that pattern. B.t11 ships against the existing `SessionStore` interface unchanged.
- Authentication / authorisation new surface. Session-id is the gate, same as `/chat` (B.8). Discussed in §4 below.
- Client-side rehydration logic (D.t9-mount-rehydrate covers).
- New shared types in `@swoop/common`. The existing `MessagePart` union from `streaming.ts` covers the response payload. Only `events.ts` grows (four new kinds).
- A real Postgres-backed session-storage write. That's B.22, post-M4.

---

## Architectural principles applied here

- **Read-only projection over server state.** Per side-quest theme 4 ("rehydration is a read-only projection of server state — the client never reconstructs from its own memory"). The endpoint never mutates anything — no `updatedAt` bump (same posture as `/session/:id/ping` per D.16), no event log append, no archive flag flip.
- **Reuse, don't fork, the translator.** The live SSE wire shape and the rehydration wire shape are the same `MessagePart[]`. If they ever diverge, rehydration breaks invisibly. Single source of truth: `translateAdkStream` is the only thing that produces the wire shape, and it runs in both code paths.
- **Single-store philosophy.** Per C.18 / B.22 / E.10 / C.23 — one Cloud SQL Postgres instance for retrieval, handoff, and (post-M4) sessions. This plan's migration scaffolding is the first echo of that on the orchestrator side.
- **404 conflation matches `/session/:id/ping`.** The two endpoints fronting a session id have the same "I don't know who you are" verdict shape — `session_not_found`. The UI routes both identically via D.t5's classifier (`[session_not_found]` marker → `session_expired` surface). No second classification path.
- **Reasoning-strip is non-negotiable.** Stated explicitly, in every docstring, in every test. Chunk B Tier 2's invariant: outbound projections NEVER carry reasoning. Enforced by `filterReasoning` composing into `translateAdkStream`; verified by an integration test that seeds `Part.thought=true` events and asserts they're absent from the response.

---

## Endpoint contract

### Verb + path

```
GET /session/:id/history
```

Path param. Not a header (the URL is the natural cache + logging surface), not a body (GET has none in practice).

### Request

```
GET /session/<sessionId>/history HTTP/1.1
Origin: http://localhost:5173        # or the deployed UI origin
```

No body. No auth header in Puma — session-id-as-secret matches `/chat`'s B.8 posture. See §4 for the auth discussion.

### Response — happy path

```
200 OK
Content-Type: application/json

{
  "parts": [
    { "type": "text", "text": "Hello, " },
    { "type": "text", "text": "Patagonia." },
    { "type": "tool-call", "state": "input-available", "toolCallId": "call-1", "toolName": "find_someone_who", "input": { ... } },
    { "type": "tool-call", "state": "output-available", "toolCallId": "call-1", "toolName": "find_someone_who", "input": { ... }, "output": { ... } },
    { "type": "data-fyi", "data": { "text": "Looking it up…" } },
    { "type": "text", "text": "Here are three…" }
  ]
}
```

`parts` is canonically `MessagePart[]` from `@swoop/common/streaming.ts`. Order: same as the live SSE would have streamed. Empty array is a valid 200 response — see §"Empty session" below.

### Response — error paths

| HTTP | Body | Trigger | UI behaviour |
|---|---|---|---|
| `400` | `{error:{code:"invalid_request",message}}` | Empty or malformed `:id` path param. | UI never builds this URL — defensive. Logs error.raised. |
| `404` | `{error:{code:"session_not_found",message}}` | (a) Puma `SessionStore.get` returns null (unknown or deleted). (b) ADK `getSession` returns null (desync — rare). (c) Puma session exists but consent is ungranted (extremely rare since consent is set at bootstrap; preserves the "no state pre-consent" invariant). | Clear `sessionStorage` session id; route via D.t5's existing `[session_not_found]` marker → `session_expired` banner → "Start a new conversation". OR (D.t9 decision) auto-clear and bounce to OpeningScreen with a one-line preamble. |
| `500` | `{error:{code:"internal_error",message}}` | ADK `getSession` threw, or the translator threw mid-replay. | UI's `unknown` surface — Try again button. |
| `503` | `{error:{code:"unavailable",message}}` | Reserved for post-M4 when the session backend is networked (Postgres / Vertex). Phase 1 in-memory cannot produce this. | UI's `unreachable` surface. |

CORS preflight: the global `corsMiddleware` already emits `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS` (per the `server/index.ts` wiring B.t5 landed). GET on this route succeeds through that without per-route overrides.

### Empty session

A session with consent granted but no turns yet returns `200 { parts: [] }`. This is **distinct** from 404 — it tells the client "the session is alive, you just haven't typed anything". The D.t9-mount-rehydrate plan uses the distinction to decide whether to show the OpeningScreen (404) or land directly on the thread surface (200, with or without history).

### What's in `parts`

Whatever `translateAdkStream` produces from the ADK `Event[]` log. Concretely:

- **Text parts** (`{type:"text", text:"…"}`) — the visible `<utter>` content, segmented per ADK Event the way the live stream would have segmented it.
- **`data-fyi` parts** (`{type:"data-fyi", data:{text:"…"}}`) — side-channel `<fyi>` notifications extracted from text by `BlockParser`. Per B.13 the parser scope is only `<fyi>`; everything else rides native ADK channels.
- **Tool-call parts** — `input-available` and `output-available` paired by `toolCallId`. `input-streaming` only appears on the live SSE stream (it's the streaming-input intermediate); replay collapses to `input-available` + `output-available` because the stored ADK events carry only the completed functionCall + functionResponse pairs.
- **Reasoning parts** — **NEVER**. The reasoning-filter strip is unconditional. Enforced by `translateAdkStream`'s composition; verified by integration test.

### Projection source: ADK event log, not Puma `conversationHistory`

The handler reads the ADK session's `events` array directly via `sessionService.getSession()`, then feeds them through `translateAdkStream`. We deliberately do **not** project from Puma's `SessionState.conversationHistory` — that's a downsampled shape (`{ turnIndex, role, blockType, text, timestamp }` per `@swoop/common/session.ts`) that loses `toolCallId` / `input` / `output` for tool-call parts. The ADK event log carries the lossless original `LlmResponse` content blocks (functionCall / functionResponse / text / thought). This same call-out lives in the `6d31124` handler docstring; preserve it.

---

## File plan

### Files this plan adds

| File | Role |
|---|---|
| `product/orchestrator/src/server/session-history.ts` | The handler. Mirrors `session-ping.ts`'s shape: factory function returning the Express handler, deps interface, clock injection, error envelope via `sendError`. ~120 lines including doc. |
| `product/orchestrator/src/server/__tests__/session-history.test.ts` | Seven integration tests against a real `buildServer` with a stub ADK session service. Mirrors the `server.test.ts` scaffolding pattern; same `mkEvent` Event factory helper convention. |
| `product/connector/migrations/009_session_history_observability.sql` | No-op migration file. Header comment explains the placeholder — Phase 1 session state is in-memory; the file exists so C.31's zero-padded forward-only chain stays continuous when B.22 lands its real `PostgresSessionService` schema (probably 010+). Body is `-- intentionally empty; see comment.` Verifies the migration runner accepts empty migrations (which it does — `node-pg-migrate` no-ops them cleanly). |

### Files this plan modifies

| File | Change |
|---|---|
| `product/orchestrator/src/server/index.ts` | Register the new route inside `buildServer`. Add `sessionService` to `BuildServerDeps` so the handler can reach the ADK session service (already passed through `runner.sessionService` — we lift it explicitly to avoid pulling `Runner` into the history handler's typings). One line of route registration: `app.get('/session/:id/history', createSessionHistoryHandler({...}))`. Same shape as `app.get('/session/:id/ping', …)`. |
| `product/orchestrator/src/index.ts` | Pass `sessionService` through to `buildServer`. One-line wiring. |
| `product/ts-common/src/events.ts` | Add four event kinds to the discriminated union: `session.rehydrated`, `session.replay.empty`, `session.replay.failed`, `session.expired`. Per F-a conventions: each gets a typed payload, version 1, envelope-compatible. Schemas below in §"Observability". |
| `product/ts-common/src/__tests__/fixtures.test.ts` | One fixture round-trip per new event kind, mirroring the F-a stub fixture pattern. |
| `product/connector/migrations/__tests__/migrate.test.ts` | Bump expected migration count to include 009 — pattern carries from the C.t9 fix (commit `9108680`). |
| `product/orchestrator/.env.example` | No changes needed in Phase 1. Documented for the future B.22 swap. |

### Files this plan does NOT touch

- `product/ui/**` — entire UI side is D.t9-mount-rehydrate's scope.
- `product/orchestrator/src/translator/**` — the translator already does the right thing. Re-using is the whole point.
- `product/orchestrator/src/session/**` — no new backend, no interface change. B.22 owns that swap post-M4.
- `product/connector/src/**` — the connector workspace is the MCP retrieval surface, not the session store. No code change.

---

## Implementation detail — `session-history.ts`

Salvage `6d31124`'s handler shape. The structure that should carry forward verbatim:

1. **`SessionHistoryDeps` interface**: `sessionStore: SessionStore`, `sessionService: BaseSessionService`, optional `appName` (default `"puma-orchestrator"`), optional `userId` (default `"anonymous"`), optional `now` (clock injection — passed through to the translator's `<fyi>` timestamp).
2. **Factory function `createSessionHistoryHandler(deps)`** returning the Express handler closure.
3. **Step 1 (Puma gate)**: `await deps.sessionStore.get(sessionId)`. Null → `sendError(res, 404, 'session_not_found', …)`. This is the authoritative existence check; the same `Map` the consent gate and `/chat` use.
4. **Step 2 (ADK gate)**: `await deps.sessionService.getSession({appName, userId, sessionId})`. Wraps in try/catch — any thrown error → `sendError(res, 500, 'internal_error', …)`. Returns null → `sendError(res, 404, 'session_not_found', …)` (belt-and-braces; the bootstrap path keeps the two stores in sync but defence-in-depth catches divergence).
5. **Step 3 (translate)**: wrap the recorded `events` array in `asAsyncIterable` (a 5-line generator), feed to `translateAdkStream(events, {now})` with no `onFiltered` sink (rehydration is read-only — we're not re-persisting the reasoning parts because they're already in the ADK event log). Push every yielded part into a `parts: MessagePart[]` array. Wrap the for-await in try/catch — translator errors → `sendError(res, 500, 'internal_error', …)`. Emit `session.replay.failed` in this catch branch.
6. **Step 4 (emit + respond)**:
   - If `parts.length === 0` → emit `session.replay.empty` with `{sessionId, eventCount:0}`.
   - Else → emit `session.rehydrated` with `{sessionId, partCount: parts.length, eventCount: events.length, durationMs}`.
   - `res.status(200).json({ parts })`.
7. The 404 branches emit `session.expired` with `{sessionId, gate: 'puma' | 'adk' | 'consent'}` so observability can distinguish unknown-id from desync from pre-consent. The classifier on the UI side doesn't care (one banner surface), but post-launch analytics will.

**What's new vs `6d31124`**: the four event emits, the 503 placeholder in the doc, and the `gate` discriminator on `session.expired`. Everything else is verbatim salvage.

### Consent rehydrate

Tier-1 consent state lives in `SessionState.consent.conversation`. If `SessionStore.get(id)` returns non-null, the session was created by `POST /session` and consent was granted by the time the bootstrap path completed (the consent PATCH is the only way to flip `granted` to true, and the orchestrator refuses `/chat` turns without it — so a session that has any history at all has consent). The endpoint **does not re-check `canAcceptTurn`** — that's `/chat`'s gate, and we're not accepting a turn here. We're reading state the visitor's consent already authorised.

What the UI does with the implicit consent: the side-quest plan §4 invariant is that rehydration is sessionStorage-scoped (tab lifetime), which matches the lawful basis already established at consent. A rehydrated session implies consent was previously granted in this tab; the UI uses that to skip the OpeningScreen (D.t9-mount-rehydrate covers).

**Edge case** — a Puma session that exists but has `consent.conversation.granted === false`: this can only happen for the narrow window between `POST /session` succeeding and the consent PATCH landing. In practice the UI never has a session id in storage at that point (the bootstrap is sync in `useConsent`). The handler treats it as 404 with `gate: 'consent'` on the event — same response shape as the other 404s, so the client never special-cases it.

---

## Observability — four new event kinds

Per F-a conventions: each event is a discriminated-union variant on `eventType` with a typed payload. All four pass the existing `EventEnvelopeBase` (eventVersion=1, timestamp, sessionId, turnIndex=null, actor=`"system"` for the orchestrator-side emits).

```ts
// product/ts-common/src/events.ts (additions)

export const SessionRehydratedEventSchema = z.object({
  eventType: z.literal("session.rehydrated"),
  ...EventEnvelopeBase,
  payload: z.object({
    partCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export const SessionReplayEmptyEventSchema = z.object({
  eventType: z.literal("session.replay.empty"),
  ...EventEnvelopeBase,
  payload: z.object({
    eventCount: z.number().int().nonnegative(),
  }),
});

export const SessionReplayFailedEventSchema = z.object({
  eventType: z.literal("session.replay.failed"),
  ...EventEnvelopeBase,
  payload: z.object({
    stage: z.enum(["adk_fetch", "translator"]),
    errorMessage: z.string(),
  }),
});

export const SessionExpiredEventSchema = z.object({
  eventType: z.literal("session.expired"),
  ...EventEnvelopeBase,
  payload: z.object({
    gate: z.enum(["puma", "adk", "consent"]),
  }),
});
```

Added to the discriminated `EventSchema` union; `EventKind` literal type updates automatically. F-a's fixture-round-trip test grows four cases mirroring the existing pattern.

**Why these four and not more**: tracks the principle from B.19 (warm-pool — two kinds, not four). The base signal is hit/miss + failure/success; `replay.empty` carries info that `replay.failed` and `rehydrated` together couldn't (zero parts on success is a distinct case). `session.expired` is the 404 signal — it's the same event B.22 will start emitting from the future Postgres-backed sweeper too, so the schema lands once and serves both eras.

**Emit site ownership**: B.t11 owns these emits inline in `session-history.ts` (same pattern as B.18 for the warm-pool — emit at the site, don't retrofit through F-b). The UI-side `session.rehydrate.requested` and `session.rehydrate.applied` mirror events live with D.t9-mount-rehydrate.

---

## Test plan — seven integration tests

File: `product/orchestrator/src/server/__tests__/session-history.test.ts`. All salvage from `6d31124`'s test file with the F-a event-sink hooks added. The scaffolding (`mkEvent`, `makeStubSessionService`, `makeStubRunner`, `buildTestApp`) carries forward verbatim.

| # | Name | What it proves |
|---|---|---|
| 1 | `returns 200 + parts in correct order for a known session with messages` | Happy path — text parts replay in the order the live SSE would have emitted them. Asserts on `res.body.parts`. |
| 2 | `returns 404 for an unknown session id` | The Puma-side gate triggers; response body `error.code === 'session_not_found'`. |
| 3 | `returns 200 + empty parts array for a consented but turn-empty session` | Empty session is alive — 200, not 404. Differentiates "no history yet" from "no session". |
| 4 | `does NOT include reasoning parts in the response (translator filter invariant)` | Seeds `Part.thought=true` events alongside visible text; asserts `parts.every(p => p.type !== 'reasoning')`. This is the chunk B Tier 2 invariant test — non-negotiable. |
| 5 | `preserves tool-call parts with lifecycle states intact` | Seeds functionCall + functionResponse events; asserts `input-available` + `output-available` parts in order with correct `toolCallId`, `toolName`, `input`, `output`. |
| 6 | `returns 404 when the Puma session has been deleted (e.g. archived/expired path)` | After `await store.delete(id)`, the endpoint 404s. Asserts the gate behaves the same for "never existed" as "explicitly deleted". |
| 7 | `CORS preflight OPTIONS returns 204 with GET in Access-Control-Allow-Methods` | The global CORS middleware covers the new route. No per-route override needed. |

**Tests added beyond `6d31124`** (event emit coverage):

| # | Name | What it proves |
|---|---|---|
| 8 | `emits session.rehydrated on non-empty replay with partCount + eventCount + durationMs` | Capture via `setEventSink`; assert envelope shape passes `EventSchema`. |
| 9 | `emits session.replay.empty on 200 + zero parts` | Same pattern. |
| 10 | `emits session.expired with gate=puma on unknown id` | Same pattern. |

Total: 10 new tests in this file. Plus 4 fixture round-trips in `@swoop/common/src/__tests__/fixtures.test.ts`. Migrations test bumps by 1.

**Test isolation rule**: use `setEventSink` from `@swoop/common` to capture events; `resetEventSink` in `afterEach`. Same hygiene as B.t10's warm-pool tests.

### What this test plan deliberately does not cover

- **Real ADK session-event-replay against a live runner.** The stub session service is enough — the translator fixture pattern (`translator/__tests__/`) already proves event-shape → parts-shape under heavy fixture loads. Spinning up `InMemoryRunner` here would tangle this test with B.t14's runner wiring.
- **Live model calls.** None happen on this read path; the endpoint never invokes Claude.
- **Cross-session-store backend swap.** Phase 1 is in-memory only; the Postgres path lands in B.22.

---

## Authentication / authorisation

**Phase 1 posture: same as `/chat` (decision B.8) — session-id-as-secret, no other auth.**

The threat model:
- An attacker who has guessed a 36-char UUIDv4 session id can read that session's history. Same as `/chat`'s exposure today. Session ids are random with ~122 bits of entropy; brute-force search of an active session is impractical.
- An attacker who shoulder-surfs a visitor's `sessionStorage` (DevTools open on a public machine) can replay history elsewhere. Not a meaningfully worse posture than `/chat` — the attacker who has the session id can already drive new turns and read the response.
- Cross-origin: the global CORS allow-list (`config.CORS_ALLOWED_ORIGINS`) gates browser requests. Direct curl from off-allow-list works (CORS is browser-enforced); same as today.

**What does NOT change with the projection endpoint:**
- The session id alone is the gate. No new bearer-token surface, no new sign-in flow.
- Tier-1 consent is implicit (a session that exists has consent — see §"Consent rehydrate" above).

**What WOULD change post-M4:**
- B.22's Postgres-backed `SessionService` is reachable across orchestrator instances, so the same session id genuinely survives a restart. The auth posture doesn't tighten — but the threat surface grows because the data has durable longevity past process death. Worth raising with legal as part of E.t9 (counsel review).
- An HITL question is whether we should rotate session ids on long conversations as a hardening pass. The Tier 2 chat-surface plan §7 already calls this out as "probably not for Puma, but doc anyway".

**HITL question (see §Open HITL): is the session-id-as-secret posture good enough for the rehydrate path, or should the projection endpoint require a stronger token (e.g. a short-lived JWT issued at consent grant) given that it leaks longer history at once than `/chat` does per turn?**

---

## Failure-mode matrix

| Mode | Server response | UI behaviour (D.t9) | Observability |
|---|---|---|---|
| Happy 200, non-empty parts | `200 {parts:[…]}` | Replay into thread; skip OpeningScreen | `session.rehydrated` |
| Happy 200, empty parts | `200 {parts:[]}` | Show thread, empty state | `session.replay.empty` |
| Puma session unknown | `404 {error.code:"session_not_found"}` | Clear sessionStorage, soft-fail to OpeningScreen | `session.expired{gate:"puma"}` |
| Puma session deleted | `404 …` | Same as above | `session.expired{gate:"puma"}` |
| ADK session desync (Puma exists, ADK missing) | `404 …` | Same as above | `session.expired{gate:"adk"}` |
| Pre-consent edge case | `404 …` | Same as above | `session.expired{gate:"consent"}` |
| ADK `getSession` throws | `500 {error.code:"internal_error"}` | D.t5 `unknown` banner — Try again | `session.replay.failed{stage:"adk_fetch"}` |
| Translator throws mid-replay | `500 …` | Same | `session.replay.failed{stage:"translator"}` |
| Postgres unreachable (post-M4) | `503 {error.code:"unavailable"}` | D.t5 `unreachable` banner — Try again | `session.replay.failed{stage:"adk_fetch"}` with downstream signal |

The 500 paths are genuinely rare — the in-memory backend doesn't throw at this scale, and the translator is fully tested. They exist so the UI's classifier has a clean route for the day they happen.

---

## Migration scaffolding (C.31 compliance)

C.31 locked migrations as forward-only, plain-SQL, zero-padded-prefix. The chain on `claude/blissful-chaum-8b64cc` runs 001–008 today. This task adds:

```
product/connector/migrations/009_session_history_observability.sql
```

Header:

```sql
-- 009_session_history_observability.sql
--
-- Placeholder migration for B.t11 — server-side session history projection.
--
-- Phase 1 session state is in-memory (ADK SessionService backed by an
-- in-process Map; see SESSION_BACKEND="in-memory"). B.t11 does not introduce
-- a Postgres table — the endpoint reads from the in-memory ADK event log.
--
-- This file exists to keep the C.31 forward-only zero-padded migration chain
-- continuous and to flag the next free prefix for B.22 ('Postgres-backed
-- SessionService — single-store-with-retrieval-and-handoff per C.18+E.10+C.23')
-- which will add `session`, `session_event`, and `consent_record` tables.
--
-- node-pg-migrate accepts empty SQL files cleanly; the migrations test bumps
-- the expected count by one to keep the chain honest.

-- intentionally empty; see comment.
```

The `migrate.test.ts` bump (one-line constant) keeps the count assertion truthful. Same pattern carried from the C.t9 fix (`9108680`).

**Why ship the placeholder now**: when B.22 lands post-M4, its agent doesn't have to negotiate the prefix or wonder whether B.t11 already took 009 for something incompatible. Forward-only chains earn their cost when the chain is uninterrupted.

---

## Interface that survives the post-M4 swap

Per the prompt's hard constraint — *the interface must survive the Firestore/Vertex SessionService future swap (post-M4)*. Concretely, on the orchestrator side:

- `SessionHistoryDeps` does not name the backend. It takes a `BaseSessionService` (the ADK abstraction) and a `SessionStore` (Puma's abstraction). Both are interface types. The B.22 swap re-points the concrete impls passed through `src/index.ts` to `buildServer`; the handler doesn't change.
- The handler never calls Puma-side fields specific to `InMemorySessionStore` (e.g. the sweeper internals). It calls `get(id)` only — every adapter implements that.
- The handler never assumes the ADK session is in-process. `sessionService.getSession()` is the contract; whether it talks to a `Map` or a Cloud SQL query is the adapter's business.

The post-M4 swap is, by design, **zero changes** to `session-history.ts`. The migration body fills in (the placeholder gets superseded by the next migration that creates the tables), the construction site in `src/index.ts` switches `SESSION_BACKEND="in-memory"` → `"postgres"`, the new `PostgresSessionStore` + `PostgresAdkSessionService` adapters land — but `buildServer({sessionStore, sessionService, …})` continues to wire the same handler the same way.

Mirrors the `FsHandoffStore` → `PostgresHandoffStore` trajectory (E.t2 / E.12): one new file per impl, zero call-site churn.

---

## Warm-pool interaction (B.t10 coordination)

B.t10's warm pool (`WARM_POOL_SIZE`) pre-allocates both halves of a session (Puma side + ADK side, per B.17). A warm session that's been claimed by `POST /session` but hasn't yet seen a turn looks identical to a fresh session: consent granted, zero turns, zero ADK events.

What happens when D.t9-mount-rehydrate calls the endpoint against a warm-pool-originated session id:
1. Puma `SessionStore.get(id)` → non-null (warm session is a real record).
2. ADK `sessionService.getSession(...)` → non-null with `events:[]` (warm session was created via the same `onSessionCreated` hook).
3. Translator runs over empty events → yields zero parts.
4. Response: `200 {parts:[]}`. Emits `session.replay.empty`.

No code special-cases this. The endpoint's "empty replay" path is exactly what warm-pool-claimed sessions look like. The UI sees consent already granted, no history to replay, and lands on the thread surface in the empty state.

**Coverage**: test #3 (`returns 200 + empty parts array for a consented but turn-empty session`) doubles as the warm-pool integration assertion — the test seeds an empty-event session, which is what a warm-pool hit produces.

---

## Decisions to log (post-implementation)

To append to `planning/decisions.md`:

- **B.25** — Session history projection reads the ADK event log, not Puma `conversationHistory`. Rationale: lossless tool-call replay. Swap cost: low.
- **B.26** — 404 conflation (`puma | adk | consent` gates → one `session_not_found` code). Rationale: matches D.16's posture for `/session/:id/ping`; UI doesn't need to distinguish. Swap cost: low.
- **B.27** — Four new F-a event kinds (`session.rehydrated`, `session.replay.empty`, `session.replay.failed`, `session.expired`). Rationale: aligns with B.18's "emit at the site" pattern; supports post-launch rehydration metrics without retrofit. Swap cost: low.
- **B.28** — Migration 009 lands as a no-op placeholder so the C.31 chain stays continuous when B.22's real Postgres `SessionService` schema lands. Swap cost: zero.
- **B.29** — `SessionHistoryDeps` is interface-typed against `SessionStore` + `BaseSessionService`; post-M4 swap to Postgres-backed adapters requires zero changes to `session-history.ts`. Mirrors the E.t2 `HandoffStore` interim → durable trajectory. Swap cost: low.

---

## HITL ratification record (2026-05-12)

Two items closed via HITL on 2026-05-12; four remain open.

### Closed

2. **404 UX on D.t9-mount-rehydrate side.** ✅ **Ratified: soft-fail to OpeningScreen with a small notification.** Auto-clear `sessionStorage`, route to OpeningScreen, surface a brief notification acknowledging the previous conversation expired (toast / banner / preamble — UI executor picks the most appropriate D.t8-consistent affordance). **No manual click required to start over.** Closes the paired question (D.t9-mount-rehydrate Q1).

3. **Empty-replay UX.** ✅ **Ratified: no special case.** A consented zero-turn rehydrated session is semantically identical to a fresh chat — show the thread directly, no "Restoring…" placeholder, no "Welcome back" affordance. Standard empty state. Closes the paired question (D.t9-mount-rehydrate Q2).

### Still open

1. **Auth posture: is session-id-as-secret good enough for the rehydration endpoint, or should we issue a short-lived bearer token at consent grant?** The rehydration endpoint leaks more state per call than `/chat` does per turn. Legal counsel input (E.t9) could shape this. Default leaning: same posture as `/chat` (decision B.8). Surface to Al + Swoop legal counsel.
4. **`session.expired{gate:"consent"}` — is this analytics-noisy enough to suppress?** The pre-consent race is extremely rare. Surface to F-chunk's analytics owner.
5. **Should the projection endpoint rate-limit per session id?** Probe-style abuse (UI accidentally calls `/history` in a loop after a JS error) could hammer the in-memory backend. Cheap to add; HITL on whether it's worth the surface complexity in Phase 1.
6. **Post-M4: when B.22 lands, do we want a paginated history endpoint?** Long conversations could grow large. Out of scope for B.t11. Flagged for the B.22 plan.

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

All workspaces must be green. Specific tallies after this task lands:
- `@swoop/common` — +4 fixture cases (events) → previous +4
- `@swoop/orchestrator` — +10 tests on the new file → previous +10
- `@swoop/connector` — +1 expected migration count → unchanged test count
- `@swoop/ui` — unchanged (this is the server task)
- `@swoop/harness` — unchanged
- `@swoop/ingestion` — unchanged

### Integration test naming convention

`session-history.test.ts` lives at `product/orchestrator/src/server/__tests__/`. Follows the B.t5 convention — `<route>.test.ts`. Test names use the existing `describe('GET /session/:id/history', () => { it('returns 200 …', …)` pattern, mirroring `server.test.ts`.

### Live smoke (per gotchas.md preview_stop/preview_start pattern)

1. `preview_stop` then `preview_start` to clear any stale Vite modules.
2. Open the UI, complete the OpeningScreen consent, type a message, wait for the assistant reply (full SSE).
3. With the conversation in flight, restart the orchestrator (`tsx watch` ctrl-C + re-run, or `npm run dev` re-up).
4. The UI's session id is now stale (in-memory backend lost the session). The D.t9 plan covers what happens next — for B.t11's standalone smoke, instead:
5. Bring the orchestrator back up, then `curl -sN http://localhost:8080/session/<live-session-id>/history | jq`. Expect 404 `session_not_found` (orchestrator restart killed the in-memory session — known per gotchas.md).
6. Re-do consent in the UI to get a fresh live session, complete one user turn, then `curl … | jq` against that id. Expect 200 with a non-empty `parts` array.
7. Test the empty path: `curl … | jq` against a session id that exists but has had no turns (capture from `POST /session` response in DevTools). Expect 200 with `parts:[]`.
8. Test the 400 path: `curl http://localhost:8080/session//history`. Expect 400 `invalid_request`.

The orchestrator log should show one structured `session.rehydrated` event per non-empty 200 and one `session.expired` per 404.

### CI

GitHub Actions `ci.yml` continues to run typecheck + test against `.nvmrc` Node 20. No new workflow needed. No env vars to inject.

### Commit shape

Two atomic commits when this lands:

```
feat(orchestrator,common): B.t11 — server-side session history projection endpoint

Adds GET /session/:id/history returning {parts: MessagePart[]} matching the
live SSE stream's part shape 1:1. Reuses translateAdkStream (B.t4) over the
ADK session's stored events so the reasoning-strip invariant from chunk B
§2.4 holds; the Puma SessionStore lookup gates the 404 path so unknown /
deleted / desynced sessions all yield session_not_found and the UI routes
to expired-conversation UX (D.t9-mount-rehydrate).

Adds four observability event kinds: session.rehydrated, session.replay.empty,
session.replay.failed, session.expired. Emitted inline per B.18 pattern.

Migration 009 lands as a no-op placeholder so the C.31 forward-only chain
stays continuous when B.22's Postgres SessionService lands post-M4. The
endpoint is interface-typed against SessionStore + BaseSessionService — zero
code change required at the swap.

Per planning/03-exec-agent-runtime-t11.md.
Per planning/01-side-quest-persistence.md §5 W1.
```

```
docs(planning): B.t11 — Tier 3 plan for server-side session history projection
```

---

## Cross-references

- Pairs with [`03-exec-chat-surface-t9-mount-rehydrate.md`](03-exec-chat-surface-t9-mount-rehydrate.md) (UI half).
- Side-quest origin: [`01-side-quest-persistence.md`](01-side-quest-persistence.md) §5 W1.
- Tier 2 home: [`02-impl-agent-runtime.md`](02-impl-agent-runtime.md) §2.5 + §2.6 — extending the runtime with a read-only history projection.
- Postgres-lock-in framing: decisions C.18 / B.22 / E.10 / C.23.
- Translator invariant: chunk B Tier 2 §2.4, enforced in `product/orchestrator/src/translator/reasoning-filter.ts`.
- Salvage: commit `6d31124` (reverted at `9974984`) — handler, tests, doc shape carry forward with the framing tightenings listed in §"Purpose".
- Adjacent prior art: D.16 (`/session/:id/ping` 200-with-body verdict shape), B.18 (warm-pool emit-at-the-site convention), E.12 (`FsHandoffStore` interim → durable backend trajectory — interface pattern this plan mirrors).
