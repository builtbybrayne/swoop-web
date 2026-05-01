# 03 — Execution: B.t5 — SSE endpoint

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: B (agent runtime).
**Task**: t5 — `POST /chat` SSE endpoint + session bootstrap.
**Implements**: `planning/02-impl-agent-runtime.md` §2.5 + decisions B.1 (SSE direct) + B.8 (no auth).
**Depends on**: B.t1 (orchestrator), B.t2 (session), B.t3 (tools), B.t4 (translator).
**Produces**: HTTP surface for chunk D to call: session bootstrap, streaming chat responses, expiry handling.
**Unblocks**: chunk D's D.t1+ (real orchestrator endpoint to consume).
**Estimate**: 2–3 hours.

---

## Purpose

Expose the orchestrator's conversational loop via HTTP. Chunk D posts a message, receives an SSE stream of `message.parts`. Session ids issued at bootstrap. No auth (top-level decision — Puma is a demo surface; Swoop's iframe host handles real auth post-M4).

---

## Deliverables

### `product/orchestrator/src/server/`

| File | Role |
|---|---|
| `server/session-bootstrap.ts` | `POST /session` — creates a new session, returns `{ sessionId, disclosureCopyVersion }`. No body required. Tier-1 consent is not yet set; chunk D captures it client-side and confirms via `PATCH /session/:id/consent` (or the first `/chat` call carries the flag — decide during implementation). Return 201. |
| `server/consent.ts` | `PATCH /session/:id/consent` — sets tier-1 `consent.conversation` to `true` (or `false` → session deletion). Accepts `{ granted: boolean, copyVersion: string }`. Writes to session via the store. |
| `server/chat.ts` | `POST /chat` — SSE endpoint. Request body: `{ sessionId, message }`. Validates session exists + consent granted. Drives the agent via ADK's runner + translator (B.t4). Streams parts over SSE. Handles client disconnect (cancel the agent turn cleanly). |
| `server/errors.ts` | Shared error surface. Maps internal errors to `message.parts` error shape for mid-stream, or HTTP status codes for pre-stream (session not found = 404, consent not granted = 403, rate-limited = 429 (not wired yet), validation failure = 400). |
| `server/heartbeat.ts` | SSE heartbeat comment every ~15s to keep the connection alive through proxies / ingresses. |
| `server/index.ts` | Registers all routes onto the Express app from B.t1. |

### Endpoint shapes

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/healthz` | — | 200 `{status, service, version}` (from B.t1) |
| `POST` | `/session` | — | 201 `{sessionId, disclosureCopyVersion}` |
| `PATCH` | `/session/:id/consent` | `{granted, copyVersion}` | 200 `{consent: ConsentState}` \| 404 session not found |
| `DELETE` | `/session/:id` | — | 204 (explicit session close — user closed chat) |
| `POST` | `/chat` | `{sessionId, message}` | `text/event-stream` \| 403/404/400 |

### Tests

`server/__tests__/chat.test.ts` — integration tests using a stubbed connector + stubbed agent events:
- Happy path: bootstrap → grant consent → send message → receive streaming parts → stream ends.
- No consent → chat returns 403.
- Unknown session → chat returns 404.
- Client disconnect mid-stream → agent turn cancels cleanly; session state reverts cleanly (no half-written turn).
- Empty message → 400.

Use `supertest` or equivalent HTTP test client.

---

## Key implementation notes

### 1. SSE event format

Each `message.parts` yield becomes one SSE `data:` line (JSON-encoded). Include a `type` field so the client can discriminate. End the stream with `event: done` + `data: {}`. On error mid-stream, emit `event: error` + `data: {message, code}` then close.

### 2. Client disconnect

Use `req.on('close', ...)` to detect disconnection. Pass an `AbortSignal` down to the agent turn so ADK can cancel cleanly. Don't leave zombie turns running.

### 3. Consent gate location

The consent check happens **inside** `/chat` before the agent runs, using `canAcceptTurn` from B.t2. Not in middleware — the 403 response body includes a reason code the UI can use.

### 4. Session id is a uuid

Generate with `crypto.randomUUID()`. No secrets in it. Session ids are opaque to the client.

### 5. Error mapping to `message.parts`

If the agent fails **after** starting to stream, emit an error part on the stream (so chunk D can show a clean inline error), then close the stream gracefully.

### 6. No authentication

Trust the `sessionId` as the only handle. If it exists + has consent, the request is served. Production auth is Swoop's iframe host's concern (added post-M4 if needed).

### 7. CORS

Dev-mode: allow the chunk D dev server origin explicitly (`http://localhost:5173` or similar). Production-mode: allow Swoop's domain. Both come from config.

### 8. Warm pool integration

Session bootstrap can consume from the warm pool (B.t10). For B.t5, just allocate a fresh session every time — pool integration lands with B.t10.

---

