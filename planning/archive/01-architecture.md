# 01 — Architecture

**Status**: Draft, v2 (PoC-grounded rewrite).
**Purpose**: Implementation blueprint. Claude Code will generate execution plans from this document.
**Scope**: What the ChatGPT Apps SDK PoC gave us, and what we are swapping, extending, or adding for the web version. System shape, services, interfaces, data flow, swap-out surfaces. Not: workstream sequencing (see `05-workstreams.md`), data specifics (see `02-data-access.md`), handoff schema (see `03-handoff-schema.md`), repo layout (see `06-repo-structure.md`).

Legend for each major decision: **[settled]** confirmed in 20/21 Apr meetings or prior agreement with Swoop; **[leaning]** Al's current recommendation, not yet ratified; **[open]** unresolved — needs a decision.

---

## 0. Starting point: what the PoC gives us

The ChatGPT Apps SDK prototype at `chatgpt_poc/product/` is the baseline. V1 of the web tool is an evolution of that codebase, not a from-scratch build. Concretely:

- **`product/mcp-ts/`** — Express + `@modelcontextprotocol/sdk` MCP server. 7 tools live under `src/tools/`. Lib helpers under `src/lib/` (`component-search.ts`, `data-loader.ts`, `embeddings.ts`, `image-search.ts`, `mailer.ts`). Widget HTML resources under `src/resources/widgets.ts`. Entry points `index.ts` and `server.ts`.
- **`product/ts-common/`** — canonical Zod schemas and TypeScript types across `domain.ts`, `enrichment.ts`, `tools.ts`, `mcp.ts`, `widgets.ts`. Tool input schemas and structured-content types already exist. `TOOL_DESCRIPTIONS` in `tools.ts` uses a WHY/HOW/WHAT × User/ChatGPT/Swoop matrix (see `cms/PROMPT_ENGINEERING.md`).
- **`product/ui-react/`** — 4 React widgets under `src/widgets/` (`component-detail`, `component-list`, `inspiration`, `lead-capture`), each with its own `App.tsx` / `main.tsx` / `index.html`. Shared primitives under `src/shared/` (`SwoopBranding.tsx`, `hooks.ts`, `theme.css`, `types.ts`). Dev harness in `src/dev-harness.tsx`.
- **`product/cms/`** — `guidance-payload.json`, `library-data.json`, `image-catalogue.json`, `image-annotations.json`, plus `PROMPT_ENGINEERING.md`. Sales/brand source material in `chatgpt_poc/sales docs/extracted/` (`sales-process.md`, `the-brand-platform-toolkit---oct-14th-sales.md`, `tone-of-voicedecember-2025-for-presenting.md`, `why-swoop---elevator-pitch-training-ant.md`, `why-swoop-emails.md`).
- **`raw_data/`** — real data shapes from Swoop: `swoop.components.json`, `swoop.templates.json`, `images_urls.json`.

### PoC design patterns that carry forward

