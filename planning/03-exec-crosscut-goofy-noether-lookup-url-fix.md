# Crosscut: lookup canonical-URL fix — FAQ chunks reach their page (F2)

**Kind**: Tier-3 cross-cut fix (review-driven). **Back-link**: [2026-06-11 widget-emptiness diagnosis §3 M2 + §6 F2](reviews/2026-06-11-widget-emptiness-diagnosis.md). Worktree-slug-stamped filename per the 2026-05-13 collision-avoidance discipline.
**Why crosscut**: touches `@swoop/connector` (migration), `@swoop/ingestion` (ETL transform + compose), and changes data the UI's lookup widget renders against — no single chunk owner.

---

## Problem

The lookup widget gates its entire render on a chunk carrying `canonicalUrl`; `inform_chunk.canonical_url` is 18/924 populated (all 906 FAQ-sourced rows NULL) → the widget has effectively never rendered on FAQ answers (diagnosis §3 M2). The compose's FAQ branch comments "FAQ items have no user-facing page title or editorial date" — wrong: the page is one join away. `faqitem.faqset_id ↔ contentblock.faqset_id → contentblock.page_id → page.{canonical_url, title}` reaches a page for **892/928** live source faqitems (the `faqset` table itself is absent from the dump but is not needed — `faqset_id` bridges directly). 24 of 147 faqsets place blocks on 2–8 pages; deterministic tie-break required.

**Blocker found during diagnosis**: `puma_dev.contentblock` does not carry `faqset_id` — the ETL projection never included it. Same class as the `trip.region_id` punt (2026-05-13 backfill precedent).

## Changes

1. **Migration 018** `product/connector/migrations/018_contentblock_faqset.sql` — `ADD COLUMN IF NOT EXISTS faqset_id INTEGER` + partial index. No FK (faqset table doesn't exist anywhere; the column is a join key only).
2. **ETL** `product/ingestion/src/sql-transform/run.ts` contentblock projection + `transformations.ts` `transformContentblock` — carry `faqset_id` through (`numOrNull`).
3. **Compose** `product/ingestion/src/enrich/compose/inform-chunk.ts` FAQ branch — `LEFT JOIN LATERAL` resolving the faqset's page (`ORDER BY p.id LIMIT 1` = lowest-page-id tie-break for the 24 ambiguous faqsets); populate `canonicalUrl` + `sourceTitle` (page title — also lights up the lookup widget's "Find out more about {title} →" anchor). `sourcePublishedAt` stays NULL (page dates are ETL timestamps, Step 0 verdict 2026-06-10). `content_hash` excludes both fields (migration 017 convention) → **cache hits preserved; re-compose costs ~£0 and re-uses all embeddings**.
4. **Test pin** `product/connector/src/__tests__/migrate.test.ts` — expect 018.

## Gated operations (each needs Alastair's named go; rename-never-drop; read-only MariaDB)

| Op | Command | Pre-manifest | Expected post |
|---|---|---|---|
| O1 migrate | `npm run migrate:up -w @swoop/connector` | migrations 001–017 applied | 018 applied; contentblock gains NULL faqset_id column |
| O2 ETL re-run | `npm run etl:sql -w @swoop/ingestion` | contentblock rows present, faqset_id all NULL; upsert touches ONLY projected source columns (annotations/embeddings untouched — verified upsert.ts contract) | faqset_id populated on FAQ-bearing blocks; zero row-count delta elsewhere (idempotent) |
| O3 re-compose inform | `npm run enrich -w @swoop/ingestion -- --mode=compose --source=inform` (flag shape TBC against CLI) | inform_chunk: 924 rows, url_pop 18, source_title 18, embedded 924; cache 3,298 | ~924 rows; url_pop ≈ 870–890 (FAQ rows whose faqset reaches a page among the 906 loaded); source_title same; embedded 924 via cache (zero Gemini calls) |

Post-O3 verification: coverage probe on `inform_chunk.canonical_url`; live lookup ask in the preview → widget renders one link card titled by the page.

## Execution log — 2026-06-11 evening (all ops executed with Alastair's named go)

**Commits**: `55fd6a0` (migration 018 + ETL projection + composer join + test pin) → `980a4d6` (amendment: faqset_id outranks the navigationcard junction + etl-rerun.md corrections).

**O0** ✓ baseline `data/backups/puma_dev_pre-O3_2026-06-11.dump` (182MB, pg_dump -Fc --no-owner --no-acl). **O1** ✓ migration 018 applied cleanly.

**O2** took three attempts — two findings worth keeping:
1. *The etl-rerun runbook's "default dump location" claim was false* — `--dump` is required (and `--yes` for non-TTY). Runbook corrected in `980a4d6`.
2. *All 183 FAQ-owning contentblocks sit in `contentblock_navigationcard`* — junction-first subtype derivation classed them as UI plumbing and dropped them (first retry reached only 80/906 via the 18 blocks that carried a second junction). Fix: `faqset_id` outranks the junction in `run.ts` — a block that owns a faqset is a FAQ block whatever chrome it renders in. Post-fix: contentblock 2,212 → 2,377 rows (+165, exactly the rescued blocks), faqset_id 183/183, **FAQ→page-URL reachability 872/906 (96%)** — matching the source ceiling (892/928 live faqitems; the gap is faqsets placing blocks only on unloaded/filtered pages). Row counts otherwise stable; image annotations (5,325) + embeddings (6,118) untouched, confirming the ON CONFLICT projection contract.

**O3** ✓ `enrich --mode=compose`: 42.8s, **£0.0000 spend** (full embedding-cache hydration). Post-manifest vs pre: all six derived tables byte-stable on row count (inspire 665 / story 953 / proof 39 / inform 924 / trip 649 / tour 11), 100% embedded. The headline: `inform_chunk` canonical_url + source_title coverage **18 → 890** (872 faq + 18 swoop_practical). Sample: "Do I need a guide?" → swoop-patagonia.com/chile/aysen/hiking, titled "Hiking in Aysen".

**Live verification** ✓ preview ask "How long should we go to Patagonia for? And do we need a guide?" → the lookup widget rendered **for the first time on FAQ content**: two titled link cards in the thread ("Find out more about Patagonia Tours & Vacations →", "Find out more about Hiking & Trekking in Patagonia →"); the dev-mode "rendered silently — no canonical URLs" note is gone.

**Residue**: the 34 unreachable faqitems (906−872) belong to faqsets whose blocks sit only on pages the ETL filters (Profile/test pages) — acceptable; the widget falls back to silent for those rare chunks. The 165 rescued blocks added zero new inform/inspire chunks (they carry no prose text — title-only navcard chrome), so derived-table contents beyond inform's URL/title columns are unchanged.
