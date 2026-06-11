# ETL re-run — SQL dump to Postgres

Operator-facing runbook for re-running the SQL-dump-to-Postgres transform when Swoop sends a fresh export. Open this when the source data changes and the derived store needs to catch up.

---

## Why this exists

Puma's retrieval surface reads from a derived Postgres store (`puma_dev` in dev, the Cloud SQL instance in prod). The store is rebuilt from MariaDB-format SQL dumps Swoop's engineering team produces from `swoop_patagonia_prod`. When that source data changes — a new trip surfaces, an old one retires, customer reviews accumulate — the derived store needs to catch up.

Re-running ETL is the operator-side response to *"the website shows X but the agent doesn't know about it yet"*.

The transform runs as a Node CLI in dev (`npm run etl:sql --workspace @swoop/ingestion`). Post-M4 deploy it lives as a Cloud Run Job; the runbook steps are the same modulo *"trigger the job"* vs *"run the CLI"*.

---

## What you'll do every time

1. Get the latest dump from Swoop and land it in the dump location.
2. Apply any pending migrations against `puma_dev`.
3. Run the SQL transform against the dump.
4. Check the row counts against the expected baseline.
5. Re-run the embedding pass (a separate runbook — `embedding-rerun.md`) so derived prose, embeddings, and tag arrays catch up too.

Time-box: 5–15 minutes for the transform itself. The embedding pass that follows can take up to 24 hours via Anthropic's Batches API; that's `embedding-rerun.md`'s territory.

---

## Cadence + ownership

- **When**: event-triggered, not scheduled. Re-run when Swoop sends a fresh dump (cadence assumption: weekly, but unconfirmed — see `questions.md` "Re-run cadence — SQL dumps from Swoop"). Also re-run any time you suspect the derived store has drifted from production (`/chat` results contradict the website).
- **Who**: the **ETL operator**. At handover this is Swoop's ops team; until handover lands, Al.
- **How long**: ~5–15 min for the transform on the local fixtures. Production data sizes will scale linearly.

---

## Step 1 — Land the new dump

Swoop's engineering team produces dumps from `swoop_patagonia_prod`. There are two:

- The main schema dump (`export.sql` or similar — the big one, ~100MB+).
- The supplementary customer-review dump (`customerreview_tables_-_swoop-patagonia_prod.sql`).

Land both at the dump location (conventionally `<repo>/data/`):

```bash
ls data/*.sql
# data/content-data-swoop-patagonia_prod.sql
# data/customerreview_tables_-_swoop-patagonia_prod.sql
# data/customertip_swoop-patagonia_prod.sql
```

**`--dump <path-to-main-dump>` is REQUIRED** — there is no default location (corrected 2026-06-11; this runbook previously claimed the CLI defaulted to `<repo>/data/`, which cost a failed run). The supplementary customerreview + customertip dumps are auto-detected in the same directory as the main dump. Non-interactive runs also need `--yes`.

You'll know the dumps are right when:
- Both files are non-empty.
- The first ~20 lines of each look like MariaDB-format `INSERT INTO` statements with field-quoted columns.

---

## Step 2 — Apply pending migrations

Migrations are forward-only (decision **C.31**). Always apply pending migrations before running the transform — schema must be ahead of (or matching) the data.

```bash
npm run migrate:up --workspace @swoop/connector
```

You'll know it worked when:
- The output ends with a list of applied migrations or *"no migrations to run"*.
- Warnings like `Can't determine timestamp for 002` are **benign** — see `migration-management.md` for the full explanation. Don't panic, don't roll back.

If you see anything else, jump to `migration-management.md` and `troubleshooting.md`.

---

## Step 3 — Run the SQL transform

```bash
npm run etl:sql --workspace @swoop/ingestion -- \
  --dump <repo>/data/content-data-swoop-patagonia_prod.sql --yes
```

Flags:
- `--dump <path>` — **required**; path to the main dump (supplementary dumps auto-detected beside it).
- `--yes` — skip the interactive confirmation (required for non-TTY runs).
- `--only <table,table>` — scope to specific tables.
- `--database-url <url>` — override `DATABASE_URL` from `connector/.env`.

The transform streams the MariaDB inserts into the Postgres domain layer, applying the row-shape transformations declared in `product/ingestion/src/sql-transform/transformations.ts`. It's idempotent: re-running against the same dump produces zero net row delta. The second pass for `page.parent_id` runs automatically (self-FK two-pass write — see "When things go wrong").

You'll know it worked when:
- Wall-clock time prints at the end (~10s on the local fixtures).
- The skip-reason tally at the end shows `fk_nulled_*` and `fk_drop_*` counts in plausible ranges (single digits to low hundreds, not tens of thousands). Big jumps signal new orphan classes worth investigating.
- No exception trace.

---

## Step 4 — Check row counts

The expected end-state on the 2026-04-30 fixtures:

