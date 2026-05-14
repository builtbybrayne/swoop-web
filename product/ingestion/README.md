# `@swoop/ingestion`

Ingestion utilities feeding the Puma derived datasource (chunk C). Two pipelines today:

| Pipeline | Source | Target | Plan |
|---|---|---|---|
| **Blog snapshot** (`src/blog/`) | WordPress REST API at swoop-patagonia.com/blog | NDJSON snapshots under `data/blog/raw/` | [`planning/03-exec-blog-ingest.md`](../../planning/03-exec-blog-ingest.md) |
| **SQL dump → Postgres** (`src/sql-transform/`) | MariaDB dump (`data/content-data-swoop-patagonia_prod.sql` + supplementary `customerreview_tables_-_swoop-patagonia_prod.sql`) | `puma_dev` Postgres domain tables | [`planning/03-exec-c-t3.md`](../../planning/03-exec-c-t3.md) |

Both are operator-run (manual today; Cloud Run Job post-M4 per chunk C.t8). Disposable by design — when Swoop's source schema changes, the affected transform layer gets rewritten; nothing downstream changes.

---

## SQL-transform — operator runbook

### Prerequisites

1. **Local Postgres** at `puma_dev` (per `gotchas.md` "Local Postgres is Postgres.app v18"). Default URL: `postgresql://al:pick-a-password@localhost:5432/puma_dev`.
2. **Migrations applied**: from `product/`, run `npm run migrate:up --workspace @swoop/connector`. The CLI bails with a clear error if `customerreview` is missing (sentinel for migration 006).
3. **Dumps on disk** at the repo root under `data/`:
   - `data/content-data-swoop-patagonia_prod.sql` (~210 MB, MariaDB-format, 2026-04-27 dump).
   - `data/customerreview_tables_-_swoop-patagonia_prod.sql` (supplementary 2026-04-30 customerreview dump).

### Run

From `product/`:

```sh
npm run -w @swoop/ingestion etl:sql -- \
  --dump ../data/content-data-swoop-patagonia_prod.sql
```

The supplementary `customerreview` dump is auto-detected if it sits next to the main dump. Override with `--customerreview-dump <path>` if not.

`DATABASE_URL` is loaded from `product/connector/.env` automatically. Override with `--database-url <url>` if you need to point at a different database (e.g. a scratch DB for re-bootstrap testing).

### Optional flags

- `--dry-run` — parse + log counts; no writes.
- `--only=trip,page,image` — subset of target tables (comma-separated).
- `--yes` / `-y` — bypass the prod-host safety prompt (refuses to run if the URL contains "prod" without this flag).

### Expected output

```
[etl:sql] target Postgres: host=localhost db=puma_dev dry-run=false
[etl:sql] starting; dump=...
[etl:sql] pass 1 — building lookup tables
[etl:sql]   currency=11 file=31973 pagetype=20 ntag-entities=3872 image_trip=652 image_page=103
[etl:sql] pass 2 — streaming + transforming + upserting
[etl:sql] done in ~10s
[etl:sql]   country: 239/239
[etl:sql]   area: 16/16
[etl:sql]   location: 764/764
[etl:sql]   activity: 751/751
[etl:sql]   tag: 79/79
[etl:sql]   image: 13012/13261 skipped=filter:249
[etl:sql]   page: 636/684 skipped=profile_pagetype:40,test_page:7,...
[etl:sql]   contentblock: 2212/10110 skipped=filter:7898,...
[etl:sql]   chunk: 46/46
[etl:sql]   faqitem: 906/928 skipped=filter:22
[etl:sql]   trip: 852/852
[etl:sql]   tour: 11/15 skipped=cb_type_not_itinerary:3,page_not_loaded:1
[etl:sql]   tour_item: 35/36 skipped=fk_drop_tour_id:1
[etl:sql]   hotel: 44/44
[etl:sql]   vessel: 25/25
[etl:sql]   cabintype: 108/108
[etl:sql]   cabin: 98/98
[etl:sql]   customerreview: 2160/2563 skipped=filter:403   # 403 unpublished
[etl:sql]   customerreview_trip: 145/163 skipped=fk_drop_customerreview_id:18
```

### Idempotency

Re-running the CLI against the same dump produces zero row-count delta. Every transformation upserts via `INSERT … ON CONFLICT (id) DO UPDATE SET …`, with the column-update list pinned to those columns C.t3 owns — `embedding`, `subject_tags`, `mood_tags`, `region_tags`, `persona_summary` (populated by C.t3a / C.t6) are NOT in the SET clause and are preserved across re-runs.

### What it filters at the boundary

Per the C.t3 plan §"Skip list" (every filter has a journey-moment justification):

