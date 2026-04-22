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
