# Decision log — Puma

Running record of Tier 2 / Tier 3 decisions for the Swoop Web Discovery project (release: **Puma**).

**Format**: one entry per decision, reverse-chronological (newest at top). Each entry names the decision, the date it was closed, the owner, the rationale, and the swap cost (what would break if we changed our mind later).

**House rule**: any Tier 2 or Tier 3 decision gets an entry here. If it isn't logged, it isn't real. When a chunk closes, the executing agent adds the entries for decisions it closed. Future readers asking "why did we do this?" should find the answer here.

---

## B.15 — B.t7's functional agent is the pre-turn triage classifier (layer-2 proof); it runs on a direct `ClaudeLlm.generateContentAsync` call, not through a `Runner`

**Decided**: 2026-04-22
**Owner**: B.t7 executing agent
**Rationale**: B.t7 needed one minimum-viable functional agent to prove the two-layer agent model (planning/02-impl-agent-runtime.md §2.1). The Tier 3 plan proposed two candidates: (a) a search-side classifier that runs inside a tool call to pick filter dimensions, or (b) a pre-turn triage classifier that sits inside the orchestrator and tags `session.triage` before each turn. We picked (b). Why: (i) it sits purely inside the orchestrator, so the integration test can stub one seam (the classifier's `ClaudeLlmLike`) without standing up a second MCP round-trip; (ii) its output lands in `SessionState.triage` — a shape that already exists in `@swoop/common`, so no schema work was needed; (iii) the G.t0 HITL flow-mapping session will replace this placeholder with real Puma triage logic, giving the scaffolding a clear future owner; (iv) it demonstrates "different model per agent" visibly: Haiku runs on one turn, Sonnet on the next, and both appear distinctly in logs. The classifier is an ADK `LlmAgent` (same primitive as the orchestrator) configured from `getModelFor(config, 'classifier')`, but we invoke it via a direct `ClaudeLlm.generateContentAsync` call rather than through `Runner.runAsync`. Why skip the Runner: classification is one-shot with no tools, no multi-turn history inside the classifier itself, and no SSE to drive — running through a full `InMemoryRunner` would force us to maintain a parallel ADK session keyed on `(appName, userId, sessionId)` for every user turn solely to discard it after a single model call. `BaseLlm.generateContentAsync` is the ADK contract for "one model turn"; calling it directly is still ADK execution, just without the Runner loop sugar we don't need. The `LlmAgent` shell is kept so the classifier has the same shape as the orchestrator agent and so a future upgrade (e.g. giving the classifier its own tool for a richer classifier) reuses the same object without a type change. Invariants enforced: advisory-only (orchestrator's prompt can read the verdict but makes its own call), non-fatal (classifier errors / unparseable JSON fall back to `verdict: "none"` and log a warning — classification never blocks the user's turn), and auditable (every write carries `reasonCode: "triage_classifier_placeholder"` so G.t0's real classifier can distinguish its own verdicts from scaffolding residue).

**Swap cost**: Low. (a) If G.t0 lands a proper classifier with multi-step reasoning or its own tool calls, promote the classifier from "direct BaseLlm call" to "full Runner loop" inside the same file — the `ClaudeLlmLike` seam accommodates either. (b) If we later want parallel classifiers (e.g. a separate psych-profile agent) each gets its own role in `src/config/models.ts` and its own file under `src/functional-agents/`. (c) If the search-side classifier case (b-alt above) becomes useful later, it sits alongside the triage classifier with no shared state. (d) The `PLACEHOLDER_REASON_CODE` constant marks every placeholder write, so G.t0 can safely overwrite scaffolding verdicts without ambiguity.

## B.14 — `/chat` runs the ADK `InMemoryRunner` with ADK sessions pre-created at Puma session bootstrap

**Decided**: 2026-04-22
**Owner**: B.t5 executing agent
**Rationale**: B.t5 needed a concrete way to drive an agent turn from an HTTP request. ADK 1.0.0 exposes two routes: (a) `Runner.runEphemeral({userId, newMessage})` which creates and discards an ADK session per turn, (b) `Runner.runAsync({userId, sessionId, newMessage})` which expects a persistent ADK session. Puma keeps conversation history in its own `SessionStore` (B.12), so option (a) looked appealing — except `runEphemeral` takes a single `newMessage: Content`, with no way to seed prior-turn history, meaning multi-turn conversations would forget everything each turn. Option (b) requires coordinating two session stores (ours + ADK's). We chose (b) with a simple coordination rule: on `POST /session`, `src/index.ts` creates both a Puma session (via `SessionStore.create`) AND a matching ADK session (`runner.sessionService.createSession` under a fixed `appName: 'puma-orchestrator'` and `userId: 'anonymous'`). The two share the same `sessionId`. This lets the Runner own the model's conversation context (genai `Content[]`) while the Puma store owns typed state (triage, consent, wishlist, reasoning for audit) — each store handles exactly what its shape is designed for, and the one-to-one keying means no lookup table is needed.

**Swap cost**: Low. The coordination is one `onSessionCreated` hook in `src/index.ts`. When Vertex AI Session Service lands (post-M4), the same hook pattern re-targets to a different ADK `BaseSessionService`. If ADK later gains a history-seeded `runEphemeral` variant we can simplify to option (a) with no API surface change outside `src/index.ts` + `server/chat.ts`'s `runAgentTurn`.

## B.13 — Response format (B.9 resolved): ADK natives for three of four block types; state-machine parser scoped to `<fyi>` only

**Decided**: 2026-04-22
**Owner**: B.t4 executing agent
**Rationale**: B.9 from planning/02-impl-agent-runtime.md §5 left the response-format plumbing open pending a Phase 1 spike on whether ADK + AI SDK natives cover the four `<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>` block types cleanly. Spike was fixture-based (real Anthropic wiring lands in B.t5 so a live-model spike isn't available yet — planning/03-exec-agent-runtime-t4.md explicitly sanctions this fallback). Spike outcome: **scenario 2 — partial coverage**. Evidence from `@google/adk@1.0.0` source (`dist/types/events/event.d.ts`, `dist/types/models/llm_response.d.ts`, and `@google/genai` `Part` shape):

- `Part.thought: boolean` + `Part.text` → clean native mapping for `<reasoning>`. `toStructuredEvents()` classifies these as `THOUGHT`.
- `Part.text` (thought !== true) → clean native mapping for `<utter>`. `toStructuredEvents()` classifies these as `CONTENT`.
- `Part.functionCall` / `Part.functionResponse` → clean native mapping for `<adjunct>` (widget hydration rides the tool-call lifecycle, matching chunk D's assistant-ui registry which already uses `input-streaming` / `input-available` / `output-available`).
- `<fyi>` has **no native analogue**. ADK's `ActivityEvent` (`kind: string; detail: Record<string, unknown>`) is for runtime/status signals emitted by agents & tools (e.g. a tool entered an auth flow), not model-authored side-channel notifications inline with `<utter>` content. The ADK's `Plugin` / callback model also doesn't fit — we want the model to *decide* when to emit a user-visible side-note mid-sentence, and that means the text stream is where those emissions live.

**Outcome**: The state-machine parser is built, but its scope is narrowed to **only `<fyi>`**. `<reasoning>`, `<utter>`, and `<adjunct>` ride native ADK channels end-to-end and never enter the parser's text stream, which is what makes the "inline tag mention" failure mode (flagged in planning/02-impl-agent-runtime.md §2.5a) a non-issue for this scoped parser — the only nested-tag case is an `<fyi>` string appearing inside another `<fyi>`, which the parser correctly treats as literal body text (flat, no depth counting). Chunk G's system prompt (to be authored later) will instruct Claude to (a) use thinking blocks for reasoning, (b) use tool calls for adjuncts/widgets, (c) emit `<fyi>...</fyi>` inline in text for ephemeral side-notifications, and (d) put everything else in plain text for `<utter>`. Reasoning filtering remains unconditional (see translator's `reasoning-filter.ts`) — whether reasoning arrives as `Part.thought`, an AI SDK `reasoning` part, or (hypothetically) `<reasoning>` in free text, it never reaches outbound SSE. B.t5's `ClaudeLlm.generateContentAsync` is responsible for mapping Anthropic thinking blocks to `Part.thought === true` on ingest.

**Swap cost**: Low. If the model starts emitting `<reasoning>` / `<utter>` / `<adjunct>` as free text against prompt instructions (prompt-engineering drift), extend `BlockParser` to handle those tags — the state machine generalises to multiple tag names cheaply. If Anthropic or ADK evolves a richer side-channel that subsumes `<fyi>`, the parser is one file to delete and a call site to remove. No `@swoop/common` schema change is implied either way: `DataFyiPart` remains the wire representation whether sourced from parsed text or a native event.

---

## B.12 — Session store: custom `SessionStore` interface over ADK, not ADK-native passthrough

**Decided**: 2026-04-22
**Owner**: B.t2 executing agent
**Rationale**: Tier 3 B.t2 posed the question: if ADK's native `SessionService` in-memory mode covers everything Puma needs, just use it. Inspected `@google/adk@1.0.0`: the public session surface is `getSessionServiceFromUri('memory://')` returning a `BaseSessionService` whose session shape is `{ id, appName, userId, state: Record<string, unknown>, events, lastUpdateTime }` — keyed on the `(appName, userId, sessionId)` triple with an opaque `state` blob and an append-only event log. Puma's `SessionState` (per `@swoop/common`) is typed: discriminated-union triage verdict, structured consent state with `copyVersion` tracking, wishlist items, conversation-history entries with block types. Two viable paths: (a) store the typed `SessionState` as an opaque value inside ADK's `state` blob and wrap ADK's service behind our own `SessionStore` interface; (b) define our own `SessionStore` interface and back it with a plain `Map<string, SessionState>` plus a lifecycle sweeper for Phase 1. We chose **both, behind the same interface**. `SessionStore` is the seam; the `in-memory` backend is a `Map`-backed adapter that owns the idle→archive→delete sweeper (24h idle, 7d archive — per chunk B §2.6a and chunk E §2.3); the `adk-native` backend wraps `getSessionServiceFromUri('memory://')` for slices that want ADK's event log / multi-user tenancy later. The custom in-memory adapter is not redundant — ADK's session service has no archive concept, no injectable clock for deterministic sweeper tests, and its triple-key API would require a sessionId→(appName,userId) side table if used alone. `vertex-ai.ts` and `firestore.ts` are interface-shaped stubs that throw "not implemented" at first use (startup stays clean); production selection is post-M4 per top-level B.2.
**Swap cost**: Zero between dev backends — flip `SESSION_BACKEND=in-memory|adk-native` in env. Low to graduate a stub: the interface is stable, so wiring Vertex AI Session Service or Firestore means filling in one file. If ADK ships a first-party archival + typed-state primitive in a future minor, the custom in-memory adapter can be retired with a one-backend swap.

## B.11 — Claude provider for ADK: local `BaseLlm` shim, not community adapter

**Decided**: 2026-04-22
**Owner**: B.t1 executing agent
**Rationale**: `@google/adk@1.0.0` (published 2026-04-21) ships Gemini and Apigee provider classes only — no first-party Anthropic/Claude wrapper. Three paths exist to run Claude under ADK: (a) community packages like `adk-llm-bridge` or `@auto-engineer/adk-claude-code-bridge`; (b) write our own `BaseLlm` subclass that calls `@anthropic-ai/sdk` directly; (c) wait for Google to ship Claude support upstream. We chose (b). ADK's `BaseLlm` contract is small and stable (two abstract methods: `generateContentAsync`, `connect`), keeping a local shim is one file, and it avoids a third community dep whose versioning/maintenance posture we don't yet trust. B.t1 lands the shim with stub implementations that throw a clear "not yet wired — B.t5" error; the real translation between ADK's `LlmRequest`/`LlmResponse` shapes and Anthropic's Messages API lands in B.t5 when the SSE endpoint first routes user turns to the model.
**Swap cost**: Low. If Google ships a first-party Anthropic provider later, swap `ClaudeLlm` for the upstream class in `src/agent/factory.ts` — zero callers outside the factory touch this type. If a community adapter becomes compelling, likewise. The shim is roughly 30 LOC; the real implementation lands in B.t5 inside the same file.

## B.1a — ADK JS version pin: `@google/adk ^1.0.0`

**Decided**: 2026-04-22
**Owner**: B.t1 executing agent
**Rationale**: `@google/adk@1.0.0` shipped 2026-04-21, one day before B.t1 execution. Pinning to `^1.0.0` accepts minor/patch upgrades under the 1.x stability contract Google has just adopted with the 1.0.0 release. We reject pinning `1.0.0` exactly — that denies ourselves bugfixes without protection against breakage we don't get anyway (TypeScript catches most API shape drift at our typecheck step). We reject `*` — that invites major-version surprises. This decision is the concrete realisation of the "ADK-version pinning" item flagged as deferred in planning/02-impl-agent-runtime.md §5.
**Swap cost**: Low for minor/patch bumps (npm update + retypecheck). Medium for a 2.x bump (may reshape `LlmAgent` or `BaseLlm`, both of which are load-bearing for us; cadence decided reactively per planning/02-impl-agent-runtime.md §5).

## B.1b — Orchestrator default Claude model: `claude-sonnet-4-5-20250929`

**Decided**: 2026-04-22
**Owner**: B.t1 executing agent
**Rationale**: Decision B.5 already committed to per-agent model selection with Claude Sonnet leaning for the orchestrator. B.t1's concrete pin picks `claude-sonnet-4-5-20250929`, the current Sonnet at implementation date. Default is set inside `src/config/index.ts`; `PRIMARY_MODEL` in env overrides. B.t6 lifts this into a proper config-file surface. Decision logged so the "why this model id?" question has an answer in the audit trail.
**Swap cost**: Zero. Override via the `PRIMARY_MODEL` env var. No code change required to move tiers within the Claude family; a move off Claude entirely would mean replacing `ClaudeLlm` in `src/agent/factory.ts` (see B.11 swap cost).

## A.9 — Workspace package scope: `@swoop/*`

**Decided**: 2026-04-22
**Owner**: Al (resolved during A.t5 by the executing agent)
**Rationale**: A.t1 scaffolded the workspace root `product/package.json` with the name `@swoop-web/product` and referenced `@swoop-web/common` inside `product/CLAUDE.md`. A.t2 then populated `ts-common/` as `@swoop/common` and A.t4 scaffolded downstream placeholders as `@swoop/{orchestrator,connector,ui,ingestion}`. The majority convention across planning docs (e.g. `planning/02-impl-foundations.md` §2.1, §9.8) is `@swoop/*`. Normalising on `@swoop/*` is the minimum-drift choice: it matches the PoC carry-forward convention, the current state of five out of six packages, and every planning-doc reference. The root workspace package renamed `@swoop-web/product` → `@swoop/product`. `product/CLAUDE.md` updated accordingly. `package-lock.json` will self-correct on the next `npm install`.
**Swap cost**: Low. Scope is a cosmetic namespace; re-scoping again costs a find-replace across `package.json` files + one `npm install` to regenerate the lockfile.

## A.8 — Local persistence during Phase 1 vertical slice

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: In-memory / file-backed adapters behind `ts-common` session / handoff store interfaces. Skips the Firebase Emulator setup pain entirely and keeps the deploy surface uniform. When real persistence genuinely matters (post-M4), connect to a real GCP dev Firestore (or whichever store gets picked in chunk B/E) — all integration happens against real GCP, not an emulator.
**Swap cost**: Low. Interface-first design means swapping the in-memory adapter for a real store changes one file per store and leaves consumers untouched.

## A.7 — Runtime target: Cloud Run for all deployables

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Services (orchestrator, connector) and any scheduled / batch jobs (scraper or API-ingest) all run on Cloud Run. Uniform deployment surface, avoids Firebase Functions scope creep and the Firebase Emulator yak-shave. Firebase Functions remains a future option if a concrete need appears that Cloud Run + Cloud Scheduler can't serve.
**Swap cost**: Medium. Cloud Run → Cloud Functions per-service is a deploy-pipeline rewrite and some code changes (handler signature + cold-start posture); no data-model implications.

## A.6 — Test runner at foundation level: Vitest, no tests authored yet

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: The real test surface for Puma is the Tier 2 chunk H validation harness, not per-package unit-test suites. Vitest gets scaffolded at the foundation level so future chunks (translator layer, classifier, any pure-function utility) can drop focused tests in when failure modes are narrow and fixtures are cheap. No tests are authored in chunk A beyond the single fixture round-trip check in `ts-common/`.
**Swap cost**: Low. Vitest → Jest (or whatever) is a devDependency swap plus minor API differences; no production code touches the runner.

## A.5 — CI provider: GitHub Actions, re-evaluate at M4

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Lowest friction to start; Al and the Swoop in-house team already know it. Cloud Build is more "native" for the GCP handover narrative and worth switching to if the deploy pipeline starts to want it. Revisit at M4 when deployment becomes real.
**Swap cost**: Medium. One workflow-file rewrite per job; secrets and cache get reconfigured but the test/lint/build commands carry across unchanged.

## A.4 — Node + TypeScript versions: Node 20 LTS, TypeScript 5.x

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Standard, boring, matches PoC de facto. Node 20 LTS pinned via `.nvmrc` at the repo root; TypeScript 5.x pinned in `product/package.json` devDependencies.
**Swap cost**: Low for a minor bump (change `.nvmrc` + `devDependencies`), medium for a Node major (Cloud Run runtime change + CI matrix + any transitive native deps).

## A.3 — Lint + format: ESLint + Prettier

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: PoC had neither. Julie's production bar justifies adding them; Swoop's in-house team is familiar. ESLint + Prettier is the conservative choice. Biome (faster, single tool) is the alternative if CI times later demand it. `eslint-config-prettier` disables stylistic ESLint rules that would fight Prettier — ESLint owns correctness, Prettier owns style.
**Swap cost**: Low. Biome is a drop-in replacement at the config layer; config files get rewritten once.

## A.2 — Branching strategy: trunk-based with per-stream `STREAM.md`

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Vertical-slice-first execution means a single agent on `main` until M1. Post-M1 fan-out to 2–4 parallel agents still doesn't warrant long-lived branches at this scale — each agent works on a named branch, PRs into `main`, CI catches interface drift within minutes. Per-package `STREAM.md` holds the agent's working context so they don't collide. Worktrees are the escape hatch if parallel agents start trampling each other.
**Swap cost**: Low. GitFlow / release-branch patterns can be layered on later with no code change.

## A.1 — Workspace tooling: npm workspaces

**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Closest to the PoC (plain npm, no extra tooling); zero new vocabulary for Swoop's in-house team; no compelling Puma-scale reason to introduce pnpm / Turborepo / Nx. Revisit if build times become painful.
**Swap cost**: Low. Re-initialising with pnpm or a task-runner like Turborepo is a few hours' work; the schema of per-package `package.json` files survives unchanged.
