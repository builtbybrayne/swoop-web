# 03 — B.t13: Postgres-backed durable sessions

**Status**: RATIFIED 2026-06-10 by Alastair ("postgres sessions asap") — promoted from the Part C stub in [03-exec-crosscut-magical-poincare-demo-stability.md](03-exec-crosscut-magical-poincare-demo-stability.md). **Chunk home**: B (agent runtime).
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) item B1 — structural fix for conversation loss on orchestrator restart.
**Workspaces touched**: `@swoop/orchestrator` (primary), `@swoop/connector` (migration file only — single migrate runner), config schema, `cms/ops` runbook note.

---

## ★ Read this first

The swap seam **already exists** — do not invent a new one:

- [orchestrator/src/session/interface.ts](../product/orchestrator/src/session/interface.ts) — `SessionStore` (B.t2): the contract every backend satisfies. `canAcceptTurn` and friends live against it.
- [orchestrator/src/session/index.ts](../product/orchestrator/src/session/index.ts) — `createSessionStore(opts)` factory + `SESSION_BACKENDS` registry. `firestore.ts` and `vertex-ai.ts` are deliberately body-less stubs proving the swap shape; this plan supersedes their lean (decision below).
- [orchestrator/src/session/adk-native.ts](../product/orchestrator/src/session/adk-native.ts) — `AdkNativeSessionStore implements SessionStore`: the bridge to ADK's own session machinery. The Runner ([server/chat.ts](../product/orchestrator/src/server/chat.ts) `runner.runAsync`) consumes ADK's session service; the [memory-bug fix `9e990db` — persist assistant text turns to ADK session](../progress.md) shows conversation history lives ADK-side.
- [orchestrator/src/session/mutex-store.ts](../product/orchestrator/src/session/mutex-store.ts) — per-session async mutex wrapper (R2); must wrap the new backend identically.
- [server/session-history.ts](../product/orchestrator/src/server/session-history.ts) — B.t11's `GET /session/:id/history` projection; must read correctly post-swap (it's what rehydrate depends on).

**There are two state layers to make durable, not one**: (1) the orchestrator's `SessionState` (consent, triage, seenItems, lifecycle) behind `SessionStore`; (2) the ADK session's event history (what the Runner reads/writes and what B.t11 projects). Step 0 maps exactly where each lives today; the implementation must cover both or restart-survival fails even with a Postgres `SessionStore`.

Environment gotchas that WILL bite (see [gotchas.md](../gotchas.md)): `dotenv({ override: true })` for any new env reads; pg pool `statement_timeout` via libpq `options`, never `on('connect')`; Postgres.app `psql` path; migration filename prefix is zero-padded sequence (no timestamps).

## 1. Outcomes

1. Orchestrator restart (crash, deploy, file-watch) no longer destroys conversations: sessions + conversation history survive in Postgres; a reload after restart rehydrates and the visitor continues where they left off.
2. Backend selected by config: `SESSION_BACKEND=in_memory | postgres` (exact literal per the existing `SESSION_BACKENDS` registry — read it first). Default stays in-memory (tests unchanged); demo/prod set postgres.
3. TTL semantics preserved: `SESSION_TTL_IDLE_HOURS` / `SESSION_TTL_ARCHIVE_DAYS` enforced by a SQL sweep (E.t6 carrier pattern: callable function + in-process interval; CLI-able later).
4. B.t11 history projection + D.t9 mount-rehydrate work unchanged against the durable backend.

## 2. Steps

