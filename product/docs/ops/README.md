# Ops runbooks

Operator-facing runbooks for Puma's data + retrieval surface. Each one targets a recurring operator task: re-run a pipeline, recover from a failure, manage migrations.

If you're new here, read [`troubleshooting.md`](troubleshooting.md) first to orient on the symptom map; then dip into the per-pipeline runbook that matches whatever you're about to do.

---

## Index

| Runbook | Start here when… |
|---|---|
| [`etl-rerun.md`](etl-rerun.md) | Swoop sent a fresh SQL dump, or the derived store needs to catch up to the live website. |
| [`embedding-rerun.md`](embedding-rerun.md) | After ETL re-runs; a classifier prompt changed; the agent's retrieval surface returns empty results. |
| [`sync-mode.md`](sync-mode.md) | Iterating on a classifier prompt / schema and you don't want to wait up to 24 h for Anthropic Batches. Dev-loop only. |
| [`image-annotation-rerun.md`](image-annotation-rerun.md) | New images arrived in the source dump; the image-annotation prompt changed; you're prepping the corpus before a demo. |
| [`migration-management.md`](migration-management.md) | A schema change is pending; boot complains about migrations; you need a full rebuild. |
| [`troubleshooting.md`](troubleshooting.md) | Something's wrong and you don't know which pipeline is at fault. Symptom-indexed. |
| [`prompt-version-rollback.md`](prompt-version-rollback.md) | A prompt-version bump produced bad outputs and you want to revert without burning the whole pipeline. |
| [`evalset-growth.md`](evalset-growth.md) | Friday afternoon: convert real Puma conversations into new harness scenarios. |
| [`handoff-retention-sweep.md`](handoff-retention-sweep.md) | Verifying the durable handoff store's per-verdict retention enforcement, or recovering when something looks off. |
| [`observability.md`](observability.md) | Events aren't landing anywhere queryable; wiring Cloud Logging / Error Reporting for prod; or tracing a single conversation by session id. |

---

## Conventions

- **Audience: role-based**. Each runbook addresses *the ETL operator*, *the harness owner*, etc. — never named individuals. Roles age better than names when staffing changes.
- **Operator-task shape**, not pipeline-architecture shape. Each runbook starts from *"what's the operator about to do?"*, not *"what does this pipeline contain?"*.
- **Paste-ready commands**. Every step has a one-liner you can copy. Every step has a *"you'll know it worked when…"* assertion.
- **Failure modes from real experience**. The "When things go wrong" sections cover failure modes that have actually been observed (or that are obvious-and-cheap to document — Postgres connection refused). New failures get appended when they happen.
- **Cross-link, don't repeat**. The ETL runbook references the migrations runbook for any schema-touching step; troubleshooting references the per-pipeline runbooks for deeper recovery. One source of truth per concept.

These are **living documents**. Iterate them as the system iterates. The runbooks live in `cms/`, not `planning/`, precisely because they're owned by the operations side eventually — Swoop's team can edit them post-handover.

---

## Where to look first

- **Boot or runtime failures**: [`troubleshooting.md`](troubleshooting.md).
- **Environmental traps** (Postgres.app paths, npm SIGTERM quirks, model IDs): `gotchas.md` at the repo root.
- **Architectural truths** (the eight intent-named tools, the five job-shaped derived tables, the page-as-hub pattern): `discoveries.md` at the repo root.
- **Decision rationale**: `planning/decisions.md`. Most runbook bodies link to the relevant `C.NN` decision.
