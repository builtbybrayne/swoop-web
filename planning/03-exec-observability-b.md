# 03 — Execution: F-b Observability Retrofit

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: F (observability & analytics).
**Implements**: [`02-impl-observability.md`](02-impl-observability.md) §2.2 (producer emission points), §2.3 (every chunk uses the helper, no ad-hoc `console.log`). Covers F.t3 from the Tier 2 order-of-execution.
**Depends on**: F-a landed — `product/ts-common/src/events.ts` carries 20 event kinds (19 usable + `error.raised` for internal fallback); `product/ts-common/src/emit-event.ts` exposes `emitEvent`, `setEventSink`, `resetEventSink`. See [`03-exec-observability-a.md`](03-exec-observability-a.md).
**Blocks**: H (harness can assert on real event streams once producers emit); post-M4 BigQuery export (schema-ready today, fed by real data after F-b).
**Produces**:
- Edits to `product/orchestrator/src/index.ts`, `product/orchestrator/src/server/chat.ts`, `product/orchestrator/src/server/consent.ts`, `product/orchestrator/src/server/session-bootstrap.ts`, `product/orchestrator/src/connector/tools.ts`, `product/orchestrator/src/functional-agents/triage-classifier.ts`, `product/orchestrator/src/session/in-memory.ts` (sweeper), `product/orchestrator/src/config/load.ts`.
- Edits to `product/ui/src/runtime/orchestrator-adapter.ts`, `product/ui/src/widgets/widget-shell.tsx`, `product/ui/src/disclosure/use-consent.ts`, `product/ui/src/App.tsx`.
- One new file: `product/ui/src/runtime/emit-ui-event.ts` (thin browser-side wrapper — see §4).
- Updates to `__tests__` in affected packages covering "emits the expected event" assertions.
**Estimate**: ~3 h focused work. Mechanical once the inventory is fixed.

---

## Purpose

F-a shipped the schema + helper in isolation. Nothing calls `emitEvent` yet; every producer still logs via `console.log` / `console.error` / `console.warn` with ad-hoc string prefixes (`[orchestrator]`, `[connector]`, `[swoop.ui]`, etc.). F-b closes the loop: every auditable state transition in B / C / D / E becomes an `emitEvent` call, and every remaining `console.*` is either removed (duplicate of an emitted event) or left in place as a deliberate diagnostic-only log with a comment marking it as such.

The goal is not to scrub every `console.*` call from the tree. It is to draw a clean line between **auditable events** (structured, schema-checked, destined for BigQuery) and **diagnostic logs** (unstructured, human-readable, stays on Cloud Run stdout only). Both can coexist; what can't coexist is the current state where a single `console.log` site carries both roles and neither well.

Out of scope:
- New event kinds beyond F-a's 20. If a producer notices a real gap, add the kind to `events.ts` in the same PR and update F-a's fixtures — do not defer.
- Cloud Logging client wiring. Default stdout sink stands. Cloud Run auto-parses the JSON lines.
- Automatic session-id correlation via AsyncLocalStorage. F-a evaluated and deferred; F-b reopens only if retrofit is painful.
- B.t10 warm-pool events (`warm_pool.hit` / `warm_pool.miss`) and B.t9 skill events (`skill.loaded`) — schemas are in place but there is no code yet. See §6 for the coordination contract.
- Cost-event capture (token counts). Still deferred to a post-Puma wave.

---

## 1. Inventory — every current logging site

Scoped by producer. Every row marks the call site and its fate: **replace** (becomes an `emitEvent`), **keep** (diagnostic, stays as `console.*` with a comment), **delete** (duplicate of a replaced site), or **add** (a state transition with no current log that should emit an event).

### 1.1 Orchestrator (chunk B)

