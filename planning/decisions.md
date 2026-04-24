# Decision log — Puma

Running record of Tier 2 / Tier 3 decisions for the Swoop Web Discovery project (release: **Puma**).

**Format**: one entry per decision, reverse-chronological (newest at top). Each entry names the decision, the date it was closed, the owner, the rationale, and the swap cost (what would break if we changed our mind later).

**House rule**: any Tier 2 or Tier 3 decision gets an entry here. If it isn't logged, it isn't real. When a chunk closes, the executing agent adds the entries for decisions it closed. Future readers asking "why did we do this?" should find the answer here.

---

## G.10 — Style control authoring: paired positive-example paragraphs + explicit avoidance list

**Decided**: 2026-04-24
**Owner**: Al (raised during wave-1 reconvene after observing em-dash-heavy cringe-AI output in live testing)
**Rationale**: The existing §2.1 of `02-impl-content.md` positioned the WHY prompt's voice guidance as "a couple of illustrative paragraphs, not a style guide. Show, don't tell." Real output during D.t5 verification exposed the limit of that stance — Claude honours stylistic examples but regresses toward defaults under load (long conversations, tool orchestration, strong lean on the visitor's own phrasing). Defaults include em-dash-heavy rhythm, corporate hedges ("it's worth noting"), AI-signature verbs ("delve", "unpack", "dive into"), empty-affirmation openers ("Great question!"), and trailing offers ("Let me know if…"). None of these read like "knowledgeable friend who's been to Patagonia". Splitting voice control into two artefacts: (a) positive-example paragraphs in `cms/prompts/why.md` (anchors "good"), (b) explicit avoidance list at `cms/prompts/style-avoid.md` referenced from the WHY prompt (suppresses specific defaults). The avoidance list is a living doc — as real conversations surface new tells, they get added. F's event log is the long-term source for regression-pattern capture.

**Swap cost**: Low. If a third layer is needed (e.g. runtime style-linting of assistant output before it hits the wire), add a `postprocess/style-lint.ts` hook inside the orchestrator translator — doesn't touch the content files. Collapsing the two files back into one is a text merge; splitting was specifically to decouple the taste-driven positive pass (Al authors once) from the pattern-driven avoidance list (updates whenever new offenders appear).

## H.13 — CI gating: non-gating (`continue-on-error: true`) at Puma launch

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Realises the commitment already made at Tier 2 chunk H §H.4. Rationale stands: the harness doesn't yet have a calibrated judge (H.t5) or a real scenario set (H.t4 via G.t0), so gating on it would block PRs on arbitrary failures. Non-gating means the markdown report attaches as a PR comment via `actions/github-script`, exit code stays 0, and reviewers see regression signal without automation enforcing it. Promotes to gating post-H.t5 calibration once confidence is warranted.

**Swap cost**: Low. One line (`continue-on-error: true` → `false`) in `.github/workflows/harness.yml` when it's time to gate. No code changes.

## H.12 — Harness does not import `@swoop/common/events` in scaffold

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent (per offer from planner-e1f during wave-1 planning negotiation)
**Rationale**: planner-e1f (F-a) offered live import of the event schema so harness scenarios could assert on emitted events. Harness scaffold declined. Reason: scaffold's only assertion kinds are `contains` / `not_contains` on final utterance text; it doesn't inspect events at all yet. Event-log assertions land in H.t3 alongside the real assertion catalogue; by then F-a's schema has had time to settle and any churn in kinds doesn't ripple through the harness twice. Keeping the import surface loose in scaffold also means harness can run against a ts-common version without `events.ts` present (defensive against branch-order mismatches in early build-up).

**Swap cost**: Zero. Adding the import in H.t3 is a one-liner per assertion file; no structural change.

## H.11 — Orchestrator invocation: local HTTP against a running `:8080`, not in-process import

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Two paths. (a) Start the orchestrator in-process inside the harness (import `createApp` directly, run against it via supertest or a fetch polyfill). (b) Assume a running `:8080` orchestrator (started by the CI job as a separate step, or locally by the developer) and hit it with `fetch`. We chose (b). Rationale: (i) matches production topology — the harness exercises the HTTP + SSE surface exactly as the UI does, not a simulated one; (ii) in-process import would require refactoring the orchestrator's Express app to expose `createApp` as a factory separate from its top-level bootstrap, which is non-trivial for a scaffold and bleeds harness scope into chunk B; (iii) the cost is one extra CI step (`orchestrator &`) which is cheap; (iv) developers running locally already have the orchestrator up for the UI anyway — no new setup burden. Swap cost is also low if this becomes painful later.

