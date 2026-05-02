# Troubleshooting — symptom-indexed recovery guide

Operator-facing symptom map. When something's wrong and you don't know which pipeline is at fault, start here. Symptom first, diagnosis next, fix last. If your symptom isn't listed, escalate to Al.

---

## How to use this

Find your symptom below. Each entry covers what you're seeing, the most common cause, and what to do. Most fixes route into one of the per-pipeline runbooks (`etl-rerun.md`, `embedding-rerun.md`, `image-annotation-rerun.md`, `migration-management.md`) — go there for the deep recovery once you've narrowed the cause.

The runbooks here cover the operator's view, not the development view. If your symptom is *"the code is broken"* (a test fails, a TypeScript build doesn't compile), this isn't the right runbook — that's a development concern.

---

## "Connector won't boot"

The connector at `:3002` fails to start. You see one of:

### Symptom: `DATABASE_URL is required` / `DATABASE_URL invalid`

The connector enforces strict `DATABASE_URL` validation at boot — scheme allowlist (`postgres:` / `postgresql:`), database name in path. Misconfigured URLs fail fast.

Fix:
- Confirm `connector/.env` has a `DATABASE_URL` like `postgresql://al:pick-a-password@localhost:5432/puma_dev`.
- Confirm the URL has a database name in the path (after the port). A URL ending at `:5432/` with no DB name will be rejected.
- If you copied the URL from somewhere, watch for whitespace or a trailing newline.

### Symptom: `connection refused` / `ECONNREFUSED 127.0.0.1:5432`

Postgres isn't running.

Fix:
- Open Postgres.app from the menubar; start the cluster.
- Confirm `puma_dev` exists: `/Applications/Postgres.app/Contents/Versions/latest/bin/psql -l | grep puma_dev`.
- If the database doesn't exist, run the bootstrap one-liner from `gotchas.md` "Local Postgres is Postgres.app v18".

### Symptom: `extension "vector" is not available`

`pgvector` not installed.

Fix:
```bash
PG=/Applications/Postgres.app/Contents/Versions/latest/bin
$PG/psql -d puma_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Symptom: connector boots but `/readyz` returns 503

Pool isn't healthy or migrations haven't applied.

Fix:
- Run `npm run migrate:up --workspace @swoop/connector` and check the output.
- Hit `/healthz` — if it's 200 but `/readyz` is 503, the pool can't reach Postgres. Check `DATABASE_URL` and the Postgres instance state.

### Symptom: port `:3002` already in use

Stray connector or another process is bound to the port.

Fix: `lsof -i :3002` to find the process, then `kill <pid>`. If it's a zombie tsx process from a previous `npm run dev`, see "npm dev SIGTERM doesn't kill tsx" below.

---

## "Orchestrator can't reach connector"

`/chat` requests fail with connector-side errors. The orchestrator is up; it's the connector or the wire between them.

### Symptom: orchestrator logs `connector unreachable` / `MCP connection failed`

The connector isn't running, or it's running but not on `:3002` where the orchestrator expects it.

Fix:
- `curl http://localhost:3002/healthz` from your terminal. 200 means the connector is up; anything else means it's not.
- Check `MCP_CONNECTOR_URL` in the orchestrator's env (defaults to the local connector URL).
- If the connector is up but `/readyz` is 503, see "Connector won't boot — `/readyz` returns 503" above.

### Symptom: connector logs but orchestrator times out on tool calls

The connector is healthy in isolation but slow under orchestrator load. Possible causes:

- Postgres pool exhausted. Check the pool config (`PG_POOL_MAX` env or the constants in `product/connector/src/db.ts`).
- Slow query on a missing index. Check Postgres `pg_stat_statements` for slow queries; check the relevant migration covers the index.

Escalate to Al if the symptom persists.

---

## "Tool calls returning empty results"

The agent invokes a tool, the tool returns successfully, but the response is empty (`{ rows: [] }` or similar). Three common causes:

### Cause 1: derived tables empty

The eight intent-named tools query the **derived job-shaped tables** (`inspire_passage`, `customer_story`, etc.) — not the domain tables directly. If the derived tables are empty, even a freshly-ETL'd domain layer returns nothing.

Diagnosis: run the derived-table spot-check from `embedding-rerun.md` step 3.

Fix: re-run the embedding pass — `npm run enrich --workspace @swoop/ingestion -- --mode=all`. The compose step populates the derived tables.

### Cause 2: embeddings missing

Vector retrieval needs populated embeddings. If the rows exist but `embedding IS NULL`, retrieval scores at zero and returns nothing.

Diagnosis: run the embedding-presence query from `embedding-rerun.md` step 3.

Fix: `npm run enrich --workspace @swoop/ingestion -- --mode=embed`.

### Cause 3: filter mismatch

The tool's filter narrows further than the corpus has rows for (e.g. `region=tierra-del-fuego` and the corpus has no rows tagged for that region). Look at the tool's input args; check whether a broader filter returns rows.

Fix: this is usually content-side, not pipeline-side. Either widen the user's query, or accept that the corpus genuinely lacks data for that intersection.

---

## "ETL took longer than expected"

The local fixtures should ETL in ~10s. If a run takes minutes:

### Symptom: dump file is huge / on a network drive

Move the dump to local disk before running.

### Symptom: Postgres pool config too tight

Per-connection state (e.g. `statement_timeout`) is set via libpq `options` (decision: see `discoveries.md` 2026-05-01). If it's too aggressive, batched inserts may hit the timeout. Loosen `PG_STATEMENT_TIMEOUT_MS` in the connector's env.

