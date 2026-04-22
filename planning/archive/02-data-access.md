# 02 — Data Access

**Status**: Draft, v2 (rewrite — grounded in PoC + 21 Apr meeting).
**Purpose**: Data extraction strategy, target schemas, ingestion pipeline, Friday ontology-mapping session prep.
**Depends on**: `01-architecture.md` §6 (data layer), §7 (scraper utility).
**Posture**: This is a *prototype + augmentations* document. The Antarctica ChatGPT Apps SDK prototype (`chatgpt_poc/`) already solved a shape of this problem. We are generalising that shape to Patagonia, swapping the retrieval substrate, and plugging a real ETL onto the front of it.

---

## 1. Context recap (21 Apr, AI Tool Technical Requirements)

### 1.1 Data source reality

- **MongoDB has product info but no prices.** Product library is there (Big Bricks / Small Bricks — see §2.1), pricing is not.
- **MySQL backs the current website.** Prices + rich place descriptions + image URLs live here. The React frontend is hydrated by PHP passing data into components — Richard Connett: **90% of data is visible in the initial HTML**, dynamic-load risk is low.
- **October 2026**: website migrates onto Mongo. At that point this all converges. Everything we build for V1 extraction is disposable by design — site migration rewrites the ETL regardless.
- **"Wild-west" framing** (Al, 21 Apr): the only V1 paths are scrape-the-site or ad-hoc MySQL queries, and direct SQL *"misses a lot of business logic"* because the site applies meaningful transformations between DB and render.

### 1.2 The three content streams

From `00-overview.md` Addendum A.3 — each stream has a different source-of-truth posture and a different pipeline:

| # | Stream | Where it lives | PoC handling | Phase 2 change |
|---|---|---|---|---|
| 1 | **Product catalogue** (trips, ships, activities) | MongoDB (canonical), with pricing gaps filled by scraped website | PoC imported a MongoDB export (`swoop.components.json` + `swoop.templates.json`) → normalised into `cms/library-data.json` | Still Mongo-derived, but scraper overlay merges in prices + place descriptions that only exist on the site |
| 2 | **Website content** (place pages, prices, images) | MySQL, rendered via PHP→React | Not handled in the PoC — PoC used baked Antarctica data | **New**. V1 scraper utility is this stream. Meta-tag approach bridges scraped pages back to Mongo component IDs |
| 3 | **Blog** (hundreds of articles, 5 years) | MySQL/CMS on the site | Not handled in the PoC | **New**. Crawled as part of the same scraper run, indexed as a separate corpus (different retrieval profile) |

### 1.3 Strategy (settled 21 Apr)

- **Scrape the website with Claude deep-research + prompt engineering.** Zero work for Swoop in-house team; handles upcoming migration naturally (V1 gets rewritten post-October anyway).
- **Script handed off to Swoop** after Al builds and validates it. The group runs it at a regular cadence post-handover.
- **Meta-tag-embedded IDs** (Thomas's idea) bridge scraped pages to Mongo component IDs. This is how the scraped data rejoins the canonical product library.
- **Simpler parallel path**: Swoop *may* expose a JSON endpoint — a thin PHP projection of the data that already passes through PHP to React. Cheaper for us, cheaper for them to maintain, and it sidesteps extraction drift. To be settled Friday.
- **Claude cost mitigation**: Swoop's recently extended Claude access (Tom's team) is being wired up for use on the data-processing workload.

### 1.4 Data mapping session

- **Friday 24 April 2026**, full day, with Thomas Forster or Martin. Julie confirming.
- Reframed (Addendum A.2) as a **hackathon to define Swoop-maintained API endpoints**, not just a one-off scrape. Output = set of endpoints Swoop owns going forward.

---

## 2. Target schemas — generalised from the PoC

### 2.1 Swoop's own data framework (use this terminology)

From `chatgpt_poc/wiki docs/extracted/sd1-swoop-data-framework-…md` and the Big Bricks / Small Bricks docs — these are **Swoop's internal names**; we use them verbatim:

