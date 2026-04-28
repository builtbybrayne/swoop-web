# 02 — Implementation: C. Retrieval & Data

**Status**: Tier 2 implementation plan. Rewrite, 2026-04-28 (replaces the 2026-04-22 draft archived at [planning/archive/02-impl-retrieval-and-data-pre-postgres-rewrite.md](archive/02-impl-retrieval-and-data-pre-postgres-rewrite.md)).
**Implements**: Puma top-level plan §4C + theme 5 (disposable ETL).
**Depends on**: A (foundations — `ts-common` tool I/O schemas, workspace scaffolded). 2026-04-27 SQL dump received and available locally. C.18 (Postgres + pgvector + tsvector + pg_trgm) and G.11 (CMS folder structure) landed.
**Coordinates with**: B (agent runtime calls tools via MCP), G (placeholder content at M1 → real content at M2; tool-description copy lives in `cms/prompts/tools/<tool>/`), F (tool calls emit events), D (widgets hydrate from tool outputs), E (handoff submission writes durable record + sends email).

---

## Why this plan exists in its current form

The original 2026-04-22 draft was structured around an unresolved scrape-vs-API question, Vertex AI Search as the retrieval backend, and a tool surface evolved tactically from the PoC's seven tools. Three things shifted:

1. **2026-04-27 SQL dump arrived from Swoop** as the canonical source. Scrape-vs-API is dead; the dump is upstream-of-truth. Planned weekly cadence; eventual steady state TBC with Swoop ops.
2. **Postgres won** the storage decision (C.18). pgvector + tsvector + pg_trgm in a single engine cover semantic + lexical + fuzzy retrieval at our scale; Vertex was overkill and would have introduced a two-store sync surface for marginal gain.
3. **Sales-shaped tool surface** — the agent is a sales agent moving visitors Awareness → Interest → Strong Consideration, not a librarian doing CRUD against a catalogue. Its tools should match conversation stages (`stoke_imagination`, `build_confidence`, `recall_someone_who`), not database shapes (`find_trips`, `search_blog`). Underneath, an internal Haiku-powered composer layer translates sales-shaped intent into data calls against Postgres.

That triple-shift reshapes most of this chunk's design. The architectural principles, the disposable-ETL theme, the derived-datasource terminology, the image annotation pipeline, the deep-link URL goal, the clean handoff to Swoop's internal team, and the per-tool file pattern all carry forward unchanged. Specific destinations (Vertex → Postgres) and surface shapes (data-shaped tools → sales-shaped tools) replace those of the prior draft.

---

## Purpose

C owns everything the agent retrieves. A data-connector service runs on Cloud Run, exposing a small set of **sales-shaped MCP tools** to the orchestrator. Behind each external tool sits a **composer**: a Haiku-powered sub-agent that decomposes the sales-shaped request into data calls, runs them against Postgres data primitives, and synthesises a coherent sales-shaped response. The Postgres derived store is populated by an ETL that ingests Swoop's SQL dump (and the WordPress blog REST API as a parallel stream), transforms it into purpose-built read-shaped views, and pre-computes embeddings + lexical indexes for hybrid retrieval.

Mongo is explicitly not in scope. Weaviate is out. Vertex AI Search is out (per C.18). The ETL is throwaway by design — when Swoop's data consolidation lands later in 2026, the export queries get rewritten; the derived-store shape and tool surface stay stable.

---

## 1. Outcomes

When this chunk is done:

