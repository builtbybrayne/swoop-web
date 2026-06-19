# 03 — Crosscut: Test-mode thinking toggle (conversational agent)

**Status**: Ratified 2026-06-19 (HITL — Alastair: *"Quick T3 plan, then execute"*). Sibling to [03-exec-crosscut-test-mode-model-picker.md](03-exec-crosscut-test-mode-model-picker.md) (M-PICK); reuses its runner-registry and the `isDevToolsEnabled()` UI gate (the 2026-06-19 demo-affordances fix).
**Type**: Crosscut — `@swoop/orchestrator` (config + factory + runner-registry + chat route) + `@swoop/common` (request schema) + `@swoop/ui` (dev checkbox). **No DB, no migration.**
**Why it exists**: a dev/test-only checkbox beside the model picker that flips native thinking per session — same effect as `ORCHESTRATOR_THINKING_ENABLED` — so we (and Luke) can feel thinking-on vs thinking-off on the same conversation without a redeploy.

---

## Investigation findings (load-bearing — verified 2026-06-19)

- **Thinking is a per-runner property, NOT a per-request param.** Flipping it changes two things baked into the agent at construction: (a) the `messages.create` fragment via `new ClaudeLlm({ thinkingEnabled, effort })` ([factory.ts:139](../product/orchestrator/src/agent/factory.ts)), AND (b) the **system prompt** — the RL.3 silent-working belt is spliced in **only when thinking is OFF** ([factory.ts:175](../product/orchestrator/src/agent/factory.ts) → `buildThinkingFallbackInjection`), and the system prompt is part of the cached prefix ([index.ts:267-273](../product/orchestrator/src/index.ts)). So a thinking override needs its own agent/runner variant — exactly what M-PICK's registry already provides.
- The M-PICK runner-registry ([runner-registry.ts](../product/orchestrator/src/agent/runner-registry.ts)) keys runners by `modelId`, lazily builds+caches, and shares one `sessionService`. We widen the key to **`(modelId, thinkingEnabled)`**.
- `effort` is a pure per-request param and stays **server-side config** (the schema calls it "NOT a UI lever"). Out of scope here.
- Thinking on/off is valid on **every** Claude family (`buildThinkingFragment` branches per family); **no allow-list** needed (unlike `model`, where the allowlist gates Opus cost/abuse).
- `ChatRequestSchema` is `.strict()` but additively extended — `model` (M-PICK) and `clientTime` (B.t12) are the precedents ([routes.ts:93](../product/ts-common/src/routes.ts)).
- The UI gate `isDevToolsEnabled()` ([dev-tools.ts](../product/ui/src/runtime/dev-tools.ts)) already governs the dev affordances, incl. the model picker, in `App.tsx`.

---

## Decisions (TT-1..TT-6; log in `planning/decisions.md` at build close)

- **TT-1 — Runner variant, via the M-PICK registry.** A thinking override resolves a per-`(model, thinking)` runner; reuse `createRunnerRegistry`, widen the cache key. Shared `sessionService` unchanged → history keeps working.
- **TT-2 — Override rides the request.** `thinkingEnabled?: boolean` on `ChatRequestSchema` (mirror `model`; keep `.strict()`).
- **TT-3 — Gated `!isProduction`, NO allow-list.** Honoured only outside production. Derive `config.thinkingPickerEnabled = !isProduction` in `config/load.ts` next to `modelPickerEnabled`; baseline is `config.ORCHESTRATOR_THINKING_ENABLED`. In production the override is ignored (→ config default).
- **TT-4 — Dev-only on both ends.** UI checkbox gated on `isDevToolsEnabled()`; orchestrator ignores the field when `isProduction`. No production surface.
- **TT-5 — Toggle forces a new session.** Changing thinking re-mints the session (reuse the model-picker fresh-chat handler), since thinking changes the cached prefix; mid-conversation flip would mix prefixes. One "fresh chat on any dev override change" path.
- **TT-6 — Effort stays config.** The checkbox is on/off only; `ORCHESTRATOR_EFFORT` is untouched.

---

## File-by-file

### Orchestrator (`product/orchestrator/src/`)
1. **`config/load.ts`** — derive `thinkingPickerEnabled: data.NODE_ENV !== 'production'` onto the frozen Config (sibling to `modelPickerEnabled`). Schema field on `Config` interface in `config/schema.ts`.
2. **`agent/factory.ts`** — `buildOrchestratorAgent` gains `thinkingEnabled?: boolean` (default `config.ORCHESTRATOR_THINKING_ENABLED`). Thread the **resolved** value into BOTH `new ClaudeLlm({ thinkingEnabled })` AND the belt: change `buildThinkingFallbackInjection` to take the resolved boolean (not read `config.ORCHESTRATOR_THINKING_ENABLED` directly) so the belt tracks the override.
3. **`agent/runner-registry.ts`** — `getRunner(modelId?, thinkingEnabled?)`; composite cache key `${model}|${thinking}`; model dimension gated by existing allowlist logic, thinking dimension by `thinkingPickerEnabled`; `buildAgentFor(modelId, thinkingEnabled)`. Default runner still returned when no dimension overrides.
4. **`index.ts`** — pass `defaultThinking` (= config default) + the thinking gate into the registry; the `buildAgentFor` closure forwards thinking to `buildOrchestratorAgent`. Greeting pre-warm keeps its dedicated thinking-off runner (unaffected — conversational turns only).
5. **`server/chat.ts`** — destructure `thinkingEnabled` from `parsed.data`; `getRunner(model, thinkingEnabled)` at the turn-runner resolution.

### Common (`product/ts-common/src/`)
6. **`routes.ts`** — `thinkingEnabled: z.boolean().optional()` on `ChatRequestSchema`.

### UI (`product/ui/src/`)
7. **`runtime/dev-thinking-store.ts`** *(new)* — clone of `dev-model-store.ts`: tab-scoped boolean override, gated on `isDevToolsEnabled()`, `get/set/useDevThinkingOverride` + `resetDevThinkingStore`.
8. **`runtime/orchestrator-adapter.ts`** — attach `thinkingEnabled` to the `/chat` body next to `model` (only when set).
9. **`App.tsx`** — a labelled checkbox in the dev block beside `<DevModelPicker>`; on change set the store + trigger the fresh-chat handler.

---

## Verification
- **Unit**: registry resolves a distinct runner for a thinking override (and the default in prod / when unset / when equal to default); `ChatRequestSchema` accepts `thinkingEnabled` + rejects unknown keys; factory threads thinking into ClaudeLlm + belt (belt present iff resolved thinking OFF); UI store round-trips + gates on `isDevToolsEnabled()`.
- **Typecheck** across touched workspaces; `npm test` for common / orchestrator / ui.
- **Standing acceptance gate (agent-graph change → real-Anthropic smoke)**: one thinking-ON and one thinking-OFF turn through `/chat`, confirming the wire carries no reasoning either way and the belt presence flips. Operator-pending (needs `ANTHROPIC_API_KEY`).
