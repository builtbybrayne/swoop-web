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