**Swap cost**: Medium. Moving to in-process import requires (1) refactoring orchestrator entrypoint to expose a factory function, (2) rewiring `orchestrator-client.ts` to call it directly, (3) handling module-scoped state the orchestrator currently initialises at top-level. Revisit if CI wall-time becomes a concern (current expectation: seconds, not minutes).

## H.10 — Scenario file format: YAML, one scenario per file, under `product/harness/scenarios/`

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Three candidates: (a) JSON, (b) TypeScript, (c) YAML. Chose (c). Rationale: (i) scenarios contain multi-line prompts + multi-line expected phrases; JSON's `\n`-escaping makes these ugly in PR diffs; (ii) TypeScript would be most type-safe but turns content authoring into a code-review exercise — G.t0's HITL output needs to land as authorable files, not `.ts` modules; (iii) YAML gives clean multi-line strings, one-file-per-scenario keeps diffs scoped, and `yaml` + `zod` together give runtime-validated typed loading. One file per scenario — NOT one file listing all scenarios — so PR diffs are per-scenario and naming is the numbering scheme. Suffix `.yaml`, not `.yml`, matching the broader Node ecosystem.

**Swap cost**: Low. If YAML ergonomics fail (e.g. scenarios grow features that want richer validation), migration to TS-as-content is a one-file-per-scenario rewrite with the Zod schema already in place — same types, different loader.

## H.9 — Test runner: bespoke Node CLI, not vitest

**Decided**: 2026-04-24
**Owner**: H.t1 executing agent
**Rationale**: Counter-intuitive choice — vitest is the de-facto runner elsewhere in the repo (UI + orchestrator + ts-common). Picked bespoke CLI for three reasons. (i) **Output format**: vitest's reporter shape is test-runner-shaped (pass/fail/error with stack); the harness wants an evaluation-report shape (verdicts, judge commentary, scenario-level narrative). Fighting vitest's reporter to produce the latter is more code than writing a small dedicated reporter. (ii) **Exit-code semantics**: vitest exits non-zero on assertion failure; the harness needs to exit 0 during Puma pre-launch (non-gating) regardless of pass/fail — fightable in vitest but a natural default in a bespoke CLI. (iii) **Content-as-data boundary**: scenarios are content authored by non-engineers eventually. Piping them through a test-runner frames them as tests; piping them through an evaluation CLI frames them as evaluations. The latter is correct. Vitest stays in for the harness's own unit tests (assertion helpers, scenario loader) — those ARE tests.

**Swap cost**: Low. If vitest later grows reporter plugins / exit-code overrides that close both gaps, the CLI is ~200 LOC that could be replaced with a vitest custom reporter. The scenario format, assertions, and judge interface are reporter-independent.

---

## D.20 — Preflight scope: post-consent only

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Preflight fires only when `hasConsented === true`. Pre-consent there is no server-side session id to probe — the consent gate is the natural boundary between "no orchestrator state exists yet" and "orchestrator owns a session on this visitor's behalf". The hook takes `enabled: hasConsented` from `useConsent`; flipping it false (on reset / decline) tears down listeners cleanly via the effect cleanup. Also means the OpeningScreen surface is completely insulated from preflight logic — the new `session/` module has zero pre-consent footprint.

**Swap cost**: Low. If a future surface needs a "can the orchestrator even be reached?" health probe pre-consent, add a separate hook; do not widen `usePreflight`'s scope. The two concerns (session liveness vs. service reachability) are distinct even if they share a probe endpoint.