| # | File : line | Current call | Fate | Mapped event kind / rationale |
|---|---|---|---|---|
| B1 | `src/index.ts:111` | `console.log` "[orchestrator] ready on http://..." | **keep** | Startup banner. Diagnostic only — there is no `service.started` event kind, and Cloud Run's own revision-ready signal covers the auditable side. Mark with `// diagnostic: startup banner, not an emitEvent site`. |
| B2 | `src/index.ts:112-123` | `console.log` x8 for prompt path / model / connector / tool count / agent / backend / CORS / env | **keep** | Config dump. Diagnostic. Cloud Run records it once per cold start. Same diagnostic-marker comment as B1. |
| B3 | `src/index.ts:127` | `console.log` "[orchestrator] ${signal} received, shutting down." | **keep** | Diagnostic. No `service.shutdown` kind in F-a. |
| B4 | `src/index.ts:129` | `console.warn` connector close failed during shutdown | **replace** | `error.raised` with `{errorType: 'connector_close_failed', chunk: 'B', sanitisedContext}`. Session id `"system"`, actor `"system"`, `turnIndex: null`. |
| B5 | `src/index.ts:139` | `console.error` fatal startup error | **replace** | `error.raised` with `{errorType: 'startup_fatal', chunk: 'system'}`. Followed by `process.exit(1)` unchanged. The emit+exit pattern must call `emitEvent` synchronously before exiting — since the default sink is `console.log(JSON.stringify(...))` on stdout, the line flushes before `process.exit` returns. |
| B6 | `src/config/load.ts:48-49` | `console.error` x2 for invalid-config message + pointer to `.env.example` | **keep** | Pre-emit — config failed before the process is considered running; structured events presume a validated config. Leave as `console.error` and mark diagnostic. |
| B7 | `src/connector/tools.ts:279` | `console.warn` connector advertised an unknown tool name | **replace** | `error.raised` with `{errorType: 'connector_tool_unknown', chunk: 'B', sanitisedContext: toolName}`, session `"system"`, actor `"connector"`. Once per startup handshake. |
| B8 | `src/connector/tools.ts:286` | `console.warn` connector did NOT advertise an expected tool | **replace** | `error.raised` with `{errorType: 'connector_tool_missing', chunk: 'B', sanitisedContext: toolName}`, session `"system"`, actor `"connector"`. |
| B9 | `src/functional-agents/triage-classifier.ts:248` | `console.warn` classifier errorCode | **replace** | `error.raised` with `{errorType: 'triage_classifier_model_error', chunk: 'B', sanitisedContext: errorCode + errorMessage slice}`. Session id threaded through from the classify() call (see §3). |
| B10 | `src/functional-agents/triage-classifier.ts:256` | `console.log` "classified turn" with model + bytes | **delete** | Duplicates what a future `triage.decided` event carries (§1.1 B11). The model id is already in session state / `triage.decided` payload's `reasonText` can reference it. Remove rather than keep both. |
| B11 | `src/functional-agents/triage-classifier.ts` (post-classify) | *(no current log — successful classify is silent)* | **add** | `triage.decided` per F-a schema: `{verdict, reasonCode: 'triage_classifier_placeholder', reasonText: <short model rationale>}`. Actor `"agent"`, session id, turn index from the session after user-message append. |
| B12 | `src/server/chat.ts:127` | `console.warn` classifier failed (catch block) | **replace** | `error.raised` with `{errorType: 'triage_classifier_threw', chunk: 'B', sanitisedContext}`. Session context available in the handler. Also implicitly means `triage.decided` is NOT emitted for this turn; consumers infer "no verdict" from absence. |
| B13 | `src/server/chat.ts:197` | `console.error` "/chat turn failed" | **replace** | `error.raised` with `{errorType: 'chat_turn_failed', chunk: 'B', sanitisedContext: err.message.slice(0, 500)}`. Session id in scope; turn index in scope. Stack trace stays as a separate `console.error` immediately afterward — see §5 boundary rule. |
| B14 | `src/server/chat.ts:205` | `console.log` "/chat turn cancelled" | **replace** | `session.ended` is too heavy here — cancellation isn't session-ending. Use `error.raised` with `{errorType: 'chat_turn_cancelled', chunk: 'B', sanitisedContext: 'client_disconnect'}`. Actor `"user"`. Argument: cancellation is a user-action audit, not an error — acceptable via the `error.raised` envelope for now with `errorType` carrying the real meaning; a dedicated `turn.cancelled` kind is a candidate for post-Puma if real analysis finds this hard to query. |
| B15 | `src/server/chat.ts:100` (after user message appended) | *(no current log)* | **add** | `turn.received` per F-a schema: `{userMessageLength, userMessageSha256}`. Actor `"user"`, session id, turn index = conversationHistory.length at append time. |
| B16 | `src/server/chat.ts` (after SSE `done` written) | *(no current log — stream close is silent)* | **add** | `turn.completed` per F-a schema: `{utterLength, fyiCount, reasoningCount, adjunctCount, latencyMs}`. Counted as parts stream through `translateAdkStream`. Actor `"agent"`. One counter object kept in handler scope, incremented per `MessagePart`, flushed on non-error finish. |
| B17 | `src/connector/tools.ts` (invokeTool, pre-call) | *(no current log — tool dispatch is silent)* | **add** | `tool.called` per F-a schema: `{toolName, toolCallId, inputSha256}`. Actor `"agent"`. Session + turn threaded through the ADK call context — see §3 on threading. |
| B18 | `src/connector/tools.ts` (invokeTool, post-call) | *(no current log)* | **add** | `tool.returned` per F-a schema: `{toolName, toolCallId, outcome, latencyMs, outputSize?}`. Actor `"connector"` — the connector produced the payload. |
| B19 | `src/connector/tools.ts` (invokeTool, on error) | *(no current log — error returned as `ToolAdapterError`)* | **add** | Both: `tool.returned{outcome: 'error'}` (cardinal signal) AND `tool.failed{errorCategory}` (richer kind). Categorise: `input_validation` → `"validation"`; `output_validation` → `"validation"`; `connector_error` → `"upstream"`; `transport_error` → `"unknown"`; timeouts → `"timeout"`. Two events per failed call is deliberate per F-a's documented "keep both" rationale. |
| B20 | `src/server/session-bootstrap.ts:70` (after session created) | *(no current log)* | **add** | `conversation.started` per F-a schema: `{entryUrl?, variantId?, warmPoolHit: false}`. Actor `"system"`. `warmPoolHit` is always `false` until B.t10 lands — the field is present so B.t10's wiring is a one-line edit, not a schema change. |
| B21 | `src/server/consent.ts:87` (tier-1 granted branch) | *(no current log)* | **add** | `consent.granted` per F-a schema: `{tier: 'conversation', copyVersion}`. Actor `"user"`. |
| B22 | `src/server/consent.ts:72` (declined branch, before delete) | *(no current log)* | **add** | `consent.declined` per F-a schema: `{tier: 'conversation', copyVersion}`. Actor `"user"`. Emit BEFORE the delete so the session id is still valid for correlation. |
| B23 | `src/server/consent.ts` (createSessionDeleteHandler) | *(no current log)* | **add** | `session.ended` per F-a schema: `{durationMs, turnCount, finalTriageVerdict, terminationReason: 'user_closed'}`. Computed from `existing.createdAt` + `existing.conversationHistory.length` + `existing.triage.verdict`. Read the session BEFORE delete; emit AFTER the delete succeeded. Missing session (idempotent 204 path) → no emit. |
| B24 | `src/session/in-memory.ts` (sweeper — archive branch) | *(no current log — sweeper is silent)* | **add** | `session.expired` per F-a schema: `{cause: 'idle_timeout'}`. Actor `"system"`, session id from the swept entry. |
| B25 | `src/session/in-memory.ts` (sweeper — delete branch) | *(no current log)* | **add** | `session.expired` per F-a schema: `{cause: 'archive_to_delete'}`. Actor `"system"`. |
| B26 | `src/agent/factory.ts` or wherever the handoff tool fires (internal, pre-widget) | *(no current log)* | **add — IF the handoff-tool call path is in scope now** | `handoff.triggered` per F-a schema: `{verdict, widgetToken}`. If the tool-firing point doesn't exist yet (handoff chunk E still scaffolding), defer and mark as a TODO against chunk E's t2. Not a blocker for F-b completeness. |