- **Component** — the stored record in MongoDB (an instance of a Template). Unit of retrieval.
- **Template** — the schema defining a component type. IDs like `template_bb8caab1d3104257a75b7cb7dd958136`.
- **Big Bricks (Compound)** — bookable trip products: Cruise, Guided Activity, All-Inclusive Hotel Trip, **Private Tour**, Addon. Type-classified as *Pre-bundled* vs *Tailormade*.
- **Small Bricks (Atomic)** — accommodation, experience/activity, transfer, flight. Compose into Big Bricks.
- **Level 0 domains**: Customer, Destination, **Product**, Partner, Swooper (HR), Booking, Finance.

### 2.2 PoC schemas as strawman

The PoC already codified Antarctica components as Zod schemas in `chatgpt_poc/product/ts-common/src/domain.ts`. Real shapes, real field names, ingested from real MongoDB exports. These are the **shape we are generalising from** — not newly invented.

**Present in PoC** (`ComponentType` enum):

- `ship` — `ShipSchema`
- `cruise` — `CruiseSchema`
- `cruise_activity` — `ActivitySchema`
- `private_tour` — `PrivateTourSchema` (declared but not the focus for Antarctica)

Actual PoC `ShipSchema` fields (load-bearing for Friday — this is what the Swoop data model looks like *today* for Antarctica):

```ts
ShipSchema = {
  id: string,
  name: string,
  type: string,                 // "Expedition" | "Comfort & Adventure" | "Luxury" | "Yacht"
  description: string,
  capacity?: number,
  yearBuilt?: number,
  shipFacilities?: ShipFacilities,         // igloos, scienceCentreLaboratory, observationLounge, mudroom, walkingTrackWraparoundDeck, openBridgePolicy
  accommodation?: ShipAccommodation,       // rooms[], yearBuilt, capacity, whatWeLike, swoopSays, thingsToNote, facilities{bar, elevator, jacuzzi, library, pool, spa, ...}
  deckPlanUrl?: string,
  images: string[],
  partnerId?: string,
  destination: string,
}
```

Note the **Swoop editorial fields** `whatWeLike`, `swoopSays`, `thingsToNote` — these are first-class and load-bearing for voice (see `01-architecture.md` WHY layer). They're not decoration; they're the brand signal that makes a Swoop answer sound like Swoop.

Template-ID → ComponentType mapping is real:

```ts
TEMPLATE_TYPE_MAP = {
  template_bb8caab1d3104257a75b7cb7dd958136: "ship",
  template_63a57a90570c47b89f830d2c7618324f: "cruise",
  template_12345678123456781234567812345678: "cruise_activity",
  template_d9081bfcc3b7461987a3728e57ca7363: "private_tour",
}
```

A `BigBrickComponent` discriminated union wraps each with `{ componentType, id, name, description, images, destination, data }` — this is the canonical record shape for anything indexed.

### 2.3 Patagonia augmentations (pending Friday)

> **Status: leaning / open.** Derived from Antarctica PoC — **pending Friday ontology session**. Do not treat as a contract.

Antarctica's product model is comparatively simple (ship + cruise + cruise_activity dominates). Patagonia is expected to introduce different Big Brick types. Candidates from `product-big-brickscompound.md` and the 20 Apr Luke kickoff:

| Candidate ComponentType | Evidence | Status |
|---|---|---|
| `guided_activity` | Big Bricks doc lists Guided Activity (Trekking, Day Excursions, Kayaking, Horseriding, Multi-activity) | leaning — ubiquitous in Patagonia |
| `all_inclusive_hotel_trip` | Big Bricks doc | leaning |
| `private_tour` | Already in PoC, likely heavier usage in Patagonia ("tailor-made" per Luke) | settled |
| `group_tour` | **New product** per Julie 20 Apr — not yet in Mongo. Strategic priority per Luke (aiming for 50% of bookings) | open — may be a `guided_activity` variant or its own type |
| `addon` | Big Bricks doc | open for V1 |
| `destination` / `region_page` | Website has rich place descriptions that aren't component-shaped | open — probably a separate content type, not a Big Brick |

