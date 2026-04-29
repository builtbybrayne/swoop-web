# 03 — Execution: C.t2 Entity model + tool surface schemas

**Status**: Tier 3 execution plan. Draft, 2026-04-29.
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §10 — the **C.t2** task ("Entity model + tool surface schemas"). Operationalises decisions C.18, C.24, C.25, C.26, C.27, C.28, C.29 + the eight-tool intent-named surface from §2.2 + the entity model from §2.5.
**Depends on**: C.t0 closed (dump understood); A.t1–A.t5 (workspace, ts-common scaffold, decision log); chunk-C plan revision 2026-04-29 landed.
**Blocks**: C.t3 (`export.sql` reads the migrations to know what tables to populate); C.t3a (embedding pass writes to columns this task defines); C.t4 (tool implementations validate against the Zod schemas this task authors); B.t3a (orchestrator's connector adapter wraps the tool I/O schemas this task authors); D.t9 (widgets render the output schemas this task authors).
**Produces**:
- Postgres migrations under `product/connector/migrations/` — domain entity tables + five job-shaped derived tables + indexes.
- Updated `product/ts-common/src/tools.ts` — eight intent-named tool I/O schemas (replaces the shipped 5-tool A.t2 surface; deprecated tools marked `@deprecated` with sunset note pointing to B.t3a).
- New `product/ts-common/src/derived.ts` — Zod schemas for the five job-shaped derived entities (InspirePassage, CustomerStory, TrustProof, InformChunk, TripCard).
- Updated `product/ts-common/src/index.ts` — exports for everything authored.
- Fixtures under `product/ts-common/src/fixtures/` — at least one valid instance for every tool I/O pair and every derived entity. New fixtures added; deprecated tool fixtures retire alongside the schemas (in B.t3a, not here).
- Tool description prose at `product/cms/prompts/tools/<tool>/description.md` — one folder per intent-named tool, each containing a description.md (1–3 paragraphs, production first-pass — ship-ready as-is), per G.11 conventions.
- Decision log entries (`planning/decisions.md`) — any C.t2-specific decisions taken during execution (column shapes, fixture conventions, persona-signal column types, etc.).
**Estimate**: ~1.5–2 days of focused work. Most cost is in deciding column shapes correctly (especially for `customer_story` persona-signal columns) and authoring tool descriptions that encode conversational intent well.

---

## ★ Read this first — the WHY of chunk C, the design discipline of C.t2

> **Before you touch a Zod schema or a CREATE TABLE statement, read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"Read this first — the WHY of chunk C" end-to-end.** That section names the agent's actual job, the four+1 jobs the data does, the design discipline (top-down from sales, not bottom-up from data), and how the eight-tool surface falls out. It's the calibration layer for everything in this task. Multiple Claude sessions have walked into bottom-up reasoning on this engagement; that section is the antidote.

The compressed reminder for C.t2 specifically:

- **The agent moves appropriate visitors through Awareness → Interest → Strong Consideration toward a warm specialist handoff.** That's the entire mandate. Decision C.13.
- **At every conversational moment, content is doing one of four jobs**: Inspire, Mirror, Reassure, Inform. Plus a fifth, structural: Propose options. These are the substrate. Schemas and tools fall out of them; never the other way.
- **C.t2 is a contract task.** The migrations and Zod schemas you ship here are what every downstream task consumes (C.t3, C.t3a, C.t4, B.t3a, D.t9). The contract being right matters more than the contract being elaborate.
- **The bar for tool descriptions is "production first-pass" — ship-ready.** Each `cms/prompts/tools/<tool>/description.md` carries the load that the now-removed composer pattern used to carry: it tells Sonnet *when in the conversation* to reach for this tool. That work is voice-shaped, not technical-shaped. Take it seriously.
- **If you find yourself reasoning "we have data X, so we should expose tool Y", stop and re-anchor.** The right question is: *whose journey am I serving, and at what point in it?* If you can't answer concretely from the conversational arc, you're going bottom-up. Re-read the §"Read this first" in the Tier 2 plan and try again.

This task ships exactly what the Tier 2 plan has settled — eight intent-named tools, five job-shaped derived tables, the persona-summary natural-language shape (C.30), forward-only migrations. **Don't add tools, don't add derived tables, don't add columns the Tier 2 plan didn't name unless you can justify the addition by which job it serves and which conversational moment it shows up in.** "But the data is there" is not a justification.

---

## Purpose

C.t2 is **the substantive new artefact** for chunk C. Both layers — the Postgres schema for the derived store, and the `ts-common` Zod schemas for the tool surface — co-define each other. Designing them together as a single task avoids the "schema in flight while tools assume something" failure mode that bit the 2026-04-22 plan.

What lands in this task is the **contract** every other C.t* task consumes: what columns get populated (C.t3 + C.t3a), what shape tools return (C.t4 + B.t3a), what shape widgets render (D.t9). Get this right and downstream tasks are mostly mechanical; get it wrong and they all need rework.

The 2026-04-29 chunk-C revision narrowed the scope: eight tools, no composer, page-prose dominance, customerreview conditional, Profile excluded, test pages filtered. Those constraints make C.t2 simpler than the 2026-04-28 ten-tool composer plan would have been.

### What the connector package is now (post-composer)

Because the 2026-04-28 chunk-C plan put Haiku composers inside the connector, it's worth being explicit about what `product/connector/` actually owns post-C.24. The composer-shaped scope was *handlers + composers + data primitives + MCP transport + mailer*. C.24 removed composers; the package's reason to exist is intact, just thinner:

- **MCP-over-HTTP service**. The orchestrator (chunk B) speaks MCP, not SQL. The connector exposes the eight tools over MCP and translates tool calls into data fetches. Same Express + `@modelcontextprotocol/sdk` runtime as the PoC.
- **Tool handlers**. One file per tool at `src/tools/<tool>.ts` — input validation → 1–N data primitive calls → output validation → return. No `src/composers/` directory; no Haiku in the request path.
- **Data primitives**. SQL/vector helpers at `src/data/<primitive>.ts`. The connector's actual brain.
- **Postgres connection pool ownership**. Connector owns the runtime pool; nothing else in the workspace talks to Postgres at runtime (ETL is a one-shot job, not a service).
- **Postgres schema ownership**. Migrations live at `product/connector/migrations/`. ETL (C.t3) writes against the same schema but doesn't own it.
- **Handoff email delivery**. The `handoff_submit` tool's outbound SMTP path lives here per E.11.

The package is one of the two Cloud Run services Puma deploys (orchestrator is the other). Same as the 21 Apr meeting decision.

---

## Out of scope

Name it so future agents don't drift:

- **No `export.sql` authoring** — that's C.t3 (this task ships migrations, not the data movement).
- **No embedding pass, no tag normalisation, no Haiku classifiers** — that's C.t3a.
- **No tool handler implementations or data primitives** — C.t4 (this task ships *contracts*; C.t4 ships behaviour).
- **No connector adapter changes in `product/orchestrator/`** — B.t3a (gated on C.t2 + C.t4; this task only updates `ts-common`).
- **No widget React code** — D.t9 (gated on C.t2 + C.t4; this task only updates schemas).
- **No final voice-pass refinement of tool descriptions** — C.t2 ships production first-pass that can go to users today; G.t1/G.t5 only revisits if real conversations or the Luke + Lane sales-thinking doc prompt a tweak. The substance is C.t2's; the optional polish is G's.
- **No image annotation pipeline code** — C.t6.
- **No trip-side tooling work** — Al's instruction: leave the trip side alone until trips ingestion is genuinely understood. This task ships TripCard as a placeholder shape (id, image, headline, vibe-line, region, headline price, duration); the exact column list firms up when trips ingestion lands.
- **No deletion of deprecated `search` / `get_detail` schemas** — they get marked `@deprecated` here; their actual removal is B.t3a's call when it rewrites the connector adapter. Removing them in C.t2 would break the orchestrator immediately.

---

## Inputs (files to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) — especially §2.2 (tool surface), §2.4 (data primitives), §2.5 (entity model + pagetype mapping), §5 (decisions table).
- [`decisions.md`](decisions.md) — C.13 (golden thread), C.14 (no departures / headline pricing only), C.15 (URL + image construction), C.16 (page-as-hub), C.17 (`ntag` live), C.18 (Postgres + extensions), C.24 (no composer), C.25 (eight-tool surface), C.26 (customerreview conditional), C.27 (Profile excluded), C.28 (test pages filtered), C.29 (page prose dominant).
- [`data-ontology.md`](../data-ontology.md) — entity inventory + URL/imgix patterns.
- [`questions.md`](../questions.md) "Data pipeline" section — open Swoop dependencies.
- `product/ts-common/src/tools.ts` (current state) — the shipped 5-tool surface that this task supersedes for content tools.
- `product/ts-common/src/index.ts` (current state) — to know what to re-export.
- The loaded MariaDB dump (`mariadb swoop_patagonia`) — for any column-shape question that's faster to answer with `DESCRIBE` than to design from the plan.

---

## Outputs (files to write/modify, with paths)

### Postgres migrations

`product/connector/migrations/` (new directory, plain SQL, `node-pg-migrate`-compatible):

| File | Contents |
|---|---|
| `001_extensions.sql` | `CREATE EXTENSION IF NOT EXISTS pgvector; pg_trgm; btree_gin;` etc. |
| `002_domain_tables.sql` | Domain entity tables: `trip`, `tour`, `tour_item`, `hotel`, `hotel_pricing`, `hotel_room`, `vessel`, `cabin`, `cabintype`, `location`, `area`, `country`, `activity`, `faqitem`, `image`, `page`, `contentblock`, `chunk`, `tag` (a derived row per `ntag`, with embedding column), `blog_post`, `blog_chunk`. Mostly 1:1 with the dump's source post-cleanup. Drop audit/soft-delete/PII columns; keep `canonical_url` (`override_url \|\| alias`) on `page` and `trip`. |
| `003_derived_tables.sql` | The five job-shaped derived tables: `inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`. See §"Schema design — Postgres" below for column lists. |
| `004_indexes.sql` | All HNSW (pgvector), GIN (tsvector + pg_trgm), B-tree indexes per the chunk-C plan §2.5. |
| `005_canonical_url_function.sql` | A SQL function `canonical_url(override_url, alias)` returning `COALESCE(override_url, alias)` so derived-row population is consistent. Trivial but having it as a function rather than scattered CASE statements keeps `export.sql` clean. |

Migrations are ordered numerically; up-only at this stage (no down-migrations) — the derived store is throwaway by design (theme 5).

### `ts-common` Zod schemas

`product/ts-common/src/tools.ts` — **rewrite**:
- KEEP existing exports: `IllustrateInputSchema`, `IllustrateOutputSchema`, `HandoffInputSchema`, `HandoffOutputSchema`, `HandoffSubmitInputSchema`, `HandoffSubmitOutputSchema`, `TOOL_DESCRIPTIONS`. Update `TOOL_DESCRIPTIONS` map to add new entries.
- DEPRECATE: `SearchInputSchema`, `SearchOutputSchema`, `SearchHitSchema`, `GetDetailInputSchema`, `GetDetailOutputSchema`. Mark each export with `@deprecated since 2026-04-29 — superseded by lookup / find_options. Removed in B.t3a.` JSDoc. Don't delete (orchestrator still imports them; B.t3a removes when it rewrites the adapter).
- ADD new tool I/O pairs (one for each):
  - `FindInspiringInputSchema` / `FindInspiringOutputSchema`
  - `FindSomeoneWhoInputSchema` / `FindSomeoneWhoOutputSchema` *(conditional — see §"Conditional shipping" below)*
  - `FindProofInputSchema` / `FindProofOutputSchema`
  - `LookupInputSchema` / `LookupOutputSchema`
  - `FindOptionsInputSchema` / `FindOptionsOutputSchema`
- ADD a `TOOL_NAMES` exported const enum-shaped object (`{ FindInspiring: "find_inspiring", ... }`) so handler files don't stringly-typed tool names.

`product/ts-common/src/derived.ts` (new file) — Zod schemas for the five job-shaped derived entities:
- `InspirePassageSchema`
- `CustomerStorySchema` *(conditional)*
- `TrustProofSchema`
- `InformChunkSchema`
- `TripCardSchema`

Each derived row carries: id, source_provenance (an enum: `page` / `blog` / `contentblock` / `chunk` / `trip` / `customerreview` etc.), source_id (the original row's id), text (chunk content), `canonical_url`, `ntag_ids[]`, plus job-specific fields (see §"Schema design — `ts-common` Zod").

`product/ts-common/src/index.ts` — re-export everything from `tools.ts` and `derived.ts`. Keep the existing exports working.

### Fixtures

`product/ts-common/src/fixtures/` — one fixture file per new tool I/O + each derived entity. Pattern: `fixtures/find_inspiring.ts` exports `findInspiringInputFixture`, `findInspiringOutputFixture` (each a Zod-validated, schema-round-trippable instance). Fixtures must be plausibly realistic (real-feeling Patagonia content) so downstream tests pass meaningful assertions; **invented detail is acceptable** at this stage (matches G.5 outcomes scope) — real content lands in C.t3a.

Existing fixtures (`Sample*` for the deprecated tools) carry forward unchanged — their removal is B.t3a.

### Tool descriptions (production first-pass)

`product/cms/prompts/tools/<tool>/description.md` — one folder per intent-named tool:
- `product/cms/prompts/tools/find_inspiring/description.md`
- `product/cms/prompts/tools/find_someone_who/description.md`
- `product/cms/prompts/tools/find_proof/description.md`
- `product/cms/prompts/tools/lookup/description.md`
- `product/cms/prompts/tools/find_options/description.md`

The carried-forward tools (`illustrate`, `handoff`, `handoff_submit`) keep their existing description files if any; check `cms/prompts/tools/` for prior content.

Each `description.md` is **production first-pass** — substance complete, voice on-brand-enough to ship as-is to real users. 1–3 paragraphs that:
1. Name the *conversational moment* the tool serves (when in the journey).
2. State the *job* the tool does for the visitor (in plain prose, not jargon).
3. Name the *output shape* in one sentence so Sonnet knows what to expect.
4. Include a "**when to pick this**" line in italics that contrasts it against the other tools (esp. `lookup` vs `find_inspiring` — the one most likely to be confusable).

This is the surface Sonnet uses to choose tools. **It carries the load that the composer pattern previously tried to carry inside the tool.** Get this right and the eight-tool surface works; get it wrong and Sonnet picks the wrong tool. The raison d'être of each tool is intrinsic to its existence — that knowledge is settled now (decisions C.24 + C.25) and lives in the description from day one.

G.t1 / G.t5 stay in scope only as a *refinement* loop: if real conversations or the Luke + Lane sales-thinking doc reveal a Patagonia-specific tweak the C.t2 pass missed, refine then. C.t2's bar is "would Al sign off on this shipping today?" — not "is this Al-voiced perfection?" The latter is reasonable to refine; the former is the floor.

### Decision log

`planning/decisions.md` — any C.t2-specific decisions taken during execution. Likely candidates:
- **C.30** *(settled pre-task, recorded as the canonical entry by C.t2 at execution time)* — `customer_story` persona-signal shape: natural-language `persona_summary` TEXT + `persona_embedding` vector, no structured columns or JSONB blob. Haiku writes a 1–3 sentence persona description per row at ETL; the Mirror tool finds matching customers via cosine similarity on the embedding. Aligns with C.24's "cheap LLM at ETL, embeddings + Sonnet at runtime" stance. Land the entry in `decisions.md` when authoring this task's migrations.
- **C.31** *(if needed)* — Migration numbering convention. Recommend zero-padded `001_*` per the file plan above; record only if the executing agent picks something else.
- **C.32** — Whether the `tag` derived table includes both `ntag` rows AND legacy `tag` rows or only `ntag`. Per C.17, legacy `tag` is dead; recommend `ntag`-only. Record the call.

---

## Schema design — Postgres

### Domain entities (mostly 1:1 with the dump's source)

Column-list-only sketches; full DDL written into `002_domain_tables.sql`.

**`trip`** (post-cleanup):
- `id` (PK, from source)
- `slug`, `title`, `subtitle`
- `region_id`, `country_id`
- `duration_days`, `from_price` (computed at ETL time from `base_price` + currency normalisation per C.14), `currency_code`
- `description`, `includes`, `excludes`
- `accommodation_style` (enum), `adventurousness` (deprecated per C.17 — drop)
- `canonical_url` (computed: `override_url || alias` — but `trip` may not have those columns directly; depends on `page_id` join. C.t3 design call.)
- `ntag_ids[]` (array of int, FK to `tag` table)
- `image_id` (hero image)
- `created`, `modified` (kept for ETL diffs; not exposed to tools)
- DROP all `swooper_*` (C.14), audit columns, soft-delete columns, partner-PII columns

**`tour`**, **`tour_item`** — junction-flat per the dump's `tours` + `tour_items`.

**`page`** — the dominant content surface (C.29). After filtering Profile (C.27) + test pages (C.28) + accommodation/ship/itinerary/trip-anchored pagetypes:
- `id` (PK, from source)
- `pagetype_id`, `pagetype_title` (denormalised for query convenience)
- `title`, `alias`, `override_url`, `canonical_url` (computed)
- `intro_text`, `summary` (HTML prose — content surface)
- `image_id`, `bannerimage_id`
- `ntag_ids[]` (via `page_tag` flatten)
- `parent_id` (CMS hierarchy)

**`contentblock`** — flatten with subtype filter:
- `id`, `page_id`, `position` (ordering on the page)
- `subtype` (enum derived from which `contentblock_*` junction the row appears in: `customerreview`, `customertip`, `image`, `carousel`, `pressreview`, `partnercomment`, `tour`, `trip`, `when_to_travel`, `reviewcarousel`. SKIP `navigationcard`, `settings`, `page` — pure UI plumbing.)
- `title`, `subheading`, `text` (the prose-bearing fields)
- `image_id` (where applicable)
- `cta_text`, `cta_url`

**`chunk`** — 46 rows of small reusable CMS prose. Flatten as-is; type_id resolved via JOIN to its type table (or denormalised).

**`tag`** (derived from `ntag`):
- `id` (PK, mirror of `ntag.id`)
- `title`, `alias`, `type` (one of: `interest`, `area`, `activity`, `trip-type`, `style`)
- `embedding` (vector(1536) — populated by C.t3a)
- `is_active` (filter `is_active=1` at ingest)

**`image`** (per Al's 2026-04-29 spec):
- `id` (PK)
- `canonical_url` (TEXT — source of truth doesn't matter, just that the URL works)
- `alt_text` (TEXT — from source if present, else populated by C.t6 annotation)
- `description` (TEXT — populated by C.t6)
- `tags` (TEXT[] — annotation tags from C.t6)
- `embedding` (vector(1536) — populated by C.t6)
- `subject_tags`, `mood_tags`, `region_tags` (denormalised arrays for filter narrowing)
- `width`, `height`, `original_filename` (kept for debugging only; not exposed)

**`faqitem`**:
- `id` (PK)
- `title` (the question — column is named `title` in the source per C.t0 finding)
- `content` (the answer)
- `faqset_id`, `position`
- `embedding` (populated by C.t3a)

**`blog_post`**:
- `id` (PK, the WP post id)
- `slug`, `title`, `published_at`, `modified_at`
- `excerpt`, `content` (HTML, not chunked — chunks live in `blog_chunk`)
- `featured_image_url`
- `categories[]`, `tags[]` (raw blog tags, normalised against `ntag` at ETL)
- `ntag_ids[]` (post-normalisation)
- `canonical_url`
- `primary_job` (enum: `inspire`, `mirror`, `reassure`, `inform`, `multi`, `none` — populated by Haiku classifier in C.t3a)
- `secondary_jobs` (TEXT[]) — same enum, for posts that serve more than one
- `is_patagonia` (boolean — false for the Easter Island / Mendoza outliers; populated at ETL)

**`blog_chunk`**:
- `id` (PK)
- `blog_post_id` (FK)
- `chunk_index` (position within post)
- `text`
- `embedding`
- `content_hash` (for idempotent re-embedding)

(Other domain tables — `tour`, `tour_item`, `hotel`, `vessel`, `location`, `area`, `country`, `activity` — flattened straight from source, drop columns per C.14, add `canonical_url` where the entity supports deep linking. Trip-side tables stay thin pending trips ingestion.)

### Derived entities (the five job-shaped tables — what tools read from)

**`inspire_passage`** (Inspire job):
- `id` (PK, generated UUID)
- `source_provenance` (enum: `page_intro`, `page_summary`, `page_contentblock`, `blog_chunk`, `chunk`)
- `source_id` (id in the source table)
- `text` (the chunk's content, ready for inclusion in agent response)
- `canonical_url` (deep-link target — the page or blog URL)
- `ntag_ids` (int[])
- `region` (TEXT — derived from `ntag.area` overlap, denormalised for fast filter)
- `mood` (TEXT — optional, derived from blog tags or page subheading where extractable)
- `image_id` (FK to image; the hero/illustrative image to pair with this passage)
- `embedding` (vector(1536))
- `tsv` (tsvector — for hybrid retrieval)
- `content_hash` (for idempotent re-embedding)

**`customer_story`** *(conditional on C.26)* (Mirror job):
- `id` (PK, generated UUID)
- `source_provenance` (enum: `customerreview`, `customertip`, `blog_first_person`)
- `source_id`
- `text` (the story prose — anonymised at ETL ingest if customerreview source. This is what the agent SHOWS the visitor.)
- `canonical_url` (where applicable; null if redacted)
- `region` (TEXT — extracted; light filter for "show me solo travellers in Torres del Paine")
- `persona_summary` (TEXT — Haiku-generated natural-language description of the customer, ~1–3 sentences. Example: *"Sarah, mid-40s, solo traveller, post-divorce reset trip. Intermediate hiker, drawn to wildlife photography and accessible glaciers. Wanted quiet trails over W-trail crowds."* This is what the Mirror tool MATCHES against. Per decision C.30.)
- `persona_embedding` (vector(1536) — embedding of `persona_summary`. Cosine similarity against this is how `find_someone_who` finds matching customers.)
- `image_id` (FK; optional)
- `tsv` (full-text search on `text`, for keyword-matching topics across stories)
- `content_hash`

Note: there's no separate `embedding` column for the story text. Mirror's primary retrieval is persona-shaped, not topic-shaped — match the visitor's signal to a similar customer, then return that customer's story. If real conversations reveal we want topic-shaped retrieval over customer stories too (e.g. "show me stories about the W trail"), add a content `embedding` column at that point. Not before.

**`trust_proof`** (Reassure job):
- `id` (PK, generated UUID)
- `source_provenance` (enum: `swoop_page` (sustainability/B-Corp/About slice), `partner_page`, `blog_b_corp`, `pressreview` (conditional), `external_certification`)
- `source_id`
- `topic` (TEXT — what the proof is about: "sustainability", "b-corp", "expertise", "conservation", "safety", "guides", "satisfaction")
- `claim` (TEXT — the assertion: "Swoop is a certified B-Corp")
- `evidence` (TEXT — the supporting prose)
- `canonical_url`
- `embedding` (vector(1536))
- `tsv`
- `content_hash`

**`inform_chunk`** (Inform job):
- `id` (PK, generated UUID)
- `source_provenance` (enum: `faq`, `swoop_practical`, `guidebook_practical`, `month_page`, `blog_practical`, `trip_prose`)
- `source_id`
- `question` (TEXT — for FAQ-style sources; null otherwise)
- `text` (the prose answer)
- `canonical_url`
- `topic_tags` (TEXT[] — light categorisation: "transport", "weather", "packing", "money", "visa", etc.)
- `embedding` (vector(1536))
- `tsv`
- `content_hash`

**`trip_card`** (Propose options — surface settled, internals minimal pending trips ingestion):
- `id` (PK, mirror of `trip.id`)
- `slug`
- `headline` (TEXT — the trip's title)
- `vibe_line` (TEXT — one-line evocative pitch, computed at ETL)
- `region` (TEXT)
- `duration_days` (INT)
- `from_price` (DECIMAL)
- `currency_code` (TEXT)
- `image_id` (FK — hero image)
- `accommodation_style` (TEXT)
- `activity_tags` (TEXT[] — derived from `ntag.activity`)
- `canonical_url`
- `embedding` (vector(1536) — computed from `headline` + `vibe_line` + `description` for `find_options` filtering)
- `tsv`

### Indexes

`004_indexes.sql`:
- HNSW on every `embedding` column (cosine distance, default parameters; tunable post-launch).
- GIN on every `tsv` column.
- GIN on `image.subject_tags`, `image.mood_tags`, `image.region_tags` (array search).
- GIN on `blog_post.ntag_ids`, `page.ntag_ids` (array search).
- pg_trgm GIN on `location.name`, `area.name`, `country.name` (fuzzy match).
- B-tree on the obvious query keys: `inspire_passage.region`, `customer_story.region`, `trust_proof.topic`, `inform_chunk.topic_tags`, `trip_card.region`, `blog_post.primary_job`, `contentblock.page_id`, `contentblock.subtype`, `blog_chunk.blog_post_id`.
- B-tree on `*.content_hash` (for idempotent re-embedding lookups).

---

## Schema design — `ts-common` Zod

Rules of thumb for Zod authoring at this layer:
- Mirror Postgres column types closely. `int(11) unsigned` → `z.number().int().nonnegative()`. `vector(1536)` is **not** part of any tool's I/O — embeddings stay server-side.
- Strict object schemas (`.strict()`) where the wire shape is closed; permissive (`.passthrough()`) only when necessary (e.g. fixture round-trip from raw API responses).
- Every output schema has at least: `id`, `text` or equivalent, `canonical_url`, plus job-specific fields.
- Never leak debug fields (`source_provenance`, `content_hash`, `embedding`) to tool outputs unless the agent has a use for them — they're internal.

### Tool input schemas

Each tool's input is short — typically 1–4 fields. Examples (full DDL in code):

```ts
// find_inspiring
export const FindInspiringInputSchema = z.object({
  query: z.string().min(1).max(200),
  region: z.string().optional(), // matches ntag.alias on type='area'
  mood: z.string().optional(),
  limit: z.number().int().positive().max(8).default(4),
}).strict();

// find_someone_who (conditional on C.26)
export const FindSomeoneWhoInputSchema = z.object({
  signal: z.string().min(1).max(200), // free-text persona signal
  region: z.string().optional(),
  limit: z.number().int().positive().max(5).default(3),
}).strict();

// find_proof
export const FindProofInputSchema = z.object({
  concern: z.string().min(1).max(200),
  topic: z.enum(["sustainability","b-corp","expertise","conservation","safety","guides","satisfaction","other"]).optional(),
  limit: z.number().int().positive().max(5).default(3),
}).strict();

// lookup
export const LookupInputSchema = z.object({
  question: z.string().min(1).max(300),
  limit: z.number().int().positive().max(8).default(5),
}).strict();

// find_options
export const FindOptionsInputSchema = z.object({
  region: z.string().optional(),
  duration_min: z.number().int().positive().optional(),
  duration_max: z.number().int().positive().optional(),
  budget_band: z.enum(["budget","mid","premium","luxury"]).optional(),
  activity: z.string().optional(),
  accommodation_style: z.string().optional(),
  limit: z.number().int().positive().max(6).default(4),
}).strict();
```

### Tool output schemas

Each output is an array of derived-entity-shaped rows + a small metadata wrapper. Pattern:

```ts
export const FindInspiringOutputSchema = z.object({
  passages: z.array(InspirePassagePublicSchema), // strips internal fields
  count: z.number().int().nonnegative(),
}).strict();
```

Where `InspirePassagePublicSchema` is the tool-facing projection of `InspirePassageSchema` — drops `embedding`, `content_hash`, `tsv`, `source_provenance` (kept server-side); keeps `id`, `text`, `canonical_url`, `region`, `mood`, `image` (joined image record).

Same pattern for `FindSomeoneWhoOutputSchema`, `FindProofOutputSchema`, `LookupOutputSchema`, `FindOptionsOutputSchema`.

### Derived entity schemas (`derived.ts`)

Mirror the Postgres column lists exactly. Each schema has a `.public()` projection helper that returns the tool-facing subset.

---

## Conditional shipping — `find_someone_who`

Per C.26, this tool ships only if Swoop releases a redacted `customerreview`/`customertip` export.

**At C.t2 we author the schemas regardless** — `FindSomeoneWhoInputSchema`, `FindSomeoneWhoOutputSchema`, `CustomerStorySchema`, the `customer_story` Postgres table, the persona-signals JSONB column. The architecture supports the tool whether it ships or not; the schemas being present doesn't cost anything.

**What we DON'T do at C.t2**:
- Ship the production-quality tool description for `find_someone_who` to `cms/prompts/tools/find_someone_who/description.md`. A short placeholder is fine pre-decision; finalise when shipping is confirmed (so we don't sink time into authoring for a tool that may not ship).
- Wire the tool into `TOOL_DESCRIPTIONS` map as "live" — instead, mark it in a `CONDITIONAL_TOOLS` list with a comment pointing to C.26 + `questions.md`.

**Decision gate**: when Swoop responds to the customerreview ask:
- **If granted**: `find_someone_who` graduates to `TOOL_DESCRIPTIONS`; C.t3a populates `customer_story` with redacted prose; C.t4 implements the handler.
- **If denied or silent past M2**: tool drops; the schema files stay (cheap to leave behind, free for a future release that pivots to Trustpilot scrape or curated story library).

---

## Sub-step ordering (within this task)

Recommended sequence for a single execution agent:

1. **Read the inputs (§"Inputs" above) end-to-end.** Don't skim. The chunk-C plan §2.5 + decisions C.13–C.29 are load-bearing.

2. **Author migrations 001–005**, in order. Use `psql` (or `mariadb swoop_patagonia` for any column-shape sanity check) to verify each migration applies cleanly to a fresh Postgres locally. Note: Postgres doesn't need to be Cloud SQL for this task — local Homebrew Postgres or a Docker Compose Postgres is fine. The migration set is what matters, not where it ran.

3. **Author `derived.ts`** — the five job-shaped entity Zod schemas + their `.public()` projections.

4. **Update `tools.ts`** — mark deprecated, add new schemas, update `TOOL_DESCRIPTIONS`, add `TOOL_NAMES` const enum.

5. **Update `index.ts`** — re-exports for `derived.ts` and the new tool schemas.

6. **Author fixtures** — one valid instance per new tool I/O pair + each derived entity. Run the test runner to confirm Zod round-trips clean.

7. **Author `cms/prompts/tools/<tool>/description.md`** for the five intent-named tools. **Production first-pass** — substance complete, ship-ready as-is. Each file 1–3 paragraphs + a "when to pick this" italic line. Aim for "would Al sign off on this shipping today?" — voice can be refined in G.t1/G.t5 if real conversations later prompt a tweak.

8. **Take and log decisions** in `planning/decisions.md`. The settled-pre-task ones (C.30 persona-summary shape; forward-only migrations) get formal entries; any new calls taken during execution (e.g. C.31 migration numbering, C.32 tag-table scope) likewise.

9. **Run typecheck + lint + workspace test** from `product/`. All green before stopping.

10. **Append an "Execution log" section to this Tier 3 plan** summarising what landed, what was deferred, what surfaced as a question for downstream tasks.

---

## Verification

Task is done when:

1. `cd product && npm run typecheck` is green across the workspace.
2. `cd product && npm run lint` is green.
3. `cd product && npm test --workspace @swoop/common` passes — fixtures round-trip clean for every tool I/O pair and every derived entity.
4. `psql swoop_puma_dev < product/connector/migrations/001_extensions.sql` (then 002, 003, 004, 005) applies cleanly to an empty Postgres 16 + pgvector + pg_trgm + btree_gin install.
5. Every domain entity table exists and has the columns named in §"Schema design — Postgres".
6. Every derived entity table exists and has its full column set.
7. Every index exists (verify via `\d+ <tablename>` in psql).
8. `product/cms/prompts/tools/<tool>/description.md` exists for every intent-named tool. Each file 1–3 paragraphs + a "when to pick this" line. Production first-pass quality — ship-ready as-is.
9. `product/ts-common/src/tools.ts` exports both deprecated (annotated) and new tool schemas. Existing imports in `product/orchestrator/` still compile.
10. `planning/decisions.md` has at least one new entry per decision taken in the task (C.30 onward).
11. Execution log appended to this file.

---

## Open questions for execution time

These are flagged so the executing agent doesn't lose time on them. The first three are **settled** as recommendations; the last two stay open:

**Settled:**

- **Migration tooling**: `node-pg-migrate`, plain SQL files, **forward-only** (no `down.sql` pairs). Rationale: derived store is disposable by design (theme 5 — when source schema changes, rewrite `export.sql` and re-run; recovery from a bad migration is "drop the database, re-run all migrations forward, re-run ETL", which takes minutes). Hand-written reverse migrations are real ongoing cost (especially error-prone for data-shape changes) for a benefit we'd rarely use. If Swoop's in-house team prefers proper up/down pairs for "professional handover", revisit at C.t8 runbook time.
- **`customer_story.persona_signals` shape**: **natural-language `persona_summary` TEXT + `persona_embedding` vector**, no structured columns or JSONB blob. Per decision C.30. Haiku writes a 1–3 sentence persona description per row at ETL; the Mirror tool finds matching customers via cosine similarity on the embedding. Aligns with C.24 (cheap LLM at ETL, embeddings + Sonnet at runtime). No taxonomy to lock down; discovery happens in the embedding space.
- **Tool description voice**: production first-pass — substance complete, ship-ready as-is. Per the §"Tool descriptions" section above. G.t1/G.t5 are *refinement* loops, not the home for the substance.

**Still open at execution time:**

- **`trip_card.embedding` content composition**: which fields concatenate into the embedded text? Recommend `headline + vibe_line + description.slice(0, 500)` — enough to capture intent, not so much that single-sentence queries get overwhelmed by long descriptions. Settle in a tiny C.t3a sub-decision; no impact on schema.
- **`canonical_url` on `trip`**: trips don't have `override_url` / `alias` directly — they go via `page_id`. C.t3 design call. Schema decision: store `canonical_url` as TEXT on `trip`, populate at ETL via JOIN to `page`. If a trip lacks a page, leave NULL.
- **Should the `tag` derived table include `embedding`?** Recommend yes — it's near-zero cost (79 rows) and unlocks `find_tags_by_utterance` per §2.4.

---

## Coordination

- **C.t3** (export.sql): reads the Postgres schema produced here. Migrations are the contract.
- **C.t3a** (embedding pass + classifiers): reads the Zod schemas produced here for the derived entities. Populates `embedding`, `tsv`, `content_hash` columns.
- **C.t4** (tool implementations): validates against the tool I/O Zod schemas produced here. Reads the tool description prose to author handler logic.
- **B.t3a** (orchestrator connector adapter rewrite): consumes the new tool I/O schemas; removes the deprecated ones from `tools.ts`.
- **D.t9** (widget replace): consumes the derived-entity output schemas to render new widgets.
- **G.t1 / G.t5** (system prompt + optional tool description refinement): refines `description.md` files only if real conversations or the Luke + Lane sales-thinking doc prompt a tweak. C.t2 ships production-quality first-pass; G.t1/G.t5 is polish-on-demand, not a required follow-up.

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks.)*
