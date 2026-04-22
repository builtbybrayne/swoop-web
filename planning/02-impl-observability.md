# 02 — Implementation: F. Observability & Analytics

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4F.
**Depends on**: A (foundations — `ts-common` event schema stub), B (agent emits events), C (connector emits events), D (UI emits events), E (handoff emits events).
**Coordinates with**: H (eval harness reads events as assertions).
**Blocks**: none directly; enables post-launch analysis and iteration.

---

## Purpose

F makes Puma observable. The goal isn't dashboards, cost reports, or vendor observability tooling — all deferred. The goal is a **disciplined, well-schemaed stream of structured events** landing in GCP Cloud Logging, authored so that later ad-hoc analysis (BigQuery queries, spot-check investigations, prompt tuning) is possible without re-instrumentation.

This is the chunk that keeps Puma honest: without it, we can't tell a good conversation from a bad one after launch.

---

## 1. Outcomes

When this chunk is done:

- Every load-bearing interaction emits a structured event to GCP Cloud Logging with a consistent envelope (event type, timestamp, sessionId, correlation ids).
- Event schema defined in `ts-common` with Zod validation — events are contract-checked at emission, not just after the fact.
- Every chunk that produces events (B, C, D, E) emits them via a shared logging helper — no ad-hoc `console.log` scattered about.
- A minimum set of events covers: conversation lifecycle, turn lifecycle, tool calls, triage decisions, handoff submissions (including verdict), errors, UI interactions (open, close, handoff-triggered).
- Events are BigQuery-export-ready — field names, types, and structure survive Cloud Logging → BigQuery export without transformation.
- A runbook describes how to spot-check a conversation by session id (query, pull events, trace the path).
- No dashboards, no alerting, no vendor tooling.

**Not outcomes**:
- Analytics dashboards.
- Cohort analysis, funnel attribution, conversion tracking.
- Per-conversation cost tracking (beyond raw model-call events that enable later calculation).
- Langfuse / Braintrust / Arize / Posthog / OpenTelemetry-to-vendor integrations.
- Cloud Trace / distributed tracing beyond basic Cloud Run-provided traces.
- Real-time alerting.

---

## 2. Target functionalities

### 2.1 Event envelope

Every event shares a common envelope:

- `event_type` — dotted-namespaced, e.g. `conversation.started`, `tool.called`, `triage.decided`, `handoff.submitted`, `error.raised`.
- `event_version` — integer. Starts at 1. Increments on breaking schema changes.
- `timestamp` — ISO 8601, UTC, to millisecond.
- `session_id` — correlates events across a conversation.
- `turn_index` — correlates events within a turn (null for session-level events).
- `actor` — `agent` / `user` / `system` / `connector` / `ui`.
- `payload` — event-type-specific fields.

The envelope is defined in `ts-common`. Payload shapes are defined per event type, also in `ts-common`, Zod-validated at emission. Unknown fields are rejected.

### 2.2 Minimum event set for Puma

