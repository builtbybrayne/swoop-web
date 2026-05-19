# Gotchas — Swoop Web Discovery (Puma)

Environmental / tooling / library traps that cost real time when discovered. Fix-on-encounter guidance.

**Format**: `## Title` then body. Add entries when you get bitten by something future-you shouldn't be.

---

## ADK's `SkillToolset.processLlmRequest` never fires — manual prompt-injection required

**Symptom**: agent has `SkillToolset` wired in `tools: [skillToolset, ...]`, the 5 skill meta-tools (`list_skills` / `load_skill` / etc.) are callable, `loadAllSkillsInDir` loads all the SKILL.md files at boot — but Sonnet never calls `load_skill`, even when a description is an obvious match. The ADK-shipped "you MUST use load_skill when a skill is relevant" instruction is also nowhere visible to the model.

**Cause**: `LlmAgent`'s pipeline (`node_modules/@google/adk/dist/cjs/agents/llm_agent.js`) iterates `this.tools`, but for each `toolUnion` calls `convertToolUnionToTools()` BEFORE invoking `processLlmRequest`. `convertToolUnionToTools()` flattens a `Toolset` to its child tools and discards the toolset itself:

```js
async function convertToolUnionToTools(toolUnion, context) {
  if (isBaseTool(toolUnion)) return [toolUnion];
  return await toolUnion.getTools(context);   // ← toolset is gone
}
```

The agent then loops the child tools and calls `processLlmRequest` on each. The 5 skill child tools inherit `BaseTool`'s no-op `processLlmRequest`. **`SkillToolset.processLlmRequest` — where `DEFAULT_SKILL_SYSTEM_INSTRUCTION` + `formatSkillsAsXml(skills)` auto-injection lives — is dead code in ADK's own pipeline.** Sonnet receives the 5 generic tool descriptions ("Loads the SKILL.md instructions for a given skill.") and that's it — no framework-level guidance to actually USE them.

**Fix**: manual replication. The constants/helpers aren't exported from `@google/adk`'s public surface, so we copy them locally in [product/orchestrator/src/agent/skills-prompt-injection.ts](product/orchestrator/src/agent/skills-prompt-injection.ts):

- `DEFAULT_SKILL_SYSTEM_INSTRUCTION` (verbatim from `tools/skill/skill_toolset.js`).
- `formatSkillsAsXml` (verbatim port of `skills/prompt.js`).
- `buildSkillsPromptInjection(skills, { includeBodies })` — concatenates both into one block.

[product/orchestrator/src/agent/factory.ts](product/orchestrator/src/agent/factory.ts) computes the injection at boot and wraps the `InstructionProvider` so every turn's instruction is `<brief>\n\n---\n\n<skills-injection>`. The brief still re-reads per-turn in dev (hot-reload); the skills bodies don't change at runtime so they're captured in closure.

**Demo escape hatch**: `PRELOAD_SKILL_BODIES=true` env var (see config schema) appends every skill's full body to the system prompt as an appendix — Sonnet sees the whole library in context regardless of whether it'd call `load_skill`. ~20K extra prompt tokens, cache-friendly, ~$0.001/conversation. Off by default.

**When this becomes dead code**: if ADK ever fixes the toolset pipeline (calling `processLlmRequest` on toolsets, not just child tools) OR exports the helpers, delete `skills-prompt-injection.ts` and revert the `factory.ts` wiring to `instruction: () => promptLoader.load()`. Keep the env-var preload only if the auto-loading still proves unreliable.

---

## `annotate-images --mode=batches` builds the payload then bails — submission is unwired *(CLOSED 2026-05-13 by BATCH-C.t6; entry preserved for git-blame readers hitting old logs)*

**Status**: ✅ CLOSED 2026-05-13. The submit + poll + result-stream wiring landed via [planning/03-exec-c-t6-batches-submission.md — BATCH-C.t6](planning/03-exec-c-t6-batches-submission.md), decisions C.batch-1..4. `--mode=batches` now POSTs to Anthropic, polls until the batch ends, fetches results, and writes back per-result. The operator-facing runbook at [product/cms/ops/image-annotation-rerun.md](product/cms/ops/image-annotation-rerun.md) now recommends `--mode=batches` for full re-runs.