### 1.2 Connector (chunk C)

No source files exist yet — `product/connector/src/` contains no `.ts` files today. There is nothing to retrofit. When C.t1 lands, the connector's emission points will be landed alongside the implementation, not as a retrofit pass. The event kinds it will use (`tool.returned`, `tool.failed`, plus whatever skill / retrieval primitives emerge) are already in F-a.

F-b's deliverable for chunk C is therefore a **stub contract note** (§6) captured here for the C-owner to read when they scaffold: which kinds fire from C code vs. which fire from B's tool-adapter wrapper. The short answer: B17/B18/B19 above are orchestrator-side (the adapter layer) and stay there; a separate richer emission inside the connector process itself can wait until the connector is real code.

### 1.3 UI (chunk D)

| # | File : line | Current call | Fate | Mapped event kind / rationale |
|---|---|---|---|---|
| D1 | `src/widgets/widget-shell.tsx:65` | `console.warn` "widget schema validation failed" | **replace** | `error.raised` with `{errorType: 'ui_widget_schema_validation', chunk: 'D', sanitisedContext: first 3 issues joined}`. Actor `"ui"`. Session id from `sessionStorage.getItem('swoop.session.id')` (already the pattern in `orchestrator-adapter.ts`). |
| D2 | `src/runtime/orchestrator-adapter.ts:84` | `console.error` "error listener threw" | **keep** | Meta: the thing being instrumented is the adapter-error broadcaster itself. Routing this through `emitEvent` risks re-entry. Diagnostic only. Comment marking it as such. |
| D3 | `src/runtime/orchestrator-adapter.ts:329` | `console.error` "reasoning part leaked onto the wire — translator bug" | **replace** | `error.raised` with `{errorType: 'ui_reasoning_leak', chunk: 'D'}`. Keeps the assertion — this is a known translator-invariant breach and we want it queryable in Cloud Logging. The existing `eslint-disable-next-line no-console` comment is removed. |
| D4 | `src/runtime/orchestrator-adapter.ts:397` | `console.warn` "unknown part type, ignoring" | **replace** | `error.raised` with `{errorType: 'ui_unknown_part_type', chunk: 'D', sanitisedContext: part.type || 'null'}`. Same rationale as D3: forward-compat drops should be queryable. |
| D5 | `src/runtime/orchestrator-adapter.ts:584` | `console.error` "SSE data was not valid JSON, skipping" | **replace** | `error.raised` with `{errorType: 'ui_sse_parse_failed', chunk: 'D', sanitisedContext: first 100 chars of evt.data}`. The adapter catches this per-frame and continues; emission is per-failed-frame, so rate matters — a burst of malformed frames will be a burst of events. Acceptable for Puma volume; revisit if production shows sustained streams of bad frames (would imply a real orchestrator bug and should be queryable anyway). |
| D6 | `src/disclosure/use-consent.ts` (after `grantConsent` resolves) | *(no current log — consent path is silent)* | **add** | `consent.granted` on the UI side is redundant with B21 (the orchestrator already sees the PATCH). Emit ONLY the `ui.conversation_opened` event here, treating the consent-granted transition as the moment the UI considers the conversation open. Payload: `{source: 'opening_screen', uaCategory: detectUaCategory()}`. Actor `"ui"`. |
| D7 | `src/disclosure/use-consent.ts` (decline branch, line ~221) | *(no current log)* | **add — optional** | `ui.conversation_closed` with `{closeReason: 'explicit_close', finalState: 'declined_before_start'}`. Argument for: captures visitors who opened then declined — useful triage signal. Argument against: no session id yet (consent-declined path never minted one), so `sessionId` would be `"none"`. Emit with `sessionId: "no_session"` and rely on the payload for the signal. |
| D8 | `src/disclosure/use-consent.ts` (`refreshSession`, line ~264) | *(no current log)* | **add** | `ui.conversation_closed` with `{closeReason: 'restart', finalState: 'restart_initiated'}`, followed by a new `ui.conversation_opened` once the new session id is minted. Session ids differ across the pair — the `_closed` carries the old id, the `_opened` carries the new. |
| D9 | `src/widgets/*.tsx` (each widget body, first render) | *(no current log)* | **add** | `ui.widget_rendered` per F-a schema: `{widgetType, toolName, turnIndex}`. One call in each widget body inside a `useEffect(() => emitEvent(...), [])` so it fires once per mount. Widget types: `"search_results"`, `"item_detail"`, `"inspiration"`, `"lead_capture"`. `turnIndex` from the assistant-ui message context (the runtime exposes it; exact accessor settled at implementation time). |
| D10 | `src/App.tsx` (on window `beforeunload` / visibility hidden) | *(no current log)* | **add — best-effort** | `ui.conversation_closed` with `{closeReason: 'tab_close' | 'navigation', finalState}`. Wire via a listener added when the post-consent runtime mounts; removed on unmount. `finalState` reads from `sessionStorage` triage hint if available. Unreliable on mobile (iOS Safari often skips `beforeunload`), so this is best-effort not guaranteed. The orchestrator-side `session.ended` is the authoritative record. |

