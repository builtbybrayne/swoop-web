# 03 — Execution: F-c — Durable Event Sink + Cloud Logging / Error Reporting collection

**Status**: Tier 3 execution plan. Authored 2026-06-16 (worktree `analytics-review`). HITL-ratified 2026-06-16 (Alastair) — see appendix.
**Chunk**: F (observability & analytics).
**Implements**: the **collection layer** the F-a/F-b plans deliberately deferred — [`02-impl-observability.md`](02-impl-observability.md) §2.3 (sink), §2.4 (BigQuery-export-readiness), §2.6 (retention) — plus the dev-team **error surface** (Cloud Error Reporting + a log-based alert policy). Closes the gap named in [`reviews/2026-06-16-analytics.md`](reviews/2026-06-16-analytics.md): the event stream is richly emitted but flows to stdout only, so nothing accrues anywhere queryable.
**Explicitly NOT in scope**: the *analysis* layer — F.t6 conversation-analysis council, dashboards, cohort/funnel, BigQuery export wiring. Deferred per Alastair 2026-06-16 ("analysis is work for later").
**Depends on**: F-a (`@swoop/common` `events.ts` 34 kinds + `emit-event.ts` `setEventSink` seam — both landed). No new third-party dependency.
**Blocks**: nothing. Forward-compatible with the deferred analysis layer (Cloud Logging → BigQuery is a one-click Logs Router sink when/if that lands).
**Estimate**: ~0.5–1 day. Mechanical behind the existing seam.

---

## Purpose

