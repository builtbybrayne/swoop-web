# 03 — Crosscut: retrieval provenance — source titles + dates (Luke Loom feedback, 2026-06-10)

**Status**: DRAFT — pending HITL ratification.
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) items L2 (page-title links), D1 (dated data), D5 (budgetBand probes).
**Workspaces touched**: `@swoop/connector` (migrations + data primitives), `@swoop/ingestion` (compose), `@swoop/common` (Public schemas), `@swoop/ui` (link copy), `cms/prompts/tools/` (description fragments).
**Pairs with**: [03-exec-content-t6-luke-loom.md](03-exec-content-t6-luke-loom.md) — that plan owns the *system-prompt* policy ("prices must be contemporary"); this plan owns the *data + tool-description* layer that makes the policy executable. No file overlap; either order works, but the policy reads best landing same-wave or after.

---

## ★ Read this first

Two facts found at triage drive everything here:

1. **The agent cannot see how old anything is.** `blog_post.published_at` (WordPress, reliable) and `customer_tip.source_created_at` (2016–2025) exist in domain tables, but [003_derived_tables.sql](../product/connector/migrations/003_derived_tables.sql) carries only `source_provenance`, and every `*Public` schema in [derived.ts](../product/ts-common/src/derived.ts) drops dates entirely. Luke's "$300–350/day from my January 2011 blog post" is the direct consequence.
2. **The agent cannot name what it links to.** `*Public` schemas carry `canonicalUrl` but no source title, so widgets hard-code "Read more on swoop-patagonia.com". `page.title` and `blog_post.title` exist one join away.