- A data-connector service runs on Cloud Run, speaking MCP over HTTP, exposing a finalised sales-shaped tool set (see §2.2).
- Inside the connector, a composer layer (Haiku 4.5 sub-agents, one per external tool) translates sales-shaped requests into data primitives.
- A Postgres 16 derived store (Cloud SQL in prod, Postgres-in-Docker locally for parity) holds Patagonia content shaped for retrieval — Trip / Tour / Hotel / Vessel / Location / Activity / FAQ / BlogPost, plus sales-shaped derived entities (TripCard / VibePassage / CustomerStory / TrustProof) — indexed with `pgvector` HNSW, `tsvector` GIN, and `pg_trgm` GIN as appropriate.
- An ETL pipeline ingests the SQL dump (loaded into local MariaDB during dev) and produces the derived store via declarative SQL transformations + an embedding pass. Re-runnable, idempotent, diffable across runs.
- A separate WordPress REST API ingest stream (see [planning/03-exec-blog-ingest.md](03-exec-blog-ingest.md)) lands ~108 posts in the rolling 5y window into the same derived store as VibePassage and CustomerStory contributions.
- Images resolve via Swoop's imgix CDN; tool responses carry constructed image URLs (filename + imgix render parameters) the chat surface (D) can render directly.
- Tool responses carry public page URLs derived deterministically as `override_url || alias`, enabling the "go see this page" deep-link affordance.
- Handoff email delivery (the `handoff_submit` tool's outbound path) lands in the connector as a backend function — reusing the PoC mailer pattern with SMTP credentials in Secret Manager.
- Swoop's internal team can run the ETL at cadence — no hidden dependency on Al's machine.
- **Image annotation pipeline runs** — starter sample annotated pre-launch; full-catalogue annotation completes before production traffic. Annotations stored as columns on the `image` derived table, queryable inline with image retrieval.

**Not outcomes**:
- Mongo reads (explicitly not in scope — confirmed no longer used).
- Weaviate (out).
- Vertex AI Search (out, C.18).
- Full site coverage — scope sufficient for a convincing live conversation, not the entire Swoop catalogue.
- Real-time pricing lookups (only headline `base_price` is surfaced; specific quotes are sales's job — see C.14 territory and inbox.md 2026-04-27 entry on pricing stance).
- Departure-level data (out by product decision; Patagonia is largely demand-driven and the source data is too volatile).
- Customer attribution (`swooper_*` fields are customer PII; out of scope).
- Complex live integration with Swoop's website (we read from a periodic dump, not a live API).

---

## 2. Target functionalities

### 2.1 Data ingestion: SQL dump → MariaDB → Postgres

The 2026-04-27 SQL dump (Sequel Ace `.sql`, ~210 MB, MariaDB 5.5.64) is the canonical source. Cadence assumed weekly during M1–M5; steady state TBC with Swoop ops (could become an API, CDC, or scheduled feed; see `questions.md` Q13).

**Pipeline shape:**

1. **Land the dump** — drop the `.sql` file at `data/<dump-name>.sql`. `data/` is gitignored.
2. **Load into local MariaDB** (dev only) — `mariadb swoop_patagonia < data/...sql`. Local MariaDB is dev-side only; not deployed.
3. **Transform via `export.sql`** — declarative SQL that whitelists the tables we use, drops the cruft (audit columns, soft-delete fields, internal-ops tables, the entire `partner*` PII subgraph), flattens denormalised joins where the agent always reads them together (trip + canonical day-by-day; hotel + page-as-hub for images), computes derived columns (`from_price` from `base_price` + currency normalisation, voice/style descriptors from `ntag` joins, story-richness flags), and writes results into the Postgres derived store via `INSERT … ON CONFLICT DO UPDATE`. **This is C.t3.**
4. **Embed prose fields + populate sales-shaped derived entities** — separate Node CLI pass (C.t3a). Reads the freshly-populated Postgres tables + the blog NDJSON snapshot, chunks per entity strategy, embeds via Voyage-3 (or whichever embedding model is locked), populates `embedding` columns + `content_hash` for idempotency, and assembles `vibe_passage` / `customer_story` / `trust_proof` derived entities. Re-runs only embed rows whose `content_hash` has changed.
5. **Indexes refresh** — `REINDEX` only if schema changes; otherwise the standard incremental index updates suffice.

The pipeline runs as a Cloud Run Job on demand, or scheduled (post-M4). Handed off to Swoop's internal team for operation — architectural priority from 21 Apr.

**Disposable**: when Swoop's source schema changes (October 2026 data consolidation, or any other shift), the `export.sql` queries get rewritten; nothing downstream needs to change because the derived store's interface is stable.

### 2.2 Tool surface (the agent's view)

The agent's tool surface **weaves the existing PoC-derived tools with new sales-shaped composer tools**. The five existing tools (`search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit`) carry forward intact — they're either already sales-shaped (`illustrate`, `handoff*`) or serve real edge-case visitor needs (`search`, `get_detail`) that direct-query is the right answer for. Five new sales-shaped tools join them, each named after a stage in the buying conversation.

Ten tools total; well inside Claude's working-memory budget.

| Tool | Mode | Conversation moment | What it returns |
|---|---|---|---|
| **`stoke_imagination(theme \| region \| mood)`** | Composer (Haiku) | Visitor is curious, exploring | Evocative content: blog excerpts, day-by-day prose, customer stories, photography. Internally composes from VibePassages + CMS narrative + image set. |
| **`offer_options(intent_signals)`** | Composer (Haiku) | Visitor is starting to narrow | 2–4 trips presented as imagination-fuel + headline `from` price, with sales-prose framing. (Distinct from `search` because it adds narrative + scope-bounding.) |
| **`recall_someone_who(visitor_signal)`** | Composer (Haiku) | Specific concern, hope, life-stage signal | A similar past customer's story from CustomerStory entities (blog + curated reviews). The single most powerful thing the blog corpus buys us. |
| **`build_confidence(topic \| concern)`** | Composer (Haiku) | Hesitation, "is this for me / safe / worth it" | Proof-shaped material: customer reviews, press, B-Corp, expert credentials. From TrustProof entities matching the topic. |
| **`compare_paths([options])`** | Composer (Haiku) | Choosing between 2–3 candidates | Sales-language differences ("more ruggedness vs more comfort, same wow factor"), not a feature matrix. |
| **`illustrate(scope)`** | Pass-through | Visual companion at any moment | Image set with imgix render variants + alt text + captions. |
| **`search(filters)`** | Pass-through | Direct query — visitor wants a specific list / lookup / comparison that doesn't need narrative framing | Hits-list. The existing search-results widget (D.t3) continues to render this. |
| **`get_detail(id)`** | Pass-through | Visitor asks about a specific named trip / ship / region | Joined detail view. The existing detail widget (D.t3) continues to render this. |
| **`handoff(reason, summary)`** | Pass-through | The close | Opens the lead-capture widget with sales-flavoured framing. |
| **`handoff_submit(payload)`** | Pass-through | Submission | Captures contact details, writes durable record (chunk E), sends email. |

**Why both modes coexist:**
- The agent's *first reach* for any imagination-stoking, narrative, or sales-stage moment is one of the five composer tools.
- `search` and `get_detail` are escape hatches for direct visitor questions ("show me trips longer than 14 days", "tell me about the Aysen extension"). Sales-prose framing on a flat lookup feels wrong; pass-through tools answer cleanly.
- The sales-funnel "golden thread" discipline lives in tool-description prose + the system prompt — not in the tool list. Tool descriptions for `search` and `get_detail` explicitly nudge: *"prefer the sales-shaped tools when the visitor is exploring or considering; use these only when the question is a direct lookup or precise enumeration"*.

**Tool descriptions** (the prose Claude reads to decide which tool to pick when) live in `cms/prompts/tools/<tool-name>/description.md` per G.11. Tool I/O schemas live in `ts-common` — extended (not replaced) from the existing 5-tool foundation.

**Notes on what's _not_ here:**
- **No `find_trips` / `get_trip` / `search_blog`** as separate tools — those are internal data primitives (§2.4), accessed via composers or via the pass-through `search` / `get_detail` external surfaces.
- **No `get_guidance` tool** — agent guidance lives in system prompts (`cms/prompts/system/`) and in ADK skills (`cms/prompts/skills/`) per G.11. The orchestrator doesn't query for guidance at runtime; it has it in context.
- **No `load_skill` custom tool** — replaced by the ADK-native skill primitive (decision C.11 carries forward; pairs with B.t9 wiring and G.t3 content).

### 2.3 Composer layer (Haiku sub-agents inside the connector)

Five of the ten tools (`stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`) are fronted by a **composer** — a Haiku 4.5 sub-agent inside the connector that:

1. Receives the sales-shaped request (e.g. `stoke_imagination("big skies, silence in Patagonia")`).
2. Decomposes it into 1–N calls against the data primitives (§2.4).
3. Runs those calls (in parallel where possible).
4. Synthesises a coherent sales-shaped response payload — schema-validated against the tool's output Zod schema before returning to the orchestrator.

The other five tools (`search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit`) are **pass-through** — no Haiku in the loop. They serialise data primitives' output directly into their respective Zod output schemas. Same connector module structure, just no LLM call inside.

**Why a composer layer (for the five that have one):**

- **Cleanliness for the orchestrator.** Sonnet sees an intentful tool surface — no plumbing leaks. The orchestrator's prompt is shorter and its reasoning sharper because it doesn't have to compose retrieval steps itself.
- **Isolation across orchestrator changes.** Down the line the user-facing orchestrator might be a different LLM, a different vendor, or carry additional non-retrieval workload alongside this. Keeping retrieval composition inside the connector means changes there don't leak into orchestrator tooling.
- **Cost shape.** Haiku is fast, cheap, and good at structured synthesis. Pushing composition down into Haiku rather than running it in Sonnet keeps the per-conversation cost approximately flat while sharpening the division of labour.
- **Testability.** Each composer is independently testable against fixture data primitives. The orchestrator's tool-call test surface stays small.

**Per-tool file pattern:** `src/tools/<tool-name>.ts` (handler) + `src/composers/<tool-name>.ts` for the composer-mode tools (or absent for pass-throughs). Each tool module exports a function with the tool's Zod input schema → output schema signature. Tests live alongside.

### 2.4 Data primitives (the bottom layer)

A small set of pure SQL / vector helpers, no LLM, deterministic. These are what composers compose AND what pass-through tools serialise from. Examples:

- `query_trips_by_filter({region, duration_range, activity, accommodation_style, adventurousness, price_band})` → matching TripCard rows. **Backs `search` (pass-through external) and `offer_options` (composer, with prose framing on top).**
- `fetch_trip_detail(id)` → joined Trip + canonical day-by-day + tags + linked images via page-as-hub. **Backs `get_detail` (pass-through external) and is also called by `compare_paths` (composer, for each id) and `stoke_imagination` (composer, when a region or theme implies a representative trip).**
- `hybrid_search_blog(query, {limit, since?})` → top-N blog chunks via RRF over pgvector + tsvector. Backs `stoke_imagination`, `recall_someone_who`.
- `hybrid_search_cms(query, {scope, limit})` → CMS contentblock or VibePassage hits. Backs `stoke_imagination`, `build_confidence`.
- `resolve_image_set(record)` → image URLs (imgix-prefixed, parameterised render variants) for the record, via page-as-hub if `page_id` is present. Backs `illustrate` (pass-through) and is composed into others where images belong.
- `fetch_customer_stories({region?, signal?, limit})` → CustomerStory hits. Backs `recall_someone_who`.
- `fetch_trust_proofs({topic, limit})` → TrustProof hits. Backs `build_confidence`.
- `fetch_pricing_band({scope})` → headline-price aggregates from `trip.base_price`. Used inside `offer_options` for "from £X" framing. Not its own external tool.
- `find_locations(query)` → fuzzy match via `pg_trgm` + FTS over locations/areas/countries. Backs `search` when the visitor's filter includes a region name.

Per-primitive file pattern: `src/data/<primitive>.ts`. Each primitive is a typed function over the Postgres pool, returning Zod-parsed rows. Pass-through tools are thin handlers that call one or two primitives and return their output directly; composer tools call multiple primitives and synthesise via Haiku.

### 2.5 Postgres derived store: schema and indexes

The derived store has two layers of entities:

**Domain entities (mostly 1:1 with Swoop's source, post-cleanup):**
- `trip` — flattened, only published, with derived `from_price` + style/voice descriptors. Drops audit/soft-delete/PII columns.
- `tour`, `tour_item` — junction confirmed via `tours`/`tour_items`.
- `hotel`, `hotel_pricing`, `hotel_room` — accommodation catalogue (the public feed missed this; full pricing matrix exists in the dump).
- `vessel`, `cabin`, `cabintype` — for cruise context only (Patagonia is light on vessels; Antarctica sequel will use these heavily).
- `location`, `area`, `country` — geographic hierarchy (764 locations in the dump, far richer than the 14-string public surface).
- `activity` — first-class records, not just tags (despite the public feed making them look like tags).
- `faqitem` — 928 rows, real FAQ content.
- `image` — 13K rows, with imgix-style filenames + computed render variant URLs as helper columns; annotation columns populated by §2.7.
- `page` — CMS pages, the presentation hub for cross-entity widget rendering (page-as-hub pattern).
- `contentblock` — 10K rows of CMS prose; subtypes filtered to the useful ones (`contentblock_customerreview`, `contentblock_customertip`, plus the few others worth ingesting).
- `ntag` — Swoop's live tagging system (see C.17 territory; supersedes `tag` which is dead per Julie call).
- `blog_post`, `blog_chunk` — populated by [03-exec-blog-ingest.md](03-exec-blog-ingest.md).

**Sales-shaped derived entities (read-side views, sometimes materialised):**
- `trip_card` — denormalised hero presentation of a trip: image, headline, vibe, headline price, region, duration. Quick-render shape for `offer_options`.
- `vibe_passage` — chunked-and-tagged prose across blog + region CMS, indexed by mood/region/season + embedding. Feeds `stoke_imagination`.
- `customer_story` — extracted from `contentblock_customerreview` + `contentblock_customertip` + relevant blog posts about real trips, normalised to a single shape (who, when, where, what they did, evocative excerpt). Feeds `recall_someone_who`.
- `trust_proof` — extracted from `contentblock_pressreview` (currently unused but reserved), B-Corp content, Trustpilot aggregates, expert credentials. Feeds `build_confidence`.

**Indexes:**
- `pgvector` HNSW on every `embedding` column (cosine distance default).
- `tsvector` GIN on every searchable prose column.
- `pg_trgm` GIN on every entity-name column we want fuzzy-matched (locations, vessel names, hotel names).
- B-tree indexes on the obvious query keys (`trip.region_id`, `daybyday.trip_id`, etc.).

**Schema migrations**: `node-pg-migrate` per C.18. Plain-SQL migrations under `product/ingest/migrations/`. No ORM.

**Local-dev parity**: Postgres 16 in Docker Compose for the handoff artefact. Al's direct Homebrew install works fine for individual dev velocity in the meantime; we add the `docker-compose.yml` before M5 ship so Swoop's team have a reproducible mirror.

### 2.6 Image rendering and URL construction

No separate "media library" surface. Images live in the `image` derived table (13K rows, filenames only). URLs are constructed deterministically:

```
https://swoop-patagonia.imgix.net/<filename>?<imgix-render-params>
```

Imgix render params control sizing and format (`auto=format,enhance,compress&fit=crop&w=500&h=400&q=80` etc.). We carry **render variants** as a parameterised concept on the image record / tool surface — small thumbs for inline mentions, larger crops for widget hero images, originals for detail views. The data primitive `resolve_image_set` returns each image's URL pre-rendered for the variant the caller requests.

For records that don't carry images directly (e.g. `hotel`), the **page-as-hub pattern** applies: the record's `page_id` traverses to its `page` row, and the page's image set is the record's image set. Same rule for trip detail surfaces, location surfaces, and any other entity with a `page_id`.

### 2.7 Image annotation pipeline (parallel workstream — preserved)

**Runs in parallel from day one** — does not block the main vertical slice. Can start as soon as the dump is loaded (already done in dev) and the imgix URL pattern is verified.

**What it does**: for each image in the `image` derived table, produce structured annotations — subject (trek / wildlife / glacier / lodge / people), mood (serene / dramatic / social / action), region (Torres del Paine / El Chaltén / …), activity tags (hiking / photography / lodge-stay / …), and a short natural-language description suitable as alt text and for retrieval query matching. Produced via a Claude-vision extraction step per image.

**Storage**: annotations live as **columns on the `image` derived table** in Postgres — embedded inline so retrieval queries can filter and rank without a join. Cleaner than the PoC's `image-annotations.json` pattern; same idea, scaled.

**Scope**:
- **Pre-M1**: starter sample annotated (~50 representative images) to power the vertical slice's `illustrate` responses.
- **Pre-production**: full-catalogue annotation completes before Puma sees real traffic. Image retrieval quality is strongly dependent on annotation coverage; shipping with a partial catalogue would mean gap-filled `illustrate` responses.
- **Cost / scale check**: ~13K images at Claude Vision rates is a ballpark £100–£300 one-time. Worth flagging to Swoop. Alternative: piggyback on existing `image.alt_text` if the dump populates it (need to inspect — open question).

**Disposable**: annotations are derived from images + the annotation prompt + the vision model. Regenerable on demand. Updates to the annotation prompt trigger a re-annotation run.

The annotation job runs as a standalone Cloud Run Job, re-runnable at whatever cadence Swoop's team prefers. Image ids and URLs from the `image` table are sufficient input — independent of tool building.

### 2.8 Deep-link URL generation (preserved + simplified)

Tool responses carry public page URLs for chat → page navigation. Rule (now known):

- **Page URL = `override_url` if present, else `alias`.** Same for trip records and page records.
- The ETL exposes a generated `canonical_url` column on every entity that supports deep-linking (Trip, Hotel, Location, BlogPost), so callers never need to apply the rule themselves.

The chat surface (D) picks up the URLs from tool responses and renders them as "go see this page" affordances. The cross-page persistence question (whether the chat survives navigation) is chunk D's call.

### 2.9 Blog content stream

Separate from the SQL-dump ETL. Detailed in [planning/03-exec-blog-ingest.md](03-exec-blog-ingest.md):

- WordPress REST API at `https://swoop-patagonia.com/blog/wp-json/wp/v2/posts`.
- 5-year rolling window applied at fetch time (per-Al directive 2026-04-27): `?after=<5y-ago>`. Older content is genuinely stale and not retrieved.
- ~108 posts in the current window, ~2–5 MB raw NDJSON.
- Snapshots stored at `data/blog/raw/<utc-stamp>/posts.ndjson`. Manifest carries resume floor.
- Post-fetch processing (HTML cleaning, chunking, embedding) feeds `vibe_passage` and `customer_story` derived entities in the Postgres store.

Independent of the trip ETL — can run in parallel any time, on its own cadence. Refresh weekly post-launch.

### 2.10 MCP transport (preserved)

Cloud Run service, Express + `@modelcontextprotocol/sdk` HTTP transport (evolution of PoC `mcp-ts/`). The transport itself is unchanged from the original Tier 2 plan. The connector exposes the eight sales-shaped tools (§2.2) through standard MCP discovery; the orchestrator's existing tool-connector adapter (B.t3) consumes them.

IAM: connector needs scoped service accounts for Cloud SQL (read/write to the derived store), Secret Manager (SMTP credentials, embedding API key), and SMTP for outbound email.

### 2.11 Handoff email delivery (preserved)

`handoff_submit` writes a durable record to the handoff store (chunk E owns durability) and sends an email via SMTP. PoC mailer pattern carries forward from `chatgpt_poc/product/mcp-ts/src/lib/mailer.ts` — nodemailer + Gmail SMTP for dev, Swoop's real SMTP target via Secret Manager for prod.

---

## 3. Architectural principles applied here

**Carried forward from the original draft:**

- **PoC-first**: the connector service evolves `chatgpt_poc/product/mcp-ts/` directly. Tool-file pattern, Express + MCP SDK setup, mailer pattern all carry forward.
- **Content-as-data**: ETL outputs structured data into Postgres; Postgres indexes that data. No content inlined in connector code. Tool-description prose lives in `cms/prompts/tools/<tool-name>/` per G.11.
- **Disposable ETL** (theme 5): the export queries are throwaway. Rewrite them when the source schema changes. The derived-store interface stays stable.
- **Derived-datasource terminology**: load-bearing label. The Postgres store + image annotations are **derived data** from the SQL dump (and blog REST API) which are themselves upstream-canonical. Bypassing the ETL to write into the derived store is wrong; the correct move is to fix the upstream source and re-ingest. (Original C.12 carries forward; even more apt now.)
- **Hand-off clarity**: the connector + Postgres is the operational surface Swoop's team will eventually own. Clean boundary, clear ops handbook (§10 C.t8).
- **Swap-out surfaces named** (updated for new architecture): ETL source (low — `export.sql` is one file; rewrite when source changes); embedding model (low — one column to re-populate); composer LLM (low — Haiku is one config knob); storage engine (medium — see C.18 swap cost).

**Added for the new architecture:**

- **Sales-shaped at the top, data-shaped underneath**. External tools match conversation moments. Composer layer translates. Data primitives are pure SQL. Three-layer separation makes each layer independently testable and swappable.
- **Single derived store, hybrid retrieval**. No two-store synchronisation. `pgvector` + `tsvector` + `pg_trgm` in one engine, RRF in SQL.
- **Page-as-hub for cross-entity widget rendering**. Records with `page_id` traverse to `page` for both URLs and image sets. Uniform rule across hotel, location, trip, etc.

---

## 4. PoC carry-forward pointers

**Still useful — direct evolution:**

- `chatgpt_poc/product/mcp-ts/` — connector service base. `src/index.ts` (entry), `src/server.ts` (transport), `src/tools/` (one file per tool), `src/lib/` (helpers).
- `chatgpt_poc/product/mcp-ts/src/lib/mailer.ts` — nodemailer + SMTP pattern. Carry forward; swap target to Swoop's real endpoint via Secret Manager.
- `chatgpt_poc/product/ts-common/src/tools.ts` — tool-description and Zod schema pattern. The pattern carries; the actual tools are different (sales-shaped, not the PoC's seven).
- `chatgpt_poc/raw_data/swoop.components.json`, `swoop.templates.json` — real PoC sample data shapes. Useful reference for fixture authoring during dev.

**Pattern reference only — backends totally different:**

- `chatgpt_poc/product/mcp-ts/src/lib/component-search.ts`, `image-search.ts`, `data-loader.ts` — local-embedding patterns. Reference for interface shape; the actual implementation is now Postgres pgvector + tsvector hybrid retrieval.

**Superseded by SQL-dump ETL:**

- `chatgpt_poc/product/scripts/build-library.ts`, `build-image-catalogue.ts` — PoC ingestion scripts (MongoDB-dump transformers). Goal carries (idempotent, re-runnable ingest); shape is replaced by `export.sql` MariaDB → Postgres + an embedding pass.

---

## 5. Decisions closed in this chunk

The following decisions are pinned at chunk-C scope. C.18 has landed in [decisions.md](decisions.md). Several pending entries (marked ⏳) need to land in `decisions.md` alongside the existing C.11 / C.12.

| # | Decision | Status | Rationale |
|---|---|---|---|
| C.1 | ~~Data access strategy: scrape vs API~~ | **SUPERSEDED** by C.21 | The 2026-04-27 SQL dump replaces both candidate paths. |
| C.2 | ~~Search backend: Vertex AI Search~~ | **SUPERSEDED** by C.18 | Postgres + pgvector + tsvector + pg_trgm covers the same retrieval needs at our scale, single-store. |
| C.3 | Image retrieval path | **REVISED**: imgix CDN with deterministic URL construction from filename (no separate "media library" service). | Resolved by Julie call 2026-04-27; image table holds filenames, URLs constructed with imgix render params. |
| C.4 | Connector transport: MCP over HTTP | **STANDS**. `@modelcontextprotocol/sdk` streamable HTTP. PoC pattern, Swoop has seen it, standard. |
| C.5 | ~~Tool set evolved from PoC 7~~ | **SUPERSEDED** by C.19 | Sales-shaped tool surface replaces the data-shaped evolution. |
| C.6 | Ingestion cadence: manual / on-demand during M1–M3 | **STANDS**. Schedule via Cloud Run Jobs + Cloud Scheduler post-M4. Steady state TBC with Swoop ops. |
| C.7 | ~~Deep-link URL generation: pending scrape vs API~~ | **CLOSED**: rule is `override_url \|\| alias`, applied at ETL time. | Resolved 2026-04-27. |
| C.8 | Mongo access: not in scope | **STANDS**. |
| C.9 | Embedding / reranking | **REVISED**: Voyage-3 leaning (formal lock pending in `questions.md`). Reranking via RRF in SQL across pgvector + tsvector. |
| C.10 | Image annotation pipeline | **STANDS** with revisions: storage on `image` derived table columns rather than separate JSON file. Cost flag added (~£100–£300 one-time for 13K images). |
| C.11 | Modular-guidance loader | **STANDS**. ADK-native skill primitive (B.t9 wires; G.t3 authors content under `cms/prompts/skills/` per G.11). |
| C.12 | Derived-datasource terminology | **STANDS**. Even more apt with the Postgres + ETL setup. |
| C.13 ⏳ | Sales-funnel "golden thread" | New decision pending decisions.md entry. Captured in [inbox.md](../inbox.md) 2026-04-27. |
| C.14 ⏳ | No departures, no swoopers, headline pricing only | New decision pending. Captured in inbox.md. |
| C.15 ⏳ | URL + image construction rules | New decision pending. Captured in inbox.md. |
| C.16 ⏳ | Page-as-hub pattern for cross-entity rendering | New decision pending. |
| C.17 ⏳ | `ntag` is the live tagging system; `tag` + `adventurousness` deprecated | New decision pending. |
| C.18 | **Postgres 16 + pgvector + tsvector + pg_trgm; no Vertex** | **LANDED** (2026-04-28). |
| C.19 ⏳ | Sales-shaped tool surface (8 tools); composer pattern with Haiku sub-agents inside the connector | New decision pending. |
| C.20 ⏳ | Blog ingest as separate stream via WP REST API; 5y fetch-time-filtered window | New decision pending; plan landed at [03-exec-blog-ingest.md](03-exec-blog-ingest.md). |
| C.21 ⏳ | Source = SQL dump → local MariaDB → export.sql → Cloud SQL Postgres | New decision pending. |
| C.22 ⏳ | Composer pattern: per-tool Haiku sub-agent translates sales-shaped intent into data-primitive calls | New decision pending (sub-decision of C.19; worth its own line because the architectural commitment is non-trivial). |

---

## 6. Shared contracts consumed and produced

**Consumed (from `ts-common`):**

- Tool I/O schemas — the connector implements, validates inputs, serialises outputs. **Existing schemas (5 PoC tools) carry forward; new schemas added for the 5 sales-shaped composer tools.** Augment, not replace. C.t2 produces the new ones alongside the existing.
- Content schemas (Trip, Tour, Hotel, Vessel, Location, Activity, FAQ, BlogPost) — authored alongside the schema design (C.t2). Reflect dump reality + sales-funnel cuts (no departures, no swoopers, headline pricing).
- Sales-shaped derived entity schemas (TripCard, VibePassage, CustomerStory, TrustProof) — authored as part of C.t2.
- Handoff payload (the `handoff_submit` tool produces an instance) — from chunk E (E.t1 already shipped).

**Produced (into `ts-common` or the connector's own boundary):**

- The connector's MCP endpoint contract — URL, auth, tool discovery shape. Consumed by chunk B's tool-connector adapter. **B.t3 already shipped against the existing 5 tools; B.t3a augments by adding wrappers for the 5 new sales-shaped tools.** Existing wrappers stay.
- The ETL's input contract — MariaDB schema assumptions, column whitelists. Internal to the export script; doesn't leak.
- Image URL construction utility — single function `buildImgixUrl(filename, variant)` in `ts-common`, used by both the ETL and the data primitives.
- Page-as-hub resolver utility — single function `resolveImagesViaPage(record)` likewise.

---

## 7. Open sub-questions for Tier 3

Most data-pipeline questions closed by the dump inspection on 2026-04-27. Remaining:

- **Embedding model lock**: Voyage-3 vs alternative (Cohere, Anthropic, OpenAI). Probably Voyage-3; ten-minute decision when we wire the embed pass.
- **Annotation strategy**: full catalogue vs golden subset vs on-demand. Cost-driven decision; depends on whether `image.alt_text` is populated in the dump.
- **`tripvariant` semantics** (584 rows): what variants exist, do we surface variant differentiation? Inspection-driven; quick SELECT against the local MariaDB resolves it.
- **`season` semantics** (12 rows): date windows or named periods? Same — quick SELECT.
- **`daybyday` revision logic** (88K rows): how do we identify the canonical published version per trip? Same.
- **`contentblock_*` triage**: which subtypes do we ingest beyond `customerreview` (2,390) + `customertip` (119)? Inspection.
- **SMTP provider specifics** (transactional email provider vs Swoop-owned SMTP) — Julie still pending.
- **Connector auth between orchestrator and connector** — none in Puma (both in the same VPC or Cloud Run with IAM), or token-based. Revisit at deploy.
- **Per-composer prompt design** — each composer needs a system prompt. Authored as part of C.t4. Lives in `cms/prompts/tools/<tool-name>/composer.md` per G.11 conventions.
- **Rate limiting / retry policies** — embedding API calls and Haiku composer calls both want sane backoff. Standard, but worth being explicit at C.t1.

---

## 8. Dependencies + coordination

**Inbound:**
- 2026-04-27 SQL dump (received).
- WordPress blog REST API (verified open; ingest plan landed).
- Chunk A's `ts-common` stubs (tool I/O, content schemas — need updating for new surface).
- Swoop GCP "AI Pat Chat" IAM — Cloud SQL provisioning, Cloud Run deploy. Blocked on Thomas Forster.
- Swoop's extended Claude account (Enterprise tier confirmation from Julie) — primarily relevant for embedding-pass cost routing if Swoop wants it on their account.
- Swoop's sales inbox + SMTP credentials for `handoff_submit` — Julie still pending.

**Outbound:**
- Chunk B calls connector tools via MCP. Tool surface change requires B.t3 re-baseline.
- Chunk G places skill files under `cms/prompts/skills/<skill-name>/` per G.11; ADK-native loader (B.t9) consumes them.
- Chunk E reads from the handoff store (E owns durable persistence; C owns the tool surface that writes to it).
- Chunk F reads tool-call events from connector logs.

**Agent coordination:**
- Sales-shaped tool surface is a contract shared with B (via `ts-common`) — negotiate when authoring the schemas at C.t2.
- Image URL + page-as-hub conventions are contracts shared with D (widget rendering) — confirm during D Tier 3 re-pass.

---

## 9. Verification

Chunk C is done when:

1. Data-connector service starts, registers all eight sales-shaped tools over MCP, responds to a discovery ping.
2. All eight tools respond to a stubbed orchestrator call with schema-valid output from a fixture set.
3. Postgres derived store exists, populated by the ETL with at least the active Patagonia content (~hundreds of trips, ~thousands of CMS chunks, ~108 blog posts), and a sample query against each composer's data primitives returns plausibly-ranked results for 5 sample queries.
4. ETL runs idempotently (`export.sql` re-run produces no changes; embed pass re-run touches only changed-content rows).
5. `illustrate` returns working imgix URLs at multiple render variants; chat surface (D) confirms it can render them.
6. `handoff_submit` writes a record to the handoff store (chunk E) and sends a test email via real SMTP.
7. Tool responses carry deep-link URLs (`canonical_url`); chunk D confirms it renders them as clickable "go see this page" affordances.
8. Image annotation starter sample (~50 images) is queryable inline with image retrieval — `illustrate` responses carry annotation-derived alt text and tags.
9. Swoop's internal team can run the ETL from documented steps (the runbook).
10. ADK-native skill loader (B.t9) returns skill content from `cms/prompts/skills/<skill-name>/SKILL.md` for valid skill names; returns empty/not-found for unknown skills.
11. Composer-layer responses match their tool's output schema deterministically across 10 fixture-driven test runs (composer Haiku temperature is low / structured-output is enforced).
12. `docker-compose.yml` provisions Postgres 16 with `pgvector` + `pg_trgm` + FTS extensions; the ETL runs against it identically to local Homebrew Postgres.

---

## 10. Order of execution (Tier 3 hand-off)

- **C.t0 — SQL-dump load + clarifying SELECTs** (in flight 2026-04-28). Load dump into local MariaDB. Run SELECTs against `tripvariant`, `season`, `daybyday`, `currency`, `adventurousness` (deprecated, confirm), `contentblock_*` subtypes. Update `data-ontology.md` with `S-SQLDUMP-2026-04-27` source tag. Closes residual schema questions.
- **C.t1 — Connector service skeleton + Postgres setup**: Cloud Run-ready Express + MCP SDK; Postgres 16 + extensions provisioned (Cloud SQL for prod, Docker Compose for handoff parity); health endpoints; service-account wiring. **Greenfield** — `product/connector/src/` is empty today.
- **C.t2 — Entity model + tool surface schemas**: design Postgres schema (domain entities + sales-shaped derived entities) + `ts-common` tool I/O schemas for the 5 new sales-shaped tools. **The substantive new artefact** — both layers co-define each other. Lands as a single Tier 3 plan. **Augments shipped work**: A.t2's `product/ts-common/src/tools.ts` (TOOL_DESCRIPTIONS + Input/Output Zod schemas for the existing 5 tools) is **extended** — existing exports stay; new schemas added alongside for `stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`. Existing `Sample*` fixtures stay; new fixtures added for the new derived entities (TripCard, VibePassage, CustomerStory, TrustProof).
- **C.t3 — ETL: `export.sql` MariaDB → Postgres** (data-shape transformation): declarative SQL whitelists, flattens, denormalises, computes derived columns. Plus the Node CLI that orchestrates the run + idempotent re-run. **Pure data movement + structural transformation; no LLM in the loop.** **Greenfield** — no existing ETL code.
- **C.t3a — Embedding pass + blog post-processing** (semantic enrichment): two related sub-tasks running off C.t3's output and the blog snapshot:
  - **Per-entity chunking strategy** — decide chunk granularity per entity type (Trip prose: per day-by-day day; CMS contentblock: per block; blog post: per `<h2>`/`<h3>` section, sliding-window fallback).
  - **Embed prose fields** — Node CLI reads Postgres tables (post-C.t3) and the blog NDJSON snapshot, chunks per entity strategy, calls Voyage-3 (or whichever embedding model is locked) in batches, populates `embedding` columns + `content_hash` for idempotency. Re-running embeds only rows whose `content_hash` has changed since the last run.
  - **Populate sales-shaped derived entities** — `vibe_passage` / `customer_story` / `trust_proof` are populated by composing blog chunks + relevant CMS contentblocks via SQL after embedding. Lives in this task because the operations all share the embedding-cost concern.
  - **Greenfield**. Sized at ~1–2 days for the embedding plumbing; cost driven by content volume (back-of-envelope: ~10K CMS chunks + ~108 blog posts × ~5 chunks each = ~10.5K embedding calls; Voyage-3 at ~$0.02/M tokens is cents).
- **C.t4 — Tool implementations**: handlers + data primitives for all 10 tools. Composer prompts authored under `cms/prompts/tools/<tool-name>/composer.md` per G.11 for the 5 composer-mode tools; pass-through handlers for the other 5. Per-tool tests against fixture data primitives. **Augments shipped work**: `product/orchestrator/test-fixtures/stub-connector.ts` (fixture-only, retired in favour of the real connector). The existing 5 PoC-derived tool surfaces stay live and gain real backing implementations against Postgres data primitives. **Triggers downstream augments** in chunks B and D — see "Downstream re-baselines" below.
- **C.t5 — Image URL utility + page-as-hub resolver**: small `ts-common` utilities used by both the ETL and the data primitives. **Greenfield**.
- **C.t6 — Image annotation pipeline** (parallel workstream, starts early): Claude-vision extraction job, starter-sample run, annotation columns populated on `image` derived table. Full-catalogue run before production traffic. **Greenfield**.
- **C.t7 — URL surfaces (absorbed)**: the prior plan's "deep-link URL handling" task is now distributed across C.t3 (`canonical_url` derived from `override_url || alias` at ETL time) and C.t5 (image-URL utility). No standalone task — slot retained for numbering continuity with the [archived original](archive/02-impl-retrieval-and-data-pre-postgres-rewrite.md).
- **C.t8 — ETL + annotation runbooks for Swoop**: documented operating steps, handover notes, `docker-compose.yml`, IAM checklist. **Greenfield**.

**Parallel stream — Blog ingest** (no C.t number): per [03-exec-blog-ingest.md](03-exec-blog-ingest.md). Runs independently of the SQL-dump ETL. Can start at any time once C.t0 closes — doesn't block any C.t task. Output feeds C.t3's embedding pass and the `vibe_passage` / `customer_story` derived entities.

**Downstream augments triggered by C.t2 + C.t4** (live in their owning chunks, not in C):
- **B.t3a — Connector adapter augment**: extends `product/orchestrator/src/connector/tools.ts` with ADK FunctionTool wrappers for the 5 new sales-shaped tools. Existing wrappers (5 PoC tools) stay. Gated on C.t2 (new schemas) + C.t4 (real implementations). Listed in [02-impl-agent-runtime.md](02-impl-agent-runtime.md) §"Order of execution".
- **D.t9 — Widget augment**: adds new widgets in `product/ui/src/widgets/*` for the 5 new sales-shaped tool outputs (e.g. story vignette card for `recall_someone_who`, proof carousel for `build_confidence`, evocative-content panel for `stoke_imagination`, options card for `offer_options`, comparison view for `compare_paths`). The existing 4 widgets keep rendering the existing 5 tools' outputs. Gated on C.t2 (schemas) + C.t4 (real outputs). Listed in [02-impl-chat-surface.md](02-impl-chat-surface.md) §"Order of execution".

**Parallelisation:**
- C.t0 + C.t1 in series (need MariaDB loaded before Postgres setup is wired).
- C.t2 + C.t6 + Blog ingest can parallelise once C.t0 is done.
- C.t3 depends on C.t2 (schemas).
- C.t3a depends on C.t3 (data in Postgres) + Blog ingest (NDJSON snapshot exists).
- C.t4 depends on C.t2 (tool schemas) and C.t3 + C.t3a (data populated *and* embeddings present for hybrid retrieval).
- C.t5 can join C.t4 since both touch the same surface.
- C.t7 is a no-op (absorbed).
- C.t8 last.
- B.t3a + D.t9 fan out from C.t4 in parallel.

**Estimated**: ~5–7 days of focused work for C.t0–C.t5 + Blog ingest. C.t6 adds ~1 day of setup + unattended annotation runtime (elapsed, not Al-time). B.t3a and D.t9 each add 1–2 days of mostly mechanical replacement work. The vertical slice's existing stub connector continues to back the orchestrator until C.t1 lands; the swap to real data happens in C.t4 (paired with B.t3a).

---

## Appendix: what changed from the 2026-04-22 draft

For continuity with anyone reading the archived original — the high-level shifts:

- **Backend**: Vertex AI Search → Postgres 16 + pgvector + tsvector + pg_trgm (C.18).
- **Source**: scrape-vs-API hackathon → SQL dump as canonical (C.21).
- **Tool surface**: PoC's five (`search`/`get_detail`/`illustrate`/`handoff*`) **woven with** five new sales-shaped composer tools (§2.2; C.19). Existing surfaces retained, not replaced — the 5 PoC tools become pass-through handlers over real Postgres data primitives, while the 5 new tools (`stoke_imagination`/`offer_options`/`recall_someone_who`/`build_confidence`/`compare_paths`) are composer-driven.
- **Composer pattern**: new — Haiku sub-agents inside the connector translate sales-shaped intent into data-primitive calls (C.22).
- **Storage layer**: Cloud Storage landing zone → direct MariaDB-to-Postgres ETL.
- **CMS structure**: monolithic system prompt → `cms/prompts/{system,skills,tools}/` per G.11.
- **Image handling**: "media library access TBC" → deterministic imgix URL construction + page-as-hub pattern.
- **Pricing**: implied ranges → headline `from_price` only (per Julie call 2026-04-27).
- **Pruning**: no departures, no swoopers (customer PII), no `tag` system (`ntag` is live), no `adventurousness` (deprecated).

The foundations of the prior plan — disposable ETL, derived-datasource framing, Swoop hand-off clarity, image annotation as a parallel workstream, deep-link URLs as a UX affordance, the connector's MCP-over-HTTP transport, the SMTP-based handoff path — all carry forward unchanged.