## D.19 — Preflight failure path: `[session_not_found]` via the shared adapter emitter; probe network errors stay silent

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: The Tier 3 plan needed to decide how a preflight-detected expiry should reach the UI. Two options: (a) invent a new channel (a dedicated `onExpired` prop or a second emitter) that the banner subscribes to in parallel with the existing `subscribeAdapterErrors`; (b) reuse the D.12 module-level emitter and encode expiry with the same `[session_not_found]` marker convention `/chat` 404s already use. We chose (b). Rationale: (i) D.12's invariant is "one wire for comms failures" — fracturing that wire into two parallel channels defeats the design; (ii) the classifier's marker matching (`errors/classify.ts`) already routes `[session_not_found]` to `session_expired` without any code change; (iii) the banner's "Start a new conversation" button already chains through `handleFreshChat → refreshSession`, which is exactly the action we want on preflight-detected expiry too; (iv) copy, classification, and UX are identical to the reactive path, so the visitor experience is consistent regardless of which channel detected the expiry. A strict corollary: probe-side `"network_error"` results are NOT emitted. A probe that can't reach the server is evidence of probe unreliability (flaky network, CORS hiccup) not evidence of expiry — emitting would cry-wolf. `/chat` is the authoritative failure channel for "server unreachable" via D.t5's `unreachable` surface; if the probe is blocked but the server is alive, the next user message detects it honestly.

**Swap cost**: Low. Adding a second emitter later (e.g. for preflight-specific telemetry in chunk F) is additive; the current wire-to-the-banner arrangement stays. If the classifier's marker convention ever changes (`[session_not_found]` → something else), update both the adapter and this hook in the same patch — they share the contract by design.

## D.18 — Long-idle preflight threshold: 15 minutes (module constant `IDLE_PREFLIGHT_MS`)

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Two anchoring numbers set the window. Lower bound: the orchestrator's in-memory `idleTtlMs` default is 24 hours (B.t2 `in-memory.ts`), so any threshold well below that catches expiry before the sweeper runs. Upper bound: natural pauses in a discovery conversation (reading a widget, grabbing coffee, checking email) are typically under 10 minutes. 15 min sits unambiguously past "coming right back" without chattering during normal reading pauses. Exposed as a module-level constant in `session/preflight.ts` rather than an env var or CMS-backed config — Puma has no second tuning to justify the plumbing, and promotion is a one-liner when it's needed. The `visibilitychange` trigger is the more frequent check in practice; the idle interval is belt-and-braces for the "tab visible but untouched" case (paused mid-scroll) that `visibilitychange` doesn't cover.

**Swap cost**: Low. Changing the number is one-line in `preflight.ts`. Promoting to an env var adds an entry to `config/schema.ts` on the orchestrator side + a Vite env variable on the UI side — trivial when a second production tuning genuinely needs it.

## D.17 — Preflight triggers: mount + visibilitychange(visible) + long-idle interval, debounced 2s with in-flight guard

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Three triggers, each earning its place. **Mount**: fires once when the hook first sees `enabled && sessionId`. Catches the "reloaded after the orchestrator restarted" case before the visitor types. **visibilitychange → visible**: fires when the tab returns to focus. Catches the "alt-tabbed, came back minutes later, session archived in the meantime" case — the single most common expiry flavour in practice. **Long-idle interval**: fires every `IDLE_PREFLIGHT_MS` (see D.18). Belt-and-braces for the "tab visible but untouched" case that `visibilitychange` misses. Concurrency rules: (i) in-flight guard — at most one probe outstanding at any time; a second trigger while one is pending no-ops cleanly. (ii) 2s debounce across all trigger sources — absorbs React 18 strict-mode double-invokes AND rapid focus/blur storms that some OS notifications cause. Not adding `mousemove`/`keydown`-based activity trackers; they'd be the natural "super-precise idle" signal but introduce listener churn, Puma's stream-drop rate is expected low, and the plan's simpler triggers are sufficient for the expected expiry-detection coverage. Revisit if F's telemetry shows the visitors missing expiry detection in practice.

**Swap cost**: Low. Adding a fourth trigger (e.g. after successful tool-call completion) is an additive change inside `use-preflight.ts`; the debounce + in-flight guard absorb new callers without other edits. Tightening the debounce from 2s → shorter if genuinely needed is one constant bump.

