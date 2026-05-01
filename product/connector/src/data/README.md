# `src/data/` — connector data primitives

This directory holds the connector's data primitives: small, deterministic
typed functions that wrap the Postgres pool and return Zod-parsed rows. They
are the building blocks the eight intent-named tool handlers (C.t4) compose.

**Status as of C.t1**: only `pool.ts` exists. Primitives land in C.t3a and
C.t4 — see [`planning/03-exec-c-t3a.md`](../../../../planning/03-exec-c-t3a.md)
and [`planning/03-exec-c-t4.md`](../../../../planning/03-exec-c-t4.md).

## Convention

Future primitives follow this shape:

- **One file per primitive group**, named for the derived/domain entity it
  serves (e.g. `inspire-passages.ts`, `customer-stories.ts`, `trip-cards.ts`).
- **Exported functions are the public surface.** No default exports. Each
  function takes the validated `Config` (or a `PoolClient` if it's an
  internal helper inside a transaction) and returns Zod-parsed rows from
  the appropriate `*PublicSchema` in `@swoop/common`.
- **Borrow connections via `withPgClient`** (or `withPgClient`'s ETL-path
  override). Direct `pool.connect()` is forbidden — it leaks clients on
  error paths.
- **No LLM calls.** Primitives are deterministic SQL. ETL classifiers
  (Haiku passes that produce `persona_summary`, blog-post job
  classifications, etc.) live elsewhere — see C.t3a.
- **Tests against a real Postgres pool**, not a mock. Mocks of `pg` add
  more bugs than they catch. Tests skip cleanly if `DATABASE_URL` isn't
  set (same gate as `pool.test.ts`).

## What does NOT live here

- **Tool handlers** — those are at `src/tools/<tool>.ts` (C.t4). They
  *call* primitives; they aren't primitives themselves.
- **MCP server wiring** — that's `src/server/`.
- **Transport / HTTP concerns** — `src/server/`.
- **Migrations** — `migrations/` at the workspace root, applied by
  `src/migrate.ts`.

## Anti-patterns

The following patterns belong somewhere else:

- A generic `query<T>(sql, params)` primitive that any caller can use. The
  whole point of the per-entity convention is that callers pass *intent*,
  not raw SQL strings. Anything generic enough to want one of these is
  almost certainly leaking the librarian shape (theme 11). Stop and
  re-anchor.
- HTTP-shaped wrappers around primitives. The connector's external surface
  is MCP. Primitives are internal; never expose them to HTTP.
- Synthesising prose. Primitives return rows. Prose composition happens at
  the orchestrator (Sonnet weaves directly post-C.24).