The event stream is the right substrate — it captures *real app interest* (tool calls, the triage→handoff funnel, widget renders, conversation shape) that GA structurally cannot. It is fully emitted (~31 of 34 kinds fire live across orchestrator/connector/ui). It just has **no durable home**: the default sink is `console.log(JSON.stringify(event))`, and Puma runs single-VM (Mac Mini demo now → GCE VM in Swoop's GCP later), not Cloud Run — so stdout is ephemeral and nothing is queryable.

F-c registers a **pluggable production sink** via the `setEventSink` hook F-a built for exactly this, selected by a new `EVENT_SINK` env knob, in three modes:

| `EVENT_SINK` | Behaviour | When |
|---|---|---|
| `stdout` *(default)* | `console.log(JSON.stringify(event))` — unchanged from today | dev |
| `postgres` | fire-and-forget `INSERT` into an `event_log` table (single-store per C.18) | **demo (Mini) + dev + any pre-GCP host** — durable, SQL-queryable **today** |
| `cloud-logging` | structured-stdout enriched with a top-level `severity` + stable `message`, in the shape Cloud Logging ingests (via Cloud Run native, or the Ops Agent on a GCE VM) | Swoop GCP prod — unlocks Log Explorer + **Error Reporting** + alert policies |

The `cloud-logging` mode is **dependency-free** (it is `console.log` of a severity-tagged object — no `@google-cloud/logging`). The only GCP-side requirement is the Ops Agent on the VM (or Cloud Run native) + a service account with Logging Writer — both infra config Thomas owns, not app code. Cloud **Error Reporting** auto-ingests the `severity:ERROR` entries and emails the dev team on new/spiking errors; one Cloud Monitoring alert policy on `severity>=ERROR` closes the loop.

**The decision Alastair made (2026-06-16)**: include the `postgres` sink now so durable collection works on the demo Mini and de-risks the still-pending GCP IAM. The `cloud-logging` flip is then env + console config the moment IAM lands — no rework. That is exactly what the seam buys.

---

## 1. Design

### 1.1 Severity derivation (the one load-bearing detail)

Cloud Logging, Error Reporting and alert policies all key off **`severity`**. A pure, exhaustively-tested function maps each event kind:

`product/ts-common/src/event-sink.ts` → `severityForEvent(event: Event): 'ERROR' | 'WARNING' | 'INFO'`

| Severity | Kinds |
|---|---|
| **ERROR** (page-the-dev-team) | `error.raised`; `tool.invoked{ok:false}`; `tool.returned{outcome:'error'}`; `handoff.email.failed`; `handoff.retention.sweep.failed`; `session.replay.failed` |
| **WARNING** (drift / degraded, worth review) | `ui.widget_rendered` whose `widgetType` contains `:malformed`; `ui.session.rehydrate.failed` |
| **INFO** (everything else) | normal lifecycle — incl. `:silent` widget renders, `handoff.email.skipped`, `session.expired`, `warm_pool.miss`, etc. |

`messageForEvent(event): string` produces a **stable** one-line summary for the Log Explorer summary + Error Reporting grouping — keyed off `eventType` + structural fields only (e.g. `error.raised [B] chat_turn_failed`), never the variable `sanitisedContext` (which stays in the payload). Both functions are pure, browser-safe, and live in `ts-common` (zod-only package — no `pg`/GCP weight leaks into the UI bundle).

### 1.2 The sinks

- **`stdout` / `cloud-logging`** — pure, in `ts-common/src/event-sink.ts`:
  - `stdoutSink: EventSink` = current default (kept identical; dev behaviour unchanged).
  - `cloudLoggingSink: EventSink` = `console.log(JSON.stringify({ severity, message, ...event }))`. `severity` + `message` are the only additions; the full event rides as the structured payload so Log Explorer queries on `eventType`/`payload.*` work unchanged.
- **`postgres`** — in `@swoop/connector` (owns `pg`): `createPostgresEventSink(pool: pg.Pool): EventSink`. Fire-and-forget per-event `INSERT … ON CONFLICT DO NOTHING` wrapped so it **never throws and never blocks the turn** (observability must not take down the code it observes — same posture as `emitEvent`). Per-event insert is fine at Puma volume (tens–hundreds of conversations/day × ~30–50 events ≈ a few thousand tiny inserts/day); batching is a documented future optimisation, not v1.
- **Resolver** — `resolveEventSink({ mode, pool? }): EventSink` in `@swoop/connector` (the one place that has both `pg` and the pure ts-common sinks). `postgres` mode with no pool → warn once + fall back to `cloudLoggingSink` (degrade, never crash). Both processes call it once at startup.

### 1.3 Wiring (both emitting processes)

Events fire from **two** server processes; both register the sink once at startup via `setEventSink`:

- **Orchestrator** — [`orchestrator/src/index.ts`](../product/orchestrator/src/index.ts) `main()`, right after `loadConfig()`. Pool provisioning: reuse the `postgresPool` it already builds when `SESSION_BACKEND=postgres`; if `EVENT_SINK=postgres` is set without a session pool, build a small dedicated pool from `ORCHESTRATOR_DATABASE_URL`.
- **Connector** — [`connector/src/server/index.ts`](../product/connector/src/server/index.ts) `main()`, right after `getPool(config)` (the pool already exists there).
- **Sweep CLI** (optional, cheap) — [`connector/bin/sweep.ts`](../product/connector/bin/sweep.ts) `main()` registers the sink too so a standalone sweep run's `handoff.retention.sweep.*` events also collect.

`ui/src/runtime/emit-ui-event.ts` is **untouched** — UI events still resolve to the browser `console.log` sink (devtools). Collecting UI events server-side needs a `POST /events` transport; that is **Phase 2** (§4), not this plan.

### 1.4 Config + storage

- **`EVENT_SINK`** env added to both config schemas:
  - orchestrator [`config/schema.ts`](../product/orchestrator/src/config/schema.ts): `z.enum(['stdout','postgres','cloud-logging']).default('stdout')`, plus a cross-field refine (mirroring the `SESSION_BACKEND=postgres` one): `EVENT_SINK=postgres` requires `ORCHESTRATOR_DATABASE_URL`.
  - connector [`config/schema.ts`](../product/connector/src/config/schema.ts): same enum; the connector always has `DATABASE_URL`, so no refine needed.
  - Mirror both in the respective `.env.example` (commented, default `stdout`).
- **Migration 020** `connector/migrations/020_event_log.sql` (forward-only per C.31):

  ```sql
  CREATE TABLE IF NOT EXISTS event_log (
    id          BIGSERIAL   PRIMARY KEY,
    event_type  TEXT        NOT NULL,
    severity    TEXT        NOT NULL,
    session_id  TEXT        NOT NULL,
    turn_index  INTEGER     NULL,
    actor       TEXT        NOT NULL,
    event       JSONB       NOT NULL,   -- the full validated Event
    ts          TIMESTAMPTZ NOT NULL,   -- event.timestamp
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS event_log_type_idx     ON event_log (event_type);
  CREATE INDEX IF NOT EXISTS event_log_session_idx  ON event_log (session_id);
  CREATE INDEX IF NOT EXISTS event_log_ts_idx       ON event_log (ts);
  -- partial index: "show me recent problems" stays fast as INFO dominates.
  CREATE INDEX IF NOT EXISTS event_log_severity_idx ON event_log (severity) WHERE severity <> 'INFO';
  ```

  PII posture unchanged: events already carry lengths + sha256, never content — so `event_log` holds no message text. Retention sweep (`DELETE … WHERE created_at < NOW() - INTERVAL '30 days'`) is a documented fast-follow (§4), not v1; the table is PII-safe so unbounded-growth is an ops concern, not a compliance one.

### 1.5 The GCP flip (Thomas, when "AI Pat Chat" IAM lands — questions.md)

No app change. One-time, all console/CLI:
1. Enable Cloud Logging + Error Reporting APIs on the project.
2. Grant the VM (or Cloud Run) service account `roles/logging.logWriter`.
3. On the GCE VM: install the Google Cloud Ops Agent and point its logging receiver at the orchestrator + connector stdout (or a redirected log file). On Cloud Run: nothing — stdout is captured natively.
4. Set `EVENT_SINK=cloud-logging` in both services' env.
5. Create a Cloud Monitoring **alert policy**: log-based condition `severity>=ERROR` (optionally filtered to `jsonPayload.eventType`), notification channel = dev-team email / Slack.
6. Error Reporting auto-aggregates the ERROR entries — no extra setup.

A `handover/ops/observability.md` runbook captures these steps + the common Log Explorer / `event_log` queries (this also discharges the still-missing **F.t4 spot-check runbook**).

---

## 2. File plan

| File | Change |
|---|---|
| `product/ts-common/src/event-sink.ts` *(new)* | `EventSeverity`, `severityForEvent`, `messageForEvent`, `stdoutSink`, `cloudLoggingSink`. Pure; no new deps. |
| `product/ts-common/src/index.ts` | `export * from "./event-sink.js";` |
| `product/ts-common/src/__tests__/event-sink.test.ts` *(new)* | per-kind severity table; `messageForEvent` stability; `cloudLoggingSink` emits a top-level `severity` that round-trips. |
| `product/connector/migrations/020_event_log.sql` *(new)* | the table above. |
| `product/connector/src/data/event-log-sink.ts` *(new)* | `createPostgresEventSink(pool)` + `resolveEventSink({mode,pool?})`. Never-throws. |
| `product/connector/src/data/__tests__/event-log-sink.test.ts` *(new)* | resolver selection; postgres sink builds the right INSERT (mocked pool); never-throws on pool reject; DB-gated round-trip insert when `DATABASE_URL` present. |
| `product/connector/src/index.ts` | re-export `createPostgresEventSink`, `resolveEventSink`. |
| `product/connector/src/config/schema.ts` + `.env.example` | add `EVENT_SINK`. |
| `product/connector/src/server/index.ts` | `setEventSink(resolveEventSink({mode: config.EVENT_SINK, pool}))` after `getPool`. Boot-log line. |
| `product/connector/bin/sweep.ts` | same registration (optional). |
| `product/orchestrator/src/config/schema.ts` + `.env.example` | add `EVENT_SINK` + the `postgres`-requires-`ORCHESTRATOR_DATABASE_URL` refine. |
| `product/orchestrator/src/index.ts` | provision pool if needed + `setEventSink(...)`. Boot-log line. Fix the stale "Not here yet: Observability backbone (chunk F)" header comment. |
| `product/orchestrator/src/server/chat.ts` | fix the stale "What is intentionally missing: Observability events (chunk F)" header comment (it is wired). |
| `handover/ops/observability.md` *(new)* | the GCP flip steps + Log Explorer / `event_log` query cookbook + the happy-path event sequence (discharges F.t4). |
| `migrate.test.ts` (connector) | bump expected migration count to 020. |

---

## 3. Decisions (provisional ids — renumber at merge per the collision-avoidance convention)

- **F.sink-1** — Collection is a **pluggable sink behind the existing `setEventSink` seam**, three modes (`stdout`/`postgres`/`cloud-logging`) chosen by one `EVENT_SINK` env. No event-emission code changes; the instrumentation was already complete. *Swap cost: low — modes are additive; removing one is deleting a branch.*
- **F.sink-2** — **Severity mapping** (§1.1) is the contract the GCP error surface keys off. Error-bearing kinds → ERROR; UI drift → WARNING; rest → INFO. Pure + exhaustively tested. *Swap cost: trivial — one function; re-classifying a kind is a one-line edit + a test row.*
- **F.sink-3** — `postgres` sink writes an `event_log` table in the **single store** (C.18), **fire-and-forget per event, never-throws**. Durable + SQL-queryable with zero GCP dependency — the path that works on the demo Mini today. *Swap cost: low — batching / a different backend is a sink-internal change behind the same `EventSink` type.*
- **F.sink-4** — `cloud-logging` mode is **structured-stdout + severity**, deliberately **no `@google-cloud/logging` dependency** — shipping it via Cloud Run native / the Ops Agent keeps the app dep-free and deployment-agnostic, and avoids pulling grpc/gax weight into a service that may run on a bare VM. *Swap cost: low — if direct-API writes (no agent) are ever wanted, add the library behind the same sink.*
- **F.sink-5** — **Retire the dead `tool.failed` slot** (defined + fixtured, never emitted; redundant with `tool.returned{outcome:'error'}` + `tool.invoked{errorKind}` — answered F-a's own "delete one?" open question by never wiring it). Removed from the union + type export + fixture. `handoff.triggered` and `skill.loaded` are **kept** — they are genuinely-deferred *feature* slots (handoff-tool firing; B.t9 skill load), not redundant. *Swap cost: trivial — re-adding `tool.failed` is one union entry if ever wanted.*
- **F.sink-6** — UI events stay browser-only for now; a `POST /events` transport to collect them server-side is **Phase 2** (§4). The operationally-critical error signals are all server-side and fully covered without it. *Swap cost: n/a — additive later.*

---

## 4. Out of scope (named so it isn't silently absorbed)

- **UI → server event transport** (`POST /events`): would let `ui.widget_rendered` (incl. the `:malformed`/`:silent` telemetry), `ui.conversation_opened/closed`, `ui.session.rehydrate.*` collect server-side. Phase 2. Until then those remain browser-console only.
- **`event_log` retention sweep** — fast-follow (`DELETE … WHERE created_at < …`), foldable into the existing handoff/session sweep cadence. Table is PII-safe, so non-urgent.
- **Batching / sampling** the postgres sink — not needed at Puma volume; handle at the sink if a high-volume kind ever bites.
- **BigQuery export + dashboards + conversation analysis (F.t6)** — the *analysis* layer. Explicitly later (Alastair 2026-06-16). Cloud Logging → BigQuery stays a one-click Logs Router sink when that day comes.

---

## 5. Verification

1. `npm --workspace @swoop/common test` green — new `event-sink.test.ts` (per-kind severity + message stability + cloudLoggingSink severity round-trip) + existing 202 still pass.
2. `npm --workspace @swoop/connector test` green — resolver selection, mocked-pool INSERT shape, never-throws-on-reject; DB-gated round-trip insert when `DATABASE_URL` is set; `migrate.test.ts` expects 020.
3. `npm run -w @swoop/orchestrator test` + `npm run typecheck` (all workspaces) green.
4. **Live Postgres smoke** (operator, against `puma_dev`): `EVENT_SINK=postgres` boot both services, run one consented conversation through a tool call + a handoff, then `SELECT event_type, severity, count(*) FROM event_log GROUP BY 1,2 ORDER BY 1;` — expect `conversation.started`, `turn.received`, `tool.called`/`tool.returned`/`tool.invoked`, `turn.completed`, `consent.granted`, `handoff.submitted`, etc.; and a forced tool error lands one `severity='ERROR'` row.
5. **`cloud-logging` shape check** (no GCP needed): `EVENT_SINK=cloud-logging`, pipe stdout through `jq 'select(.severity=="ERROR")'` — error events surface with the right severity + a stable `message`.
6. Live Cloud Logging + Error Reporting + alert verification — **pending GCP IAM** (Thomas); the runbook §1.5 is the checklist.

Gate: 1–3 green + the §4-live Postgres smoke (4/5) passing = F-c complete for the demo/dev surface; the GCP flip (6) rides the IAM dependency.

---

## 6. Handoff

After F-c: durable, queryable collection works today on the Mini/dev via `EVENT_SINK=postgres`; the GCP prod surface (Cloud Logging + Error Reporting + alerts) is a config flip gated on the existing "AI Pat Chat" IAM. The deferred analysis layer (F.t6, BigQuery, dashboards) is unblocked-but-untouched — the schema was always export-ready and Cloud Logging → BigQuery is one Logs Router sink away.

---

## Appendix — HITL ratification (2026-06-16)

Authored against the [2026-06-16 analytics review](reviews/2026-06-16-analytics.md). Alastair's steer, verbatim in spirit:
- Concerned **only with the collection layer** right now; **analysis is later** (F.t6 etc. explicitly out).
- Latitude to pick a solution we deem fit **if it's GCP-native and trivial** → Cloud Logging + Error Reporting.
- Swoop today runs only basic GA, which is uninformative for real app interest → the event stream is the right substrate.
- Wants an **error sink that surfaces issues to the dev team quickly** → Error Reporting + a `severity>=ERROR` alert policy.
- Ratified including the **Postgres sink now** (durable collection on the demo Mini; de-risks the GCP-IAM wait).

Back-link: [reviews/2026-06-16-analytics.md](reviews/2026-06-16-analytics.md).
