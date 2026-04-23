# Gotchas — Swoop Web Discovery (Puma)

Environmental / tooling / library traps that cost real time when discovered. Fix-on-encounter guidance.

**Format**: `## Title` then body. Add entries when you get bitten by something future-you shouldn't be.

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