**Historical symptom** (kept for searchability — anyone hitting an old log will find this entry): `npm run -w @swoop/ingestion annotate-images -- --mode=batches --max-budget=20` ran through the cost projection + budget gate + 80MB request-payload build, then logged

    [annotate] --mode=batches: request-build verified; submission deferred to C.t8 runbook step. Use --mode=live for the small-sample verification.
    [annotate] complete: succeeded=0 skipped=0 failed=6894.

…and exited non-zero with every candidate marked `batches_submission_deferred` in the checkpoint. No request was sent.

**Historical cause**: `runBatches` in [product/ingestion/src/images/run.ts](product/ingestion/src/images/run.ts) was a deliberate **C.t6 scope-cut** (decision C.52). The function ratified the request shape against the schema but stopped before `client.messages.batches.create({ requests })`. The follow-up task tracked in `next-steps.md` was closed by BATCH-C.t6.

**Today**: pick whichever mode fits the task — `--mode=batches` for full re-runs (50% discount, ~$17 / £14 for the full ~6.9K corpus), `--mode=live` for small-slice prompt iteration. No more bail-out.

---

## Gemini embeddings 429 under our default concurrency — dial down with env vars

Symptom: `npm run -w @swoop/ingestion enrich -- --mode=all --sync` immediately throws

```
GeminiError: Gemini HTTP 429: { "error": { "code": 429, "message": "You exceeded your current quota, ..." } }
```

Even on a Tier 1 (post-pay) Google AI Studio project where an isolated `curl` to the same endpoint with the same key returns 200. The dashboard shows essentially zero spend because 429-rejected requests are billing-free.

Cause: Gemini's per-minute token throughput (TPM) is enforced on **sub-second bursts**, not just steady throughput. Our `embedInBatches` defaults are **concurrency 4 + batch size 100** — fine for Tier 1 in steady state, but a fresh enrich pass fires the four embed sources (`tag` / `faqitem` / `blog_chunk` / `image`) sequentially, each opening 4 parallel batches of up to 100 docs ≈ 50K tokens each. That's ~200K tokens hitting in a sub-second window — past the burst ceiling on Tier 1, instantly past free-tier. Our retry chain `[1s, 2s, 4s]` is too tight to clear Gemini's per-minute reset window.

Fix: dial concurrency + batch size down via env vars for the initial run, then re-raise once you trust the pipeline.

```sh
GEMINI_CONCURRENCY=1 GEMINI_BATCH_SIZE=50 \
  npm run -w @swoop/ingestion enrich -- --mode=all --sync
```

`GEMINI_CONCURRENCY=1 GEMINI_BATCH_SIZE=50` = max 50 docs (~25K tokens) per request, no parallel-burst — well inside Tier 1 TPM. Implementation: `resolvePositiveIntFromEnv` in `product/ingestion/src/enrich/gemini.ts`. Non-numeric / non-positive values fall through to the defaults (4 and 100). Explicit `options.concurrency` / `options.batchSize` arguments still win over env (test-injection path stays clean).

Diagnostic for whether the issue is your key vs our pipeline: isolated curl to `batchEmbedContents` with the literal `$GEMINI_API_KEY` from `connector/.env` — if 200, the pipeline's burst is the cause; if 429, the project/tier is the cause.

For later: longer initial backoff (env-overridable `GEMINI_BACKOFF_BASE_MS`?) would let our retry chain ride out the per-minute window. Not built yet — current shape is dial-down-burst first, extend-backoff later if 429s recur after dialing down.

**Post-2026-05-15 context**: this gotcha bites only when the run actually needs fresh embeddings. The `embedding_cache` (decision C.embedding-cache-1, plan `planning/03-exec-crosscut-embedding-cache.md`) means **re-runs against unchanged content cost zero Gemini tokens** — cache hits at compose-time INSERT before the embed pass sees the row. The 429 risk now only surfaces on (a) genuinely new / changed content, (b) the first run after migration 012 if the cache backfill couldn't find existing embeddings (e.g. after a wipe), or (c) the four uncached sources (`tag`, `faqitem`, `image`, `blog_chunk`) on their first run. If you're re-running compose with nothing changed, dial-down isn't necessary — but it's free to leave on.

---

## Gemini embeddings cap inputs at 2048 tokens (vs Voyage-3's 32K)

