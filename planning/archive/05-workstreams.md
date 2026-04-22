# 05 — Workstreams

**Status**: Draft, v2. Evolved from the ChatGPT PoC's package topology, not from scratch.
**Purpose**: Map the implementation work into parallelisable streams for Claude Code execution. Define dependencies, integration milestones, branching tradeoffs, and kickoff gating.
**Depends on**: `01-architecture.md`, `02-data-access.md`, `03-handoff-schema.md`, `04-legal-compliance.md`, `06-repo-structure.md`, `07-validation-harness.md`.

---

## 1. Starting point: the PoC's shape

The ChatGPT PoC (`chatgpt_poc/product/`) is three TypeScript packages plus a CMS folder and a scripts folder:

```
product/
├── ts-common/    — shared types, Zod schemas, tool descriptions, widget schemas
├── mcp-ts/       — MCP server (7 tools: library search, component list/detail, illustrate, handoff, guidance)
├── ui-react/     — React widgets (4 single-file HTML bundles for the ChatGPT iframe)
├── cms/          — JSON data + prompt engineering markdown
└── scripts/      — one-shot data pipeline: raw Mongo exports → CMS JSON
```

The PoC was a single-platform demo that rode on ChatGPT for the conversation engine, chat UI, session, and streaming. The web version has to build those layers, so **the PoC's 3-package shape is a starting point, not the endpoint.** New streams are needed; existing streams evolve.

### What carries across unchanged in spirit

- `ts-common` as the shared contracts package (`@swoop/common`) — evolve, don't replace
- CMS-as-data pattern (JSON + prompt markdown loaded at runtime) — evolve
- Zod schemas for tool inputs/outputs — evolve
- React widget rendering logic (cards, detail views, handoff form) — concepts transfer to new chat surface

### What has to change

