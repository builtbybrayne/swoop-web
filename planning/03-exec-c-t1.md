# 03 — Execution: C.t1 Connector service skeleton + Postgres pool wiring

**Status**: **HITL-ratified 2026-05-01 — ready for execution.**
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §10 — the **C.t1** task ("Connector service skeleton + Postgres setup"). Stands up the runtime substrate the rest of chunk C plugs into.
**Depends on**: A.t1–A.t5 (workspace, `ts-common` scaffold, decision log); C.t0 closed (dump understood, ontology rewritten); C.t2 closed (migrations 001–006 + Zod tool schemas authored — `product/connector/migrations/` exists; nothing to migrate against without a pool); decisions C.18 (Postgres 18 + pgvector + tsvector + pg_trgm), C.21 (SQL dump → Cloud SQL Postgres), C.31 (forward-only `node-pg-migrate`); the local Postgres bootstrap captured in `gotchas.md` ("Local Postgres is Postgres.app v18…").
**Blocks**: C.t3 (`export.sql` writes through the pool authored here); C.t3a (embedding pass + Haiku ETL classifiers — same pool); C.t4 (eight tool handlers run on top of the data primitives this task exposes); C.t8 (handover runbook documents the operating shape this task settles).
**Produces**:
- A runnable `@swoop/connector` service skeleton — Express + `@modelcontextprotocol/sdk` over HTTP, `/healthz` + `/readyz` endpoints, no tools registered yet.
- A Postgres `Pool` singleton wired to `DATABASE_URL`, with defensible defaults (max connections, idle timeout, statement timeout) and a clean shutdown path on `SIGTERM`.
- A `data/` primitives sub-tree with the connection-acquiring helper that every future SQL/vector primitive will use — but **no primitives implemented yet** (those are C.t3a + C.t4's call).
- A migration runner wired to `node-pg-migrate` reading `product/connector/migrations/`. One npm script (`migrate:up`); migrations remain plain SQL files, forward-only per C.31.
- Config schema additions (Zod) for the connector's runtime: `DATABASE_URL`, `CONNECTOR_PORT`, pool tunables (`PG_POOL_MAX`, `PG_POOL_IDLE_MS`, `PG_STATEMENT_TIMEOUT_MS`).
- `.env.example` for the connector workspace (currently absent — the orchestrator's `.env.example` covers its own surface; the connector hasn't needed one until now).
- Tests: pool boot/shutdown, healthz/readyz, migration-runner smoke, config-schema validation.
- Stub-replace work: `product/orchestrator/test-fixtures/stub-connector.ts` continues to back the orchestrator until C.t4 lands. **C.t1 does NOT remove the stub** — that's C.t4 / B.t3a's call.
- Decision log entries (`planning/decisions.md`) for any pool-config or transport-shape calls taken during execution that aren't already settled.
**Estimate**: ~0.5 day focused work. Greenfield but small — the surface is "stand up a Postgres-backed Express service with a single migration script". Most of the cost is in *not* over-building (no tools yet, no primitives yet, no real MCP surface yet).

---

## ★ Read this first — the WHY of chunk C

> **Before you author a `Pool` config or sketch a `data/` directory, read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"★ Read this first — the WHY of chunk C" end-to-end.** That section names the agent's actual job, the four+1 jobs the data does for it, and the design discipline (top-down from sales, never bottom-up from data) that grounds every choice in this chunk. C.t1 is the layer where bottom-up reasoning is most tempting — there's no conversational arc to anchor against, just plumbing — but the plumbing decisions ripple. *"Should the pool default to 20 connections because Cloud SQL `db-f1-micro` likes that"* is the right shape of question; *"let's add a generic data-primitive abstraction layer because the data could be queried lots of ways"* is bottom-up creep dressed up as flexibility.

The compressed reminder for C.t1 specifically:

- **C.t1 is foundational, smallest, fastest.** Per [next-steps.md](../next-steps.md) §0: ~0.5 day, stub-replace work for `product/connector/`. Don't accrete scope. If a sub-decision feels load-bearing for downstream, surface it as an open question rather than silently locking it.
- **The connector's reason to exist post-composer (C.24)**: MCP-over-HTTP service that owns the Postgres pool, hosts tool handlers, hosts data primitives, and delivers handoff email. C.t1 stands up the *first three architectural concerns* (service shell, pool, data-primitives directory) but only the shell *runs* — primitives and tools come later.
- **No tools in this task.** The MCP server is registered with zero tools (or, at most, a `noop` ping tool). Tool registration is C.t4. If you find yourself reaching for `@swoop/common` `TOOL_NAMES`, you've drifted into the wrong task.
- **No primitives in this task.** `data/` exists with one file: `pool.ts`. Primitives that wrap the pool come in C.t3a + C.t4. If you find yourself authoring `hybrid_search_inspire`, you've drifted.
- **The stub connector keeps backing the orchestrator until C.t4.** This task does not touch `product/orchestrator/test-fixtures/stub-connector.ts` or `product/orchestrator/src/connector/tools.ts`. The wire-up swap happens in B.t3a, gated on C.t4. Resist the temptation to "just point the orchestrator at the new service" — the new service has no tools to serve.
- **If you find yourself reasoning "we should expose data X over MCP", stop.** The MCP surface is settled by C.t2 (eight intent-named tools, schemas in `@swoop/common/tools.ts`). C.t1's job is to stand up the *vehicle* the surface will run on, not to decide the surface.

---

## Purpose

C.t1 stands up the *runtime substrate* every other chunk-C task plugs into. Today, `product/connector/` is a workspace that ships handoff side-effects only (mailer + `FsHandoffStore` + `submitHandoff` for chunk E). It has migrations 001–006 sitting on disk (from C.t2) but nothing in the workspace knows how to apply them; it has a planned MCP surface (eight tools per C.25) but no MCP server bound to a port; it has a Postgres database (`puma_dev`) bootstrapped by an earlier session but no connection pool open against it.

This task closes that gap with the smallest possible artefact: a service that boots, opens a pool, exposes liveness + readiness, applies migrations on demand, and is ready to host tools and primitives as later C.t* tasks land. **The whole point is to stop here** — not to build the eight-tool surface, not to author primitives, not to swap the orchestrator off the stub. Each of those has its own task downstream.

The pool is the load-bearing artefact. C.t3 will write through it; C.t3a will batch-update through it; C.t4 will read through it on every tool call. Defaults set here propagate. Surface them as *settled with rationale* (in this plan) or *flagged as open* (in §"Open questions") so the executing agent doesn't quietly inherit decisions that should be reviewed.

---

## Out of scope

Naming the things this task does *not* do, so future agents (and the executing agent itself) don't drift:

- **No tool registration.** No `find_inspiring`, no `find_options`, no `lookup`, no anything from `TOOL_NAMES`. The MCP server boots empty (or with one no-op ping tool — see §"Open questions" Q4).
- **No data primitives.** `src/data/pool.ts` exists with the pool singleton. `src/data/<primitive>.ts` files do not. `hybrid_search_inspire`, `query_trips_by_filter`, `resolve_image_set`, `find_tags_by_utterance`, `fetch_trip_detail`, `fetch_pricing_band`, `find_locations` — all C.t3a + C.t4.
- **No `export.sql`.** That's C.t3.
- **No embedding pass, no Haiku classifiers.** C.t3a.
- **No tool description registration from `cms/prompts/tools/`.** C.t4 wires that loader; C.t1 doesn't touch CMS.
- **No orchestrator-side rewiring.** `product/orchestrator/test-fixtures/stub-connector.ts` and `product/orchestrator/src/connector/tools.ts` are untouched. The orchestrator continues to call the stub. B.t3a does the swap when C.t4 lands.
- **No Cloud SQL provisioning, no Cloud Run deployment.** Local-only at this stage. Cloud Run + IAM + Cloud SQL provisioning belongs to M4 (post-Thomas IAM grant).
- **No Docker Compose Postgres.** The local dev DB is Postgres.app v18 + `puma_dev` per `gotchas.md`. The Tier 2 plan §1 ("Postgres-in-Docker locally for parity") is real but deferred to pre-M5 ship per Tier 2 chunk C §2.5. C.t1 ships against the existing Postgres.app setup.
- **No `Postgres SessionService` work** (B.2 post-M4 upgrade). The pool is connector-internal; the orchestrator's session store stays in-memory.
- **No `PostgresHandoffStore` swap** (E.t2 proper). The connector continues to use `FsHandoffStore` for handoffs; the new pool is for the data-side surface that lands in C.t3+. (See §"Open questions" Q5 — should the handoff store reuse this pool now or stay file-backed until E.t2 proper?)
- **No connector auth between orchestrator and connector.** Tier 2 §7 marks it as "revisit at deploy". Local dev runs over plain HTTP on `localhost`.
- **No removal of deprecated `Search*` / `GetDetail*` Zod schemas.** B.t3a's call.

---

## Inputs (files to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) — especially §"Read this first", §2.3 (tool implementation pattern), §2.4 (data primitives — note what's NOT being authored here), §3 (architectural principles), §10 (where C.t1 sits in the dependency graph).
- [`03-exec-c-t2.md`](03-exec-c-t2.md) — for the migrations layout and the `node-pg-migrate` convention recorded under C.31.
- [`decisions.md`](decisions.md) — C.18 (Postgres 18 + extensions), C.21 (SQL-dump → Postgres canonical pipeline), C.31 (forward-only migrations + zero-padded prefix), C.4 (MCP-over-HTTP transport carries forward).
- [`gotchas.md`](../gotchas.md) — "Local Postgres is Postgres.app v18, not 16" (the bootstrap walkthrough), "Claude Code injects an empty `ANTHROPIC_API_KEY`" (the `loadDotenv({override: true})` pattern; same fix needed for `DATABASE_URL` if the shell ever pre-sets it empty), "`@google/adk` 1.0 bundles its own `zod`" (the connector won't import ADK so probably not relevant — but note before designing).
- [`progress.md`](../progress.md) snapshot — confirm `puma_dev` is live and migrations 001–006 are applied to a fresh test DB but `puma_dev` is deliberately untouched.
- `product/connector/src/index.ts` (current public surface — handoff exports only).
- `product/connector/migrations/` (six SQL files — the schema this task's pool will eventually serve).
- `product/orchestrator/src/index.ts` — the working pattern for `loadDotenv({ override: true })`, config loading, server boot. The connector's `index.ts` should follow the same shape.
- `product/orchestrator/src/config/schema.ts` — the working pattern for Zod-validated env config with cross-field refines. The connector gets its own (smaller) version.
- `chatgpt_poc/product/mcp-ts/src/` — PoC MCP server pattern. The Express + `@modelcontextprotocol/sdk` shape carries forward. **Reference only — do not modify.**

---

## Outputs (files to write/modify, with paths)

### Connector workspace structure

```
product/connector/
├── package.json                       # adds: pg, node-pg-migrate, express, @modelcontextprotocol/sdk
├── .env.example                       # NEW — DATABASE_URL, CONNECTOR_PORT, pool tunables
├── migrations/                        # already exists — six SQL files from C.t2
├── src/
│   ├── index.ts                       # CHANGED — also export the service entry + pool factory
│   ├── server/
│   │   ├── index.ts                   # NEW — boot Express, register MCP server, wire health endpoints
│   │   ├── health.ts                  # NEW — /healthz + /readyz handlers
│   │   └── __tests__/
│   │       └── health.test.ts         # NEW
│   ├── data/
│   │   ├── pool.ts                    # NEW — singleton pg.Pool wired to DATABASE_URL + tunables
│   │   └── __tests__/
│   │       └── pool.test.ts           # NEW — boot/shutdown round-trip
│   ├── config/
│   │   ├── schema.ts                  # NEW — Zod env schema (mirrors orchestrator pattern)
│   │   ├── load.ts                    # NEW — loadConfig() with dotenv override:true
│   │   └── __tests__/
│   │       └── schema.test.ts         # NEW
│   ├── migrate.ts                     # NEW — thin wrapper around node-pg-migrate; npm script entry
│   └── handoff/                       # UNCHANGED — existing E.t2/t3 surface
└── tsconfig.json                      # UNCHANGED
```

### `package.json` additions

New dependencies:
- `pg` (latest stable) — the connection pool driver.
- `@types/pg` (devDependency).
- `node-pg-migrate` (latest stable) — the migration runner. Per C.31.
- `express` (latest stable) — HTTP transport. Same pattern as the orchestrator.
- `@types/express` (devDependency).
- `@modelcontextprotocol/sdk` (latest stable matching what the orchestrator already uses) — MCP-over-HTTP transport. Per C.4.

New scripts:
- `start` — boot the connector service (`tsx src/server/index.ts`).
- `dev` — boot with watch (`tsx watch src/server/index.ts`).
- `migrate:up` — run forward migrations (`node-pg-migrate up -m migrations -f sql`).
- (Optional, see Q3) `migrate:status` — list applied vs pending migrations.

### `.env.example`

Authoritative env surface for the connector workspace. Keys (all defaulted-to-local-dev where safe):

```
# Postgres connection — local dev points at Postgres.app puma_dev (gotchas.md).
# Prod (post-M4): Cloud SQL via Unix socket or proxy; Secret Manager-fed.
DATABASE_URL=postgresql://al:pick-a-password@localhost:5432/puma_dev

# HTTP port the connector binds to. Stays out of the orchestrator's :8080
# and the UI's :5173.
CONNECTOR_PORT=3002

# Postgres pool tunables. Defaults are conservative; revisit at C.t8 handover
# under real load.
PG_POOL_MAX=10
PG_POOL_IDLE_MS=30000
PG_STATEMENT_TIMEOUT_MS=10000
```

(Port `3001` is taken by the existing stub connector; the new service binds `3002` so the two coexist in dev. See §"Open questions" Q6.)

### `src/config/schema.ts`

Zod schema mirroring `product/orchestrator/src/config/schema.ts` shape:

- `DATABASE_URL` — required, must parse as a `postgres://` or `postgresql://` URL. No default (fail fast at boot).
- `CONNECTOR_PORT` — coerced number, default `3002`.
- `PG_POOL_MAX` — coerced number, default `10`, min 1, max 100.
- `PG_POOL_IDLE_MS` — coerced number, default `30000`.
- `PG_STATEMENT_TIMEOUT_MS` — coerced number, default `10000`, min 1000.
- `NODE_ENV` — enum `["development", "test", "production"]`, default `"development"`.

### `src/data/pool.ts`

A single function `getPool()` returning a memoised `pg.Pool` configured from `loadConfig()`. Properties:

- Created lazily on first call.
- One pool per process; subsequent calls return the same instance.
- `idleTimeoutMillis = config.PG_POOL_IDLE_MS`, `max = config.PG_POOL_MAX`.
- `statement_timeout` set per-connection via `application_name` + a `pool.on('connect', client => client.query(\`SET statement_timeout = ${ms}\`))`.
- `application_name = 'swoop-connector'` so `pg_stat_activity` is readable in prod.
- Exported helper: `closePool()` calls `pool.end()` and clears the cache. Wired to the server's `SIGTERM` handler.
- Exported helper: `withPgClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>` — borrow-and-release pattern. Every future primitive will go through this.

### `src/server/health.ts` + `src/server/index.ts`

- `/healthz` — process is alive. Returns `200 {status: "ok"}` synchronously. No DB call.
- `/readyz` — process can serve traffic. Returns `200 {status: "ready", db: "ok"}` if `SELECT 1` against the pool succeeds within 1s; `503 {status: "not_ready", db: "<error>"}` otherwise. (Liveness vs readiness split is standard Kubernetes / Cloud Run pattern; matters once we deploy.)
- MCP server registered with **zero tools** (or one no-op ping tool — see Q4). The transport binding follows the PoC `mcp-ts/src/server.ts` shape.
- `SIGTERM` handler: call `closePool()`, close the HTTP server, exit cleanly.

### `src/migrate.ts`

Thin script that invokes `node-pg-migrate`'s programmatic API against `migrations/` with `direction: 'up'`, reading `DATABASE_URL` via the same `loadConfig()`. Used by the `npm run migrate:up` script. Plain SQL files; no DSL.

### Tests

- `src/config/__tests__/schema.test.ts` — happy path + each required-field error path. Same shape as orchestrator tests.
- `src/data/__tests__/pool.test.ts` — boot, run `SELECT 1`, shutdown. Marked as integration (skipped if no `DATABASE_URL` env var).
- `src/server/__tests__/health.test.ts` — `/healthz` always 200; `/readyz` 200 when pool is up, 503 when pool query fails (mock the pool).

### Decision log entries (likely candidates)

- **C.35** *(if needed)* — Connector port assignment (`3002` chosen so the stub and new service can coexist during the C.t1→C.t4 transition; revisit when stub retires).
- **C.36** *(if needed)* — Pool config defaults (max 10, idle 30s, statement timeout 10s) and rationale.
- **C.37** *(if needed)* — Two no-overlap concerns: handoff store keeps `FsHandoffStore` until E.t2 proper; new pool is data-side only. Worth recording so a future agent doesn't merge the two prematurely.

(All optional — only land them if the executing agent actually settles those calls during execution. If §"Open questions" closes them HITL-side first, no decision log entry is needed.)

---

## Sub-step ordering (within this task)

Recommended sequence for a single execution agent:

1. **Read the inputs (§"Inputs" above) end-to-end.** Especially the chunk-C ★ section and the C.t2 plan's migration convention.

2. **Author config schema + loader.** `src/config/schema.ts` + `src/config/load.ts`. Tests pass against happy path + each missing-field path.

3. **Author the pool singleton.** `src/data/pool.ts` with `getPool()`, `closePool()`, `withPgClient()`. Local smoke: import in a one-shot script, `SELECT 1`, exit cleanly.

4. **Author health endpoints + server boot.** `src/server/health.ts` + `src/server/index.ts`. MCP server registered empty (or with the ping tool, depending on Q4). SIGTERM closes the pool. Smoke: `npm run dev`, hit `/healthz` and `/readyz`, see green.

5. **Wire the migration runner.** `src/migrate.ts` + `npm run migrate:up`. Smoke: drop a fresh test DB, run `migrate:up`, verify all 6 migrations apply and tables exist.

6. **Update `package.json`.** Dependencies + scripts. `npm install` from `product/`.

7. **Update `src/index.ts`.** Re-export the service entry + pool factory + config loader for any future caller (e.g. C.t3's CLI may want to import the pool rather than open its own).

8. **`.env.example`** authored.

9. **Tests pass.** `npm test --workspace @swoop/connector` green. Existing 46 handoff tests still pass; new tests for config + pool + health add to that count.

10. **Take and log decisions.** Any C.35 / C.36 / C.37 entries that the executing agent settled rather than left open.

11. **Append an Execution log section** to this Tier 3 plan summarising what landed, what was deferred, what surfaced for downstream tasks (especially: any pool-config or transport-shape calls that should propagate into C.t3 / C.t4 / C.t8).

---

## Verification

Task is done when:

1. `cd product && npm install` is clean (no peer-dep warnings introduced beyond the existing baseline).
2. `cd product && npm run typecheck` is green across the workspace.
3. `cd product && npm test --workspace @swoop/connector` passes (existing 46 + new ones).
4. `cd product/connector && npm run start` boots; `curl localhost:3002/healthz` returns `{"status":"ok"}`; `curl localhost:3002/readyz` returns `{"status":"ready","db":"ok"}` against `puma_dev`.
5. `cd product/connector && npm run migrate:up` applies migrations 001–006 to a fresh test DB cleanly. Re-running is a no-op (idempotent forward-only per C.31). **Do not run against `puma_dev`** — that's C.t3's job (per [next-steps.md](../next-steps.md): "`puma_dev` deliberately untouched (that's C.t3's job to populate)").
6. The MCP server registers zero tools (or one ping tool) and responds to a discovery call without error.
7. SIGTERM cleanly closes the pool (verified by killing the dev process and watching the logs).
8. The orchestrator continues to run against the existing stub at `:3001`. **Verify by running both side by side**: orchestrator at `:8080`, stub at `:3001`, new connector at `:3002`. The orchestrator's behaviour is unchanged.
9. `product/connector/.env.example` exists with all keys documented.
10. The orchestrator's `product/orchestrator/test-fixtures/stub-connector.ts` is **untouched**. The orchestrator's `product/orchestrator/src/connector/tools.ts` is **untouched**.
11. Execution log appended to this plan.

---

## Open questions

These are the ones the executing agent should NOT silently decide. Surface them; HITL closes them before / during execution.

### Q1. pg `Pool` config defaults — defensible for our load profile?

The §"Outputs" section above proposes `max: 10`, `idle: 30s`, `statement_timeout: 10s`. Reasoning:

- **`max: 10`** — Cloud SQL `db-f1-micro` supports ~25 concurrent connections; with one connector instance + the eventual `Postgres SessionService` (B.2 post-M4) + the `PostgresHandoffStore` (E.t2 proper) all sharing that headroom, 10 leaves slack. Local Postgres.app caps higher; this is the prod-aware ceiling.
- **`idle: 30s`** — keeps connections warm during a conversation burst, releases them between visitors. Default in `pg` is 10s; we want longer because tool calls cluster.
- **`statement_timeout: 10s`** — agent-facing tool calls should never run that long; HNSW + GIN with our scale should respond in <500ms typical. 10s is the "something is very wrong, kill it" backstop.

**Open**: are these the right ceilings? Specifically:
- Should `max` be lower (5)? Higher (20)? Cloud Run instances scale horizontally — N instances × 10 connections — so the multiplier matters once we're concurrent on prod.
- Should `statement_timeout` differ for ETL paths (C.t3 + C.t3a) vs runtime paths (C.t4)? ETL is happy to wait minutes; runtime should fail fast. C.t1 sets a single default; ETL paths can override per-connection if needed (worth flagging in the plan so C.t3 doesn't silently inherit the wrong ceiling).

### Q2. Migration runner — `node-pg-migrate` is locked per C.31, but where does it live and who runs it?

C.31 settles the *what* (plain SQL, forward-only, zero-padded prefix). C.t1 settles the *how*:

- **Where the runner lives**: `product/connector/src/migrate.ts` per the §"Outputs" above. Executable via `npm run migrate:up` from `product/connector/`.
- **When it runs**: open question. Three options:
  - **(a) Manual only** — operator runs `npm run migrate:up` between deploys. Simple. Risks: someone forgets; CI doesn't catch.
  - **(b) On boot** — `src/server/index.ts` runs migrations before binding the HTTP port. Risks: deploy-time race with concurrent instances; long migrations stall startup; rollback is awkward.
  - **(c) Separate Cloud Run Job** (post-M4) — invoked from CI / by Thomas. Cleanest for prod. Local dev still uses `npm run migrate:up`.

  Recommendation: **(a) for C.t1**, **(c) for M4**. Surface (b) as explicitly rejected.
- **Migrations table**: `node-pg-migrate` defaults to `pgmigrations`. Confirm we're happy with that name (or rename to `_migrations` to keep the underscore-prefix convention some teams prefer).

### Q3. Where do data primitives live in this skeleton?

§"Outputs" places `pool.ts` under `src/data/`. The Tier 2 plan §2.4 names ten primitives that will eventually populate that directory. C.t1 ships `pool.ts` *and the directory it lives in*, but no primitives.

**Open**: should C.t1 also ship a `src/data/README.md` or a `_template.ts` that codifies the per-primitive pattern (typed function, takes a `PoolClient` or borrows via `withPgClient`, returns Zod-parsed rows)? Pro: future primitives stay shape-consistent without C.t3a / C.t4 each re-inventing the convention. Con: pre-specification before we have any primitives risks being wrong.

Recommendation: **a one-paragraph `src/data/README.md` that names the convention** (uses `withPgClient`, returns Zod-parsed rows, no LLM, deterministic, tests against a real pool not a mock). No `_template.ts`.

### Q4. Does C.t1 stand up an HTTP MCP surface, or stay an in-process workspace dep until C.t8?

The Tier 2 plan §2.10 commits MCP-over-HTTP as the connector transport. C.t8 is the eventual handover task. **But**: the orchestrator currently calls the *stub connector* (in `product/orchestrator/test-fixtures/stub-connector.ts`) over MCP-HTTP at `:3001`. The new connector with zero tools is meaningless to the orchestrator until C.t4 lands.

Two possible C.t1 endpoints:

- **(α) Bind an HTTP MCP server with zero tools.** Operator can `curl` the discovery endpoint. Future C.t4 just adds tool registrations. Most "Cloud Run-ready" of the options. Cost: ~30 minutes of glue + the empty server runs in dev for no current benefit.
- **(β) Skip the MCP layer entirely until C.t4.** Connector boots with `/healthz` + `/readyz` only. C.t4 adds the MCP server alongside the tool handlers. Smaller surface today; defers an integration choice.

Recommendation: **(α)** — paid forward, the smaller surface today is bigger work later because C.t4 ends up doing two things at once (tool design + transport stand-up). The Tier 2 plan §"Verification" 1 explicitly names "Data-connector service starts, registers the … tools over MCP, responds to a discovery ping" as a chunk-C done condition. C.t1 satisfying the discovery-ping half early is cheap.

A third sub-question if (α): **register a no-op ping tool** so the discovery endpoint isn't empty? Pro: developers debugging from `mcp inspect` see something. Con: clutter; `discovery returns []` is also a valid signal. Lean: yes, register one `noop` tool; flag it as removed in C.t4.

### Q5. Connection-string secret hygiene — `.env` vs Secret Manager later

For local dev: `DATABASE_URL` lives in `product/connector/.env` (gitignored), with a sanitised version in `.env.example` (committed). Same pattern as the orchestrator's `ANTHROPIC_API_KEY`.

For prod (post-M4): the URL goes into GCP Secret Manager and is fed into the Cloud Run service via env-var reference. Cloud SQL connection is via the Cloud SQL Auth Proxy or unix-socket on Cloud Run, so the URL shape changes.

**Open at C.t1**: should the schema validate the URL format (`z.string().url()` + `.startsWith("postgres")`), or just `z.string().min(1)`? Strict validation catches typos early; loose validation tolerates the prod proxy URL without a schema change. Recommendation: strict regex match for `postgres(ql)?://` + `min(15)` length sanity, with an explicit comment that prod URL format may need a schema relax later.

### Q6. Should the new connector reuse the stub's `:3001` port, or claim `:3002`?

The §"Outputs" above proposes `:3002` so stub + new run side by side during the C.t1 → C.t4 transition. Alternative: claim `:3001` immediately, taking over from the stub. The orchestrator's `CONNECTOR_URL` config would need to flip *or* the stub would need to retire.

Recommendation: **`:3002` until C.t4**. The stub is still functional and shipping data to the orchestrator. Two services on two ports for ~1 week is cheaper than coordinating a cutover during a non-cutover task.

### Q7. Should `FsHandoffStore` move to a `PostgresHandoffStore` reusing the new pool now?

The connector now owns a Postgres pool. The handoff store currently writes JSON files under `var/handoffs/`. E.t2 proper (post-IAM) is the planned swap. C.t1 stands up the *capability* to do it earlier.

**Open**: does C.t1 expand to include a `PostgresHandoffStore` swap, given the pool is now there? Pro: one more piece of the substrate falls into place; matches the "single Postgres for everything we own" framing of C.18 + E.10. Con: scope creep — C.t1 is supposed to be ~0.5 day; an additional `HandoffStore` impl + cutover + tests is another ~0.5 day; risks tangling chunk-E and chunk-C work.

Recommendation: **defer to E.t2 proper**. Note in the plan that the pool is ready when E.t2 wants it. Don't rush the swap.

---

## Risks / out-of-scope (additional)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pool defaults wrong for Cloud SQL `db-f1-micro` once we deploy | Medium | Surfaced as Q1; revisit at C.t8 runbook authoring + first M4 load test. |
| `node-pg-migrate` runs against `puma_dev` accidentally and breaks the dev DB | Low (per [next-steps.md](../next-steps.md), `puma_dev` is deliberately untouched) | Verification step 5 explicitly names a *fresh test DB*. The migrate script reads `DATABASE_URL`; an operator pointing at `puma_dev` is on them. Document in the plan and in the npm script's banner. |
| `:3002` conflicts with something the operator runs (Vite preview, etc.) | Low | Configurable via `CONNECTOR_PORT`. No load-bearing reason for `:3002` specifically. |
| Importing `pg`/`@types/pg` triggers another zod-version drift like `@google/adk` did (`gotchas.md`) | Low | `pg` doesn't bundle zod. No expected interaction. Verify on `npm install`. |
| The empty MCP server (Q4 (α)) crashes on discovery because `@modelcontextprotocol/sdk` rejects zero-tool registration | Low | Verify with the version pinned in the orchestrator. If it does, register the no-op ping tool (Q4 follow-up) — that's a 5-line fix, not a plan rework. |
| Bottom-up scope creep — "while we're here, let's add the first primitive" | High (this is the failure mode the ★ section names) | Surfaces in code review. The plan explicitly forbids primitives. Reviewers reject any primitive PR'd alongside C.t1. |

**Out-of-scope, named again for the executing agent**: tools, primitives, ETL, embeddings, classifiers, orchestrator rewiring, Cloud Run, Cloud SQL provisioning, Postgres `SessionService`, Postgres `HandoffStore`, deprecated-schema removal. Every one of those is named in §"Out of scope" or §"Open questions" — they're someone else's task.

---

## Coordination

- **C.t2** (closed) provides the migrations this task runs and the Zod schemas the future tools will validate against. Read its execution log to know the schema is settled and the tool I/O is settled — C.t1 doesn't re-open either.
- **C.t3** (next after this) consumes the pool and the migration runner. C.t3's CLI imports `getPool()` from `@swoop/connector` (or opens its own — open call at C.t3 design time, but this plan exports it for reuse).
- **C.t3a** consumes the pool for batch embedding writes + classifier passes. Same pool, different access pattern (batch UPDATE through `withPgClient`).
- **C.t4** registers the eight intent-named tools on the MCP server stood up here. Tool descriptions loaded from `cms/prompts/tools/<tool>/description.md` per C.34. Each tool handler at `src/tools/<tool>.ts` calls primitives at `src/data/<primitive>.ts` — all greenfield, all C.t4.
- **C.t8** writes the runbook that documents the operating shape of this skeleton. The defaults set here propagate.
- **B.t3a** swaps the orchestrator off the stub connector onto this service once C.t4 lands. C.t1 does not touch B.t3a's territory.
- **E.t2 proper** may eventually swap `FsHandoffStore` for a `PostgresHandoffStore` reusing this pool (Q7). Out of scope here.

---

## Anti-pattern guard — flag where bottom-up reasoning could leak in

Three specific places in C.t1 where bottom-up reasoning is most likely to creep in. Names them so the executing agent and the reviewers can spot the slip:

1. **"While we're authoring the pool, let's add a generic `query<T>(sql, params)` primitive."** That's a primitive. Primitives are C.t3a + C.t4. The pool exposes `withPgClient`; that's enough. Don't pre-shape what a query interface looks like before any primitive needs it.

2. **"The MCP server is empty — let's add a `find_inspiring` stub so the discovery endpoint shows something."** No. Tools register from C.t4 with real handlers. Stubbing one tool today means dummy code that has to be deleted in five days. Worse, it normalises authoring tools without their conversational-moment description (the work C.t2 did, that C.t4 reads from `cms/prompts/tools/`). Empty is the right shape.

3. **"The pool is open — let's expose a `/sql` endpoint so we can poke the DB from the dev console."** That's the librarian shape (theme 11 anti-pattern). The connector's external surface is MCP; SQL never escapes the process. Add a CLI script if you want a poke surface; never an HTTP endpoint.

If any of those creep into the PR diff, the reviewer rejects the change with a pointer back to this section.

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks. Pattern matches `03-exec-c-t2.md` and `03-exec-c-t0.md`.)*

### 2026-05-01 — C.t1 implemented (agent `ab7c6b07294907b14`)

Worktree branch: `worktree-agent-ab7c6b07294907b14`. Base: `92c99245` (HITL-ratified C.t1 plan). Four atomic commits landed:

| Commit | Scope | Tests delta |
|---|---|---|
| `735c585` | Postgres pool + DATABASE_URL config + stricter URL validation | connector +19 (56→75) |
| `5bab8c4` | MCP-HTTP surface skeleton with no-op ping tool | connector +6 (75→81) |
| `1f7ade8` | `node-pg-migrate` runner + `migrate:up` script | connector +2 (81→83) |
| `3d42175` | Live-smoke fix: `statement_timeout` via libpq startup options (no race) | connector +1 (83→84) |

**Final state**:
- All 6 workspaces green on fresh `npm install`. Total: 519 tests passing (was 492; +27 from C.t1's 28 new tests including 1 DB-gated bonus).
- Per-workspace: `@swoop/common` 102 (unchanged) / `@swoop/orchestrator` 158 (unchanged — orchestrator unaffected confirmed) / `@swoop/connector` **84** (was 56; +28 from C.t1, with 3 DB-gated tests skipped without `DATABASE_URL`) / `@swoop/ui` 71 (unchanged) / `@swoop/ingestion` 31 (unchanged) / `@swoop/harness` 74 (unchanged).
- Typecheck clean across all 6 workspaces.

**End-to-end smoke verification** (per plan §"Verification"):
- Service boots from `npm start`. `[connector] ready on http://localhost:3099`.
- `/healthz` returns `{"status":"ok","service":"swoop-connector"}` (no DB call — verified by test passing a throw-on-touch pool proxy).
- `/readyz` returns `{"status":"ready","db":"ok"}` against a live DB (real `SELECT 1` round-trip).
- MCP discovery returns exactly the `ping` tool. Calling `ping` returns `{ok: true, version: '0.1.0'}` (verified via real `StreamableHTTPClientTransport` test).
- `npm run migrate:up` against a fresh test DB applies all 6 migrations (001–006); re-running reports "No migrations to run!" (idempotent forward-only per C.31). `pgmigrations` table records each migration name. 26 user tables present post-migrate (21 domain + 5 derived + customerreview + customerreview_trip).
- SIGTERM produces `[connector] SIGTERM received, shutting down.` and exits cleanly (graceful pool close → HTTP close → process exit).
- Orchestrator continues to talk to the existing stub at `:3001` — untouched.

**HITL Q resolutions verified in code**:
- Q1: pool defaults `max:10 / idle:30s / statement_timeout:10s` documented in code header + tunable via `PG_POOL_MAX` / `PG_POOL_IDLE_MS` / `PG_STATEMENT_TIMEOUT_MS`.
- Q2: manual `npm run migrate:up` only; runs against `migrations/`. Default `pgmigrations` table name. Boot-time auto-migration explicitly *not* implemented; `down` direction emits a steering warning.
- Q3: `src/data/README.md` codifies the per-primitive convention (one file per derived/domain entity, `withPgClient`, no LLM, real-pool tests).
- Q4 (option α + ping): MCP-over-HTTP server stands up at `:3002` empty save for the no-op `ping` tool.
- Q5 (stricter URL validation): `DATABASE_URL` Zod schema validates URL parse + scheme allowlist (`postgres://` or `postgresql://`) + non-empty single-segment database name. Test asserts `https://example.com`, `javascript:alert(1)`, multi-segment paths, and missing db name all reject at boot. Same shape as the Sec-3 fix at `be9ca95` for `entryUrl`.
- Q6: `:3002` claimed for the new connector; `:3001` stub stays running until B.t3a.
- Q7: `FsHandoffStore` left untouched (deferred to E.t2 proper).

**Out-of-scope discipline preserved** (per plan §"Out of scope" + §"Anti-pattern guard"):
- No tools registered beyond the no-op ping. Tool registration is C.t4.
- No primitives. `src/data/` contains only `pool.ts` + `README.md` + tests.
- No `export.sql`. C.t3.
- No embedding pass / Haiku classifiers. C.t3a.
- No CMS reads. C.t4 wires the loader.
- No orchestrator-side rewiring — `product/orchestrator/test-fixtures/stub-connector.ts` and `product/orchestrator/src/connector/tools.ts` *unchanged*.
- No Cloud SQL / Cloud Run / Docker Compose work. M4.
- No `Postgres SessionService` work. B.2 post-M4.
- No `PostgresHandoffStore` swap. E.t2 proper.
- No deprecated `Search*` / `GetDetail*` schema removal. B.t3a.

**Notable findings during execution**:

1. **`pg`'s `client.query()` deprecation when used in `on('connect')` handler is real.** Live-smoke testing surfaced the warning the unit tests didn't catch: setting `statement_timeout` via `pool.on('connect', client => client.query('SET ...'))` races with pg's internal driver-init queries. Fix: pass `statement_timeout` via the libpq `options` startup parameter (`-c statement_timeout=<ms>`) — applied by Postgres before any user query runs, no race. Worth noting for any future pool tunable: prefer the libpq startup option over `on('connect')`. C.t8's runbook should reference this if it covers pool tunables.

2. **`node-pg-migrate` accepts plain SQL files but emits informational `"Can't determine timestamp for NNN"` warnings** when migrations don't carry timestamp prefixes. Our zero-padded prefix convention (per C.31) is the durable choice; the warnings are benign — node-pg-migrate just can't infer when to suggest a "skip already-newer migrations" optimisation. Mention in C.t8 if operators look at the warnings and worry.

3. **npm shell wrapper doesn't propagate SIGTERM cleanly to its tsx child.** When a shell-spawned `npm start` is sent SIGTERM, npm sometimes survives and the tsx child becomes orphaned holding the port. The `tsx` process directly is the right SIGTERM target in production (Cloud Run sends SIGTERM to PID 1, which would be `node` or `tsx` directly, not npm). Local-dev workaround: invoke via `node --import tsx ./src/server/index.ts` (or just kill `tsx` directly). Not a code bug; runbook concern for C.t8.

4. **Worktree-base race avoided cleanly.** Initial `git rev-parse HEAD` showed `5c9534fd` (worktree branched off main, not the C.t1 base); the gate's auto-recovery (`git cat-file -e` followed by `git reset --hard`) restored to `92c99245` because the SHA exists in the shared object store. Pattern from the 2026-04-29 swarm notes held.

**Downstream what's now possible**:
- **C.t3** can begin. The CLI in `@swoop/ingestion` imports `getPool` / `withPgClient` from `@swoop/connector` (or constructs its own pg client — its design call). The migration runner is callable from outside; C.t3's "before each ETL run, ensure migrations applied" guard can `npm run migrate:up` the connector's package.
- **C.t3a** can begin in parallel with C.t3 once C.t3's transform shape is settled — same pool, batch UPDATE pattern through `withPgClient`.
- **C.t4** can begin once C.t3 + C.t3a have populated rows. Tool handlers register on the existing `createConnectorMcpServer`. The no-op `ping` tool is removed there.
- **C.t8** documents the operating shape stood up here; the three "Notable findings" above belong in its runbook content.

**Coordination point for the next chunk-C agent**: H1 (`messageOf` helper) and H2 (`emitErrorRaised` helper) — pair these into the *first* commit of whichever C.t* agent next touches the 16-site sweep. They're consumed by the new tool handlers' error envelopes per the 2026-04-30 review's strategic table. C.t1 didn't touch the 16 sites so didn't pick them up.

---

## 2026-05-01 HITL ratification

Open questions resolved per Al's HITL session 2026-05-01. Status flipped from DRAFT to ready-for-execution.

### Resolutions

1. **pg pool config defaults** (Q1): accept the agent's recommended defaults (`max:10` / `idle:30s` / `statement_timeout:10s`) as the calibration starting point. **No specific load profile yet — flag the surface as tunable.** Document the values in `connector/src/db/pool.ts` with a header comment noting that ETL paths may want larger `max` or different `statement_timeout`. Future tuning is a known-known.
2. **`node-pg-migrate` placement + invocation** (Q2): as recommended. Manual `npm run migrate:up` for C.t1; separate Cloud Run Job post-M4. Migrations live at `product/connector/migrations/` (already established in C.t2). Boot-time auto-migration explicitly rejected.
3. **Data primitives directory convention** (Q3): as recommended. One-paragraph `src/data/README.md` naming the convention (one file per derived/domain entity primitive group; exported functions are the public surface). No `_template.ts`.
4. **HTTP MCP surface NOW vs later** (Q4): **NOW** (option α). Stand it up empty (or with one no-op ping tool) so C.t4 just adds tool registrations. Make progress early; avoid a later refactor.
5. **`DATABASE_URL` secret hygiene + validation** (Q5): **stricter** validation. Validate at boot: URL parses, scheme is `postgres://` or `postgresql://`, database name present in path. Reject malformed at boot rather than discovering at first query. `.env` for dev / Secret Manager post-M4.
6. **Port assignment** (Q6): as recommended. `:3002` for new connector while the orchestrator's stub at `:3001` keeps backing things until C.t4.
7. **`PostgresHandoffStore` swap timing** (Q7): as recommended. Defer to E.t2 proper. C.t1 ships the pool, but the handoff store stays on `FsHandoffStore` until GCP IAM lands.

### Notes for the executing agent

- Stricter URL validation per Q5 lives in `connector/src/config/schema.ts`. Use Zod's `z.string().url().refine()` pattern — same shape as the Sec-3 fix landed on `be9ca95` for `entryUrl`.
- The "no-op ping tool" in Q4: simplest possible MCP tool returning `{ok: true, version: '0.1.0'}`. Removed by C.t4 when the real tools register.
- `npm install` will pull `pg` and `@types/pg` — connector workspace concern.