### 1.4 Ingestion (would-be chunk C sibling)

No source files. Same posture as §1.2 — retrofit is a no-op; event kinds land when ingestion ships.

### 1.5 Inventory totals

- **Replace**: 10 (orchestrator 7, UI 4 — one UI site split into a separate "replace" count; recount: B4, B5, B7, B8, B9, B12, B13, B14 = 8 orchestrator + D1, D3, D4, D5 = 4 UI → 12).
- **Keep (diagnostic)**: 4 (B1, B2, B3, B6 — 1-as-batch + D2 = 5 sites, 4 orchestrator + 1 UI).
- **Delete**: 1 (B10).
- **Add (no current log, new emission point)**: 16 (B11, B15, B16, B17, B18, B19 (two kinds from one site), B20, B21, B22, B23, B24, B25, B26 optional, D6, D7 optional, D8 (two kinds), D9 (four widget sites counted as one pattern), D10).

Real count of `emitEvent` call sites introduced by this retrofit: ~30, grouped across ~12 files.

---

## 2. Event-kind coverage after F-b

F-a shipped 20 kinds. After F-b:

| Kind | Wired in F-b? | Producer | Notes |
|---|---|---|---|
| `conversation.started` | Yes | B (session-bootstrap) | warmPoolHit always false until B.t10 |
| `turn.received` | Yes | B (chat handler) | |
| `turn.completed` | Yes | B (chat handler, post-stream) | |
| `tool.called` | Yes | B (connector/tools adapter) | |
| `tool.returned` | Yes | B (connector/tools adapter) | |
| `tool.failed` | Yes | B (connector/tools adapter) | co-emitted with `tool.returned{outcome:'error'}` |
| `triage.decided` | Yes | B (functional-agents) | replaces classifier's console.log |
| `handoff.submitted` | **No — deferred** | E | emitted when chunk E's handoff-submit path is real code. Slot exists. |
| `handoff.triggered` | Partial | B | only if agent's `handoff` tool is already wired; otherwise TODO against E.t2 |
| `consent.granted` | Yes | B (consent PATCH) | |
| `consent.declined` | Yes | B (consent PATCH) | |
| `session.ended` | Yes | B (DELETE /session) | terminationReason='user_closed' only; idle/error variants need B.t2 sweeper hooks |
| `session.expired` | Yes | B (sweeper) | |
| `error.raised` | Yes | B + D | widest surface; see §1 |
| `skill.loaded` | **No — deferred** | B post-B.t9 | skill primitive not wired |
| `ui.widget_rendered` | Yes | D (widget bodies) | |
| `ui.conversation_opened` | Yes | D (post-consent) | |
| `ui.conversation_closed` | Yes | D (restart/decline/beforeunload) | |
| `warm_pool.hit` | **No — deferred** | B post-B.t10 | no warm pool exists |
| `warm_pool.miss` | **No — deferred** | B post-B.t10 | no warm pool exists |