- **Agent orchestration** was implicit in ChatGPT. Now explicit — Google ADK on Cloud Run.
- **Chat surface** was ChatGPT's. Now ours — `assistant-ui` React app consuming AI SDK v5 `message.parts` over SSE.
- **Data layer** was local JSON from Mongo exports. Now Vertex AI Search over scraped-and-indexed trip + blog content.
- **MCP server** becomes the MCP/HTTP **data connector** service — evolves from local-process MCP to Cloud Run.
- **Legal / compliance** becomes a first-class delivery stream (PoC rode on OpenAI's consent surface).
- **Validation harness** becomes a first-class delivery stream (PoC tested manually via ChatGPT).

---

## 2. Stream map

Eight streams. Launches and gates in §5.

```
┌────────────────────────────────────────────────────────────────────┐
│  Stream 0: ts-common              foundation, root of graph        │
├────────────────────────────────────────────────────────────────────┤
│  Stream 1: ADK orchestrator       Cloud Run service — NEW          │
│  Stream 2: MCP / data connector   Cloud Run service — evolves mcp-ts│
│  Stream 3: UI (assistant-ui)      React chat surface — evolves ui-react│
│  Stream 4: Scraper utility        one-shot + scheduled — NEW shape │
│  Stream 5: CMS (prompts + content) WHY / HOW / templates — evolves cms/│
│  Stream 6: Legal / compliance     disclosure, consent, retention — NEW│
│  Stream 7: Validation harness     Python eval sidecar — NEW        │
├────────────────────────────────────────────────────────────────────┤
│  Integration milestones:                                           │
│    M1: Hello-world end-to-end (mocked tools + stub UI)             │
│    M2: Real data flowing (scraper → Vertex → connector → UI)       │
│    M3: Triage + handoff working end-to-end                         │
│    M4: Deployed to Swoop GCP ("AI Pat Chat") with IAM              │
│    M5: Legal sign-off + ready for iframe embed                     │
└────────────────────────────────────────────────────────────────────┘
```

### 2.1 Evolution from the PoC, stream by stream

| PoC package / folder | V1 stream | Relationship |
|---|---|---|
| `ts-common/` | Stream 0 (`ts-common`) | Evolved: adds AI SDK part types, ADK session shape, full `Handoff` schema |
| `mcp-ts/` | Stream 2 (`data-connector`) | Evolved: moves from local MCP to Cloud Run service; tools wrap Vertex Search, not local JSON |
| `ui-react/` | Stream 3 (`ui-assistant`) | Evolved: chat surface replaces ChatGPT iframe; widgets transfer as `makeAssistantToolUI` registrations |
| `cms/` (JSON + prompts) | Stream 5 (`cms`) | Evolved: prompts structured WHY/HOW; content remains JSON scaffold |
| `scripts/` (one-shot pipeline) | Stream 4 (`scraper`) | Evolved: MongoDB-dump transform becomes live-site scraper; Cloud Storage + Vertex ingestion downstream |
| — | Stream 1 (`adk-orchestrator`) | New: explicit agent loop; was ChatGPT |
| — | Stream 6 (`legal`) | New: PoC rode on OpenAI's consent surface |
| — | Stream 7 (`validation`) | New: PoC tested manually via ChatGPT |

---

## 3. Stream 0 — `ts-common`

**Shape**: *settled* (package name + position in graph). *Leaning* on exact module breakdown. *Open* on where PoC-era types get dropped vs evolved.

**Owns**: shared TypeScript types, tool I/O schemas, session shape, AI SDK part types, handoff schema, fixture content.

**Location**: `product/ts-common/src/` — keeps PoC package name `@swoop/common`.

**Evolved from PoC**: PoC had `domain.ts`, `enrichment.ts`, `mcp.ts`, `tools.ts`, `widgets.ts`. Web version adds `session.ts`, `message-parts.ts`, `handoff.ts`, `content.ts` (Trip/Story/ImageRef); keeps Zod as the validation library.

**Day-1 deliverables**:
- `tool-schemas.ts` — Zod schemas for the minimum tool set (`01-architecture.md` §2.3)
- `session.ts` — session state shape for ADK session backend
- `message-parts.ts` — AI SDK v5 `message.parts` types + extension points
- `handoff.ts` — full `Handoff` interface from `03-handoff-schema.md`
- `content.ts` — `Trip`, `Story`, `ImageRef` from `02-data-access.md` §2 (**illustrative until Friday session validates real ontology**)
- Fixtures: one hand-crafted example per type in `src/fixtures/`

**Dependents**: every other stream.

**Gate**: none. Launches first; unblocks 1 / 2 / 3.

**Completion signal**: types exported, `tsc` clean, Zod schemas validate fixtures, `@swoop/common` consumable via workspace link from all other packages.

---

## 4. Stream 1 — ADK orchestrator

**Shape**: *leaning* on single-agent + translator layer. *Open* on A2A vs SSE translator as the UI-facing transport (see `01-architecture.md` §3.4).

**Owns**: agent graph, session management, HOW classifier, translator (ADK events → AI SDK `message.parts`), SSE endpoint.

**Location**: `product/adk-orchestrator/src/`. **New package** — no PoC equivalent.

**Day-1 deliverables**:
- Single ADK agent (Claude Sonnet via ADK's provider abstraction) with stubbed tools
- Loads WHY prompt from `cms/prompts/why.md`
- HOW classifier stub (always returns `discovery` stance)
- `POST /chat` SSE endpoint
- Translator: async iterator of ADK events → AI SDK `message.parts` (text + tool-call `input-streaming` / `input-available` / `output-available`)
- Session via in-memory adapter (Firestore adapter lands post-GCP access)

**Depends on**: `ts-common` (schemas, session shape, part types); `cms/` for prompt loading.

**Stubs initially**:
- Tool implementations return fixtures matching `ts-common` schemas
- Classifier output hardcoded
- Session persistence in-memory

**Completion signal (M1)**: local dev run accepts SSE request, streams text + one stubbed tool call, Stream 3 UI renders it.

---

## 5. Stream 2 — MCP / data connector

**Shape**: *settled* on Cloud Run + HTTP. *Leaning* MCP-shaped over plain REST. *Open* on Vertex vs Weaviate for retrieval.

**Owns**: function-tool implementations, Vertex Search adapter, handoff persistence + email.

**Location**: `product/data-connector/src/`. **Evolves `mcp-ts/`** — same pattern of "one file per tool" under `src/tools/`, plus a retrieval adapter and handoff module.

**Evolved from PoC**: the 7-tool PoC set (`get_library_data`, `show_component_list`, `show_component_detail`, `handoff_submit`, `handoff`, `illustrate`, `get_conversation_guidance`) collapses into the V1 minimum tool set in `01-architecture.md` §2.3: `search_trips`, `get_trip_detail`, `search_stories`, `get_story`, `get_image`, `submit_handoff`. The PoC's Express + `@modelcontextprotocol/sdk` scaffolding transfers directly to the Cloud Run service shell.

**Day-1 deliverables**:
- HTTP service (Express / Fastify — either is fine) with tool endpoints
- All tools return fixture data from `ts-common` until Vertex lands
- Vertex Search adapter layer (thin wrapper; Weaviate adapter slot empty but typed)
- `submit_handoff` logs to stdout (SMTP wires post-GCP)

**Depends on**: `ts-common`; later: Vertex Search index (post-scraper ingestion), sales inbox address, SMTP credentials.

**Completion signal (M1)**: orchestrator can call each tool; fixture data returns; `submit_handoff` round-trips and logs.

**M2 deliverables**:
- Real Vertex Search queries
- Real content fetch from indexed data
- Real handoff email via Swoop's SMTP

---

## 6. Stream 3 — UI (`assistant-ui`)

**Shape**: *leaning* on `assistant-ui` + AI SDK adapter. *Open* on whether to target iframe embed directly or ship a standalone page Swoop iframes (see proposal: iframe via nav button).

**Owns**: React chat surface, tool-call widget rendering, dev harness, disclosure affordances.

**Location**: `product/ui-assistant/src/`. **Evolves `ui-react/`** — keeps React 19 + Vite, drops the `vite-plugin-singlefile` + `@modelcontextprotocol/ext-apps` paths (no ChatGPT iframe), adds `assistant-ui` + AI SDK adapter.

**Evolved from PoC**: the four PoC widgets (`inspiration`, `component-list`, `component-detail`, `lead-capture`) become four `makeAssistantToolUI` registrations in the chat stream. Rendering logic transfers; the integration layer replaces `useApp`/`structuredContent` with AI SDK `message.parts`.

**Day-1 deliverables**:
- `assistant-ui` scaffold with AI SDK adapter pointing at local orchestrator SSE
- `makeAssistantToolUI` registrations for each tool type (minimally styled cards)
- Dev harness: `npm run dev` → connects to local orchestrator
- Opening disclosure from `04-legal-compliance.md` §5.1 (legal-review-pending)

**Depends on**: `ts-common`; orchestrator's SSE contract (can proceed against a recorded-fixture mock endpoint).

**Explicitly out of scope**: responsive polish, Swoop brand styling, iframe host integration (Swoop's in-house team owns — per proposal and Julie call).

**Completion signal (M1)**: browser input → response streams back → tool-call widgets render.

---

## 7. Stream 4 — Scraper utility

**Shape**: *settled* on Claude-extraction approach and Cloud Storage landing. *Open* on meta-tag IDs vs slug IDs vs JSON API endpoint (Friday session).

**Owns**: content extraction from Swoop website, JSON normalisation, Cloud Storage output, Vertex ingestion handoff.

**Location**: `product/scraper/src/`. **New shape** — the PoC's `scripts/` was a one-shot MongoDB-dump transformer; this is a live-site scraper.

**Day-1 deliverables** (can start before GCP access — local dev only):
- CLI entrypoint taking URL list
- HTTP fetch path (headless browser added if Friday session confirms client-side rendering on any critical pages)
- Claude extraction prompts for `Trip` and `Story` types (drafts)
- JSON output conforming to `ts-common` schemas
- Fixture output for 5 hand-curated URLs (feeds Stream 2's initial data)

**Depends on**: `ts-common` schemas. Heavily informed by Friday 24 Apr session (ontology, ID strategy, sample URLs).

**Completion signal (M1)**: runs against 5 sample URLs, produces valid JSON, writes to local filesystem.

**M2 deliverables**:
- Bulk run mode
- Change-detection logic (diff vs previous scrape)
- Cloud Storage output
- Ingestion job: Cloud Storage → Vertex Search (idempotent, re-runnable)

---

## 8. Stream 5 — CMS (prompts + content)

**Shape**: *settled* as "content-is-data, loaded-at-runtime, authored by Al". *Open* on HOW taxonomy (evolves with sales docs and Friday ontology).

**Owns**: WHY prompt, HOW fragments, handoff email template, fixture content.

**Location**: `product/cms/`. **Evolves PoC `cms/`** — same content-as-data pattern; PoC had `PROMPT_ENGINEERING.md` + JSON payloads; web version adds `prompts/why.md`, `prompts/how/*.md`, `templates/handoff-email.md`, and keeps `content/` for fixtures.

**Day-1 deliverables**:
- `prompts/why.md` — draft WHY system prompt (Patagonia-voiced, triage posture, group-tour bias)
- `prompts/how/*.md` — draft HOW fragments per `01-architecture.md` §2.2 (discovery / convergence / triage / qualification / sensitive)
- `templates/handoff-email.md` — from `03-handoff-schema.md` §6
- Placeholder `content/trips/*.json` + `content/stories/*.json` conforming to `ts-common` schemas

**Depends on**: structurally, nothing. Conceptually:
- Swoop brand voice (carries across from PoC)
- Patagonia customer segmentation from 20 Apr kickoff (independence × region × activity × budget, group-tour bias, puma/W-trek/glacier motivations)
- Patagonia sales thinking docs from Luke + Lane — arriving in 1–2 weeks

**Ownership note**: Al authors this content. Not a pure Claude Code stream — taste-driven drafting and iteration. Stream exists so scaffolding / validation / hot-reload works cleanly.

**M3 deliverables** (post sales docs):
- Refined WHY prompt incorporating Patagonia sales voice
- Populated HOW fragments for real triage criteria
- Per-trip `salesTalkingPoints` overlays where useful

---

## 9. Stream 6 — Legal / compliance

**Shape**: *leaning* on disclosure + consent + retention as the three surfaces. *Open* on Swoop's legal counsel sign-off SLA.

**Owns**: AI disclosure copy, handoff consent flow, retention TTLs, data deletion runbook, processor disclosures.

**Location**: `product/cms/legal/` (copy) + targeted code in orchestrator and UI.

**Day-1 deliverables**:
- Disclosure copy from `04-legal-compliance.md` §5 wired into UI opening state
- Persistent AI-status affordance in UI
- Consent prompt pattern wired into WHY prompt; reinforced in HOW qualification fragment
- `submit_handoff` backstop: hard-reject without consent flag set
- Runbook stub: data deletion request handling (`product/cms/legal/runbooks/data-deletion.md`)

**Depends on**: Stream 3 (for disclosure placement), Stream 5 (for WHY consent language), Stream 2 (for `submit_handoff` backstop), Stream 1 (for retention TTLs on session).

**Pre-launch (M5) deliverables**:
- Legal counsel review incorporated
- Retention policy implemented (session / handoff / logs TTLs)
- Swoop privacy policy coordination
- DPAs confirmed (Anthropic, GCP)

**Ownership note**: Swoop's legal counsel owns sign-off; Al implements and drafts.

---

## 10. Stream 7 — Validation harness

**Shape**: *leaning* on the `07-validation-harness.md` recommendation (Python sidecar, ADK `AgentEvaluator`, Phoenix locally, Claude-as-judge). *Open* on when to add a vendor (deliberately deferred).

**Owns**: agent behavioural correctness, tool-call correctness, prompt regression detection, cost/latency gates.

**Location**: `product/validation/` — Python package, separate from the TS product tree.

**Day-1 (per research doc's day-by-day plan)**:
- Install `google-adk[eval]`, pytest, OpenInference instrumentation
- 5 hand-authored `.evalset.json` cases (from PoC sales docs or hand-synthesised)
- `test_config.json` with `tool_trajectory_avg_score` (IN_ORDER), `rubric_based_final_response_quality_v1` (3 rubrics: in_persona / no_hallucination / handoff_timing), `hallucinations_v1`
- First `adk eval` run against a stubbed orchestrator endpoint

**Depends on**: Stream 1 (orchestrator endpoint to hit as black-box), `ts-common` only indirectly (harness doesn't import TS).

**Completion signal (M1)**: 5 cases run against stubbed orchestrator; harness catches a deliberately broken tool description.

**Later milestones**:
- Day 2–3: Phoenix in Docker; expand to 20 cases; judge calibration (Cohen's κ ≥ 0.6, precision ≥ 0.9)
- Week 2: CI integration on PRs touching orchestrator / prompts; weekly production-to-eval growth ritual

---

## 11. Dependency graph

```
Day 1 (parallel on Al's single machine, streams started in priority order):

  Stream 0 (ts-common) ─── root ─┬──► Stream 1 (adk-orchestrator)
                                 ├──► Stream 2 (data-connector)
                                 ├──► Stream 3 (ui-assistant)
                                 └──► Stream 4 (scraper)

  Stream 4 (scraper)   ── can start in parallel with ts-common
                           (produces prep artefacts; doesn't consume
                           types until Trip/Story schemas land)

  Stream 5 (cms)       ── can start day 1 independently
                           (prompt drafting needs only brand voice + segmentation)

  Stream 6 (legal)     ── drafting starts day 1; wiring waits for Streams 1/3

  Stream 7 (validation) ── skeleton day 1; full wiring gates on Stream 1 endpoint

Integration arrows:

  Stream 1 ◄── Stream 5 (WHY/HOW prompts loaded at runtime)
  Stream 1 ◄── Stream 6 (consent flag, retention TTLs)
  Stream 2 ◄── Stream 4 (fixtures then indexed content)
  Stream 2 ◄── Stream 5 (tools read CMS placeholder content pre-Vertex)
  Stream 3 ◄── Stream 1 (SSE / message.parts contract)
  Stream 3 ◄── Stream 6 (disclosure copy, consent UX)
  Stream 7 ◄── Stream 1 (orchestrator endpoint under test)
  Stream 7 ◄── Stream 2 (tool correctness evaluated via trajectory metrics)

External gates:

  Friday 24 Apr data session ──► Stream 4 (ontology + ID strategy + sample URLs)
                             ──► Stream 2 (real Vertex queries)
                             ──► Stream 0 (content schema revision)

  GCP "AI Pat Chat" access ──► Streams 1/2 deploy (Thomas Forster owns setup)
                            ──► Stream 2 Firestore / Vertex / SMTP wiring
                            ──► Stream 7 production tracing

  Sales thinking docs        ──► Stream 5 (WHY/HOW refinement)
  (Luke + Lane, 1–2 weeks)   ──► Stream 7 (golden cases derived from real transcripts)

  Claude account clarification ──► Stream 4 (extraction runs) and Stream 1 (inference)
  (Swoop-provided vs Al's)

  Legal counsel review        ──► Stream 6 sign-off → M5
```

### 11.1 What can actually run in parallel vs sequence

- **Day 1 parallel**: ts-common stub + scraper prep (URL discovery, extraction prompt drafting) + CMS drafting. These don't contend.
- **Day 2+ parallel (once ts-common stubs land)**: orchestrator + data-connector + UI all mock each other at the boundary (SSE contract, tool HTTP contract). This is the heart of the parallelisation gain.
- **Sequential-ish**: validation harness skeleton is trivial to stand up early but doesn't give signal until Stream 1 has a runnable endpoint. Legal's wiring work is sequential after UI and orchestrator are real.

---

## 12. Integration milestones

### M1 — Hello-world end-to-end

**Goal**: every stream alive with stubs wired. A user opens the widget locally and has a conversation that invokes stubbed tools and renders stubbed widgets.

**Constitutes**: Streams 0–3 at day-1 deliverable state, Stream 4 producing 5 fixtures, Stream 5 at draft-prompt level, Streams 6 and 7 scaffolded.

**Purpose**: de-risks the integration surface; proves the SSE + `message.parts` + ADK-event translation pipe; surfaces contract bugs while they're cheap.

**Target**: end of week 1 (working days, per proposal's 4-week baseline).

### M2 — Real data flowing

**Goal**: agent retrieves real trip and story content from Vertex AI Search; tool calls return real data.

**Gates on**: Friday 24 Apr session → ontology + sample URLs → scraper bulk run → Cloud Storage → Vertex ingestion. Also requires GCP access for Vertex provisioning.

**Constitutes**: Streams 4 and 2 upgraded from stubs; `ts-common` schemas possibly revised.

### M3 — Triage + handoff working end-to-end

**Goal**: full conversation arc including triage decision (`qualified` / `referred_out` / `disqualified`), consent ask, and handoff submission with real email delivery.

**Gates on**: sales docs landing → Stream 5 HOW fragments refined → triage criteria operational. Also: sales inbox address confirmed with Swoop; SMTP wired.

### M4 — Deployed to Swoop GCP (AI Pat Chat)

**Goal**: orchestrator + data-connector running on Cloud Run in Swoop's GCP project; Firestore session state; Vertex indexes live; Cloud Logging wired.

**Gates on**: Thomas Forster's GCP provisioning (named "AI Pat Chat" per 21 Apr meeting); IAM for Al; secrets in Secret Manager.

### M5 — Legal sign-off + ready for embed

**Goal**: disclosure, retention, consent flows reviewed and approved by Swoop's legal counsel. Swoop's in-house team embeds the widget on the Patagonia site behind a nav button (per Julie call / proposal).

**Gates on**: Stream 6 review cycle complete; Swoop's privacy policy updated; iframe embed coordination with Swoop dev team.

---

## 13. Branching strategy — OPEN DECISION

Al's decision. Three options considered; none pre-decided. Al's prior leaning is trunk-based with package ownership when the parallelisation math works out.

### Option A — Worktree-per-stream

- One git worktree per stream on a long-lived branch; frequent PR merges to `main`
- **Pros**: physical isolation; cheap to reset a stream; good if streams fork genuinely independent experiments
- **Cons**: worktree orchestration overhead for a solo build; shared-type changes trigger rebase across worktrees; adds coordination surface

### Option B — Branch-per-stream, single checkout

- Single checkout; switch branches between streams
- **Pros**: simpler tooling than worktrees
- **Cons**: mental-overhead of branch-switching with uncommitted work; easy to step on yourself

### Option C — Trunk-based with package ownership

- All work to `main`; each stream owns a package directory; `ts-common/` edits coordinated explicitly
- **Pros**: simplest to operate solo; CI catches integration breaks within minutes; Phase-1-aligned
- **Cons**: demands discipline on `ts-common` edits; bad for truly experimental long-running work (none here)

### Tradeoff read for a solo build

The three parallelisation dimensions at play:
- **Number of Claude Code agents Al runs concurrently** (on one machine, realistically 1–3 at any moment)
- **Isolation needed between streams** (low — they share `ts-common` and need to interoperate early)
- **Overhead cost of worktree / branch juggling** (non-trivial for solo)

Option C has the lowest ceremony and best feedback loop; Option A has the best isolation when multiple agents genuinely conflict. Option B is dominated.

**Decision required from Al before parallelisation kicks off.** Not pre-decided here.

---

## 14. Ownership

Solo build. Realistic mapping:

| Role | Person | Notes |
|---|---|---|
| Build (all streams) | **Al** | 12 best case / 16 best estimate days per proposal. Claude Code agents execute under Al's direction. |
| GCP setup + IAM | **Thomas Forster** (Swoop) | Named owner of "AI Pat Chat" project setup per 21 Apr meeting |
| Secondary technical contact | **Richard Connett** (Swoop) | Tech lead at Swoop for 3y; familiar with Mongo/MySQL split |
| Data ontology session | **Thomas Forster or Martin** | Friday 24 Apr (Julie confirming) |
| Sales thinking docs (WHY/HOW input) | **Luke + Lane** | 1–2 weeks |
| Sales inbox + email domain | **Julie / Luke** | TBD pre-M3 |
| Internal handover receiver | **Thomas Forster** | Runs ingestion at cadence post-M5 |
| Legal sign-off | **Swoop's legal counsel** | Sign-off blocks M5 |
| Claude account | **Swoop dev team extended Enterprise account** (Luke's 20 Apr commitment) | Julie checking with Tom on Enterprise status |

**What Al does not do**: Swoop relationship beyond build; iframe host integration (Swoop in-house); brand styling (Swoop in-house); CRM integration (deferred).

**What Claude Code agents do**: execute streams inside Al's direction — coding, testing, refactoring on interface shift, PR creation. Not: WHY/HOW prompt authoring (taste-driven), legal coordination, Swoop comms.

---

## 15. Kickoff checklist

Before parallelisation kicks off:

- [ ] **Branching strategy chosen** (§13)
- [ ] **GCP access**: Thomas Forster has set up "AI Pat Chat"; Al has IAM for dev
- [ ] **Friday 24 Apr data session booked** with Thomas or Martin
- [ ] **Claude account clarified**: Enterprise status of Swoop's dev team account confirmed (Julie → Tom)
- [ ] **Repo scaffolded** — `ts-common/` + `cms/` skeleton so Stream 0 and Stream 5 have launching points
- [ ] **Monorepo tooling chosen** (pnpm workspaces recommended — see `06-repo-structure.md` §3)
- [ ] **Node / TS / ADK versions pinned** in `.nvmrc` and `packageManager` field
- [ ] **Local dev runbook drafted** (`scripts/dev.sh`, per `06-repo-structure.md` §8)
- [ ] **CI skeleton** committed (GitHub Actions, `ci.yml` stub)
- [ ] **Sales inbox address** requested from Julie (not blocking M1; blocking M3)

---

## 16. Coordination mechanics

Regardless of branching option chosen:

- **`STREAM.md` per package** (per `06-repo-structure.md` §2.4): status, current task, blockers, interface changes proposed. Claude Code agents update at session start/end.
- **Shared-type edits** (anything in `ts-common/`) are treated as coordinated: Al reviews before landing, affected consumers updated in the same or next PR.
- **CI on `main`** is the integration gate — any red blocks new stream work until green.
- **Planning docs are canonical**: if a stream discovers the plan is wrong, the fix is a PR to `planning/` first, then code.

---

## 17. Open decisions

| # | Decision | Default (if any) | Blocker? |
|---|---|---|---|
| 1 | Branching strategy (§13) | Al leaning Option C | Yes — blocks parallelisation |
| 2 | Monorepo tooling | pnpm workspaces | No; any choice fine if consistent |
| 3 | MCP-shaped vs plain REST for connector transport | MCP-shaped | No; decide during Stream 2 build |
| 4 | A2A vs SSE-translator for UI transport | SSE-translator for V1 | No; additive later |
| 5 | Session backend for dev | In-memory | No; Firestore post-M4 |
| 6 | Weaviate as early fallback vs Vertex-only | Vertex-only first | No; tracked in `01-architecture.md` |
| 7 | Claude account for build-time inference | Swoop Enterprise if available | No; Al's account usable in interim |
| 8 | Validation vendor (Braintrust / LangSmith / Arize AX) | None in V1 | No; revisit at 100 cases per `07-validation-harness.md` |
| 9 | Judge model for Stream 7 | Claude Opus 4.x | No |
| 10 | Meta-tag IDs vs slug IDs vs JSON API for scraper | Pursue meta tag with Thomas Friday; fall back to slug | No; settles Friday |

---

## 18. What Claude Code should do with this doc

1. **Follow stream scope**: don't drift across package boundaries without explicit direction.
2. **Update `STREAM.md`** at session start/end.
3. **Respect interfaces** defined in `ts-common` + `01-architecture.md` §12; propose changes in PRs, not silently.
4. **Prefer stubs to blocking** when a dependency isn't ready — fixture data is cheap; blocked streams are expensive.
5. **Mark "shape" status honestly**: if something's `open`, flag it; don't pretend-settle by inventing a decision.