## References

- Express SSE patterns — standard.
- `planning/02-impl-agent-runtime.md` §2.5 + §2.5a.
- `planning/02-impl-chat-surface.md` §2.4 (consent flow shape) + §2.5 (session handling).

---

## Verification

1. `curl -X POST http://localhost:8080/session` returns `{sessionId, disclosureCopyVersion}`.
2. `curl -X PATCH http://localhost:8080/session/<id>/consent -d '{"granted":true,"copyVersion":"v1"}'` returns 200.
3. `curl -N -X POST http://localhost:8080/chat -d '{"sessionId":"<id>","message":"hi"}'` streams SSE events, ending with `event: done`.
4. Same call without consent → 403 with reason.
5. Same call with unknown session → 404.
6. Interrupting the curl mid-stream (Ctrl-C) → server logs show the turn was cancelled; no zombie process.
7. Integration tests all pass.

---

## Handoff notes

- Do not add auth or rate limiting here — out of scope.
- Warm pool integration is B.t10.
- CORS config must not be `*` in production; require explicit Swoop-owned origins.
- Consent PATCH endpoint keeps tier-1 consent changes auditable — log the copy version so we know which consent language the user agreed to.

---

## 2026-04-30 code-review fixes

Source: [planning/reviews/2026-04-30-code-level.md](reviews/2026-04-30-code-level.md). Status legend: 🔲 not started · 🟡 in flight · ✅ landed.

### R2 — Race condition: `void appendToHistory(...)` writes mutate session concurrently — ✅

**Problem**: `chat.ts:213-219` (reasoning sink), `chat.ts:258` (`void persistPart(...)`) — multiple unawaited promises mutate session state concurrently via `store.update(sessionId, s => ({...s, conversationHistory: [...]}))`. Works today by accident: `InMemorySessionStore` happens to serialise via the JS event loop's microtask queue. Will silently break the moment B.t2's custom Postgres `SessionService` (B.22) lands — last-write-wins lost-update bug, history can drop entries, turn indices can collide, reasoning can persist *after* the next user message. The agent-loop tracer flagged this as the highest-confidence latent bug in the codebase.

**Fix shape**: choose one of:
- (a) **Per-session async mutex** wrapping `store.update`. Cheap, surgical, doesn't change the call sites. New `SessionMutex` map keyed by sessionId; methods acquire/release.
- (b) **Batch-at-done**: accumulate parts in a turn-local buffer; single `store.update` at `event: done` with the full turn's worth of entries. Loses incremental durability if the orchestrator crashes mid-turn but matches the "B.t2 reasoning persists for agent memory" invariant.

Recommend (a) — surgical, preserves incremental persistence, doesn't bake assumptions about turn boundaries.