**Independence dimension** (Luke's segmentation — 20 Apr): Group / Tailor-Made / Independent. This probably lives as a field on Big Brick components rather than as a distinct ComponentType, but it's one of the things Friday needs to settle.

**What Friday decides**:
1. Which Big Brick ComponentTypes exist for Patagonia in Mongo today
2. Whether Group Tour is a distinct type, a tag, or a Template variant
3. How destination/place content maps — Big Brick vs separate "page"-shaped content
4. Whether existing Antarctica fields (`shipFacilities`, `accommodation`, `swoopSays`, etc.) have Patagonia equivalents or new field sets

### 2.4 Blog / story schema

Not present in the PoC. New for Phase 2. Proposed minimal shape (to be refined with Thomas — Swoop may already have a content-type shape on the CMS side):

```ts
interface BlogArticle {
  id: string;             // from meta tag or URL slug
  url: string;
  publishedAt: string;
  title: string;
  author?: string;
  tags: string[];
  regions: string[];      // denormalised from tags for retrieval filtering
  summary: string;
  body: string;           // markdown-normalised
  relatedComponentIds: string[];  // inferred from links to product pages
  images: ImageRef[];
}
```

Retrieval profile differs from Big Bricks — semantic-similarity-dominant, not filter-dominant. Drives the separate-index choice in §4.

### 2.5 Images

PoC has a working image pipeline. Carry forward with minimal change:

- **`imgix` CDN** hosts everything (e.g. `https://imgix.swoop-antarctica.com/…`). Per-destination domain likely (`imgix.swoop-patagonia.com`). Image URLs currently live in MySQL; the scraper must extract them.
- **`image-catalogue.json`** — the PoC's retrieval-ready image records, shape from `ImageRecordSchema`:

  ```ts
  ImageRecord = {
    id, url, filename, description,
    tags: string[],
    destination: string,
    subjects: string[],
    mood: string,                // dramatic | joyful | serene | vast | intimate
    wildlife?, activities?, landmarks?,
    embedding?: number[],        // pre-computed text embedding
  }
  ```

- **`image-annotations.json`** — Gemini-generated auto-annotations per image (description, subjects, mood, wildlife, activities, landmarks). Runs once, persisted.
- **Component linkage** — PoC's `CmsImageRecord` extends `ImageRecord` with `componentRef`, `componentName`, `componentType` so retrieval can go image → component or component → images. This pattern carries forward.

V1 images: scraper captures URLs inline with component and article records. V2: separate image retrieval index (possibly a separate Vertex Search instance — open, per 00-overview.md domain 11).

---

## 3. Extraction / ETL pipeline

### 3.1 Scraper shape

- **Runtime**: Node.js / TypeScript. Single standalone package `product/scraper/`.
- **Approach**: **Claude deep research + prompt engineering**. Claude reads rendered HTML, returns structured JSON validated against Zod schemas in `ts-common/`. Deterministic CSS-selector extraction is brittle against React/PHP layout drift; LLM extraction is robust and cheap given Swoop's extended Claude access.
- **Invocation**: CLI for dev runs, Cloud Run Job for scheduled runs post-handover.
- **Output**: per-page JSON written to Cloud Storage under `raw-scrapes/{date}/{type}/{slug}.json`.
- **Disposability**: whole package is rebuild-friendly. October migration → rewrite the extractor, keep the schemas, keep the ingestion downstream.

### 3.2 Pipeline stages

```
1. URL discovery        sitemap parse + hand-curated seeds → URL queue
2. Page fetch           HTTP fetch first (90% HTML-visible per Richard Connett);
                        headless browser fallback if needed
3. Extraction           Claude structured-output + Zod validation against ts-common/ schemas
4. Normalisation        Type coercion, ID canonicalisation via meta tag, relation linking
5. Persistence          JSON → Cloud Storage (raw + normalised tiers)
6. Ingestion            Cloud Storage → Vertex AI Search (§4)
```

### 3.3 ID strategy — meta-tag bridge

The scrape problem isn't *getting* text, it's *linking* scraped content back to the canonical MongoDB component IDs. Two options discussed 21 Apr:

| Option | Cost to Swoop | Cost to us | Status |
|---|---|---|---|
| **`<meta name="swoop-id" content="component_…" />`** on each product/article page (Thomas's proposal) | Low — one-line template edit | Zero — direct ID lookup | **Leaning** — ask on Friday |
| **URL-slug as stable ID** for V1 | Zero | Low; cleanup on slug change | Fallback |

**Settled**: we want meta-tag. Fallback is URL-slug if meta-tag insertion hits friction.

### 3.4 Claude extraction prompt pattern

One prompt per content type (`big_brick`, `blog_article`, `destination_page`). Each contains:

- WHY context (what Swoop is, what we're extracting, voice guardrails)
- The relevant Zod schema, pasted inline for safety
- Extraction rules (missing-field handling, price ambiguity, date-range parsing)
- 2–3 worked examples per type
- Structured-JSON-only output mode

Prompts live in `product/scraper/prompts/extract-{type}.md`, versioned as CMS.

### 3.5 Change detection

Daily/weekly re-scrape. Per-page:

- **Unchanged** → skip re-ingestion
- **Content diff** → re-embed + update Vertex index
- **Structural diff** (new fields) → flag for manual review (schema may need bump in `ts-common/`)
- **Missing page** → mark archived in Vertex, don't delete

### 3.6 Simpler alternative: JSON endpoint from Swoop

Thomas's suggestion — expose a thin PHP projection of the data already passing through PHP to React. 90% of the work is done; a JSON view is a thin additional surface.

If this lands Friday:

```
Swoop JSON API → Ingestion (normalise + persist) → Vertex AI Search
```

Benefits: no HTML parsing, no LLM extraction cost, Swoop owns the schema and maintains it past October migration (no throwaway work).

**Architecture posture**: build the scraper as V1 path, but design the downstream ingestion to accept either scraped JSON or API JSON against the same Zod schemas. Swap-in when API lands.

---

## 4. Retrieval substrate — swap, not rebuild

### 4.1 What the PoC does

The PoC runs **local JSON + computed embeddings** entirely in-process:

- `data-loader.ts` loads `cms/library-data.json` + `cms/image-catalogue.json` synchronously at startup
- `embeddings.ts` lazy-loads `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384-dim) and computes embeddings for every component and richly-annotated image on first server boot
- `component-search.ts` and `image-search.ts` do in-memory hybrid search: 40% keyword (field-weighted) + 60% cosine-similarity semantic, normalised, top-N returned

This works beautifully for Antarctica's low-thousands scale. Patagonia's volume per Al 21 Apr is *"too large for the previous method"* — hence Vertex.

### 4.2 Swap target: Vertex AI Search (settled — first bet)

Per `01-architecture.md` §6 and the research doc: **primary target is Vertex AI Search**, accessed via **custom function tools wrapping the Discovery Engine API** — not ADK's built-in `VertexAiSearchTool` (see known bugs in `discovery-agent-architecture-brief.md` §2 and "Also-rans").

The mapping is a straight swap, not a rebuild:

| PoC | Phase 2 |
|---|---|
| `cms/library-data.json` loaded in memory | Vertex Search **`components`** datastore (one document per Big Brick) |
| `cms/image-catalogue.json` loaded in memory | Vertex Search **`images`** datastore (V2 — V1 keeps image URLs inline on components) |
| (no blog) | Vertex Search **`stories`** datastore (blog articles, chunked by h2/h3) |
| `Xenova/all-MiniLM-L6-v2` local embeddings | Vertex's default retrieval-tuned embedding model |
| In-memory hybrid scoring in `component-search.ts` | Vertex native hybrid — with instrumentation from day one to compare against PoC-style explicit scoring if we need to reintroduce it |

### 4.3 Fallback: Weaviate Cloud Serverless

**Status: settled as fallback, pricing-dependent.**

Al 21 Apr: *"Weaviate looks really good, but it's a paid-for solution"* — it's the fallback if Vertex relevance can't be tuned up or if pricing-at-scale lands better than expected. Research doc (`discovery-agent-architecture-brief.md` §"Weaviate") has the detail: three collections, named vectors per property, Personalization Agent plumbing deferred to V2.

Swap cost is medium — re-ingest + swap the retrieval client in the data connector (single file behind the Zod-typed interface). Architecture in `01-architecture.md` §10 protects this.

### 4.4 Chunking

- **Big Brick components**: one document per component, no chunking. Fits under Vertex doc-size limits comfortably.
- **Blog articles**: chunk by h2/h3 with overlap. Metadata on each chunk = article ID + section title, so retrieval can group results or re-join.
- **Embedding model**: Vertex default (task=retrieval). Don't port the `all-MiniLM-L6-v2` local model — wrong shape for hosted retrieval.

### 4.5 Ingestion job

- Reads from `raw-scrapes/` Cloud Storage bucket
- Dedupes by content hash against previous ingestion
- Writes to the appropriate Vertex datastore
- Idempotent; safe to re-run
- Logs added / updated / skipped / errored counts to Cloud Logging

**Handover**: this is the script Swoop's team runs at cadence post-handover. Script + runbook in `product/scraper/scripts/ingest.ts`.

### 4.6 Relevance tuning

Instrument from day one:

- Log every retrieval query + top-N results + which result the agent cited
- Post-launch offline review of gaps
- Tuning dimensions: re-ranking, filter adjustment, metadata boosts, chunk size

If Vertex relevance proves untunable: Weaviate swap (§4.3).

---

## 5. Friday session prep (24 Apr 2026)

**Framing**: *not* "ask them to dump the schema". Reframed per Addendum A.2 as a **hackathon to produce a shared data ontology + a set of API endpoints Swoop will own post-handover**.

### 5.1 Questions to resolve

**Ontology (Patagonia-specific)**

- What ComponentTypes exist for Patagonia in Mongo today? Match against the Big Bricks taxonomy (Cruise, Guided Activity, All-Inclusive Hotel Trip, Private Tour, Addon).
- Where does the new **Group Tour** product sit — new ComponentType, new Template, or a tag on an existing type?
- How is the **Independence** dimension (Group / Tailor-Made / Independent) represented in the data?
- **Destination / region pages** — are these Components, separate CMS content, or implicit in Big Brick `destination` fields?
- How is **Torres del Paine density** (80%+ of bookings per Luke) represented — one Component, many Components, a tag?
- What do the **editorial fields** look like for Patagonia? (Antarctica has `whatWeLike` / `swoopSays` / `thingsToNote` on ships — are these present for Patagonia Big Bricks?)
- What's the image model? How are URLs associated with Components? Is the `componentRef` pattern used?

**Data access**

- Can a `<meta name="swoop-id" content="component_…">` tag be added to every product/article/destination page? Effort?
- Is the **JSON endpoint** option on the table? Effort vs letting us scrape?
- Which pages are SSR vs CSR? (Per Richard Connett 90% SSR — confirm for Patagonia specifically.)
- Are there internal APIs we could call directly against MySQL or Mongo?
- Blog: what's the CMS behind the articles? Is there a feed or just HTML?

**Operational**

- Preferred scrape/ingest cadence? (Daily, weekly, on-change?)
- Who on Swoop's team owns running the ingestion script post-handover?
- Feedback loop when data is wrong/stale?
- Rate-limit / terms-of-use posture for the scraper against live site?

### 5.2 What we bring

- This doc as working draft — strawman schemas visibly marked as derived from Antarctica PoC, *not* pretending to be settled Patagonia shape
- **PoC artifact**: `ts-common/src/domain.ts` — real Zod, real field names. Walk them through it. This anchors *"what we already know about Swoop data"*.
- **Sample extraction**: run the Claude scraper prompt live against one Patagonia URL if useful — demonstrates the V1 approach concretely.
- **Vertex vs Weaviate decision criteria**: relevance quality, cost posture, tuning effort. For them to weigh in if they have opinions on the substrate choice.
- Infrastructure diagram (`01-architecture.md` §1) for context on where scraped data lands.

### 5.3 Outcomes wanted

- **Confirmed Big Brick taxonomy for Patagonia** — the ComponentTypes that actually exist
- **Confirmed data access path** — meta-tags + scrape, JSON endpoint, or hybrid
- **Confirmed ID strategy**
- **Confirmed timelines** — when we can start pulling real data
- **List of sample URLs per content type** — feeds scraper prompt development immediately
- **Cadence + owner** for the post-handover ingestion job

---

## 6. Three content streams — grounded in what the PoC already handles

Cross-referencing `00-overview.md` Addendum A.3:

| Stream | PoC state | Phase 2 change |
|---|---|---|
| **1. Product catalogue** (Big Bricks: ships, cruises, cruise_activities, private_tours, likely + guided_activity + others for Patagonia) | Canonical schemas in `ts-common/src/domain.ts`; data in `cms/library-data.json` loaded locally at startup; hybrid keyword+semantic search in-memory via `@xenova/transformers` | Replace local JSON+embeddings with Vertex AI Search datastore; schemas survive, retrieval substrate swaps |
| **2. Website content** (place pages, prices, images inside product pages) | Not handled — PoC used baked Antarctica data | **New**. V1 scraper is this stream. Meta-tag-embedded Mongo IDs bridge scraped content to Stream 1 records. Merges scraped prices + place descriptions into the canonical Component record before indexing |
| **3. Blog** (hundreds of articles, 5 years of voice/expertise) | Not handled | **New**. Same scraper, separate prompt, separate Vertex datastore. Retrieval profile is semantic-dominant, not filter-dominant. Fuels the *agent-sounds-like-Swoop* behaviour more than the *agent-returns-accurate-prices* behaviour. |

Stream 3 from 00-overview.md (**Patagonia sales thinking docs** from Luke + Lane, 1–2 weeks out) feeds the **HOW layer** (behavioural fragments per `01-architecture.md` §2.2), not the WHAT retrieval layer. Not in the automated ETL.

---

## 7. Image pipeline

### 7.1 PoC carry-forward

The PoC has a working, decent image pipeline. V1 reuses the pattern:

- `imgix` CDN URLs stay as-is (separate subdomain per destination expected — `imgix.swoop-patagonia.com` if naming pattern holds)
- Scraper extracts image URLs inline with component/article records (`ImageRef[]`)
- `get_trip_detail`-equivalent tool returns image URLs the UI renders
- Agent can reference images in its output text

### 7.2 V2 upgrades (deferred)

From `00-overview.md` A.1 domain 11 and PoC patterns:

- Separate Vertex datastore for images (multimodal retrieval surface)
- `get_image` tool for query-driven surfacing independent of component
- Gemini-vision auto-annotation pipeline (the PoC's `image-annotations.json` shape, re-run for Patagonia)

### 7.3 Design note

Keep `ImageRef` + `ImageRecord` schemas in place from day one so V2 adds a retrieval layer, not a data model change.

---

## 8. Decision register

| # | Decision | Status | Where settled |
|---|---|---|---|
| 1 | Scrape current site as V1 extraction | **settled** | 21 Apr meeting |
| 2 | Claude deep-research + prompt engineering as extraction method | **settled** | 21 Apr |
| 3 | Vertex AI Search as primary retrieval substrate | **settled** (first bet) | 01-architecture.md §6 / 21 Apr |
| 4 | Weaviate as fallback | **settled** (contingent on Vertex quality/cost) | 21 Apr |
| 5 | Wrap Discovery Engine API in custom function tools, not ADK's built-in | **settled** | discovery-agent-architecture-brief.md |
| 6 | Scraper is disposable (rebuild post-October migration) | **settled** | 21 Apr |
| 7 | Meta-tag-embedded IDs to bridge scrape → Mongo component IDs | **leaning** | 21 Apr — Thomas's proposal |
| 8 | JSON-endpoint-from-Swoop as simpler alternative to scraping | **open** | Friday to decide |
| 9 | Patagonia ComponentType taxonomy (beyond Antarctica's ship/cruise/cruise_activity/private_tour) | **open** | Friday to settle |
| 10 | Group Tour as distinct type vs tag on existing type | **open** | Friday + Luke/Julie input |
| 11 | Scrape-ingest cadence | **open** | Friday |
| 12 | Ingestion-script owner post-handover | **open** | Friday |
| 13 | Separate Vertex datastores for components / stories / images | **leaning** (separate for V1 components + stories, images deferred) | This doc §4 |
| 14 | Blog schema shape | **leaning** — strawman in §2.4 | Friday to refine against CMS reality |
| 15 | Image pipeline (carry PoC `imgix` + `ImageRecord` shape) | **settled for V1** | PoC + this doc §7 |

---

## 9. Open threads flagged for resolution

- **§2.3**: Patagonia ComponentType taxonomy — Friday
- **§3.3**: ID strategy final call — Friday
- **§3.6**: JSON endpoint vs scrape — Friday
- **§4.6**: Relevance tuning thresholds — post-launch instrumentation
- **§7.2**: Image retrieval substrate (same Vertex instance? separate? per 00-overview.md domain 11) — V2 work
