# 03 — Execution: C.t3a Embedding pass + Haiku ETL classifiers + derived-table population

**Status**: **HITL-ratified 2026-05-01 — ready for execution.**
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §10 — the **C.t3a** task ("Embedding pass + blog post-processing + ETL classifiers"). Operationalises decisions C.18 (Voyage-3 / 1024d), C.24 (cheap-LLM-at-ETL, no composers in request path), C.25 (eight-tool intent-named surface), C.26 (customerreview supply granted; `find_someone_who` live), C.30 (persona-summary natural-language shape), C.30b (image FK, not denormalised), and the 2026-04-30 finding on aggregate-by-reviewer for persona generation.
**Depends on**: C.t2 closed (migrations 001–006 in place; Zod schemas authored; `puma_dev` provisioned). C.t3 closed or in lock-step (domain tables populated from the SQL dump). Blog ingest snapshot exists (`data/blog/raw/<latest>/posts.ndjson` per [03-exec-blog-ingest.md](03-exec-blog-ingest.md); ingestion package shipped).
**Blocks**: C.t4 (tool handlers query the populated derived tables; hybrid retrieval needs embeddings + tsvector + classifier-derived columns to function). D.t9 (widgets render `*PublicSchema` shapes that include classifier-derived fields like `region`, `mood`, `topic`, `persona_summary`).
**Produces**:
- A new ETL workspace surface in `product/ingestion/src/enrich/` (subpackage of the existing `@swoop/ingestion` workspace — same package that owns the blog snapshot pipeline; reuse the workspace, don't grow a new one).
- Haiku classifier prompts under `product/cms/prompts/etl/<classifier>/` (new sub-tree under `cms/prompts/`, paralleling `system/`, `skills/`, `tools/` per G.11). One folder per classifier (4 folders).
- Five job-shaped derived tables populated: `inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`. Plus embedding columns populated on five domain tables: `tag.embedding`, `image.embedding` (where description is present or vision-derived; the rest of the image annotation work is C.t6's), `faqitem.embedding`, `blog_chunk.embedding`, plus `blog_post.primary_job` + `secondary_jobs` from the blog-post classifier.
- Decision-log entries (`planning/decisions.md`) for any C.t3a-specific calls taken during execution (chunking strategy per source type; persona-aggregation grouping key; rate-limit / retry config; etc.).
- Cost ledger appended to this file's "Execution log" — actual Voyage-3 token count, actual Haiku call count, observed wall-clock, observed £-spend.

**Estimate**: ~2 days of focused work. Dominated by prompt iteration on the Haiku classifiers (read sample output, tune prompt, re-run) — the embedding plumbing itself is mechanical. Cost: pence to single-digit pounds.

---

## ★ Read this first — C.t3a calibration

> **Before you touch a Voyage call or write a Haiku prompt, read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"★ Read this first — the WHY of chunk C" end-to-end.** That section names the four+1 jobs the data does for the conversation, and the design discipline (top-down from sales, never bottom-up from data) that grounds every choice in this chunk. C.t3a is *especially* susceptible to bottom-up drift — embeddings + classifiers are the layer where "we have data X, let's classify it Y" is a constant temptation. Re-anchor before adding anything.

The compressed reminder for C.t3a specifically:

- **Every classifier output must serve a journey-moment.** If you find yourself adding a classifier dimension because "the data has it" or "we could", stop and re-anchor. The right question: *which tool, in which conversational moment, will use this column?* If you can't name it concretely, don't add it.
- **C.t3a is enrichment, not authoring.** Domain tables exist (C.t3); job-shaped derived tables exist (C.t2 migrations). C.t3a *populates* them via three mechanical sub-passes: chunk → embed → classify. The shape is fixed; only the contents are new.
- **Cheap LLM at ETL, not at request path** (C.24). Haiku runs once per `content_hash` change, persists structured output to columns, never runs again unless content changes. The orchestrator's Sonnet sees the columns, never the classifier.
- **Persona aggregation matters more than persona dimensions.** Per the 2026-04-30 customerreview finding: ~80% of reviews are short snippets that produce thin per-row personas; aggregate by reviewer `name` first, then classify, to get coherent personas (~1–3 sentences). The aggregation step is load-bearing; don't skip it.
- **Idempotency via `content_hash` is the contract.** Re-running the pass must be cheap (skip rows whose hash is unchanged) and safe (re-embed only what shifted). The plan below pins the hash composition rule per source type.
- **Cost cap is a hard guard.** If the run blows past £10 unattended, something's wrong — kill the run and figure out why before it bleeds £100. Plan §"Cost guards" pins the budget and the kill-switch.

This task ships exactly what the Tier 2 plan has settled — five derived tables, four Haiku classifiers, one embedding model. **Don't add classifiers, don't add columns the migrations don't have, don't run a vision-pass on images** (that's C.t6). If you find yourself reaching for any of those, you're scope-creeping; re-read the chunk-C anchor.

---

## Purpose

C.t3a is the **semantic enrichment layer**. After C.t3 has moved raw rows from the SQL dump into Postgres domain tables (`page`, `contentblock`, `chunk`, `blog_post`, `blog_chunk`, `faqitem`, `tag`, `image`, `customerreview`, `customerreview_trip`, etc.), C.t3a does the three operations the agent actually needs to retrieve over them at runtime:

1. **Embed prose fields** — Voyage-3 (1024d, locked per C.18). Persisted to `embedding` columns + `content_hash` for idempotent re-runs.
2. **Run Haiku classifiers at ETL** — four cheap-LLM passes that turn raw prose into job-shaped structured signal: blog-post job classification, persona-summary aggregation by reviewer, image annotation (only the ~6.3K images without upstream `image.description`, per the 2026-04-29 finding), and blog-tag normalisation against `ntag`.
3. **Compose job-shaped derived tables** — pure SQL projections from the domain layer + classifier output into the five tables (`inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`) the agent's tools query at request-time.

What lands is the **populated retrieval store** every C.t4 tool handler reads from. Embeddings, classifiers, and derived rows are the contract; tool handlers don't see the source rows directly.

The 2026-04-29 + 2026-04-30 chunk-C revisions narrowed the scope: no composer layer at request-time, eight intent-named tools, customerreview supply now granted (live, ~2,563 rows + 163 trip junctions), customertip still pending, image text-field population means ~50% of images already have a description we can use as-is. C.t3a inherits all of that.

### Where C.t3a sits in the ETL chain

```
SQL dump ─────► [C.t3 transform] ─────► Postgres domain tables
                                              │
                                              ▼
Blog NDJSON snapshot ──────────────────► [C.t3a embed pass]
                                              │
                                              ├─► Voyage-3 → embedding columns + content_hash
                                              │
                                              ├─► Haiku → blog_post.primary_job, secondary_jobs
                                              ├─► Haiku → customer_story.persona_summary (aggregated by reviewer)
                                              ├─► Haiku → image.tags / subject_tags / mood_tags / region_tags
                                              │            (only for images without upstream description; C.t6 does the vision-pass)
                                              ├─► Haiku → blog_post.ntag_ids[] (free-text tags → canonical 79-row taxonomy)
                                              │
                                              ▼
                                         [SQL composition] ─► inspire_passage, customer_story,
                                                              trust_proof, inform_chunk, trip_card
                                              │
                                              ▼
                                          (C.t4 tool handlers read here)
```

---

## Out of scope

Name it so the plan doesn't drift:

- **No vision-pass on images.** That's C.t6. C.t3a only embeds the `image.description` text field where it's already populated (47.5% of rows per the 2026-04-29 finding) and runs the lightweight Haiku tag-normalisation on text fields. Vision goes through Claude Vision in C.t6 to populate `description` for the remaining ~6.3K rows; C.t3a then embeds those after C.t6 lands.
- **No customertip processing.** The 119 `contentblock_customertip` junction rows continue to dangle until Swoop ships the source table (per C.26). ETL ignores them. If/when delivered, C.t3a re-runs against the new domain table — no plan change required.
- **No new tools, no new derived tables, no new columns.** C.t2 settled the contract; C.t3a populates it.
- **No source-data writes.** C.t3a never writes back to the SQL dump or to Swoop's MariaDB. Everything lands in Postgres derived/domain tables.
- **No request-path LLM** (per C.24). Haiku is ETL-only. The orchestrator's Sonnet sees the columns, never the classifier prompts or outputs in flight.
- **No composer layer.** C.24 supersedes C.22. If you find yourself sketching a "compose this at query-time" pattern, stop — that's the bottom-up trap.
- **No real-time refresh.** C.t3a runs as a Cloud Run Job on demand or scheduled; it's not on the request path. If the Tier 1 cadence shifts to streaming, that's a separate task.
- **No final tuning of Voyage-3 HNSW parameters.** Default cosine + ef_construction settings ship; C.t8 runbook covers post-launch tuning if recall/precision metrics warrant.

---

## Inputs (files to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"★ Read this first" + §2.1 (pipeline shape) + §2.3 (where Haiku earns its keep) + §2.5 (entity model) + §2.7 (image annotation pipeline boundary).
- [`03-exec-c-t2.md`](03-exec-c-t2.md) — full schema definitions for derived tables; the Zod-projection contracts at `product/ts-common/src/derived.ts`.
- [`03-exec-c-t0.md`](03-exec-c-t0.md) — for the corpus-shape findings (S5 daybyday sparseness, S7 ntag firehose, S10 image two-table model).
- [`03-exec-blog-ingest.md`](03-exec-blog-ingest.md) — for NDJSON layout, manifest schema, the `data/blog/raw/<UTC>/posts.ndjson` contract.
- [`decisions.md`](decisions.md) — C.18 (Voyage-3 / 1024d locked), C.24 (no composer), C.25 (eight tools), C.26 (customerreview live; customertip pending), C.30 (persona shape), C.30b (image FK), C.31 (forward-only migrations), C.33 (source_id TEXT), C.34 (tool-description prose in markdown).
- [`discoveries.md`](discoveries.md) — 2026-04-30 entries on customerreview corpus shape (80/20 short/long; aggregate-by-reviewer); 2026-04-29 entry on image text-field population (47.5% have descriptions).
- `product/connector/migrations/003_derived_tables.sql` — exact column list per derived table (the contract).
- `product/connector/migrations/004_indexes.sql` — HNSW + GIN + B-tree expectations (we don't author indexes here, but the embedding pass must respect them so they remain useful — i.e. populate `embedding` and `tsv` cleanly).
- `product/connector/migrations/006_customerreview_tables.sql` — the customerreview/customerreview_trip domain tables we read from for `customer_story` derivation.
- `product/ts-common/src/derived.ts` — projection helpers; we serialise derived rows through these for round-trip safety.
- `product/ingestion/src/blog/` (existing) — NDJSON reader patterns; reuse the codec.

---

## Outputs (files to write/modify, with paths)

### Workspace surface

`product/ingestion/src/enrich/` (new sub-tree inside the existing `@swoop/ingestion` workspace; the package already owns blog ingest, this is its sibling concern):

| File | Contents |
|---|---|
| `index.ts` | CLI entry: `npm run enrich -- [--mode=embed\|classify\|compose\|all] [--source=blog\|page\|review\|tag\|image\|faqitem] [--limit=N] [--dry-run]`. Dispatches to the four sub-modules. |
| `pool.ts` | Postgres pool via `pg`; reads `DATABASE_URL` from env. Reuses the connector's connection-string convention. |
| `voyage.ts` | Voyage-3 HTTP client. Batched (256 docs per call — Voyage's documented batch limit; pin in code with a comment). Concurrency: 4 in-flight batches. Retry: exponential backoff on 429/5xx (3 attempts, 1s/2s/4s + jitter). Idempotent — caller passes `content_hash`, the function only embeds rows whose persisted hash differs. Returns `{ id, embedding, content_hash, attempted_at }` rows for direct UPSERT. |
| `haiku.ts` | Haiku 4.5 client (model id from `gotchas.md` — `claude-haiku-4-5-20251001`). Reuses orchestrator's `claude-llm.ts` Anthropic-SDK conventions where viable; **does not** import from orchestrator (workspace boundary stays clean — author a thin local client). Prompt loaded from `cms/prompts/etl/<classifier>/prompt.md` per the loader contract below. |
| `prompts.ts` | Loader for `cms/prompts/etl/<classifier>/`. Each classifier folder contains `prompt.md` (the system prompt + few-shot examples) + `output-schema.ts` (a Zod schema the model's structured output must satisfy). Loader returns `{ systemPrompt, schema }`. Failures load-bear: a missing prompt halts the run with a clear message. |
| `chunk.ts` | Chunking strategy per source type. Pure functions, no I/O. See §"Chunking strategy" below for the rules. |
| `hash.ts` | `content_hash(text, source_type, version)` → SHA-256 hex. Version is bumped when the chunking rule changes (forces re-embed); source_type prevents collision across types. |
| `embed/blog-chunks.ts` | Embed pass driver for `blog_chunk.embedding`. |
| `embed/page-chunks.ts` | Embed pass driver for the synthetic chunks that feed `inspire_passage` / `trust_proof` / `inform_chunk` (composition logic in `compose/`). |
| `embed/customer-stories.ts` | Embed pass driver for `customer_story.persona_embedding` (the aggregated persona text). |
| `embed/trip-cards.ts` | Embed pass driver for `trip_card.embedding`. |
| `embed/inform-chunks.ts` | Embed pass driver for `inform_chunk.embedding` (FAQ + practical guides + month pages + practical-blog subset). |
| `embed/trust-proofs.ts` | Embed pass driver for `trust_proof.embedding`. |
| `embed/inspire-passages.ts` | Embed pass driver for `inspire_passage.embedding`. |
| `embed/tags.ts` | One-time embedding of the 79-row `ntag` taxonomy. Cheapest pass; runs first. |
| `embed/faqitems.ts` | Embed pass driver for `faqitem.embedding`. |
| `embed/images.ts` | Embed pass driver for `image.embedding` — uses `description` if populated (47.5%), else skips and logs (C.t6 fills the rest). |
| `classify/blog-post-job.ts` | Haiku classifier — assigns each blog post a `primary_job` (and `secondary_jobs[]`) from {inspire, mirror, reassure, inform}. Aggregate-by-blog-post (one call per post, not per chunk — the classification is post-shaped). |
| `classify/persona-summary.ts` | Haiku classifier — aggregates customerreview rows **by reviewer name** first (per the 2026-04-30 finding), then writes a 1–3 sentence `persona_summary` per reviewer-group. Output keyed by `(name, hash-of-aggregated-prose)` so each persona row in `customer_story` carries the canonical persona for that reviewer. |
| `classify/image-annotation.ts` | Haiku classifier (text-only — no vision; that's C.t6). Reads `image.title` + `image.description` + `image.caption` where present, normalises into `subject_tags` / `mood_tags` / `region_tags` arrays + a free-text `tags[]` array. Skips rows without any text input. |
| `classify/blog-tag-normalisation.ts` | Haiku classifier — maps free-text WordPress tags ("Torres_del_Paine", "CONSERVATION") to canonical `ntag_ids[]` (the 79 typed tags). Runs once per blog post; reads `blog_post.tags[]` (raw) and writes `blog_post.ntag_ids[]` (resolved). |
| `compose/inspire-passage.ts` | SQL projection from {page intro_text, page summary, contentblock prose, blog_chunk where blog_post.primary_job='inspire' OR 'inspire' IN secondary_jobs, chunk} into `inspire_passage` rows. |
| `compose/customer-story.ts` | SQL projection from `customerreview` (joined by reviewer-aggregated persona) + first-person blog rows where `primary_job='mirror'` into `customer_story` rows. |
| `compose/trust-proof.ts` | SQL projection from {Swoop sustainability/B-Corp/About-page subset, partner pages, B-Corp blog cluster} into `trust_proof` rows. The "topic" column is computed by a small rule-based classifier (not Haiku) over the source page's pagetype + ntag_ids — recorded as a sub-decision (§"Open questions" #4). |
| `compose/inform-chunk.ts` | SQL projection from {faqitem, page Before-you-travel + Guidebook practical subset, month pages, blog `primary_job='inform'`, trip prose chunks} into `inform_chunk` rows. |
| `compose/trip-card.ts` | SQL projection from `trip` + joined `image` + `ntag` into `trip_card` rows. |
| `checkpoint.ts` | Partial-progress persistence: writes `data/etl/c-t3a-checkpoints/<run-id>.json` after each batch so a killed run can resume from the last committed batch. |
| `cost.ts` | Live cost ledger — counts tokens (Voyage) + Haiku calls + estimated £-spend. Hard cap (default £10) aborts the run. |
| `__tests__/` | Vitest suite. See §"Verification" below for what each test covers. |

### Classifier prompts (CMS)

`product/cms/prompts/etl/` (new sub-tree under `cms/prompts/`, paralleling `system/`, `skills/`, `tools/` per G.11):

| Folder | Contents |
|---|---|
| `etl/blog-post-job/` | `prompt.md` (system prompt + ~6 few-shot examples covering each job class + `none`/`multi`); `output-schema.ts` (`{ primary_job: enum, secondary_jobs: enum[], reasoning: string \|\| undefined }`). |
| `etl/persona-summary/` | `prompt.md` (system prompt + ~3 few-shot examples — one short-snippet aggregate, one long-form testimonial, one mixed); `output-schema.ts` (`{ persona_summary: string (1–3 sentences), reviewer_name: string, region_hint: string \|\| undefined }`). |
| `etl/image-annotation/` | `prompt.md` (text-only; system prompt + ~4 few-shot examples covering the four `subject_tags` / `mood_tags` / `region_tags` axes); `output-schema.ts` (`{ subject_tags: string[], mood_tags: string[], region_tags: string[], tags: string[], description?: string }`). |
| `etl/blog-tag-normalisation/` | `prompt.md` (system prompt + the 79-row `ntag` taxonomy as a structured reference + ~5 few-shot examples covering common normalisation patterns); `output-schema.ts` (`{ ntag_ids: number[], unmapped_raw_tags: string[] }`). |

The loader contract at `product/ingestion/src/enrich/prompts.ts`:
1. `prompt.md` body is the system prompt verbatim (markdown formatting preserved; the model handles markdown natively).
2. `output-schema.ts` exports a default Zod schema that the classifier passes to Haiku's `tool_choice` (structured output via tool-use; the standard pattern in `claude-llm.ts`).
3. A small frontmatter block at the top of `prompt.md` carries metadata: `version` (bumped when the prompt changes — forces re-classification on rows whose stored prompt-version differs), `model` (defaults to `claude-haiku-4-5-20251001` from gotchas.md), `temperature` (default 0.0 for classifiers — deterministic).
4. Frontmatter parsed via `gray-matter` (a workspace dep already in `@swoop/ingestion` for the blog markdown handling — verify; if not, add).

### Decision log

`planning/decisions.md` — likely candidates for new entries during execution:
- **C.35** — Chunking strategy per source type. Recommend: **page intro_text + summary as-is (no further split)**; **page contentblock prose split on `<h2>`/`subheading` boundaries with ~800-token sliding fallback**; **blog post split on `<h2>`/`<h3>` with ~800-token sliding fallback**; **faqitem one row = one chunk (the Q&A is the unit)**; **chunk one row = one chunk**; **customerreview aggregated by reviewer name, the aggregated text is the unit**. Record the call.
- **C.36** — Haiku classifier prompt versioning convention. Recommend YAML frontmatter `version: 1` field, bumped on substantive prompt change; classifier persists the version it ran with so re-runs pick up only changed-prompt rows. Record the call.
- **C.37** — Cost cap default. Recommend £10 hard cap (aborts run); £5 soft warning (logs, continues). The plan-time estimate is well under £1, so a £10 cap leaves substantial headroom for prompt-iteration thrash.
- **C.38** — Persona-summary aggregation key. Recommend `customerreview.name` (the reviewer name field) as the grouping key. Record any deviation (e.g. if name is too sparse and we fall back to email or some other combination — confirm during execution against actual data).
- **C.39** — Voyage-3 batch + concurrency parameters. Recommend batch=128 (conservative; Voyage docs say up to 256 but rate-limit headers might tighten this), concurrency=4 in-flight. Record actual values used.
- **C.40** — Image embedding scope at C.t3a vs C.t6 boundary. Recommend: C.t3a embeds `image.description` where populated (47.5% per discoveries.md); C.t6 fills the remaining ~52% via Claude Vision; a second C.t3a-embed run (or the C.t6 run itself) embeds those rows after C.t6. Avoid double-running on the same row.

---

## Architectural principles applied here

Carried forward from the chunk-C anchor:

- **Top-down from the journey-moment, never bottom-up from the data.** Every classifier dimension and every derived-table column maps back to a tool a visitor reaches at a moment. The four classifiers exist because four tool surfaces (`find_inspiring`, `find_someone_who`, `find_proof`, `lookup` + the cross-cutting `find_options`) need them. The image annotator exists because `illustrate` (and image-paired derived rows) need annotations.
- **Cheap-LLM-at-ETL, not-at-request-path** (C.24). All four classifiers run once at ETL, persist to columns, and are invisible to Sonnet at runtime. The orchestrator never sees a classifier prompt or output mid-conversation.
- **Disposable enrichment** (theme 5). When the source data shifts, the enrichment pass re-runs from scratch (or incrementally via `content_hash`); nothing downstream notices because the derived-table interface is stable.
- **Idempotency via `content_hash`** is the contract that makes re-runs cheap. Every rule about chunking, hashing, and persistence in this plan exists to make the pass safe to re-run.
- **Anti-pattern guard**: every classifier output is checked against "which tool, in which moment?" If the answer isn't concrete, the classifier doesn't ship.

Added for this task specifically:

- **Aggregate before classifying** (the 2026-04-30 customerreview-corpus finding). Persona generation runs on aggregated-by-reviewer prose, never on individual short-snippet rows. The aggregation step is *load-bearing* — skipping it produces thin, useless personas.
- **Read-only against C.t3 domain tables.** C.t3a never UPDATEs domain tables except for the four classifier-output columns it owns (`blog_post.primary_job`, `blog_post.secondary_jobs`, `blog_post.ntag_ids`, `image.{tags,subject_tags,mood_tags,region_tags}`). All other writes land in derived tables.
- **Cost ledger is part of the pass.** A run that doesn't track £-spend isn't a passing run; the cost cap is a guard, not a suggestion.
- **One Cloud Run Job, one CLI invocation.** No long-running daemon, no scheduled cron from this codebase. Cloud Scheduler triggers the job (post-M4); locally it's `npm run enrich -- --mode=all`.

---

## Sub-pass design

### A. Tag taxonomy embed (cheapest; runs first)

**Source**: 79 active rows from the `tag` derived table (post-C.t3 ingestion of `ntag` rows).
**Operation**: For each `tag.id`, embed the concatenation of `title + ' ' + (alias || '') + ' ' + (type || '')`. Voyage-3, 1024d. UPSERT into `tag.embedding`.
**Why first**: cheapest pass (~79 calls; effectively free), unblocks every other pass that uses the `find_tags_by_utterance` data primitive, and verifies the Voyage client end-to-end before more expensive passes commit.

### B. Page chunks → `inspire_passage`, `trust_proof`, `inform_chunk` composition

**Source**:
- `page` rows (filtered: not Profile, not test, content-relevant pagetypes per C.29 mapping).
- `contentblock` rows joined to those pages, prose-bearing subtypes only (per C.t2 plan §"page" + §"contentblock" sketch — `customerreview`, `customertip`, `image` (caption), `carousel`, `pressreview`, `partnercomment`, `tour`, `trip`, `when_to_travel`, `reviewcarousel`).
- `chunk` (46 reusable CMS prose blocks).

**Per page, the chunking rule (C.35 candidate)**:
- `page.intro_text` — one chunk if non-empty.
- `page.summary` — one chunk if non-empty.
- Each `contentblock` row's prose fields (`title`, `subheading`, `text`) — one chunk per contentblock if `text` is non-empty; if `text` exceeds ~800 tokens, split on `subheading` boundaries with sliding-window fallback.

**Per blog post**:
- Split on `<h2>` / `<h3>` HTML tags (the blog content is HTML in `blog_post.content`).
- Sliding-window fallback at ~800 tokens with 100-token overlap if a section exceeds the window.

**Routing into derived tables** (composition, not classification — pure SQL with classifier-derived columns):
- A page chunk lands in `inspire_passage` if its source page's pagetype maps to Inspire (Region, National Park, City, Activity, Region-Activity, Experience, Country, Landmark, Guidebook editorial subset). Mapping per Tier 2 §2.5 table.
- Lands in `trust_proof` if the source page is in the Sustainability/B-Corp/About-Swoop slice of the Swoop pagetype, or a Partner page.
- Lands in `inform_chunk` if it's a faqitem, Swoop "Before you travel" page, Guidebook practical subset, month page, or trip-prose chunk.
- A blog chunk lands in the table matching its `blog_post.primary_job` (Inspire/Mirror/Reassure/Inform) and **also** in the tables matching `secondary_jobs[]` (a single blog chunk can populate multiple derived rows — each derived row is a separate row, not a join, with its own embedding and `tsv`).

The composition step runs after embedding (B.t3 below): the derived-row's `embedding` is the source-chunk's embedding, copied through.

### C. Per-source-row embedding

Driver pattern (same shape across all `embed/<source>.ts` files):

1. Read source rows in batches of 1000 (Postgres pagination via `LIMIT/OFFSET` or keyset pagination on `id`).
2. For each row, compute `content_hash(text, source_type, version=current)`.
3. Compare with persisted hash; skip rows where hash matches.
4. Group remaining rows into Voyage-3 batches of 128 (C.39 candidate); call Voyage with concurrency=4 in-flight.
5. UPSERT `(embedding, content_hash, embedded_at)` per row.
6. Update cost ledger.
7. Checkpoint after each batch.

**`content_hash` composition rule per source type**:
- `blog_chunk`: `sha256(text || '|' || version)`.
- `page` chunks: `sha256(page.id || '|' || chunk_index || '|' || text || '|' || version)`.
- `customer_story.persona_embedding`: `sha256(persona_summary || '|' || version)` — note this hash is over the persona text, NOT the source customerreview rows; the persona_summary is the embedding input.
- `tag.embedding`: `sha256(title || '|' || alias || '|' || type || '|' || version)`.
- `image.embedding`: `sha256(description || '|' || version)` — version bump when description-source-rule changes.
- `faqitem.embedding`: `sha256(title || '|' || content || '|' || version)`.

Version starts at `1` and increments only when the embedding-input rule changes (e.g. add/remove a concatenated field). Forces a re-embed across the table; cost is bounded by row count × Voyage rate.

### D. Haiku classifier passes

#### D.1 Blog-post job classifier

**Input per row**: `blog_post.title`, `blog_post.excerpt`, first 2000 chars of `blog_post.content` (HTML stripped to text in `chunk.ts`'s helper).
**Output**: `{ primary_job, secondary_jobs[], reasoning? }` where job ∈ {inspire, mirror, reassure, inform, multi, none}. Persisted to `blog_post.primary_job` + `blog_post.secondary_jobs`.
**Idempotency**: hash over `(title || excerpt || first2000chars-of-content || prompt-version)`. Re-runs only re-classify changed rows or rows whose prompt version differs.
**Volume**: ~108 in-window posts × 1 call each = ~108 calls. Pence.

#### D.2 Persona-summary classifier (the load-bearing one)

**Aggregation step (pure SQL, runs first)**:
```
SELECT name, ARRAY_AGG(text ORDER BY date) AS aggregated_texts, ARRAY_AGG(id) AS source_ids
FROM customerreview
WHERE is_published = TRUE AND name IS NOT NULL AND name <> ''
GROUP BY name
```
Pseudocode for clarity; real query lives in `compose/customer-story.ts`. Each group becomes one `customer_story` row (representing the persona).

**Edge-case handling for null/empty `name`**:
- Reviews with `name IS NULL OR name = ''` aggregate into a single "anonymous" bucket — but classified per-row since aggregation by null isn't meaningful.
- Sub-decision (record as C.38a if it comes up): drop anonymous rows entirely, or keep as per-row personas. Recommend drop for Puma launch — anonymous reviews are usually short snippets; their per-row personas are thin (per the 2026-04-30 finding) and they don't anchor a `find_someone_who` match well.

**Input per group**: `name`, joined `aggregated_texts` (concatenated with `\n\n---\n\n` separators), region hint (joined from `customerreview_trip` → `trip.region` if available — can be null).
**Output**: `{ persona_summary, reviewer_name, region_hint? }`. Persisted to `customer_story.persona_summary` + `customer_story.region` (overlay only if region is null from the join).
**Idempotency**: hash over `(joined_aggregated_texts || prompt-version)`. If the reviewer adds a new review, the aggregation changes, the hash changes, the persona re-classifies.
**Volume**: 2,563 customerreview rows aggregate by `name` → unknown distinct count, but plausibly 800–1500 reviewers (given the 80/20 finding showing 9–12 snippets per reviewer is common). Estimate ~1200 Haiku calls. Pence to a few pounds.

#### D.3 Image annotation classifier (text-only)

**Input per row**: `image.title` (99.7% populated), `image.description` (47.5%), `image.caption` (35.2%). Skip rows where all three are null/empty (those go through C.t6's vision path).
**Output**: `{ subject_tags, mood_tags, region_tags, tags, description? }`. Persisted to the matching columns on `image`.
**Idempotency**: hash over `(title || description || caption || prompt-version)`.
**Volume**: ~13.3K rows × ~50% with text input ≈ ~6.5K Haiku calls. Pence to a few pounds.
**Note**: this is the *text-only* annotation pass. C.t6 runs Claude Vision over the ~6.3K rows without any text input and writes their `description`; a follow-up C.t3a re-run then embeds those.

#### D.4 Blog-tag normalisation

**Input per row**: `blog_post.tags[]` (raw WordPress strings, ~3–10 per post).
**Reference**: the 79-row `ntag` taxonomy passed in the system prompt as a structured table.
**Output**: `{ ntag_ids: int[], unmapped_raw_tags: string[] }`. Persisted to `blog_post.ntag_ids[]`. Unmapped tags logged to a side file (`data/etl/unmapped-blog-tags.json`) for periodic review by Al / Tier 1 — if a recurring unmapped tag indicates a missing `ntag` row, that's a content-team conversation, not a code change here.
**Idempotency**: hash over `(joined_raw_tags || ntag-snapshot-hash || prompt-version)`. The ntag-snapshot-hash captures the 79-row taxonomy; if Swoop adds a new `ntag` row the snapshot changes and re-classification re-runs.
**Volume**: ~108 posts × 1 call each = ~108 calls. Pence.

### E. Compose derived tables (pure SQL after C and D)

For each derived table, a SQL projection assembles rows from {classified domain rows + chunked-and-embedded source chunks}. No LLM in this step. Composition runs once after C and D complete; idempotent re-run is `TRUNCATE derived_table; INSERT ... FROM ...` (forward-only, theme 5; the derived store is throwaway).

Sketch per table (full SQL in the matching `compose/<table>.ts`):

- `inspire_passage`: page chunks where pagetype ∈ Inspire-mapped set, plus blog chunks where blog_post.primary_job = 'inspire' OR 'inspire' = ANY(blog_post.secondary_jobs), plus `chunk` rows (the 46 reusable CMS prose blocks). Each row carries `(id, source_provenance, source_id, text, canonical_url, ntag_ids, region, mood, image_id, embedding, tsv, content_hash)`.
- `customer_story`: one row per reviewer-aggregated persona (D.2 output) + first-person blog rows where blog_post.primary_job = 'mirror'. The blog branch carries no `persona_summary` (it's the post that's the story, not the author's persona); for those rows `persona_summary` is the post excerpt + Haiku-summarised author intent (sub-classifier or fallback to excerpt verbatim — record at execution time).
- `trust_proof`: page rows in the Sustainability/B-Corp/About-Swoop slice of pagetype=Swoop, plus Partner pages, plus blog chunks where primary_job='reassure' or 'reassure' ∈ secondary_jobs. `topic` computed via rule-based mapping (sub-decision §"Open questions" #4).
- `inform_chunk`: faqitem rows + Swoop "Before you travel" pages + Guidebook practical subset + month pages + blog chunks where primary_job='inform' or 'inform' ∈ secondary_jobs + trip prose chunks (where useful — TBD at execution).
- `trip_card`: one row per `trip` (filtered to active/surfaceable per the C.t0 finding `WHERE deleted IS NULL AND publishstate_id = 3`) joined to its hero image (via page-as-hub if direct join is null) and `ntag_ids` (via `ntags_lookup WHERE entity_type='trip'`). `embedding` = Voyage-3 over `(headline + ' ' + vibe_line + ' ' + first 500 chars of description)` per the C.t2 §"Open questions" #1 recommendation.

Composition writes the `tsv` column inline via `to_tsvector('english', text)` so the GIN index is populated on insert.

---

## Verification

Task is done when:

1. `cd product && npm run typecheck` is green across all workspaces (especially `@swoop/ingestion`).
2. `cd product && npm run lint` is green (don't introduce new lint failures; existing 34 problems on the branch carry over per C.t2 closure note).
3. `cd product && npm test --workspace @swoop/ingestion` passes — Vitest suite covers:
    - `chunk.ts`: every chunking rule round-trips a fixture document into the expected chunk count + sizes.
    - `hash.ts`: deterministic across runs; version bump changes hash; source_type segregation works.
    - `voyage.ts`: mocked Voyage HTTP with happy-path, 429-retry, 5xx-retry, retries-exhausted, batch-size-respected.
    - `haiku.ts`: mocked Anthropic with happy-path structured output, schema-violation surfaces a retry once then fails loud.
    - `prompts.ts`: loader returns expected `(systemPrompt, schema)` for each of the four classifier folders; missing-folder halts loudly.
    - `cost.ts`: ledger increments correctly; cap aborts the run.
    - `embed/*` and `classify/*`: each driver against a fixture domain-table snapshot; assert correct UPSERTs.
    - `compose/*`: each composition against a fixture set produces expected derived rows.
4. **Smoke test against `puma_dev`** (assuming C.t3 has populated domain tables):
    - `npm run enrich -- --mode=all --dry-run` lists planned operations + estimated cost; no writes.
    - `npm run enrich -- --mode=embed --source=tag` populates `tag.embedding` for all 79 rows; verify via `SELECT COUNT(*) FROM tag WHERE embedding IS NOT NULL`.
    - `npm run enrich -- --mode=classify --source=blog-post-job` populates `blog_post.primary_job` for all in-window posts; verify via `SELECT COUNT(*), primary_job FROM blog_post GROUP BY primary_job`.
    - `npm run enrich -- --mode=all` runs end-to-end; cost-ledger output stays under £5; the five derived tables have plausible row counts.
5. **Sample-quality check (HITL — Al)**: Al reads ~10 randomly-selected `customer_story.persona_summary` rows + ~10 `inspire_passage.text` rows + ~10 `image.subject_tags` arrays. Sign-off if voice/quality/coverage feels right; if not, iterate on the prompts (frontmatter version bump → re-classify only the affected pass).
6. **Idempotent re-run**: `npm run enrich -- --mode=all` a second time should produce zero writes (every row's `content_hash` matches). Verify by counting writes in the cost ledger or via a `\watch`-style query during the run.
7. **Cost cap**: setting `ENRICH_BUDGET_GBP=0.50` aborts the run partway with a clear error; checkpoints are intact and `--mode=all` resumes from where it stopped after raising the cap.
8. Decision-log entries added for any C.35–C.40 calls taken during execution.
9. Execution log appended to this Tier 3 plan summarising what landed, observed cost, observed wall-clock, what was deferred to C.t6 / C.t8.

### Smoke tests (manual; curl-style)

After a successful `--mode=all` run:

- `psql puma_dev -c "SELECT COUNT(*) FROM inspire_passage;"` — expect ≥1000 rows (back-of-envelope from §2.5: 482 pages × ~3 chunks each + ~30 blog Stories & Inspiration posts × ~5 chunks).
- `psql puma_dev -c "SELECT COUNT(*) FROM customer_story;"` — expect 800–1500 rows (one per distinct reviewer name + a small first-person blog tail).
- `psql puma_dev -c "SELECT COUNT(*) FROM trust_proof;"` — expect ~100–200 rows (the sustainability/B-Corp/Partner page subset + B-Corp blog cluster).
- `psql puma_dev -c "SELECT COUNT(*) FROM inform_chunk;"` — expect ~1500–2000 rows (928 faqitem + practical-page chunks + practical-blog chunks).
- `psql puma_dev -c "SELECT COUNT(*) FROM trip_card;"` — expect ~100–200 rows (the active/surfaceable subset of 852 trips, filtered per C.t0 finding).
- A simple cosine-similarity smoke query in psql: `SELECT id, text, 1 - (embedding <=> $voyage_embedding) AS sim FROM inspire_passage ORDER BY embedding <=> $voyage_embedding LIMIT 5` for a hand-crafted "Patagonia hiking inspiration" query should return plausible top-5 rows.

### Cost guards

Pinned in `cost.ts`:
- **Hard cap (default £10)**: aborts the run after the next batch boundary if accumulated estimated spend exceeds it. Configurable via `ENRICH_BUDGET_GBP` env var (Cloud Run Job sets it; local CLI defaults to £10).
- **Soft warning (default £5)**: logs a warning to stderr but continues. Exists so an operator running a one-off iteration sees they're approaching the cap without surprise.
- **Per-pass kill-switch**: each `embed/*` and `classify/*` driver checks the cost ledger before issuing the next batch. A spiky cost (e.g. Haiku tokens running higher than expected) gets caught at the batch boundary, not at the API-quota boundary.
- **Plan-time estimate**: ~12K embeddings × ~200 tokens avg ÷ 1M tokens × $0.02/M = ~£0.05 for Voyage. ~1500 Haiku calls × ~500 input + ~150 output tokens avg × Haiku 4.5 pricing ≈ ~£0.75. Total ~£0.80 baseline; £10 cap leaves 12× headroom for prompt-iteration thrash.

### Cost-cap recommendation

**Default `ENRICH_BUDGET_GBP=10`** (pence-to-low-pounds budget; aborts loudly past £10). For prompt-iteration sessions where Al expects to re-run several times, a session env override of £20 is reasonable. Production / Cloud Run Job runs should set it to £15 (just enough headroom over the £0.80 baseline; trips abort if anything's off, and a second invocation manually un-aborts).

---

## Open questions for execution time

These are flagged so the executing agent doesn't lose time on them. Numbered for the HITL pass:

1. **Aggregate-by-reviewer key — `name` only, or `name + email`?** The 2026-04-30 finding is clear that name aggregation works, but if there are reviewers with the same name and different identities (very plausible), should we composite the key with email (if populated) or some other signal? Recommend: `name` only for the first pass, with a sanity-check during execution: `SELECT name, COUNT(DISTINCT email) FROM customerreview GROUP BY name HAVING COUNT(DISTINCT email) > 1` — if there's a meaningful tail, composite the key.

2. **Anonymous customerreview rows — drop or per-row?** Reviews with `name IS NULL OR name = ''` can't be aggregated meaningfully. Recommend dropping them at C.t3a (they don't power a `find_someone_who` match well per the 2026-04-30 finding); record as decision C.38a if it comes up.

3. **Persona for first-person blog rows in `customer_story`** — what does `persona_summary` carry there? The reviewer-aggregated persona is for customerreview-source rows; first-person blog rows have a different shape (one author, one long story). Options: (a) classify the author's persona via Haiku from the post itself; (b) put the post's protagonist persona (which often isn't the author); (c) skip blog rows from `customer_story` entirely and let the Mirror tool only retrieve over customerreview-derived rows. Recommend (a) for Puma, with a sub-classifier prompt.

4. **`trust_proof.topic` rule-based vs Haiku-classified?** The Tier 2 plan named topic as one of `{sustainability, b-corp, expertise, conservation, safety, guides, satisfaction, other}`. A rule-based mapping over source pagetype + ntag_ids handles the obvious cases (Sustainability page → "sustainability", B-Corp page → "b-corp"). Haiku could classify the rest (Partner page subset, blog cluster). Recommend: rule-based first, Haiku fallback only for unmatched rows. Keeps cost lower; topic taxonomy is small enough that rules are tractable.

5. **`inform_chunk.topic_tags[]` source?** The C.t2 plan declared the column but didn't pin who populates it. Options: (a) extend the blog-tag-normalisation classifier to cover practical-blog rows; (b) rule-based from source pagetype + ntag overlap; (c) skip the column for Puma and rely on `tsv` + `embedding` retrieval. Recommend (b) — small rule-set covers transport / weather / packing / money / visa from page slug + intro keywords, plus the ntag taxonomy already encodes most of these. Skip if the rule-set isn't tractable in 30 minutes; the column stays empty until C.t8 runbook iteration.

6. **Blog HTML stripping rule** — the WP REST API's `content.rendered` is HTML; we want plain text for embedding + classification, with section structure preserved for chunking. Use `html-to-text` or a tiny custom stripper? Recommend: `html-to-text` if the workspace already has it; else inline a 30-line stripper in `chunk.ts`. Chunk boundaries (`<h2>` / `<h3>`) need to be detected before stripping.

7. **Voyage-3 batch size — 128 vs 256?** Voyage docs say 256 max. Recommend 128 for Puma's first run (more conservative on rate limits + memory), with a plan to tune up if observation shows headroom.

8. **`secondary_jobs[]` cardinality** — should the blog-post classifier ever return >2 secondary jobs? Recommend: cap at 2 secondaries in the prompt; if more would apply, that's a sign the post is genuinely cross-cutting and should be split into multiple chunks anyway. Encode the cap in the Zod schema.

9. **Customertip dangling status** — confirm at execution that the 119 `contentblock_customertip` rows still have no source table; if they do (Swoop ships the export between now and execution), include them in the customer_story composition (same persona-aggregation pattern).

10. **`region` column on `inspire_passage` and `customer_story`** — extracted from `ntag.area` overlap (per C.t2 §"inspire_passage" sketch) or from a Haiku pass? Recommend: rule-based from `ntag_ids[]` overlap with type='area' tags. The 21-row area taxonomy is small enough that joining the row's tags against it produces a clean region value (or null).

11. **Retry semantics on Haiku schema-violation** — if the model returns output that fails Zod parsing, retry once with a "your previous output was invalid: <error>" follow-up, or fail loud? Recommend: retry once, fail loud on second violation. Schema-violations on Haiku 4.5 should be rare with structured tool-use; if they're not rare, the prompt needs work, not a retry loop.

12. **Cost-attribution per pass** — does the cost ledger break down by pass (embed/classify/compose) or just track total? Recommend: per-pass + total, so a runaway prompt's spike is visible immediately. ~10 lines of extra code.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Cost overrun via prompt thrash** | Medium | Low–Medium | £10 hard cap; per-pass kill-switch; checkpointing means re-runs are nearly free against unchanged content; soft warning at £5. |
| **Persona-summary classifier produces uninformative output** | Medium | High (degrades `find_someone_who` quality) | Sample-quality HITL gate (verification step 5); prompt iteration via frontmatter version bump (re-runs only the affected pass); Haiku 4.5 is strong at structured summarisation but the prompt needs ~2–3 iterations. |
| **Aggregate-by-reviewer key aliasing** (two distinct people with same name) | Low–Medium | Medium (a few personas will conflate) | Sanity SELECT during execution (Open Q #1); composite with email if needed. Worst case: a few confused personas; the persona embedding's similarity-matching is forgiving. |
| **Voyage-3 rate limit hits** | Low | Low | Conservative batch=128, concurrency=4; exponential backoff; checkpointing means a hit stops at a batch boundary, not mid-batch. |
| **Haiku structured-output schema drift** | Low | Medium | Zod schema validation per call; retry-once-then-fail; existing `claude-llm.ts` patterns in the orchestrator handle this and we reuse them. |
| **`content_hash` version-bump cascade** | Medium | Low | The version field is the safety knob — bump only when the rule actually changes. A spurious bump triggers a full re-embed (~£0.05 for Voyage; ~£1 for Haiku). |
| **Blog HTML in chunks contains scripts / tracking pixels** | Low | Low | `html-to-text` (or the inline stripper) drops `<script>`, `<style>`, `<iframe>`. Sanity check on a fixture set in tests. |
| **Image annotation prompt drifts toward generic adjectives** | Medium | Medium (degrades `illustrate` retrieval) | Few-shot examples in the prompt anchor the vocabulary; HITL sample check (verification step 5) catches drift; the C.t6 vision pass dominates annotation quality anyway. |
| **`trip_card.embedding` content composition produces poor matches** | Low | Medium | The composition rule (`headline + vibe_line + first 500 chars of description`) is recorded as a sub-decision in C.t3a; tunable post-launch via re-embed without schema change. |
| **C.t6 ordering with image embedding** | Low | Low | C.t3a embeds only images with text input; the C.t6-then-C.t3a-rerun pattern handles the rest. Document in the C.t6 plan. |
| **Domain tables not yet populated** (i.e. C.t3 not yet done) | High at draft time | Blocks all of C.t3a | Plan dependency makes this explicit — C.t3 must close before C.t3a runs. The CLI's `--dry-run` mode is safe against an empty DB. |

---

## Coordination

- **C.t3** (transform): C.t3a's input contract is the populated domain tables. If C.t3 changes a column shape mid-flight, C.t3a's `content_hash` rule may need a version bump.
- **C.t4** (tool implementations): C.t4 reads from the five derived tables this task populates. The contract is the C.t2 schema; C.t3a is the population; C.t4 is the consumption.
- **C.t6** (image annotation pipeline): C.t6 fills `image.description` for the ~6.3K rows lacking it; C.t3a then embeds those rows via a follow-up `--mode=embed --source=image` run. C.t6 must run before that follow-up; the order is documented in the C.t6 plan.
- **C.t8** (runbooks): the Cloud Run Job invocation pattern, the cost-cap env var, the rate-limit tuning notes, and the prompt-iteration loop all become C.t8 documentation. C.t3a leaves stub notes in `handover/ops/`; C.t8 fleshes them out.
- **G.t0/G.t1/G.t5** (content): the content team can iterate on classifier prompts at `cms/prompts/etl/<classifier>/prompt.md` without code changes — same pattern as `cms/prompts/system/`. Frontmatter version bump triggers re-classification on next run. This is content-as-data (theme 2) applied to ETL prompts.

---

## Sub-step ordering (within this task)

Recommended sequence for a single execution agent:

1. **Read inputs (§"Inputs" above) end-to-end.** Don't skim. The 2026-04-30 customerreview finding is load-bearing; the 2026-04-29 image text-field finding cuts cost ~50%.

2. **Author the workspace surface scaffolding** — `pool.ts`, `voyage.ts`, `haiku.ts`, `prompts.ts`, `chunk.ts`, `hash.ts`, `cost.ts`, `checkpoint.ts`. Mock-test each.

3. **Author the four classifier prompts at `cms/prompts/etl/<classifier>/`** — each with frontmatter, system prompt, ~3–6 few-shot examples, Zod output schema. Don't iterate on prose yet; ship "draft 1" and let real-data sample output drive iteration.

4. **Author the embed-pass drivers** (`embed/*`) — eleven small files, mostly mechanical. Run `embed/tags.ts` first against a real (or mocked) DB to verify Voyage end-to-end before committing to the others.

5. **Author the classifier drivers** (`classify/*`) — four files. Run `classify/blog-post-job.ts` first (smallest volume, easiest to inspect output).

6. **Run `--dry-run` end-to-end** against `puma_dev` (assuming C.t3 has populated). Verify the planned operations + cost estimate look sane.

7. **Run `--mode=embed --source=tag`** as the smallest real-spend pass. Verify Voyage works against real Voyage; verify the 79 rows get embedded.

8. **Run each classifier pass individually** (`--mode=classify --source=<one>` four times). Read sample output after each; iterate on the prompt frontmatter (bump version) if quality is off.

9. **Run `--mode=all`** end-to-end. Cost should land near the £0.80 baseline.

10. **HITL sample-quality gate (Al)** — verification step 5. Iterate on prompts if needed.

11. **Re-run `--mode=all` to confirm idempotency** — should be ~zero writes.

12. **Author execution log** at the bottom of this file (when this draft becomes a closed plan): what landed, observed cost, observed wall-clock, what was deferred to C.t6 / C.t8, decisions taken.

13. **Run typecheck + lint + workspace tests.** Green before stopping.

---

## Anti-pattern guard checklist

Before this draft graduates to executable, every classifier output column must have a clear answer to: *"which tool, in which conversational moment, will use this?"*

- `blog_post.primary_job` / `secondary_jobs[]` → composes `inspire_passage` / `customer_story` / `trust_proof` / `inform_chunk` rows that the four matching tools query at request-time. ✓
- `customer_story.persona_summary` + `persona_embedding` → `find_someone_who` matches visitor-signal-embedding against `persona_embedding` cosine similarity (Mirror job). ✓
- `image.subject_tags` / `mood_tags` / `region_tags` / `tags[]` → `illustrate` filter narrowing + image retrieval ranking. ✓
- `blog_post.ntag_ids[]` → bridges visitor utterance → tag space inside `find_inspiring` / `lookup` / `find_proof` (the `find_tags_by_utterance` data primitive). ✓
- All five derived tables' `embedding` + `tsv` columns → backbone of the five hybrid-retrieval data primitives. ✓
- `region`, `mood`, `topic`, `topic_tags`, `activity_tags` → light filter narrowing inside the matching tools. ✓ (assuming Open Q #5 resolves the rule-based path).

Every column maps to a tool moment. If a future addition can't make this pass, that's the bottom-up trap; reject it.

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced as a question for downstream tasks.)*

*(Empty — this is a DRAFT awaiting HITL review.)*

---

## 2026-05-01 HITL ratification

Open questions resolved per Al's HITL session 2026-05-01. Status flipped from DRAFT to ready-for-execution.

### Resolutions

1. **Cost-cap default** (Q1): **`ENRICH_BUDGET_GBP=10` dev / £15 prod** with batch-boundary kill-switch. As recommended ("sane default" per Al). Soft warning at £5.
2. **Persona aggregation key** (Q2): **`name` only**. Drop email from the aggregation key entirely.
3. **Anonymous customerreview rows** (Q3): **keep in corpus**, do NOT aggregate into a persona. Each anonymous row lands in `customer_story` as an individual with `persona_summary = null` (or a synthetic `"anonymous traveller — [region]"` string when geographic anchors are present). Prose still useful for Mirror retrieval; just no coherent persona blob.
4. **`trust_proof.topic` classifier** (Q4): **Haiku via Anthropic Message Batches API**. Batch mode for ALL classifier passes (blog-post job classification, persona-summary generation, blog-tag normalisation, image annotation). 50% cost reduction; up to 24h latency acceptable for ETL.
5. **Sub-classifier for first-person blog rows** (Q5): part of the Haiku batch pass — let the classifier judge persona shape from prose.
6. **Region column extraction** (Q6): rule-based via `ntag.area` overlap as recommended.
7. **Other classifier and HTML-stripping decisions** (Q7–Q12): accept the agent's recommendations as documented in the plan body.

### Notes for the executing agent

- **Anthropic Message Batches API**: docs at https://docs.anthropic.com/en/docs/build-with-claude/batch-processing. Up to 100K requests per batch; results back within 24h; ~50% of standard message cost. Use for all classifier passes (`prompts/etl/<classifier>/...`).
- Anonymous customerreview rows still get embedded for vector retrieval — only the persona aggregation step is skipped.
- The `ENRICH_BUDGET_GBP` budget guard kills the run at the next batch boundary if cumulative spend exceeds the cap.
