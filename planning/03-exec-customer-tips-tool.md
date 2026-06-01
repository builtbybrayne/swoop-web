# 03 — Execution: customer_tips ingest + new `find_tips` tool

**Status**: **HITL-ratified 2026-05-27 — ready for execution.** Authored 2026-05-27 by worktree-agent-a6fb8f93bb7ae4041; HITL-ratified by Alastair the same day. See "2026-05-27 HITL ratification" addendum at the bottom of this file. **Hard prerequisite before dispatch**: the implementing agent's first task is to look up the `customer_tips` schema directly in the source MariaDB database (per Q1 resolution). Without that lookup the rest of the plan cannot be specified concretely.
**Chunk**: C (retrieval & data) — a new tool surface on the eight-tool intent-named contract.
**Implements**: [02-impl-retrieval-and-data.md §2.2 — tool surface (Inform job)](02-impl-retrieval-and-data.md), [02-impl-retrieval-and-data.md §2.5 — derived store shapes](02-impl-retrieval-and-data.md). Resolves the long-pending **customertip dependency** captured under [decisions.md C.26 — customertip pending](decisions.md) and [questions.md §"New from C.t0 inspection" item (a) — request for `customerreview` + `customertip` redacted export](../questions.md). Swoop has now delivered `customer_tips` (per Alastair 2026-05-27); this plan turns that data into a live conversational surface.
**Depends on**: customer_tips source delivery from Swoop (acknowledged received; **schema not yet read at plan-authoring time — flagged as the first pre-execution HITL/Swoop question below**); [03-exec-c-t3.md — SQL dump → Postgres transform](03-exec-c-t3.md) closed (the ETL substrate this plan grows into); [03-exec-c-t3a.md — embedding pass + Haiku ETL classifiers](03-exec-c-t3a.md) closed (the per-row embedding + classifier pattern this plan reuses); [03-exec-c-t4.md — eight handlers + data primitives](03-exec-c-t4.md) closed (the tool-handler + data-primitive scaffolding this plan extends); Gemini-embedding-001 / halfvec(3072) corpus convention live (per migration `009_embeddings_dim_3072.sql`); embedding cache live (per [03-exec-crosscut-embedding-cache.md — content-hash-keyed cache surviving TRUNCATE](03-exec-crosscut-embedding-cache.md)).
**Blocks**: nothing strictly downstream — this is a tool *addition*, not a precondition for any in-flight task. **Forward-coupled** to the AntiRepetition crosscut (see "Coordination" below): the tool ships with an `excludeIds` input from inception so that when AntiRepetition lands it can wire automatic shown-tracking without a tool-schema change.
**Produces**:
- A new MCP tool `find_tips` registered against the connector's eight-tool surface (now nine), with markdown description at `product/cms/prompts/tools/find_tips/description.md`.
- A new source-mirror table `customer_tip` populated by the ETL from Swoop's `customer_tips` export.
- A new derived table `customer_tip` (re-using the name — see "Naming note" in §"Components") OR a direct-query path against the source mirror (recommended **derived table**; see §"Open questions" #3).
- Tool I/O Zod schemas `FindTipsInputSchema` / `FindTipsOutputSchema` / `TipPublicSchema` in `product/ts-common/src/tools.ts`.
- A data primitive `findCustomerTips` at `product/connector/src/data/find-customer-tips.ts`.
- A handler at `product/connector/src/tools/find_tips.ts` using the shared `runHandler` helper.
- ETL surface: a `transformCustomerTip` in `product/ingestion/src/sql-transform/transformations/` + an enrich pass (chunk-and-embed + Haiku topic-classifier) in `product/ingestion/src/enrich/`.
- A SHOULD-rule in `product/cms/prompts/system/00_why.md` carving the line between `lookup` (Swoop-authored FAQ) and `find_tips` (traveller-sourced practical wisdom).
- Optional: a small prose-list widget rendering path (recommend prose-only at ship, widget later — see §"Open questions" #9).
- Harness scenario coverage at `product/harness/scenarios/` exercising the practical-question moment.
- Decision-log entries for any plan-emergent calls (likely candidates: tool name, derived-vs-direct, topic taxonomy, per-call result count, UI shape).
- Closure of the customertip thread under [questions.md](../questions.md).

**Estimate**: ~1 day of focused work once the source schema is read and Open Q #1 (source shape) is closed. Half a day for ETL + enrich + derived table; half a day for tool handler + schemas + description + system-prompt SHOULD rule + harness scenario. The pattern is well-trodden — this is `find_someone_who`'s little sister.

---

## ★ Read this first — the WHY of customer_tips

> **Before you touch a migration or a handler stub, re-read [02-impl-retrieval-and-data.md §"★ Read this first — the WHY of chunk C"](02-impl-retrieval-and-data.md) end-to-end.** That section names the four+1 jobs the data does for the conversation (Inspire / Mirror / Reassure / Inform / Propose-options). This plan adds a *second shape of Inform* and must not be designed bottom-up from the data Swoop happens to have shipped.

The conversational moment `find_tips` exists to serve is **practical mid-conversation wisdom**. A visitor mid-flow asks something concrete and on-the-ground:

- *"What should I pack for cold weather hiking?"*
- *"How do I deal with the Patagonian wind?"*
- *"What's the deal with tipping?"*
- *"Altitude sickness in Torres del Paine — is it a thing?"*
- *"Best way to handle ATM cash in El Calafate?"*

These questions are different in shape from the Swoop-authored FAQ surface. Swoop's FAQ (`faqitem` → `inform_chunk` → `lookup`) is **canonical, brand-voiced, exhaustive on the topics it covers, sparse on the topics it doesn't**. Traveller tips are **lived, granular, idiosyncratic, plural by nature**. Both serve the Inform job; both belong on the surface; neither subsumes the other.

The discipline test for this plan: every design choice must trace to *"a visitor asks a practical mid-flow question and the agent reaches for traveller-sourced tips because [reason]"*. If a design choice can only be justified from the data side ("we have tips, we should expose them") — that's the bottom-up trap returning. Re-anchor.

**Why a new tool and not a `lookup` widening:**

- Voice and authority are different. `lookup` returns Swoop-authored prose the agent can quote as "Swoop's guide says…". `find_tips` returns traveller voice the agent should attribute as "travellers who've done this often say…". Smushing both into `lookup` muddies the voice attribution the agent's prose has to do.
- Granularity is different. `lookup`'s `inform_chunk` rows are 1–3 paragraph chunks of structured guides. Tips are 1–3 *sentences* per row, per Alastair: *"It's just a bunch of useful tips that users have come up with."* No aggregation, no grouping into themes — the tip is the unit.
- Source provenance is different and Sonnet should know the difference. Mixing them under one tool means the agent can't reliably tell whether what came back is canonical-Swoop or traveller-anecdote, which it needs to know to attribute correctly.
- Per the existing eight-tool architecture (decision C.25), tool surfaces are named after **the conversational moment**, not the data. Practical-wisdom-from-prior-travellers is its own moment. It earns its own tool.

**Why NOT merge into the existing `customer_story` corpus** (per Alastair's explicit 2026-05-27 direction):

- `customer_story` powers the **Mirror** job (`find_someone_who`) — *"see yourself in someone who's done it"*. The retrieval mechanism is persona-shaped: visitor reveals a persona signal ("solo female in her 40s"), agent matches against a per-reviewer-aggregated persona-summary embedding (decision C.30). One row per reviewer. The whole point is coherent personas.
- Tips don't aggregate that way. *"What I learned: bring a buff for the wind"* is not persona-shaped. Two tips from the same person on different topics don't belong in the same row. The granularity is per-tip, not per-person.
- Conflating them would either:
    - Pollute `find_someone_who` retrieval with non-persona-shaped prose, degrading Mirror quality; OR
    - Force tips into the persona-aggregation shape, losing per-tip granularity.

Both outcomes lose. Separation is correct.

---

## Outcomes

When this task is done:

- The connector advertises **nine intent-named tools** over MCP-HTTP — the existing eight plus `find_tips`. The orchestrator's tool-discovery surfaces it with its full markdown description loaded from `cms/prompts/tools/find_tips/description.md` per C.34 (markdown owns prose; runtime loads it).
- A Sonnet turn over the live agent can route into `find_tips` when a visitor asks a practical mid-flow question (e.g. *"any tips for handling the wind?"*), receive a Zod-validated row-shaped response, and weave 2–4 tips into `<utter>` with proper traveller-voice attribution.
- The connector's data tier holds:
    - A source-mirror `customer_tip` table populated from Swoop's `customer_tips` export by the ETL.
    - A derived `customer_tip` table populated by the enrich pass, with `text`, `topic_tags[]`, `region` (where determinable), `embedding`, `tsv`, `content_hash`, per-tip granularity (one row per tip, **no aggregation** — per Alastair's direction).
- Topic classification at ETL via Haiku (per the [03-exec-c-t3a.md §D Haiku ETL classifier pattern](03-exec-c-t3a.md)) tags each tip with 1–N topics drawn from a small fixed taxonomy (recommended ~8 topics — see §"Open questions" #5).
- Retrieval at runtime is **hybrid** (pgvector cosine + tsvector text search via RRF) over the derived `customer_tip` table, mirroring the four other content tools' pattern.
- The tool returns **3–5 tips per call** (default 4) with `excludeIds` supported from inception, so AntiRepetition can wire shown-tracking without a schema change.
- The system prompt `00_why.md` carries an explicit SHOULD-rule disambiguating `lookup` from `find_tips`, per the [find-someone-who debug lesson on imperative SHOULD-rule coverage](#) (no review file at that exact path yet — see "Cross-references" caveat below).
- Harness coverage: at least one scenario in `product/harness/scenarios/` exercises the *"practical mid-flow question → agent reaches for find_tips"* moment with a `judge_rubric` assertion on tool selection + attribution.

**Not outcomes**:

- No widget render work beyond the prose-list path. A card-shape rendering (per the [03-exec-crosscut-find-options-polymorphism.md — ProposalCard discriminated union](03-exec-crosscut-find-options-polymorphism.md) precedent) is named as a forward extension but deferred until prose-only proves insufficient.
- No customertip dependency closure beyond this tool — the [questions.md item (a) — `customerreview`+`customertip` redacted export request](../questions.md) gets a back-link from this plan and is moved to "Closed" once the tool ships.
- No revisit of the `lookup` tool's surface or behaviour. `lookup` is unchanged.
- No revisit of `find_someone_who` or `customer_story`. Both are unchanged.
- No AntiRepetition implementation — that's a parallel crosscut (see "Coordination").
- No retroactive widening of the other eight tools' descriptions. Only `00_why.md` and the new `find_tips/description.md` get authored.

---

## Out of scope (name it so future agents don't drift)

- **No aggregation of tips into themes or per-author groupings.** Per Alastair's explicit 2026-05-27 direction: *"It's just a bunch of useful tips that users have come up with."* One row per tip. If you find yourself reaching for `GROUP BY author` or `aggregate-by-topic`, stop — you're solving a different problem.
- **No merging into `customer_story` / `find_someone_who`.** They serve Mirror; this serves Inform. Different shape, different moment, different retrieval mechanism. Per Alastair's explicit 2026-05-27 direction.
- **No `lookup` widening.** `lookup` stays Swoop-authored FAQ-shaped. `find_tips` stays traveller-sourced. Separation is load-bearing.
- **No widget design in this plan.** Recommend prose-only at ship; flag widget as a forward extension if quality signal warrants. The card-shape precedent is named in the cross-references for the future agent who picks that up, not actioned here.
- **No AntiRepetition logic in the handler.** The handler accepts `excludeIds: number[]` and threads it into the SQL `WHERE id NOT IN (...)` clause. The *population* of `excludeIds` is owned by the AntiRepetition crosscut — out of scope here.
- **No PII surface.** Tips are sales-curated published content (same posture as `customerreview` per C.26 — public-domain prose, no scrubbing). If the schema reveals customer-identifying fields (email, IP, etc.), they get filtered at ETL boundary, same pattern as `swooper_*` on `trip` (decision C.14).
- **No sales-team prompt curation work.** That's the separate [03-exec-crosscut-sales-team-prompt-curation.md — sales-team prompt curation](03-exec-crosscut-sales-team-prompt-curation.md) workstream.
- **No Mirror redesign.** That's settled work elsewhere.
- **No multi-region / multi-vertical generalisation.** Patagonia-only at ship, same as the rest of Puma.

---

## Inputs (files to read before authoring)

- **The customer_tips source data.** Wherever Swoop has dropped it (likely `data/customer_tips_*.sql` or similar — the C.26 customerreview supplementary dump landed at `data/customerreview_tables_-_swoop-patagonia_prod.sql` per [03-exec-c-t3.md — SQL dump → Postgres transform](03-exec-c-t3.md), this likely follows the same pattern). **Read the schema first; it drives every other choice in this plan. Flagged as the #1 pre-execution HITL/Swoop question.**
- [02-impl-retrieval-and-data.md ★ Read this first — the WHY of chunk C](02-impl-retrieval-and-data.md) — the four+1 jobs framing. Re-read in full before authoring.
- [03-exec-c-t3.md — SQL dump → Postgres transform (data movement)](03-exec-c-t3.md) — the ETL pattern. The `transformCustomerreview` shape in `product/ingestion/src/sql-transform/transformations/customerreview.ts` is the direct precedent for `transformCustomerTip`.
- [03-exec-c-t3a.md — embedding pass + Haiku ETL classifiers + derived-table population](03-exec-c-t3a.md) — the enrich pattern. The `classify/persona-summary.ts` shape is the direct precedent for the topic-classifier; the `embed/customer-stories.ts` shape is the direct precedent for the embed pass over tips. **Note: the persona-aggregation step does NOT apply to tips** — one-row-per-tip is the rule.
- [03-exec-c-t4.md — eight handlers + data primitives + MCP registration](03-exec-c-t4.md) — the handler + primitive + `runHandler` pattern. The `find_someone_who.ts` + `find-customer-stories.ts` pair is the cleanest direct precedent; mirror its shape with the persona-summary specifics replaced by tip specifics.
- `product/connector/src/tools/find_someone_who.ts` + `product/connector/src/data/find-customer-stories.ts` — the live code precedent.
- `product/connector/migrations/006_customerreview_tables.sql` — the `customerreview` + `customerreview_trip` migration; the direct precedent for `customer_tip` migration shape (source-mirror + derived).
- `product/connector/migrations/003_derived_tables.sql` — the existing derived-table conventions (`embedding`, `tsv`, `content_hash`, `source_provenance`, `ntag_ids`, `region`).
- `product/ts-common/src/tools.ts` — where the new Zod schemas land. Read the `FindSomeoneWho*` group as the precedent shape.
- `product/cms/prompts/tools/find_someone_who/description.md` — the description-voice precedent. The new `find_tips/description.md` should match its production-quality first-pass posture per C.34.
- `product/cms/prompts/system/00_why.md` — the SHOULD-rule home. The [find-someone-who debug lesson](#) (no exact file at the brief-cited path) showed that every tool needs imperative coverage in the WHY prompt; `find_tips` needs the same treatment.
- [decisions.md — C.26 customerreview live; customertip pending](decisions.md) — the long-pending dependency this plan resolves.
- [questions.md — open Swoop-side asks](../questions.md) §"Data pipeline" — the customertip request that's about to close.
- [03-exec-crosscut-find-options-polymorphism.md — ProposalCardPublicSchema discriminated union](03-exec-crosscut-find-options-polymorphism.md) — the card-shape precedent for the optional future widget path.
- [03-exec-crosscut-anti-repetition.md](03-exec-crosscut-anti-repetition.md) **IF AUTHORED** at execution time — the parallel crosscut this plan is forward-coupled to. **Not authored yet at plan time (2026-05-27); see "Coordination".**
- [inbox.md item 3 (2026-04-27) on contentblock_* subtypes](../inbox.md) — historical context on the customertip dependency.

---

## Architectural principles

Carried forward from chunk C; specialised for this surface:

1. **Top-down from the conversational moment, never bottom-up from the data.** The tool exists because visitors ask practical mid-flow questions and traveller wisdom answers them. The data shape serves that moment; not the other way around.
2. **Tip = unit. No aggregation.** One row per tip. The tip itself is the retrievable surface. Per Alastair's explicit 2026-05-27 direction.
3. **Separation from `customer_story` is load-bearing.** Different table, different tool, different retrieval mechanism. Don't conflate at any layer of the stack.
4. **Hybrid retrieval, same pattern as the other content tools.** pgvector halfvec(3072) cosine over `embedding` + tsvector GIN over `tsv`, combined via RRF (k=60 per [03-exec-c-t4.md §"Open questions" #4 — RRF + ef_search defaults](03-exec-c-t4.md)). No bespoke retrieval mechanism.
5. **Thin handler, brain in the primitive.** Per [03-exec-c-t4.md §"Architectural principles" #2 — thin handlers, brain-in-the-primitives](03-exec-c-t4.md). The handler is ~30–50 lines: validate input → call `findCustomerTips` → project to `TipPublicSchema` → return. SQL lives in the primitive.
6. **Markdown owns prose; runtime loads it.** Per C.34. The description lives in `cms/prompts/tools/find_tips/description.md`; the `TOOL_DESCRIPTIONS` map carries only a runtime label. Fail-fast at boot if the markdown is missing, per the C.t4 HITL ratification (Q3: fail-fast on ALL tools, not just conversational ones).
7. **`excludeIds` from inception.** The forward-coupling to the AntiRepetition crosscut (see "Coordination") means the input schema must carry `excludeIds: number[]` from day one. Threaded into the SQL as `WHERE id <> ALL($excludeIds)`. Cheap to support now; expensive to retrofit if it becomes a schema-break.
8. **Topic taxonomy is small and fixed at ship.** ~8 topics, drawn from observation of the actual data once read (Open Q #5). Topics live as `topic_tags TEXT[]` on the derived table; the classifier emits 1–N tags per tip. Filtering is optional at retrieval time.
9. **Region is best-effort, not load-bearing.** Where a tip mentions a specific location, the classifier extracts a region tag (mirroring the `ntag.area` overlap rule in [03-exec-c-t3a.md §D.2 — persona-summary classifier](03-exec-c-t3a.md)). Most tips are likely Patagonia-wide; that's fine — region stays NULL.
10. **One LLM call per turn at request path** — Sonnet at the orchestrator. Haiku runs only at ETL (topic classifier). No request-path LLM inside the tool.
11. **Voice attribution is the agent's job, not the tool's.** The tool returns `TipPublicSchema` rows; the prose attribution (*"travellers who've done this often say…"*) is owned by the description.md + the `00_why.md` SHOULD-rule. The tool surface stays content-neutral.

---

## Components, file paths, signatures (sketches — not executable code)

### Naming note

Two reasonable names for the new tables:

- **Source mirror**: `customer_tip` — singular, matches `customerreview` precedent.
- **Derived table**: `customer_tip` — singular, matches `customer_story` precedent.

These collide (same name). Two options:
- (a) Source mirror as `customer_tip`, derived as `customer_tip_derived` (ugly).
- (b) Source mirror as `customer_tip_source`, derived as `customer_tip` (cleaner — the derived is the canonical surface, source is the substrate).
- (c) Source mirror as `customer_tip`, derived as `customer_tip` in a separate schema namespace (over-engineered for Puma).

**Recommendation**: (b). The derived table is what handlers query; it deserves the clean name. Document as the rule and flag the asymmetry with `customerreview` (which uses the singular name for the source mirror) — that asymmetry is acceptable because `customerreview` has no derived table (`customer_story` is the derived; the source keeps its own name). Tips collapse the layers — no need for separate prose between source and derived since the tip IS the unit.

**Alternative recommendation**: (a-modified) **skip the source mirror entirely.** ETL writes directly into the derived `customer_tip` table. Lose nothing because there's no transformation between source and derived (no chunking — the tip is already a row; no aggregation — Alastair said no aggregation). Flag for HITL.

**HITL ask**: pick between (b) or (a-modified-skip-source-mirror). Default to (a-modified) unless the source data has fields we want to preserve raw for debugging that we wouldn't put on the derived (e.g. raw author email — but that would be PII-filtered anyway).

### Migration

`product/connector/migrations/013_customer_tip_table.sql` (next number after the live `012_embedding_cache.sql`).

Shape (assuming Open Q #1 resolves the source schema; sketch below uses placeholder fields):

```text
CREATE TABLE customer_tip (
  id              INTEGER PRIMARY KEY,                  -- carry source id forward for re-runs
  source_id       TEXT NOT NULL,                        -- source-system id per C.33 (TEXT for forward-compat)
  text            TEXT NOT NULL,                        -- the tip itself, 1–3 sentences typically
  topic_tags      TEXT[] NOT NULL DEFAULT '{}',         -- Haiku-classified, ~8 topic taxonomy
  region          TEXT,                                 -- best-effort, NULL where unknown
  ntag_ids        INTEGER[] NOT NULL DEFAULT '{}',      -- from ntags_lookup if present in source, else empty
  source_provenance TEXT NOT NULL,                      -- 'customer_tip' (matches the derived pattern)
  embedding       halfvec(3072),                        -- Gemini-embedding-001 per migration 009
  tsv             tsvector,                             -- to_tsvector('english', text)
  content_hash    TEXT,                                 -- sha256(text || version) for idempotent re-runs
  embedded_at     TIMESTAMPTZ,
  classified_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX customer_tip_embedding_idx ON customer_tip USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX customer_tip_tsv_idx ON customer_tip USING gin (tsv);
CREATE INDEX customer_tip_topic_tags_idx ON customer_tip USING gin (topic_tags);
CREATE INDEX customer_tip_region_idx ON customer_tip (region) WHERE region IS NOT NULL;
```

If the source-mirror layer is kept (Option (b) in naming note), add a parallel migration for `customer_tip_source` with the raw fields; that's a routine source-mirror in the C.t3 pattern.

### ETL (sql-transform)

`product/ingestion/src/sql-transform/transformations/customer-tip.ts` — mirrors `customerreview.ts`:

- Read source rows from the customer_tips dump.
- Filter at boundary: drop deleted, drop PII columns (whatever Open Q #1 reveals — email, IP, etc.), drop unpublished if there's a publish-state field.
- Whitelist: id, text content, optional region hint, optional ntag links.
- Per Option (a-modified): write directly into `customer_tip` (derived) with `embedding` + `tsv` + `content_hash` left NULL for the enrich pass.
- Idempotent: `INSERT … ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, …` — same posture as `customerreview`.

### Enrich (embed + classify)

`product/ingestion/src/enrich/embed/customer-tips.ts` — mirrors `embed/customer-stories.ts`:

- Read rows where `content_hash IS DISTINCT FROM expected_hash`.
- Embed via Gemini-embedding-001 (per the corpus convention; routed through the embedding cache per [03-exec-crosscut-embedding-cache.md — content-hash-keyed cache](03-exec-crosscut-embedding-cache.md)).
- Update `embedding`, `tsv = to_tsvector('english', text)`, `content_hash`, `embedded_at`.

`product/ingestion/src/enrich/classify/tip-topic.ts` — new classifier mirroring `classify/persona-summary.ts` structure but with **no aggregation**:

- Read tips where `topic_tags = '{}'` or where the prompt-version hash on the row mismatches the live prompt's frontmatter version.
- Call Haiku with the topic-taxonomy prompt + the tip text.
- Persist `topic_tags TEXT[]` + optional `region` + `classified_at`.

`product/cms/prompts/etl/tip-topic/prompt.md` + `output-schema.ts` — the classifier prompt + Zod output shape. Mirrors the `etl/persona-summary/` and `etl/blog-tag-normalisation/` patterns:

- Frontmatter: `version: 1`, `model: claude-haiku-4-5-20251001`, `temperature: 0.0`.
- System prompt: defines the ~8-topic taxonomy + ~5 few-shot examples covering edge cases.
- Output schema: `{ topic_tags: string[] (subset of taxonomy), region?: string }`.

**Recommended topic taxonomy** (8 categories — verify against actual data, Open Q #5):
- `packing` — clothes, gear, layering, what to bring
- `weather` — wind, rain, cold, heat, seasonal
- `money` — tipping, ATMs, cash vs card, currency
- `safety` — altitude, water, wildlife, route-finding
- `transit` — buses, transfers, airports, border crossings
- `food` — restaurants, dietary, picnic, water
- `accommodation` — hotels, refugios, camping
- `etiquette` — language, customs, local norms

(Per Alastair's "design top-down" memory rule: this list is a draft starting point grounded in plausible visitor questions. Tune against actual tip content during execution.)

### ts-common — tool I/O schemas

`product/ts-common/src/tools.ts` additions (mirroring `FindSomeoneWho*`):

```text
FindTipsInputSchema = z.object({
  topic: z.string().min(1).max(200),       // visitor's topic/keyword (free-text)
  region: z.string().optional(),           // optional filter on derived.region
  excludeIds: z.array(z.number().int()).optional().default([]),
});

TipPublicSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  topic_tags: z.array(z.string()),
  region: z.string().nullable(),
});

FindTipsOutputSchema = z.object({
  tips: z.array(TipPublicSchema),
  count: z.number().int(),
});
```

The output deliberately omits `embedding` / `tsv` / `content_hash` / `source_provenance` per chunk-C principle 6 — server-side only. The `TipPublicSchema` IS the wire shape.

### Data primitive

`product/connector/src/data/find-customer-tips.ts`:

```text
findCustomerTips(input: { topic: string; region?: string; excludeIds?: number[]; limit?: number }): Promise<Tip[]>
```

- Embeds `topic` via `embedTextForSearch` (cached per session per the existing `embed-query.ts` pattern in [03-exec-c-t4.md §"data primitives" — embed-query.ts](03-exec-c-t4.md)).
- Hybrid SQL: CTE-based RRF over pgvector + tsvector, identical shape to the four other content tools, against `customer_tip`.
- Optional region narrowing: `WHERE region = $region OR region IS NULL` (recommend OR with NULL — region-tagged tips surface when filtered, but Patagonia-wide tips are still useful even with a region filter set; alternative is strict `=` — flag for HITL during execution).
- Optional `excludeIds` clause: `AND id <> ALL($excludeIds)`.
- Limit: parameter-driven, default 4 (see Open Q #7).
- Returns full-shape Tip rows; the handler does the public projection.

### Handler

`product/connector/src/tools/find_tips.ts` — using the `runHandler` helper per [03-exec-c-t4.md §"Error handling — the shared helper"](03-exec-c-t4.md):

```text
export default runHandler(
  'find_tips',
  FindTipsInputSchema,
  FindTipsOutputSchema,
  async (input, deps) => {
    const tips = await findCustomerTips({
      topic: input.topic,
      region: input.region,
      excludeIds: input.excludeIds,
      limit: 4,
    }, deps);
    return {
      tips: tips.map(toTipPublic),
      count: tips.length,
    };
  },
);
```

Eight lines of body. The brain is in `findCustomerTips`.

### Tool description

`product/cms/prompts/tools/find_tips/description.md` — production-quality first-pass per C.34 + the C.t4 description-voice precedent. Must explicitly:

- Name the conversational moment: *"visitor asks a practical mid-conversation question and you want traveller-sourced wisdom rather than canonical Swoop guidance"*.
- Carve the line vs `lookup`: *"if the question maps to a Swoop-authored FAQ or guide (where canonical Swoop voice is right), prefer `lookup`"*.
- Carve the line vs `find_someone_who`: *"if the visitor is revealing a persona signal and you want to mirror them in someone who's done it, prefer `find_someone_who`"*.
- Voice attribution guidance: *"weave returned tips into prose with traveller-voice attribution — 'travellers who've done this often say…' / 'something visitors tell us afterwards…' — not as Swoop's voice"*.
- Inputs/outputs reference.
- Example use cases (2–3 short scenarios — packing, tipping, wind).

### Tool registration

`product/connector/src/tools/index.ts` — add `find_tips` to the `registerAllTools` registration list. Mirrors the existing eight-tool block; the description-loader's fail-fast posture (HITL ratification Q3 in [03-exec-c-t4.md §"2026-05-01 HITL ratification" Q3](03-exec-c-t4.md)) applies — boot fails if `find_tips/description.md` is missing.

### System prompt SHOULD-rule

`product/cms/prompts/system/00_why.md` — add a SHOULD-rule in §4 (or whichever section covers tool-selection guidance) per the [find-someone-who debug lesson on imperative SHOULD-rule coverage](#) (no review file at the brief-cited path; the lesson is captured in the brief itself and informally in commit `0d00d62 — Mirror SHOULD-rule + harness assertion`). Shape:

> **SHOULD** reach for `find_tips` when the visitor asks a practical mid-flow question and traveller wisdom serves them better than canonical Swoop guidance — *"any tips for handling the wind?"*, *"what about tipping?"*, *"what should I pack?"*. Prefer `lookup` when the question maps to a Swoop-authored guide and canonical Swoop voice is right. Prefer `find_someone_who` when the visitor reveals a persona signal and the moment is Mirror, not Inform.

(Exact prose at execution time matches the voice of the surrounding section; this is the substance.)

### Harness scenario

`product/harness/scenarios/<cluster>/<scenario-name>.yaml` — at least one new scenario in the Inform-pattern cluster:

- Visitor utterance: *"any tips for dealing with the Patagonian wind?"* (or similar practical mid-flow).
- `judge_rubric` assertion: agent called `find_tips` (not `lookup`); agent attributed the tips with traveller-voice (not Swoop voice); agent did not invent tips.
- Stop-judge gate: turn count ≤ N.

### Optional widget (deferred)

`product/ui/src/widgets/TipList.tsx` — prose-list widget rendering. Recommend **deferring** this until prose-only ship reveals quality signal. If the agent's prose-weave handles 2–4 tips elegantly, no widget is needed. If users want to "see all the tips" or "save these for later", revisit with a card-shape per the [03-exec-crosscut-find-options-polymorphism.md — ProposalCardPublicSchema](03-exec-crosscut-find-options-polymorphism.md) precedent (`TipCardPublicSchema` as a new variant in the discriminated union).

---

## Verification

Task is done when:

1. `cd product && npm run typecheck --workspaces --if-present` is green across all six workspaces.
2. `cd product && npm run lint --workspaces --if-present` introduces zero new lint problems.
3. `cd product && npm test --workspaces --if-present` is green, including:
    - New `customer_tip` ETL transformation test (mirroring `customerreview.test.ts` shape).
    - New `find-customer-tips.test.ts` data-primitive unit test (SQL shape, RRF combination, excludeIds clause, optional region clause, null-region behaviour).
    - New `find_tips.test.ts` handler test (input validation, output validation, primitive composition).
    - New tip-topic classifier prompt-loader test (frontmatter parse, schema parse).
4. **Per-tool integration test against populated `puma_dev`**: `find_tips({ topic: "Patagonian wind" })` returns ≥1 TipPublic; `find_tips({ topic: "tipping etiquette" })` returns ≥1 TipPublic; `find_tips({ topic: "altitude sickness" })` returns ≥1 (or `count: 0` with explanation if the corpus is sparse on that topic — flag, don't fail).
5. **Description-load contract test**: connector boot loads `find_tips/description.md` into the registered tool description; **fails fast at boot** if the file is missing (test verifies the failure mode, per the C.t4 HITL ratification Q3).
6. **End-to-end smoke test**: a real Sonnet turn through the orchestrator selects `find_tips` (not `lookup`, not `find_someone_who`) for the visitor utterance *"any tips for handling the wind in Torres del Paine?"*. Captured transcript or screenshot in the execution log.
7. **Harness scenario passes**: the new scenario at `product/harness/scenarios/<cluster>/<name>.yaml` exercises the practical-question moment and passes the `judge_rubric` assertions.
8. **Sample-quality HITL gate (Al)**: Al reads ~10 randomly-selected `customer_tip.text` + `topic_tags` rows post-classify. Sign-off if voice/coverage/topic-tag accuracy feels right; iterate prompt frontmatter version + re-classify if not.
9. **Idempotent re-run**: running the enrich pass a second time produces zero writes (every row's `content_hash` matches).
10. **AntiRepetition forward-compatibility check**: passing `excludeIds: [...]` to `find_tips` correctly excludes those rows from results.
11. Decision-log entries added in `planning/decisions.md` for any C.tip-emergent calls (likely candidates: tool name, derived-vs-direct, topic taxonomy, per-call default, region-filter posture, naming asymmetry with `customerreview`).
12. Execution log appended to the bottom of this plan summarising what landed, what was deferred, what surfaced for downstream tasks (notably the AntiRepetition crosscut).
13. [questions.md item (a) — `customerreview`+`customertip` redacted export](../questions.md) moved to the "Closed" section with date + this plan's link.
14. The [decisions.md C.26 — customertip pending](decisions.md) entry updated with closure note + this plan's link.

---

## Open questions (for HITL — recommended defaults inline)

Numbered for the HITL ratification pass.

### 1. Source data shape — what's the schema of Swoop's `customer_tips` table?

**RESOLVED (2026-05-27 HITL) — INVESTIGATE**: the implementing agent's **first task** is to look up the `customer_tips` schema directly in the source **MariaDB** database. The dump-file-driven framing originally proposed in this section is superseded: the MariaDB database itself is the source of truth, and the schema lookup happens there.

This is a **hard prerequisite for implementation dispatch**, not a HITL question routed to Swoop. The plan cannot fully specify columns, types, PII surfaces, region columns, or publish-state columns until the lookup completes — every downstream choice (transformation filter, classifier prompt, derived-table column list) sharpens against the real schema.

**An additional Step 0 is therefore inserted into the implementation order in §"Sub-step ordering"**:

> **0. MariaDB schema lookup** — connect to the source MariaDB instance and read the `customer_tips` table definition. Capture: column names + types, row count (live + soft-deleted if a deletion flag exists), PII surface (email, IP, name, etc.) for the ETL boundary filter, optional region/country column, optional publish-state column, optional `ntag` / classification linkage. Update the placeholder migration shape in §"Components" → "Migration" to match the actual fields. Confirm the ~119-row estimate (carried forward from `contentblock_customertip` junction count under C.t0) is in the right ballpark.

Only once that lookup is in hand does the rest of the plan become concretely actionable. The most-likely shape (sketch, for orientation only — actual schema overrides):

```
customer_tips (
  id, text (or content), trip_id?, contentblock_id?, name?, region/country?,
  date?, source/medium?, is_published?, created_at, modified_at,
  deleted?, deleted_at?, created_by_id?, modified_by_id?, deleted_by_id?
)
```

The 119 `contentblock_customertip` junction rows from C.t0 suggest the source table is ~119 rows give-or-take (some may be unpublished/deleted). Sparse compared to `customerreview` (~2,563); informs Open Q #7 (per-call result count) — keep default modest.

### 2. Tool name — `find_tips` (LOCKED)

**RESOLVED (2026-05-27 HITL)**: **`find_tips`** — locked. Aligns with the `find_*` convention across the existing content tools (`find_inspiring`, `find_someone_who`, `find_proof`, `find_options`). The other candidates (`lookup_tips`, `get_tips`) are dropped.

Three reasons (carried from the original recommendation, retained for record):
- **Convention alignment**: `lookup` is the deliberate outlier — it's "the FAQ-shaped one" and its name carries that connotation. Adding a second `lookup_*` would dilute that signal. `find_tips` is unambiguously parallel to `find_someone_who`.
- **Intent-named per C.25**: *"finding traveller tips on a topic"* reads as the conversational move. `lookup_tips` reads as a database verb; `get_tips` reads as an imperative — both wrong shape.
- **Tool-selection accuracy**: Sonnet picks tools partly by name affinity. `find_tips` cleanly slots into the "I'm looking for retrieval content" mental model the existing tools already establish.

### 3. Derived table or direct query?

**RESOLVED (2026-05-27 HITL)**: **derived table** — locked. The MariaDB source table will not have embeddings (or `topic_tags`, `tsv`, `content_hash`); we need those columns on a derived table that the connector queries. Option (a-modified) in §"Naming note" — skip the source mirror, ETL writes directly into the derived shape.

Reasons (carried from recommendation, retained for record):
- Consistent with the rest of the eight-tool surface — every content tool queries a derived table, not a source mirror.
- The enrich-pass columns (`embedding`, `tsv`, `content_hash`, `topic_tags`) belong on the queried surface anyway; a separate source mirror would just copy them through, adding infrastructure for no gain.
- Idempotent re-runs are clean: `ON CONFLICT (id) DO UPDATE` against the derived works the same as against a source mirror.
- Saves a migration + a table + an ETL pass.

**Carry-through to execution**: the Step-0 MariaDB schema lookup (per Q1) may surface a debug-only field worth keeping raw. If it does, the executing agent can add a thin source mirror at that point; default posture is skip-source-mirror unless the schema lookup turns up something specific.

### 4. Embedding pass shape

**RESOLVED (2026-05-27 HITL)**: defaults aligned, no change needed.

- **Per-row, no chunking, no aggregation.** Mirrors [03-exec-c-t3a.md §C — per-source-row embedding](03-exec-c-t3a.md) but simpler — tips are already 1–3 sentences each, so no chunking step is needed.
- Embedding model: **Gemini-embedding-001 / halfvec(3072)** per the current corpus convention (migration `009_embeddings_dim_3072.sql`).
- Cache: route through the [03-exec-crosscut-embedding-cache.md — content-hash-keyed cache](03-exec-crosscut-embedding-cache.md) so re-runs against unchanged content are free.
- `content_hash = sha256(text || '|' || version)` with version starting at 1.

### 5. Topic classification — what taxonomy?

**RESOLVED (2026-05-27 HITL)**: accept the 8-topic draft taxonomy as the starting point ("rest as you recommended"). **Haiku at ETL with the 8-topic taxonomy named in §"Components" → "Enrich" above.** Light, fixed, drawn from observation of plausible visitor questions.

The taxonomy:
- packing / weather / money / safety / transit / food / accommodation / etiquette

Per [03-exec-c-t3a.md §D — Haiku ETL classifier passes](03-exec-c-t3a.md), this runs once per `content_hash` change, persists to `topic_tags TEXT[]`, never on the request path. Pricing: pence (~119 tips × 1 Haiku call ≈ <£0.10 baseline; Anthropic Message Batches API per [03-exec-c-t3a.md HITL Q4 — Haiku via Message Batches](03-exec-c-t3a.md) cuts that in half).

**Carry-through to execution**: tune against actual data once the Step-0 MariaDB schema lookup (per Q1) plus a first-pass classify run reveal the natural clusters. Likely candidates for post-data adjustments (named for the executing agent, not committed):
- May need to merge `food` + `accommodation` (if sparse).
- May need to split `safety` (altitude / wildlife / route-finding).
- May need to add `language` (if many tips are about Spanish phrases).

The classifier's frontmatter `version: 1` field means a taxonomy update is a one-line prompt-version bump + a re-classify pass; cheap to iterate.

### 6. Retrieval mechanism — hybrid (RRF) or pure cosine?

**RESOLVED (2026-05-27 HITL)**: **hybrid (pgvector cosine + tsvector RRF, k=60)** — same as the four other content tools. Recommendation accepted as ratified.

Reasons (carried for record):
- Tips are short; cosine alone risks ranking on superficial semantic overlap. Adding tsvector keyword matching grounds retrieval against literal terms ("wind", "tip", "ATM") that visitors often use directly.
- The full RRF helper is already shipped at `product/connector/src/data/hybrid-search.ts` per [03-exec-c-t4.md §"data primitives" — hybrid-search.ts](03-exec-c-t4.md); reusing it costs nothing.
- Quality risk asymmetric: pure cosine is fine for long-form prose (`customer_story` works) but risky for short tips where literal keywords carry more signal.

### 7. Per-call result count

**RESOLVED (2026-05-27 HITL)**: **default 4** — recommendation accepted. Range 3–5; hard cap 6. Mirrors `find_someone_who`'s default (1–3) with a slight bump for the multi-tip framing — visitors asking "any tips for X" expect multiple, not one.

Tradeoffs (retained for record):
- More results = better coverage, more material for the agent to weave.
- Too many = dilutes per-tip attention in the prose, more `excludeIds` noise for AntiRepetition.

### 8. AntiRepetition forward-dependency — `excludeIds` from inception

**RESOLVED (2026-05-27 HITL)**: **yes — ship with `excludeIds: number[]` on the input schema from day one.** Cross-links to the now-ratified [03-exec-crosscut-anti-repetition.md — AntiRepetition crosscut (orchestrator-side, canonical_url dedup, no reset)](03-exec-crosscut-anti-repetition.md), which is also HITL-ratified 2026-05-27.

The AntiRepetition resolution means the orchestrator will be the sole producer of `excludeIds` on `find_tips` calls (per Q1 of that crosscut — orchestrator adds exclusions dynamically at call time, connector stays stateless). The `find_tips` primitive therefore accepts `excludeIds: number[]` from inception so it plugs into the AntiRepetition mechanism at implementation time, no schema-break required.

Carried-through detail (record): the orchestrator computes the per-type exclude list from `SessionState.seenItems.customer_tip`, merges into the tool-call arguments before dispatch, and on result reads the returned tip ids out of the structured result and marks them shown in session state. No `customer_tip` UI surfaces canonical URLs (tips aren't URL-bearing), so the dedup key is the natural integer `id` — matching the existing `excludeIds: number[]` shape.

Precedent: `find_options` already accepts `excludeIds` per the BF-FO-v2 work in [03-exec-crosscut-find-options-v2-backfill.md — agent-supplied exclude list (C.focused-shamir-5)](03-exec-crosscut-find-options-v2-backfill.md). The AntiRep crosscut generalises that pattern; this plan adopts it from inception.

### 9. UI — widget or prose-only?

**RESOLVED (2026-05-27 HITL)**: **prose-only at ship**. No widget initially. Document this clearly — no card-shape, no `TipList` React component, no entry in the discriminated `ProposalCardPublicSchema` union. The agent weaves 2–4 tips into prose with traveller-voice attribution; the right-panel future UI is the natural home if a card surface ever lands, but that's not in scope for `find_tips`'s ship.

Reasons (carried for record):
- Per Luke's future right-panel + carousel UI direction (per the [03-exec-chat-surface-t9.md — chat surface widgets](03-exec-chat-surface-t9.md) widget patterns), a card surface is the natural future home. But 2–4 tips weave easily into prose — *"travellers tell us to bring a buff for the wind, layer up cotton-free, and budget pesos for park entry"* — and a widget is a heavier surface than the content needs at launch.
- The brave-pare wave (per [03-exec-crosscut-brave-pare-card-expandable-prose.md — expandable prose](03-exec-crosscut-brave-pare-card-expandable-prose.md) and related) is pushing widgets *toward* prose, not the other way. Don't add a widget for tips against that gradient.
- Adding a widget later is additive — `TipCardPublicSchema` as a new variant in the `ProposalCardPublicSchema` discriminated union per [03-exec-crosscut-find-options-polymorphism.md — polymorphic ProposalCard](03-exec-crosscut-find-options-polymorphism.md), with a `TipCard` React component. Defer until the prose-only ship reveals a gap.

**Flagged explicitly for the future agent**: the widget extension path exists at the precedents above. Pick it up if-and-only-if prose-only ship reveals a quality gap (visitors wanting to "see all the tips" or "save these"). Default state is no-widget.

### 10. Existing `lookup` tool — displaced or complemented?

**RESOLVED (2026-05-27 HITL)**: **complement, not displace.** `lookup` stays unchanged. Recommendation accepted.

The carve:
- `lookup` → Swoop-authored FAQ (`faqitem` → `inform_chunk`). Canonical Swoop voice; structured Q&A; agent quotes as "Swoop's guide says…".
- `find_tips` → traveller-sourced practical wisdom (`customer_tip`). Traveller voice; per-tip granularity; agent attributes as "travellers often say…".

Both serve the Inform job. Both have legitimate moments. The SHOULD-rule in `00_why.md` (§"Components" above) carves the line for Sonnet's tool-selection.

---

## Architectural touchpoints (enumeration)

Every file/module touched, per the brief:

- **Migration**: `product/connector/migrations/013_customer_tip_table.sql` (next number after `012_embedding_cache.sql`).
- **ETL transformation**: `product/ingestion/src/sql-transform/transformations/customer-tip.ts` (mirrors `customerreview.ts`).
- **ETL transformation registration**: `product/ingestion/src/sql-transform/index.ts` (add to the dispatch table).
- **Enrich — embed pass**: `product/ingestion/src/enrich/embed/customer-tips.ts` (mirrors `embed/customer-stories.ts`).
- **Enrich — classify pass**: `product/ingestion/src/enrich/classify/tip-topic.ts` (new classifier).
- **Classifier prompt**: `product/cms/prompts/etl/tip-topic/prompt.md` + `output-schema.ts` (mirrors `etl/persona-summary/`).
- **Enrich CLI registration**: `product/ingestion/src/enrich/index.ts` (add `--source=customer_tip` dispatch).
- **Data primitive**: `product/connector/src/data/find-customer-tips.ts` (mirrors `find-customer-stories.ts` but with hybrid not pure-cosine).
- **Tool handler**: `product/connector/src/tools/find_tips.ts` (using `runHandler` helper per [03-exec-c-t4.md §"Error handling — the shared helper"](03-exec-c-t4.md)).
- **Tool I/O schemas**: `product/ts-common/src/tools.ts` — add `FindTipsInputSchema`, `FindTipsOutputSchema`, `TipPublicSchema`.
- **Tool description**: `product/cms/prompts/tools/find_tips/description.md` (production-quality first-pass per C.34).
- **Tool registration**: `product/connector/src/tools/index.ts` — add `find_tips` to `registerAllTools` (now nine tools).
- **`TOOL_DESCRIPTIONS` runtime label**: `product/ts-common/src/tools.ts` — add a one-line label for `find_tips` (the rich description loads from markdown at boot).
- **WHY system prompt**: `product/cms/prompts/system/00_why.md` — add a SHOULD-rule disambiguating `find_tips` from `lookup` and `find_someone_who`, per the find-someone-who debug lesson on imperative SHOULD-rule coverage.
- **Connector MCP test**: `product/connector/src/server/__tests__/mcp.test.ts` — update the "lists nine intent-named tools" assertion (was eight; add `find_tips`).
- **Harness scenario**: `product/harness/scenarios/<cluster>/<scenario>.yaml` — new scenario for the practical-mid-flow question moment.
- **Optional / deferred widget**: `product/ui/src/widgets/TipList.tsx` (not authored in this task; flagged for future).
- **Decision-log entries**: `planning/decisions.md` — entries for tool name, derived-vs-direct, topic taxonomy, per-call default, naming asymmetry note.
- **Questions closure**: `questions.md` — move customertip ask to "Closed" with back-link to this plan.

---

## Cross-references (inline-comprehension per the memory rule — never bare IDs)

- [decisions.md C.26 — customerreview live; customertip pending](decisions.md) — the long-pending dependency this plan closes.
- [03-exec-c-t3.md — SQL dump → Postgres transform (data movement)](03-exec-c-t3.md) — ETL pattern reference; the `customerreview.ts` transformation is the direct precedent.
- [03-exec-c-t3a.md — Embedding pass + Haiku ETL classifiers + derived-table population](03-exec-c-t3a.md) — enrich pattern reference; `embed/customer-stories.ts` + `classify/persona-summary.ts` are the direct precedents (with the no-aggregation difference for tips).
- [03-exec-c-t4.md — eight handlers + data primitives + MCP registration](03-exec-c-t4.md) — tool-handler pattern reference; `find_someone_who.ts` + `find-customer-stories.ts` are the cleanest precedents to mirror.
- **03-exec-crosscut-anti-repetition.md** — forward-dependency on automatic exclude tracking. **Note: this crosscut has not been authored at 2026-05-27.** The brief flags it as being planned in parallel. When it lands, link this plan to it bidirectionally. Until then, this plan's `excludeIds` input is forward-compat insurance.
- **planning/reviews/2026-05-27-find-someone-who-debug.md** — the brief cites this as "the find-someone-who debug report" for the lesson on imperative SHOULD-rule coverage in `00_why.md`. **Note: no review file exists at that exact path at 2026-05-27.** The lesson is captured in the brief itself and informally in the commit `0d00d62 — feat(cms): add Mirror SHOULD-rule to 00_why.md §4 + Mirror assertion to dreamer-post-life-event harness scenario`. The same discipline applies here: every tool needs imperative SHOULD-rule coverage in the WHY prompt, otherwise Sonnet under-uses it.
- [03-exec-crosscut-find-options-polymorphism.md — polymorphic ProposalCard precedent](03-exec-crosscut-find-options-polymorphism.md) — the card-shape precedent if tips end up needing a widget surface. Not actioned here; flagged for the future agent who picks that up.
- [03-exec-crosscut-embedding-cache.md — content-hash-keyed cache](03-exec-crosscut-embedding-cache.md) — the embed pass routes through this cache so re-runs against unchanged content are free.
- [02-impl-retrieval-and-data.md §"★ Read this first — the WHY of chunk C"](02-impl-retrieval-and-data.md) — the four+1 jobs framing. Re-read before authoring.
- [questions.md item (a) — `customerreview`+`customertip` redacted export request](../questions.md) — the open Swoop-side ask that closes once this plan ships.

---

## Risks

### R1. The source schema doesn't match the assumed shape

**Likelihood**: medium. **Impact**: low–medium.

If `customer_tips` carries unexpected fields (e.g. per-tip ratings, threaded responses, structured metadata) the simple "one row = one tip" assumption fragments. **Mitigation**: Open Q #1 is the blocker — read the schema before authoring. Adapt the plan to whatever shape Swoop actually shipped.

### R2. Topic taxonomy is wrong

**Likelihood**: medium. **Impact**: low.

The 8-topic taxonomy is a draft. Real tips may cluster differently. **Mitigation**: bump the classifier prompt's frontmatter `version` field + re-classify; the cost is pence per pass. Iterate against the HITL sample-quality gate.

### R3. Sonnet doesn't pick `find_tips` over `lookup` reliably

**Likelihood**: medium. **Impact**: medium.

The `lookup` vs `find_tips` line is genuinely subtle in the visitor's question phrasing. The SHOULD-rule in `00_why.md` is the primary defence; the harness scenario is the verification. **Mitigation**: the brave-pare wave's brave-paring of tool descriptions + the find-someone-who debug lesson both point to *strong imperative phrasing* in description.md + an explicit SHOULD-rule, not soft suggestions. Write both in that register from the first pass.

### R4. Region extraction is unreliable

**Likelihood**: medium. **Impact**: low.

Most tips are likely Patagonia-wide. The classifier's region extraction is best-effort; sparse data is fine. **Mitigation**: leave `region` NULL where unclear; retrieval defaults to no region filter unless the visitor specifies one. Don't over-engineer.

### R5. The source data is sparser than expected

**Likelihood**: medium. **Impact**: low.

If `customer_tips` is ~119 rows (the junction-table count from C.t0) minus deleted/unpublished, the actual surface might be ~80 rows. That's fine for ship — a small but high-quality corpus serves the Inform job better than a bloated mediocre one. **Mitigation**: name the corpus size in the execution log; if quality signal post-ship suggests the surface is too thin, route to Swoop for more curation (sales-team prompt curation workstream is the natural home).

### R6. Voice attribution slippage in the agent's prose

**Likelihood**: medium. **Impact**: medium.

If Sonnet attributes traveller tips in Swoop's voice ("Swoop recommends bringing a buff"), the brand-voice fence cracks. **Mitigation**: description.md must spell out the attribution explicitly + harness scenario must assert on it via `judge_rubric`. The pattern is the same as the find-someone-who attribution discipline — quote travellers as travellers, not as Swoop.

### R7. AntiRepetition crosscut never lands

**Likelihood**: low. **Impact**: trivial.

If the crosscut never ships, the `excludeIds` input is dormant. No harm done; the parameter defaults to `[]` and the SQL clause is a no-op.

### R8. The brief-cited review file doesn't exist

**Likelihood**: confirmed (cited path doesn't exist at 2026-05-27). **Impact**: trivial.

The brief references `planning/reviews/2026-05-27-find-someone-who-debug.md` for the imperative SHOULD-rule lesson. No file at that path exists. The lesson is captured informally in the brief + commit `0d00d62 — Mirror SHOULD-rule + harness assertion`. **Mitigation**: cross-reference both inline (per the inline-comprehension memory rule); apply the lesson regardless of whether the file exists.

---

## Coordination

- **Swoop data delivery** — `customer_tips` export confirmed delivered (per Alastair 2026-05-27). Pre-execution step: read the schema (Open Q #1).
- **[03-exec-c-t3.md — SQL dump → Postgres transform](03-exec-c-t3.md)** — closed; this plan grows the ETL surface by one transformation.
- **[03-exec-c-t3a.md — embedding pass + Haiku ETL classifiers](03-exec-c-t3a.md)** — closed; this plan grows the enrich surface by one embed pass + one classify pass.
- **[03-exec-c-t4.md — eight handlers + data primitives + MCP registration](03-exec-c-t4.md)** — closed; this plan grows the handler surface from 8 to 9.
- **[decisions.md C.26 — customerreview live; customertip pending](decisions.md)** — gets a closure note pointing to this plan.
- **[questions.md item (a) — `customerreview`+`customertip` redacted export](../questions.md)** — moves to the "Closed" section once this plan ships.
- **03-exec-crosscut-anti-repetition.md** — *forward-coupled*. The plan ships with `excludeIds` from inception so AntiRepetition can wire shown-tracking without a schema break. **Not authored at 2026-05-27**; bidirectional link added when it lands.
- **[03-exec-crosscut-sales-team-prompt-curation.md — sales-team prompt curation](03-exec-crosscut-sales-team-prompt-curation.md)** — *separate but related workstream*. If post-ship signal shows the tip corpus is too thin or off-voice, that workstream is the natural home for Swoop-side curation of additional tip content. Out of scope here.
- **[03-exec-crosscut-find-options-polymorphism.md — polymorphic ProposalCard](03-exec-crosscut-find-options-polymorphism.md)** — *forward extension only*. The card-shape precedent if a future agent adds a widget surface for tips. Not actioned here.
- **Mirror redesign** — *parallel work*. Out of scope here.

---

## Sub-step ordering (recommended sequence)

For a single execution agent:

0. **MariaDB schema lookup (hard prerequisite for dispatch)** — per Q1 resolution. Connect to the source MariaDB instance and read the `customer_tips` table definition. Capture column names + types, row count, PII surface, optional region/publish-state/ntag linkage. Update the placeholder migration shape in §"Components" → "Migration" before authoring the real migration.
1. *(superseded by Step 0)* — kept for plan-reading continuity; the dump-driven framing is replaced by the MariaDB-direct lookup above.
2. *(completed 2026-05-27)* — HITL ratification pass. Status flipped DRAFT → ready-for-execution. See "2026-05-27 HITL ratification" addendum at the bottom.
3. **Land the migration** — `013_customer_tip_table.sql`, shaped against the Step-0 schema findings. Apply against `puma_dev`.
4. **Author the ETL transformation** — `transformCustomerTip` + registration. Verify against the dump: row count matches expectations, PII fields dropped.
5. **Author the classifier prompt + Zod output schema** — `cms/prompts/etl/tip-topic/`. Start with the 8-topic taxonomy; iterate after sample-quality gate.
6. **Author the embed pass + classify pass drivers** — `enrich/embed/customer-tips.ts` + `enrich/classify/tip-topic.ts`. Run against `puma_dev`; verify `embedding` + `tsv` + `topic_tags` populated for the full corpus.
7. **Author the tool I/O schemas** in `ts-common`. Update `TOOL_DESCRIPTIONS` runtime label.
8. **Author the data primitive** — `find-customer-tips.ts`. Smoke against `puma_dev` with sample topics.
9. **Author the handler** — `find_tips.ts` using `runHandler`. Unit-test against stubbed primitive.
10. **Author the description.md** — production-quality first-pass per C.34. Voice-attribution guidance must be explicit.
11. **Register the tool** in `tools/index.ts`. Update the MCP-list assertion in `mcp.test.ts` from 8 to 9.
12. **Author the SHOULD-rule** in `00_why.md` §4. Reference both `lookup` and `find_someone_who` in the carve.
13. **Author the harness scenario** — new YAML in the practical-question cluster. Run; verify `judge_rubric` passes.
14. **End-to-end smoke** — boot orchestrator + connector, run a Sonnet turn through the mock-host on *"any tips for handling the wind?"*. Capture transcript.
15. **HITL sample-quality gate (Al)** — read ~10 random tips + topic_tags. Iterate prompt frontmatter if needed.
16. **Idempotent re-run check** — second pass against unchanged content writes zero rows.
17. **Update [decisions.md C.26](decisions.md) + [questions.md item (a)](../questions.md)** — closure notes back-linking to this plan.
18. **Append execution log** to this plan summarising what landed.
19. **Typecheck + lint + workspace tests** from `product/`. All green before stopping.

---

## 2026-05-27 HITL ratification

Open questions Q1–Q10 resolved per Alastair's HITL session 2026-05-27. Status flipped from DRAFT to ready-for-execution. **Hard prerequisite before dispatch: Q1's MariaDB schema lookup must be the executing agent's first task — without it the plan can't be executed.**

### Resolutions

1. **Q1 — Source data shape**: **INVESTIGATE**. The implementing agent's first task is to look up the `customer_tips` schema directly in the source MariaDB database. Step 0 inserted into the implementation order. Hard prerequisite, not a HITL question routed to Swoop.
2. **Q2 — Tool name**: **`find_tips`** — locked. Aligns with the `find_*` convention. Other candidates (`lookup_tips`, `get_tips`) dropped.
3. **Q3 — Derived table or direct query**: **derived table** — locked. The MariaDB source won't have embeddings; derived table is the right home for `embedding` / `topic_tags` / `tsv` / `content_hash`. Skip the source mirror unless the Step-0 schema lookup reveals a debug-only field worth keeping raw.
4. **Q4 — Embedding pass shape**: defaults aligned. Gemini-embedding-001 / halfvec(3072) / content-hash-keyed cache, per existing C.t3a pattern (in [03-exec-c-t3a.md — embedding pass + Haiku ETL classifiers + derived-table population](03-exec-c-t3a.md)).
5. **Q5 — Topic taxonomy**: accept the 8-topic draft (packing / weather / money / safety / transit / food / accommodation / etiquette). Tune against actual data once Step 0 + first classify run complete.
6. **Q6 — Retrieval**: hybrid (pgvector cosine + tsvector RRF, k=60). Same as the other content tools.
7. **Q7 — Per-call result count**: default 4. Range 3–5, hard cap 6.
8. **Q8 — AntiRepetition forward-dependency**: yes — ship `excludeIds: number[]` from inception. Cross-links to the now-ratified [03-exec-crosscut-anti-repetition.md — AntiRepetition crosscut (orchestrator-side, canonical_url dedup, no reset)](03-exec-crosscut-anti-repetition.md), HITL-ratified the same day. The orchestrator is the sole producer of `excludeIds` on `find_tips` calls; tips are not URL-bearing so the dedup key is the natural integer `id`.
9. **Q9 — UI**: **prose-only at ship**. No widget. No `TipCardPublicSchema`, no `TipList` React component. Documented as a flagged forward extension only.
10. **Q10 — `lookup` displaced or complemented**: complement, not displace. `lookup` stays unchanged. SHOULD-rule in `00_why.md` carves the line.

### Notes for the executing agent

- **Step 0 (MariaDB schema lookup) is non-negotiable.** Without it, the migration shape in §"Components" → "Migration" is a sketch, not a spec. Begin there; sharpen every downstream artefact (ETL filter, classifier prompt scope, derived-table column list) against the real schema once captured.
- **AntiRepetition wiring**: the AntiRep crosscut's resolved shape (orchestrator owns seen sets; passes `excludeIds` as regular tool-call arguments; no `__seenItems` envelope convention) is the wire-level posture for `find_tips` too. Implement the primitive to accept `excludeIds: number[]` from day one; the orchestrator will populate it on dispatch and mark IDs shown on result. No further `find_tips`-side work required when AntiRepetition lands — the schema is already forward-compatible.
- **No widget at ship.** Do not add `TipList.tsx` or any new variant in the `ProposalCardPublicSchema` discriminated union for tips. If quality signal post-ship suggests a widget is needed, that's a future agent's task, not this one's.
- **Tool name is locked.** Do not relitigate `find_tips` vs `lookup_tips` vs `get_tips` during execution.
- **Topic taxonomy is a starting point, not a contract.** Tune via `version` bump + re-classify after Step 0 + first classify run. The 8-topic draft is the v1 shape.

### Plan is READY FOR EXECUTION

Pending Step 0 (MariaDB schema lookup) as the hard prerequisite, every other Tier-3 artefact in this plan stands: the migration shape (§"Migration"), ETL transformation (§"ETL (sql-transform)"), enrich passes (§"Enrich (embed + classify)"), tool I/O schemas (§"ts-common — tool I/O schemas"), data primitive (§"Data primitive"), handler (§"Handler"), description.md (§"Tool description"), `00_why.md` SHOULD-rule (§"System prompt SHOULD-rule"), and harness scenario (§"Harness scenario") all proceed in the order given by §"Sub-step ordering", with Step 0 inserted at the front.

**Status update 2026-05-27 (post-Step-0-lookup)**: Step 0 has been **completed by a separate Cowork investigation agent (worktree-agent-acdc60c7dbc1a2f20-v2)** — findings inline below in §"Step 0 findings (2026-05-27)". The executing agent can skip Step 0 and proceed directly to the migration (Step 3 in §"Sub-step ordering"), shaped against the findings captured below. Schema, row count, content shape, PII surface, region/publish-state inventory, junction linkage, and ETL data-cleanup pitfalls are all written down.

---

## Step 0 findings (2026-05-27)

Schema lookup completed against the local Homebrew MariaDB on `localhost:3306`, database `swoop_patagonia`, table `customertip` (singular, no underscore — matches the junction's FK `customertip_id`). Connection via socket auth as user `al`. All queries read-only.

### Headline numbers

- **Row count**: **47 rows**. Sparser than the C.t0-era ~119 estimate (which came from the `contentblock_customertip` junction). The junction has more rows than the source because tips are reused across multiple contentblocks — see §"Junction relationships" below. 47 unique tips, surface size confirmed.
- **All 47 rows are live**: `deleted` is NULL for every row; `deleted_by` is NULL for every row. **The 24 rows where `deleted_by_id` is non-NULL are not deletions** — that column carries non-NULL values for live rows, which is database-dirt (likely a CMS-side bug or an audit-trail repurposing). **ETL filter rule**: filter on `deleted IS NULL` (the canonical soft-delete flag), not on `deleted_by_id`. Result: all 47 rows pass.
- **No publish-state column.** No `is_published`, no `status`, no equivalent of `customerreview.is_published = TRUE`. Every live (non-deleted) row is considered published.
- **No region / country column.** The source table carries no location field. Region tagging at ETL (per Open Q #5 + classifier `region` output) is the only mechanism — must be derived from the tip text via Haiku, or left NULL.

### Full schema

```sql
CREATE TABLE `customertip` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `content` text DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  `deleted` tinyint(1) unsigned DEFAULT NULL,
  `deleted_by` tinyint(1) unsigned DEFAULT NULL,
  `deleted_by_id` tinyint(1) unsigned DEFAULT NULL,
  `image_id` int(11) unsigned DEFAULT NULL,
  `created_by_id` int(11) unsigned DEFAULT NULL,
  `modified` datetime DEFAULT NULL,
  `modified_by_id` int(11) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `index_foreignkey_customertip_image` (`image_id`),
  KEY `index_foreignkey_customertip_user` (`created_by_id`),
  KEY `c_fk_customertip_modified_by_id` (`modified_by_id`),
  CONSTRAINT `c_fk_customertip_created_by_id` FOREIGN KEY (`created_by_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE SET NULL,
  CONSTRAINT `c_fk_customertip_image_id` FOREIGN KEY (`image_id`) REFERENCES `image` (`id`) ON DELETE SET NULL ON UPDATE SET NULL,
  CONSTRAINT `c_fk_customertip_modified_by_id` FOREIGN KEY (`modified_by_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

| Column | Type | Null | Notes for ETL |
|---|---|---|---|
| `id` | int unsigned | NO (PK, auto_increment) | Carry forward as the derived `customer_tip.id`. AUTO_INCREMENT=52 with 47 live rows means 5 ids are missing in the range — minor curiosity, not a problem. |
| `content` | text | YES | **The tip prose itself.** Always populated (0 NULLs / 0 empty strings across all 47 rows). Maps to derived `text NOT NULL`. **Source-of-truth utf8mb4** (table collation `utf8mb4_unicode_ci`) — the storage is clean; the latin1 client-default rendering during inspection produced replacement characters (`you�re`), but the raw bytes are correct UTF-8 (`E2 80 99` = `'`). ETL must use `--default-character-set=utf8mb4` on its MariaDB connection, or set it explicitly on the driver. |
| `name` | varchar(255) | YES | The traveller's display name (e.g. `Lauren`, `Sarah, USA`, `Nic & Julie`). 43 distinct values across 47 rows. **Treat as low-PII / public-domain attribution** per Alastair's "sales-curated published content" posture (same as `customerreview.author_name` per C.26). **Data cleanup at ETL**: trim trailing whitespace (e.g. `Bill, Australia ` has a trailing space); replace literal tab characters (e.g. id 41 has `Joey\tAltchech` where `\t` is a literal U+0009 inside the string). Public projection: include as `author_name` field on `TipPublicSchema` (the agent can use it for voice attribution — *"as Lauren put it: pack light"*) **OR** strip entirely if the design prefers anonymous traveller-voice. **Recommended**: include — names lend authenticity to the traveller-voice attribution; the sample is public-facing CMS content. **HITL flag** if a different posture is wanted. |
| `created` | datetime | YES | Original authoring timestamp. Range: **2016-09-05 to 2025-07-24** (most rows clustered 2016–2018; 1 outlier in 2024-04-22; 1 in 2025-07-24). Carry forward as `created_at` for provenance. |
| `deleted` | tinyint(1) unsigned | YES | Canonical soft-delete flag. **All NULL across all 47 rows.** ETL filter: `WHERE deleted IS NULL`. |
| `deleted_by` | tinyint(1) unsigned | YES | All NULL. Drop. |
| `deleted_by_id` | tinyint(1) unsigned | YES | Mis-named: **24/47 rows have non-NULL values despite `deleted` being NULL** — this column does NOT mean "the user who deleted this row". Likely an audit-trail repurpose or CMS-side bug. **Do NOT filter on this; do NOT carry forward.** |
| `image_id` | int unsigned | YES (FK → `image.id`) | **12/47 rows have an associated image.** Could surface as a thumbnail in a future widget; for the prose-only ship (Q9), drop. **Out of scope for v1**; flag for the widget extension path. |
| `created_by_id` | int unsigned | YES (FK → `user.id`) | **CMS author**, not the traveller — only 5 distinct creators across all 47 rows (CMS staff curating tips on travellers' behalf). The traveller is named in `name`. **Drop at ETL boundary** (PII filter: user-table FKs leak into the derived store). |
| `modified` | datetime | YES | Last modified timestamp. Most modified dates fall in 2016-10 to 2017-05 — older than `created` for the 2024/2025 outliers (likely because modified never updated after a CMS migration). Not load-bearing for retrieval; drop. |
| `modified_by_id` | int unsigned | YES (FK → `user.id`) | PII (user FK). Drop. |

### Foreign keys inbound and outbound

- **Outbound** (FROM `customertip` → other tables):
    - `image_id → image.id` — 12/47 populated; ETL ignores for v1.
    - `created_by_id → user.id` — CMS author audit; ETL drops.
    - `modified_by_id → user.id` — CMS author audit; ETL drops.
- **Inbound** (FROM other tables → `customertip`):
    - `contentblock_customertip.customertip_id → customertip.id` — the only junction.

### Content shape

- **Length distribution** (LENGTH of `content`, 47 rows, no NULLs):
    - min: 35 chars
    - max: 288 chars
    - avg: 144 chars
    - stddev: 63 chars

- **Length histogram (50-char buckets)**:
    | Bucket | Count |
    |---|---|
    | 0–49 | 2 |
    | 50–99 | 10 |
    | 100–149 | 17 |
    | 150–199 | 10 |
    | 200–249 | 4 |
    | 250–299 | 4 |

  **Implication**: tips are **short snippets, not long-form**. Average is ~144 chars (~25 words / ~1 sentence). The longest is 288 chars (~50 words / ~3 sentences). This validates the plan's "no chunking" decision (Q4) — every tip fits in a single embedding window with vast headroom (Gemini-embedding-001's 2048-token cap is ~8192 chars, ~28× the longest tip).

- **Sample tips (representative)**:
    - id 6 (35 chars, shortest): *"Trekking poles are recommended for the W Trek."* — Jon
    - id 4 (159 chars): *"There are very few Trekkers out in the winter so if you're planning on going but not a confident camper/trekker then definitely book in a guide with Swoop."* — Morwenna
    - id 10 (181 chars): *"Splurge for the refugios (sleep is important), bring gaiters for the snow, bring cash for drinks at refugios, have quality boots, quality outer-jacket, bring blister care materials."* — Daniel
    - id 9 (288 chars, longest): *"The only slight difficulty I had was trying to find a working cash machine, especially in El Calafate. There were also limits on the amount of cash you could withdraw so I would advise / warn people to pay online in advance as much as possible, and to bring some cash with them."* — Simon

  **Voice**: traveller-direct, often imperative ("Pack light", "Trekking poles are recommended"), often confessional ("We got stranded both ways…"). The 8-topic taxonomy in §"Components" → "Enrich" maps cleanly: id 6 → `safety`/`packing`; id 9 → `money`; id 10 → `packing`/`accommodation`; id 4 → `weather`/`safety`. Validates the taxonomy.

- **Author concentration**: 43 distinct `name` values across 47 rows. The 3 repeats are all `Lauren` (3 tips, all 2016 sequential authoring under the same session). Single-author dominance is negligible — this is not customer-story persona-shaped content. No need for aggregation; the per-tip granularity holds.

### Junction relationships

- `contentblock_customertip` is the only junction:
    - 119 rows total
    - 30 distinct `customertip_id` values referenced (the 30 that ARE surfaced on the live website via the CMS)
    - 58 distinct `contentblock_id` values (tips are reused across multiple contentblocks — same tip surfaces on multiple page-sections)
    - **0 dangling junction rows** (all 30 referenced ids exist in `customertip` — the source table delivery resolved every dangling FK from C.t0's 2026-04-29 finding)
    - **17 of 47 source rows are NOT referenced by any junction** — these are tips that exist in the CMS but aren't currently surfaced on the live website. **Recommendation: include them in the ETL anyway.** The agent doesn't need a tip to be "page-visible on swoop.com" to use it conversationally; the curated/quality bar is satisfied by the source table's editorial provenance (CMS staff selected them). The orphans are not lower-quality — they're just not currently page-placed.

- **Pagetype distribution of tip-bearing pages** (via the junction → `contentblock.page_id` → `page.pagetype_id` → `pagetype.title`):
    | Pagetype | Junction rows | Distinct tips |
    |---|---|---|
    | NULL (pages without a pagetype) | 93 | 14 |
    | Guidebook | 13 | 11 |
    | Swoop | 6 | 4 |
    | Month | 3 | 3 |
    | Region-Activity | 2 | 2 |
    | Activity | 1 | 1 |
    | Region | 1 | 1 |

  **The 93 NULL-pagetype junction rows are concentrated on "Preparing for your X trip" pages** (sample titles: *"Preparing for the W Trek based at Serrano Camp"*, *"Preparing for the Original W Trek in Torres del Paine"*, *"Preparing for your Best of the Chilean Lake District trip"*). These are the natural home for tip content — pre-trip practical-wisdom moments — but they exist outside the pagetype taxonomy. **Not load-bearing for the retrieval design** (the tool searches by topic, not by page); flagged for general orientation.

- **`page_trip` linkage**: joining tip-bearing contentblocks → page_id → `page_trip` returns **0 trip-linked tips**. Tips do NOT sit on trip-bound pages via the `page_trip` table; they sit on the "Preparing for..." pages which appear to be a separate page taxonomy. **Implication**: there is no clean MariaDB-side path to derive a `trip_id` for a tip. Region/topic classification at ETL via Haiku is the only structural enrichment available — confirms the plan's Q5 decision to use the classifier rather than join-table inference.

### PII surface

- `name` — traveller's first name / display name. Posture: **public-domain published content** (same as `customerreview.author_name` per C.26). Carry forward as `author_name` on the derived table. Strip if a stricter posture is wanted at HITL.
- `created_by_id`, `modified_by_id`, `deleted_by_id`, `deleted_by` — internal user-table FKs (CMS author audit). **Drop at ETL boundary**, per the C.14 pattern (`swooper_*` columns on `trip`).
- `image_id` — internal FK to `image`. Not PII; drop because the prose-only ship doesn't render images.
- No email column. No IP column. No customer FK. Cleaner PII surface than `customerreview`.

### Data cleanup pitfalls (must address in `transformCustomerTip`)

1. **Trailing whitespace on `name`**: e.g. `Bill, Australia ` (id 33), `Stephen, UK ` (id 34) — `TRIM()` at ETL.
2. **Literal tab characters mid-string**: id 41 has `name = 'Joey\tAltchech'` where `\t` is U+0009 inside the string. Strip or replace with single space at ETL.
3. **Mixed punctuation in `content`**: curly apostrophes (`'`), straight apostrophes (`'`), em dashes, ellipses — all present and all properly encoded as UTF-8. **Keep as-is** (the agent should reproduce the traveller's punctuation faithfully); no normalisation needed.
4. **Charset gotcha**: the MariaDB server's `character_set_client` / `character_set_connection` / `character_set_results` defaults are `latin1` even though `character_set_database` is `utf8mb4` and the table itself is `utf8mb4_unicode_ci`. **The data IS utf8mb4-clean**; the latin1 client default produces visible mojibake during shell inspection. The ETL must explicitly request utf8mb4 on its connection — either via `--default-character-set=utf8mb4` (CLI) or `SET NAMES utf8mb4` (driver-level). This is a Homebrew MariaDB local-dev quirk and not a data-corruption issue.
5. **5 missing ids**: AUTO_INCREMENT=52, 47 live rows, no deletions — 5 ids are gaps in the sequence. Not a problem; just don't assume contiguous integer ids.

### Revised migration shape

The placeholder in §"Components" → "Migration" can now be sharpened. Recommended actual shape (changes vs the placeholder marked **bold**):

```sql
CREATE TABLE customer_tip (
  id              INTEGER PRIMARY KEY,                  -- carry source customertip.id forward
  source_id       TEXT NOT NULL,                        -- TEXT-form id per C.33 (e.g. 'customertip:6')
  text            TEXT NOT NULL,                        -- the tip prose; sourced from customertip.content
  author_name     TEXT,                                 -- ** NEW vs placeholder ** — sourced from customertip.name, TRIMmed, tabs replaced with space
  topic_tags      TEXT[] NOT NULL DEFAULT '{}',         -- Haiku-classified, 8-topic taxonomy
  region          TEXT,                                 -- best-effort, NULL where unknown
  ntag_ids        INTEGER[] NOT NULL DEFAULT '{}',      -- ** EMPTY for tips ** — source has no ntag linkage; carry the column for shape-symmetry only
  source_provenance TEXT NOT NULL DEFAULT 'customertip',-- ** updated default ** — matches the source table name
  source_created_at TIMESTAMPTZ,                        -- ** NEW vs placeholder ** — sourced from customertip.created for provenance display
  embedding       halfvec(3072),                        -- Gemini-embedding-001 per migration 009
  tsv             tsvector,                             -- to_tsvector('english', text)
  content_hash    TEXT,                                 -- sha256(text || version) for idempotent re-runs
  embedded_at     TIMESTAMPTZ,
  classified_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX customer_tip_embedding_idx ON customer_tip USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX customer_tip_tsv_idx       ON customer_tip USING gin (tsv);
CREATE INDEX customer_tip_topic_tags_idx ON customer_tip USING gin (topic_tags);
CREATE INDEX customer_tip_region_idx    ON customer_tip (region) WHERE region IS NOT NULL;
```

### Revised `TipPublicSchema`

Add `author_name` to the public projection (handler maps `customer_tip.author_name → author_name`):

```ts
TipPublicSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  author_name: z.string().nullable(),  // NEW vs §"ts-common — tool I/O schemas"
  topic_tags: z.array(z.string()),
  region: z.string().nullable(),
});
```

The agent uses `author_name` for voice attribution where present (*"as Daniel put it, splurge for the refugios"*); falls back to anonymous traveller-voice where NULL.

### Tip surface size at ship

47 tips. Sparse but high-quality. Risk R5 in §"Risks" (sparser-than-expected corpus) **partially materialised**: not the ~119 the junction-count implied, but the 47 are clean editorial selections and serve the Inform job well for v1. The recommendation in R5 ("name the corpus size in the execution log; if quality signal post-ship suggests too thin, route to sales-team prompt curation") stands.

### What this lookup did NOT change

Every Q1–Q10 HITL resolution stands. The tool name, derived-table-only, Gemini embedding, 8-topic taxonomy, hybrid retrieval, per-call default of 4, `excludeIds` from inception, prose-only ship, and complement-not-displace-`lookup` postures are all still correct given the actual schema. The only additive concrete refinements are:

- **Add `author_name`** to the derived table + `TipPublicSchema` (recommended) or strip name entirely (alternative; HITL flag).
- **Add `source_created_at`** to the derived table for provenance display.
- **`ntag_ids` is column-shape symmetry only** for tips; never populated (no source linkage).
- **`source_provenance` default = `'customertip'`** (singular, matching the source table name).
- **ETL must request utf8mb4 explicitly** on its MariaDB connection (latin1 is the server-side client default).
- **TRIM + tab-strip on `name`** at ETL boundary.
- **Filter on `deleted IS NULL`** (the 24-row `deleted_by_id` non-NULL signal is database-dirt, not a deletion).
- **Include all 47 rows** including the 17 unreferenced-by-junction tips — they're CMS-curated, just not currently page-placed.

### Investigation provenance

- Lookup performed 2026-05-27 by Cowork agent `worktree-agent-acdc60c7dbc1a2f20-v2` per the brief at `/Users/al/Studio/projects/swoop_web/.claude/worktrees/agent-acdc60c7dbc1a2f20-v2/`.
- All queries read-only against `swoop_patagonia` on `localhost:3306`.
- No source-table modifications. No Postgres writes. No code changes — planning doc update only.
- Findings consistent with C.t0 (the junction shape) plus the post-2026-04-29 customertip delivery from Swoop.

---

## Execution log

### 2026-06-01 — built in worktree `claude/find-tips` (find-tips session)

Executed against the HITL-ratified plan. The static build (migration → ETL → enrich → tool → schemas → prose → tests) landed and is green; **live-data steps are staged-and-flagged, not run** (this is an autonomous parallel worktree with no `puma_dev` Postgres — Verification 4/6/8/9 require a populated database + a real Sonnet turn and are owned by the HITL live-data pass at merge).

**Commits (branch `claude/find-tips`):**

| sha | what |
|---|---|
| `0119324` | `customer_tip` migration `013_customer_tip_table.sql` + ts-common tip schemas |
| `388bfff` | sql-transform writes `customer_tip` base columns (`transformCustomerTip`) |
| `90179e3` | tip-topic Haiku classifier (`cms/prompts/etl/tip-topic/`) + customer_tip embed/classify enrich pass |
| `69c055b` | register `find_tips` — 9th MCP tool (data primitive, handler, description, registration, mcp/migrate test bumps 8→9 / 012→013) |
| `66175cd` | data-primitive + prompt-loader + transformCustomerTip + orchestration (00_why SHOULD-rule, harness scenario 020) test coverage |

**What landed (static):**
- Migration `013_customer_tip_table.sql` — derived `customer_tip` table per the §schema-addendum shape (incl. `author_name`, `source_created_at`, `topic_tags[]`, `region`, `embedding halfvec(3072)`, `tsv`, `content_hash`; hnsw + gin + region indexes).
- ETL `transformCustomerTip` — base columns from the source mirror; soft-delete via the shared numeric `isDeleted` tinyint convention (consistent with all sibling transforms — the plan's "deleted IS NULL" is source-SQL phrasing), TRIM + tab-strip on `name`, drop empty content / missing id, `source_provenance='customertip'`, `content_hash = sha256(trimmed text | 'customer_tip' | 1)`.
- Enrich pass — embed (Gemini-embedding-001, cache-keyed by content_hash) + Haiku topic-classify against the 8-topic taxonomy; `classified_at` NULL gate; idempotent re-run by content_hash.
- Tool surface — `find_tips` 9th MCP tool, inserted after `find_options`, before `illustrate`. Data primitive `findCustomerTipsByTopic` (hybrid RRF k=60 via `buildHybridSearchSql`, optional `(region = $N OR region IS NULL)`, `excludeIds` cast `::int[]`), handler `findTipsBody`, fail-fast description at `cms/prompts/tools/find_tips/description.md`.
- Content — `00_why.md` SHOULD-rule carving `find_tips` (traveller wisdom, attribute the voice) from `lookup` (Swoop canon) and `find_someone_who` (persona); added to the tool rosters (NOT the widget roster — prose-only).
- Tests (all green): `find-customer-tips.test.ts` (10, SQL shape), `find_tips.test.ts` (4, handler), `transformations.test.ts` `transformCustomerTip` block (9), `prompts.test.ts` tip-topic loader (5), plus mcp/migrate roster bumps. Connector 189 pass / ingestion 305 pass / lint clean on new files. Decision entries C.tip-1…C.tip-4; questions.md item (a) closed; C.26 closure note added.

**Deviations from the plan sketch (all minor, all logged):**
- Public projection schema is **`CustomerTipPublicSchema`** (not the sketched `TipPublicSchema`) and uses **camelCase** keys (`authorName`, `topicTags`) — matches the connector's existing public-schema convention.
- Tool I/O is `FindTipsInputSchema` / `FindTipsOutputSchema`; output is `{ tips, count }`.
- `limit` default 4, **max 6**.
- Derived table carries `created_at` / `updated_at` (named per migration convention) alongside `embedded_at` / `classified_at`.

**Pre-existing baseline reds (NOT touched — unrelated to find_tips, documented for the merge):**
- `connector` typecheck: 5 errors in `src/data/__tests__/embed-query.test.ts` (vitest mock.calls tuple-typing drift in this worktree's newer node_modules; file byte-identical to commit `67c2dda`). C.t9 territory.
- `ui` lint: ~40 errors in `src/session/*` (react-hooks rule resolution + unused vars). Pre-existing.

**Flagged for the HITL live-data pass (Verification 4, 6, 8, 9 — require populated `puma_dev` + real Sonnet):**
1. `mysqldump customertip --default-character-set=utf8mb4` (latin1 client default produces mojibake — §"Data cleanup pitfalls" #4).
2. Run ETL → embed → classify against the 47-row corpus.
3. Per-tool integration test: `find_tips({topic})` for "Patagonian wind" / "tipping etiquette" / "altitude sickness" → ≥1 TipPublic (or `count:0` flag-don't-fail on sparse topics).
4. End-to-end Sonnet smoke (Verification 6): utterance *"any tips for handling the wind in Torres del Paine?"* routes to `find_tips` (not `lookup`/`find_someone_who`); capture transcript. Harness scenario `020-find-tips-practical-question.yaml` pins this for the agent-eval harness.
5. **Sample-quality HITL gate (Alastair)**: read ~10 random `customer_tip.text` + `topic_tags` post-classify; sign off voice/coverage/tag accuracy or bump prompt frontmatter version + re-classify.
6. Idempotent re-run check (zero writes second pass).

**Surfaced for downstream:**
- **AntiRepetition crosscut**: `find_tips` ships `excludeIds` from inception (`::int[]`). When the orchestrator-side seen-set wiring (C.anti-rep-*) generalises to `customer_tip`, no tool-schema change is needed — add `customer_tip` to the `SeenItems` keys + the `extractSeenDelta` switch.
- **Corpus thinness (R5)**: 47 tips is serviceable for v1 but thin. If live signal shows coverage gaps, route to sales-team tip curation (the eventual CMS path).
