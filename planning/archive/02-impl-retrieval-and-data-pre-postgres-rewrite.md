# 02 — Implementation: C. Retrieval & Data

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4C + theme 5 (disposable ETL).
**Depends on**: A (foundations — `ts-common` tool I/O schemas, workspace scaffolded), Friday 24 Apr hackathon outcome (reshapes §2.1), Swoop media library access (external).
**Coordinates with**: B (agent runtime calls tools via MCP), G (placeholder content at M1 → real content at M2), F (tool calls emit events), D (widgets hydrate from tool outputs).

---

## Purpose

C owns everything the agent retrieves. A data-connector service exposes MCP-shaped tools that the orchestrator calls; the tools read from Vertex AI Search indexed with Patagonia content; the content arrives via an ingestion utility that either scrapes the live Swoop website or consumes a direct API (decision pending Friday 24 Apr). Images resolve through Swoop's existing media library.

The chunk takes Phase 1 the PoC's bundled-JSON + local-embeddings approach to a retrieval stack that handles Patagonia scale. Mongo is explicitly not in scope. Weaviate is out. The scraper (if we scrape) is throwaway — Swoop's late-2026 data consolidation retires it.

---

## 1. Outcomes

When this chunk is done:

- A data-connector service runs on Cloud Run, speaking MCP over HTTP, exposing a Puma-finalised tool set (evolved from the PoC's 7 tools).
- A Vertex AI Search datastore (or small set of datastores) holds Patagonia content — trips, tours, regions, stories — indexed with enough breadth to support a realistic demo conversation.
- An ingestion utility (scrape OR API adapter — Friday decides) pulls content from Swoop into Cloud Storage, then from Cloud Storage into Vertex. Re-runnable, idempotent, diffable between runs.
- Images resolve via Swoop's media library; tool responses carry image URLs the chat surface (D) can render directly.
- If the scrape path wins, tool responses also carry public page URLs for deep-linking — enabling the "go see this page" affordance. If the API path wins, same URLs derived from type+id if feasible (Friday hackathon question).
- Handoff email delivery (the `handoff_submit` tool's outbound path) lands in the connector as a backend function — reusing the PoC mailer pattern.
- Swoop's internal team can run the ingestion at cadence — no hidden dependency on Al's machine.
- **Image annotation pipeline runs** — starter sample annotated pre-launch; full-catalogue annotation completes before production traffic. Annotations stored as record metadata queryable alongside image retrieval.

**Not outcomes**:
- Mongo reads (explicitly not in scope — confirmed no longer used).
- Weaviate (out).
- Full site coverage — scope sufficient for a convincing demo, not the entire Swoop catalogue.
- Vertex re-embedding / custom embedding models (use Vertex defaults).
- Real-time pricing lookups (retrieval returns cached prices if available; authoritative pricing is sales's job).

---

## 2. Target functionalities

### 2.1 Data access strategy — pending Friday 24 Apr hackathon

Two candidate paths. Friday's hackathon with Thomas / Richard / Martin picks one (or confirms we do both, with the API as the primary and scrape as a supplement for URL-generation):

**Path A — API-direct.** Swoop exposes a JSON endpoint (or endpoints) for products, regions, stories. The ingestion utility consumes them and writes canonical JSON to Cloud Storage for Vertex ingestion. **Preferred if feasible** — clean, maintainable, survives the October 2026 data consolidation without being throwaway.

**Path B — Live-site scrape.** The ingestion utility fetches HTML from Swoop's Patagonia website (Thomas confirmed ~90% server-rendered). A Claude-based extraction step parses each page into structured JSON. Output to Cloud Storage. Disposable by design (theme 5). Side-benefit: real page URLs for deep-linking.

**Hybrid** — Path A for canonical data, Path B for URL enrichment if Thomas can't reconstruct URLs from type+id. Tracked as an open question in `questions.md`.

Either path writes to the same Cloud Storage landing zone and feeds the same Vertex ingestion job. The ingestion source is a swap-out surface; the rest of the data layer doesn't change with the choice.

### 2.2 Content ingestion pipeline — produces a *derived* datasource

**Terminology**: the ETL in this chunk creates a **derived datasource**. That's a deliberate, load-bearing label. Cloud Storage + Vertex AI Search + any ancillary store (e.g. annotations) all hold **derived data** — copies / transformations / indexes of content whose authoritative source lives upstream (Swoop's website, API, media library, CMS). Derived data is disposable; authoritative data is not. Any future dev, agent, or manager reading Puma's code should see this word and understand that bypassing the ingestion pipeline to write into the derived store directly is wrong — the correct move is to fix the upstream source and re-ingest.

This labelling also clarifies what October 2026 looks like: when Swoop consolidates authoritative data into Mongo, Puma's ingestion utility gets rewritten; the derived store's shape doesn't need to change substantially because it's already derived from whatever source is upstream.

Whichever ingestion path we take, the shape is:

1. **Fetch**: Path A — HTTP GET against Swoop API(s). Path B — HTTP GET against site URLs.
2. **Extract** (Path B only): Claude-based structured-output extraction per page type. Uses Swoop's extended Claude account for "pure data munching" (Luke's phrase from 20 Apr) to keep costs off Al's account — pending Julie's Enterprise-tier confirmation.
3. **Normalise**: coerce to `ts-common` schemas (Trip, Tour, Region, Story, Image). Zod-validate on the way in.
4. **Persist** to the derived datasource: raw + normalised JSON to Cloud Storage, versioned by ingestion timestamp.
5. **Index**: push normalised records to Vertex AI Search datastore(s). Idempotent — re-ingesting the same source produces an identical index state.

The pipeline runs as a Cloud Run Job on demand, or scheduled (post-M4). Handed off to Swoop's internal team for operation — architectural priority from 21 Apr.

### 2.3 Vertex AI Search — retrieval backend

Settled at top level. Accessed via the Discovery Engine SDK client.

**`VertexAiSearchTool` (ADK built-in) — verify status, don't assume**. The archived research (`planning/archive/research/discovery-agent-architecture-brief.md`) flagged specific bugs in ADK's built-in `VertexAiSearchTool` — notably issues like `"Multiple tools are supported only when they are all search tools"` and structured-datastore handling. **Those reports are dated — verify current ADK status before committing to custom-wrapped tools as a defensive default.** If the built-in is working in the current ADK release, use it. If not, fall back to the Discovery Engine client wrapped in a custom function tool. This is a Tier 3 research step (C.t2).

**Index structure — open**. Candidate shapes:
- One index with content type as a field (simple, unified ranking).
- Per-type indexes (Trip / Tour / Region / Story separately — clean separation but combinatorial retrieval).
- Hybrid (trips+tours together, stories separate — pragmatic split reflecting how the agent reasons).

Decide during Tier 3 based on sample queries the HITL flow-mapping session (G.t0) surfaces.

Reranking and relevance tuning: Vertex defaults initially; tune only if Phase 1 evaluation shows bad answers.

### 2.4 MCP-style data connector service

Cloud Run service, Express + `@modelcontextprotocol/sdk` HTTP transport (evolution of PoC `mcp-ts/`). Tools defined per the tool set below (§2.5). Each tool is a single file under `src/tools/` (PoC pattern). Behind each tool: a retrieval adapter (Vertex Discovery Engine client) plus any normalisation.

IAM: connector needs scoped service accounts for Discovery Engine read, Cloud Storage read, Secret Manager read (for SMTP credentials and any API keys), and SMTP for outbound email.

### 2.5 Tool set for Puma (evolved from PoC 7 tools)

The PoC shipped 7 tools: `get_conversation_guidance`, `get_library_data`, `show_component_list`, `show_component_detail`, `illustrate`, `handoff`, `handoff_submit`. Puma's tool set is an **evolution** — same spirit, trimmed / renamed / merged as real implementation meets real constraints.

Expected Puma tool set (candidates; finalise during Phase 1):
- **`search`** — unified retrieval across content types, parameterised by type filter. Replaces `get_library_data` + `show_component_list` for internal agent use.
- **`get_detail`** — single-record detail by id. Replaces `show_component_detail`.
- **`illustrate`** — image retrieval for mood / keyword / entity. Retained.
- **`handoff`** — opens lead-capture widget with pre-filled summary. Retained.
- **`handoff_submit`** — captures contact details, writes durable record, sends email. Retained.

Removed from PoC: `get_conversation_guidance` — its content moves into the WHY system prompt (chunk G §2.1), no longer a runtime tool call.

**Modular guidance loading is not a custom tool in Puma** (previously proposed `load_skill`). **Google ADK supports agent skills natively** as of late 2025 — Tier 3 C.t4 verifies the current API and uses the native primitive rather than building a bespoke tool. This keeps the Puma tool set tight: retrieval + handoff surfaces, no framework-shaped tools. If the ADK native mechanism turns out to be a poor fit (Tier 3 finding), we fall back to a custom tool; but default to native.

Exact tool name set confirmed during Tier 3 `C.t4`. Tool I/O schemas live in `ts-common` (chunk A stubs).

### 2.6 Image retrieval via Swoop's media library

Location TBC at Friday hackathon — tracked in `questions.md`. Known: images don't live in Mongo; a separate media library exists. Candidate shapes: S3-compatible bucket with direct URLs; Cloudinary or similar managed CDN; CMS attachment store; imgix-fronted origin (the PoC uses imgix).

Retrieval in Puma: `illustrate` tool returns image URLs + annotation-enriched metadata (see §2.6a for annotation pipeline). The chat surface renders images directly. No on-the-fly image generation.

### 2.6a Image annotation pipeline

**Runs in parallel from day one** — does not block the main vertical slice. Can start as soon as media library access lands (Friday hackathon outcome + follow-up).

**What it does**: for each image in Swoop's media library, produce structured annotations — subject (trek / wildlife / glacier / lodge / people), mood (serene / dramatic / social / action), region (Torres del Paine / El Chaltén / Carretera Austral / …), activity tags (hiking / photography / lodge-stay / …), and a short natural-language description suitable as alt text and for retrieval query matching. Produced via a Claude-vision extraction step per image.

**Scope**:
- **Pre-M1**: starter sample annotated (~50 representative images) to power the vertical slice's `illustrate` responses.
- **Pre-production**: **full-catalogue annotation completes** before Puma sees real traffic. Image retrieval quality is strongly dependent on annotation coverage; shipping Puma with a partially-annotated catalogue would mean gap-filled `illustrate` results.

**Storage**: annotations live as **record metadata attached to the image record in the derived datasource** — not a separate database. Candidate implementations:
- Extend the image record JSON with an `annotations` field (simplest; matches PoC's `image-annotations.json` pattern but cleaner).
- Store annotations in Vertex AI Search image-index metadata alongside URL + alt text — makes annotations queryable in the same retrieval call.

The PoC used a simple JSON file (`chatgpt_poc/product/cms/image-annotations.json`) as the "database" — persistent (committed to the repo), but file-scale. For Puma at catalogue scale, the annotations join the image records in whatever derived-datasource shape those records take. Tier 3 C.t5 / annotation task confirms.

**Disposable**: annotations are derived data (from images + the annotation prompt + the vision model). Regenerable on demand. Updates to the annotation prompt trigger a re-annotation run.

**Parallel workstream**: annotation runs independently from tool building — image ids and URLs from the media library are sufficient input. The annotation job can be a standalone Cloud Run Job, re-runnable at whatever cadence Swoop's team prefers.

### 2.7 Deep-link URL generation

If scrape path (or hybrid): tool responses carry the real public page URL per record. Enables chat → page navigation.

If API-direct only: URLs derived from type+id via a known pattern, if Swoop confirms the pattern is deterministic. Otherwise, no deep-links in Puma (tracked in `questions.md`).

Chat surface (D) picks up the URLs from tool responses and renders them as "go see this page" affordances. The cross-page persistence question (whether the chat survives navigation) is chunk D's to decide.

---

## 3. Architectural principles applied here

- **PoC-first**: the connector service evolves `chatgpt_poc/product/mcp-ts/` directly. Tool descriptions, scaffolding, Express + MCP SDK setup, mailer pattern all carry forward.
- **Content-as-data**: ingestion outputs structured JSON into Cloud Storage; Vertex indexes that JSON. No content inlined in connector code.
- **Swap-out surfaces named**: ingestion source (scrape vs API — medium swap cost, isolated in the utility), search backend (Vertex — medium swap to re-ingest elsewhere, but Weaviate is out so this is low probability), MCP transport (low swap — `@modelcontextprotocol/sdk` is the standard).
- **Disposable ETL** (theme 5): the ingestion utility is a throwaway. Rewrite it when Swoop's data consolidation lands.
- **Hand-off clarity**: the connector is the service Swoop's internal team will eventually own. Clean boundary, clear ops handbook.

---

## 4. PoC carry-forward pointers

- `chatgpt_poc/product/mcp-ts/` — connector service base. `src/index.ts` (entry), `src/server.ts` (transport), `src/tools/` (one file per tool), `src/lib/` (helpers).
- `chatgpt_poc/product/mcp-ts/src/lib/mailer.ts` — nodemailer + Gmail SMTP pattern. Carry forward; swap SMTP target to Swoop's real endpoint.
- `chatgpt_poc/product/mcp-ts/src/lib/component-search.ts`, `image-search.ts`, `data-loader.ts` — patterns for wrapping retrieval. Reference for interfaces; actual backends change (local embeddings → Vertex).
- `chatgpt_poc/product/ts-common/src/tools.ts` — tool descriptions and Zod schemas. Starting point for Puma's evolved tool set.
- `chatgpt_poc/product/scripts/build-library.ts`, `build-image-catalogue.ts` — PoC ingestion scripts (MongoDB-dump transformers). Shape reference for Puma's ingestion utility; the actual source changes.
- `chatgpt_poc/raw_data/swoop.components.json`, `swoop.templates.json` — real PoC sample data shapes. Instructive for the Patagonia equivalent.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| C.1 | Data access strategy | **Pending Friday 24 Apr hackathon.** Default preference: API-direct; fall back to scrape (or hybrid for URL-generation benefit). | External decision. Both paths converge on the same Cloud Storage landing zone + Vertex ingestion, so the uncertainty is isolated to the ingestion utility itself. |
| C.2 | Search backend | **Vertex AI Search** via Discovery Engine SDK, wrapped in custom function tools (not built-in `VertexAiSearchTool`). | Top-level settled. Custom wrap avoids known ADK bugs. |
| C.3 | Image retrieval path | **Via Swoop's media library** — specific access path TBC Friday. | External decision. Interface stays stable regardless of where images live. |
| C.4 | Connector transport | **MCP over HTTP**, `@modelcontextprotocol/sdk` streamable HTTP. | PoC pattern, Swoop has seen it, standard. |
| C.5 | Tool set | **Evolve from PoC 7 tools.** Candidate Puma set: `search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit`. Finalise during Phase 1. | PoC tools proven. Puma tweaks: merge `get_library_data` + `show_component_list` into `search`; drop `get_conversation_guidance` (content moves into system prompt). Modular guidance uses ADK-native skill primitives (see C.11), not a custom tool. |
| C.6 | Ingestion cadence | **Manual / on-demand during Puma.** Schedule via Cloud Run Jobs + Cloud Scheduler post-M4. | No real-time freshness requirement for a discovery conversation. Cost-free to re-ingest. |
| C.7 | Deep-link URL generation | **If scrape path lands: URLs carried in tool responses. If API-only lands: pending Swoop confirmation of URL reconstruction from type+id.** | Dependent on C.1. Tracked in `questions.md`. |
| C.8 | Mongo access | **Not in scope.** | Confirmed no longer used. |
| C.9 | Embedding / reranking | **Vertex defaults initially.** Tune only if Phase 1 relevance is bad. | YAGNI. |
| C.10 | Image annotation pipeline | **In scope.** Runs in parallel from day one. Starter sample pre-M1; full catalogue before production. Annotations attached to image records in the derived datasource. | Retrieval quality depends on annotation coverage. Parallelisable — doesn't block the vertical slice. |
| C.11 | Modular-guidance loader mechanism | **ADK-native skill primitive** (verify current API in Tier 3). Fall back to a custom tool only if ADK's mechanism is a poor fit for Puma's needs. | ADK supports agent skills natively as of late 2025. Using the native primitive keeps the Puma tool set tight and avoids reinventing. |
| C.12 | Derived-datasource terminology | **Use the term "derived datasource" throughout the connector, ingestion utility, and docs.** | Makes the authoritative-vs-derived layering explicit. Prevents future code from treating the derived store as a write target. |

---

## 6. Shared contracts consumed and produced

Consumed (from `ts-common`):
- Tool I/O schemas (the connector implements, validates inputs, serialises outputs).
- Content schemas (Trip, Tour, Region, Story, Image — authored during chunk A's §2.2).
- Handoff payload (the `handoff_submit` tool produces an instance).

Produced (into `ts-common` or the connector's own boundary):
- The connector's MCP endpoint contract — URL, auth, tool discovery shape. Consumed by chunk B's tool-connector adapter.
- The ingestion utility's input schema for each source (scraped HTML pattern or API response shape). Internal; doesn't leak to other chunks.

---

## 7. Open sub-questions for Tier 3

- Vertex index structure: one unified index vs per-type indexes vs hybrid (§2.3).
- Exact ingestion utility shape post-Friday: pure API consumer, pure scraper, or hybrid.
- URL reconstruction from type+id if API-direct wins (`questions.md`, tracked with Thomas).
- Meta-tag-embedded IDs on product pages — Thomas's idea, still open (`questions.md`).
- SMTP provider specifics (transactional email provider vs Swoop-owned SMTP) — Julie to confirm (`questions.md`).
- Image metadata schema — alt text, tags, licence.
- Ingestion re-run strategy: full re-ingest vs diff-based incremental.
- Connector auth between orchestrator and connector — none in Puma (both in the same VPC or Cloud Run with IAM), or token-based.
- Error handling: tool failures propagate to the agent — exact shape of the error response.
- Rate limiting on the scraper against Swoop's own site.

---

## 8. Dependencies + coordination

- **Inbound**:
  - Friday 24 Apr hackathon outcome (data access strategy + media library access + URL reconstruction question).
  - Chunk A's `ts-common` stubs (tool I/O, content schemas).
  - Swoop GCP "AI Pat Chat" IAM — Vertex datastore provisioning, Cloud Storage bucket, connector deploy.
  - Swoop's extended Claude account (Enterprise tier confirmation from Julie) for scraper's Claude-based extraction.
  - Swoop's sales inbox + SMTP credentials for `handoff_submit`.
- **Outbound**:
  - Chunk B calls connector tools via MCP.
  - Chunk G places at least one skill into `product/cms/skills/` that the `load_skill` tool returns.
  - Chunk E reads from the handoff store (E owns durable persistence; C owns the tool surface that writes to it).
  - Chunk F reads tool-call events from connector logs.
- **Agent coordination**:
  - Tool name + schema set is a contract shared with B (via `ts-common`) — negotiate during Phase 0 if anything's unclear.
  - Deep-link URL carriage in tool responses is a contract shared with D — confirm during chunk D's Tier 2.

---

## 9. Verification

Chunk C is done when:

1. Data-connector service starts, registers tools over MCP, and responds to a discovery ping.
2. All Puma tools respond to a stubbed orchestrator call with schema-valid output from a fixture set.
3. Vertex AI Search datastore exists, populated with at least ~20 Patagonia records spanning trips / tours / regions / stories, and `search` returns plausibly-ranked results for 5 sample queries from the HITL flow-mapping session.
4. Ingestion utility runs idempotently against fixture inputs (no drift across runs).
5. `illustrate` returns working image URLs from the media library.
6. `handoff_submit` writes a record to the handoff store (chunk E) and sends a test email via real SMTP.
7. If scrape path: tool responses carry deep-link URLs; chunk D confirms it can render them as clickable "go see this page" affordances.
8. Swoop's internal team can run the ingestion utility from documented steps.
9. `load_skill` returns skill content from `product/cms/skills/` for a valid skill name; returns empty / not-found for unknown skills.

---

## 10. Order of execution (Tier 3 hand-off)

- **C.t0 — Friday hackathon synthesis**: post-hackathon, distil decisions into this doc + `questions.md` + Tier 3 briefs. Not really code — a planning checkpoint that unblocks C.t1–C.t3.
- **C.t1 — Connector service skeleton**: Cloud Run-ready Express + MCP SDK, tools registered as stubs, health endpoint, service account wiring.
- **C.t2 — Vertex AI Search provisioning + schemas + `VertexAiSearchTool` status check**: datastore(s) created, ingestion targets defined, Discovery Engine client configured. **Verify current ADK `VertexAiSearchTool` status** — if bugs from the archived research are fixed, use the built-in; otherwise wrap Discovery Engine SDK in custom tools.
- **C.t3 — Ingestion utility**: scrape OR API adapter (per C.t0), derived-datasource persistence, Vertex ingestion, idempotent re-run.
- **C.t4 — Tool implementations**: `search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit`. Each an evolution of the PoC equivalent where one exists. **Also: verify ADK native skill primitive for modular guidance** (per C.11) and wire or fall back.
- **C.t5 — Image retrieval adapter**: integrates with media library, returns URLs + annotation-enriched metadata.
- **C.t6 — Image annotation pipeline** (parallel workstream, starts early): Claude-vision extraction job, starter-sample run, annotation storage as metadata on image records in the derived datasource. Full-catalogue run before production traffic. **Can run in parallel to C.t1–C.t5 once media library access lands.**
- **C.t7 — Deep-link URL handling**: conditional on C.1 outcome. URLs carried in tool responses or derived from ids.
- **C.t8 — Ingestion + annotation runbooks for Swoop**: documented operating steps, handover notes.

C.t1 + C.t2 can parallelise within a single agent session (different files, no conflict). C.t3 depends on C.t2 being provisioned. C.t4 depends on C.t1. **C.t6 is the designated parallel workstream** — spin it up as soon as Friday hackathon clears media library access; doesn't block anything downstream. C.t5 + C.t7 can parallelise later. C.t8 is last.

Estimated: 3–4 days of focused work post-Friday-hackathon for C.t1–C.t5, C.t7. C.t6 adds ~1 day of setup + unattended annotation runtime (elapsed, not Al-time). Phase 1 vertical slice uses stubbed tools first, then C takes over.