**Step 0 — Discovery (write the layer-map into this plan's execution log BEFORE coding).** Read the five files above + [server/session-bootstrap.ts](../product/orchestrator/src/server/session-bootstrap.ts) + how `index.ts` boots Runner/sessionService + the `9e990db` diff. Answer in writing: where does ADK event history physically live today; what does `AdkNativeSessionStore` delegate to; what does ADK 1.0 export as its session-service interface (`node_modules/@google/adk` — look for `BaseSessionService` / `InMemorySessionService` exports; the [B.t9 SkillToolset lesson](../discoveries.md) says read the installed source, not the docs).

**Step 1 — Migration `016_puma_session.sql`** (number confirmed against [connector/migrations/](../product/connector/migrations/) at dispatch; lives in connector's dir — single migrate runner, decision below). Shape guardrail, refined by Step 0: a `puma_session` row (id, state JSONB, created_at, last_active_at, archived_at NULL) + an **append-only** `puma_session_event` table (session_id FK, seq, event JSONB, created_at) for ADK events — append-only beats one fat JSONB blob for history projection, concurrent writes, and sweeping. Index `last_active_at`; FK `ON DELETE CASCADE`.

**Step 2 — `PostgresSessionStore implements SessionStore`** at `orchestrator/src/session/postgres.ts`, with a small orchestrator-owned pg pool (new module; libpq `options` for `statement_timeout`; pool config via env). Don't import the connector's pool — separate service, separate pool, same DB.

**Step 3 — ADK event durability.** Per Step 0's map: either implement ADK's exported session-service interface over the same tables, or write-through from the `AdkNativeSessionStore` bridge. Guardrail: implement against ADK's **exported** interface; do not fork/patch ADK internals. If ADK's interface can't be satisfied cleanly (the SkillToolset precedent — its pipeline sometimes ignores its own extension points), the fallback is bridge-level write-through + replay-on-boot into ADK's in-memory service per session (lazy hydration on first touch of a session id). Record which path was taken and why.

**Step 4 — Factory + config.** Add the backend literal to `SESSION_BACKENDS` + `createSessionStore`; config schema gains `SESSION_BACKEND` (default in-memory) + `ORCHESTRATOR_DATABASE_URL` (falls back to `DATABASE_URL`); cross-field refine: postgres backend requires a URL, fail-fast at boot. `MutexSessionStore` wraps it exactly as in-memory is wrapped (per-process mutex is correct on single-VM single-process).

**Step 5 — Sweep.** SQL sweep honouring both TTLs (idle → archived → deleted per existing semantics — read `in-memory.ts`'s sweeper for the canonical behaviour and mirror it); callable function + in-process interval consistent with the existing in-memory sweeper wiring and the [E.t6 carrier pattern](03-exec-handoff-t6.md).

**Step 6 — History projection + rehydrate.** Verify `session-history.ts` projects from the durable layer; `session.expired{gate}` discrimination preserved (404 only when genuinely absent/expired).

**Step 7 — Tests.** Store unit tests DB-gated like the connector's pattern (skip cleanly without a DB URL). Integration: (a) **restart-survival** — store instance A creates session + events; fresh instance B (same DB) reads them; `canAcceptTurn` correct; (b) history projection round-trip; (c) sweep idle/archive/delete; (d) mutex wrap still serialises per-session updates. Full workspace suite green.

**Step 8 — Live restart smoke + runbook.** Boot orchestrator `SESSION_BACKEND=postgres` against `puma_dev`: consent → one real turn → `kill -9` orchestrator → restart → browser reload → rehydrate restores the transcript → next turn continues in context. Add the env + smoke to the demo runbook surface (coordinate with [demo-stability plan](03-exec-crosscut-magical-poincare-demo-stability.md) Part B's `cms/ops/demo-server.md` — if that file doesn't exist yet in this worktree, note the env in the execution log for the runbook author).

## 3. Decisions (log to decisions.md at merge)

- **B.poincare-2**: session durability backend is **Postgres on the single-VM instance** — supersedes B.2's Vertex-AI/Firestore lean (which predated the [single-VM reframe](reviews/2026-05-27-ingest-and-state-of-play.md)). Firestore/Vertex stubs stay as proof-of-seam; no further investment.
- **B.poincare-3**: session migrations live in `connector/migrations/` (one migrate runner for the shared DB), with `puma_session*` table-name prefix marking orchestrator ownership.
- **B.poincare-4**: ADK event durability mechanism — executor records the Step-3 choice (interface implementation vs bridge write-through + lazy replay) with evidence.

## 4. Out of scope

- Cross-session visitor memory (still WON'T per [00_why.md §10](../product/cms/prompts/system/00_why.md)).
- Multi-process/multi-node session affinity (single-VM single-process assumption stands; revisit at GCE scale-out).
- Warm-pool changes beyond compatibility (`WARM_POOL_*` semantics unchanged; warm sessions may stay memory-only — they're pre-visitor and disposable; note the choice).
- UI changes (rehydrate already exists).

## 5. Estimate

1–2 days. The restart-survival integration test (7a) and live smoke (8) are the acceptance spine — without them this plan is not done, per the [B.t9 "boot-log gates are necessary but not sufficient" rule](../discoveries.md).
