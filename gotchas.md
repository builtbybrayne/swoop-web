# Gotchas — Swoop Web Discovery (Puma)

Environmental / tooling / library traps that cost real time when discovered. Fix-on-encounter guidance.

**Format**: `## Title` then body. Add entries when you get bitten by something future-you shouldn't be.

---

## Local Postgres is Postgres.app v18, not 16 — and `psql` may not be on `$PATH`

The plan originally specified Postgres 16; local dev is **Postgres 18** via Postgres.app. C.18 was updated 2026-04-29 to reflect this — no functional difference, pgvector / tsvector / pg_trgm all behave identically. Cloud SQL prod will follow.

The Postgres.app binary directory is `/Applications/Postgres.app/Contents/Versions/latest/bin`. If `psql` returns "not found", either add that to your shell `$PATH` or invoke `psql` by full path.

**Local dev DB**: `puma_dev` on `localhost:5432`, role `al`, password `pick-a-password`. Single store per C.18 — retrieval, handoff, and the post-M4 custom Postgres `SessionService` all share this one DB. Connection URL: `postgresql://al:pick-a-password@localhost:5432/puma_dev`.

**Bootstrap (one-shot, idempotent)** — re-run if you blow the DB away:
```sh
PG=/Applications/Postgres.app/Contents/Versions/latest/bin
$PG/psql -d postgres -c "ALTER ROLE al WITH PASSWORD 'pick-a-password';"
$PG/createdb -O al puma_dev 2>/dev/null || true
$PG/psql -d puma_dev -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

The Docker Compose mirror (handoff-parity artefact for Swoop's team) is deferred to pre-M5 ship per Tier 2 chunk C §2.5.

---

## Claude Code injects an empty `ANTHROPIC_API_KEY` — dotenv silently refuses to overwrite

Symptom: orchestrator startup prints `ANTHROPIC_API_KEY is required` despite `.env` having a valid key.

Cause: the shell Claude Code runs commands in has `ANTHROPIC_API_KEY=""` pre-set (empty). `dotenv`'s default behaviour is **not** to overwrite existing env vars, so the empty string from the shell wins.

Fix: use `loadDotenv({ override: true })` explicitly. Already applied in `product/orchestrator/src/index.ts`. If you add another service that reads `.env`, do the same.

---

## Claude model IDs with wrong date suffix return 404

Symptom: `model: claude-haiku-4-5-20250929` returns 404 from Anthropic.

The correct current IDs:
- **Sonnet 4.5**: `claude-sonnet-4-5-20250929`
- **Haiku 4.5**: `claude-haiku-4-5-20251001`

Both configured in `product/orchestrator/src/config/schema.ts` as `DEFAULT_ORCHESTRATOR_MODEL` / `DEFAULT_CLASSIFIER_MODEL`. Verify these match current published IDs before blaming anything else.

---

## `npm run X --workspaces --if-present` errors on empty workspaces

Symptom: `npm run typecheck -ws --if-present` fails with `No workspaces found!` when no workspace packages have `package.json` yet.

Fix: use the `product/scripts/run-workspaces.sh` wrapper. It checks for any present workspace and no-ops cleanly if none. Registered as the backing script for `build` / `typecheck` / `test` in `product/package.json`.

---

## ESLint 9 removed `.eslintrc.*` legacy config

Symptom: ESLint errors out saying your `.eslintrc.cjs` is obsolete.

Fix: ESLint 9 requires flat config (`eslint.config.mjs`). Already applied in `product/eslint.config.mjs` — extends `@typescript-eslint/recommended` + `eslint-config-prettier`. Do not roll back to legacy config.

---

## `@google/adk` 1.0 bundles its own `zod` — cross-package types don't satisfy each other

Symptom: `connector/tools.ts` gets a type error where workspace-`zod` `ZodObject` doesn't structurally match ADK's internal copy: `Argument of type 'X' is not assignable to parameter of type 'never'`.

Both zod copies are structurally identical; TypeScript rejects nominal mismatch on private fields.

Current workaround: single `as unknown as never` cast in `product/orchestrator/src/connector/tools.ts` at `buildFunctionTool` — commented inline. Runtime behaviour is correct.

Longer-term fix (when enough pain justifies it): `workspaces.nohoist` for `zod`, or wait for ADK to adopt peer-dependencies.

---

## `@google/adk`'s subpath imports require `moduleResolution: NodeNext`

Symptom: tsc errors on `zod/v3` or `zod/v4` subpath imports from inside `@google/adk`.

Cause: Node16 moduleResolution in `tsconfig.json` is stricter than NodeNext on subpath exports.

Fix: use `"module": "NodeNext"` + `"moduleResolution": "NodeNext"` in `product/orchestrator/tsconfig.json`. Already applied.

---

## Session state is in-memory — orchestrator restart kills all active sessions

Symptom: after a tsx-watch restart or any orchestrator deploy, the UI's cached `sessionId` in `sessionStorage` is no longer recognised; `/chat` returns 404.

Consequence: during development, clear `sessionStorage` and re-do consent whenever the orchestrator restarts. One-liner in the browser console: `sessionStorage.clear(); location.reload()`.

Production fix (post-M4): swap session backend to Vertex AI Session Service or Firestore per B.2 decision. Interface already supports it — see `product/orchestrator/src/session/`.

---

## Vite HMR sometimes serves stale modules — `preview_stop` + `preview_start` clears it

Symptom: UI throws an error that references an old module path (`?t=<old-timestamp>`). Edits don't take effect. Hard reload doesn't help.

Cause: Vite's transform cache + browser service worker occasionally get stuck.

Fix: `mcp__Claude_Preview__preview_stop` → `mcp__Claude_Preview__preview_start`. Restarts Vite + opens a fresh browser context. Works reliably.

---

## `npm install` EBADENGINE warnings are benign under Claude Code

Symptom: `npm warn EBADENGINE required: { node: '^20.19.0 || …' }, current: { node: 'v23.10.0' }`.

Cause: Claude Code's host shell runs Node 23; `.nvmrc` pins Node 20; the shell doesn't auto-switch.

Effect: warnings only. Code runs. CI uses `.nvmrc` so this is moot in deploy.

If running commands yourself: `nvm use` in `product/` picks up Node 20.

---

## `product/cms/` is NOT a workspace package

Symptom: adding `cms` to the workspaces array makes `npm install` fail because it has no `package.json`.

Cause: `product/cms/` holds content-as-data (markdown + JSON loaded at runtime), not code.

Fix: `cms` must be omitted from `product/package.json`'s `workspaces` array AND from the `run-workspaces.sh` counter. Both are already correct; don't re-add.

---

## `npm workspaces` `"@swoop/common": "*"` is fine — don't use `file:` references

PoC used `"@swoop/common": "file:../ts-common"`. Puma uses `"*"` and lets npm workspaces resolve via the symlink automatically. Don't revert to `file:` — it confuses `npm install` at CI time.

---

## Sample prompts / eval data isn't yet wired — real responses call real Anthropic

Every conversation in the running M1 triggers real Claude Sonnet + Haiku API calls. That's fine for manual smoke tests, but don't leave the integration test suite on a loop — it costs money.

Chunk H (validation) eventually provides a mocked-out eval harness. For now: manual use only.

---

## Error message `"400 … tools.0.custom.input_schema: JSON schema is invalid"`

Symptom: Anthropic returns 400 on tool invocation with `JSON schema is invalid. It must match JSON Schema draft 2020-12`.

Cause: the `claude-llm.ts` tool-schema normaliser is incomplete — see `discoveries.md` entry on "Anthropic tool schemas…" for the known genai-→-draft-2020-12 transformations. Three classes of fix: type-string case, numeric-constraint string coercion, draft-04 exclusiveMin/Max migration. The current normaliser handles all three; if Anthropic adds new schema requirements, extend it.

---

## `ThreadPrimitiveViewportProvider` wrapping your component in the React stack trace

Symptom: React error boundary logs show your component rendered inside `ThreadPrimitiveViewportProvider`, `AuiProvider`, `AssistantRuntimeProviderImpl` — but your App.tsx doesn't put it there.

Cause: sometimes a stale error from a prior Vite HMR swap still wraps an old tree. The actual current tree is fine.

Fix: `preview_stop` + `preview_start` (same as the Vite HMR gotcha above). Or hard-reload with `?cb=<timestamp>` query. Fresh boot makes the stale React tree go away.

---

## Opening screen won't close after Continue click

Symptom: Continue fires `/session` + consent PATCH successfully (you see 201 + 200 in network), but the opening screen dialog stays visible.

Cause: TWO calls to `useConsent()` — one in `App.tsx`, one in `OpeningScreen.tsx`. Each gets independent React state. The screen's instance flips to "granted"; App's instance stays "pending"; App keeps rendering the screen.

Fix: lift `useConsent()` to App, pass results as props to `OpeningScreen`. Already applied. Verified working.

Design principle: **one hook instance per state**. If multiple components need the same consent state, lift it.

---

## `HANDOFF_EMAIL_ENABLED=true` requires four other env vars or boot fails

Symptom: orchestrator startup prints a Zod refinement error like `HANDOFF_EMAIL_ENABLED=true requires HANDOFF_EMAIL_FROM, HANDOFF_EMAIL_TO_QUALIFIED, SMTP_USER, and SMTP_PASS`.

Cause: cross-field config refine in `product/orchestrator/src/config/schema.ts` enforces that flipping the master mailer switch requires a complete config. Misconfigured prod deploys can't silently swallow handoffs — they fail fast at boot.

Fix (in order of preference): (a) set the four required env vars and restart; (b) set `HANDOFF_EMAIL_ENABLED=false` to disable the mailer entirely (durable record still persists; handoff still flows; email leg is skipped with reason `mailer_disabled`); (c) leave it unset (defaults to `false`).

---

## File-backed handoff records under `var/handoffs/` are gitignored — don't commit them

The `FsHandoffStore` (interim implementation pending Firestore) writes one JSON file per handoff under `<orchestrator-package-root>/var/handoffs/<id>.json`. Each file is a full `HandoffPayload` including visitor name, email, contact preferences, and conversation context — i.e. visitor PII.

`.gitignore` excludes both `product/orchestrator/var/` and `product/connector/var/`. **Do not** add an exception, do not `git add -f` to bypass, do not move records elsewhere in the repo. The Firestore swap (E.t2 proper, post-IAM) takes the records out of the filesystem entirely.

---

## `HandoffStore` filename safety: handoffId must match `^[a-zA-Z0-9_-]+$`

Symptom: `FsHandoffStore.save(payload)` returns `{ ok: false, reason: 'handoff_id_invalid' }` for some payloads.

Cause: defence-in-depth check before any filesystem op. A handoffId with `/`, `..`, dots, spaces, or other special chars would let a malformed payload escape the store directory. The orchestrator's id generator uses `crypto.randomUUID().replaceAll('-', '_')` (prefix `handoff_`) so legitimate ids always pass; the guard is purely belt-and-braces.

Fix: ensure any caller-supplied handoffId conforms to the pattern. The pattern is exported as `HANDOFF_ID_PATTERN` from `@swoop/connector` for tests + future callers.

---

## `system/` prompt fragments must use a two-digit numeric prefix

Symptom: a file you authored at `product/cms/prompts/system/<name>.md` doesn't appear to affect the agent.

Cause: the prompt loader filters by `^\d{2}_[a-z0-9-]+\.md$` (G.11 / B.t1a). Files without the `00_` / `10_` / etc. prefix are silently skipped. So are files with uppercase letters, underscores in the slug, or wrong extension.

Fix: rename to a conforming pattern (`00_why.md`, `10_style-avoid.md`, etc.). Use sparse numbering (gaps of 10) to leave room for inserts past 9 without renumbering existing files. Drafts you don't want loaded yet can sit alongside as `_draft.md` or `notes.md` — both are silently ignored.