- **Apps SDK had no system prompt.** Behaviour was shaped entirely via tool descriptions + returned `structuredContent`. For the web version we **will** have a system prompt (the WHY layer), but the idea of MCP tools as behaviour-carriers (their descriptions steer the agent's choices) transfers directly to the WHAT layer.
- **Tool descriptions are load-bearing prompt artefacts.** They follow the WHY/HOW/WHAT × User/Agent/Swoop matrix documented in `cms/PROMPT_ENGINEERING.md`. This framework is reused for the web tool; only the "× ChatGPT" column becomes "× Agent".
- **Widget/iframe pattern.** ChatGPT rendered each widget in its own iframe, hydrated from `_meta.ui.resourceUri` and `structuredContent`. For the web version, the widgets render directly inside our own chat surface (no iframe-in-iframe). The widget React code itself is reusable — the integration layer is what changes.
- **Structured content is the agent-visible narrative.** Tools return both a short `text` message (what the agent reads) and a `structuredContent` blob (what the widget reads). That separation is retained.

### The 7 existing PoC tools — what they become in the web version

These names stay. They are WHAT-layer function tools in the new architecture, exposed by the MCP connector service (the evolution of `mcp-ts`). The agent reaches them via MCP over HTTP.

| PoC tool | Web-tool role | Notes / likely evolution for Patagonia V1 |
|---|---|---|
| `get_conversation_guidance` | Returns the HOW-layer guidance payload to the agent at conversation start | PoC returned `guidance-payload.json` as `structuredContent`. In the web version the WHY lives in the system prompt; this tool delivers HOW fragments + domain framing. Content regenerated for Patagonia. |
| `get_library_data` | Loads the Swoop product catalogue | PoC categories are `ships` / `cruises` / `activities`. Patagonia categories may differ — to be finalised in the Friday 24 Apr session with Thomas/Martin. Categories become a data-ontology TBD, not a code TBD. |
| `show_component_list` | Renders a browsable visual list of components | Accepts `componentIds` OR a natural-language `query` which the server resolves via component-search. The web version uses Vertex AI Search over scraped content; PoC used local embeddings via `@xenova/transformers`. |
| `show_component_detail` | Renders a single detailed component | Same contract; same widget re-used. |
| `illustrate` | Returns curated images that match a mood/keyword/component | Backed by `image-catalogue.json` + `image-annotations.json` in PoC. Web version needs to resolve Patagonia images — likely a separate Vertex index or reuse of the existing image-search lib. |
| `handoff` | Opens the lead capture widget with a pre-filled summary | Semantics unchanged. Widget persists. |
| `handoff_submit` | Captures contact details and fires the specialist email via `lib/mailer.ts` | PoC logs to console + SMTP. Web version: same, plus durable persistence to a handoff store (see §6.4). |

**We do not invent new tool names for V1.** If a capability isn't served by one of these seven, either extend one of them or raise a scope question against this document.

---

## 1. System shape (top-level)

Three runtime surfaces plus a data layer. Two Cloud Run services, a React chat surface, and the ADK-backed agent loop.

```
┌─────────────────────────────────────────────────────────────┐
│  Swoop website  (React host, Swoop's codebase)              │
│  └── trigger / embed                                        │
│      └── Swoop chat UI  (React, our codebase)               │
│           │                                                 │
│           │  SSE (message stream to browser)                │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Cloud Run: agent orchestrator                      │   │
│  │  - Google ADK (TypeScript) agent graph              │   │
│  │  - System prompt (WHY)                              │   │
│  │  - HOW fragment composition                         │   │
│  │  - ADK session state                                │   │
│  │  - Tool invocation via MCP                          │   │
│  │  - Server-side message bus (GCP-native, see §4)     │   │
│  │  - SSE endpoint to browser                          │   │
│  └───────────────────────────────┬─────────────────────┘   │
│                                  │ MCP (HTTP)              │
│                                  ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Cloud Run: MCP connector  (evolution of mcp-ts)    │   │
│  │  - 7 tools from PoC, re-backed to Vertex/Mongo      │   │
│  │  - Express + @modelcontextprotocol/sdk              │   │
│  │  - Vertex AI Search clients (WHAT retrieval)        │   │
│  │  - Handoff delivery (nodemailer + handoff store)    │   │
│  └───────────────────────────────┬─────────────────────┘   │
│                                  ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Data layer                                         │   │
│  │  - Vertex AI Search (scraped website content)       │   │
│  │  - Cloud Storage (raw scraped JSON, images cache)   │   │
│  │  - MongoDB (Swoop's product data, read-only V1)     │   │
│  │  - Handoff store (Firestore — TBD)                  │   │
│  │  - (fallback: Weaviate Cloud Serverless)            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

                ── disposable, external to runtime ──

  Scraper utility (Node + Claude deep research for extraction)
  └── Output: structured JSON → Cloud Storage → Vertex ingestion
```

### Why two Cloud Run services, not one  **[settled — 21 Apr meeting]**

Al proposed and Thomas/Richard agreed in the 21 Apr technical meeting. Reasons, in the terms that were used:

- **Scalability surface.** Orchestrator and connector have different latency/concurrency profiles — search + email calls can be long-running; the agent loop needs warmth.
- **Handover clarity.** The MCP connector is the service Swoop's internal team will eventually own and extend. A clean boundary matters for handover, and the MCP-server pattern maps to the existing PoC they've already seen.
- **Failure isolation.** Orchestrator restart shouldn't invalidate data access; connector redeploy shouldn't kill in-flight sessions.
- **Security posture.** Connector needs IAM for Discovery Engine, Mongo, Storage, SMTP. Orchestrator can have a minimal service account.

---

## 2. Three-layer agent model (WHY / HOW / WHAT)

Source: `research/discovery-agent-architecture-brief.md`. The three-layer model is load-bearing from that research; this section grounds it in the PoC artefacts we already have.

### 2.1 WHY — static system prompt  **[settled: has one; content TBD]**

The Apps SDK PoC had **no** system prompt (that was a platform constraint). In the web version we own the agent loop, so we gain one. The WHY layer is a single authored system prompt covering:

- Brand voice — warm, adventurous, expert, human ("knowledgeable friend who's been to Patagonia")
- Conversational stance — imagination-stoking, inspiring, not transactional
- Hard refusals — **no itinerary building** (Julie's explicit concern, 20 Apr), no booking, no final pricing commitments, no medical/legal/safety guarantees
- Triage posture — Patagonia differs from Antarctica here: polite triage to identify and redirect low-fit enquiries (backpacker tier). Never rude, never exclusionary. (20 Apr: Luke was explicit that Patagonia wants triage, Antarctica wants all enquiries.)
- Group-tours bias — proactively surface group options; solo travellers are strong group candidates (20 Apr: Luke called this out specifically)
- Handoff intent — end-state is a warm handoff with persona + wishlist + motivation

**Source material** for drafting this prompt lives in `chatgpt_poc/sales docs/extracted/` — Emma Parry's Antarctica-focused sales process, brand toolkit, tone of voice, why-swoop emails. Patagonia-specific material is forthcoming from Luke/Lane within 1–2 weeks (20 Apr action).

**Location**: `cms/prompts/why.md` — single markdown file, loaded verbatim into system message at orchestrator startup. One source of truth, editable by non-engineers.

### 2.2 HOW — dynamic prompt fragments  **[leaning]**

Conversation-state-aware fragments composed per turn. The PoC's `guidance-payload.json` is the starting point for the fragment content — it already contains `salesMethodology`, `toneOfVoice`, `brandPillars`, `dimensionsFramework`, `readinessWarmthModel`, `handoffTriggers`, `constraints`, `affordabilityGuidance`, `domainSummaries`. In the PoC these were all shipped as a single blob via `get_conversation_guidance`. For the web version we decompose this into fragments the orchestrator composes.

Fragment categories (initial set, extensible):

- **Discovery stance** — open-ended exploration; broaden curiosity.
- **Convergence stance** — user is narrowing; inject comparison frames.
- **Triage stance** — low-fit signals (Patagonia-specific: backpacker budget, off-the-beaten-track trekker profile against group-tours bias). Polite redirection, never shut down.
- **Qualification stance** — warm lead; inject handoff-shaping prompts to extract wishlist + motivation.
- **Sensitive stance** — off-piste queries (safety, legal, medical). Inject refusal shape.

**Classifier**: lightweight call (Gemini Flash) that reads recent turns + session state and emits stance labels. Fragment composition is deterministic from classifier output.

**Location**: `cms/prompts/how/*.md` — one file per fragment. Fragment index and composition rules in `cms/prompts/how/index.json` (TBD shape).

**Open question — fragment taxonomy vs Phase 1 BROWSE/EXCITE/CONVINCE/CONVERT model.** The PoC's `guidance-payload.readinessWarmthModel` encodes a four-stage funnel. The fragment taxonomy above is stance-based rather than stage-based. Reconcile during execution — likely they co-exist (stance is the HOW layer classifier output; stage is metadata on the session state).

### 2.3 WHAT — dynamic content retrieval via MCP tools  **[settled]**

Function tools exposed to the ADK agent via the MCP connector. The connector is the PoC's `mcp-ts` service, evolved. All seven existing tools are kept by name (see §0). Implementation changes:

- **Retrieval backend.** PoC used local JSON + `@xenova/transformers` for embeddings. V1 uses Vertex AI Search via Discovery Engine SDK, wrapped in custom function tools (not the built-in ADK `VertexAiSearchTool` — see §6.1).
- **Image resolution.** `illustrate` currently reads a bundled JSON catalogue. For Patagonia V1 the image set is re-indexed from scraped content + Swoop's image URL sources. Same tool contract.
- **Handoff persistence.** `handoff_submit` writes to a durable store (see §6.4) in addition to sending the email. PoC only emailed + console-logged.

---

## 3. ADK agent graph

### 3.1 Shape  **[settled: single-agent V1]**

Single primary agent for V1. Multi-agent composition (triage router, region specialists) is out of scope — we leave the door open but don't build it.

```
User turn
  │
  ├── HOW classifier (cheap, parallel)
  │     └── stance labels → session state
  │
  └── Primary agent (ADK LlmAgent)
        ├── System = WHY + composed HOW fragments (via InstructionProvider)
        ├── Tools = MCP toolset (7 tools from connector)
        ├── Conversation history (ADK-windowed)
        └── Streaming output → server-side bus → SSE → browser
```

### 3.2 Framework and model  **[settled — 21 Apr meeting]**

- **Agent framework: Google ADK (TypeScript)**. `@google/adk`. Al committed to ADK explicitly in the 21 Apr meeting ("build the fundamental agentic substrate in TypeScript using Google ADK, specifically avoiding Python libraries").
- **Claude Agent SDK — considered, not chosen.** The research brief (`discovery-agent-architecture-brief.md`) frames this as the portability question. Model portability is not strategic here, but the Google-ecosystem governance narrative (Google's framework on Google's cloud, clean handover to Swoop's internal team who already use GCP) is. Claude Agent SDK's SKILL.md model for HOW would be ergonomically nicer; we take the ~1 extra week of HOW-layer and orchestration wiring in ADK as the price.
- **Primary model**: Claude (Sonnet tier). Chosen for conversation quality; ADK abstracts the provider so swap to Gemini is a config change if cost/policy drives it.
- **HOW classifier**: Gemini Flash. Cheap, fast, structured output.

### 3.3 Session state  **[settled — 21 Apr meeting]**

ADK-provided session management ("utilise solutions provided by the Google ADK ecosystem to keep the moving parts minimal" — 21 Apr). Session backend TBD between ADK's in-memory default and Firestore; Firestore for production.

Session holds:
- Conversation history (ADK-managed)
- HOW classifier stance history
- Triage state
- Wishlist-in-progress (the handoff payload accumulator)
- Session metadata (entry URL, region of interest hint, variant-id for A/B)

TTL: 24h in-progress; promoted to durable handoff store on submit.

### 3.4 Multi-agent / A2A posture  **[open, deferred]**

V1 ships a single agent. ADK's `to_a2a()` decorator is effectively free to add later if/when multi-agent composition becomes interesting (e.g. Patagonia + Antarctica + triage router). No V1 cost to defer — explicitly out of scope for this release.

---

## 4. Streaming path

### 4.1 Transport to browser: SSE  **[leaning]**

Server-Sent Events from orchestrator → browser. Simple, one-way, works through iframes, handles reconnection. This is unchanged from the draft.

### 4.2 Server-side message plumbing: GCP-native  **[settled — 21 Apr meeting]**

**Supersedes the SSE-only framing that appeared in the first draft.** The 21 Apr meeting was explicit: for message passing between the agent loop and the delivery-to-browser layer we want "a messaging queue or streaming source… such as a pub/sub system or Firebase Realtime DB", preferably within the Google ecosystem.

Reconciliation:

- **Browser ↔ orchestrator: SSE.** HTTP streaming to the React UI.
- **Inside the orchestrator: a GCP-native bus.** Either Cloud Pub/Sub or Firebase Realtime DB, chosen to keep streaming flowing during tool calls (so the UX doesn't feel stilted while a Vertex Search or an MCP round-trip is pending). TBD which; pick during the first spike.

This means the orchestrator is two things: (a) the ADK agent loop writing events to the bus, (b) an SSE endpoint draining the bus per-session to the browser. The translator (ADK events → SSE parts) sits between the bus and SSE.

### 4.3 Wire format  **[leaning]**

Vercel AI SDK v5 `message.parts` shape. This is the de-facto Tailwind/React chat standard per `research/ui-deep-research.md`. Lets us adopt any AI-SDK-compatible React chat kit later. The translator layer in the orchestrator maps ADK streaming events → AI SDK message parts.

Part types we use:
- `text` — model output tokens
- `tool-call` — with lifecycle states (input-streaming / input-available / output-available)
- `reasoning` — if emitted
- `data` (custom) — structured content for widget hydration (maps to the PoC's `structuredContent` pattern)

### 4.4 Translator layer

Stateless-per-turn TS component in the orchestrator. Input: async iterator of ADK events. Output: async iterator of AI SDK parts, published to the bus. Under ~300 lines. Testable against recorded ADK fixtures.

---

## 5. UI layer

### 5.1 Framework: React  **[settled — 21 Apr meeting]**

React. Thomas requested this explicitly (to align with Swoop's existing framework-streamlining effort). Tailwind assumed. Swoop's in-house team handles brand styling and embedding after delivery.

### 5.2 Chat component library: shadcn-style primitives, assistant-ui leaning  **[leaning — research recommendation, not meeting-confirmed]**

Per `research/ui-deep-research.md`, assistant-ui is the default choice for tool-driven agents in 2026: it has the first-class tool-call → React-component registry (`makeAssistantToolUI({ toolName, render })`), partial-arg streaming, HITL interrupts, and an AI-SDK adapter. This maps cleanly onto our port of the PoC widgets.

This is a **leaning**, not a decision. Flagged pre-1.0 churn risk (weekly releases, open AI-SDK-v5 integration bugs). Pragmatic fallbacks in the research doc: Vercel AI Elements (copy-paste shadcn components), Prompt Kit, Kibo UI. Commit during the UI spike in Sprint 1.

### 5.3 Widget reuse from the PoC

The four existing React widgets in `chatgpt_poc/product/ui-react/src/widgets/` all carry across:

- `component-detail` → rendered inline for `show_component_detail` tool calls
- `component-list` → rendered inline for `show_component_list` tool calls
- `inspiration` → rendered inline for `illustrate` tool calls
- `lead-capture` → rendered inline for `handoff` tool calls, submits via `handoff_submit`

The React code is reusable; the ChatGPT-specific hydration path (iframe + `window.openai` / `useApp` hooks) is replaced by the tool-call registry pattern (`makeAssistantToolUI` or equivalent). `SwoopBranding.tsx`, `hooks.ts`, `theme.css`, and `types.ts` under `src/shared/` port across with minor adjustments.

### 5.4 Integration path

1. AI-SDK-shaped adapter connects to orchestrator SSE endpoint
2. Tool-call registry maps each of the 7 MCP tool-call types to its React widget
3. Session ID persisted in `sessionStorage` so reload resumes (dev convenience)
4. Disclosure UI (EU AI Act Art. 50 — see `04-legal-compliance.md`) is part of the baseline chat chrome, not a separate widget

---

## 6. Data layer

### 6.1 Primary search: Vertex AI Search  **[settled — 21 Apr meeting]**

Al's top recommendation; Thomas/Richard agreed. Discovery Engine documents auto-indexed with RAG + automatic reranking. Per the research doc and per ADK's known bug surface around `VertexAiSearchTool`, retrieval is wrapped in **custom function tools using the Discovery Engine client directly**, not the ADK built-in. Sidesteps the `"Multiple tools are supported only when they are all search tools"` error and related structured-datastore bugs (#3406, #4157).

Indexes: separate datastores for scraped website content (trips/stories/regions — final taxonomy is the Friday 24 Apr data-ontology session with Thomas or Martin) and for images if keyword/mood search moves from bundled JSON to Vertex.

### 6.2 Fallback: Weaviate Cloud Serverless  **[leaning — fallback only]**

From the 21 Apr meeting: "exploring Weeviate as a potential turnkey solution, depending on the pricing structure." Kept as plan-B. Swap-in is re-ingestion + single-file retrieval-client swap in the MCP connector. Preference order is Vertex first; switch only if pricing or relevance disappoint.

### 6.3 Product data source: Mongo (read-only, V1)  **[settled — 21 Apr meeting]**

Swoop's product information lives in MongoDB today. The MCP connector gets read-only access for component lookups. But: **prices and place details only live on the live website**, served via PHP into the React frontend, not in Mongo. This is why we scrape (§7).

The website is migrating to Mongo-as-source-of-truth in October 2026. V1 architecture is Mongo-read + scraped-augmentation; the Oct cutover collapses this to Mongo-only with the scraper retired.

### 6.4 Raw content store

Cloud Storage bucket. Holds:
- Raw scraped HTML cache, versioned by scrape date
- Structured JSON output of the scraper — the Vertex ingestion source
- (Later) image binary cache if needed

### 6.5 Handoff store  **[open — Firestore leaning]**

Durable record of submitted handoffs. Simple schema, Firestore default. Referenced from `03-handoff-schema.md`.

### 6.6 Bridge from scraped content to internal IDs  **[leaning — Thomas's idea]**

Thomas suggested in the 21 Apr meeting: since internal Mongo IDs aren't currently exposed in the public page HTML, add a **meta tag containing the component ID** on each product page. The scraper reads this; the Vertex record carries it; the agent can cross-reference to Mongo via `get_library_data` or its successors. Single small change on Swoop's side, clean data bridge. Treat as a dependency on Swoop's dev team.

---

## 7. Scraper utility  **[settled — 21 Apr meeting]**

Disposable by design. The 21 Apr meeting was explicit: scraping is the pragmatic V1 ETL ("zero work for the in-house team"); the script will need rewriting when Swoop's website migrates to Mongo in October 2026.

### 7.1 Shape

- Standalone Node utility. Runnable locally; deployable as a Cloud Run Job for scheduled re-scrapes.
- Uses **Claude deep research + prompt engineering for extraction** — phrasing from the meeting. Structured-output mode to populate the JSON schemas in `02-data-access.md`.
- Input: URL list (sitemap-derived; blog has hundreds of articles per 20 Apr).
- Output: per-page JSON to Cloud Storage.
- Handles the React-in-HTML challenge: Thomas confirmed 90% of product data is rendered into HTML server-side via PHP, so scrape-visible.

### 7.2 Cadence  **[leaning]**

Initial bulk scrape, then incremental re-scrapes. Target handing the script off to Swoop's internal team to operate — architectural priority per 21 Apr.

### 7.3 Alternative path

Al suggested a simple JSON API on Swoop's side ("spits out the data as JSON") as a cleaner V1 ingress. If Swoop's team builds it before our cutover, it replaces the scraper with no architecture change beyond swapping the ingestion source. Treat as opportunistic, not blocking.

---

## 8. Session management

### 8.1 Warm pool

Cloud Run configured with `min-instances > 0` on the orchestrator. Cold-start kills conversational feel. Tuning dimensions (min warm count, concurrency per instance, max instances) are deployment config.

### 8.2 Session persistence  **[settled — 21 Apr meeting]**

ADK-provided. Firestore-backed in production. Keyed by session ID.

### 8.3 Idle handling  **[leaning]**

- 15 min idle → paused (state persisted; warm-pool instance freed)
- 24 hr idle → archived (read-only)
- Reconnection: UI re-attaches by session ID; orchestrator rehydrates

---

## 9. Observability  **[open — V1 minimum only]**

V1 minimum:
- Structured logs to GCP Cloud Logging (both Cloud Run services)
- Per-turn request/response traces (sampling TBD)
- Error alerting via Cloud Monitoring

Later: tool-call timings, retrieval quality logging, per-conversation cost tracking. Langfuse / Braintrust / external agent-obs tooling explicitly out of V1.

---

## 10. Patagonia vs Antarctica  **[open — data ontology]**

V1 is **Patagonia** (20/21 Apr confirmed — GCP project name "AI Pat Chat"). Patagonia was chosen because it's "the superset of functionality" — solving Patagonia first makes Antarctica trivial to apply later.

**Record types may differ from Antarctica's cruise/ship-heavy data model.** The PoC's `ships` / `cruises` / `activities` taxonomy was Antarctica-native. Patagonia likely needs different primary types (trek routes, lodges, regions, experiences?) — to be worked out in the 1-day working session with Thomas or Martin on Friday 24 Apr.

The architecture must not hard-code Antarctic categories beyond V1. Specifically: `get_library_data`'s `category` enum is generated from `cms/library-data.json`'s top-level keys, not fixed in the tool schema beyond an open-ended string. `ts-common` Zod types for library records are parameterised per region.

---

## 11. Interfaces (contracts between components)

### 11.1 UI ↔ Orchestrator

- `POST /chat` (SSE response)
- Request: `{ sessionId: string, message: string }`
- Response: SSE stream of AI-SDK-shaped message parts
- Auth: V1 — none (demo surface). Future: Swoop-issued short-lived JWT when productionised on their domain.

### 11.2 Orchestrator ↔ MCP connector

- Transport: MCP over HTTP (`@modelcontextprotocol/sdk` streamable HTTP — same pattern as PoC `mcp-ts/src/index.ts`).
- Endpoint: `POST /mcp` on the connector.
- Tool shape: inherits exactly from the PoC's 7 tools; Zod schemas in `ts-common/src/tools.ts`.

### 11.3 Connector ↔ Vertex / Mongo

- Discovery Engine client calls, wrapped in a thin retrieval adapter so a Weaviate swap is a single-file change.
- Mongo: read-only client scoped to the product catalogue collections.

### 11.4 Scraper → Storage → Vertex

- Scraper writes JSON to Cloud Storage bucket.
- Ingestion job reads from Storage, pushes to Vertex datastore. Idempotent.

---

## 12. Swap-out surfaces

| Surface | Current | Swap-out cost |
|---|---|---|
| Agent framework | Google ADK (TS) | High — full agent loop rewrite. Mitigation: WHY/HOW prompts are framework-agnostic markdown; tool contracts live in `ts-common`. |
| Primary model | Claude Sonnet | Low — ADK config change. |
| Classifier model | Gemini Flash | Low — config. |
| Search backend | Vertex AI Search (Discovery Engine) | Medium — re-ingest to Weaviate, swap retrieval client in connector (single file). |
| Streaming protocol to browser | SSE + AI-SDK parts | Medium — would only change for A2A + native chat runtime. Translator absorbs. |
| Internal message bus | GCP-native (Pub/Sub or Firebase RTDB, TBD) | Low — internal to orchestrator. |
| UI chat library | assistant-ui (leaning) | Medium — tool-call registry is the surface; adapter swap is bounded. |
| Hosting | Cloud Run on Swoop GCP | Medium — deployment config + service account. |
| Data source | Scraped website + Mongo | Designed to swap: Oct 2026 website migration → Mongo-only. Architecture unchanged; ingestion source collapses. |

---

## 13. Out of scope for V1

- Multi-agent composition (triage router, region specialists)
- Voice / audio input
- Image generation for responses (illustrate is retrieval, not generative)
- Persistent user accounts / auth
- Multi-language (English only)
- Mobile-optimised widget (Swoop owns responsive)
- A/B testing infrastructure (button placement is Swoop's side)
- Analytics beyond basic logging
- Prompt caching (deferred cost optimisation)
- CRM integration
- Rate limiting (reactive if abused)

---

## 14. Open decisions

| # | Decision | Owner | Blocker? |
|---|---|---|---|
| 1 | Patagonia data ontology (record types for `get_library_data`) | Swoop — Thomas/Martin session Friday 24 Apr | Yes — shapes tool schemas + Vertex index layout |
| 2 | Meta-tag-embedded IDs on product pages (Thomas's idea) | Swoop dev team | No blocker, but unlocks cleaner bridge |
| 3 | Message bus: Pub/Sub vs Firebase Realtime DB | Al, first spike | No |
| 4 | Chat component library: assistant-ui vs Vercel AI Elements vs mix | Al, UI spike | No |
| 5 | Session backend: Firestore vs ADK in-memory (for dev) | Al | No |
| 6 | Fragment taxonomy reconciliation (stance vs BROWSE/EXCITE/CONVINCE/CONVERT stage) | Al | No — affects HOW content authoring |
| 7 | Handoff store schema and backend (Firestore leaning) | Al + Swoop | See `03-handoff-schema.md` |
| 8 | Image pipeline: keep bundled JSON or index to Vertex | Al | No for V1 |
| 9 | Observability destination beyond Cloud Logging | Al | No for V1 |
| 10 | Fallback UX on agent error / rate limit | Al | No for dev |
| 11 | Model / cost ceiling per conversation | Al | No for dev; yes pre-launch |

---

## 15. What Claude Code should do with this doc

This is the single source of architectural truth for the web project. Execution plans should:

1. Cite the relevant section
2. Stay inside the interfaces in §11
3. Respect the swap-out surfaces in §12
4. Prefer re-use from `chatgpt_poc/product/` over greenfield authoring — `ts-common` types, Zod schemas, widget React, tool descriptions, CMS content scaffolds, `lib/mailer.ts`, etc.
5. Use the 7 existing tool names verbatim; if a new capability is genuinely needed, raise it as a proposed edit to this doc, not a silent addition
6. Surface drift as a PR-shaped edit to this file, not a deviation
