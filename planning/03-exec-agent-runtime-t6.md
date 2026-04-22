# 03 — Execution: B.t6 — Config externalisation

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: B (agent runtime).
**Task**: t6 — full config surface + per-agent model selection.
**Implements**: `planning/02-impl-agent-runtime.md` §2.7 + decision B.5 (per-agent model strategy).
**Depends on**: B.t1 (initial config module exists).
**Produces**: extended `product/orchestrator/src/config/` with full surface, Zod validation, per-agent model selection shape.
**Unblocks**: nothing critical; reduces magic-numbers debt.
**Estimate**: 1–2 hours.

---

## Purpose

Formalise the orchestrator's config surface. Everything tunable lives in env vars + a small config object, validated at startup. Per-agent model selection (orchestrator vs future functional internal agents) is a first-class shape here.

---

## Deliverables

### `product/orchestrator/src/config/`

| File | Role |
|---|---|
| `config/schema.ts` | Zod schema covering the full config surface (see below). |
| `config/load.ts` | Reads env vars, validates against the schema, returns a frozen typed `Config` object. Called once at startup. |
| `config/models.ts` | Per-agent model selection: `getModelFor(agentRole: "orchestrator" | "classifier" | "psych-profile" | ...): ModelConfig`. Reads from config; defaults defined per role. |
| `config/index.ts` | Re-exports. |

### Full config surface

Required:
- `ANTHROPIC_API_KEY` (orchestrator model access)

Agent + model:
- `ORCHESTRATOR_MODEL` (default: `"claude-sonnet-4-5"` or current Sonnet id; Tier 3 verifies).
- `ORCHESTRATOR_TEMPERATURE` (default: `0.7`)
- `ORCHESTRATOR_MAX_TOKENS` (default: `2048`)
- `FUNCTIONAL_CLASSIFIER_MODEL` (default: `"claude-haiku-4-5"` or `"gemini-flash-..."` — chunk B.7 picks)
- `FUNCTIONAL_CLASSIFIER_TEMPERATURE` (default: `0.2`)

Content:
- `SYSTEM_PROMPT_PATH` (default: `"../cms/prompts/why.md"`)
- `SKILLS_DIR` (default: `"../cms/skills"`) — for ADK-native skill loading in B.t9

Session:
- `SESSION_BACKEND` (`"in-memory"` | `"adk-native"` | `"vertex-ai"` | `"firestore"`; default: `"in-memory"`)
- `SESSION_TTL_IDLE_HOURS` (default: `24`)
- `SESSION_TTL_ARCHIVE_DAYS` (default: `7`)

Connector:
- `CONNECTOR_URL` (default: `"http://localhost:3001"`)
- `CONNECTOR_REQUEST_TIMEOUT_MS` (default: `10000`)

Server:
- `PORT` (default: `8080`)
- `NODE_ENV` (default: `"development"`)
- `CORS_ALLOWED_ORIGINS` (comma-separated; default: `"http://localhost:5173"`)

Warm pool (B.t10 uses):
- `WARM_POOL_SIZE` (default: `0` — disabled until B.t10)
- `WARM_POOL_TTL_MINUTES` (default: `30`)

### Per-agent model selection shape

```
interface ModelConfig {
  provider: "anthropic" | "google" | "other";
  model: string;
  temperature: number;
  maxTokens: number;
}
```

`getModelFor("orchestrator")` returns the orchestrator's config. `getModelFor("classifier")` returns the classifier's. Unknown roles → throw (no silent defaults).

### Tests

`config/__tests__/schema.test.ts` — schema passes on valid env, fails with readable errors on missing `ANTHROPIC_API_KEY`, invalid `PORT`, unknown `SESSION_BACKEND`.

### Updated `.env.example`

Mirror the full surface. Commit placeholder keys where needed (no real secrets).

---

## Key implementation notes

### 1. Single source of truth

No `process.env.X` anywhere in the codebase outside `config/load.ts`. Grep-enforceable.

### 2. Freeze after validation

`Object.freeze(config)` prevents accidental mutation at runtime.

### 3. Per-agent model defaults

Defaults are defined in code (`config/models.ts`), overridable by env vars. When B.t7 introduces the first functional agent, its role name gets added to the `models.ts` registry.

### 4. `NODE_ENV`

`"development"` enables dev-mode behaviours (prompt hot-reload, verbose logging, permissive CORS). Production disables all of these.

### 5. Sensitive values

`ANTHROPIC_API_KEY` is the only secret. Never log it. The config module can log a boolean "anthropic configured: true/false" but nothing more.

---

## References

- Zod docs — `z.string().url()`, `z.coerce.number().int().min(X)`, etc.
- `planning/02-impl-agent-runtime.md` §2.7.

---

## Verification

1. `cd product && npm run typecheck -w @swoop/orchestrator` passes.
2. Startup with a valid `.env` logs the config shape (redacting secrets).
3. Startup with missing `ANTHROPIC_API_KEY` exits with a readable Zod error.
4. Startup with `PORT=abc` exits cleanly.
5. `grep -r "process.env" product/orchestrator/src/ --exclude-dir=node_modules` returns matches only inside `config/load.ts`.
6. `getModelFor("orchestrator")` returns the expected shape.
7. `getModelFor("unknown")` throws.

---

## Handoff notes

- The warm pool config keys are reserved but not active — B.t10 flips `WARM_POOL_SIZE` default when wiring lands.
- Functional agent roles get added to `models.ts` as chunks introduce them — don't pre-populate ones we haven't built.
- Resist the urge to add "every config we might ever want". YAGNI.