## D.16 — Preflight endpoint shape: `GET /session/:id/ping` always 200, verdict in body

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: Two shapes were viable. (a) Reuse HTTP semantics: `GET /session/:id/ping` returns 200 for known sessions, 404 for unknown. (b) Body-carries-verdict: always 200 with `{ok, expired, serverTime}`. We chose (b). Rationale: (i) the probe fires repeatedly per visit (mount + tab-focus + idle ticks); a 404 from an otherwise-healthy origin trips a subset of corporate proxies / CORS implementations into treating the origin itself as flaky, which would cry-wolf into the UI's `unreachable` path and defeat the entire purpose of the preflight; (ii) keeping discriminator logic body-side means the handler can be extended later (surface "archived" vs. "live" vs. "unknown" separately) without revising the status-code contract; (iii) treating the probe as an always-200 routine keeps its CORS preflight trivial — the existing global `GET,POST,PATCH,DELETE,OPTIONS` allow-methods header covers it with no per-route overrides. Archived sessions are conflated with live ones for Puma (plan §Key notes option c): `SessionStore.get` returns non-null for archived entries too, and an archived session already fails `/chat`'s consent gate and looks identical to "live-but-non-accepting" from the visitor's POV — no UX distinction to preserve. Shape `{ok: boolean, expired: boolean, serverTime: string}` reserved with planner-e1f for `@swoop/common`'s `SessionPingResponse`; if e1f's chosen field names differ, the rename is a single-import-line change in both `session/preflight.ts` and `server/session-ping.ts`.

**Swap cost**: Low. Adding a status field (`status: 'active'|'archived'|'unknown'`) for a richer UX later is additive. Moving to HTTP-semantic statuses (404 for unknown) is purely a handler-side change — the UI still reads `ok` and `expired` — but doing so regresses on the CORS / proxy concern, so we'd need a concrete reason.

## D.15 — SSE reconnection policy: client-driven manual retry only (status quo)

**Decided**: 2026-04-24
**Owner**: D.t6 executing agent
**Rationale**: D.t6 had to close the open question from `planning/02-impl-chat-surface.md §2.7` on whether the UI should attempt automatic SSE resumption after a dropped `/chat` stream. Three options: (a) status quo — adapter `reconnectToStream` returns `null`, dropped streams surface as `[stream]` → D.t5's `stream_drop` banner with a Retry button that resubmits the last user-text; (b) client-driven polling retry — adapter attempts a fresh `/chat` POST with the same message after a backoff; (c) server-driven stream resumption — orchestrator persists stream state across connections keyed on a token, supports `Last-Event-ID`-style replay. (c) is the "correct" stateful answer and is how mature chat products handle dropped streams, but requires: a server-side stream ledger (chunk B doesn't have one), an assistant-ui thread-state coordination layer so resumption doesn't double-render, and considerable test surface for replay correctness. Out of scope for Puma. (b) risks silent double-submission (visitor thinks they sent one message, orchestrator gets two) and is worse than manual retry from an audit-trail POV. (a) is the honest answer: Puma's operational profile (low-latency single-turn requests, request-scoped streams) doesn't demand stateful resumption, and the D.t5 manual-retry path is already implemented and understood. D.t6 does NOT extend the reconnection path — it adds a proactive *expiry* probe, which is orthogonal to stream continuity.

**Swap cost**: Medium. Moving to (c) later requires: a chunk-B session-ledger rework for stream state, an `Last-Event-ID` handshake added to the orchestrator SSE, and a non-trivial assistant-ui integration to prevent duplicate part rendering on resume. Probably revisited post-M1 if F-chunk telemetry shows `stream_drop` occurrences biting real visitors.

## D.14 — "New conversation" button uses `refreshSession()` (in-place re-bootstrap), not `reset()` (return to OpeningScreen)