**After F-b lands: 14/20 kinds wired.** The remaining 6 (`handoff.submitted`, `handoff.triggered`, `skill.loaded`, `warm_pool.hit`, `warm_pool.miss`, and the non-user-closed `session.ended` variants) are wired by their owning tasks when those tasks exist. The kinds' presence in F-a means owners do not touch `ts-common`; they call `emitEvent({eventType: ...})` and move on.

---

## 3. Shape normalisation — threading `sessionId` into emit calls

§2.3 of the Tier 2 plan asks for "automatic session-level correlation". F-a evaluated that and deferred. F-b confirms the deferral stands — pragmatic retrofit is possible without AsyncLocalStorage.

Per-surface threading:

### 3.1 Orchestrator handlers

`sessionId` is a parameter on every handler (`/session/:id/consent`, `/chat` body, `/session/:id` DELETE). Pass it directly into the emit call. No plumbing.

For the ADK tool adapter (B17/B18/B19): the `FunctionTool` callback runs inside ADK's session context. The ADK `ToolContext` carries the session id. Extract it there; no global state needed. If a specific version of `@google/adk` does not expose session on the tool context, fall back to threading the session id into the tool closure at adapter-build time (`createConnectorTools` is called with session-scoped state in the `runAgentTurn` call path — one refactor away, cheap).

For the triage classifier (B11/B12): `classify(message, sessionAfterUser)` already receives the session. The session id is on it. Pass through.

For the sweeper (B24/B25): the sweeper iterates entries; each entry has a session id. Pass it.

For startup errors (B5, B7, B8): there is no session. Use `sessionId: "system"` as the sentinel. Document this in the emit-event header — `"system"` is reserved for events that don't correlate to a visitor session. Consumers filtering on real session ids skip these naturally.

### 3.2 UI surfaces

UI has one session id at any moment, stored in `sessionStorage` under `swoop.session.id` (the `SESSION_STORAGE_KEY` constant exported from `orchestrator-adapter.ts`). Every UI emit reads it once per event:

```ts
// product/ui/src/runtime/emit-ui-event.ts  (NEW)
import { emitEvent, SESSION_STORAGE_KEY } from "@swoop/common/emit-event"; // or wherever resolves
import type { Event } from "@swoop/common";

function readSessionId(): string {
  if (typeof window === "undefined") return "no_session";
  try {
    return window.sessionStorage.getItem("swoop.session.id") ?? "no_session";
  } catch {
    return "no_session";
  }
}

/** Thin UI-side wrapper that fills in sessionId + timestamp + actor default.
 *  Callers pass the event-specific bits; envelope is boilerplate-free. */
export function emitUiEvent(
  partial: Omit<Event, "sessionId" | "timestamp" | "actor" | "eventVersion"> & {
    actor?: Event["actor"];
  },
): void {
  emitEvent({
    ...partial,
    sessionId: readSessionId(),
    timestamp: new Date().toISOString(),
    actor: partial.actor ?? "ui",
    eventVersion: 1,
  } as Event);
}
```

This file is F-b's only net-new file. Its whole point is to reduce the emit boilerplate at every UI call site to one line. Size: ~20 LOC including imports + type gymnastics.

The orchestrator does not need an equivalent wrapper — Node-side callers already have `sessionId`, `turnIndex`, and `actor` in local scope at every emit point, and a wrapper would obscure rather than simplify. If a single pattern does repeat at ≥3 orchestrator sites, promote it to a local helper in the file where it repeats, not to `ts-common`.

### 3.3 Connector

Not applicable in F-b (no connector source). When C.t1 lands, the connector's request context will carry the session id (MCP-level request correlation), and emit calls inside connector code follow the same "pass the id directly" pattern as the orchestrator.

---

## 4. Logger replacement boundary

Clear distinction, stated so the retrofit is not a blunt "delete every `console.*`" pass:

**Auditable → `emitEvent`.** A state transition a future analyst might need to query. Anything that answers the question "what happened in this conversation?". Consent grant, turn start, tool call, triage decision, handoff submit, session end, a schema-validation drift the system decided to recover from. These must survive the retrofit as structured events.

**Diagnostic → `console.*`.** Information a human operator needs when ssh-ing into a log viewer during an incident. Startup banners, config dumps, in-catch stack traces next to a replaced emit, graceful-shutdown chatter, pre-config-validation errors, the UI adapter's "error listener threw" meta-log. These stay as plain `console.log` / `console.error` / `console.warn`. Each such call site gets a single-line comment: `// diagnostic: <reason>`.

**Duplicate → delete.** A current `console.*` that says exactly what a new `emitEvent` will say (B10 is the clearest case). Remove the console call; keep the emit.

Rule of thumb: if a log line will be more useful to a human reading stdout during an incident than to a BigQuery query three weeks later, it's diagnostic. If the reverse, it's an event. Lines that are useful to both get BOTH: a compact emit plus an adjacent `console.error` with the full stack (B13 is the canonical pattern — emit the structured `error.raised`, then `console.error` the actual error for the stack trace).

The one file this rule formalises: every `emitEvent` replacing an existing `console.*` site takes the place of the old call. Every diagnostic `console.*` that survives gets the comment. Every `// eslint-disable-next-line no-console` comment currently in `orchestrator-adapter.ts` (lines 83, 328, 396, 583) is evaluated case-by-case per §1.3: D2 keeps its disable comment, D3/D4/D5 drop both the disable and the console call in favour of `emitEvent`.

---

## 5. Sink configuration — the Cloud Run parsing trap

Default sink stays `console.log(JSON.stringify(event))` per F-a. Cloud Run's logging agent parses any stdout line that **starts with `{`** as a structured log entry; other lines land as plain-text `textPayload` entries. This is the mechanism F-a relies on for zero-config structured logging.

One trap F-b must avoid: any **surviving** `console.log` / `console.error` / `console.warn` call whose first argument is an **object literal** or a JSON string will ALSO be parsed by Cloud Run as structured. Two consequences:

1. Accidental double-coverage — a diagnostic `console.log({foo: bar})` next to an `emitEvent({...})` would produce two structured entries per incident, one well-schemaed, one not.
2. Schema drift at the log-aggregation layer — Cloud Logging / BigQuery would see fields like `foo` mixed in with the F-a schema's `eventType` / `payload` / `sessionId`.

Rule: every surviving diagnostic `console.*` call passes a **string as the first argument**. Objects / errors get concatenated or passed as the second argument. Specifically:
- `console.warn('[orchestrator] connector close failed', err)` ✅ — string first, Cloud Run tags as plain text.
- `console.warn({msg: 'connector close failed', err})` ❌ — Cloud Run parses this as structured; mixes with F-a schema.

Inventory sweep (§1): every **keep** site currently passes a string first. No changes needed. Verification step 6 below adds a grep-level check so regressions get caught.