Symptom: a `gemini-embedding-001` call against a long string returns `400 INVALID_ARGUMENT: input exceeds maximum allowed length`. Voyage-3 happily accepted up to 32K tokens; Gemini's cap is **2048**.

Our chunk targets are 800 tokens (`TARGET_CHUNK_CHARS = 800 * APPROX_CHARS_PER_TOKEN` in `product/ingestion/src/enrich/chunk.ts`), so chunks from blog HTML, contentblocks, FAQ items all sit comfortably under the cap.

**Where this can bite**: `composePersonaInputProse` in `chunk.ts` aggregates many short customer reviews under the same reviewer name into a single composite blob (per the 2026-04-30 customerreview-corpus-shape discovery). Prolific reviewers (10+ rows) occasionally compose into a 2048+ token blob.

Defence: `capToGeminiInput(text: string): string` in `chunk.ts` soft-truncates at 8192 chars (2048 × 4 chars/token). Applied at the persona-aggregation return path. Cap is exact; the truncated suffix is acceptable signal loss for persona summarisation. Per C.t9 Step 8 + the C.46 decision body. Other chunking paths (`chunkBlogHtml`, `chunkContentblockText`, `chunkFaqItem`) don't need the cap because their target is already half the limit.

If you ever add a new embed-pass source that bypasses the existing chunking helpers, wrap your input in `capToGeminiInput()` defensively.

---

## `pg.Pool` `on('connect')` queries warn about `client.query() while already executing`

Symptom: connector boot logs include the deprecation warning `Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.` even though no user code looks like it's calling `client.query()` twice.

Cause: pg runs an internal driver-init query (e.g. `SELECT typname, typtype, oid FROM pg_type`) immediately on every new connection. Any user-supplied `pool.on('connect', client => client.query(...))` callback fires before that init query completes. pg correctly diagnoses the second `client.query` as overlapping the first.

Fix: prefer the libpq startup-option route for anything you used to set in `on('connect')`. For `statement_timeout`:

```ts
const poolConfig: pg.PoolConfig = {
  // ...other fields
  options: `-c statement_timeout=${ms}`,
};
```

`-c key=value` is libpq's escape syntax for "apply this `SET` at session start". Postgres applies before pg's internal queries run; no race. Cloud SQL honours it. On-prem + Postgres.app likewise. See `discoveries.md` 2026-05-01 entry for the full pattern.

Don't fix this by `await`ing inside the `on('connect')` callback — the handler is sync; awaiting just defers the second query, which is what pg is warning about.

Use `on('connect')` only for sync metadata setup (e.g. `client.setTypeParser`).

---

## npm shell wrapper doesn't propagate SIGTERM cleanly to its tsx child

Symptom: `npm start` boots a connector / orchestrator under `tsx`, you `kill -TERM <npm-pid>`, the npm process exits but the tsx child survives — port stays occupied; `dropdb` fails with "database is being accessed by other users".

Cause: npm spawns the script as a child process and does not always propagate signals. The tsx child gets orphaned; the OS reparents it to PID 1.

Local-dev workaround: send SIGTERM directly to the tsx process (`ps aux | grep tsx`, then `kill -TERM <tsx-pid>`), or invoke tsx directly bypassing npm: `node --import tsx ./src/server/index.ts`. The graceful shutdown handler in the service does work — it's just receiving SIGTERM via the right path.

Production isn't affected: Cloud Run (and Docker, k8s, etc.) sends SIGTERM to PID 1, which is `node` or `tsx` directly — there's no npm wrapper between PID 1 and the app. Don't paper over the local-dev case in code.

---

## `node-pg-migrate` emits "Can't determine timestamp for NNN" warnings — they're benign

Symptom: `npm run migrate:up` prints

```
Can't determine timestamp for 002
Can't determine timestamp for 003
...
```

once per migration file. Migrations still apply correctly.

Cause: `node-pg-migrate` looks for timestamp-prefixed names (`1709123456789_create_users.sql`) by default. Per decision C.31 our migrations use a zero-padded sequence prefix (`002_domain_tables.sql`) so they're naturally orderable and filename-stable across rebases. Without a parseable timestamp, the runner can't suggest the "skip already-newer migrations" optimisation — hence the message.

Action: ignore the warnings. Document in C.t8 runbook so an operator who reads them doesn't panic.

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
