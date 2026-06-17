# 03-exec — Sales-Memory T3-1: the memory store + CRUD

**Status**: DRAFT, 2026-06-16. Pending ratification. Part of [02-impl-sales-memory.md](02-impl-sales-memory.md) (T2). Implements decisions **sm-5** (store shape) + **sm-4** (mutate auth enforcement).
**Workspaces**: `connector` (owner), `@swoop/common` (schemas), one migration.
**Sequences**: can run in parallel with T3-2 once the T3-3 spike has confirmed the agent shape. No dependency on T3-2/3/4.

> **Altitude note**: this brief fixes the *what and why*, names the project context to respect, and states verification intent. The executing agent chooses exact file paths, function names, and SQL — following the existing connector patterns. Don't treat the schema sketch as gospel beyond the load-bearing columns (version, author, timestamp, status).

---

## Purpose (and where it sits in the golden circle)

This is the durable home for sales-authored knowledge. It serves the WHY (C.13: move appropriate visitors Awareness → Interest → Strong Consideration → warm handoff) by keeping the agent's *facts* current — a visitor who gets accurate seasonal/availability guidance is more confident and hands off warmer. The store holds **organisational knowledge**, never per-visitor memory (the no-cross-session-memory wall, `00_why.md` §10, stands).

## Context to respect (read before building)

- **The connector owns data + side-effects** (decision E.11) — the store, its CRUD, and the MCP tools live here, not in the orchestrator. Same home as the handoff store and the `find_*` data primitives.
- **Single Postgres store** (C.18); the B.t13 `puma_session*` tables already live in it. Add the memory tables beside them.
- **Migrations are `node-pg-migrate`, forward-only, zero-padded sequence** (C.31). Use the next free number (≈020 — verify against `product/connector/migrations/`). No DOWN.
- **Follow the existing tool-registration two-sidedness** — a connector tool is invisible to the model until it's in the orchestrator's `TOOL_SPECS` (the find_tips gotcha). These memory tools are exposed **only to the Opus memory agent** (T3-3), never the visitor agent — so registration is connector-side, exposure is gated orchestrator-side.
- **Store shape** is settled in T2 §2.4 (sm-5): `sales_memory` (current truth, what the agent loads) + append-only `sales_memory_version` (one attributed row per change). Versioned, attributed (author name), timestamped; **soft-delete only** (`status='retired'` + a retire version row) — never hard-delete (audit trail; matches the immutable-history instinct of C.31 + the embedding-cache model-version-in-PK).

## What to build

1. **Migration** for the two tables (T2 §2.4 sketch is the starting point; keep `version`, `created_by`/`updated_by`, `created_at`/`updated_at`, `status`).
2. **Data primitives** (connector `src/data/`-style): create / edit (→ new version + update current) / retire (soft-delete) / list-active / get-history-for-id. Each write is one transaction that touches both tables. Optimistic concurrency on edit via the `version` column (reject a stale-version write) — cheap insurance against two staff editing one memory.
3. **MCP memory tools** registered connector-side (list / store / edit / retire / show-history), with Zod I/O in `@swoop/common`.
4. **The read-active-set query** that T3-4 consumes for loading: active rows + their `content`, `updated_at`, `updated_by`, in a stable order. Keep it a single indexed query.
5. **Mutate auth enforcement (sm-4)** — every write tool re-validates the staff token server-side and refuses without it (dual backstop with the orchestrator gate; same posture as handoff consent E.4). The connector is the hard boundary even though the orchestrator already gates exposure.

## Verification intent

- Create → an `active` row + a `create` version row, both attributed + timestamped. Edit → a new version, current row bumped. Retire → `status='retired'` + a `retire` version; list-active no longer returns it; history still does.
- A mutate tool call lacking a valid staff token is rejected at the connector.
- The read-active-set query returns only active rows, stable order, with timestamps — exercised by T3-4.

## Scope guards (YAGNI)

No embeddings/retrieval over memories (T2 §10 — a loaded-whole curated list is correct at this scale). No hard delete. English only. No admin web surface — CRUD is reached only via the memory tools (which only the Opus memory agent sees).