### Symptom: `DATABASE_URL` points at a far-away Cloud SQL

Sanity-check `DATABASE_URL`. Local dev should always be `localhost:5432`. If you're talking to Cloud SQL by accident, the round-trip time dominates.

### Symptom: ETL hangs

Probably stuck on a connection or a large transaction. Kill it (`Ctrl+C`), check `pg_stat_activity` in Postgres for stuck queries, then `dropdb`/`createdb` and start fresh per `migration-management.md` "Recovery — full rebuild from scratch".

---

## "Vision pipeline burned through budget"

The image-annotation run spent more than expected.

### Symptom: spend went over `--max-budget`

The cap is enforced at batch boundaries — small overruns within a single batch are possible. If the overrun is material (more than ~5%), check that the budget tracker is wired right (`product/ingestion/src/images/cost.ts`).

### Symptom: spend much higher than dry-run estimated

The dry-run is an estimate; actual cost can drift if Vision returns more output tokens than the estimate's per-image average. Soft warning at £5 (for the embedding-rerun pipeline; image annotation uses a USD `--max-budget` instead).

If the drift is consistent, recalibrate the estimate constants in the cost helper.

### Symptom: spend approaching cap, want to stop now

Send `Ctrl+C`. The runner stops, the checkpoint preserves what's done, the next invocation resumes from there.

---

## "Migration fails halfway"

A migration partly applied; the schema is in an in-between state.

Recovery is **rebuild, not rollback** (decision **C.31**). See `migration-management.md` "Recovery — full rebuild from scratch" for the exact commands.

Don't try to hand-repair the schema unless you really know what you're doing — re-running an idempotent migration on a half-state should work, but if it doesn't, rebuild.

---

## "Tests fail with stale node_modules"

Tests pass locally for someone else but fail for you with cryptic module-resolution errors or hooks failing in a way that doesn't match the source.

Cause: out-of-sync `node_modules` after a `git pull` that bumped dependencies. The "false-green" lesson — old `node_modules` plus new package.json gives you confident-looking success that doesn't match reality.

Fix:
```bash
rm -rf node_modules
npm install
```

Run the failing test again. If it still fails, the failure is real — not a tooling artefact.

This is non-negotiable after any merge that touches `package.json` / `package-lock.json`.

---

## "npm dev SIGTERM doesn't kill tsx"

You ran `npm run dev` then `Ctrl+C` (or `kill <npm-pid>`); the npm process exits but the underlying `tsx` survives. Port stays bound; subsequent runs fail with "port in use" or "database in use".

Cause: npm spawns `tsx` as a child and doesn't propagate signals reliably. The tsx child gets reparented to PID 1 instead of dying.

Fix: send SIGTERM to the tsx process directly:

```bash
ps aux | grep tsx | grep -v grep
kill -TERM <tsx-pid>
```

Or invoke tsx directly bypassing npm: `node --import tsx ./src/server/index.ts` from the workspace root.

Production isn't affected — Cloud Run sends SIGTERM to PID 1 directly, no npm wrapper.

Documented in `gotchas.md` "npm shell wrapper doesn't propagate SIGTERM".

---

## "I don't know what's wrong, where do I look?"

In order of usefulness:

1. **Connector logs** — boot errors, request errors, pool warnings. Today this is stdout in dev; post-M4 deploy it's Cloud Logging filtered by service.
2. **Orchestrator logs** — agent loop, tool-call failures, session state.
3. **Postgres logs** — slow queries, FK violations, lock waits. Postgres.app's log lives at `~/Library/Application Support/Postgres/var-18/postgresql.log`.
4. **The pipelines' output** — ETL, embedding, image-annotation runs all print structured progress and tally counts at the end. Re-read.
5. **`gotchas.md` at the repo root** — environmental traps that have bitten before.
6. **`discoveries.md` at the repo root** — non-obvious architectural truths.

If none of those help, escalate to Al with:
- The symptom (one sentence).
- What you ran (the exact command).
- The full output (paste the error block, not a paraphrase).
- What you've already tried.

---

## Cloud Logging vs stdout

Today Puma runs locally with stdout-and-tail. Post-M4 deploy, logs land in Cloud Logging.

In dev, the runbook references in this file mean *"watch the terminal where the service is running"*. Post-M4, swap that for the appropriate Cloud Logging filter. Filter by service name (`connector` / `orchestrator` / ingestion job names) and time window first; further narrow by `severity>=ERROR` for the obvious failures.

Decision **C.45** records this: Cloud Logging post-M4, stdout in dev.

---

## Open items for Al

1. **Cloud Logging filter cookbook**. Once Cloud Logging is wired, write a *"common queries"* section here — *"all errors in last hour"*, *"connector boot failures"*, *"slow ETL runs"*.
2. **Sentry / alert routing**. Whether a separate alerting layer beyond Cloud Logging makes sense for M5+ is open.
3. **Performance baselines**. *"How long should a fresh ETL take?"* / *"How long should a healthy chat turn take?"* — calibrate on prod data and document numbers here.

---

## Where the rules came from

- Decision **C.31** — forward-only migrations.
- Decision **C.45** — monitoring lives in Cloud Logging post-M4 (stdout in dev).
- `gotchas.md` — environmental traps, npm SIGTERM, dotenv override, Postgres.app paths.
- `discoveries.md` 2026-05-01 — libpq startup options for pool tunables.
