# 03 — Crosscut: Test-mode model picker (conversational agent)

**Status**: Ratified 2026-06-16 (HITL — Alastair: *"Start with just claude models, but bear in mind we would want to try others too soon. Write it up as a T3 plan. Commit. Then proceed."*). **Claude-only v1**; a non-Claude provider seam is designed in for a fast follow.
**Type**: Crosscut — `@swoop/orchestrator` (config + agent + runner + chat route + a dev endpoint) + `@swoop/common` (request schema) + `@swoop/ui` (dev dropdown). **No DB, no migration.**
**Why it exists**: let us flip the *conversational orchestrator* model at runtime — in dev/test only — so we (and Luke) can feel Sonnet vs Opus vs Fable on the same conversation without a redeploy. It is the cheap precursor to the in-the-wild conversion A/B (server-side model bucketing rides the same runner-registry seam later).

---

## Investigation findings (the load-bearing facts — verified 2026-06-16)

- The orchestrator model is `ORCHESTRATOR_MODEL` (config string, default `claude-sonnet-4-5-20250929`), resolved **once at boot** and baked into a single `ClaudeLlm` → one `LlmAgent` → one `Runner` ([factory.ts:66](../product/orchestrator/src/agent/factory.ts), [index.ts](../product/orchestrator/src/index.ts)). No per-request/per-session model today.
- `ChatRequestSchema` is `.strict()` but extensible — `clientTime` (B.t12) is the precedent ([routes.ts:44-58](../product/ts-common/src/routes.ts)); the UI attaches per-turn fields in [orchestrator-adapter.ts:430-440](../product/ui/src/runtime/orchestrator-adapter.ts).
- Warm pool ships disabled (`WARM_POOL_SIZE=0`, [schema.ts:178-184](../product/orchestrator/src/config/schema.ts)) → no pooled-model interaction to worry about.
- **GOTCHA — load-bearing:** `ClaudeLlm` hard-sends `temperature: 0.7` on every request ([claude-llm.ts:115,160](../product/orchestrator/src/agent/claude-llm.ts) — factory passes only `{model, apiKey}`, so the 0.7 default rides). **Opus 4.7, Opus 4.8, and Fable 5 removed `temperature`/`top_p`/`top_k` — sending any is an HTTP 400.** So per-family request-shaping is **mandatory**, not optional: a naive id-swap dropdown 400s on exactly the newest models. (Sonnet 4.5/4.6 and Opus 4.6 still accept `temperature`.) `ClaudeLlm` does **not** send a `thinking` param, so omitting it = no thinking, valid on every family — no thinking-side breakage.
- Model IDs are **bare aliases that resolve to the latest snapshot server-side** (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-fable-5`, `claude-haiku-4-5`). No client-side date-suffix logic. The live, account-available list comes from the **Anthropic Models API** (`client.models.list()` → `{id, display_name, max_input_tokens, max_tokens, capabilities}`; auto-paginates).
- The functional **classifier** (Haiku, via `getModelFor('classifier')`) is **out of scope** — the picker overrides the orchestrator only. ([config/models.ts](../product/orchestrator/src/config/models.ts) registry is untouched.)
- Aside (not this plan's job): `ORCHESTRATOR_TEMPERATURE`/`ORCHESTRATOR_MAX_TOKENS` in the schema are **not actually consumed by the orchestrator agent** (only the classifier uses `getModelFor`); the agent uses `ClaudeLlm`'s hardcoded 0.7/2048. Vestigial; a tidy for another day.

---

## Scope

**In (v1):** Claude families, dev/test-only, live per-request override, a lazy runner-registry, per-family sampling-strip, a `models.list()`-fed dropdown, new-session-on-switch.
**Out (designed-for, not built):** non-Claude providers (Gemini/GPT) — they need a *different* `BaseLlm` shim (the orchestrator's model layer is the Anthropic-specific `ClaudeLlm`), not just an id string. Leave the seam; ship as a fast follow.

---

## Decisions (to log in `planning/decisions.md` at build close)

- **M-PICK-1 — Lazy runner registry.** A `Map<modelId, Runner>` built **on demand**, not at boot. The default runner (= `ORCHESTRATOR_MODEL`) is constructed exactly as today. `getRunner(modelId?)` returns the cached per-model runner if the override is allowed (see M-PICK-2/3), else the default. All registry runners share the **one** `sessionService` + the same connector tools + `promptLoader` + skills the default uses — they differ *only* in the `ClaudeLlm` (model id + request-shaping). Swap cost: low — it's additive; if removed, `getRunner` collapses back to the single default runner.
- **M-PICK-2 — Override rides the request.** Optional `model?: string` on `ChatRequestSchema` (mirrors `clientTime`; schema stays `.strict()`). Honored **only when both**: (a) `!config.isProduction`, AND (b) `model ∈ MODEL_PICKER_ALLOWLIST`. Otherwise silently ignored → default runner. This is the cost/abuse gate: a real visitor can never force Opus.
- **M-PICK-3 — Dev-only on both ends.** UI gates the dropdown on `import.meta.env.DEV` (Vite strips it from prod builds). Orchestrator hard-ignores the override and 404s the model-list endpoint when `isProduction`. **No production surface, by construction.**
- **M-PICK-4 — Per-family request-shaping in `ClaudeLlm`.** A pure helper `modelAcceptsSamplingParams(modelId)` decides whether to include `temperature` (and `top_p`/`top_k` if ever added). Sampling-removed family = Opus 4.7+, Opus 4.8, Fable 5 → omit. Everything else keeps current behaviour. Written provider-neutral so a non-Claude model slots in.
- **M-PICK-5 — Model list from a dev-only endpoint.** `GET /models` (dev-only) → `client.models.list()` filtered to a curated **family allow-list** (the conversational-grade Claude families), returned as `[{id, displayName}]`. Auto-updates as Anthropic ships models; never offers a model the account can't call. 404 in production.
- **M-PICK-6 — Switching forces a new session.** The UI starts a fresh thread on model change (reuses `handleFreshChat`), so a model is fixed for a session's life — no mid-conversation swap, no shared-session-across-models edge case.
- **M-PICK-7 — Non-Claude deferred behind a provider seam.** Registry + request-shaping are written against `inferProvider(modelId)`; a future `GeminiLlm`/ADK-native `BaseLlm` builds the same way, keyed by provider. No rework of v1 needed.

---

## File-by-file

### Orchestrator (`product/orchestrator/src/`)
1. **`config/schema.ts`** — add `MODEL_PICKER_ALLOWLIST` (csv → de-duped `string[]`, default `[]` = feature off). Derive a `modelPickerEnabled` (allow-list non-empty AND `!isProduction`) onto the frozen `Config` in `config/load.ts`.
2. **`agent/claude-llm.ts`** — add `modelAcceptsSamplingParams(modelId)`; in the request build (`~:158`), include `temperature` only when it returns true. No behaviour change for Sonnet 4.x / Opus 4.6.
3. **`agent/factory.ts`** — `buildOrchestratorAgent` gains optional `modelId?: string` (default `config.ORCHESTRATOR_MODEL`); `ClaudeLlm` built with the chosen id. Skills/tools/instruction wiring unchanged.
4. **`agent/runner-registry.ts`** *(new)* — `createRunnerRegistry({ config, sessionService, buildAgentFor, appName })` → `{ getRunner(modelId?) }`. Lazy-builds + caches a base `Runner` per allowed model id, all sharing the injected `sessionService`. Resolution: dev + allow-listed → per-model; else default.
5. **`index.ts`** — construct the **one** `sessionService` explicitly (today it's implicit inside `InMemoryRunner` for non-postgres; switch that path to base `Runner` + a shared `InMemorySessionService` so the registry can share it — postgres path already injects `PgAdkSessionService`). Build the default runner + the registry from it. Pass a `getRunner` resolver (not a single `runner`) into the server wiring.
6. **`server/chat.ts`** — `ChatDeps` swaps the single `runner` for a `getRunner(modelId?)` resolver; resolve per request from `parsed.model`; everything downstream (`runAsync`, streaming, abort) unchanged.
7. **`server/models.ts`** *(new)* + wire in `server/index.ts` — dev-only `GET /models`; in production returns 404 via the same gate.
8. **`@swoop/common` `ts-common/src/routes.ts`** — `ChatRequestSchema` gains `model: z.string().min(1).optional()` (keep `.strict()`). Export stays the precedent shape.

### UI (`product/ui/src/`)
9. **`runtime/orchestrator-adapter.ts`** — read a dev model-store; when set (and dev), attach `model` to the `/chat` body next to `clientTime`.
10. **dev model store + `<ModelPicker>`** — a tiny store (the `fyi-channel`/dev-affordance pattern) + a `<select>` mounted in the chrome alongside existing dev affordances, **gated on `import.meta.env.DEV`**. On mount, fetch `GET /models`; on change, set the store **and** trigger `handleFreshChat` (new session for the new model). Empty/failed fetch → control hidden (graceful).

---

## Verification

- `npm run typecheck` green across workspaces; `npm test` for the touched workspaces.
- Unit: `modelAcceptsSamplingParams` truth table (Sonnet 4.5/4.6 + Opus 4.6 → true; Opus 4.7/4.8 + Fable 5 → false); registry resolution (dev+allowed → per-model, prod or not-allowed → default); `ChatRequestSchema` accepts `model`, rejects unknown keys.
- **Standing acceptance gate (tools/agent change → real-Anthropic smoke):** one Sonnet turn AND one `claude-opus-4-8` turn through `/chat`. The Opus turn is the load-bearing check — **without the sampling-strip it 400s**; with it, it streams. Fresh-install (`rm -rf node_modules && npm install`) before trusting green.
- Prod gate: with `NODE_ENV=production`, `getRunner('claude-opus-4-8')` returns the default runner and `GET /models` 404s.

---

## Non-Claude follow-up (the seam, not this commit)

Add a `GeminiLlm` (or ADK-native provider) `BaseLlm` shim; `inferProvider(modelId)` routes the registry to the right `buildAgentFor`. Request-shaping is already provider-aware (the helper generalises to "what does *this* provider/model accept"). The allow-list + dropdown gain the non-Claude ids; nothing in v1 is rewritten.

---

*Back-link: grew out of the 2026-06-16 Luke-feedback session (model-experimentation redirect on the "responses too long" item — see the feedback-doc reply). The in-the-wild conversion A/B that this unblocks is tracked as a production-first item in [questions.md](../questions.md) / [inbox.md](../inbox.md).*
