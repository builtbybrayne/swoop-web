# Observability — event collection, error surfacing, spot-checks

How Puma's event stream is collected, where to look when something breaks, and how to trace a single conversation. Implements chunk F (collection layer) per [planning/03-exec-observability-c.md](../../../planning/03-exec-observability-c.md). Also serves as the **F.t4 spot-check runbook**.

> **Not covered here**: conversation *analysis* (the F.t6 council, dashboards). Deferred — this doc is about getting the already-emitted signal into a durable, queryable, alertable home.

---

## What gets emitted

Every load-bearing state transition emits a structured, schema-validated event via `emitEvent` (`@swoop/common`). 33 kinds across the stack — turn lifecycle, tool calls (`tool.called`/`tool.returned` orchestrator-side, `tool.invoked` connector-side), `triage.decided`, the `handoff.*` funnel, `consent.*`, session lifecycle + rehydration, `warm_pool.*`, `ui.widget_rendered` (incl. `:malformed`/`:silent` suffixes), and `error.raised`. **No PII**: message content is `{length, sha256}`, never text.

## Where they go — `EVENT_SINK`

One env var on **both** the orchestrator and connector selects the sink (registered at boot via `setEventSink`):

| `EVENT_SINK` | Destination | Use |
|---|---|---|
| `stdout` *(default)* | one JSON line per event to stdout | local dev |
| `postgres` | `INSERT` into `event_log` (migration 020), single store per C.18 | **demo Mini + any pre-GCP host** — durable, SQL-queryable today |
| `cloud-logging` | severity-tagged structured stdout, ingested by Cloud Logging | Swoop GCP prod |

Boot log confirms the active sink: `[orchestrator] event sink: postgres (...)` / `[connector] event sink: postgres`.

---

## Severity (drives error surfacing + alerts)

`severityForEvent` (`@swoop/common`) tags each event. Cloud Logging, Error Reporting and alert policies all key off it:

- **ERROR** — `error.raised`, `tool.invoked{ok:false}`, `tool.returned{outcome:error}`, `handoff.email.failed`, `handoff.retention.sweep.failed`, `session.replay.failed`.
- **WARNING** — `ui.widget_rendered{:malformed}`, `ui.session.rehydrate.failed`.
- **INFO** — everything else (normal lifecycle).

---

## Postgres mode — query cookbook (`event_log`)

When `EVENT_SINK=postgres` (the demo/dev path). Run against the same DB as the connector (`puma_dev` locally).

**Recent problems (the dev-team error view):**
```sql
SELECT ts, severity, event_type, session_id, event->'payload' AS payload
FROM event_log
WHERE severity <> 'INFO'           -- uses the partial index
ORDER BY ts DESC
LIMIT 50;
```

**Trace one conversation (the spot-check):**
```sql
SELECT turn_index, ts, event_type, severity, event->'payload' AS payload
FROM event_log
WHERE session_id = '<session-id>'
ORDER BY id;
```

**Tool-call funnel / latency:**
```sql
SELECT event_type,
       count(*),
       round(avg((event->'payload'->>'latencyMs')::numeric)) AS avg_ms
FROM event_log
WHERE event_type IN ('tool.called','tool.returned','tool.invoked')
GROUP BY 1;
```

**Handoff conversion shape:**
```sql
SELECT event->'payload'->>'verdict' AS verdict, count(*)
FROM event_log WHERE event_type = 'handoff.submitted' GROUP BY 1;
```

### Happy-path sequence (what a healthy single-turn conversation looks like)
`conversation.started` → `consent.granted` → `ui.conversation_opened` → `turn.received` → (`triage.decided`) → `tool.called` → `tool.invoked` → `tool.returned` → `ui.widget_rendered` → `turn.completed`. Absence of `turn.completed` after `turn.received`, or an `error.raised` / `tool.*{error}` in between, is the thing to investigate.

---

## Cloud Logging mode — the GCP flip (Swoop prod)

**Gated on the "AI Pat Chat" GCP IAM** (Thomas — see `questions.md`). No app change; one-time setup:

1. Enable the **Cloud Logging** + **Error Reporting** APIs on the project.
2. Grant the VM (or Cloud Run) service account `roles/logging.logWriter`.
3. **GCE VM**: install the [Google Cloud Ops Agent](https://cloud.google.com/logging/docs/agent/ops-agent) and configure its logging receiver to tail the orchestrator + connector stdout (or a redirected log file). **Cloud Run**: nothing — stdout is captured natively.
4. Set `EVENT_SINK=cloud-logging` in both services' env; restart.
5. Create a Cloud Monitoring **alert policy**: log-based condition `severity >= ERROR` (optionally filtered by `jsonPayload.eventType`), notification channel = dev-team email / Slack.
6. **Error Reporting** auto-aggregates the ERROR entries (grouped by the stable `message`) and emails on new/spiking errors — no extra config.

Verify (Log Explorer): `jsonPayload.eventType="error.raised"` returns entries with `severity=ERROR`; a forced tool failure shows up in Error Reporting within ~1 min.

---

## Forward-compatible (not wired here)

- **BigQuery** for analysis: a one-click Logs Router sink from Cloud Logging — the event schema is already export-ready (flat, typed, versioned).
- **`event_log` retention sweep**: a `DELETE … WHERE created_at < NOW() - INTERVAL '30 days'` fast-follow; the table is PII-safe so it's an ops-hygiene item, not compliance.
- **UI event collection**: `ui.*` events currently emit to the browser console only; a `POST /events` transport (Phase 2) would route them server-side.
