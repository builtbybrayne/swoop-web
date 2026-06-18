# Puma — maintenance (run & evolve)

Ongoing operation of the Puma backend once it is live. First-time stand-up is in [`productionisation.md`](productionisation.md); per-task recipes live in [`../docs/ops/`](../docs/ops/README.md) and this doc sequences and points at them.

---

## Routine operations

- **Data refresh** — Swoop sends a periodic (weekly during M1–M5) SQL dump. Re-run ETL → enrich → embed to bring the derived store current: [`../docs/ops/etl-rerun.md`](../docs/ops/etl-rerun.md) then [`../docs/ops/embedding-rerun.md`](../docs/ops/embedding-rerun.md). Use [`../docs/ops/sync-mode.md`](../docs/ops/sync-mode.md) for fast dev loops. The content-hash **embedding cache** means unchanged content re-embeds for free. Image annotations: [`../docs/ops/image-annotation-rerun.md`](../docs/ops/image-annotation-rerun.md).
- **Schema / migrations** — forward-only, zero-padded; never edit a shipped migration. [`../docs/ops/migration-management.md`](../docs/ops/migration-management.md).
- **Prompt / content updates** — everything the agent says is **content-as-data** under [`../cms/`](../cms) (system prompt `prompts/system/`, skills `prompts/skills/`, tool descriptions `prompts/tools/`, legal copy `legal/`). Edit + restart (prod) / hot-reload (dev); no rebuild. Roll back a bad prompt version: [`../docs/ops/prompt-version-rollback.md`](../docs/ops/prompt-version-rollback.md).

## Observability & incident response

- **Errors → the dev team**: Cloud Error Reporting + the `severity≥ERROR` alert policy (stood up in productionisation §6). Queries, the happy-path event sequence, and the per-conversation spot-check: [`../docs/ops/observability.md`](../docs/ops/observability.md).
- **Symptom map** when you do not yet know the cause: [`../docs/ops/troubleshooting.md`](../docs/ops/troubleshooting.md).
- **Deep diagnosis**: the `puma_session_event` table (migration 016) holds the full ADK transcript per session — every tool call with args + results, queryable with plain SQL. This is the first instrument to reach for; it needs no service boot.

## Retention & compliance

- **Handoff retention** (visitor PII, per-verdict windows): [`../docs/ops/handoff-retention-sweep.md`](../docs/ops/handoff-retention-sweep.md). Enable `HANDOFF_RETENTION_SWEEP_ENABLED=true` in prod.
- **`event_log` retention**: add a `DELETE … WHERE created_at < NOW() - INTERVAL '30 days'` sweep (fast-follow; the table is PII-safe — lengths + hashes only).
- **Consent-copy versioning + data-subject requests** (access / rectification / erasure): the compliance bundle ([`../cms/legal/compliance-bundle/`](../cms/legal/compliance-bundle)) + [`../../planning/swoop-legal-review-pack.md`](../../planning/swoop-legal-review-pack.md).

## Runtime & dependencies

- **Node 20** (`.nvmrc`); npm workspaces (`@swoop/*`). Build/typecheck/test from `product/`.
- **Environmental traps** (model IDs with wrong date suffix → 404, `dotenv override`, Postgres.app paths, Gemini 429s, `CONNECTOR_PORT` vs `PORT`): [`../../gotchas.md`](../../gotchas.md) — read before debugging a "weird" failure.
- **Model IDs** are pinned in orchestrator config; bump deliberately when Anthropic publishes new Sonnet/Haiku ids (verify the exact id — see gotchas.md).

## Scaling

- **Single-VM is the default**; promote to Cloud SQL + Cloud Run only if real load demands it ([planning/01-top-level.md](../../planning/01-top-level.md) §9). The DB footprint is small (~hundreds of MB).
- The **`pg_dump` → `pg_restore`** recipe ([`../../discoveries.md`](../../discoveries.md) 2026-05-21) is the migration path between machines/instances (laptop → Mini → GCE → Cloud SQL), `halfvec` and the embedding cache included.
- **Cost**: ~£0.05–0.25 of Claude API per conversation; watch via the event stream / Anthropic console.

## Known gaps / not production-hardened

- **Rate limiting / abuse caps** — deferred (Tier-1 out-of-scope); add per-IP/session token buckets on `/session`, `/chat`, `/handoff/submit` before heavy public exposure.
- **UI event collection** — `ui.*` events (incl. the `:malformed` widget telemetry) emit to the browser console only; a `POST /events` transport (F-c Phase 2) would collect them server-side.
- **Conversation analysis (F.t6)** — the qualitative "why behind the booking" layer is not built; deferred pending Swoop's "what to learn" + a legal retention-of-derivatives decision.
- **Message text in logs** — events carry lengths + hashes, not text, so non-handoff conversations have no recoverable transcript (open in `questions.md`).
