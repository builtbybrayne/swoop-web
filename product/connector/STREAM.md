# Stream: @swoop/connector

**Status**: active. Runtime substrate stood up (C.t1 done 2026-05-01); awaiting C.t3 / C.t3a / C.t4 to populate primitives + tool handlers.
**Current task**: idle (between C.t1 and C.t3 dispatch).
**Blockers**: —
**Interface changes proposed**: —
**Last updated**: 2026-05-01

## What this workspace currently ships

- Handoff side-effects: mailer + `FsHandoffStore` + `submitHandoff` (chunk E).
- **Runtime substrate (C.t1)**: Postgres pool + Express + MCP-over-HTTP transport + `/healthz` + `/readyz` + `node-pg-migrate`-backed `migrate:up`. Service binds `:3002`. One no-op `ping` MCP tool registered (removed by C.t4 when real tools land).
- Public exports from `src/index.ts`: `loadConfig` / `getPool` / `withPgClient` / `closePool` / `buildPoolConfig` (C.t1) plus the existing handoff exports.

## Local commands

- `npm run dev --workspace @swoop/connector` — boot service in watch mode.
- `npm run start --workspace @swoop/connector` — boot service once.
- `npm run migrate:up --workspace @swoop/connector` — apply migrations 001–006 (forward-only per C.31). Reads `DATABASE_URL`. Idempotent.
- `npm test --workspace @swoop/connector` — 84 tests + 3 DB-gated tests (skipped without `DATABASE_URL`).
