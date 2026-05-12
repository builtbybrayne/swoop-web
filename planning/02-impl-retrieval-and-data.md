# 02 — Implementation: C. Retrieval & Data

**Status**: Tier 2 implementation plan. Revised 2026-04-29 (data-review pass against the loaded SQL dump + ingested blog snapshot). Earlier rewrite landed 2026-04-28 (replaces the 2026-04-22 draft archived at [planning/archive/02-impl-retrieval-and-data-pre-postgres-rewrite.md](archive/02-impl-retrieval-and-data-pre-postgres-rewrite.md)).
**Implements**: Puma top-level plan §4C + theme 5 (disposable ETL).
**Depends on**: A (foundations — `ts-common` tool I/O schemas, workspace scaffolded). 2026-04-27 SQL dump received and available locally. C.18 (Postgres + pgvector + tsvector + pg_trgm) and G.11 (CMS folder structure) landed.
**Coordinates with**: B (agent runtime calls tools via MCP), G (placeholder content at M1 → real content at M2; tool-description copy lives in `cms/prompts/tools/<tool>/`), F (tool calls emit events), D (widgets hydrate from tool outputs), E (handoff submission writes durable record + sends email).

> ## ⚡ Future agent reading this for the first time?
>
> **Skip past the revision history below and read [§"★ Read this first — the WHY of chunk C"](#-read-this-first--the-why-of-chunk-c) end-to-end before anything else.** That section names the agent's actual job, the four+1 jobs the data does, and the design discipline (top-down from sales, not bottom-up from data) that grounds every choice in this chunk. Multiple Claude sessions on this engagement have walked into bottom-up reasoning when starting from the data shapes; that section is the antidote. The revision history that follows is reference material — it's there for readers tracking what's changed across plan versions, not as an entry point.

---

## Revision history — what shifted across plan versions

*(For readers tracking changes. Not an entry point — see ★ section above for the WHY.)*

The original 2026-04-22 draft was structured around an unresolved scrape-vs-API question, Vertex AI Search as the retrieval backend, and a tool surface evolved tactically from the PoC's seven tools. Four things have shifted since.

1. **2026-04-27 SQL dump arrived from Swoop** as the canonical source. Scrape-vs-API is dead; the dump is upstream-of-truth. Planned weekly cadence; eventual steady state TBC with Swoop ops.
2. **Postgres won** the storage decision (C.18). pgvector + tsvector + pg_trgm in a single engine cover semantic + lexical + fuzzy retrieval at our scale; Vertex was overkill and would have introduced a two-store sync surface for marginal gain.
3. **Sales-shaped tool surface** (originally 2026-04-28) — the agent is a sales agent moving visitors Awareness → Interest → Strong Consideration, not a librarian. The 2026-04-28 plan named ten tools, half of them fronted by a Haiku composer layer that decomposed sales-shaped intent into data calls. Five jobs / eight tools / **no composers** is now the canonical shape (decision C.25, with C.24 superseding C.22). Sonnet at the orchestrator handles synthesis directly from intent-named tools; the cost shape, latency, and complexity-budget all favour the simpler architecture. Composers stay in the toolbox for any future case where a single tool genuinely needs multi-step retrieval Sonnet can't plan reliably from a description alone — none of Puma's eight tools meet that bar.
4. **2026-04-29 data review** — first deep look at the loaded dump (page / contentblock / chunk / faqitem / ntag) plus the blog snapshot. Findings reshaped the supply-side picture:
   - **Customer-review supply is dangling**: `contentblock_customerreview` (2,390 rows) and `contentblock_customertip` (119) are pure junctions; the `customerreview` / `customertip` source tables they FK against don't exist in the dump (PII redaction at export). The chunk-C plan had assumed those reviews would feed `find_someone_who`. They won't, unless Swoop provides a separate redacted export. Tracked as decision C.26.
   - **Page prose eclipses the blog as content supply**: 482 content-relevant pages carry ~2 MB of page-level prose (intro_text + summary) plus ~2 MB of contentblock prose. Pagetype taxonomy (Guidebook 87, Swoop 43, City 23, Activity 25, Region-Activity 26, National Park 16, Region 16, etc.) maps cleanly onto the five-jobs framing. Decision C.29.
   - **`ntag` is small + clean + typed**: 79 active tags across 5 dimensions (interest 27 / area 21 / activity 17 / trip-type 7 / style 7). Embed every tag once at ETL; visitor utterance → tag space at near-zero cost. Blog tags remain messy; normalise during ingest.
   - **Profile pages dropped**: 40 specialist staff bios. Per "we don't care about authors / strip", excluded from ETL. Decision C.27.
   - **Test pages filtered** at ETL boundary (decision C.28).

That four-shift reshapes most of this chunk's design. The architectural principles, the disposable-ETL theme, the derived-datasource terminology, the image annotation pipeline, the deep-link URL goal, the clean handoff to Swoop's internal team, and the per-tool file pattern all carry forward unchanged. Specific destinations (Vertex → Postgres) and surface shapes (data-shaped tools → sales-shaped tools, then sales-shaped composer → intent-named tools without composer) replace those of the prior drafts. Page prose is now the heaviest content surface, with the blog as a parallel narrative-rich complement.

---

## ★ Read this first — the WHY of chunk C

> **Why this section exists**: chunk C touches data, schemas, tables, columns, embeddings, indexes — concrete things with shapes you can hold in your hand. That's exactly the territory where bottom-up reasoning sneaks in. An agent reads about `contentblock` and starts asking "what tool would query this?" — and within an hour the design has drifted from "what should the conversation do?" to "how do we expose the database?". Multiple Claude sessions have walked into this trap on this engagement. **This section is the calibration layer. Don't proceed past it without grounding.**

### 1. The agent's actual job

Puma's agent is a **conversational discovery surface for adventurous travellers considering Patagonia.** Its job is to move *appropriate* visitors through three sales stages:

> **Awareness → Interest → Strong Consideration → warm specialist handoff**

That's the entire mandate. Not "answer questions about Patagonia". Not "expose Swoop's content catalogue". Not "build itineraries". Not "book trips". The agent is a *funnel surface* whose success is measured by:

- Did appropriate visitors leave the conversation more confident, more excited, and more inclined to speak with a Swoop specialist?
- Did inappropriate visitors (backpacker-tier, sub-$1k-profit, off-piste queries) get politely redirected without feeling rejected or patronised?
- Did the sales team receive qualified leads with enough conversational substance to pick up the thread warm, not cold?

The agent is the **knowledgeable friend who's been to Patagonia**, not an FAQ bot, not a salesperson with a quota, not a librarian doing CRUD on a content catalogue. Voice: warm, expert, human, honest about what it can't do (no itineraries, no authoritative pricing, no availability guarantees).

The "golden thread" is decision **C.13** — Awareness → Interest → Strong Consideration. Every architectural choice in this chunk traces back to it. If a tool / schema / column doesn't serve a moment in that arc, it shouldn't exist.

### 2. The four jobs the data does for that conversation (plus a fifth structural one)

Here is the load-bearing reframe. Step away from the data shapes for a moment.

At every point in a Patagonia sales conversation, **content** (blog post / page / customer review / FAQ / image) is doing one of four jobs *for the visitor*. These aren't categories of content. They're **functions content performs in service of the journey**.

| Job | What it does for the visitor | What it does for the agent | Conversational moment |
|---|---|---|---|
| **Inspire** | Turns vague interest into vivid anticipation. *"Patagonia? oh wait — that sounds incredible."* | Gives the agent imagery, sensory prose, evocative anchors to weave into its response. Warmth-fuel, not an answer. | Discovery → Interest. Visitor is curious, exploring. |
| **Mirror** | Lets the visitor see themselves in someone who's done it. Reduces fear of being weird/wrong. *"People like me have done this — and loved it."* | Gives the agent a customer story matching a persona signal the visitor revealed. | Interest → Strong Consideration. Triggered by persona-tells: *"I'm going alone"*, *"we're retiring"*, *"I love photography"*. |
| **Reassure** | Converts curiosity into confidence to talk to a human. *"These people seem legit. They actually care."* | Gives the agent proof — B-Corp, conservation work, expert credentials, real reviews — matching the visitor's hesitation. | Anywhere a hesitation surfaces. Consolidates trust before handoff. |
| **Inform** | Answers a concrete question. *"How long is the W trek?", "Is December crowded?"* | Gives the agent factual content + the option to deep-link to the canonical Swoop page. | Anywhere. Tactical, not load-bearing for the journey itself. |

Plus a fifth, structural job:

| Job | What it does | Notes |
|---|---|---|
| **Propose options** | Offers concrete trips for the visitor to consider | The closest the agent gets to recommending. Structured trip-table filter, not unstructured retrieval. Triggered when the visitor is ready to narrow. |

**These four+1 jobs are the substrate.** Everything else — the tool surface, the derived database tables, the ETL classifier passes, the schemas — falls out of them.

### 3. The design discipline: top-down from sales, not bottom-up from data

This is the principle that prevents drift. **Every architectural choice in this chunk gets justified by which job it serves and which conversational moment it shows up in.** No exceptions.

**The right pattern (top-down):**
> *"At this conversational moment, the visitor needs X (a vivid anchor, a persona-mirroring story, a piece of trust evidence, a factual answer). What data shape supports X? Which tool exposes that shape to the agent? Which derived table holds those rows? Which source rows feed that derived table?"*

**The wrong pattern (bottom-up):**
> *"We have a `tag` table with 79 rows. We have `contentblock_customerreview` with 2,390 rows. We have a 102-row blog corpus. What tools should the agent have to query these?"*

The bottom-up pattern produces librarian-shaped tools (`search_pages`, `find_trips`, `query_tags`, `get_blog_post`). Those tools are *correct against the database* but *wrong against the conversation*. They make the agent feel like a search engine. They turn warm-friend interactions into ticket-counter interactions. They were the failure mode the 2026-04-28 plan tried to patch with a Haiku composer layer — adding an LLM middleman to translate librarian-shaped output into sales-shaped output. The 2026-04-29 review revealed the cleaner fix: **shape the tools by the job, not the data, in the first place.** Composers are then unnecessary; Sonnet at the orchestrator weaves directly.

**Anti-pattern signals to push back on, hard:**
- *"We have data X, what tool should query it?"* — Wrong direction. Always.
- *"Let's design tools that mirror the database structure."* — That's CRUD, not conversation.
- *"More tools means more flexibility."* — Usually wrong. Eight is enough at our scale; more dilutes Sonnet's selection accuracy.
- *"The data tells us what's possible."* — Yes, but doesn't tell us what's *useful in the conversation*.
- *"This is a search problem."* — No, it's a conversation problem that uses search inside it.
- *"Just expose the entities, the agent can figure out what to do."* — That's how you get a librarian, not a knowledgeable friend.

**The right question, always:** *"Whose journey am I serving, and at what point in their journey? What conversational move does this enable?"* — if you can't answer that concretely, you're reasoning bottom-up. Stop. Re-anchor.

### 4. How everything else in this chunk falls out

With the four+1 jobs as the substrate, the rest of chunk C is derivation:

- **Five intent-named tools** front the four+1 jobs: `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`. Plus three utilities (`illustrate`, `handoff`, `handoff_submit`) carried forward from the PoC. **Eight total** (decision C.25).
- **Five job-shaped derived tables** match the five tools: `inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`. Each table holds rows shaped for the job, *regardless of which source row they originally came from*. A blog post can land in `inspire_passage` (if it's narrative) or `trust_proof` (if it's a B-Corp piece) or both.
- **ETL Haiku classifiers** are how raw rows get assigned to jobs. They run once at ingest, persist to columns, and never run on the conversational path. The "cheap LLM at ETL, embeddings + Sonnet at runtime" division of labour (decision C.24) is what makes the eight-tool surface work without composers.
- **Tool descriptions** carry the load that composers used to carry: they encode the conversational moment Sonnet uses to pick. They are not "what does this tool query?" — they are "when in the conversation does this tool show up?". Production-quality from day one (per C.t2's scope).
- **Page-as-hub + canonical_url + ntag taxonomy + image annotations** are all enabling infrastructure. Each one is justified by a job: page-as-hub gives every conversational citation a deep-link; canonical_url is what the agent shows the visitor when they want to "go see the page"; ntag bridges visitor utterance to retrieval; annotated images let `illustrate` return visuals matched to mood/region/topic.

If you ever find yourself unsure whether to add a tool, a column, a table — ask: **does it serve a job at a moment in the journey?** If yes, build it. If you're justifying it from the data side ("we have this, so we should expose it"), that's the wrong reasoning, no matter how technically reasonable the addition seems.

### 5. The voice of the conversation, briefly

The agent talks like a knowledgeable friend who's been to Patagonia and runs Swoop's day-to-day operations. Warmth that isn't performance. Expertise that isn't gatekeeping. Honesty about uncertainty (no false pricing, no fake itineraries, no over-promises). Energy when the visitor is excited; calm when they're hesitant; respect when they're not the right fit.

What it sounds like is owned by chunk G's content authoring (the WHY system prompt + style-avoid list — decisions G.10 + G.11). What it *doesn't* sound like is anything in this list (drawn from chunk G §2.1a and seen in default LLM output): em-dash-laced rhythm, "delve" / "dive into" / "unpack", openers like "Let me help you with that!", trailing offers like "Let me know if you'd like to explore…", empty affirmations like "Great question!", parenthetical-heavy sentences, bullets where prose belongs.

That voice runs through the *tool descriptions* in this chunk (`cms/prompts/tools/<tool>/description.md`) — not just the system prompt. Every authored prose surface is a chance for the agent's voice to land.

---

## Purpose

C owns everything the agent retrieves. A data-connector service runs on Cloud Run, exposing the eight intent-named MCP tools (per C.25) to the orchestrator. Each tool is a thin handler over data primitives — input validation, 1–N SQL/vector calls against Postgres, output validation, return. **No composer layer in the request path** (per C.24): Sonnet at the orchestrator handles synthesis directly from concrete row-shaped tool outputs.

The Postgres derived store is populated by an ETL that ingests Swoop's SQL dump (and the WordPress blog REST API as a parallel stream), transforms it into purpose-built read-shaped views, and pre-computes embeddings + lexical indexes for hybrid retrieval. Cheap LLM (Haiku) earns its keep in the ETL — classifying blog posts by job, extracting persona summaries, generating image annotations, normalising blog tags against `ntag`. Done once, persisted to columns; never on the conversational path.

Mongo is explicitly not in scope. Weaviate is out. Vertex AI Search is out (per C.18). The ETL is throwaway by design — when Swoop's data consolidation lands later in 2026, the export queries get rewritten; the derived-store shape and tool surface stay stable.

---

## 1. Outcomes

When this chunk is done:

- A data-connector service runs on Cloud Run, speaking MCP over HTTP, exposing the finalised eight-tool intent-named surface (see §2.2). **No composer layer**; tools call SQL/vector helpers directly and return results to the orchestrator (decision C.24).
- A Postgres 18 derived store (Cloud SQL in prod, Postgres-in-Docker locally for parity) holds Patagonia content shaped for retrieval — Trip / Tour / Hotel / Vessel / Location / Activity / FAQ / BlogPost / Page, plus job-shaped derived entities (InspirePassage / TrustProof / InformChunk and — *conditional on Swoop providing a redacted customer-review export* per C.26 — CustomerStory). Indexed with `pgvector` HNSW, `tsvector` GIN, and `pg_trgm` GIN as appropriate.
- An ETL pipeline ingests the SQL dump and produces the derived store via declarative transformations + an embedding pass. Re-runnable, idempotent, diffable across runs. **Profile pagetype excluded** (decision C.27); **test pages filtered** (decision C.28). (The C.t0 design-phase practice of loading the dump into a local MariaDB for inspection is closed; the canonical ETL doesn't depend on it.)
- A separate WordPress REST API ingest stream (see [planning/03-exec-blog-ingest.md](03-exec-blog-ingest.md)) lands ~102 posts in the rolling 5y window. Each blog post is classified at ingest into one (or more) of the four content jobs (Inspire / Mirror / Reassure / Inform); chunks land in the corresponding derived tables alongside page-derived chunks.
- Images resolve via a single annotated `image` table with flexible canonical URLs (per C.15) — source-of-truth (WP media vs imgix vs S3) is irrelevant once normalised. Tool responses carry pre-rendered URLs the chat surface (D) can render directly.
- Tool responses carry public page URLs derived deterministically as `override_url || alias`, enabling the "go see this page" deep-link affordance.
- Handoff email delivery (the `handoff_submit` tool's outbound path) lands in the connector as a backend function — reusing the PoC mailer pattern with SMTP credentials in Secret Manager.
- Swoop's internal team can run the ETL at cadence — no hidden dependency on Al's machine.
- **Image annotation pipeline runs** — starter sample annotated pre-launch; full-catalogue annotation completes before production traffic. Annotations stored as columns on the `image` derived table, queryable inline with image retrieval.
- **`ntag` taxonomy embedded** at ETL — 79 typed tags across 5 dimensions (interest / area / activity / trip-type / style). Each tag carries a vector representation; visitor utterance → tag mapping is near-free at query time. Blog tags normalised against this taxonomy at ingest.

**Not outcomes**:
- Mongo reads (explicitly not in scope — confirmed no longer used).
- Weaviate (out).
- Vertex AI Search (out, C.18).
- Composer layer / per-tool Haiku sub-agents (out, C.24 supersedes C.22).
- Full site coverage — scope sufficient for a convincing live conversation, not the entire Swoop catalogue.
- Real-time pricing lookups (only headline `base_price` is surfaced; specific quotes are sales's job — see C.14 territory and inbox.md 2026-04-27 entry on pricing stance).
- Departure-level data (out by product decision; Patagonia is largely demand-driven and the source data is too volatile).
- Customer attribution (`swooper_*` fields are customer PII; out of scope).
- Customer-review prose (`customerreview` / `customertip` source tables are dangling in the dump — decision C.26). The `find_someone_who` tool ships only if Swoop provides a redacted export.
- Profile pagetype (40 specialist bios) — out per C.27.
- Complex live integration with Swoop's website (we read from a periodic dump, not a live API).

---

## 2. Target functionalities

### 2.1 Data ingestion: SQL dump → transform → Postgres

The 2026-04-27 SQL dump (Sequel Ace `.sql`, ~210 MB, exported from Swoop's MariaDB 5.5.64 production database) is the canonical source. Cadence assumed weekly during M1–M5; steady state TBC with Swoop ops (could become an API, CDC, or scheduled feed; see `questions.md` Q13).

**Pipeline shape (canonical):**

1. **Land the dump** — drop the `.sql` file at `data/<dump-name>.sql`. `data/` is gitignored.
2. **Transform** — read the MariaDB-format dump, apply the declarative transformations (whitelist the tables we use, drop the cruft — audit columns, soft-delete fields, internal-ops tables, the entire `partner*` PII subgraph; flatten denormalised joins where the agent always reads them together — trip + canonical day-by-day; hotel + page-as-hub for images; compute derived columns — `from_price` from `base_price` + currency normalisation, voice/style descriptors from `ntag` joins, story-richness flags; filter Profile pagetype per C.27 and test pages per C.28), and write the result into the Postgres derived store via `INSERT … ON CONFLICT DO UPDATE`. Tooling pick (e.g. `pgloader` + a SQL transform layer, or a Node CLI translator) lands at C.t3 design time. **This is C.t3.**
3. **Embed prose fields + populate job-shaped derived entities** — separate Node CLI pass (C.t3a). Reads the freshly-populated Postgres tables + the blog NDJSON snapshot, chunks per entity strategy, embeds via Voyage-3 (or whichever embedding model is locked), populates `embedding` columns + `content_hash` for idempotency, and assembles `inspire_passage` / `customer_story` / `trust_proof` / `inform_chunk` derived entities. Plus runs the Haiku-driven ETL classifiers (blog-post job classifier, persona-summary extractor, blog-tag normaliser). Re-runs only embed/classify rows whose `content_hash` has changed.
4. **Indexes refresh** — `REINDEX` only if schema changes; otherwise the standard incremental index updates suffice.

The pipeline runs as a Cloud Run Job on demand, or scheduled (post-M4). Handed off to Swoop's internal team for operation — architectural priority from 21 Apr.

**Note on the C.t0 dev-time MariaDB step**: during the C.t0 inspection phase (2026-04-27 → 2026-04-29) we loaded the dump into a local MariaDB to SQL-poke the data while designing the schema. That step is **closed and not part of the canonical ETL** — the production transform reads the `.sql` file directly. No live MariaDB on the production path.

**Disposable**: when Swoop's source schema changes (October 2026 data consolidation, or any other shift), the transform layer gets rewritten; nothing downstream needs to change because the derived store's interface is stable.

### 2.2 Tool surface (the agent's view)

The agent's tool surface is **eight intent-named tools** mapped to the five conversational jobs that emerged from the 2026-04-29 data review (decision C.25). Five tools front the four content jobs + the structured options job; three are utility tools (visual + handoff pair) carried forward from the PoC. **No composer layer** (decision C.24): every tool is implemented as a thin handler over data primitives (§2.4) and returns concrete row-shaped output that the orchestrator's Sonnet handles synthesis on directly.

The five conversational jobs:

| Job | What it does for the visitor | What it does for the agent | When reached for |
|---|---|---|---|
| **Inspire** | Turns vague interest into vivid anticipation | Imagery, sensory prose, evocative anchors to weave into `<utter>` | Discovery → Interest. Warmth-fuel, not an answer. |
| **Mirror** | Lets the visitor see themselves in someone who's done it | A customer story matching a persona signal | Interest → Strong Consideration. Triggered by persona-tells. |
| **Reassure** | Converts curiosity into confidence to talk to a human | Proof matching the visitor's hesitation | Anywhere a hesitation surfaces. |
| **Inform** | Answers a concrete question | Factual content + canonical URL | Anywhere. Tactical, not load-bearing for the journey. |
| **Propose options** | Offers concrete trips to consider | Structured filter result over the trip table | Strong Consideration. The closest the agent gets to recommending. |

The eight tools:

| Tool | Job | Inputs | Output | Primitive(s) |
|---|---|---|---|---|
| **`find_inspiring(theme \| region \| mood)`** | Inspire | Short phrase + optional region/area filter | 2–4 InspirePassage hits with hero images + region tag | hybrid retrieval over `inspire_passage` (page + blog narrative) |
| **`find_someone_who(visitor_signal)`** *(conditional)* | Mirror | Persona-signal phrase ("solo female", "post-retirement", "photographer") | 1–3 customer stories: short blurb + persona tag + region | hybrid retrieval over `customer_story` (first-person blog + customer reviews **if Swoop provides redacted export — C.26**) |
| **`find_proof(concern \| topic)`** | Reassure | Concern phrase or topic | 1–3 trust-proof items: claim + source + evidence | hybrid retrieval over `trust_proof` (B-Corp / sustainability / About-Swoop pages + B-Corp blog cluster) |
| **`lookup(question)`** | Inform | Direct factual question | Relevant prose chunks + canonical URL(s) | hybrid retrieval over `inform_chunk` (FAQ + practical guide + trip-detail prose) |
| **`find_options(filters)`** | Propose options | Structured: region, duration, budget band, activity, etc. | 2–4 trip cards: image, headline, region, headline price, vibe-line | SQL filter over `trip` (internals settled once trips ingestion lands; surface is committed) |
| **`illustrate(scope)`** | Visual companion (any job) | Scope phrase or entity reference | Image set: pre-rendered URLs + alt text + captions + tags | image table with annotations |
| **`handoff(reason, summary)`** | Open lead-capture | Reason + agent's working summary | Opens lead-capture widget | passthrough |
| **`handoff_submit(payload)`** | Submit lead | Full handoff payload from widget | Durable record + email | chunk E owns durability + delivery |

**Why this surface, not composers:**
- Each tool's output shape is concrete enough that Sonnet can weave directly. We don't need an internal LLM to "make it nice".
- Tool *intent is encoded in name and description*, which is what Sonnet uses to select. The composer pattern was justified when tool outputs were vague ("evocative content"). With concrete outputs, no extra hop is needed.
- One LLM call per turn, not three. Lower latency, lower cost, fewer failure modes.
- Composer pattern stays in the toolbox as a future option *for any tool that genuinely needs multi-step retrieval Sonnet can't plan reliably from a description alone* — none of Puma's eight meet that bar.
- Where Haiku-style cheap LLM work *does* earn its keep: at **ETL/ingest time** — classifying blog posts by job, extracting persona signals from customer stories, generating image annotations, normalising blog tags against `ntag`. Done once, persisted to columns. Not on the conversational path.

**Tool descriptions** (the prose Claude reads to decide which tool to pick when) live in `cms/prompts/tools/<tool-name>/description.md` per G.11. Tool I/O schemas live in `ts-common`.

**Notes on what's _not_ here:**
- **No `search` / `get_detail` as distinct external tools** — `search` is subsumed into `lookup` (free-form factual) + `find_options` (structured trip filter). `get_detail` for trip / region detail collapses into `lookup` for prose lookup and `find_options` for one-shot trip retrieval. Internals settle once trips ingestion lands; surface stays committed.
- **No `find_trips` / `search_blog`** as separate tools — those are internal data primitives (§2.4) inside `find_inspiring`, `lookup`, `find_options`.
- **No `get_guidance` tool** — agent guidance lives in system prompts (`cms/prompts/system/`) and in ADK skills (`cms/prompts/skills/`) per G.11.
- **No `load_skill` custom tool** — replaced by the ADK-native skill primitive (decision C.11 carries forward).
- **No composer tools** (`stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths` from the 2026-04-28 plan) — superseded by the intent-named tools above. C.24 supersedes C.22; C.25 supersedes C.19.

### 2.3 Tool implementation pattern (no composer layer)

Decision C.24 (2026-04-29) supersedes the composer pattern from C.22. Every tool — including the five intent-named content tools — is a **thin handler over data primitives** (§2.4). No Haiku sub-agent inside the connector. No LLM in the request path beyond the orchestrator's Sonnet.

**Implementation shape per tool:**

`src/tools/<tool-name>.ts`:
1. Accept Zod-validated input.
2. Call one or more data primitives from `src/data/`. Run them in parallel where independent.
3. Combine the result rows (often just concatenation, sometimes light join/dedup) into the tool's Zod output schema.
4. Return.

That's it. Tests at `src/tools/<tool-name>.test.ts` exercise the handler against stubbed data primitives.

**Why this is enough:**
- Tool outputs are concrete enough that Sonnet (the orchestrator) handles synthesis directly when weaving them into `<utter>`.
- Tool *intent is encoded in tool name + description*, so Sonnet picks correctly without a composer assisting.
- One LLM call per turn (Sonnet only) — lower latency, lower cost, fewer failure modes.
- Each handler is deterministic, fast, easy to test.

**When a composer might earn its keep (parked for future):**
- A future tool that genuinely needs multi-step retrieval Sonnet can't plan reliably from a description alone. None of Puma's eight tools meet this bar.
- Adding one later is additive: a single new file `src/composers/<tool>.ts` between handler and data primitives. The data-primitive layer is unchanged. No architectural commitment is foreclosed.

**Where Haiku does earn its keep — at ETL/ingest, not query:**
- Classifying each blog post into one (or more) of the four content jobs (Inspire / Mirror / Reassure / Inform) — assigns it to the right derived table.
- Extracting persona signals from each first-person customer story (and customer reviews, *if* C.26 unblocks them) — solo / family / age band / motivation tag — stored as structured columns the `find_someone_who` tool can match on.
- Generating image annotations + tags for the `image` table.
- Normalising blog tags against the `ntag` taxonomy — a lookup pass that maps messy blog tags ("Torres_del_Paine", "CONSERVATION") to canonical typed `ntag` ids.

These are batch, persisted-once jobs running off Cloud Run Jobs. Not on the conversational path.

### 2.4 Data primitives (the bottom layer)

A small set of pure SQL / vector helpers, no LLM, deterministic. Tools call these directly (per §2.3 — no composer in the path).

- `hybrid_search_inspire({query, region?, area?, activity?, limit})` → top-N InspirePassage hits via RRF over pgvector + tsvector. Backs **`find_inspiring`**.
- `hybrid_search_customer_stories({signal, region?, limit})` → CustomerStory hits via hybrid retrieval, filtered by persona-signal extracted at ETL. Backs **`find_someone_who`** *(conditional on C.26)*.
- `hybrid_search_proof({topic, limit})` → TrustProof hits via hybrid retrieval. Backs **`find_proof`**.
- `hybrid_search_inform({question, limit})` → InformChunk hits via hybrid retrieval over FAQ + practical-guide + trip-prose chunks. Backs **`lookup`**.
- `query_trips_by_filter({region, duration_range, activity, accommodation_style, adventurousness, price_band})` → matching TripCard rows. Backs **`find_options`**.
- `fetch_trip_detail(id)` → joined Trip + canonical day-by-day + tags + linked images via page-as-hub. Used inside `find_options` for richer cards.
- `resolve_image_set({entity_type, entity_id, variant})` → image URLs (pre-rendered for the requested variant) via page-as-hub if `page_id` is present. Backs **`illustrate`** and any tool that returns images alongside prose.
- `find_locations(query)` → fuzzy match via `pg_trgm` + FTS over locations/areas/countries. Used inside `find_options` and `find_inspiring` when the visitor's input includes a region name.
- `find_tags_by_utterance({utterance, limit})` → top-N matching `ntag` ids via vector similarity over the 79-tag embedded taxonomy. Used to bridge visitor utterance → tag space, narrowing retrieval inside `find_inspiring` / `find_proof` / `lookup` when the utterance is too vague to query content directly.
- `fetch_pricing_band({scope})` → headline-price aggregates from `trip.base_price`. Used inside `find_options` for "from £X" framing.

Per-primitive file pattern: `src/data/<primitive>.ts`. Each primitive is a typed function over the Postgres pool, returning Zod-parsed rows. Tool handlers call one or more primitives directly (no composer between).

### 2.5 Postgres derived store: schema and indexes

The derived store has two layers of entities. The 2026-04-29 data review changed the picture meaningfully — page prose is the dominant content surface, customer-review prose is dangling in this dump, Profile pagetype is excluded, and `ntag` is the canonical taxonomy.

**Domain entities (mostly 1:1 with Swoop's source, post-cleanup):**
- `trip` — flattened, only published, with derived `from_price` + style/voice descriptors. Drops audit/soft-delete/PII columns.
- `tour`, `tour_item` — junction confirmed via `tours`/`tour_items`.
- `hotel`, `hotel_pricing`, `hotel_room` — accommodation catalogue.
- `vessel`, `cabin`, `cabintype` — for cruise context only.
- `location`, `area`, `country` — geographic hierarchy (764 locations in the dump).
- `activity` — first-class records.
- `faqitem` — 928 rows of real FAQ Q&A (`title` = question, `content` = answer).
- `image` — 13K rows, with flexible canonical URL + annotation columns + tags + embedding (per Al's 2026-04-29 spec: source-of-truth doesn't matter once normalised). Populated by §2.7.
- `page` — CMS pages, **the dominant content surface** per C.29. Filtered at ETL: Profile pagetype excluded (C.27), test pages excluded (C.28), Accommodation/Ship/Itinerary handled with the trip side rather than as content. `override_url || alias` is the canonical URL (C.15).
- `contentblock` — 10K rows of CMS prose, joined to `page` via `page_id`. Subtypes triaged: keep prose-bearing (carousel captions, image captions, when_to_travel — *if populated*); skip pure UI plumbing (navigationcard, settings, page cross-link); flag dangling junctions (`contentblock_customerreview`/`contentblock_customertip`/`contentblock_pressreview` reference source tables that are *not in the dump* — see C.26).
- `chunk` — 46 rows of small reusable CMS prose blocks. Useful for short-form retrieval supplements.
- `ntag` — 79 active typed tags across 5 dimensions (interest 27 / area 21 / activity 17 / trip-type 7 / style 7). Each ingested to a `tag` derived row with a vector embedding. The legacy 2,374-row `tag` table and `adventurousness` are deprecated per C.17.
- `blog_post`, `blog_chunk` — populated by [03-exec-blog-ingest.md](03-exec-blog-ingest.md). Each post classified at ingest into one (or more) of the four content jobs.

**Job-shaped derived entities (read-side views; the tables tools query against):**

| Derived table | Job | Source rows |
|---|---|---|
| `inspire_passage` | Inspire | Page intro_text + summary + contentblock prose from Region (16) / National Park (16) / City (23) / Activity (25) / Region-Activity (26) / Experience (9) / Country (3) / Landmark (1) + Guidebook subset (~50, the editorial slice) + blog `Stories & Inspiration` (31) + evocative `Epic Adventures` blog subset (~20). Chunked by `<h2>`/`subheading` boundaries. |
| `customer_story` *(conditional)* | Mirror | First-person blog posts (~15). Plus, *if Swoop releases redacted reviews per C.26*, derived rows from `contentblock_customerreview` + `contentblock_customertip` joined to whatever redacted-prose tables Swoop provides. Each row has structured persona-signal columns extracted at ETL (solo/family/age band/motivation tag). |
| `trust_proof` | Reassure | Page intro_text + summary + contentblock prose from the Sustainability/B-Corp/About-Swoop subset of the Swoop pagetype (~10 pages incl. "Sustainability at Swoop", "Swoop is proud to be a B Corp", "The Swoop Conservation Fund", "Swoop Impact Report", "Travelling Better", "About Swoop Patagonia") + Partner pages (9, partner-credentials slice) + B-Corp/sustainability blog cluster (~12). |
| `inform_chunk` | Inform | `faqitem` (928 rows) + Swoop "Before you travel" pages (~15) + Guidebook practical subset (~30) + Month pages (9) + practical blog subset (~25). Plus chunks of trip-prose where useful. |
| `trip_card` | Propose options | Denormalised hero presentation of a trip: image, headline, vibe, headline price, region, duration. Internals settle once trips ingestion lands. |

Every derived row carries: id, source provenance (for debugging + retention rules), text, embedding, `ntag` ids[], plus job-specific structured fields. **Pages cited in derived rows expose `canonical_url`** (= `override_url || alias`) for "go see this page" affordances.

**Indexes:**
- `pgvector` HNSW on every `embedding` column (cosine distance default).
- `tsvector` GIN on every searchable prose column.
- `pg_trgm` GIN on every entity-name column we want fuzzy-matched (locations, vessel names, hotel names).
- B-tree indexes on the obvious query keys (`trip.region_id`, `daybyday.trip_id`, etc.).

**Schema migrations**: `node-pg-migrate` per C.18. Plain-SQL migrations under `product/ingest/migrations/`. No ORM.

**Local-dev parity**: Postgres 18 in Docker Compose for the handoff artefact. Al's direct Homebrew install works fine for individual dev velocity in the meantime; we add the `docker-compose.yml` before M5 ship so Swoop's team have a reproducible mirror.

**Pagetype mapping summary (decision C.29):**

| Pagetype | Pages | Treatment |
|---|---:|---|
| Guidebook | 87 | Inspire + Inform — split by ETL-time classification |
| Swoop | 43 | Reassure (sustainability/B-Corp/About slice) + Inform (Before-you-travel slice) — split by ETL-time classification |
| City | 23 | Inspire |
| Activity | 25 | Inspire + Inform |
| Region-Activity | 26 | Inspire + Inform |
| National Park | 16 | Inspire |
| Region | 16 | Inspire (filter test pages — C.28) |
| Parent Guidebook | 23 | Navigation hubs — skip unless leaf content is sparse |
| Partner | 9 | Reassure (partner credentials) |
| Experience | 9 | Inspire |
| Country | 3 | Inspire |
| Landmark | 1 | Inspire |
| Month | 9 | Inform (when-to-travel) |
| Profile | 40 | **Excluded** per C.27 |
| Accommodation, Parent Accommodation, Ship, Itinerary, Offer | 152 | Trip-side; not part of content-tool supply |
| Untyped (`pagetype_id IS NULL`) | 202 | Skip — most are CMS scaffolding/legacy

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
- **Swap-out surfaces named** (updated for new architecture): ETL source (low — `export.sql` is one file; rewrite when source changes); embedding model (low — one column to re-populate); storage engine (medium — see C.18 swap cost). Composer-layer LLM is no longer a swap surface (decision C.24 — composers removed); a future per-tool composer remains additively possible.

**Added for the new architecture:**

- **Intent-named tools at the top, data primitives underneath. Two-layer separation.** Tool names encode the *job* the agent is doing (`find_inspiring`, `find_proof`, `find_someone_who`, `lookup`, `find_options`); each handler calls SQL/vector primitives directly and returns concrete row-shaped output. Sonnet weaves; no LLM-in-the-middle. Per C.24/C.25.
- **Single derived store, hybrid retrieval**. No two-store synchronisation. `pgvector` + `tsvector` + `pg_trgm` in one engine, RRF in SQL.
- **Page-as-hub for cross-entity widget rendering**. Records with `page_id` traverse to `page` for both URLs and image sets. Uniform rule across hotel, location, trip, etc.
- **Page prose dominates content supply** (C.29). 482 content-relevant pages > 102 blog posts in volume *and* in on-message density. ETL tilts capacity toward page extraction; blog supplements as narrative-rich complement.
- **Cheap LLM at ETL, not at query.** Where Haiku-style classification work earns its keep: blog-post job classification, persona-signal extraction from customer stories, image annotation, tag normalisation. Done once, persisted to columns. Not on the conversational path.

---

## 4. PoC carry-forward pointers

**Still useful — direct evolution:**

- `chatgpt_poc/product/mcp-ts/` — connector service base. `src/index.ts` (entry), `src/server.ts` (transport), `src/tools/` (one file per tool), `src/lib/` (helpers).
- `chatgpt_poc/product/mcp-ts/src/lib/mailer.ts` — nodemailer + SMTP pattern. Carry forward; swap target to Swoop's real endpoint via Secret Manager.
- `chatgpt_poc/product/ts-common/src/tools.ts` — tool-description and Zod schema pattern. The pattern carries; the actual tools are different (intent-named, not the PoC's seven).
- `chatgpt_poc/raw_data/swoop.components.json`, `swoop.templates.json` — real PoC sample data shapes. Useful reference for fixture authoring during dev.

**Pattern reference only — backends totally different:**

- `chatgpt_poc/product/mcp-ts/src/lib/component-search.ts`, `image-search.ts`, `data-loader.ts` — local-embedding patterns. Reference for interface shape; the actual implementation is now Postgres pgvector + tsvector hybrid retrieval.

**Superseded by SQL-dump ETL:**

- `chatgpt_poc/product/scripts/build-library.ts`, `build-image-catalogue.ts` — PoC ingestion scripts (MongoDB-dump transformers). Goal carries (idempotent, re-runnable ingest); shape is replaced by the new SQL-dump → Postgres transform + an embedding pass.

---

## 5. Decisions closed in this chunk

The following decisions are pinned at chunk-C scope. C.18 has landed in [decisions.md](decisions.md). Decisions marked ⏳ in earlier revisions of this plan have since landed in `decisions.md` (C.13–C.23 inclusive). The 2026-04-29 review adds C.24–C.29.

| # | Decision | Status | Rationale |
|---|---|---|---|
| C.1 | ~~Data access strategy: scrape vs API~~ | **SUPERSEDED** by C.21 | The 2026-04-27 SQL dump replaces both candidate paths. |
| C.2 | ~~Search backend: Vertex AI Search~~ | **SUPERSEDED** by C.18 | Postgres + pgvector + tsvector + pg_trgm covers the same retrieval needs at our scale, single-store. |
| C.3 | Image retrieval path | **REVISED** (2026-04-29 reaffirmed): single annotated `image` table with flexible canonical URL (source-of-truth doesn't matter once normalised). Imgix push remains a separate ops choice; not architecturally load-bearing. |
| C.4 | Connector transport: MCP over HTTP | **STANDS**. `@modelcontextprotocol/sdk` streamable HTTP. PoC pattern, Swoop has seen it, standard. |
| C.5 | ~~Tool set evolved from PoC 7~~ | **SUPERSEDED** by C.25 | Eight intent-named tools (five conversational jobs + illustrate + handoff pair) replace both the PoC seven and the 2026-04-28 ten-tool sales-shaped/composer surface. |
| C.6 | Ingestion cadence: manual / on-demand during M1–M3 | **STANDS**. Schedule via Cloud Run Jobs + Cloud Scheduler post-M4. Steady state TBC with Swoop ops. |
| C.7 | ~~Deep-link URL generation: pending scrape vs API~~ | **CLOSED**: rule is `override_url \|\| alias`, applied at ETL time. | Resolved 2026-04-27. |
| C.8 | Mongo access: not in scope | **STANDS**. |
| C.9 | Embedding / reranking | **REVISED**: Voyage-3 leaning (formal lock pending in `questions.md`). Reranking via RRF in SQL across pgvector + tsvector. |
| C.10 | Image annotation pipeline | **STANDS**. Storage on `image` derived table columns. Cost flag (~£100–£300 one-time for 13K images). |
| C.11 | Modular-guidance loader | **STANDS**. ADK-native skill primitive (B.t9 wires; G.t3 authors content under `cms/prompts/skills/` per G.11). |
| C.12 | Derived-datasource terminology | **STANDS**. Even more apt with the Postgres + ETL setup. |
| C.13 | Sales-funnel "golden thread" | **LANDED** in decisions.md (2026-04-28). |
| C.14 | No departures, no swoopers, headline pricing only | **LANDED** in decisions.md (2026-04-28). |
| C.15 | URL + image construction rules | **LANDED** in decisions.md (2026-04-28). |
| C.16 | Page-as-hub pattern for cross-entity rendering | **LANDED** in decisions.md (2026-04-28). |
| C.17 | `ntag` is the live tagging system; `tag` + `adventurousness` deprecated | **LANDED** in decisions.md (2026-04-28). |
| C.18 | **Postgres 18 + pgvector + tsvector + pg_trgm; no Vertex** | **LANDED** (2026-04-28). |
| C.19 | ~~Sales-shaped tool surface (10 tools); composer pattern~~ | **SUPERSEDED** by C.25 (2026-04-29). Eight intent-named tools, no composer. |
| C.20 | Blog ingest as separate stream via WP REST API; 5y fetch-time-filtered window | **LANDED** in decisions.md (2026-04-28); plan at [03-exec-blog-ingest.md](03-exec-blog-ingest.md). |
| C.21 | Source = SQL dump → transform → Cloud SQL Postgres (canonical pipeline; the dev-time MariaDB-load step from C.t0 is closed) | **LANDED** in decisions.md (2026-04-28); summary reframed 2026-04-29 to drop the no-longer-relevant MariaDB step from the canonical pipeline. |
| C.22 | ~~Composer pattern: per-tool Haiku sub-agent~~ | **SUPERSEDED** by C.24 (2026-04-29). No composer at query path; cheap-LLM moves to ETL. |
| C.23 | Firestore dropped project-wide | **LANDED** in decisions.md (2026-04-28). |
| C.24 ⏳ | **No composer layer**; tools are thin handlers over data primitives. Sonnet at orchestrator handles synthesis. Cheap LLM (Haiku) earns keep at ETL, not query. | New decision pending decisions.md entry. Replaces C.22. |
| C.25 ⏳ | **Five-jobs tool surface** (Inspire / Mirror / Reassure / Inform / Propose-options) → **eight tools**: `find_inspiring` / `find_someone_who` (conditional, see C.26) / `find_proof` / `lookup` / `find_options` / `illustrate` / `handoff` / `handoff_submit`. | New decision pending decisions.md entry. Replaces C.19. |
| C.26 ⏳ | **`customerreview` / `customertip` source tables dangling in dump** (PII redacted at export). `find_someone_who` ships only if Swoop provides a redacted export; otherwise dropped from Puma scope and revisited post-launch. | New decision pending decisions.md entry; Swoop ask captured in `questions.md`. |
| C.27 ⏳ | **Profile pagetype excluded** from ETL — 40 specialist staff bios, no fit for content-tool supply. May reappear if a future release wants "speak to specialist X" affordances. | New decision pending decisions.md entry. |
| C.28 ⏳ | **Test pages filtered** at ETL boundary. Heuristic: `WHERE alias NOT LIKE '%test%' AND title NOT LIKE '%Test %'`. Mechanical hygiene; no architectural significance. | New decision pending decisions.md entry. |
| C.29 ⏳ | **Page prose is the dominant content surface** for Inspire/Reassure/Inform jobs — ~2 MB page-level + ~2 MB contentblock prose across 482 content-relevant pages. Eclipses the blog (~6 MB sprawling) on density and on-message-ness. ETL capacity tilts page-first; blog supplements. | New decision pending decisions.md entry. |

---

## 6. Shared contracts consumed and produced

**Consumed (from `ts-common`):**

- Tool I/O schemas — the connector implements, validates inputs, serialises outputs. The 2026-04-29 revision **replaces** the 2026-04-28 ten-tool sales-shaped surface with the eight intent-named tools (C.25). Schemas authored at C.t2 for: `find_inspiring`, `find_someone_who` (conditional on C.26), `find_proof`, `lookup`, `find_options`, plus carried-forward `illustrate`, `handoff`, `handoff_submit`. Existing PoC `search` / `get_detail` Zod schemas in A.t2's `tools.ts` are deprecated alongside (their surface collapses into `lookup` / `find_options`).
- Content schemas (Trip, Tour, Hotel, Vessel, Location, Activity, FAQ, BlogPost, Page) — authored alongside the schema design (C.t2). Reflect dump reality + sales-funnel cuts (no departures, no swoopers, headline pricing).
- Job-shaped derived entity schemas (InspirePassage, CustomerStory *(conditional)*, TrustProof, InformChunk, TripCard) — authored as part of C.t2.
- Handoff payload (the `handoff_submit` tool produces an instance) — from chunk E (E.t1 already shipped).

**Produced (into `ts-common` or the connector's own boundary):**

- The connector's MCP endpoint contract — URL, auth, tool discovery shape. Consumed by chunk B's tool-connector adapter. **B.t3 already shipped against the existing 5 tools; B.t3a updates by replacing those wrappers with the new eight intent-named tool wrappers.** This is replace, not augment, because the 2026-04-29 surface deprecates `search` / `get_detail` (their surface collapses into `lookup` / `find_options`).
- The ETL's input contract — assumptions about the upstream schema shape (a MariaDB-format dump of the live Swoop CMS), column whitelists. Internal to the transform layer; doesn't leak past chunk C.
- Image URL construction utility — single function in `ts-common`, used by both the ETL and the data primitives.
- Page-as-hub resolver utility — single function `resolveImagesViaPage(record)` likewise.

---

## 7. Open sub-questions for Tier 3

Most data-pipeline questions closed by the dump inspection on 2026-04-27. Remaining:

- **Embedding model lock**: Voyage-3 vs alternative (Cohere, Anthropic, OpenAI). Probably Voyage-3; ten-minute decision when we wire the embed pass.
- **Annotation strategy**: full catalogue vs golden subset vs on-demand. Cost-driven decision; depends on whether `image.alt_text` is populated in the dump.
- **`tripvariant` semantics** (584 rows): what variants exist, do we surface variant differentiation? Inspection-driven; quick SELECT against the local MariaDB resolves it.
- **`season` semantics** (12 rows): date windows or named periods? Same — quick SELECT.
- **`daybyday` revision logic** (88K rows): how do we identify the canonical published version per trip? Same.
- **`contentblock` subtype triage** (post C.26): once Swoop confirm whether redacted reviews are coming, finalise which subtypes are kept (customerreview / customertip — conditional), which are dropped (navigationcard / settings / page cross-link), which need handling for prose-bearing variants (carousel / image captions).
- **SMTP provider specifics** (transactional email provider vs Swoop-owned SMTP) — Julie still pending.
- **Connector auth between orchestrator and connector** — none in Puma (both in the same VPC or Cloud Run with IAM), or token-based. Revisit at deploy.
- **Per-tool prompt prose** — each tool's description (the prose Sonnet reads to choose) is authored as part of C.t4. Lives in `cms/prompts/tools/<tool-name>/description.md` per G.11. Tool descriptions matter more without composers — they carry the conversational-moment cue Sonnet uses to pick the right tool.
- **ETL-time classifier prompts** — three Haiku-driven classifiers run at ingest: blog-post job-classifier (Inspire/Mirror/Reassure/Inform), persona-signal extractor for customer stories, image annotator. Each has a prompt; lives under `cms/prompts/etl/<classifier>/` (TBC structure, decided at C.t3a). Prompt design is empirical — start simple, tune from Al's review of classifier output on sample data.
- **Rate limiting / retry policies** — embedding API calls and ETL classifier calls both want sane backoff. Standard, but worth being explicit at C.t1.

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
- Eight-tool intent-named surface is a contract shared with B (via `ts-common`) — negotiate when authoring the schemas at C.t2.
- Image URL + page-as-hub conventions are contracts shared with D (widget rendering) — confirm during D Tier 3 re-pass.
- **Open Swoop dependency** — Al has asked Swoop for a redacted `customerreview` / `customertip` export (C.26). Outcome decides whether `find_someone_who` ships in Puma. Tracked in `questions.md`.

---

## 9. Verification

Chunk C is done when:

1. Data-connector service starts, registers the eight intent-named tools over MCP (or seven, if `find_someone_who` is dropped per C.26), responds to a discovery ping.
2. Each registered tool responds to a stubbed orchestrator call with schema-valid output from a fixture set.
3. Postgres derived store exists, populated by the ETL with at least the active Patagonia content (~hundreds of trips, ~thousands of CMS chunks, ~102 blog posts, ~482 content-relevant pages, ~928 FAQ items), and a sample query against each tool's data primitives returns plausibly-ranked results for 5 sample queries.
4. ETL runs idempotently (`export.sql` re-run produces no changes; embed pass re-run touches only changed-content rows).
5. `illustrate` returns working pre-rendered URLs at multiple variants; chat surface (D) confirms it can render them.
6. `handoff_submit` writes a record to the handoff store (chunk E) and sends a test email via real SMTP.
7. Tool responses carry deep-link URLs (`canonical_url`); chunk D confirms it renders them as clickable "go see this page" affordances.
8. Image annotation starter sample (~50 images) is queryable inline with image retrieval — `illustrate` responses carry annotation-derived alt text and tags.
9. Swoop's internal team can run the ETL from documented steps (the runbook).
10. ADK-native skill loader (B.t9) returns skill content from `cms/prompts/skills/<skill-name>/SKILL.md` for valid skill names; returns empty/not-found for unknown skills.
11. ETL classifier runs are observable: blog-post job-classifier outputs are reviewable by Al on sample data; classifier prompt iteration loop works.
12. `docker-compose.yml` provisions Postgres 18 with `pgvector` + `pg_trgm` + FTS extensions; the ETL runs against it identically to local Homebrew Postgres.

---

## 10. Order of execution (Tier 3 hand-off)

> **Note on numbering**: Tier 3 task numbers are **immutable**. The 2026-04-29 revision keeps every C.t number and updates the *contents* of any task whose specifics were tied to the now-superseded composer pattern. Where a task's identity has changed substantially (no longer the same task), it's marked **DEPRECATED** in place and a new task is added with a new number.

- **C.t0 — SQL-dump load + clarifying SELECTs** (in flight 2026-04-28; broadened 2026-04-29). Load dump into local MariaDB. Original SELECT scope: `tripvariant` / `season` / `daybyday` / `currency` / `adventurousness` (deprecated, confirm) / `contentblock_*` subtypes. **Updated 2026-04-29**: also explicitly verifies the dangling `customerreview`/`customertip`/`pressreview` source tables (decision C.26), audits pagetype distribution (input to C.27 + C.29), confirms `ntag` taxonomy shape, and inventories prose volume per pagetype. Updates `data-ontology.md` with `S-SQLDUMP-2026-04-27` source tag.
- **C.t1 — Connector service skeleton + Postgres setup**: Cloud Run-ready Express + MCP SDK; Postgres 18 + extensions provisioned (Cloud SQL for prod, Docker Compose for handoff parity); health endpoints; service-account wiring. **Greenfield** — `product/connector/src/` is empty today.
- **C.t2 — Entity model + tool surface schemas** (revised 2026-04-29): design Postgres schema (domain entities + job-shaped derived entities per §2.5) + `ts-common` tool I/O schemas for the eight intent-named tools (C.25). **Both layers co-define each other.** Lands as a single Tier 3 plan. Replaces shipped A.t2 schemas: `product/ts-common/src/tools.ts` is **rewritten** to drop `search` / `get_detail` (their surface collapses into `lookup` / `find_options`) and to add `find_inspiring`, `find_someone_who` (conditional on C.26), `find_proof`, `lookup`, `find_options`. `illustrate`, `handoff`, `handoff_submit` carry forward. Old `Sample*` fixtures retire alongside the deprecated tools; new fixtures added for the new derived entities (InspirePassage, CustomerStory, TrustProof, InformChunk, TripCard).
- **C.t3 — ETL: SQL dump → Postgres transform** (data-shape transformation): declarative transformations whitelist tables, flatten, denormalise, compute derived columns. Filters at boundary: Profile pagetype excluded (C.27), test pages excluded (C.28). Populates `canonical_url` (`override_url || alias` per C.15). Tooling pick (e.g. `pgloader` + a SQL transform layer, or a Node CLI translator) lands at C.t3 design time. Plus the orchestrator CLI that runs the pipeline + idempotent re-run. **Pure data movement + structural transformation; no LLM in the loop at this stage.** **Greenfield** — no existing ETL code.
- **C.t3a — Embedding pass + blog post-processing + ETL classifiers** (revised 2026-04-29): three related sub-tasks running off C.t3's output and the blog snapshot:
  - **Per-entity chunking strategy** — decide chunk granularity per entity type (Trip prose: per day-by-day day; CMS contentblock: per block; page intro_text + summary: as-is; page contentblock prose: per block, optionally split on `subheading`; blog post: per `<h2>`/`<h3>` section, sliding-window fallback).
  - **Embed prose fields** — Node CLI reads Postgres tables (post-C.t3) and the blog NDJSON snapshot, chunks per entity strategy, calls Voyage-3 (or whichever embedding model is locked) in batches, populates `embedding` columns + `content_hash` for idempotency. Re-running embeds only rows whose `content_hash` has changed since the last run. **Plus**: embeds the 79 active `ntag` rows (one-time, near-zero cost).
  - **ETL classifier passes** (Haiku-driven, the cheap-LLM-at-ETL pattern from §2.3): blog-post job classifier (Inspire/Mirror/Reassure/Inform/none); persona-signal extractor for customer stories (solo/family/age band/motivation tag); blog-tag normaliser against `ntag`. Each runs once per content_hash change and writes structured columns the tools query against.
  - **Populate job-shaped derived entities** — `inspire_passage` / `customer_story` *(conditional)* / `trust_proof` / `inform_chunk` populated by composing page chunks + blog chunks + CMS contentblocks via SQL after embedding + classification.
  - **Greenfield**. Sized at ~1.5–2.5 days for the embedding + classifier plumbing; cost driven by content volume (back-of-envelope: ~10K CMS chunks + ~102 blog posts × ~5 chunks each + page chunks ≈ ~12K embedding calls; Voyage-3 at ~$0.02/M tokens is cents. Haiku classifier passes ≈ ~200 LLM calls — cheap).
- **C.t4 — Tool implementations** (revised 2026-04-29): handlers + data primitives for all eight intent-named tools (C.25). **No composer code, no `src/composers/` directory.** Per-tool tests against fixture data primitives. Replaces shipped fixtures: `product/orchestrator/test-fixtures/stub-connector.ts` retires alongside the deprecated PoC tools' fixtures. **Triggers downstream replacements** in chunks B and D — see "Downstream replacements" below.
- **C.t5 — Image URL utility + page-as-hub resolver**: small `ts-common` utilities used by both the ETL and the data primitives. **Greenfield**.
- **C.t6 — Image annotation pipeline** (parallel workstream, starts early): Claude-vision extraction job, starter-sample run, annotation columns populated on `image` derived table. Full-catalogue run before production traffic. **Greenfield**.
- **C.t7 — URL surfaces (absorbed)**: the prior plan's "deep-link URL handling" task is now distributed across C.t3 (`canonical_url` derived from `override_url || alias` at ETL time) and C.t5 (image-URL utility). No standalone task — slot retained for numbering continuity with the [archived original](archive/02-impl-retrieval-and-data-pre-postgres-rewrite.md).
- **C.t8 — ETL + annotation runbooks for Swoop**: documented operating steps, handover notes, `docker-compose.yml`, IAM checklist. **Greenfield**.

**Parallel stream — Blog ingest** (no C.t number): per [03-exec-blog-ingest.md](03-exec-blog-ingest.md). Runs independently of the SQL-dump ETL. Can start at any time once C.t0 closes — doesn't block any C.t task. Output feeds C.t3a's embedding + classifier pass and the `inspire_passage` / `customer_story` / `trust_proof` / `inform_chunk` derived entities.

**Downstream replacements triggered by C.t2 + C.t4** (live in their owning chunks, not in C):
- **B.t3a — Connector adapter replace** (revised 2026-04-29; was "augment"): rewrites `product/orchestrator/src/connector/tools.ts` to register ADK FunctionTool wrappers for the eight intent-named tools (C.25). The five PoC-derived wrappers (`search`/`get_detail`/`illustrate`/`handoff`/`handoff_submit`) collapse: `illustrate`/`handoff`/`handoff_submit` survive intact; `search`/`get_detail` are deprecated alongside. Validates against the new Zod schemas in `@swoop/common`. Gated on C.t2 (new schemas) + C.t4 (real implementations).
- **D.t9 — Widget replace** (revised 2026-04-29; was "augment"): adds new widgets in `product/ui/src/widgets/*` for the new tool outputs — likely a vibe-passage panel for `find_inspiring`, a story-vignette card for `find_someone_who`, a proof carousel for `find_proof`, a chunk-list for `lookup`, an options-card-set for `find_options`. The existing 4 PoC widgets (`component-list`, `component-detail`, `inspiration`, `lead-capture`) deprecate alongside `search`/`get_detail` (their consuming tools); only `inspiration` and `lead-capture` survive (rendering `illustrate` and `handoff` respectively). Gated on C.t2 (schemas) + C.t4 (real outputs).

**Parallelisation:**
- C.t0 (dev-time inspection) closed before C.t1 (connector + Postgres setup); the two were sequential historically because the entity model design depended on inspection findings. Now closed; not a runtime dependency.
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

## Appendix: what changed from the 2026-04-22 draft (then 2026-04-28, then 2026-04-29)

For continuity with anyone reading the archived original or the 2026-04-28 rewrite — the high-level shifts.

**2026-04-28 (vs 2026-04-22):**
- **Backend**: Vertex AI Search → Postgres 18 + pgvector + tsvector + pg_trgm (C.18).
- **Source**: scrape-vs-API hackathon → SQL dump as canonical (C.21).
- **Tool surface (later superseded)**: PoC's five **woven with** five new sales-shaped composer tools (10 tools total). C.19.
- **Composer pattern (later superseded)**: Haiku sub-agents inside the connector. C.22.
- **Storage layer**: Cloud Storage landing zone → direct MariaDB-to-Postgres ETL.
- **CMS structure**: monolithic system prompt → `cms/prompts/{system,skills,tools}/` per G.11.
- **Image handling**: "media library access TBC" → deterministic imgix URL construction + page-as-hub pattern.
- **Pricing**: implied ranges → headline `from_price` only (per Julie call 2026-04-27).
- **Pruning**: no departures, no swoopers (customer PII), no `tag` system (`ntag` is live), no `adventurousness` (deprecated).

**2026-04-29 (data-review pass against the loaded dump and ingested blog):**
- **Tool surface (canonical)**: ten-tool sales-shaped + composer surface → **eight intent-named tools, no composer**. C.25 supersedes C.19. C.24 supersedes C.22. The conversational tool surface now matches the **five jobs** (Inspire / Mirror / Reassure / Inform / Propose-options) plus carried-forward `illustrate` + handoff pair.
- **Cheap LLM moves to ETL**: Haiku-driven classifiers run at ingest (blog-post job classification, persona-signal extraction, tag normalisation, image annotation). Done once, persisted to columns.
- **Customer-review supply correction**: `contentblock_customerreview` (2,390) and `contentblock_customertip` (119) are pure junctions; source tables are *not in the dump* (PII redaction). Added decision C.26: ask Swoop for redacted export; `find_someone_who` ships only if granted.
- **Page prose dominance**: 482 content-relevant pages contribute ~2 MB page-level + ~2 MB contentblock prose, eclipsing the 6.3 MB blog corpus on density and on-message-ness. Decision C.29.
- **Profile pagetype dropped**: 40 specialist staff bios excluded from ETL. Decision C.27.
- **Test pages filtered**: ETL boundary heuristic. Decision C.28.
- **`ntag` is small + clean + typed**: 79 active tags across 5 dimensions. Embed once at ETL; visitor utterance → tag mapping is near-free.

The foundations of the prior plan — disposable ETL, derived-datasource framing, Swoop hand-off clarity, image annotation as a parallel workstream, deep-link URLs as a UX affordance, the connector's MCP-over-HTTP transport, the SMTP-based handoff path — all carry forward unchanged. The 2026-04-29 revision is a tool-surface and content-supply correction, not an architectural one.

---

## 2026-05-12 — Embeddings provider swap + sync enrich mode

Two infrastructure changes landed post chunk-C closure:

- **Embeddings**: Voyage-3 / `vector(1024)` → **Gemini-embedding-001 / `halfvec(3072)`** via the Google AI Studio API key route. Decision **[C.46](decisions.md#c46)** supersedes the Voyage-3 sub-bullet inside C.18; the storage-engine decision (Postgres + extensions + Cloud SQL posture) is untouched. The `halfvec` storage type is used because pgvector's HNSW index has a hard 2000-dimension cap on the `vector` type; `halfvec` lifts that to 4000 with negligible recall loss. New plan: **[03-exec-c-t9.md](03-exec-c-t9.md)**. Migration **009** is the column drop + re-add at the new type. C.t9's HITL ratification + execution-deviations log records the halfvec finding in full.

- **Sync enrich mode**: a `--sync` CLI flag on the enrich runner routes classifier passes through Anthropic's synchronous `messages.create` API instead of the Batches API. Decision **[C.47](decisions.md#c47)** is a deliberate carve-out from HITL Q4's batch lock for dev-iteration loops (the 24h batch SLA is fine for production runs, prohibitive for prompt-tweak debugging). Production continues to default to batches. New plan: **[03-exec-c-t10.md](03-exec-c-t10.md)**. A sibling task for synchronous image annotation is deferred to a later plan (`03-exec-c-t11.md` or similar) — an initial complete sync run uses two parallel shells.

Neither change touches the tool surface, the eight intent-named tools, the five derived tables, the chunk-C top-down-from-sales discipline (theme 11), or the connector's transport. They are surface-level swaps to the embedding provider and the enrich CLI shape only.