**Landed (option a)**: new `MutexSessionStore` decorator at `product/orchestrator/src/session/mutex-store.ts`; wraps every `SessionStore` returned by `createSessionStore()` so both production wiring and tests benefit. Reads / creates / deletes are passthrough; `update` serialises per-sessionId via a chain of awaited promises with settled-not-succeeded gating (so one failed update can't poison the chain). Distinct sessions stay parallel — bounded growth with opportunistic chain cleanup. Choice of (a) over (b) documented in the file's top comment: surgical (no chat.ts callsite changes), preserves incremental persistence (mid-turn crash leaves coherent partial history; matters for the B.t2 reasoning-persists invariant + audit tooling), composes cleanly when B.22's Postgres `SessionService` lands. New `__tests__/mutex-store.test.ts` reproduces the lost-update bug against an unmutexed async control store, then asserts losslessness + ordering through the wrapper, cross-session parallelism, and chain integrity after a throw.

**Commits**: `dc2af42`

### R4 (chat body part) — `/chat` accepts unbounded `message` — ✅

**Problem**: `chat.ts:81-87` only checks `typeof message === 'string'` + non-empty. `express.json({ limit: '64kb' })` (`server/index.ts:89`) is the only ceiling. A 60kb "user message" lands in event payload sha256 inputs and in `runner.runAsync` history.

**Fix shape**: `.max(8_000)` on `message` field of the new `ChatRequestSchema` (see Theme-A.1 below). Lower `express.json` limit to 16kb after.

**Landed**: `CHAT_MESSAGE_MAX = 8_000` exported from `@swoop/common/routes.ts`; `ChatRequestSchema.message` carries `.max(CHAT_MESSAGE_MAX)`. Express body limit lowered to `'16kb'` in `product/orchestrator/src/server/index.ts`. New `ts-common/__tests__/routes.test.ts` covers boundary acceptance + over-cap rejection at the schema layer; new `server.test.ts` cases assert 413 on an 18 KB raw body, 400 on a `CHAT_MESSAGE_MAX + 1` message, 200 at exactly `CHAT_MESSAGE_MAX`.

**Commits**: `a9ede99`

### Theme-A.1 — Replace hand-rolled body validation with Zod schemas — 🔲

**Problem**: three HTTP routes hand-roll body validation instead of using Zod: `consent.ts:49-62`, `chat.ts:73-89`, `session-bootstrap.ts:63-67`. Only `/handoff/submit` Zod-parses (`handoff-submit.ts:64`). Inconsistent posture; UI clients can't typecheck against a shared schema; `entryUrl` reaches event payload + handoff record without URL validation (`session-bootstrap.ts:103,225` security finding #5).

**Fix shape**: define `ChatRequestSchema`, `ConsentRequestSchema`, `SessionBootstrapRequestSchema` in `@swoop/common` (alongside `HandoffSubmitRequestSchema`). All `.strict()`. Each route's handler does `safeParse` + 400 with detail. Drop the typeof guards.

**Verification**: route tests for each endpoint cover (a) happy path, (b) extra field rejected, (c) wrong-type field rejected, (d) over-length field rejected (where applicable).

**Commits**: _(landed: filled when done)_

### Sec-2 — Security headers (helmet) — 🔲

**Problem**: `server/index.ts:84-97` only does `app.disable('x-powered-by')` + CORS. No CSP (especially `frame-ancestors` for the iframe-embedded surface), HSTS, Referrer-Policy, X-Frame-Options. Auditors will flag the absence on a public surface; legal counsel reviewing the compliance bundle will too.

**Fix shape**: `helmet({ contentSecurityPolicy: { directives: { 'frame-ancestors': swoopOrigins, 'default-src': ["'self'"], ... } } })` registered in `buildServer` BEFORE other middleware. `swoopOrigins` derived from `config.CORS_ALLOWED_ORIGINS`. Document the CSP directives in the compliance bundle.

**Verification**: route test asserts `Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy` headers present on every response.

**Commits**: _(landed: filled when done)_

### Test-1 — Integration tests for /chat error paths — ✅

**Problem**: `chat.ts:166,331-343` writes `event: error` frames with `errorType: triage_classifier_failed` / `chat_turn_failed`. `server/__tests__/server.test.ts:240-295` covers happy-path streaming + reasoning-leak + pre-stream gates only. No test queues a runner that throws mid-stream; no test exercises the `error.raised` event emission. Plus: `server.test.ts:21,65-89` has scaffolding for a "client disconnect aborts the turn" assertion but no `it(...)` block — false sense of coverage.

**Fix shape**: add three integration cases:
- mid-stream-throw: stub runner emits N parts then throws; assert SSE `event: error` frame; assert `error.raised` event emitted with correct `errorType`; assert no zombie writes.
- client-disconnect: spawn supertest connection; abort mid-stream; assert `runner.lastAborted() === true`; assert the abort instrumentation actually fires.
- connector-unreachable: stub MCP client throws on tool call; assert tool-call SSE part has error envelope; assert error.raised emission.

**Landed**: three cases added in `server.test.ts` under "POST /chat — error path coverage (Test-1)":
- (a) mid-stream throw — runner yields one good text part then throws; assert SSE `event: error` frame with `code: 'internal_error'`, structured `error.raised` event with `errorType: chat_turn_failed`, session history retains the user message (no corruption).
- (b) client disconnect — uses a real `http.Server` + raw `node:http` client because supertest's transport buffers responses and won't socket-close mid-flight; runner attaches an abort listener up front and asserts it fires when the test destroys the client socket.
- (c) connector unreachable — modelled as a thrown `ECONNREFUSED` from the runner before any events stream (the orchestrator-side surface is identical whether the runner blew up or the MCP connector did); assert SSE error frame + structured `error.raised` event.

(b) surfaced a real latent bug while being authored: the chat handler's disconnect listener was on `req.on('close')`, but Express 5 fires `req`'s close event *synchronously when the handler is entered* because the body parser has already drained the request stream. Real mid-stream disconnects therefore left the runner orphaned with no abort propagation. Fixed by switching to `res.on('close')`, which fires when the response socket actually closes — the signal we want for SSE cancel. Doc comment on the handler updated to spell out why.

**Commits**: `6e2731a`

### Sec-3 — `/session` `entryUrl` URL-validation gap — 🔲

**Problem**: `session-bootstrap.ts:63` accepts any string as `entryUrl`. Schema declares `z.string().url().optional()` but the route does its own typeof-string parse and never Zod-parses the body. Arbitrary `javascript:`/`data:` URLs propagate into events (`session-bootstrap.ts:103`) and the handoff record (`handoff-submit.ts:225`).

**Fix shape**: closed automatically by Theme-A.1 — `SessionBootstrapRequestSchema` does `.url()`-validation. Cross-reference here so the closure is traceable.

**Verification**: covered by Theme-A.1 route test.

**Commits**: _(landed alongside Theme-A.1)_