One compose-layer pass fixes both. The embedding cache (content-hash-keyed, [03-exec-crosscut-embedding-cache.md](03-exec-crosscut-embedding-cache.md)) makes the re-compose ~free **provided** title/date columns are added *outside* the `content_hash` input (they're metadata, not content — do not change hash inputs, or the whole corpus re-embeds).

⚠ **Date-reliability caveat to verify first (Step 0)**: puma-side `page.created_at/modified_at` default `NOW()` at ETL — check whether the MariaDB dump carries real source dates for `page`/`contentblock` (likely columns: `created`, `modified`). If yes, ingest them (ETL change); if no, page-derived content ships `source_published_at = NULL` and the tool description teaches "undated = treat as evergreen-but-unverified for volatile facts". Blog + tip content is datable regardless — and Luke's complaint is specifically blog-sourced.

## 1. Outcomes

1. Derived rows carry `source_title` and `source_published_at` (nullable) — composed from their domain source (`blog_post.title/published_at`, `page.title` + source dates per Step 0, `customer_tip.source_created_at`).
2. The agent-visible `*Public` schemas (`InspirePassagePublic`, `InformChunkPublic`, `CustomerStoryPublic`, `TrustProofPublic`, `CustomerTipPublic`) expose `sourceTitle` / `publishedAt` (nullable, omitted-when-null to save tokens).
3. Tool description fragments (`cms/prompts/tools/{find_inspiring,lookup,find_proof,find_someone_who,find_tips}/description.md`) teach the fields: what they mean, and the volatile-facts rule (figures from old/undated sources are colour, not citable fact — full policy lives in the system prompt).
4. Widget link text uses the title: **"Find out more about {sourceTitle} →"** (fallback to current copy when null) in [lookup.tsx](../product/ui/src/widgets/lookup.tsx) (fold the existing `hint` into the anchor), [find-inspiring.tsx](../product/ui/src/widgets/find-inspiring.tsx), [find-proof.tsx](../product/ui/src/widgets/find-proof.tsx). Decode entities + truncate gracefully (~60 chars) — reuse [text-utils](../product/ui/src/widgets/text-utils.ts).
5. D5 cheap-win probes executed and findings logged (§5).

## 2. Components

| Step | What | Where |
|---|---|---|
| 0 | Source-date availability probe (page/contentblock in MariaDB dump) → decides ETL sub-step | psql against `swoop_patagonia` + `puma_dev`; log findings in this plan |
| 1 | Migration `0NN_provenance_columns.sql`: `source_title TEXT`, `source_published_at TIMESTAMPTZ` on `inspire_passage`, `inform_chunk`, `customer_story`, `trust_proof` (tip table already has `source_created_at`) | `product/connector/migrations/` |
| 2 | Compose SQL/code populates both columns per source; **content_hash inputs unchanged** | `product/ingestion/src/enrich/compose/*` |
| 3 | (Conditional on Step 0) ETL carries real `page`/`contentblock` source dates | `product/ingestion/src/sql-transform/` |
| 4 | `*Public` schemas + connector SELECT/mappers expose `sourceTitle`/`publishedAt` | `product/ts-common/src/derived.ts`, `product/connector/src/data/*`, tool handlers |
| 5 | Tool description fragments updated | `product/cms/prompts/tools/*/description.md` |
| 6 | Widget anchor copy + tests | `product/ui/src/widgets/{lookup,find-inspiring,find-proof}.tsx` |
| 7 | Re-compose run against `puma_dev` (cache-hit; ~£0) + column-coverage probe | operator step |

**Decision (proposed) C.poincare-3**: provenance (title + date) is first-class on derived rows and agent-visible; metadata excluded from `content_hash`.
**Decision (proposed) C.poincare-4**: link anchor pattern "Find out more about {title}" with graceful fallback; title decoding/truncation at the widget boundary.

## 3. Out of scope

- System-prompt pricing policy (content plan).
- `trip_card` / `tour_card` provenance — cards are catalogue entities, not dated prose; their freshness story is the Product Library conversation ([questions.md](../questions.md)).
- Any retrieval-ranking change (recency boosting etc.) — exposure only, this round.
- Image annotation dates.

## 4. Acceptance gates (per the 2026-05-18 column-coverage rule)

Schema-correct ≠ populated. After the re-compose:

```sql
SELECT 'inspire' src, COUNT(*) FILTER (WHERE source_published_at IS NOT NULL) dated, COUNT(*) FILTER (WHERE source_title IS NOT NULL) titled, COUNT(*) total FROM inspire_passage
UNION ALL SELECT 'inform', COUNT(*) FILTER (WHERE source_published_at IS NOT NULL), COUNT(*) FILTER (WHERE source_title IS NOT NULL), COUNT(*) FROM inform_chunk;
```

Expect: titled ≈ total on both; dated ≈ blog-sourced share at minimum (per `source_provenance`). Plus a real-Anthropic single-turn smoke: a cost-shaped question (e.g. "what does Patagonia cost per day?") → tool result visibly carries `publishedAt`; agent prose reflects date-awareness (policy fully lands with the content plan).

## 5. D5 cheap-win probes (timeboxed, ~1h, findings → ledger)

1. **Hotel price coverage**: `SELECT COUNT(*) FILTER (WHERE price_from IS NOT NULL), COUNT(*) FROM hotel_card;` (adjust to actual column) — if NULL-heavy, the `BUDGET_CEILING` filter no-ops and a "cost-conscious" query can return the Explorer. Log + recommend (likely: Product Library dependency, or exclude unpriced hotels from budget-filtered queries).
2. **Agent passes budgetBand**: sweep recent harness JSONL transcripts / live logs for `find_options` args — does Sonnet supply `budgetBand` when the visitor signals price sensitivity? If rarely: the [content plan](03-exec-content-t6-luke-loom.md) §2.4 nudge is the fix; confirm description.md wording there.
3. **Region coherence on blend**: confirm region filter applies to hotel/region_base/tour branches of the blend path in [find_options.ts](../product/connector/src/tools/find_options.ts) (Aysén-property-in-a-TdP-conversation symptom).

## 6. Estimate

~1 day including migration, compose, schemas, widgets, probes, re-compose run. The strategic relevance work (agentic pipelines, richer search) stays PARKED per the ledger — this plan deliberately stops at provenance exposure + probes.

---

## 2026-06-10 execution log

Executed by the magical-poincare retrieval-provenance agent. Four commits on this branch; no push, no merge.

| Commit | What |
|---|---|
| `daae378` | feat(connector): migration 017 — source_title + source_published_at on the four compose-derived tables (+ migrate.test.ts manifest gains 017; 016 noted as sibling-owned) |
| `440cf9d` | feat(ingestion): compose passes populate the two columns per source (blog → title+date; page → title only; FAQ/chunk → neither; reviews → review date) |
| `898dbe6` | feat(common,connector): `*Public` schemas + retrieval mappers expose `sourceTitle`/`publishedAt` (omitted-when-null); shared `provenanceFields()` helper + 9 unit tests |
| `4bdc0b5` | feat(cms): provenance teaching in the five retrieval-tool description fragments |

### Step 0 verdict — source-date availability

- The local MariaDB `swoop_patagonia` was **not probed directly** — unnecessary, because `puma_dev`'s own `page` table answered it: all 636 `page.created_at` values are `2026-05-02 00:26:53` (the ETL run instant), min = max to the millisecond. They are ETL timestamps, not editorial dates. **No ETL sub-step (plan Step 3) shipped**; page-derived rows carry `source_published_at = NULL` and the `lookup` description teaches the undated-content rule.
- `blog_post.published_at`: reliable where rows exist — but see the corpus finding below.
- `customer_tip.source_created_at`: 45/45 populated (2016–2025). Shipped through `CustomerTipPublic.publishedAt`.
- `customerreview.date` (not in the plan's original list): solid coverage — used to date `customer_story` rows (latest review date across an aggregated bucket).

### Migration + re-compose on shared `puma_dev`

- Migration `017_provenance_columns` applied cleanly. Sibling's `016_puma_session` was already in `pgmigrations` (applied by the handoff-form/B.t13 branch directly against the shared DB); 016/017 are independent as expected.
- Re-compose: `enrich --mode=compose --sync` with `GEMINI_CONCURRENCY=1 GEMINI_BATCH_SIZE=50`. Total spend **£0.0034** — 163 embeddings were cache-misses (151 inspire + 12 trust, content evidently drifted since the cache backfill), everything else cache-hit. **content_hash inputs untouched** (decision C.poincare-3 confirmed: title/date are metadata, outside the hash, corpus did not re-embed).
- Deliberate invocation choice: `--mode=compose` (not `--mode=all`) because `classify:persona-summary` has **no checkpoint** — its outputs only reach `composeCustomerStory` when classify+compose run in one process. Probed before running: all 953 `customer_story.persona_summary` values in `puma_dev` were **already fallback-shaped** ("Traveller from X" / "Anonymous traveller"), so compose-only regressed nothing. Pre-existing condition flagged below.

### §4 coverage gates (post-re-compose, puma_dev)

```
      src       | dated | titled | total
----------------+-------+--------+-------
 inspire        |     0 |    619 |   665
 inform         |     0 |     18 |   924
 trust_proof    |     0 |     39 |    39
 customer_story |   953 |      0 |   953
 customer_tip   |    45 |      0 |    45
```

Read with the per-provenance breakdown, every number is per-design:
- **titled ≈ total holds on every titleable row**: inspire 619/619 page-sourced (the 46 untitled are CMS `chunk` rows — no title exists); inform 18/18 page-sourced (the 906 untitled are FAQ rows whose headline lives in `question`); trust 39/39.
- **dated = 0 on inspire/inform/trust is exactly the blog-sourced share — which is currently zero** (next finding). customer_story 953/953 dated via review dates; customer_tip 45/45.

### ⚠ Corpus finding: the blog corpus is absent from puma_dev

`blog_post` and `blog_chunk` are both **empty (0 rows)** in the shared DB. Every compose pass reported `blogChunks/blogRows: 0`. Consequence: the very content class Luke's D1 complaint targets (dated blog prose) isn't in the live corpus at all right now — `publishedAt` can't surface on `lookup`/`find_inspiring`/`find_proof` results until the blog ingest + job-classify pipeline is re-run against this DB. The provenance plumbing is in place and verified for it (blog branches of all compose SQL carry title + published_at).

Related: **Luke's "$300–350/day" figure is live in an *undated FAQ row***, not (only) a 2011 blog post — the top `lookup` hit for "what does Patagonia cost per day?" is faq-sourced "How much does hiking in Patagonia cost?" containing "US$300-350 per person per day". The undated-content rule in the new lookup description is the guard that covers it today; the figure itself needs a content-side review (it cannot be dated, only corrected or caveated).

### Single-turn smokes

- **MCP-layer** (my connector, port 3012 — see deviation on ports): `find_tips` ("money/cash") → 3 tips each carrying `publishedAt` ("2017-02-09", "2016-09-05", "2017-04-10"); `find_someone_who` → stories carry `publishedAt` ("2016-12-01", "2017-11-03"); `find_inspiring` ("granite towers…") → `sourceTitle` "Trekking in Los Glaciares", "Torres del Paine National Park"; `lookup` (cost/day) → top-3 all FAQ rows, fields correctly **omitted** (undated/untitled by design).
- **Real-Anthropic full turn**: orchestrator booted on :8090 with `CONNECTOR_URL=http://localhost:3012/mcp`; session + tier-1 consent + one `/chat` turn ("Roughly what does Patagonia cost per day for a guided trek?"). Sonnet called `lookup`, wove the US$300–350/day FAQ answer into prose. No date-awareness in prose — expected: the system-prompt policy lands with [03-exec-content-t6-luke-loom.md](03-exec-content-t6-luke-loom.md), and the retrieved rows are undated FAQ content.

### §5 D5 cheap-win probes

1. **Hotel price coverage**: `hotel_pricing` has **0 rows** (44 hotels, none priced). The `BUDGET_CEILING` HAVING clause in [query-hotels.ts](../product/connector/src/data/query-hotels.ts) is `(MIN(hp.price) IS NULL OR MIN(hp.price) <= ceiling)` — soft on NULL — so the budget filter is a **complete no-op for hotels**: a "budget" blend can return the Explora. Trips: 185/649 `trip_card.from_price` NULL with the same soft clause `(from_price IS NULL OR from_price <= ceiling)` — 28.5% of trips pass any budget filter unpriced. Recommendation (not built): this is a Product Library dependency first (price the hotels), and a posture decision second — flip to excluding unpriced rows *only when* `budgetBand` is explicitly supplied, or keep the soft posture and let the agent caveat unpriced cards in prose.
2. **Agent passes budgetBand**: **no harness JSONL transcripts exist to sweep** — `product/harness/runs/` is absent in both the main worktree and this one (runs were never committed; the 2026-05-18 streaming fix wrote to gitignored dirs). Static signal instead: `FindOptionsInputSchema.budgetBand` carries no `.describe()`, and [find_options/description.md](../product/cms/prompts/tools/find_options/description.md) mentions budget only once, obliquely ("often a sense of the budget bracket"). The [content plan §2.4](03-exec-content-t6-luke-loom.md) nudge is the right fix; suggest it also add an explicit "when the visitor signals price sensitivity, pass `budgetBand`" line. Scenario `agent-211-budget-mid-postgrad` (£4.5–5K budget persona) exists and asserts a `find_options` call — a harness run after the content-plan nudge lands would close the loop.
3. **Region coherence on blend**: region filter **present** on the hotel branch (`area.alias/area.name/loc.name ILIKE`), **present** on region_base (`a.alias/a.name/country.name ILIKE`), **present** on trips (`trip_card.region ILIKE`), **absent by design** on tours (region informational only, filter deliberately removed per C.focused-shamir-6 — 11 pan-Patagonia rows, agent frames in prose). The blend path forwards the same `region` input to all four branches. The Aysén-property-in-a-TdP-conversation symptom therefore has two live mechanisms: (a) the agent omitting `region` on a blend call — every hotel is then eligible and `ORDER BY RANDOM()` can surface Aysén; (b) the tour branch ignoring region by design. No code fix made (per plan scope); (a) is conversational-steer territory (content plan), (b) is a ratified decision.

### Decisions

- **C.poincare-3 confirmed**: provenance (title + date) first-class on derived rows, agent-visible via `*Public` schemas; metadata excluded from `content_hash` (verified live: re-compose cache-hit everything whose content hadn't independently drifted).
- **C.poincare-4 (widget anchor)**: NOT executed here — see deviations.

### Deviations from the plan as written

1. **§1.4 / Step 6 (widget anchor copy) reassigned** to the sibling `visual-channel` agent by the orchestrator before execution — no UI widget file touched. The lookup description carries the coordination sentence ("the visual panel shows the visitor only the top chunk's source page…"). `illustrate` and `find_options` descriptions untouched (other agents own them).
2. **`CustomerTipPublic` exposes `publishedAt` but NOT `sourceTitle`** — tips have no titled source; a never-populated schema field would be a lie. Plan outcome 2 listed both fields on all five schemas; this is the honest subset.
3. **Step 3 (ETL source dates for page/contentblock) not built** — Step 0 verdict made it moot this round; revisit only if a future MariaDB probe finds real editorial dates worth carrying.
4. **Pre-existing failures, not mine**: `@swoop/connector` typecheck has 5 errors in [embed-query.test.ts](../product/connector/src/data/__tests__/embed-query.test.ts) (tuple-index + RequestInit casts) — byte-identical on the main worktree at the same TS 5.9.3, so pre-existing; left unfixed (out of scope).
5. **Port collision honesty**: the main worktree's connector (Alastair's dev instance) owns :3002 and silently answered the first smoke (old code — fields absent). All reported smokes re-ran against this worktree's code on :3012/:8090; both services torn down after; Alastair's processes untouched.

### Test + typecheck state at hand-off

| Workspace | Typecheck | Tests |
|---|---|---|
| `@swoop/common` | clean | 189 passed (8 files) |
| `@swoop/connector` | clean except 5 pre-existing errors in `embed-query.test.ts` | 198 passed, 5 skipped (21 files) — includes 9 new provenance tests + updated migrations manifest |
| `@swoop/ingestion` | clean | 300 passed (22 files) |
