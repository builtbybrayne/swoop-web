# Progress — Swoop Web Discovery (Puma)

**Snapshot date**: 2026-04-24 (late)
**Release**: Puma (Patagonian-animals naming convention; see [CLAUDE.md](CLAUDE.md#releases))
**Status**: **M1 live. D.t5 error-states + "New conversation" button shipped earlier today. Wave-1 parallel swarm landed: D.t6 proactive preflight, D.t7 mobile reflow, E.t1 handoff schema, F-a event schema + `emitEvent` helper, H validation harness scaffold. 221/221 tests green across 4 workspaces. Ready for next wave per [next-steps.md](next-steps.md).**

---

## What M1 looks like right now

A visitor at http://localhost:5173 can:
1. See the paired AI-disclosure + GDPR tier-1 consent screen.
2. Click **Continue** → orchestrator issues a session id + records consent.
3. Type a question (e.g. "Tell me about the W trek in Patagonia") and hit Send.
4. Receive a real Claude Sonnet response streamed inline, produced by an ADK agent calling stubbed MCP tools via a functional Haiku 4.5 triage classifier.

The three services are all running (`:5173` UI, `:8080` orchestrator, `:3001` stub connector).

**This was verified in the preview.** Orchestrator logs show a full turn: triage classifier ran → ADK user event received → tool calls happened → SSE parts streamed → assistant-ui rendered.

## M1 polish: done

- ✅ **Widget responses now render real data.** Root cause was the connector's `{ok: true, value: <data>}` envelope wrapping — widgets were trying to parse the envelope itself against output schemas. Fix: `safeParse()` in `product/ui/src/widgets/widget-shell.tsx` auto-unwraps the envelope before schema validation. Verified live: Tour cards / detail views render with real fixture data.
- ✅ **Markdown renders correctly.** Wired `react-markdown` + `remark-gfm` into `product/ui/src/parts/fyi-signaling-text.tsx` with inline Tailwind styling, GFM features, links open in new tab with `rel="noopener noreferrer"`, no HTML pass-through (no XSS surface). D.t2's `text-arrived` fyi-channel signal preserved.

Both fixes verified live in the browser. 34/34 UI tests + 95/95 orchestrator tests green.

## D.t5 shipped (2026-04-24)

- ✅ **Five error surfaces rendered by a unified `ErrorBanner`** (unreachable / stream_drop / session_expired / rate_limited / unknown), copy authored in `product/cms/errors/en.json` per content-as-data. Tool-call inline error upgraded to the same copy source via `getToolErrorCopy()`. See [planning/03-exec-chat-surface-t5.md](planning/03-exec-chat-surface-t5.md).
- ✅ **Classifier pattern-matches adapter-embedded `[<code>]` markers** — adapter tweak in `product/ui/src/runtime/orchestrator-adapter.ts` prefixes thrown errors with `[session_not_found]` / `[rate_limited]` / `[stream]` so `errors/classify.ts` routes without parsing the orchestrator envelope.
- ✅ **Error emitter pattern** (see decision D.12): `subscribeAdapterErrors()` gives `useRuntimeErrors` a reliable, library-agnostic signal for "something failed in comms" without poking at assistant-ui's pre-1.0 thread internals. Consent-refresh failures route through the same channel.
- ✅ **Always-visible "New conversation" button** in the post-consent header. Clicks drive `consent.refreshSession()` (POST `/session` + PATCH consent with stored copy-version) and bump a `resetKey` that remounts `<AssistantRuntimeProvider>` via `key={resetKey}`, clearing the assistant-ui thread. Same unified path used by the ErrorBanner's "Start over" (decision D.14).
- ✅ **`useConsent.refreshSession()`** added alongside existing `grantConsent` / `declineConsent` / `reset`; emits to the adapter error channel on failure so the banner surfaces it.
- ✅ **43/43 UI tests green** including 9 new `classify.test.ts` cases.
- Verified live via preview: "New conversation" button present, accessible, renders as expected. Banner paths smoke-tested by reviewing classifier routes; full walkthrough of the three recoverable error scenarios is an Al-side manual pass (documented in the chat as a three-case playbook).

---

## Planning state — all four tiers

| Tier | State | Where |
|---|---|---|
| **Tier 1** — top-level plan | Done | [planning/01-top-level.md](planning/01-top-level.md) |
| **Tier 2** — implementation plans | Done (all 8 chunks) | [planning/02-impl-*.md](planning/) |
| **Tier 3** — execution plans | **Critical path only** (A + B.t1–t7 + D.t1–t4 — 16 plans). Rest produced just-in-time. | [planning/03-exec-*.md](planning/) |
| **Tier 4** — agent swarm | Active execution model. Dispatched 13 subagents across A/B/D chunks, all landed. | (mode of work, not a doc) |

Archive of superseded docs: [planning/archive/](planning/archive/) — includes 20/21 Apr meeting notes, research pack, 30 Mar quote, original over-specified 00-07 docs.

---

## Implementation state — per chunk

| Chunk | Scope | State | Notes |
|---|---|---|---|
| **A — foundations** | Repo, workspace, ts-common, CI, decision log | ✅ Complete (t1–t5) | All 95+ orchestrator tests green. `@swoop/*` scope locked. npm workspaces at `product/` root. |
| **B — agent runtime** | ADK orchestrator, session, connector adapter, translator, SSE, config, two-layer proof | ✅ Core complete (t1–t7) | ADK 1.0 + Claude shim + stub connector + translator + SSE + triage classifier all wired. |
| **B — deferred** | Response-format parser, modular-guidance loader, warm pool | ⏸ Post-M1 (t8–t10) | Conditional: parser not needed (natives cover most); loader gated on ADK skill primitive; warm pool is latency polish. |
| **C — retrieval & data** | MCP connector + Vertex Search + scraper/API + annotation pipeline | ⏸ Gated on Friday hackathon | Data-access strategy pending. Stub connector in orchestrator's `test-fixtures/` carries for now. |
| **D — chat surface** | Vite + assistant-ui + parts + widgets + disclosure/consent + error states + proactive preflight + mobile reflow | ✅ t1–t7 complete | Error banner, classifier, adapter `[<code>]` markers, `consent.refreshSession()`, "New conversation" button, `GET /session/:id/ping` probe with mount/focus/idle triggers, header reflow at `sm:`, lead-capture `w-full` inputs. |
| **D — deferred** | Handover doc (Swoop brand extension surface) | ⏸ Post-M1 (t8) | Last chunk-D item; blocks on having a stable extension surface to document (CSS vars + override slots). |
| **E — handoff & compliance** | Triage-aware handoff + persistence + email + legal | Partial (E.t1 done) | E.t1 handoff payload schema shipped — per-verdict reason enums (14 codes), `.strict()` validation, `HandoffSubmitConsentGate` type for E.t2's connector backstop. E.t2–E.t9 still blocked on real connector + sales inbox + legal. |
| **F — observability** | Structured event logging + schema | Partial (F-a done) | F-a shipped: 20 event kinds in `@swoop/common/events`, `emitEvent()` helper with pluggable module-level sink, validation-failure `error.raised` fallback. F-b (retrofit every producer to emitEvent) still open. |
| **H — validation** | Lightweight eval harness | Partial (H.t1 done) | H.t1 scaffold shipped: new `@swoop/harness` workspace, bespoke Node CLI runs YAML scenarios against `:8080`, 13 seed scenarios (3 filled + 10 stubs), non-gating label-gated CI. H.t3 assertions + H.t4 real scenarios + H.t5 judge calibration still open. |
| **G — content** | System prompt, skills library, HITL flow mapping, **style-control** | ❌ Not started | Placeholder prompt at `product/cms/prompts/why.md`. Real content blocks on HITL session + Luke/Lane's sales doc (~May 4). **NEW**: G.10 decision + §2.1a added today — two-layer voice (positive examples in `why.md` + explicit anti-pattern list at `cms/prompts/style-avoid.md`) to suppress AI-slop defaults (em-dash cringe, corporate hedges, "delve"/"unpack", empty affirmations). |

---

## Key files to know

### Configuration
- [product/orchestrator/.env.example](product/orchestrator/.env.example) — full config surface.
- [product/orchestrator/src/config/schema.ts](product/orchestrator/src/config/schema.ts) — Zod schema; contains model-id defaults.

### Agent runtime core
- [product/orchestrator/src/agent/claude-llm.ts](product/orchestrator/src/agent/claude-llm.ts) — custom BaseLlm shim, Anthropic streaming translation, tool-schema normaliser.
- [product/orchestrator/src/agent/factory.ts](product/orchestrator/src/agent/factory.ts) — builds the ADK LlmAgent.
- [product/orchestrator/src/functional-agents/triage-classifier.ts](product/orchestrator/src/functional-agents/triage-classifier.ts) — the layer-2 agent.
- [product/orchestrator/src/translator/](product/orchestrator/src/translator/) — ADK event → message-parts translation; includes reasoning strip + `<fyi>` parser.
- [product/orchestrator/src/server/chat.ts](product/orchestrator/src/server/chat.ts) — SSE endpoint + consent gate.

### UI core
- [product/ui/src/App.tsx](product/ui/src/App.tsx) — top-level gate (consent → thread). Owns the `resetKey` that keys `<AssistantRuntimeProvider>` for the "New conversation" restart path. Mounts `usePreflight` (D.t6).
- [product/ui/src/runtime/orchestrator-adapter.ts](product/ui/src/runtime/orchestrator-adapter.ts) — custom AI SDK `ChatTransport` bridging orchestrator SSE. Exports `emitAdapterError` + `subscribeAdapterErrors` (D.t5 error channel; D.t6 + `refreshSession` also route through it).
- [product/ui/src/disclosure/](product/ui/src/disclosure/) — opening screen, chrome badge, privacy modal, `useConsent()` hook (with `reset()` + `refreshSession()`).
- [product/ui/src/errors/](product/ui/src/errors/) — D.t5 error UX: `classify.ts`, `use-runtime-errors.ts`, `error-banner.tsx`.
- [product/ui/src/session/](product/ui/src/session/) — D.t6 preflight: `preflight.ts` (pure probe + constants), `use-preflight.ts` (triggers + debounce + in-flight guard), index barrel.
- [product/cms/errors/en.json](product/cms/errors/en.json) — authored copy for the five error surfaces + tool-error placeholder.
- [product/ui/src/parts/](product/ui/src/parts/) — message-part renderers (`data-fyi`, reasoning-guard).
- [product/ui/src/widgets/](product/ui/src/widgets/) — four tool-call widgets + shared primitives.

### Shared types (@swoop/common)
- [product/ts-common/src/handoff.ts](product/ts-common/src/handoff.ts) — E.t1 per-verdict reason taxonomy, strict-validated Zod schemas, `HandoffSubmitConsentGate`.
- [product/ts-common/src/events.ts](product/ts-common/src/events.ts) — F-a: 20 event kinds in a discriminated union.
- [product/ts-common/src/emit-event.ts](product/ts-common/src/emit-event.ts) — F-a: `emitEvent()` helper + pluggable sink.
- [product/ts-common/src/session.ts](product/ts-common/src/session.ts) — `SessionState` + `SessionPingResponse` (canonical for D.t6).

### Orchestrator surfaces added
- [product/orchestrator/src/server/session-ping.ts](product/orchestrator/src/server/session-ping.ts) — `GET /session/:id/ping` (D.t6; always 200, verdict in body, no `updatedAt` bump).

### Harness (new workspace)
- [product/harness/](product/harness/) — `@swoop/harness`: bespoke Node CLI, YAML scenarios, 13 seeds (3 filled + 10 stubs), stub judge, markdown + JSON reporter.
- [.github/workflows/harness.yml](.github/workflows/harness.yml) — non-gating, label-gated CI.

### Stub connector (fixtures)
- [product/orchestrator/test-fixtures/stub-connector.ts](product/orchestrator/test-fixtures/stub-connector.ts) — returns `@swoop/common/fixtures`-backed responses over MCP-HTTP. **Currently schema-misaligned — see "Two bugs left" above.**

### Decision log (grows forever)
- [planning/decisions.md](planning/decisions.md) — A.1–A.9, B.1a/b/11–15, D.1 etc. Add entries when closing any Tier 2/3 decision.

---

## What's running and what's running cost

- Orchestrator: Cloud Run-ready Node 20 service, ADK 1.0 + Anthropic SDK + MCP SDK. Running locally via `tsx watch`.
- Stub connector: local-only Express/MCP-HTTP server, fixture responses. **Not for production.**
- UI: Vite dev server.
- Model spend: every conversation calls Claude Sonnet (orchestrator) + Claude Haiku (triage). Ballpark £0.05–£0.25 per turn per the 30 Mar proposal.

---

## How to resume this project

1. Read [CLAUDE.md](CLAUDE.md) for project orientation (releases, inbox, questions, planning).
2. Read [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching anything.
3. Read [next-steps.md](next-steps.md) for prioritised work.
4. Load the `swoop` skill in your Claude Code session — it covers engagement context, people, day rate, voice.

---

## How to ship M1

1. **Fix widget schemas + markdown** (the two bugs above; ~1 hour of work).
2. **Wire real data**: wait for Friday 24 Apr hackathon → produce Tier 3 plans for chunk C → implement → swap stub connector for real.
3. **Content**: HITL conversational flow mapping session with Al + Luke + Lane's sales doc → draft real WHY prompt + seed 2 skills.
4. **Handoff (E)**: real SMTP, real durable store, legal copy review.
5. **Compliance sign-off**: Swoop's legal counsel reviews disclosure + consent bundle (gates M5).
6. **Deploy**: Cloud Run + GCP "AI Pat Chat" IAM (Thomas owns).

All of this is planned at Tier 2 altitude in [planning/02-impl-*.md](planning/).
