# Progress — Swoop Web Discovery (Puma)

**Snapshot date**: 2026-04-29 (overnight — agent swarm landed C.t0 + E.t8 + H.t7; mock-host flipped to shipped; HITL design-thread Q4/Q5 closed)
**Release**: Puma (Patagonian-animals naming convention; see [CLAUDE.md](CLAUDE.md#releases))
**Status**: **M1 live + chunks D + mock-host shipped; chunks B/E/F/G/H advancing; chunk C unblocked on the dump.** Tonight's swarm landed in parallel via worktree-isolated agents (commits 060f3da → fdd5cff): **C.t0** SQL-dump inspection (852 trips not 111; 9 schema findings that overturn first-pass assumptions; 8 questions closed; 3 new questions raised); **E.t8** compliance-bundle skeleton (12 files, 5 filled / 1 partial / 4 blocked / 1 empty); **H.t7** living-evalset growth runbook (with PII-sanitisation guidance); **blog ingest** confirmed implemented in `@swoop/ingestion` workspace (102 posts in 5y window). Earlier (2026-04-28): G.11 / B.t1a CMS folder restructure + multi-file prompt loader; E.t2/E.t3/E.t4 connector + handoff submit pipeline; Tier 2 plan refresh + 12 new decisions (C.13–C.17, C.19–C.23, B.22, E.10). **HITL design thread**: Q5 (`inconclusive` 4th verdict) and Q4 (main agent derives customer-type, not Haiku post-classifier) closed; Q1 expanded to all 10 tools (PoC carry-forward + new sales-shaped). Next wave per [next-steps.md](next-steps.md).

---

## What M1 looks like right now

A visitor at http://localhost:5173 can:
1. See the paired AI-disclosure + GDPR tier-1 consent screen.
2. Click **Continue** → orchestrator issues a session id + records consent.
3. Type a question (e.g. "Tell me about the W trek in Patagonia") and hit Send.
4. Receive a real Claude Sonnet response streamed inline, produced by an ADK agent calling stubbed MCP tools via a functional Haiku 4.5 triage classifier.
5. (When the agent triggers) See the lead-capture widget render. Tick consent, fill name + email, click Send. The widget POSTs to `/handoff/submit`, the orchestrator enriches against session state, the connector persists a JSON record under `var/handoffs/`, and the mailer is invoked (skipping cleanly when disabled). Confirmation card renders.

The three services are all running (`:5173` UI, `:8080` orchestrator, `:3001` stub connector). System prompt is now sourced from `cms/prompts/system/` — every numerically-prefixed `.md` file is concatenated and fed to the agent.

**This was verified in the preview earlier.** Orchestrator logs show a full turn: triage classifier ran → ADK user event received → tool calls happened → SSE parts streamed → assistant-ui rendered. The handoff submit flow is verified via integration tests (`handoff-submit.test.ts`); live walkthrough is pending Julie's SMTP confirmation for the email leg.

## D.t5 + waves 1–2 (2026-04-24)

- ✅ **Five error surfaces rendered by a unified `ErrorBanner`** (unreachable / stream_drop / session_expired / rate_limited / unknown), copy authored in `product/cms/errors/en.json` per content-as-data. Tool-call inline error upgraded to the same copy source via `getToolErrorCopy()`. See [planning/03-exec-chat-surface-t5.md](planning/03-exec-chat-surface-t5.md).
- ✅ **Always-visible "New conversation" button** + adapter-side error emitter pattern (decisions D.12 + D.14).
- ✅ **D.t8** brand-extension surface: 12 CSS custom-properties tokens scoped to `[data-swoop-root]`, 10 `data-swoop-part` attribute hooks on primitives, [product/ui/HANDOVER.md](product/ui/HANDOVER.md) for Swoop's in-house team, iframe embed recipe + CSP + CORS contract (D.21–D.25).
- ✅ **F-b** observability retrofit: 27 producer sites routed through `emitEvent`; UI now has a thin `emit-ui-event.ts` wrapper hiding sessionStorage boilerplate.
- ✅ **B.t10** warm session pool: shipped with `WARM_POOL_SIZE=0` default. LIFO stack, eager startup pre-warm. Two emitted kinds (`warm_pool.hit` / `warm_pool.miss`).
- ✅ **G.10** style-avoid first pass at `cms/prompts/style-avoid.md` (later renamed to `cms/prompts/system/10_style-avoid.md` under G.11).

## G.11 / B.t1a (2026-04-27)

- ✅ **CMS folder structure**: `cms/prompts/{system,skills,tools}/` with deterministic load contracts. System prompt is the concatenation of every file matching `^\d{2}_[a-z0-9-]+\.md$` in `prompts/system/`, joined by `\n\n---\n\n`. Skills are ADK 1.0 directories (per `loadAllSkillsInDir`); tools are MCP-tool-scoped fragments. See decision **G.11** + [planning/03-exec-agent-runtime-t1a.md](planning/03-exec-agent-runtime-t1a.md).
- ✅ **Multi-file prompt loader** (B.t1a): `prompt-loader.ts` reads the directory, filters by pattern, sorts lexicographically, joins. Hot-reload preserved in dev. Sub-directories silently skipped via `withFileTypes`. Config rename: `SYSTEM_PROMPT_PATH` → `SYSTEM_PROMPT_DIR`. New unit tests cover concatenation, filtering, prod cache vs dev re-read, missing/empty dir, single file, sub-dir skip.
- ✅ **Files relocated**: `cms/prompts/why.md` → `cms/prompts/system/00_why.md`; `cms/prompts/style-avoid.md` → `cms/prompts/system/10_style-avoid.md`. `cms/prompts/skills/` and `cms/prompts/tools/` created with `.gitkeep`.
- ✅ **Authoring guide**: [product/cms/README.md](product/cms/README.md) rewritten as the day-to-day rules for non-engineers (layout + load contracts + naming + "what goes where" decision tree). Pointer added in [product/CLAUDE.md](product/CLAUDE.md).

## C.t0 + E.t8 + H.t7 + mock-host (2026-04-29 — overnight swarm)

Five worktree-isolated agents dispatched in parallel; four committed, one (mock-host verification A) was redundant — Al confirmed mock-host already in active use. Pattern observation: `isolation: "worktree"` does branch from `main` (not from the spawning agent's branch) — every agent caught it via the hash-verification gate and self-reset to `ddada33` before doing work. Pattern works; keep it.

- ✅ **C.t0** — local MariaDB inspection of the 2026-04-27 SQL dump. Tier 3 plan + execution log at [planning/03-exec-c-t0.md](planning/03-exec-c-t0.md). Substantial rewrite of [data-ontology.md](data-ontology.md) (+413 / -108) with `S-SQLDUMP-2026-04-27` source tag. 8 questions closed in [questions.md](questions.md); 3 new questions raised for Thomas/Richard. 119 lines of durable findings added to [discoveries.md](discoveries.md). **Notable findings that overturn first-pass assumptions**: trip count is 852 (not 111 — public feed is curated subset); currency id 4 = AUD not EUR; `adventurousness` is a trip-style classifier not a difficulty/wilderness legend; `image` table has no filename column (joins to `file` via `image.image_id → file.id`); `image.description` is 47.5% populated (could materially cut C.t6 annotation cost); `tripvariant` + `season` are operational, skip from agent surface; `daybyday` canonical filter likely `type='presale' AND trip_id IS NOT NULL AND deleted IS NULL` (~12,415 rows for 852 trips, needs Thomas confirmation); **`customerreview` + `customertip` source tables are MISSING from the dump** (junction rows dangle — material gap, this was the agent's primary curated-prose corpus); `ntags_lookup` is 94% PII enquiry data (agent-relevant subset ~7,853 rows). Database left loaded for ongoing inspection.

- ✅ **E.t8 compliance-bundle skeleton** — Tier 3 plan at [planning/03-exec-e-t8.md](planning/03-exec-e-t8.md), 12-file bundle at [product/cms/legal/compliance-bundle/](product/cms/legal/compliance-bundle/). Status by file: 5 ✅ FILLED (README + status legend, 01-overview, 02-data-flow with mermaid + per-edge narrative, 05-retention-policy with values from E.6/E.7/E.8, 08-data-subject-rights, 09-review-checklist), 1 🟡 PARTIAL (06-processors — Anthropic + Google Cloud filled, SMTP TBC), 4 🔴 BLOCKED (03-disclosure-copy + 04-consent-flow on E.t5; 07-dpas on Swoop legal sourcing; screenshots/ on real copy + screenshot capture), naming convention documented for the empty dir. Counsel review checklist landed.

- ✅ **H.t7 living-evalset growth runbook** — Tier 3 plan at [planning/03-exec-h-t7.md](planning/03-exec-h-t7.md), operator-facing runbook at [product/cms/ops/evalset-growth.md](product/cms/ops/evalset-growth.md). Decisions H.17–H.20 added (cadence Friday afternoon, sanitisation by mechanism + verified grep smoke-test, sources span handoff records + Cloud Logging, ownership-as-role rather than named individual). PII-sanitisation guidance is the load-bearing bit — explicit field table per handoff payload + in-message PII pattern table.

- ✅ **Blog ingest** — confirmed already implemented in `@swoop/ingestion` workspace by an earlier session (753-line single-file pipeline + 31 passing tests). Live backfill produced 102 posts (`X-WP-Total` matches; rolling 5y window aged out 6 posts since the 2026-04-27 plan check). Plan doc at [planning/03-exec-blog-ingest.md](planning/03-exec-blog-ingest.md) flipped to "Implemented" + path corrected to `product/ingestion/src/blog/fetch.ts`.

- ✅ **Mock-host harness** — Al confirmed in active use 2026-04-29. Status flipped from Draft → Shipped on [planning/02-impl-side-quest-host-harness.md](planning/02-impl-side-quest-host-harness.md). Observation outcome: assistant-ui doesn't auto-rehydrate the chat thread on iframe remount → **W1 + W2 unparked** (see [inbox.md](inbox.md) 2026-04-29 entry; original W1 commit `6d31124` worth reviewing for shape, with Postgres-aware retry framing required given C.18 / B.22 / E.10 / C.23 lock-in).

- ✅ **HITL design thread** — Q5 (`inconclusive` 4th verdict approved) and Q4 (main agent derives customer-type, not Haiku post-classifier) closed. Q1 expanded to all 10 tools (PoC + new). Method note captured in [planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) §5: design top-down from conversational arcs, not bottom-up from data shape. Saved to long-term memory so future sessions don't repeat the misstep.

## E.t2 / E.t3 / E.t4 (2026-04-28)

- ✅ **`@swoop/connector` workspace populated**: previously an empty `export {};`. Now hosts the mailer, durable store, and `submitHandoff()` orchestration. Removed `nodemailer` dep from orchestrator, added to connector. Orchestrator now declares `@swoop/connector` as a workspace dep. Decision **E.11**.
- ✅ **`HandoffStore` interface + `FsHandoffStore` interim**: file-backed JSON under `<orchestrator-root>/var/handoffs/`. Atomic writes, filename safety regex, schema-validated round-trip. Same interface the future `FirestoreHandoffStore` will satisfy. Decision **E.12**.
- ✅ **`submitHandoff(payload, deps)`**: schema validate → consent backstop → store save → verdict-aware email. Single side-effect surface for any future MCP `handoff_submit` tool to wrap.
- ✅ **`POST /handoff/submit` orchestrator route**: validates body against `HandoffSubmitRequestSchema`, looks up session, verifies tier-1 consent, enriches into a full `HandoffPayload`, delegates to `submitHandoff()`, emits `handoff.submitted` event, returns typed `HandoffSubmitResponse`. Decision **E.13** (HTTP over MCP-tool routing) + **E.14** (server-side enrichment).
- ✅ **Lead-capture widget POSTs end-to-end**: `handleSubmit` is async; calls `postHandoffSubmit()` from the new `runtime/handoff-client.ts`; on success calls `addResult({ status: 'accepted', handoffId })` to resolve the assistant-ui tool call; on failure shows inline error and lets the visitor retry. Tier-2 consent timestamp captured client-side at submit (decision **E.15**).
- ✅ **Mailer off by default**: `HANDOFF_EMAIL_ENABLED=false`. Cross-field config refine — when flipped to `true`, `HANDOFF_EMAIL_FROM` + `HANDOFF_EMAIL_TO_QUALIFIED` + `SMTP_USER` + `SMTP_PASS` become required at boot. Boot logs name the store path + mailer state.
- ✅ **Email templates**: `cms/templates/handoff/qualified.md` + `referred-out.md` (per-verdict, plain text, `{{path.to.field}}` substitution). `disqualified` produces no email per E.3.
- ✅ **Gitignore**: `product/orchestrator/var/` + `product/connector/var/` ignored — visitor PII never enters git.
- ✅ **22 new tests** across the chain: 9 template-renderer + 13 mailer + 13 store + 11 submit + 9 route handler. See [planning/03-exec-handoff-t2-t3.md](planning/03-exec-handoff-t2-t3.md).

---

## Planning state — all four tiers

| Tier | State | Where |
|---|---|---|
| **Tier 1** — top-level plan | Done | [planning/01-top-level.md](planning/01-top-level.md) |
| **Tier 2** — implementation plans | Done (all 8 chunks) | [planning/02-impl-*.md](planning/) |
| **Tier 3** — execution plans | **Critical path + post-hoc records** for B.t1–t7 + B.t1a + D.t1–t4 + E.t1 + E.t2-t3 + E.t8 + H.t1 + H.t7 + C.t0 + blog ingest (~25 plans). Rest produced just-in-time. | [planning/03-exec-*.md](planning/) |
| **Tier 4** — agent swarm | Active execution model. 17+ subagents dispatched across A/B/D + tonight's parallel C/E/H/blog wave. All committed-and-merged work landed cleanly. **Pattern note**: `isolation: "worktree"` branches from `main`, not from the spawning agent's branch — every dispatch needs a hash-verification gate as its first action. | (mode of work, not a doc) |

Archive of superseded docs: [planning/archive/](planning/archive/) — includes 20/21 Apr meeting notes, research pack, 30 Mar quote, original over-specified 00-07 docs.

---

## Implementation state — per chunk

| Chunk | Scope | State | Notes |
|---|---|---|---|
| **A — foundations** | Repo, workspaces, `ts-common`, CI, decision log | ✅ Complete (t1–t5) | `@swoop/*` scope locked. npm workspaces at `product/` root. |
| **B — agent runtime** | ADK orchestrator, session, connector adapter, translator, SSE, config, two-layer proof, multi-file prompt loader | ✅ Core complete (t1, t1a, t2–t7) | ADK 1.0 + Claude shim + stub connector + translator + SSE + triage classifier all wired. **B.t1a** added 2026-04-27: directory-driven concatenation system-prompt loader. |
| **B — deferred** | Response-format parser (t8), modular-guidance loader (t9), warm pool (t10), **server-side history endpoint (t11 — unparked 2026-04-29)** | Partial (B.t10 done, disabled) | B.t8 parser not needed. **B.t9** skill loader pairs with G.t3 — ADK 1.0's `loadAllSkillsInDir` confirmed; structure is `cms/prompts/skills/<name>/SKILL.md`. **B.t11** unparked after observation that assistant-ui doesn't auto-rehydrate; original commit `6d31124` worth reviewing for shape, with Postgres-aware retry framing required. |
| **C — retrieval & data** | MCP connector + Postgres derived store + ETL + sales-shaped composer tools + annotation pipeline | Tier 2 rewrite landed 2026-04-28; **C.t0 done 2026-04-29**; Tier 3 plans for C.t1+ pending | Stub connector in orchestrator's `test-fixtures/` carries M1. SQL dump loaded into local MariaDB; **C.t0 SQL inspection landed 2026-04-29** with substantial ontology rewrite + 9 first-pass-overturning findings (see today's section above). C.t2 (sales-shaped tool I/O + Postgres entity model) is the live HITL thread at [planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md). |
| **D — chat surface** | Full chunk shipped (t1–t8); **t9 (mount-rehydrate) unparked 2026-04-29** | ✅ Core closed; D.t9 reactivated | ErrorBanner + preflight + mobile reflow + brand extension surface all shipped. **D.t9** unparked alongside B.t11 — pairs with server-side history endpoint to resolve the assistant-ui auto-rehydrate gap. |
| **Mock-host harness** | Side-quest. 5-page static site + iframe trigger + sidebar | ✅ **Shipped** (Al-built; verified 2026-04-29) | Reproduces production iframe-remount failure mode. Active demo + observation surface. See [planning/02-impl-side-quest-host-harness.md](planning/02-impl-side-quest-host-harness.md). |
| **E — handoff & compliance** | Triage-aware handoff + persistence + email + legal | **Mostly shipped** (t1, t2 interim, t3 off-by-default, t4 functional, t8 skeleton). **t5–t7 + t9 open.** | E.t1 schema (2026-04-24), E.t2 file-backed interim + E.t3 mailer + E.t4 end-to-end consent flow (all 2026-04-28), **E.t8 compliance-bundle skeleton 2026-04-29**. Remaining: legal copy (t5; gates Q1 voice anchors), retention enforcement (t6, post-IAM), data-deletion script (t7; was a runbook, becomes `psql DELETE` script), legal counsel review (t9 — gates M5). |
| **F — observability** | Structured event logging + schema + producer retrofit | Partial (F-a + F-b done) | F-a schema (20+ event kinds) + F-b retrofit. `handoff.submitted` event now emitted on successful submit. Remaining: B.t9 `skill.loaded` + B.t2 sweeper's `session.ended{idle_timeout}`. |
| **H — validation** | Lightweight eval harness + post-launch ritual | Partial (H.t1 + **H.t7** done) | H.t1 scaffold + **H.t7 living-evalset growth runbook** (2026-04-29) shipped. H.t3 assertions + H.t4 real scenarios + H.t5 judge calibration still open. Decisions H.17–H.20 added with H.t7. |
| **G — content** | System prompt, skills library, HITL flow mapping, **CMS structure**, **style-control** | Partial (G.10 + G.11 + structural plumbing) | **G.10** (2026-04-24) two-layer voice: `00_why.md` + `10_style-avoid.md`. **G.11** (2026-04-27) CMS folder structure decided + plumbing in place. Real content (G.t1 prompt + G.t3 skills + G.t0 HITL flow mapping) waits on the Q1 ensemble walk in [planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) + Luke + Lane's sales-thinking doc (~May 4). |
| **Blog ingest** | Parallel C-stream — WP REST → NDJSON snapshots | ✅ **Implemented** in `@swoop/ingestion` | 753-line single-file pipeline, 31 tests passing, 5y rolling window, 102 posts in current snapshot. See [planning/03-exec-blog-ingest.md](planning/03-exec-blog-ingest.md). Embedding + Postgres insert deferred pending HITL on data shape. |

---

## Workspaces

`product/` is an npm-workspaces monorepo. **Six workspaces ship code today** (was 5; `@swoop/ingestion` is now populated). **397 tests passing** (was 311):

| Workspace | Purpose | Test count |
|---|---|---|
| `@swoop/common` | Shared types, schemas, `emitEvent` helper, fixtures | 43 |
| `@swoop/orchestrator` | Agent runtime, server, session store, prompt loader, route handlers | 132 |
| `@swoop/connector` | Mailer, durable handoff store, `submitHandoff()` orchestration | 46 |
| `@swoop/ui` | React chat surface, widgets, runtime adapter, error UX | 71 |
| `@swoop/harness` | Behavioural eval CLI + YAML scenarios | 74 |
| `@swoop/ingestion` | Blog REST → NDJSON snapshots; per-entity ETL helpers (future) | 31 |

Plus content + scripts (no workspace): `cms/`, `scripts/`, `mock-host/`.

---

## Key files to know

### Configuration
- [product/orchestrator/.env.example](product/orchestrator/.env.example) — full config surface, including the new `HANDOFF_EMAIL_*` / `SMTP_*` / `HANDOFF_TEMPLATES_DIR` keys.
- [product/orchestrator/src/config/schema.ts](product/orchestrator/src/config/schema.ts) — Zod schema; cross-field refines for warm-pool TTL + handoff-mailer-when-enabled.

### CMS layout (G.11)
- [product/cms/README.md](product/cms/README.md) — authoring rules + load contracts per subdirectory.
- [product/cms/prompts/system/](product/cms/prompts/system/) — system-prompt fragments (`00_why.md`, `10_style-avoid.md`); concatenated by the loader.
- [product/cms/prompts/skills/](product/cms/prompts/skills/) — ADK skill directories (empty pending G.t3).
- [product/cms/prompts/tools/](product/cms/prompts/tools/) — tool-scoped fragments (empty; populated as MCP tools need authored copy).
- [product/cms/templates/handoff/](product/cms/templates/handoff/) — verdict-aware email templates (`qualified.md`, `referred-out.md`).
- [product/cms/errors/en.json](product/cms/errors/en.json) — UI error-surface copy.

### Agent runtime core
- [product/orchestrator/src/agent/prompt-loader.ts](product/orchestrator/src/agent/prompt-loader.ts) — directory-driven concatenation per G.11.
- [product/orchestrator/src/agent/claude-llm.ts](product/orchestrator/src/agent/claude-llm.ts) — custom BaseLlm shim, Anthropic streaming translation, tool-schema normaliser.
- [product/orchestrator/src/agent/factory.ts](product/orchestrator/src/agent/factory.ts) — builds the ADK LlmAgent.
- [product/orchestrator/src/functional-agents/triage-classifier.ts](product/orchestrator/src/functional-agents/triage-classifier.ts) — the layer-2 agent.
- [product/orchestrator/src/server/chat.ts](product/orchestrator/src/server/chat.ts) — SSE endpoint + consent gate.

### Handoff submit pipeline (E.t2 / E.t3 / E.t4)
- [product/orchestrator/src/server/handoff-submit.ts](product/orchestrator/src/server/handoff-submit.ts) — `POST /handoff/submit` route handler. Body validation, session lookup, tier-1 gate, server-side payload enrichment, delegation to connector.
- [product/connector/src/handoff/submit.ts](product/connector/src/handoff/submit.ts) — `submitHandoff(payload, deps)` orchestration.
- [product/connector/src/handoff/store.ts](product/connector/src/handoff/store.ts) — `HandoffStore` interface + `FsHandoffStore` interim.
- [product/connector/src/handoff/mailer.ts](product/connector/src/handoff/mailer.ts) — verdict-aware nodemailer send.
- [product/connector/src/handoff/template-renderer.ts](product/connector/src/handoff/template-renderer.ts) — tiny `{{path}}` substituter.
- [product/ui/src/runtime/handoff-client.ts](product/ui/src/runtime/handoff-client.ts) — UI client for `/handoff/submit`.
- [product/ui/src/widgets/lead-capture.tsx](product/ui/src/widgets/lead-capture.tsx) — async submit + addResult lifecycle.

### UI core
- [product/ui/src/App.tsx](product/ui/src/App.tsx) — top-level gate (consent → thread). Owns the `resetKey` for "New conversation" restart path.
- [product/ui/src/runtime/orchestrator-adapter.ts](product/ui/src/runtime/orchestrator-adapter.ts) — custom AI SDK `ChatTransport` bridging orchestrator SSE.
- [product/ui/src/disclosure/](product/ui/src/disclosure/) — opening screen, chrome badge, privacy modal, `useConsent()` hook.
- [product/ui/src/errors/](product/ui/src/errors/) — D.t5 error UX.
- [product/ui/src/session/](product/ui/src/session/) — D.t6 preflight.
- [product/ui/src/widgets/](product/ui/src/widgets/) — tool-call widgets + shared primitives.

### Shared types (@swoop/common)
- [product/ts-common/src/handoff.ts](product/ts-common/src/handoff.ts) — E.t1 per-verdict reason taxonomy + E.t3 wire shapes (`HandoffSubmitRequestSchema`, `HandoffSubmitResponseSchema`).
- [product/ts-common/src/events.ts](product/ts-common/src/events.ts) — F-a: 20+ event kinds; includes `handoff.submitted`.
- [product/ts-common/src/emit-event.ts](product/ts-common/src/emit-event.ts) — F-a: `emitEvent()` helper + pluggable sink.
- [product/ts-common/src/session.ts](product/ts-common/src/session.ts) — `SessionState` + `SessionPingResponse`.

### Harness (@swoop/harness)
- [product/harness/](product/harness/) — bespoke Node CLI, YAML scenarios, 13 seeds (3 filled + 10 stubs), stub judge, markdown + JSON reporter.
- [.github/workflows/harness.yml](.github/workflows/harness.yml) — non-gating, label-gated CI.

### Stub connector (still in fixtures)
- [product/orchestrator/test-fixtures/stub-connector.ts](product/orchestrator/test-fixtures/stub-connector.ts) — returns `@swoop/common/fixtures`-backed responses over MCP-HTTP. Carries data-tool calls today; data tools migrate to `@swoop/connector` when chunk C lands.

### Decision log (grows forever)
- [planning/decisions.md](planning/decisions.md) — A.* / B.* / C.* / D.* / E.* / G.* / H.*. Add entries when closing any Tier 2 / Tier 3 decision.

---

## What's running and what's running cost

- **Orchestrator** (`@swoop/orchestrator`): Cloud Run-ready Node 20 service, ADK 1.0 + Anthropic SDK + MCP SDK. Running locally via `tsx watch`. New routes: `/healthz`, `/session`, `/session/:id/consent`, `/session/:id/ping`, `/session/:id` (DELETE), `/chat`, `/handoff/submit`.
- **Stub connector** (`product/orchestrator/test-fixtures/stub-connector.ts`): local-only Express/MCP-HTTP server, fixture responses for data tools. Not for production.
- **`@swoop/connector` package**: in-process workspace dep used by the orchestrator. No standalone process today (will become a Cloud Run service post-IAM).
- **UI**: Vite dev server.
- **Model spend**: every conversation calls Claude Sonnet (orchestrator) + Claude Haiku (triage). Ballpark £0.05–£0.25 per turn per the 30 Mar proposal.

---

## How to resume this project

1. Read [CLAUDE.md](CLAUDE.md) for project orientation (releases, inbox, questions, planning).
2. Read [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching anything.
3. Read [next-steps.md](next-steps.md) for prioritised work.
4. Load the `swoop` skill in your Claude Code session — it covers engagement context, people, day rate, voice.

---

## How to ship M1

1. **Real data**: continue the discovery design HITL ([planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md)) → close C.t2 (sales-shaped tool I/O + Postgres entity model) → author Tier 3 plans for C.t1 / C.t3 / C.t3a / C.t4 → implement → swap stub connector for real `@swoop/connector` data tools backed by the 2026-04-27 SQL dump.
2. **Content**: same discovery design HITL produces G.t1 (first-pass WHY prompt) + G.t3 (≥2 seed skills); refine when Luke + Lane's sales doc lands (~May 4).
3. **Handoff (E)**: Julie confirms SMTP + sales inbox → flip `HANDOFF_EMAIL_ENABLED=true` → live email path. Legal copy review (E.t5). Firestore swap when GCP IAM lands (E.t2 proper).
4. **Compliance sign-off**: Swoop's legal counsel reviews disclosure + consent bundle (gates M5).
5. **Deploy**: Cloud Run + GCP "AI Pat Chat" IAM (Thomas owns).

All of this is planned at Tier 2 altitude in [planning/02-impl-*.md](planning/).