---

## 6. Sibling coordination

### 6.1 planner-b10 (warm session pool)

Real overlap. B.t10 creates session-lifecycle events (pool hit, pool miss, pre-warm) that F-b would want instrumented. Two possible shapes:

**Option A (F-b pre-wires).** F-b adds TODO markers in `session-bootstrap.ts` and wherever the warm-pool code lands, with the exact `emitEvent` call commented out. B.t10 uncomments and fills in `poolSizeAtClaim` / `waitTimeMs`.

**Option B (B.t10 owns).** F-b leaves warm-pool emission entirely to B.t10's implementation. `warm_pool.hit` / `warm_pool.miss` exist in F-a's schema as ready slots; B.t10's Tier 3 plan calls out the two emit points and wires them.

**Recommendation: Option B.** The TODO-markers approach in Option A ages badly when B.t10's implementation doesn't match the shape F-b guessed (where exactly the pool-hit decision fires, what `poolSizeAtClaim` means at that exact moment). B.t10 owns the domain; F-b owns the schema. Clean separation.

**Coordination ask to planner-b10**: in B.t10's Tier 3 plan, treat the two emit points as first-class deliverables alongside the pool itself. The two emit lines are:

```ts
// on pool hit, immediately after claim
emitEvent({
  eventType: 'warm_pool.hit',
  eventVersion: 1,
  timestamp: new Date().toISOString(),
  sessionId,
  turnIndex: null,
  actor: 'system',
  payload: { poolSizeAtClaim, waitTimeMs },
});
// on pool miss, after falling through to cold-create
emitEvent({
  eventType: 'warm_pool.miss',
  eventVersion: 1,
  timestamp: new Date().toISOString(),
  sessionId,
  turnIndex: null,
  actor: 'system',
  payload: { poolSizeAtClaim },
});
```

If planner-b10's shape disagrees (e.g. `waitTimeMs` doesn't make sense at the emit point), the fix lives in `ts-common/events.ts` as a payload tweak with an F-a reviewer rubber-stamp; not a blocker. No SendMessage tool available in this planning environment, so coordination is via this written doc — planner-b10 reads it as part of their B.t10 territory sweep.

The file-based coordination is robust: when planner-b10 reads `planning/03-exec-observability-b.md` §6.1 during B.t10 scoping, they see the contract explicitly.

### 6.2 planner-d8 (handover doc)

No overlap. D.t8 owns styles + HANDOVER.md; F-b does not touch styling, and HANDOVER.md post-dates F-b landing so any retrofitted files are already in their final shape when D.t8 writes the handover. No action.

### 6.3 Chunk E (handoff) owners

`handoff.submitted` and `handoff.triggered` are in the F-a schema. E's Tier 3 plans (E.t1 + E.t2) add the two emit points when they implement the handoff submit path. F-b does not pre-wire — same Option-B reasoning as §6.1.

Contract for E: at the moment `createHandoffSubmitHandler` writes the handoff record to the durable store (Cloud SQL Postgres `handoff` table per E.10 + C.18 + C.23 — Firestore was the original target but is dropped project-wide; today an `FsHandoffStore` interim writes JSON to disk) and dispatches the email:

```ts
emitEvent({
  eventType: 'handoff.submitted',
  eventVersion: 1,
  timestamp: new Date().toISOString(),
  sessionId,
  turnIndex: <from session state>,
  actor: 'user',
  payload: {
    handoffId,
    verdict,
    consentConversationGranted,
    consentHandoffGranted,
    consentMarketingGranted,
    emailDeliveryStatus,
  },
});
```

And at the moment the agent's `handoff` tool fires (the widget-token issuance, pre-user-confirmation):

```ts
emitEvent({
  eventType: 'handoff.triggered',
  eventVersion: 1,
  timestamp: new Date().toISOString(),
  sessionId,
  turnIndex,
  actor: 'agent',
  payload: { verdict, widgetToken },
});
```

### 6.4 planner-h (validation harness)

Implicit dependency. H imports `Event` / `EventSchema` and treats event-stream shape as its wire contract. F-b's retrofit means H can move from "assert on stub fixtures" to "assert on real emitted events" once F-b lands. No direct action from F-b's side — the handshake is schema-is-contract, and the schema is already in `ts-common`.

---

## 7. Verification

F-b is done when the following holds. Each check is mechanical and fast.