- **Profile pagetype** (40 rows) — staff bios, no journey moment (decision C.27).
- **Test pages** — dev/staging artefacts (decision C.28).
- **Soft-deleted rows** (`deleted IS NOT NULL`) across all source tables.
- **Non-itinerary `tours` rows** — a `tours` row is only kept if its parent `contentblock.type_id = 152` (the itinerary-block type). The other 3 of 15 hang off a hotel / guidebook / "Swoop Says" block. Tour identity (title/slug/url) is read from the parent block's *page*, not the vestigial `tours.title` column. See the 2026-05-14 addendum in `planning/03-exec-c-t3.md` (C.focused-shamir-1).
- **`tripvariant`, `season`, `adventurousness`** — operational draft management / fiscal-year scoping / deprecated style classifier.
- **`partner*`, `swooper_*` PII columns** — never load.
- **`enquiry`-typed `ntags_lookup` rows** (148K of 157K) — customer query PII.
- **`navigationcard` / `settings` / `page` contentblock subtypes** — UI plumbing, no prose.
- **`pressreview`, `customertip` source tables** — not in dumps; rows continue to dangle.
- **Unpublished customerreviews** (`is_published = FALSE`).

### Skip-reason taxonomy (in tally output)

| Reason | Meaning |
|---|---|
| `filter` | Transform function returned null (per-table filters: deleted / null required field / etc.). |
| `dup_id` | Within-batch duplicate primary id; lowest-id winner kept. |
| `dup_canonical` / `dup_<key>` | Within-batch duplicate of a UNIQUE secondary key (e.g. `page.canonical_url`, `tag.alias`, `trip.slug`); lowest-id winner kept. |
| `profile_pagetype` | Pagetype 20 (staff bio) per C.27. |
| `test_page` | Alias / title matches the test-page filter per C.28. |
| `cb_type_not_itinerary` | `tours` row whose parent contentblock isn't an itinerary block (`type_id ≠ 152`) — a hotel / guidebook / "Swoop Says" block carrying a `tours` row. |
| `page_not_loaded` | `tours` row whose parent contentblock has no kept page (page filtered upstream as test/profile/deleted/dup, or contentblock has a null `page_id`). |
| `orphan_parent_nulled` | Page's `parent_id` references a filtered-out page; nulled at write. |
| `orphan_image_nulled` | Page's `image_id` / `bannerimage_id` references an image we filtered (deleted / no `file` row); nulled at write. |
| `fk_nulled_<col>` | Generic FK column nulled because target row wasn't loaded. |
| `fk_drop_<col>` | Row dropped because a NOT NULL FK target wasn't loaded (junctions: `tour_item.tour_id`, `cabin.vessel_id`, `customerreview_trip.{customerreview_id,trip_id}`). |

### Re-running against a fresh DB

If you need to start from scratch:

```sh
PG=/Applications/Postgres.app/Contents/Versions/latest/bin
$PG/dropdb puma_dev    # if no other process holds connections
$PG/createdb -O al puma_dev
$PG/psql -d puma_dev -c "CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;"
cd product && npm run migrate:up --workspace @swoop/connector
npm run -w @swoop/ingestion etl:sql -- --dump ../data/content-data-swoop-patagonia_prod.sql
```

### When row counts diverge materially

Counts shifting by more than ~5% from the table above means Swoop's dump structure changed. Don't paper over it — investigate. The dump is upstream-of-truth; we don't shape data to match expectations.

---

## What this layer does NOT do

- **No embeddings.** Vector columns left null; populated by C.t3a (Voyage-3 + Haiku ETL classifier passes).
- **No image annotations.** `subject_tags`, `mood_tags`, `region_tags`, `alt_text` left empty; populated by C.t6 (Claude Vision pipeline). `image.description` IS populated where the source carries it (~47.5%) — primes C.t6 to skip already-annotated images.
- **No persona summary.** `customerreview` rows ingested; `customer_story.persona_summary` derivation is C.t3a's Haiku pass (aggregating by reviewer name).
- **No derived job-shaped tables** (`inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`). Synthesised at C.t3a from the populated domain tables.
- **No tool handlers, no MCP server, no orchestrator wiring.** That's C.t4, B.t3a, D.t9.

---

## Coordination

- **C.t3a** reads from the populated domain tables filled here. Column ownership convention: `embedding`, `subject_tags`, `mood_tags`, `region_tags`, `alt_text`, `persona_summary`, `persona_embedding`, `primary_job`, `secondary_jobs` are **NOT** in C.t3's `ON CONFLICT DO UPDATE SET` clauses, so re-running this CLI never clobbers C.t3a's work.
- **Blog ingest** (`src/blog/fetch.ts`) writes its NDJSON snapshots under `data/blog/raw/`. C.t3a reads those snapshots into the `blog_post` + `blog_chunk` tables (separate from this CLI's scope).

See [`planning/03-exec-c-t3.md`](../../planning/03-exec-c-t3.md) for the full Tier 3 spec including transformation tables, the calibration check ("every transformation traces to a job"), and the open-question resolutions from the 2026-05-01 HITL ratification.