| Event type | Emitted by | Payload highlights |
|---|---|---|
| `conversation.started` | B (orchestrator) | entry URL, variant id, warm-pool-hit flag |
| `turn.received` | B | user message (length; optional redacted content), turn_index |
| `turn.completed` | B | `<utter>` length, block counts (`<fyi>`, `<reasoning>`, `<adjunct>`), latency total |
| `tool.called` | B | tool name, input-hashed, turn_index |
| `tool.returned` | C | tool name, outcome (`ok` / `error`), latency, output-size |
| `triage.decided` | B | verdict (`qualified` / `referred_out` / `disqualified`), reason_code, reason_text |
| `skill.loaded` | C (`load_skill`) | skill_name, trigger_context (short) |
| `handoff.submitted` | E (via C's `handoff_submit`) | verdict, consent flags, email_delivery_status |
| `session.ended` | B | duration, turn_count, final triage state, termination_reason (user_closed / idle_timeout / error) |
| `error.raised` | any | error_type, chunk, sanitised context, correlation to turn / session |
| `ui.widget_rendered` | D | widget_type, tool_name, turn_index |
| `ui.conversation_opened` | D | source (button placement variant), UA fingerprint category |
| `ui.conversation_closed` | D | close_reason (explicit_close / tab_close / navigation), final_state |
| `warm_pool.hit` / `warm_pool.miss` | B | pool_size_at_claim, wait_time |

User-facing text (e.g. the full `<utter>` content) is **not** logged by default — a length + hash suffices. If later analysis needs actual text, add it via a deliberate schema change and a consent / retention review. Default: no PII in logs.

### 2.3 Emission helper

A `ts-common`-exported `emitEvent(event)` helper:
- Validates the event against its Zod schema.
- Structures the log line as JSON (Cloud Logging prefers structured JSON).
- Writes via the Cloud Logging client (production) or stdout (dev).
- Applies session-level correlation automatically (pulls `session_id` from whatever session context is in play).

Every chunk uses this helper. No raw `console.log` in Puma code (outside dev utilities explicitly marked as such).

### 2.4 BigQuery-export-readiness

Cloud Logging can export logs to BigQuery automatically. For the export to be useful, the event schema needs to be:
- Flat-ish — avoid deeply nested payloads that BigQuery awkwardly unnests.
- Typed — numbers are numbers, booleans are booleans, enums are string literals with a known set.
- Versioned — `event_version` field lets later analyses cope with schema evolution.

Puma launches **without** the BigQuery export wired. The schema is designed to support it when Swoop wants it (`questions.md`: analytics platform preference). Turning it on is a GCP config change — no code.

### 2.5 Spot-check runbook

`product/cms/ops/spot-check-conversation.md` — how to pull the full event trace for a session id:
1. Session id (from the handoff record, a user report, or a support ticket).
2. Cloud Logging query filter.
3. Expected event sequence (what a healthy conversation looks like).
4. What to look for (abnormal triage flip-flops, repeated tool errors, long gaps).

Handed over to Swoop's internal team post-M5.

### 2.6 Retention + privacy

- Cloud Logging default 30d retention (GCP default).
- Long-retention path: export to BigQuery with its own retention policy (Swoop's call once analytics platform is chosen).
- PII: avoided at emission (see §2.2). If any payload field could carry PII, it's flagged in the schema and deliberately redacted.

---

## 3. Architectural principles applied here

- **Content-as-data** (theme 2, as applied to events): the schema lives in `ts-common`, not hardcoded emitters. Schema changes are visible in PRs.
- **Swap-out surfaces named**: logging backend (Cloud Logging for Puma; OTel / vendor later if Swoop adopts); export target (BigQuery default; data warehouse of Swoop's choice).
- **Production quality on minimum surface** (theme 7): we ship real observability, not "just enough to get by." The minimum surface is structured and complete; the maximum surface (dashboards, vendors) is deferred.
- **Legal compliance built-in** (theme 9): PII avoidance is schema-enforced; retention aligns with E.7 / E.8.

---

## 4. PoC carry-forward pointers

No direct carry-forward. The PoC logged informally. Puma starts fresh with a schema.

Useful reference only:
- `planning/archive/research/eval-harness-research.md` — includes observability tooling research. Read for context on what we're deliberately not doing in Puma.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| F.1 | Logging backend | **GCP Cloud Logging.** | Native; free tier generous; BigQuery export is a flag. |
| F.2 | Event schema format | **Flat-ish structured JSON with envelope + typed payload.** Zod-validated in `ts-common`. | Readable in Cloud Logging UI; exports cleanly to BigQuery. Schema as code catches drift at emission. |
| F.3 | PII in events | **None by default.** User-message content replaced with length + hash. Flagged fields reviewed case-by-case. | GDPR default; simplifies retention. |
| F.4 | Dashboards / alerting | **Not in Puma.** | Out of scope. |
| F.5 | Vendor observability (Langfuse / Braintrust / etc.) | **Not in Puma.** Revisit post-launch with traffic data. | YAGNI; avoid vendor lock-in before the shape of signal is understood. |
| F.6 | BigQuery export | **Schema is export-ready. Export itself wired only if Swoop asks (per `questions.md`).** | Optional config change. |
| F.7 | Distributed tracing | **Cloud Run default tracing only.** No Cloud Trace / OTel bootstrapping in Puma. | Events carry correlation ids; full tracing adds setup pain without clear Puma benefit. |
| F.8 | Retention | **Cloud Logging 30d default; long-term via BigQuery export if enabled.** | Free tier covers; aligns with E retention policy. |

---

## 6. Shared contracts produced

Authored by this chunk (into `ts-common`):
- **Event envelope schema** (§2.1).
- **Event payload schemas** — one per event type in §2.2.
- **`emitEvent` helper** — exported utility every chunk uses.

Consumed:
- Session state shape (from B) — `session_id`, `turn_index`, triage state.
- Tool I/O (from A) — tool-name enum, outcome codes.
- Handoff payload (from A) — verdict, consent flags.

---

## 7. Open sub-questions for Tier 3

- Exact event naming convention (dotted vs nested; past tense vs imperative).
- Sampling — do we log every event at 100%, or sample high-volume events (e.g. `tool.returned`) in production?
- Session-level summary event vs reconstruction from per-turn events — a synthesised `session.summary` event is useful for analysis but duplicative.
- Trace correlation across the two Cloud Run services (orchestrator + connector) — Cloud Run default headers vs custom correlation id propagation.
- Rate of events on the chat surface (D) — do UI-visible interactions log at every keystroke / scroll, or only on meaningful actions?
- Error event granularity — one schema with `error_type`, or per-error-type schemas.
- Analytics platform confirmation (tracked in `questions.md`): if Swoop says "use our Looker / Metabase / Mixpanel / etc.", does the schema need tweaking?
- Cost-event capture — do we emit model-call events with token counts to enable later cost analysis? Probably yes.

---

## 8. Dependencies + coordination

- **Inbound**:
  - Chunk A's `ts-common` event schema stub (F authors it; A's stub just reserves the location).
  - Every producing chunk (B, C, D, E) using the `emitEvent` helper.
  - Cloud Logging IAM in the Swoop GCP project (standard for Cloud Run).
- **Outbound**:
  - Chunk H queries events to assert on agent behaviour.
  - Post-launch analytics (BigQuery or Swoop's chosen platform) consumes the export.
- **Agent coordination**:
  - Schema authorship is F's job. Producers (B/C/D/E) call out their emission points during Tier 2 and emit per the schema. If a producer needs a new event type, they propose it via `ts-common` PR; F reviews.

---

## 9. Verification

Chunk F is done when:

1. `emitEvent` helper exists, validates events against their schemas, and writes structured JSON to Cloud Logging in production / stdout in dev.
2. Every chunk in B / C / D / E uses `emitEvent` at every prescribed emission point (§2.2). No raw `console.log` in Puma production code.
3. A test conversation produces the expected event sequence, visible in Cloud Logging with correct correlation ids.
4. Events round-trip cleanly through a simulated BigQuery export (dry-run schema compat check).
5. No PII appears in any event payload in a grep-search of the schemas (user message content is length + hash; contact details only in handoff store, not logs).
6. Spot-check runbook walks a Swoop engineer from "here's a session id" to "here's what happened" without further guidance.
7. Schema changes are additive-only between versions (old consumers keep parsing old events; new fields are optional).

---

## 10. Order of execution (Tier 3 hand-off)

- **F.t1 — Event schema authorship**: envelope + payload schemas in `ts-common`. All event types from §2.2. Fixtures for each.
- **F.t2 — `emitEvent` helper**: library function, dev + prod backends, automatic correlation.
- **F.t3 — Producer integration**: each of B / C / D / E wires the emission points. Coordinated; lands via small PRs per producer.
- **F.t4 — Spot-check runbook**: documented queries + expected sequences.
- **F.t5 — BigQuery export readiness check** (no wiring): schema compatibility verified; documented. Actual export flipped on only if Swoop asks.

F.t1 + F.t2 are foundational — they precede F.t3 on each producer. F.t4 is lightweight. F.t5 is a one-off verification.

Parallelism: F.t1 + F.t2 are sequential but tiny. F.t3 depends on producers being far enough along to have real emission points (post-M1). F.t4 + F.t5 are end-of-chunk.

Estimated: 1–1.5 days of focused F-owned work (F.t1, F.t2, F.t4, F.t5), plus 0.25 day per producer to wire F.t3 (B / C / D / E).