| Table | Expected rows |
|---|---|
| `trip` | ~852 |
| `tag` | ~79 |
| `image` | ~13,000 |
| `faq` | ~906 |
| `customerreview` | ~2,160 (published) |
| `customerreview_trip` | ~163 |
| `page` | high hundreds |
| `daybyday` | ~12,415 (filtered to `presale` + `trip_id IS NOT NULL`) |

These are the **baseline expectations**. Production-scale dumps will trend up; investigate if any count drops materially below the baseline.

Quick sanity-check query:

```bash
psql "$DATABASE_URL" -c "
  SELECT 'trip' AS t, COUNT(*) FROM trip
  UNION ALL SELECT 'tag', COUNT(*) FROM tag
  UNION ALL SELECT 'image', COUNT(*) FROM image
  UNION ALL SELECT 'faq', COUNT(*) FROM faq
  UNION ALL SELECT 'customerreview', COUNT(*) FROM customerreview
  UNION ALL SELECT 'page', COUNT(*) FROM page;
"
```

You'll know it worked when:
- All counts present and in the expected ranges.
- Re-running the transform a second time leaves the counts unchanged (idempotency check).

If you have access to the live Swoop website, a parity check on a handful of trips is a useful self-audit:
- Pick 3 trips from `trip_card` (the derived job-shaped table) at random.
- Open their canonical URLs and confirm the website shows them as live.
- If a trip is in your derived store but no longer on the website, the source dump may be carrying stale rows — flag back to Swoop engineering.

---

## Step 5 — Trigger the embedding pass

ETL just rebuilt the **domain** tables. The **derived job-shaped** tables (`inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`) need their prose embeddings + Haiku classifications re-computed before the agent's retrieval surface is current.

Run `embedding-rerun.md` next.

---

## When things go wrong

### Symptom: `Migration 006 not applied (customerreview table missing)`

The transform refuses to start because pending migrations weren't applied. Run step 2 (`npm run migrate:up`) and re-try.

### Symptom: `error: insert or update on table "page" violates foreign key constraint`

Self-referencing FKs need a two-pass write — `page.parent_id` references `page.id`, and child rows can land in the multi-row INSERT before their parent. The transform handles this internally (insert with `parent_id=NULL`, then UPDATE with the real parents). If you see this error, the two-pass logic isn't running — check the transform code in `product/ingestion/src/sql-transform/run.ts` (look for the `parentIdUpdates` handling). See `discoveries.md` 2026-05-02 for the full pattern.

### Symptom: `error: duplicate key value violates unique constraint "trip_slug_key"` or similar

Source dumps occasionally carry multiple rows with colliding values for what's a UNIQUE column on the derived schema (legacy alt versions of the same content). Multi-row INSERT then fails on the *batch* — within-batch UNIQUE violation, before ON CONFLICT can resolve. The transform de-duplicates in code keyed by the UNIQUE column, lowest-id winner. If you hit this, check that `SECONDARY_UNIQUE_KEY` in `flushBuffer` covers the affected table. See `discoveries.md` 2026-05-02.

### Symptom: `fk_nulled_image_id` count is huge (thousands)

Soft FKs (`page.image_id`, `contentblock.page_id`, etc.) get nullified at insert time when the target was filtered out (Profile pagetype pages, soft-deleted images). A normal run shows tens to low hundreds. Thousands of nullifications means the source dump is shedding more targets than expected — possibly a Swoop-side data cleanup or a schema change. Check the dump's source-row counts against history; if they've jumped, escalate to Swoop engineering before re-running enrichment.

### Symptom: ETL took materially longer than expected

The local fixtures complete in ~10s. If the run takes minutes:
- Check the dump location is on local disk, not a network mount.
- Check the Postgres pool config (libpq `options` for tunables — see `discoveries.md` 2026-05-01).
- Check `DATABASE_URL` points to the local Postgres instance, not a far-away Cloud SQL.

### Symptom: connection refused

`puma_dev` isn't running, or `DATABASE_URL` is misconfigured. See `troubleshooting.md` "Connector won't boot — Postgres unreachable".

---

## Open items for Al

These stay visible until resolved.

1. **Cadence assumption — weekly dump from Swoop**. Tracked in `questions.md`. Until Swoop confirms, assume weekly and re-run on receipt.
2. **Post-M4 deploy: Cloud Run Job triggering**. Today this is a local CLI; once Cloud Run Job lands, the runbook needs a *"trigger the job"* step replacing the local CLI. The verification commands stay the same.
3. **Production row-count baselines**. The numbers above are from the 2026-04-30 fixtures. Production-scale baselines need to land in this runbook once the prod DB is bootstrapped.
4. **`customertip` source table absent**. The 119 `contentblock_customertip` junction rows continue to dangle until Swoop ships the source table. Tracked in `questions.md` "Customertip source table".

---

## Where the rules came from

- Decision **C.31** — forward-only migrations.
- Decision **C.38** — filter shape A: filters in transform code, not views.
- Decision **C.39** — trip image resolution preference.
- `discoveries.md` 2026-05-02 — self-referencing FKs, FK orphan policy, within-batch UNIQUE dedupe.
- `03-exec-c-t3.md` — the Tier 3 plan that produced the transform.