1. `npm --workspace @swoop/common test` green — F-a tests unchanged, still passing.
2. `npm --workspace @swoop/orchestrator test` green — new `emitEvent` call sites have test coverage via a captured-sink fixture. Pattern: per-handler test uses `setEventSink(captureSink)` in `beforeEach`, asserts the expected event was emitted, calls `resetEventSink` in `afterEach`. New test files or additions per handler touched.
3. `npm --workspace @swoop/ui test` green — ditto for UI. `emit-ui-event.ts` gets a small test verifying `sessionStorage` is consulted and the envelope is filled.
4. `grep -R "console\." product/orchestrator/src product/ui/src | grep -v "__tests__" | grep -v "// diagnostic:"` returns **no results**. Every surviving `console.*` call carries the `// diagnostic: <reason>` marker. Zero unmarked console calls in production code.
5. `grep -R "emitEvent" product/orchestrator/src product/ui/src | wc -l` returns ≥ the inventory count above (roughly 30, accounting for test-file references).
6. `grep -nE "console\.(log|warn|error)\(\s*\{" product/orchestrator/src product/ui/src` returns **no results**. Confirms §5 sink-double-coverage guard — no surviving diagnostic passes an object literal first, so Cloud Run will not accidentally parse diagnostic lines as structured.
7. Run the orchestrator locally, open the UI in a browser, complete a one-turn conversation with a search widget. Tail stdout. Expected event sequence (in order, session id constant across all):
   - `conversation.started`
   - `consent.granted`
   - `ui.conversation_opened`
   - `turn.received`
   - `triage.decided` (unless classifier off)
   - `tool.called`
   - `tool.returned`
   - `ui.widget_rendered`
   - `turn.completed`
   - then either `session.ended{terminationReason: 'user_closed'}` via DELETE, or `session.expired{cause: 'idle_timeout'}` if left idle past the TTL.
   Each event parses via `EventSchema.safeParse` when piped through `jq` → a small ad-hoc validator script. If the pipe shows no parse failures, the schema contract holds in real traffic.
8. BigQuery-export-readiness regression: `EventSchema` unchanged in shape since F-a. F-b introduced zero envelope field additions. Verify by `git diff main -- product/ts-common/src/events.ts` returning empty (or only comment changes).
9. Spot-check runbook (Tier 2 §2.5) — owned by F.t4, a separate deliverable. F-b leaves a one-paragraph note in `product/cms/ops/` (or defers the note entirely to F.t4) confirming the happy-path sequence above. Not a blocker for F-b completeness; noted so F.t4's author knows what to write against.

Final gate: verification 1–6 green + a single happy-path live check (7) passing. That's the honest "retrofit complete" signal — not a blanket console-purge test, not a dashboard that doesn't exist yet.

---

## 8. Out-of-scope reminders (don't drift)

- No new event kinds. If a gap appears mid-retrofit, land the kind in `ts-common` as a micro-PR reviewed by F-a's author, then retrofit uses the new kind. Do not quietly wedge ad-hoc payload fields into `error.raised` to avoid schema work.
- No Cloud Logging client dependency. Default stdout sink stands.
- No automatic session correlation via AsyncLocalStorage. If the retrofit is painful, note where and defer to a post-Puma micro-wave.
- No touching the F-a files (`events.ts`, `emit-event.ts`, F-a test files) beyond additive fixture entries if a new kind is added per the bullet above.
- No rate limiting / sampling of high-volume events. If `tool.returned` volume becomes an issue in production, handle it at the sink, not at the emit sites.
- No PII leakage. Every emit call's payload is re-audited against the schema at emission (F-a's `safeParse`); if a producer tries to pass a user-message content field where a length+hash is expected, the fallback `error.raised` fires and the producer's bug is visible.
- No altering any `__tests__` file beyond adding coverage for the new emit points. Do not rewire existing test fixtures to assert on events they don't currently care about.

---

## 9. Handoff

Once F-b lands, the observability chunk has exactly two outstanding tasks:

- **F.t4 — Spot-check runbook.** One markdown file walking a Swoop engineer from "here's a session id" to "here's the event trail". Lightweight; ~30 min. Needs real events to describe, which F-b delivers.
- **F.t5 — BigQuery-export readiness check.** One-off verification; no code. ~30 min.

Chunks B.t10, B.t9, E.t1, E.t2 each pick up one or two of the deferred kinds (§6) as their own Tier 3 tasks specify. Owners of those tasks read §6 of this plan for the contracts and emit shapes.

H's validation harness (chunk H) becomes capable of asserting on real event streams the moment F-b lands. No F-b-side action for H — the coupling is schema-level and already in place via F-a.