**Decided**: 2026-04-24
**Owner**: D.t5 executing agent (responding to Al's mid-task ask)
**Rationale**: Al asked for an always-visible "New conversation" button (initially "Fresh chat"; renamed after user feedback) that starts a clean chat when clicked. Two viable paths: (a) route through `useConsent.reset()` — clear sessionStorage + flip status back to `pending` → OpeningScreen re-appears → visitor re-consents → fresh session; or (b) a new `useConsent.refreshSession()` — POST `/session` + PATCH consent (re-using the stored `copyVersion`) + overwrite sessionStorage, keeping the visitor on the thread surface the whole time. Path (a) is the safer consent posture (each session = one consent act) but forces two clicks per restart. Path (b) rebinds the already-given consent to a new session id; the same copy version is re-recorded server-side (E.4 audit trail remains intact). We chose (b) as the default for the button: friction-light, consistent with the "knowledgeable friend" voice, and the copy-version re-record keeps the audit story honest. The UI is cleared via a `resetKey` state bumped on each restart, included in the transport `useMemo` deps and used as `key={resetKey}` on `<AssistantRuntimeProvider>` so the assistant-ui thread state remounts empty (see D.12 for why a re-key beats thread-state inspection). `reset()` stays on the hook as a nuclear option for the case where `refreshSession()` itself keeps failing (e.g. orchestrator truly down), but no UI surface wires to it by default — the ErrorBanner's "Start over" routes through `refreshSession` via the unified `handleFreshChat` callback. Error handling: `refreshSession()` emits via the shared adapter error emitter (D.12) and re-throws, so failures surface in the banner via the same path as any other comms failure.

**Swap cost**: Low. If compliance review later requires re-consent on each restart, wire the button to `consent.reset()` instead — a one-line change in `App.tsx`'s `handleFreshChat`. If `resetKey` key-remount proves too blunt (rare edge case where preserving some thread state is desirable), bump only the transport memo key and remove the provider `key` prop; assistant-ui will churn its transport-derived state without a full tree remount.

## D.13 — Error copy as JSON under `cms/errors/` with typed Vite import, no runtime schema validation

**Decided**: 2026-04-24
**Owner**: D.t5 executing agent
**Rationale**: D.t5 added five user-facing error surfaces (unreachable / stream_drop / session_expired / rate_limited / unknown) plus a tool-error inline placeholder. Copy had to land somewhere that satisfied theme 2 (content-as-data, theme 9 legal-compliance-built-in) without a heavyweight runtime validation layer for what's effectively six static strings. Three options considered: (a) TypeScript constants in `ui/src/errors/` — violates the `cms/` charter ("content is data, not code; authored by non-engineers eventually"); (b) JSON under `cms/errors/en.json` with Zod validation on import — correct but overkill for a frozen file we change with a code-review PR, not a CMS editor; (c) JSON under `cms/errors/en.json` with Vite-native JSON import + typed cast in `ui/src/errors/error-banner.tsx`. We chose (c). `cms/` stays markdown-and-JSON-only per its README; widgets/banner reference typed constants at the call site; localisation adds a sibling `cms/errors/<locale>.ts` + a resolver when it's actually needed (post-Puma). Same pattern should carry over if future `cms/` content lands with similar "static, authored-by-PR" ergonomics — don't reach for Zod until the file is actually a data feed.

**Swap cost**: Low. If content moves to a real CMS later, swap the import for a fetch + Zod parse behind the existing `getToolErrorCopy()` helper; the call sites stay unchanged. If localisation arrives, add the resolver at the import boundary.

## D.12 — Adapter error propagation via module-level emitter, not assistant-ui thread-state inspection

**Decided**: 2026-04-24
**Owner**: D.t5 executing agent
**Rationale**: D.t5 needed a reliable signal for "something failed in orchestrator comms". Two paths: (a) subscribe to assistant-ui's thread state via `useThread((s) => s.messages)` and look for the latest assistant message with `status.type === "incomplete"` + `reason === "error"`; (b) a module-level event emitter inside `runtime/orchestrator-adapter.ts` that the transport pokes at the exact moment it throws / enqueues an error chunk. We chose (b). Rationale: (i) assistant-ui is pre-1.0 and both `useThread` and `useThreadRuntime` are formally deprecated in favour of an `aui.*` API still being rolled out — wiring D.t5 to the deprecated surface buys us future upgrade tax; (ii) pre-stream failures (`sendMessages` throws before any message exists) don't have a corresponding thread-state entry to inspect, so path (a) would need a second channel for those anyway; (iii) the emitter pattern gives us one wire that carries transport failures, mid-stream drops, AND unrelated-but-adjacent consent-refresh failures (see D.14) without any of them having to invent their own route to the banner. One module, one emitter, one subscriber (`useRuntimeErrors`). Classification happens pure-function-side in `errors/classify.ts` against a `[<code>]` marker convention embedded in the thrown-error message — documented in the adapter + classifier + cms JSON schema-notes so future changes don't drift.

**Swap cost**: Low. If assistant-ui's eventual `aui.*` API exposes a clean "subscribe to thread-level error" signal, `useRuntimeErrors` swaps its `subscribeAdapterErrors` subscription for that source and the emitter is retired — all other D.t5 surfaces (classifier, banner, copy) are unaffected. If we ever move the transport off the custom `ChatTransport` implementation, the emitter move to the new transport's error hook.

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
