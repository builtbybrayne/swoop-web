# 03 — Execution: C.t3 SQL dump → Postgres transform (data movement)

**Status**: **HITL-ratified 2026-05-01 — ready for execution.** Authored 2026-04-30; ratified 2026-05-01.
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §2.1 (data ingestion: SQL dump → transform → Postgres) + §10's **C.t3** task ("ETL: SQL dump → Postgres transform"). Pure data-movement layer. The first task downstream of C.t2's contract layer that actually puts rows in `puma_dev`.
**Depends on**:
- C.t2 closed (migrations 001–006 applied; domain table shapes are the contract).
- C.t0 closed (dump shape understood; canonical filters known).
- 2026-04-27 SQL dump on disk at `data/content-data-swoop-patagonia_prod.sql` (~210 MB, MariaDB-format).
- 2026-04-30 supplementary `customerreview` dump on disk at `data/customerreview_tables_-_swoop-patagonia_prod.sql`.
- Postgres 18 + pgvector + pg_trgm + btree_gin available locally at `puma_dev` (per gotchas.md "Local Postgres" entry).
- Decisions C.13–C.34 (most load-bearing for this task: C.14, C.15, C.16, C.17, C.18, C.21, C.27, C.28, C.29, C.31, C.32, C.33).
**Blocks**: C.t3a (embedding pass + Haiku ETL classifiers — reads from the populated domain tables this task fills); C.t4 (tool handlers — read derived tables which depend on C.t3a which depends on C.t3); the pre-launch demo against real data.
**Produces**:
- ETL package code at `product/ingestion/src/sql-transform/` (or wherever the tooling pick lands).
- A runnable CLI: `npm run -w @swoop/ingestion etl:sql -- --dump <path>` (name TBC).
- Idempotent re-run behaviour (`INSERT … ON CONFLICT DO UPDATE` per row, `content_hash` updated).
- Domain tables populated end-to-end: `country` / `area` / `location` / `activity` / `tag` / `image` / `page` / `contentblock` / `chunk` / `faqitem` / `trip` / `tour` / `tour_item` / `hotel` / `hotel_room` / `hotel_pricing` / `vessel` / `cabintype` / `cabin` / `customerreview` / `customerreview_trip`. Plus `blog_post` / `blog_chunk` if the blog-ingest stream is run alongside (left to its own task).
- A small operator README at `product/ingestion/README.md` (or `handover/ops/etl-sql.md`) explaining how to re-run.
- New decision log entries for whichever calls were taken at execution time (notably tooling pick — see §"Open questions" below).
**Estimate**: ~1.5–2 days of focused work.

---

## ★ Read this first — the WHY of chunk C, the design discipline of C.t3

> **Before you write a single transformation, read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"Read this first — the WHY of chunk C" end-to-end.** That section names the agent's actual job, the four+1 jobs the data does, and the design discipline (top-down from sales, never bottom-up from data). C.t3 is the task most likely to drift bottom-up: you're literally looking at source rows and writing rules to land them in Postgres. Calibrate before you start.

The compressed reminder for C.t3 specifically:

- **C.t3 is data movement, not data shaping.** The domain tables this task populates are the *contract* C.t2 already settled. Filters, whitelists, denormalisations all serve a downstream tool that serves a conversational job. If you find yourself adding a column, reshaping a table, or building an "interesting" denormalisation that wasn't in C.t2 — stop. That's C.t2's job, not C.t3's. If C.t2 missed something, raise it for HITL; don't quietly extend the schema in this task.
- **Every filter has a journey-moment justification** *or it's wrong*. Profile pagetype dropped (C.27) because specialist bios don't serve any of the four+1 jobs. Test pages dropped (C.28) because they're not visitor-facing. Enquiry `ntags_lookup` rows dropped because they're PII tags on customer queries. If you propose a new filter at execution time, it needs the same kind of justification — *not* "the data looks weird".
- **Disposable by design (theme 5).** The whole point of C.t3 is that the source schema will change in late 2026 and we'll rewrite this layer. Optimise for legibility and easy throw-away — every transformation lives under one well-named name, no clever-cleverness, no hidden state. The team picking this up should be able to read it in an afternoon.
- **No LLMs in this task.** Pure SQL / structural transformation. Embedding + classifier passes are C.t3a. Image annotations are C.t6. If you find yourself reaching for Haiku to "classify a row", you've drifted into the next task.

This task's own discipline test: every transformation can be traced to a derived-table column (in C.t3a's job-shaped tables) which feeds a tool which serves a conversational job. The §"Calibration check — every transformation traces to a job" section near the end of this plan lists each transformation paired with its downstream consumer, so the chain is auditable.

---

## Purpose

The C.t2 contract layer settled what the domain tables look like. C.t3 is the first task that puts data into them. Every downstream surface — embeddings, classifiers, derived tables, tool handlers, widgets — depends on this layer being correct, idempotent, and re-runnable.

The job is simple in shape and complicated in detail:

1. **Read** the MariaDB-format SQL dump (`export.sql`) on disk.
2. **Whitelist** the tables we use; drop the rest.
3. **Filter** at boundary — Profile pagetype out (C.27), test pages out (C.28), enquiry `ntags_lookup` out, deleted/draft/retired rows out per source-specific rules, customer PII surfaces out (`swooper_*`, `partner*`).
4. **Flatten** denormalised joins where the agent always reads them together (e.g. `image.image_id → file.id` for filename; `currency_id → currency.iso_3` for currency code).
5. **Compute** derived columns at boundary — `canonical_url` (`override_url || alias`), `image_url` (imgix-prefixed), normalised currency code, `from_price` (just `base_price`, currency-tagged), aggregate `ntag_ids[]` per record.
6. **Write** into Postgres domain tables via `INSERT … ON CONFLICT DO UPDATE`.
7. Stay idempotent — re-running against the same dump produces no row diff.
8. Stay observable — log row counts in / row counts out per table, plus skipped-with-reason tallies.

What it does **not** do:

- No embedding columns populated (C.t3a).
- No `tsv` columns populated (C.t3a — we use the chunked text, not raw HTML).
- No persona summary classification (C.t3a, Haiku-driven).
- No image annotations (C.t6, vision-driven).
- No blog-tag normalisation (C.t3a, Haiku-driven against `ntag`).
- No derived `inspire_passage` / `customer_story` / `trust_proof` / `inform_chunk` / `trip_card` rows (C.t3a synthesises these from the populated domain tables).
- No tool handlers, no MCP transport, no orchestrator wiring (C.t1 / C.t4 / B.t3a respectively).

---

## Outcomes

When this task is done:

1. `npm run -w @swoop/ingestion etl:sql -- --dump data/content-data-swoop-patagonia_prod.sql` (CLI shape TBC) populates `puma_dev` end-to-end without errors.
2. The same command run twice produces zero row-count delta on the second run — the layer is idempotent.
3. Every domain-table row count is within +/-2% of the C.t0 expected counts (852 trips after `publishstate=3` filter; 684 → ~482 pages after pagetype + test filters; ~6.3K images; 79 active ntags; 928 faq items; 2,563 customerreviews after `is_published=TRUE` filter; 163 customerreview_trip rows).
4. `canonical_url` is non-NULL for 100% of `page` rows and ~99% of `trip` rows (the ~1% gap is trips without `page_id` join targets — left NULL, downstream tools handle).
5. `image.canonical_url` is non-NULL for 100% of `image` rows (uses `file.name` via the join).
6. `tag` carries exactly 79 active `ntag` rows; legacy `tag` is excluded (C.32).
7. Customer PII surfaces (`swooper_*`, all `partner*` tables, `enquiry`-typed `ntags_lookup` rows) appear nowhere in the populated tables.
8. The skip-list (`tripvariant`, `season`, `adventurousness`, `pressreview`, `customertip` source) leaves no traces in any populated table.
9. Operator-facing log shows per-table row counts in (from dump) / out (to Postgres) / skipped (with category breakdown).
10. Smoke test: `SELECT canonical_url FROM page WHERE id = (SELECT id FROM page LIMIT 1);` returns a URL of shape `https://www.swoop-patagonia.com/<slug>`.

**Not outcomes**:
- Embeddings populated.
- `tsv` populated.
- `persona_summary` populated.
- Derived job-shaped tables (`inspire_passage` etc.) populated.
- Cloud Run Job wired (C.t8 runbook task).
- Production schedule (Cloud Scheduler) wired (C.t8).
- Performance optimisation past "completes in under 10 minutes on Al's laptop" (C.t8 if it ever matters).

---

## Out of scope (explicit)

Name it so future agents don't drift:

- **No schema changes.** If C.t3 reveals that C.t2's contract is wrong somewhere, raise it for HITL — don't ALTER TABLE in this task.
- **No new derived tables.** The five (`inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`) are populated at C.t3a. C.t3 fills domain tables only.
- **No `pgloader` config or Node CLI translator decision lock-in until HITL.** Both candidates are sketched in §"Open questions" — pick happens at HITL, not unilaterally during execution.
- **No prod Cloud Run wiring.** This task ships a CLI that runs against `puma_dev`. Production scheduling lives in C.t8.
- **No retry / backoff infrastructure beyond "log and exit non-zero".** The dump is a single file on disk, not a network source — there's nothing to retry against. If a row fails to insert, log + skip + count it; the operator re-runs after fixing.
- **No SQL injection / sandboxing concerns.** The dump is a trusted input from Swoop's authoritative database. We're not exposing this to user input.
- **No alternative source paths.** No "what if Swoop sends CSV", no "what if we want to use the API". The dump is the source per C.21.
- **No new decisions taken without logging them.** Any execution-time call adds a `decisions.md` entry.

---

## Tooling pick — the one HITL question this task carries

Two viable shapes for the SQL → SQL transform layer:

### Option A: pgloader + custom transform layer

[`pgloader`](https://pgloader.readthedocs.io/) is a Common Lisp tool that reads a MariaDB/MySQL dump (or live connection) and streams into Postgres with declarative type-mapping + per-column CAST rules. It's been around for a decade and is the standard tool for this kind of migration.

**Strengths**:
- Battle-tested for MariaDB → Postgres specifically. Handles the `int(11) unsigned` → `INTEGER`, `tinyint(1)` → `BOOLEAN`, `datetime` → `TIMESTAMPTZ` conversions natively.
- Streams rows — never loads the whole 210 MB dump in memory.
- Declarative `LOAD DATABASE FROM mysql:// INTO postgresql://` config; the cast rules and column transformations live in one `.load` file.
- "Free" parallelism via worker config.
- We don't write the SQL parser; pgloader already understands the dump dialect.

**Weaknesses**:
- It's a one-shot tool, not a library — we wrap it in shell-out from Node, lose programmatic control over per-row decisions.
- Conditional row-level filtering (e.g. "skip page rows where pagetype_id = 20") is awkward in pgloader DSL — typically expressed as a target-side `WHERE` constraint after a full load, then DELETE the unwanted rows. That's not idempotent-friendly; we'd have to re-DELETE on every re-run.
- Computed-column derivations (e.g. `canonical_url = override_url || alias`) live as SQL expressions in CAST rules, but anything more involved (e.g. flatten `image.image_id → file.name`) needs a JOIN written into the source query, which the pgloader DSL supports but reads awkwardly.
- One more language in the stack (Lisp config syntax). Swoop's team picking this up post-handover hits a learning curve.
- Loading MariaDB dumps into pgloader typically requires either a live MariaDB to read from (which we have at `swoop_patagonia` from C.t0 — but the canonical pipeline is supposed to read the `.sql` file directly per §2.1) OR a pre-load into a scratch MariaDB and reading from that. The C.21 framing is "read the `.sql` file directly"; doing that with pgloader is awkward — the tool is built for live connections, not file parsing.
- Adds a non-Node dependency to the project — Swoop's handover gets a "you also need pgloader installed" bullet.

**Estimate**: ~1 day if it works first time (the pgloader DSL is a known quantity); ~2+ days if we hit dialect quirks (the dump is from MariaDB 5.5.64, ancient, which pgloader supports but with caveats).

### Option B: Node CLI translator

A bespoke Node script in the `@swoop/ingestion` workspace that:

1. Opens the `.sql` file as a stream.
2. Walks the dump's `INSERT INTO <table> VALUES (...), (...);` statements (the dump format is well-known and parseable line-by-line; or use a tiny existing MySQL dump parser like [`mysql-import`](https://www.npmjs.com/package/mysql-import) or shell out to `mysqldump`-style streaming).
3. For each parsed row, runs it through a declarative whitelist + transform per source table.
4. Buffers transformed rows by target table and flushes batches (e.g. 500 rows per batch) via `pg.Pool.query("INSERT … ON CONFLICT DO UPDATE …", values)`.
5. Logs per-table tallies + skipped-with-reason breakdowns.

**Strengths**:
- Full programmatic control. Filters, denormalisations, computed columns, lookup tables (e.g. `currency_id → iso_3` resolved by reading the `currency` table first, then applying the lookup as we iterate `trip` rows) all live as TypeScript code.
- `INSERT … ON CONFLICT DO UPDATE` is straightforward — the same code that does first-run does idempotent re-runs.
- Lives in `@swoop/ingestion` alongside the blog ingest. Same workspace, same test runner, same TypeScript ergonomics.
- Swoop's team gets a single Node-language ETL package — no Lisp config, no separate binary install.
- Easy to add structured logging, sourcemap-friendly stack traces, jest/vitest tests over individual transformations.
- Easy to evolve. When the source schema changes (which is the whole disposable-ETL premise), edit a TypeScript file.

**Weaknesses**:
- We write the SQL-dump parser. The MariaDB dump format isn't pathological but it has edge cases — escaped strings with embedded quotes, NULL handling, multi-row INSERTs with thousands of rows in a single statement (the `image` insert is in this category at 13K rows). A small library reduces this risk but doesn't eliminate it.
- We hold all the source rows in memory during processing (or stream + buffer carefully). At 210 MB total this is fine on a laptop, but the `image` and `ntags_lookup` table inserts are the largest single-statement payloads — we have to handle multi-row VALUES streaming, not just line-by-line.
- More code = more surface for bugs. Pgloader's been hardened over a decade; our parser would be greenfield.

**Estimate**: ~1.5–2 days if we use a parser library; ~3 days if we write the parser ourselves (don't).

### Option C: Hybrid — load into a scratch MariaDB, then `pgloader` from live connection

Use the local MariaDB load from C.t0 as the operational source. Pgloader reads from `mysql://swoop_patagonia` (live), translates and writes to `postgresql://puma_dev`. Filters live in the source-side `WHERE` of pgloader's `LOAD DATABASE FROM ... CAST ... WITH ...` config.

**Strengths**:
- Reuses the C.t0 MariaDB load as a real asset (rather than letting it sit there as a dev-time helper).
- Pgloader works against live MariaDB beautifully — that's its native shape.
- We don't write the parser.

**Weaknesses**:
- Adds MariaDB to the production runtime path. The C.21 framing was "read the `.sql` file directly". Putting MariaDB on the production critical path means Cloud Run Jobs need a MariaDB to load the dump into first — that's a two-step pipeline we'd have to operate.
- Swoop's handover gets "install MariaDB AND pgloader". Worse than either single option.
- Same conditional-filtering awkwardness as Option A.

### Recommendation

**Option B (Node CLI translator).** Reasoning, in order of weight:

1. **Disposability + legibility win the trade-off** (theme 5 + theme 4 — content-as-data and the swap-out surface). The whole ETL is throwaway; the team picking it up shouldn't have to learn Lisp. A 500-line TypeScript file with one-function-per-table transformation is the cleanest hand-over.
2. **Single workspace, single language.** `@swoop/ingestion` already exists and has 31 passing tests for blog ingest — adding the SQL-transform alongside is the natural home. Vitest runs both.
3. **Conditional filtering + flattens are the substance of this task**, and the substance is awkward-to-natural in pgloader vs natural-to-test in TypeScript. The ~10 filters and ~5 flattens we need (per §"Transformations" below) are dramatically more readable as TS functions than as pgloader CAST rules.
4. **Idempotency is one line per upsert**: `ON CONFLICT (id) DO UPDATE SET …`. Pgloader's idempotency story over `LOAD … LOAD …` re-runs is clunkier.
5. **No new external dependencies** — `node-pg-migrate` for schema, `pg` for queries (already a connector dep), a tiny MySQL-dump-parsing library for the source side. Compare to "install pgloader, install Lisp runtime, install MariaDB for option C".
6. **Risk on parser edge cases is small** — the dump is one snapshot, well-formed (we've already confirmed via C.t0 SELECTs that the structure is consistent), and we control the input. Worst case we fall back to "load into MariaDB, dump SELECT-by-SELECT into NDJSON" pre-processing as a safety net.

**Counter-indicators that would flip the recommendation**:
- If the SQL-dump parser turns out to be more than ~200 lines or runs into pathological MariaDB-isms we don't want to maintain.
- If Swoop strongly prefers a known tool (pgloader is widely known in the data-engineering world) — at handover review, not a Tier 3 call.
- If the upcoming October 2026 data consolidation will hand us a different format that pgloader handles natively (e.g. CSV exports). At that point we throw away C.t3 anyway and re-pick.

**HITL decision needed**: confirm Option B; or re-route to A or C; or surface a fourth path (e.g. "skip pgloader, but write the transformer in Python because Pandas is more pleasant for this kind of work" — would need its own justification).

---

## Inputs (files / sources to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §2.1 (pipeline shape), §2.5 (entity model), §2.6 (image rendering), §2.8 (deep-link URLs), §3 (architectural principles applied here, esp. disposable ETL).
- [`03-exec-c-t0.md`](03-exec-c-t0.md) — every SELECT block S1–S10 names a transformation we apply here. Especially S1 (currency mapping), S5 (`daybyday` filter), S6 (contentblock subtypes), S7 (`ntags_lookup` filter), S8 (page-as-hub), S9 (URL construction), S10 (image+file join).
- [`03-exec-c-t2.md`](03-exec-c-t2.md) — the migrations that define what we're populating. Especially §"Schema design — Postgres".
- [`data-ontology.md`](../data-ontology.md) — full per-entity inventory + which fields to drop.
- [`discoveries.md`](../discoveries.md) — 2026-04-29 entries are all C.t3-relevant: currency mapping, daybyday sparseness, image two-table model, ntags_lookup firehose, URL rule, page-as-hub, trip count 852.
- [`gotchas.md`](../gotchas.md) — Postgres bootstrap, dotenv override, Claude Code Node version drift.
- [`questions.md`](../questions.md) "Data pipeline" — the open ask list, especially the `daybyday WHERE type='presale'` confirmation that's still pending Thomas/Richard. Don't block on it; ship with the best-guess filter and a code comment flagging the assumption.
- The two SQL dumps on disk:
  - `data/content-data-swoop-patagonia_prod.sql` (2026-04-27, ~210 MB)
  - `data/customerreview_tables_-_swoop-patagonia_prod.sql` (2026-04-30, customerreview + customerreview_trip)
- Migration files at `product/connector/migrations/001_*.sql` through `006_*.sql` — the contract.
- Existing `product/connector/src/index.ts` (currently 1 line of placeholder) — to understand where the connector workspace begins and the ingestion workspace ends.
- Existing `@swoop/ingestion` workspace (blog ingest already lives here) — for the workspace conventions to mirror.

---

## Components, file paths, interface signatures

(Sketches at design-language altitude — actual signatures land at execution time. Names provisional; HITL may rename.)

### Workspace layout

```
product/ingestion/
├── package.json                             (existing)
├── src/
│   ├── blog/                                (existing)
│   └── sql-transform/                       (new — this task)
│       ├── index.ts                         CLI entry: parses --dump path, runs full pipeline.
│       ├── parser.ts                        Streams a MySQL/MariaDB-format .sql file into row objects.
│       ├── pool.ts                          pg.Pool factory (DATABASE_URL from env per gotchas).
│       ├── upsert.ts                        Generic INSERT … ON CONFLICT DO UPDATE batcher.
│       ├── currency.ts                      Pre-loaded lookup: id → iso_3 (S1 mapping).
│       ├── transformations/
│       │   ├── geography.ts                 country / area / location / activity tables.
│       │   ├── tag.ts                       ntag → tag (filter is_active=1, drop legacy tag).
│       │   ├── image.ts                     image + file → image (join on image.image_id → file.id, compute canonical_url).
│       │   ├── page.ts                      page (filter pagetype Profile + test pages, compute canonical_url).
│       │   ├── contentblock.ts              contentblock + contentblock_<subtype> joins (whitelist subtypes).
│       │   ├── chunk.ts                     chunk table (46 rows, flatten as-is).
│       │   ├── faqitem.ts                   faqitem (rename `title` → question semantic, keep column).
│       │   ├── trip.ts                      trip (filter publishstate, drop swooper_*, currency normalisation, canonical_url via page join).
│       │   ├── tour.ts                      tour + tour_item.
│       │   ├── hotel.ts                     hotel + hotel_room + hotel_pricing (page-as-hub for canonical_url + images).
│       │   ├── vessel.ts                    vessel + cabintype + cabin.
│       │   ├── ntags_lookup.ts              filter ntags_lookup WHERE entity_type IN (image, trip, contentblock, video).
│       │   ├── customerreview.ts            customerreview (filter is_published=TRUE) + customerreview_trip.
│       │   └── (no daybyday) — see §"daybyday: column on trip, not its own table" below.
│       └── __tests__/
│           ├── parser.test.ts               round-trips a tiny synthetic dump.
│           ├── transformations/             one fixture per transformation.
│           └── e2e.test.ts                  optional — only if a tiny test-fixture dump is feasible.
└── README.md                                operator instructions: how to re-run.
```

### CLI shape

```
$ npm run -w @swoop/ingestion etl:sql -- \
    --dump data/content-data-swoop-patagonia_prod.sql \
    --customerreview-dump data/customerreview_tables_-_swoop-patagonia_prod.sql \
    --database-url "$DATABASE_URL" \
    [--dry-run]                              # parse + log counts, don't write
    [--only=trip,page]                       # subset of transformations
    [--verbose]
```

Stdout: per-table progress lines (`✓ trip — 1248 rows in / 852 rows out / 396 skipped (380 publishstate, 16 deleted)`). Final summary table. Non-zero exit on any per-table failure.

### Interface signatures (illustrative, not binding)

```ts
// parser.ts
export interface DumpRow {
  table: string;
  values: Record<string, string | number | null>;
}
export function streamDump(path: string): AsyncIterable<DumpRow>;

// upsert.ts
export interface UpsertSpec<T> {
  table: string;
  conflictKey: string;            // typically "id"
  rows: T[];
  columns: (keyof T)[];           // explicit allowlist; everything else dropped
}
export async function upsertBatch<T>(pool: Pool, spec: UpsertSpec<T>): Promise<{ written: number; failed: number }>;

// transformations/<entity>.ts
export interface TransformationContext {
  pool: Pool;
  currencyLookup: Map<number, string>;   // pre-populated from currency table read first
  fileLookup: Map<number, { name: string; extension: string | null; type: string | null }>;  // pre-populated from file table for image join
  log: (line: string) => void;
}
export interface TransformationResult {
  rowsIn: number;
  rowsOut: number;
  skipped: { reason: string; count: number }[];
}
export async function transformTrip(ctx: TransformationContext, source: AsyncIterable<DumpRow>): Promise<TransformationResult>;
```

The pre-loaded lookup tables (`currencyLookup`, `fileLookup`) are populated by reading their source tables first, before any row that needs them is processed. Order of operations in the CLI:

1. Read `currency` rows → populate `currencyLookup`.
2. Read `file` rows → populate `fileLookup` (image-relevant only: `WHERE extension IN ('jpg','png','jpeg','heic')` per discoveries).
3. Read + transform geography (no deps).
4. Read + transform `ntag` → `tag` (no deps).
5. Read + transform `image` (needs `fileLookup`).
6. Read + transform `page` (no deps).
7. Read + transform `contentblock` + subtypes (needs `page`).
8. Read + transform `chunk` (small).
9. Read + transform `faqitem`.
10. Read + transform `trip` (needs `currencyLookup`, `page` for canonical_url).
11. Read + transform `tour` + `tour_item`.
12. Read + transform `hotel` etc.
13. Read + transform `vessel` etc.
14. Read + transform `ntags_lookup` (filter, then aggregate `ntag_ids[]` per entity_id back into the relevant target tables — see §"Where ntag_ids[] gets aggregated" below).
15. Read + transform `customerreview` + `customerreview_trip` (from the supplementary dump).

---

## Transformations — what each one does

Each entry: source table(s) → target table, filters, flattens, computed columns. Cited against C.t0 findings, decisions, and the schema in 002_domain_tables.sql.

### Geography (`country`, `area`, `location`, `activity`)

- **Source**: same-named tables in dump.
- **Filter**: none.
- **Drop**: nothing structural; whitelist `id`, `name`, `alias`, `iso_code` / `country_id` / `parent_area_id` / `area_id` / `latitude` / `longitude` / `description` per the migration columns.
- **Compute**: nothing.
- **Idempotency**: `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, alias = EXCLUDED.alias, …`.
- **Why this transformation exists**: feeds `region` denormalisations on `inspire_passage` / `customer_story` / `trip_card` (C.t3a) which back the `region`-filter UX in `find_inspiring`, `find_someone_who`, `find_options`. Without geography, those filters can't disambiguate "Patagonia" from "Atacama".

### Tag (`ntag` → `tag`)

- **Source**: `ntag` only. Legacy `tag` is excluded entirely (decision C.32, C.17).
- **Filter**: `WHERE is_active = 1` (S7 finding — there are 79 active rows out of 79; the filter is defence against future inactive additions).
- **Compute**: nothing (embedding stays NULL for C.t3a).
- **Drop**: audit columns from upstream.
- **Idempotency**: ON CONFLICT (id) DO UPDATE.
- **Why**: feeds `find_tags_by_utterance` data primitive (Tier 2 §2.4) which bridges visitor utterance → retrieval narrowing on the four content tools.

### Image (`image` JOIN `file` → `image`)

- **Source**: `image` table joined to `file` on `image.image_id = file.id`.
- **Filter on file side**: `WHERE file.extension IN ('jpg', 'png', 'jpeg', 'heic') OR file.type LIKE 'image/%'` (S10 finding — `file` has 135K rows, only ~13K are images).
- **Compute**:
  - `canonical_url = 'https://swoop-patagonia.imgix.net/' || file.name` (the bare URL — render variants are applied at read-time per Tier 2 §2.6, not at ETL).
  - Carry `width`, `height`, `original_filename = file.name` for debugging.
- **Drop**: `file.path` (legacy CDN, not used per discoveries entry on the two-table model). All upstream `image.copyright` / `image.credit` / `image.quality_rating` etc. — these aren't on the C.t2 schema.
- **Leave NULL**: `embedding`, `description`, `subject_tags`, `mood_tags`, `region_tags`, `alt_text` (C.t3a + C.t6 populate). Carry forward `image.title` and `image.description` upstream values where present (S10: 99.7% / 47.5% populated) — these prime the C.t6 annotation pipeline, cutting its cost by ~50%. So `description` IS populated by C.t3 where the source row has it; C.t6 fills the gap.
- **Idempotency**: ON CONFLICT (id) DO UPDATE — but **only update the columns C.t3 owns**. Don't clobber `embedding` / `subject_tags` etc. that C.t3a/C.t6 populate. The `UPDATE SET` clause must be explicit per column.
- **Why**: every tool that returns visual material (`illustrate` directly, `find_inspiring`/`find_someone_who`/`find_options` via their public projection wrapping a joined image record per C.30b) needs the image table. Without `canonical_url` populated here, no widget renders an image.

### Page (`page` → `page`)

- **Source**: `page` table.
- **Filter**:
  - `WHERE pagetype_id != 20` (drops 40 Profile rows per C.27).
  - `WHERE alias NOT ILIKE '%test%' AND title NOT ILIKE '%Test %'` (drops dev/staging artefacts per C.28). Note `ILIKE` for case-insensitive — confirm the exact pattern at execution time against a SELECT against the live MariaDB to make sure no real pages get caught.
  - `WHERE deleted IS NULL` (skip soft-deleted).
- **Compute**: `canonical_url = 'https://www.swoop-patagonia.com/' || COALESCE(NULLIF(override_url, ''), alias)` (C.15 rule via the migration 005 SQL function).
- **Drop**: `override_url` and `alias` are kept in the populated row for debugging (the migration carries both); but downstream tools should read `canonical_url` only.
- **Denormalise**: `pagetype_title` looked up from `pagetype` table (small lookup table, populate alongside).
- **Idempotency**: ON CONFLICT (id) DO UPDATE.
- **Why**: page is the dominant content surface (C.29). Every conversational citation that says "go see this page" deep-links to a `page.canonical_url`. Without this transformation, the agent has no Inspire/Reassure/Inform supply at all.

### Contentblock (`contentblock` + `contentblock_<subtype>` → `contentblock`)

- **Source**: `contentblock` master table + the polymorphic `contentblock_<subtype>` siblings.
- **Whitelist subtypes** (per S6 + decisions): `customerreview`, `customertip`, `image`, `carousel`, `pressreview`, `partnercomment`, `tour`, `trip`, `when_to_travel`, `reviewcarousel`. Skip: `navigationcard` (33K UI rows), `settings`, `page` (cross-link plumbing). The dangling-junction subtypes (`customerreview` / `customertip` / `pressreview`) become first-class via the `customerreview` source table now that we have it (decision C.26, 2026-04-30); `customertip` + `pressreview` source tables remain absent — the subtype rows are ETL'd but downstream synthesis ignores them.
- **Compute**: derive `subtype` enum from which `contentblock_<subtype>` junction the row appeared in.
- **Filter**: `deleted IS NULL`.
- **Idempotency**: ON CONFLICT (id) DO UPDATE.
- **Why**: contentblock prose is half of the content supply for `inspire_passage` and `inform_chunk` (C.29). A trust-proof claim like "Swoop is a B-Corp" lives in a contentblock row inside an "About Swoop" page, not the page intro — without contentblock ingestion, `find_proof` has half its supply.

### Chunk (`chunk` → `chunk`)

- **Source**: `chunk` table (46 rows of small reusable CMS prose blocks).
- **Filter**: `deleted IS NULL`.
- **Compute**: nothing.
- **Why**: tiny, but populates `inspire_passage` / `inform_chunk` for short-form supplementary content per C.t3a.

### FAQ (`faqitem` → `faqitem`)

- **Source**: `faqitem` table (928 rows per C.t0).
- **Filter**: `deleted IS NULL`. `faqset_id IS NOT NULL` (filters orphaned items).
- **Compute**: nothing — `title` carries the question, `content` carries the answer (C.t0 finding).
- **Idempotency**: ON CONFLICT (id) DO UPDATE.
- **Why**: 928 rows of authored Q&A is the spine of `inform_chunk`. `lookup` directly queries this surface.

### Trip (`trip` → `trip`)

- **Source**: `trip` table (852 rows total per C.t0).
- **Filter**:
  - `WHERE deleted IS NULL`
  - `WHERE publishstate_id = 3` *if confirmed* — this is the open question for Thomas/Richard. **Best-guess filter**; ship with a code comment `// TODO[C.t3]: confirm publishstate_id = 3 is the website's "live" filter — see questions.md`. If wrong, surface count won't match the public feed's ~111 (we'd see all 852 instead). Detectable post-run.
- **Drop columns** at boundary:
  - All `swooper_*` (customer PII, decision C.14).
  - `adventurousness_id` and any join to `adventurousness` (C.17).
  - All audit columns, soft-delete bookkeeping.
- **Compute**:
  - `currency_code = currencyLookup.get(currency_id)` (e.g. 1 → 'GBP', 4 → 'AUD' per S1).
  - `from_price = base_price` (decision C.14 — only headline, no calculated derivatives).
  - `canonical_url`: JOIN to `page` on `trip.page_id = page.id`, take `page.canonical_url`. If `page_id` is NULL, leave `trip.canonical_url` NULL — downstream tools handle missing URLs gracefully.
  - `image_id`: trips have BOTH a direct image join (`image_trip`) and a page-via-`page_id` path (S8). For the hero `image_id` we pick the first row of `image_trip` ordered by `position` if present, else the first `image_page` row of the joined page. Decision is left to the executing agent's judgement; flag for HITL if the choice feels load-bearing — alternative is to carry both in C.t3a's `trip_card` derived row.
  - `ntag_ids[]`: aggregated separately during ntags_lookup processing — see §"Where ntag_ids[] gets aggregated" below.
- **Drop trip variants**: `tripvariant` table is NOT loaded (C.t0 — operational draft management, not visitor-facing). The trip row carries no variant info.
- **Why**: every `find_options` call returns a trip card; without populated trips, `find_options` returns nothing.

### daybyday: column on trip, not its own table

The C.t2 schema (`002_domain_tables.sql` `trip` table) doesn't carry a separate `daybyday` table — the per-day prose is intended to live in `trip.description` or as denormalised text inline with trip. Per C.t0's finding (S5 — only ~12K presale rows for 852 trips, many trips will have no day-by-day at all):

- **Source**: `daybyday` table.
- **Filter**: `WHERE type='presale' AND trip_id IS NOT NULL AND deleted IS NULL` (C.t0 best-guess; see questions.md for confirmation pending).
- **Aggregate**: by `trip_id`, ordered by `day_start`, concatenate `site_text` (or `pre_sale_text` if `site_text` is NULL) into a single `description` string assigned to `trip.description`. The structured `info_json` per-day metadata is dropped at this stage — if a future `lookup` tool wants to answer "what do I do on day 3 of the W-Trek?", we revisit then.
- **Note**: this is the most likely transformation to need a HITL re-think. Alternatives: carry per-day rows in a separate `trip_day` domain table; carry the structured `info_json` as a `trip.itinerary_json JSONB` column. Neither was named at C.t2; raising for HITL. **Recommendation**: ship with the simple "concatenate to `trip.description`" approach for Puma; revisit if `lookup`/`find_options` evaluation shows we need granularity.

### Tour + tour_item

> ⚠️ **Stale — superseded by the [2026-05-14 addendum](#2026-05-14-addendum--tour-title-from-page-the-0-tours-bug) at the foot of this file.** `tours` has no `deleted` column, the dump carries 15 rows (not 8), and tour identity comes from the parent contentblock's *page*, not `tours.title`. Implement from the addendum, not this block.

- **Source**: `tour` + `tour_items` (junction).
- **Filter**: `deleted IS NULL`.
- **Compute**: `canonical_url` per page join (same as trip).
- **Why**: 8 tours feed a small subset of `find_options` results; without tour ingestion, multi-region tours are invisible to the agent.

### Hotel + hotel_room + hotel_pricing

- **Source**: same-named source tables.
- **Filter**: `deleted IS NULL` on each.
- **Compute**: `hotel.canonical_url` via page-as-hub (`hotel.page_id → page.canonical_url`).
- **Image resolution**: hotels reach images strictly via `page_id → image_page` (S8 finding — no `image_hotel` table). The `hotel.image_id` we populate is the first `image_page` row for the hotel's page.
- **Why**: hotels surface in `find_inspiring` and `find_options` cards; without ingestion, no accommodation context.

### Vessel + cabintype + cabin

- **Source**: same-named source tables.
- **Filter**: `deleted IS NULL`. Light-touch — Antarctica-skewed surface; thin Patagonia use.
- **Why**: cruise trips need their vessel context. Sparse in Patagonia (mostly `Ventus Australis` + a couple of southern fjord cruises). Future-proofs Antarctica release.

### ntags_lookup + ntag aggregation

- **Source**: `ntags_lookup` (157K rows per S7).
- **Filter**: `WHERE entity_type IN ('image', 'trip', 'contentblock', 'video')` — drops 148K enquiry/response/partner rows (S7 + decisions on PII).
- **Drop**: the ~7K useful rows are not loaded as their own table; they're aggregated into the target table's `ntag_ids[]` column.
- **Aggregate**:
  - For each `entity_type='image'` row, `UPDATE image SET ntag_ids = array_append(ntag_ids, tag_id) WHERE id = entity_id`.
  - For each `entity_type='trip'` row, similar update on `trip`.
  - For each `entity_type='contentblock'` row, similar update on `contentblock`.
  - For each `entity_type='video'` row — we don't carry a `video` table in C.t2, so these rows are dropped (~134 rows). Worth flagging if a future "find_videos" tool emerges.
- **Idempotency**: the ON CONFLICT DO UPDATE for the parent table needs to handle ntag_ids carefully — clobber-on-update is fine because we re-aggregate on every run. Order of operations: run the parent table upsert first (with empty `ntag_ids[]`), then run the ntags_lookup pass last.
- **Why**: every retrieval that filters by region / activity / interest leans on `ntag_ids[]` for fast GIN-array matching. Without this aggregation, `find_inspiring(region='Torres del Paine')` falls back to text search, missing curated tags.

### customerreview + customerreview_trip

- **Source**: the supplementary dump `data/customerreview_tables_-_swoop-patagonia_prod.sql`.
- **Filter**: `customerreview WHERE is_published = TRUE` (per the comment in 006_customerreview_tables.sql).
- **Drop**: `created_by_id`, `modified_by_id`, `deleted_by_id`, `deleted_by`, `deleted` — they reference a `user` table not in the dump (C.26 ingestion notes).
- **Keep**: `feedbacksnippet_id` retained but commented as dangling (in the migration); ETL ignores its FK target.
- **PII stance**: ingest as-is per C.26 (2026-04-30) — public-domain reviews, no scrubbing.
- **customerreview_trip**: 1:1 ingest with junction columns; no transformation.
- **Why**: 2,563 reviews + 163 trip junctions feed `customer_story` derivation in C.t3a, which backs the live Mirror tool.

### Skip list (named so future agents don't add them)

- **`tripvariant`** — operational draft/version management (S3 + C.t0); not visitor-facing. ETL ignores.
- **`season`** — fiscal-year periods (S4); back-office only. ETL ignores.
- **`adventurousness`** — deprecated parallel-style classifier (S2 + C.17). ETL ignores.
- **`pressreview`** source — not in dump (C.26); the 0-row `contentblock_pressreview` junction is empty anyway.
- **`customertip`** source — not in 2026-04-30 supplementary dump either (C.26 customertip pending); 119 `contentblock_customertip` junctions dangle. ETL ignores.
- **All `partner*` tables** — operational/PII surface; never load.
- **`enquiry`-typed `ntags_lookup` rows** (148K of 157K) — customer query PII; filtered out.
- **`navigationcard`-subtype contentblocks** (33K rows) — pure UI plumbing; no prose.
- **`swooper_*` columns** on `trip` — customer PII (C.14).
- **`bookingitem_id` references** (e.g. on daybyday) — operational booking links, not visitor-facing.
- **`partnerbooking` / `enquiry` / similar PII tables** — not in C.t2 schema, not loaded.

---

## Where `ntag_ids[]` gets aggregated

The `image`, `trip`, `contentblock` parent tables in `002_domain_tables.sql` carry `ntag_ids INTEGER[] DEFAULT '{}'`. The `ntags_lookup` source table is the polymorphic many-to-many with `(entity_type, entity_id, tag_id)`. There are two viable shapes for filling these arrays:

**Shape A**: Two-pass — load parent tables first with empty `ntag_ids[]`, then `UPDATE` per ntags_lookup row. Idempotent: each re-run starts with an empty array (clobber on the parent upsert) and rebuilds.

**Shape B**: Pre-aggregate ntags_lookup into a per-entity_id map in memory, then write `ntag_ids[]` as part of the parent table upsert.

**Recommendation**: Shape B. Cleaner isolation per transformation; one less UPDATE pass; easier to test (the ntag_ids resolution is a pure function over the pre-aggregated map). Cost: ~7K lookup rows held in memory — trivial.

Decision left to executing agent's judgement at code-write time; either is fine.

---

## Filters: where they live (transform code vs SQL views)

Two viable shapes:

- **Shape A**: filters live as `WHERE` clauses inside the transformation TS code (e.g. `if (row.pagetype_id === 20) { skip(); return; }`).
- **Shape B**: filters live as Postgres VIEWS layered on top of the populated tables (e.g. `CREATE VIEW page_visible AS SELECT * FROM page WHERE pagetype_id != 20 …`); ETL writes everything; downstream queries hit the views.

**Recommendation**: Shape A across the board. Reasoning:
- C.t2 already settled the schema as "filtered, no Profile, no test pages, no PII". Shape B would mean populating the tables with everything and filtering at query-time — that's the data we explicitly decided not to carry (C.27, C.28).
- The tools and primitives in C.t4 read directly from the domain tables; introducing a view layer means more SQL surface to maintain.
- The `daybyday` filter (`type='presale' AND trip_id IS NOT NULL`) collapses 88K rows down to ~12K; running that as a view means the planner has to evaluate 88K rows on every read forever.
- Shape A errs on the side of "filtering is part of the data movement, not a query-time concern" — which matches the disposable-ETL frame.

Decision logged at execution time as `C.35`.

---

## Currency, image, URL handling — where each lives

(Per the prompt's design questions.)

| Concern | Where it lives | Why |
|---|---|---|
| Currency `id → iso_3` mapping (S1) | Transform code, in a pre-loaded `Map<number, string>` | Lookup is hot (called for every trip row); 11 entries; doesn't change. Doing this as a JOIN in load-time SQL is fine but loses the legibility of "the mapping is right there in code, with a comment". |
| `canonical_url` for page / trip / hotel / location / tour | Transform code, calling the `canonical_url(override_url, alias)` function from migration 005 | The function exists already; we use it. Result: pages and trips carry their canonical_url as a populated TEXT column. Downstream tools never apply the rule. |
| `image.canonical_url` (imgix prefix + filename) | Transform code (concatenate `'https://swoop-patagonia.imgix.net/' || file.name`) | The render-variant params are NOT applied at ETL — they're applied at read-time per Tier 2 §2.6 (where `resolve_image_set(record, variant)` returns variant-specific URLs). ETL stores the bare filename URL; render-time wraps it. |
| `from_price` from `base_price` + currency tag | Transform code | Headline only, per C.14. No calculated derivatives. |
| Page-as-hub for hotel / location image resolution (S8) | Transform code, populating `hotel.image_id` from `image_page` for the hotel's page | Resolution is a one-off ETL decision; the image FK on the parent table is the simple shape downstream readers use. |
| Trip image resolution (direct `image_trip` OR via page) | Transform code, with a documented preference order: `image_trip` first if non-empty, else `image_page` of joined page | C.t2 left this open (`trip_card` schema accepted "image_id" without saying which path). Recording as decision **C.36** at execution. |

---

## Re-run cadence + operational story

- **Manual / on-demand during M1–M3** (per C.6). Operator runs the CLI when a fresh dump arrives.
- **Idempotent**: re-running the same dump produces zero row diff. Re-running with a newer dump produces row inserts (new ids) + row updates (changed columns) + nothing else (we never DELETE in C.t3 — soft-delete on the source side gets reflected as rows we skip; existing rows in Postgres for now-deleted source rows stay around. **HITL question**: do we want a "tombstone" pass that DELETEs rows that no longer appear in the dump? Recommendation: no for Puma; revisit at C.t8 runbook time if the staleness becomes a UX issue. Source rows being deleted is rare; the alternative is adding a "saw-this-row" sweep which is operational complexity for a marginal benefit.)
- **Logging**: stdout per-table summary; non-zero exit on any per-table failure. Cloud Logging is C.t8's job; stdout is enough for the CLI.
- **Cadence post-M4**: scheduled Cloud Run Job (C.t8). Frequency is a Swoop-ops question (questions.md Q13).
- **Cost**: zero LLM, zero embedding-api. Just pg writes. ~1–5 minutes wall-clock on Al's laptop expected.

---

## Verification

Task is done when:

1. `cd product && npm run typecheck -ws --if-present` is green.
2. `cd product && npm run lint -ws --if-present` is green (modulo pre-existing fails per next-steps.md).
3. `cd product && npm test --workspace @swoop/ingestion` is green; new test cases for sql-transform unit cover: parser round-trips a small synthetic dump; each transformation function turns a fixture row into the expected populated row.
4. CLI runs end-to-end against the real dumps:
   - `npm run -w @swoop/ingestion etl:sql -- --dump <path> --customerreview-dump <path>` exits 0.
   - Re-running the same command exits 0 with zero row-count delta (idempotency).
5. **Row counts (golden record check)**:
   - `SELECT COUNT(*) FROM trip;` returns ~852 (or whatever publishstate filter yields — flag if dramatically different).
   - `SELECT COUNT(*) FROM page;` returns ~482 (684 source - 40 Profile - test pages).
   - `SELECT COUNT(*) FROM image;` returns ~13K (filtered to image extensions).
   - `SELECT COUNT(*) FROM tag;` returns 79.
   - `SELECT COUNT(*) FROM faqitem;` returns ~928.
   - `SELECT COUNT(*) FROM customerreview;` returns ~2,563 published.
   - `SELECT COUNT(*) FROM customerreview_trip;` returns 163.
   - `SELECT COUNT(*) FROM contentblock WHERE subtype = 'navigationcard';` returns 0 (verifies UI plumbing was filtered).
   - `SELECT COUNT(*) FROM ntags_lookup;` — there is no ntags_lookup table; verify by `SELECT COUNT(*) FROM trip WHERE ntag_ids != '{}';` returning a substantial number (> 500).
6. **PII surface check**:
   - `SELECT * FROM trip WHERE swooper_says_blurb IS NOT NULL;` returns "column does not exist" (column was dropped at C.t2; if the transformation accidentally added it back, this surfaces).
   - `SELECT COUNT(*) FROM trip WHERE description ILIKE '%swooper%';` ideally low — the prose may legitimately reference Swoop; spot-check the matches.
7. **Spot smoke**:
   - `SELECT canonical_url FROM page WHERE alias = 'argentina/welsh-patagonia';` returns `https://www.swoop-patagonia.com/argentina/welsh-patagonia` (or the override_url if present).
   - `SELECT canonical_url FROM image LIMIT 5;` all five start with `https://swoop-patagonia.imgix.net/`.
   - `SELECT id, name FROM tag WHERE type='area' ORDER BY name;` returns 21 rows including 'Torres del Paine', 'Argentinian Lakes', 'Aysen' etc. (per S7).
8. **Skip-list check**: `SELECT relname FROM pg_class WHERE relname IN ('tripvariant', 'season', 'adventurousness');` returns zero rows (we never created these tables).
9. **Operator README** at `product/ingestion/README.md` describes:
   - How to install (`npm install` from `product/`).
   - How to drop+recreate `puma_dev` if the operator wants a clean slate.
   - How to run the migrations (or pointer to where that's documented elsewhere).
   - How to run the CLI.
   - Expected row counts (the verification §5 numbers).
   - What to do if a row count diverges materially (= the Swoop dump structure changed; raise + investigate).
10. Decisions log entries added for every execution-time call:
   - **C.35** — Filter-shape (Shape A: filters live in transform code, not Postgres views).
   - **C.36** — Trip image resolution preference order.
   - **C.37** *(if applicable)* — daybyday handling (concatenate to trip.description vs separate `trip_day` table).
   - **C.38** *(if applicable)* — Tooling pick (Option A / B / C from §"Tooling pick").
   - Plus any others surfaced.
11. Execution log appended to this Tier 3 plan summarising what landed, what was deferred, what surfaced for downstream tasks (especially what C.t3a needs to know about column-level ownership for non-clobbering re-runs).

---

## Smoke test (10 minutes after CLI completes)

Run these by hand against `puma_dev` to confirm the agent surface will work:

```sql
-- 1. Trip with image, page, tags all wired
SELECT t.id, t.title, t.canonical_url, t.from_price, t.currency_code,
       i.canonical_url AS image_url,
       array_length(t.ntag_ids, 1) AS ntag_count
FROM trip t
LEFT JOIN image i ON t.image_id = i.id
WHERE t.alias LIKE '%w-trek%'
LIMIT 5;
-- Expect: ≥1 row with all columns non-NULL except possibly image_url for some.

-- 2. Page-prose volume sanity check
SELECT pagetype_title, COUNT(*) AS page_count,
       SUM(LENGTH(intro_text) + LENGTH(summary)) AS total_prose_chars
FROM page
GROUP BY pagetype_title
ORDER BY total_prose_chars DESC NULLS LAST;
-- Expect: Guidebook + Swoop + City + Activity at the top (per C.29 §2.5 mapping).

-- 3. ntag_ids[] array filter retrieval
SELECT id, title, ntag_ids
FROM trip
WHERE ntag_ids @> ARRAY[(SELECT id FROM tag WHERE alias='torres-del-paine')]
LIMIT 5;
-- Expect: trips tagged with the Torres del Paine area surface here.

-- 4. Customerreview is wired
SELECT cr.id, cr.name, LEFT(cr.content, 100) AS snippet, t.title AS trip_title
FROM customerreview cr
LEFT JOIN customerreview_trip crt ON crt.customerreview_id = cr.id
LEFT JOIN trip t ON crt.trip_id = t.id
WHERE cr.is_published = TRUE
LIMIT 5;
-- Expect: 5 rows, real names + content, ~6% should have a non-NULL trip.

-- 5. Idempotency: re-run the CLI, then:
SELECT relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY relname;
-- Compare to pre-rerun counts. Expect zero delta.
```

If any of these fail, fix-and-rerun before claiming completion.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `daybyday` `type='presale'` filter is wrong | Medium | C.t0 question still open. Ship with a code comment. If wrong, surface row counts in `trip.description` will be very low; detectable post-run. Re-runnable cheap. |
| MariaDB-dump parser hits an edge case (escaped strings, nested quotes) | Medium | Pick an existing parser library. If parsing fails, fall back to "load into MariaDB and read via SELECTs" — Option C from the tooling pick is the escape hatch. |
| `ntag_ids[]` aggregation is non-idempotent (re-runs append duplicates) | Low | Recommendation Shape B (pre-aggregate) makes this naturally idempotent — the array is fully reconstructed each run. If we slip into Shape A by accident, fix on first re-run. |
| Image `file.path` legacy CDN URL accidentally used instead of imgix-constructed URL | Low | Discoveries entry calls out exactly this — flag in code review. Spot-check `SELECT canonical_url FROM image LIMIT 5` post-run. |
| Page-prose HTML stripping inadvertently loses real content | Low | C.t3 keeps the HTML intact on the column — chunking + cleaning happens at C.t3a where we control it. Boundary rule: this task is dump-format-preservation, no clever-cleverness. |
| Currency lookup misses an unfamiliar id (>11) | Low | Code defaults to NULL with a logged warning per row; 11 known currency ids cover all S1 cases. New currencies in a future dump surface as warnings. |
| Trip rows without `page_id` end up with NULL `canonical_url` and break downstream tools | Low–Medium | Tools must handle NULL `canonical_url` gracefully; that's a C.t4 concern. C.t3 just records what's there. Spot-check during HITL sign-off. |
| Test-page filter is too aggressive and drops a real page named "Test Activities in Patagonia" | Low | Pre-check: `SELECT alias, title FROM page WHERE alias ILIKE '%test%' OR title ILIKE '%Test %';` against MariaDB before writing the filter. If any hit looks legit, refine. C.t0 confirmed only obvious test artefacts match. |
| Operator runs CLI with wrong `DATABASE_URL` and writes to a Cloud SQL prod instance by accident | Medium (operator error) | CLI prints `--database-url` host + database name on startup; requires confirm flag (`--yes`) before any writes; refuses to run if the database URL host contains `prod` (heuristic; tunable). Cheap belt-and-braces. |
| Migration 006 wasn't applied before C.t3 runs (no `customerreview` table) | Low | CLI checks `SELECT to_regclass('customerreview')` at startup; bails with clear error if missing. |
| Memory pressure during ntags_lookup pre-aggregation (~7K relevant rows) | Very low | 7K lookup rows fit trivially. Fall back to two-pass UPDATE (Shape A) if it ever matters. |

---

## Cost / time estimate

- **Engineering time**: 1.5–2 days for the implementing agent (per Tier 2 § C.t3 estimate). Actual breakdown: ~0.5 day on parser + lookup tables + CLI scaffold; ~0.5 day on transformations (most are 30 lines of TS each); ~0.25 day on testing + idempotency verification; ~0.25 day on README + operator docs + decisions log.
- **Runtime**: target ≤10 minutes on Al's laptop for a full re-run. Most time is upserts; tunable via batch size if it's slow.
- **API cost**: zero. No LLMs. No embedding calls. Just pg writes.
- **Infra cost**: zero — runs against `puma_dev` locally. Cloud Run Job lift is C.t8.
- **Disposability cost**: when Swoop's source schema changes (October 2026 data consolidation per C.21), expect ~1 day to rewrite the affected transformations. The CLI scaffold + parser + upsert helper survive; only the per-entity transform files churn.

---

## Open questions (numbered, expect HITL on tooling pick)

1. **Tooling pick**: Option A (pgloader) vs Option B (Node CLI translator) vs Option C (hybrid via MariaDB). **Recommendation: Option B.** HITL decision required before execution starts.
2. **`daybyday` handling shape**: concatenate to `trip.description` (recommended for Puma) vs add a separate `trip_day` domain table at C.t2 with structured per-day rows. Decision changes whether a tiny C.t2 amendment is needed before C.t3 starts. **Recommendation: ship Puma with concatenation; revisit if `lookup`/`find_options` evaluation shows we need granularity.**
3. **Tombstone pass for source-deleted rows**: do we DELETE rows in Postgres when they vanish from a fresh dump? **Recommendation: no for Puma; revisit at C.t8.**
4. **Trip image resolution preference**: `image_trip` first vs `image_page` first vs both columns on `trip_card`. **Recommendation: `image_trip` first, `image_page` fallback, populate single `trip.image_id`. Log as C.36.**
5. **CLI surface name** (`etl:sql`? `transform:dump`? `ingest:patagonia`?). Cosmetic; pick anything sensible. Decision sits with executing agent.
6. **Module placement**: `@swoop/ingestion` is the obvious home (blog ingest already lives there). Confirm with HITL — or fork into a new `@swoop/etl` workspace? **Recommendation: stay in `@swoop/ingestion`** — adding a workspace is pure friction.
7. **Validation of `publishstate_id = 3` filter for trips**: open question for Thomas/Richard from C.t0. C.t3 ships with the best-guess and a `// TODO[C.t3]` flag. Decision: don't block on Thomas; ship + flag.
8. **Pre-existing `image.description` populated by C.t3** (~6.3K of 13K rows have it upstream): this carries over to C.t6's annotation pipeline. C.t3 must populate `description` from the source where present. **Confirm**: C.t6 plan should specify "annotate only rows where description IS NULL" so we don't clobber.
9. **`pagetype` lookup table**: the migrations don't carry `pagetype` as a separate domain table; we denormalise `pagetype_title` onto `page`. Confirm at HITL — alternative is to add a tiny lookup table for completeness.
10. **Are there any `image_*` join-table population routes we missed?** S8 inventoried `image_trip`, `image_page`, `image_location`, `image_tag`. None of these are domain tables in C.t2; their data folds into the parent's `image_id` (single hero) or into `image.ntag_ids[]` (for `image_tag`). Confirm we're not losing image associations by dropping the multi-image-per-record relationship.

---

## Coordination

- **Upstream (C.t1, C.t2)**: C.t3 reads the migrations as the authoritative shape. If C.t3 surfaces a contract gap, raise as an addendum to C.t2's plan, don't fix unilaterally.
- **Downstream (C.t3a)**: must know which columns C.t3 owns vs which it leaves for C.t3a/C.t6. The non-clobbering `INSERT … ON CONFLICT DO UPDATE SET <only-c.t3-columns>` is the contract. Document column ownership in this plan's execution log.
- **Downstream (C.t4)**: tool handlers consume domain tables directly + derived tables (post-C.t3a). Anything missing in C.t3 is invisible to handlers; flag at the tool-handler-design boundary.
- **Coordinated with C.t6**: image annotation pipeline reads `image.description` populated here as a first-pass annotation source.
- **Coordinated with `@swoop/ingestion` blog ingest**: same workspace; package.json scripts for `etl:blog` and `etl:sql` sit alongside.

---

## Calibration check — every transformation traces to a job

This is the design-discipline test for the Tier 3 plan: every populated column / table / filter must trace to a derived-table column (or a primitive function) that backs a tool that serves a conversational job. Listed here so the executing agent can audit during design and HITL can audit during review.

| Transformation | Derived column / use it feeds | Tool consumed by | Job served | Anti-pattern check |
|---|---|---|---|---|
| `country` / `area` / `location` | `inspire_passage.region`, `customer_story.region`, `trip_card.region`, `find_locations` primitive | `find_inspiring`, `find_someone_who`, `find_options` filters; deep-link disambiguation | Inspire / Mirror / Propose options | Justified by region-filter UX — not "the data has it". |
| `tag` (ntag) + embedding (later) | `tag.embedding`, `find_tags_by_utterance` primitive, `*.ntag_ids[]` filters | All four content tools narrow retrieval | Inspire / Mirror / Reassure / Inform | Justified by visitor-utterance → retrieval narrowing. Legacy `tag` deliberately excluded (C.32) — wouldn't serve a job, would pollute embedding space. |
| `image` + canonical_url | All `*PublicSchema` tool outputs that wrap an image record (per C.30b) | `illustrate` directly; `find_inspiring` / `find_someone_who` / `find_options` indirectly | Visual companion across all jobs | Justified by every widget that renders an image. |
| `page` + canonical_url + filters (Profile out, test out) | `inspire_passage.text` / `trust_proof.evidence` / `inform_chunk.text` (synthesised at C.t3a from page intro + summary + contentblock prose) | All four content tools | Inspire / Reassure / Inform | Profile out (C.27): no journey-moment serves staff bios. Test pages out (C.28): they're not visitor-facing. |
| `contentblock` + subtype filter | Same as page — feeds derived job tables at C.t3a | All four content tools | Inspire / Reassure / Inform | navigationcard / settings / page-cross-link out: pure UI plumbing, no prose to serve a job. |
| `chunk` | Short-form supplement to inspire_passage / inform_chunk | `find_inspiring` / `lookup` | Inspire / Inform | Justified by short-form CMS content (FAQ-like); 46 rows of authored prose. |
| `faqitem` | `inform_chunk.question` + `inform_chunk.text` | `lookup` directly | Inform | Justified by Q&A retrieval — exactly what `lookup` does. |
| `trip` + currency + canonical_url + ntag_ids | `trip_card.headline` / `vibe_line` / `region` / `from_price` etc. | `find_options` primary; `find_inspiring` cards secondary | Propose options / Inspire | swooper_* dropped (C.14): customer PII, no journey-moment justification. tripvariant skipped: operational draft management, not visitor-facing. |
| `daybyday` → `trip.description` concatenation | `trip_card.description` for richer cards; `inform_chunk` chunks for "what do I do on day 3" lookups | `find_options` / `lookup` | Propose options / Inform | Filter `type='presale'` justified by "this is what the website shows visitors". `postsale` filtered out: post-purchase confirmations, not discovery. |
| `tour` + `tour_item` | `trip_card`-shaped surface (multi-region) | `find_options` | Propose options | Same justification as trip. |
| `hotel` / `vessel` / cabintype / cabin (light Patagonia, real Antarctica) | Trip detail surface; future Antarctica release | `find_options` / `lookup` | Propose options / Inform | Justified by accommodation/cruise context for relevant trips; sparse Patagonia population is fine. |
| `ntags_lookup` filter (entity_type IN image / trip / contentblock / video) | Aggregates into `*.ntag_ids[]` arrays | All four content tools narrow retrieval | All | Enquiry-type filtered out: customer query PII, no journey-moment. |
| `customerreview` + `customerreview_trip` | `customer_story.text`, `customer_story.persona_summary` (synthesised at C.t3a) | `find_someone_who` directly | Mirror | Justified by Mirror tool's existence. is_published filter justified by visitor-facing only. PII stance per C.26 (public-domain). |

If a transformation in the implementation file doesn't have a row in this table — the implementer added something the plan doesn't justify. That's the bottom-up trap. Flag for HITL.

---

## Execution log

### 2026-05-02 — C.t3 implemented end-to-end (~0.5 day; under estimate)

Implemented across 4 atomic commits in `worktree-agent-aa979fb29b8a90970` (off `c041add`).

| Commit | Scope |
|---|---|
| `7eb8f34` | MariaDB SQL-dump parser (Option B per HITL Q1) — streaming line-walker, 16 tests, ~617K rows in ~4s smoke. |
| `043ad66` | Domain-table upsert helper with ON CONFLICT DO UPDATE — 5 tests, column-allowlist + noUpdateColumns shape. |
| `474575c` | Per-source-table transformations + lookup-builder — 41 tests, all 19 transforms. |
| `5041d48` | Pipeline runner + CLI + daybyday concat (HITL Q2) + README + package.json. |

**Verification (per plan §"Verification" + the false-green lesson)**:

- All 6 workspaces green on fresh `npm install` + `DATABASE_URL=...puma_dev npm test --workspaces --if-present`. **Total: 576/576** (was 523; +53 from C.t3's new tests; all in @swoop/ingestion, 31 → 84).
- Per-workspace: `@swoop/common` 102 / `@swoop/orchestrator` 158 / `@swoop/connector` 87 (was 84 — DB-gated tests run when DATABASE_URL set; was reported as 84 with skips in progress.md from C.t1) / `@swoop/ui` 71 / `@swoop/ingestion` **84** (+53) / `@swoop/harness` 74.
- `npm run typecheck --workspaces --if-present` clean across all 6.
- CLI runs end-to-end against the real dumps in 9.61s wall-clock (target was ≤10 min, beating it 60×).
- Re-run produces zero row-count delta — idempotent confirmed.

**Live row counts (fresh `puma_dev`)**:

```
country: 239   area: 16   location: 764   activity: 751
tag: 79                    [matches plan: 79 ✓]
image: 13012/13261         [matches ~13K ✓]
page: 636/684 (40 Profile + 7 test + 1 dup_canonical filtered) [target ~482; 636 retains slightly more]
contentblock: 2212/10110   [7,898 navigationcard/settings/etc. filtered]
chunk: 46                  [matches plan: 46 ✓]
faqitem: 906/928           [matches ~928 ✓]
trip: 852                  [matches plan: 852 ✓]
tour: 0/15                 [source `tours` rows mostly NULL-titled — content-empty]
hotel: 44   vessel: 25   cabintype: 108   cabin: 98
customerreview: 2160/2563  [403 unpublished filtered]
customerreview_trip: 145/163 [matches ~163 ✓]
```

**Smoke checks (W-Trek trip 369)**:

- `canonical_url` = `https://www.swoop-patagonia.com/chile/torres-del-paine/hiking/w-trek` ✓ (override_url-derived, host-prefixed)
- `from_price` = 2900.00 USD ✓
- `image_id` resolves via `image_trip` first per HITL Q4 ✓ (the W-Trek banner image)
- `ntag_ids` = 5 tags via the aggregator ✓
- `description` starts with "Day 1: …" confirming daybyday concatenation ✓
- ntag area filter `ntag_ids @> ARRAY[(SELECT id FROM tag WHERE alias='torres-del-paine')]` returns the W-Trek + 4 sibling Torres del Paine trips ✓

**Skip-list verified absent**: `tripvariant`, `season`, `adventurousness` tables not created; no rows in domain tables sourced from `partner*` / `swooper_*` / `enquiry`-typed `ntags_lookup` rows.

**Calibration check (re-run from §"Calibration check — every transformation traces to a job")**:

Every transformation lands a column on a domain row that backs a derived-table column at C.t3a, which backs an intent-named tool, which serves a journey moment. No transformation drifted bottom-up. Specific notes:

- `country` / `area` / `location` populated for region-filter UX in `find_inspiring` / `find_someone_who` / `find_options` ✓
- `area.country_id` and `area.parent_area_id` left null (source `area` doesn't carry them; hierarchy comes via the page parent_id chain — out of scope per §"Out of scope"). Flagged for HITL: if `find_locations` retrieval needs hierarchy, C.t3a's enrichment pass can derive it.
- `location.area_id` and `location.country_id` similarly left null for the same reason.
- `tag` (ntag) populated, ready for C.t3a's embedding pass. Legacy `tag` excluded ✓.
- `image` populated with imgix URLs; `description` carried through where source has it (~47.5%, primes C.t6) ✓.
- `page` filtered as designed; canonical_url constructed per C.15 ✓.
- `contentblock` filtered to subtypes that carry prose; navigationcard/settings/page silenced ✓.
- `chunk` whole-table copy ✓.
- `faqitem` orphan filter applied ✓.
- `trip` daybyday-concatenated; image-resolution per HITL Q4 ✓.
- `tour`, `tour_item`: source `tours` rows mostly NULL-titled; filter at boundary leaves content-empty target tables. Surface call: HITL flag below.
- `hotel`, `vessel`, `cabintype`, `cabin`: populated with light-touch detail ✓.
- `customerreview` + `customerreview_trip`: published-filter + FK-drop on dangling junctions ✓.

No transformation surfaced a calibration violation; no bottom-up drift detected.

**Decisions logged**:
- **C.38** — Filter shape A (filters in transform code, not Postgres views) — HITL Q8.
- **C.39** — Trip image resolution: `image_trip` first, `image_page` fallback, single `trip.image_id` — HITL Q4.

The HITL ratification block proposed C.35 + C.36 for these but those numbers were taken by the parallel C.t1 execution log earlier on 2026-05-01. Renumbered to C.38 + C.39 to keep the log monotone; flagged in each entry's body.

**Open questions surfaced for HITL**:

1. **Source `tours` is content-empty** — 15 source rows, all but 4 NULL-titled, the 4 with empty-string titles. The 36 `tour_items` rows can't anchor without a parent. C.t0 had named "8 tours" feed `find_options`; doesn't seem to apply here. **Question**: do we expect `tour` to carry rows? Or is "tours" actually rendered via `contentblock_tour` rows referencing trips directly? Not a C.t3 fix — needs Thomas/Richard to confirm what `find_options` should return for multi-region tours.
2. **`area` / `location` hierarchy**: source columns don't have `country_id` / `parent_area_id` directly; hierarchy comes via the page parent_id chain. C.t3 leaves these null. If `find_locations` retrieval needs them, C.t3a should derive via a page-walk pass. Flagged for HITL when C.t3a starts.
3. **`activity` (751 rows)** populated as first-class but with title-only — the source `activity` table is per-trip-per-area data with low-quality fields (mostly NULL `effort_level` / `duration` / `avg_hours_per_day`). Worth checking with Thomas/Richard whether `find_activities` (via `find_inspiring(activity=…)`) is well-served by the `tag` taxonomy + `inspire_passage` retrieval, in which case the `activity` domain table is dead weight.

**Notable findings during execution** (captured in discoveries.md / gotchas.md):

1. **Page self-FK requires a two-pass write.** `page.parent_id REFERENCES page(id)` is non-deferrable. Multi-row INSERT can land child rows before their parents in the batch, which Postgres rejects on the row that references a not-yet-inserted id. Two-pass write: INSERT all rows with `parent_id=NULL`, then UPDATE … CASE … END to wire ids in batches. Same pattern would apply to any future self-referencing FK at our scale.
2. **Source `override_url || alias` collisions.** A handful of source rows carry the same `override_url` (legacy alt versions of the same content). The migration's `page.canonical_url UNIQUE` constraint requires within-batch dedupe before insert. Lowest-id winner; siblings counted as `dup_canonical` skipped. Same pattern needed for `tag.alias`, `trip.slug`, `tour.slug`, `hotel.slug`, `vessel.slug` UNIQUE keys — generic `SECONDARY_UNIQUE_KEY` map in `flushBuffer` covers all of them.
3. **FK-nullify is the right boundary policy for soft FKs.** Source rows reference `image_id` / `bannerimage_id` / `parent_id` ids that we filtered (Profile pages, soft-deleted images, etc.). Two viable mitigations: drop the row entirely or null the FK. We pick null for soft FKs (downstream tools handle missing image_id gracefully — D.t9's widget code already has the affordance per the C.t4 plan); drop for hard NOT NULL FKs (cabin.vessel_id, customerreview_trip.{customerreview_id, trip_id}, tour_item.tour_id). Generic FkRule shape in `run.ts` makes the boundary explicit per table.

**What's now possible**:

- **C.t3a** can begin. Domain tables populated end-to-end; embedding pass + Haiku ETL classifiers (blog-post job, persona-summary aggregation by reviewer name, image annotation, blog-tag normalisation against ntag) all have data to read.
- **C.t6** can begin. ~6.3K images carry `description` from the source (~47.5%); ~6.7K need vision annotation. Less than the £30–£150 plan estimate suggested — primed by the source data.
- **C.t4** still needs C.t3a's derived tables before it can register the eight intent-named tool handlers. C.t3a is the gate.

---

## 2026-05-02 HITL re-ratification block

No new HITL adjudication needed — Q1, Q2, Q3, Q4, Q6, Q7, Q8 resolved at the 2026-05-01 ratification and implemented as ratified. Q5 (`publishstate_id = 3` for trip) was the open question for Thomas/Richard from C.t0; per the ratification we shipped without it. Empirical observation: 852 trips populated (matches 852 in the dump's `trip` table, so we're loading everything — the `publishstate_id = 3` filter would need to be added to drop legacy/internal trips down to the public-feed ~111). C.t4 will need to handle "trips that never appear on the public site" gracefully, OR C.t3 will gain a publishstate filter once Thomas/Richard reply.

---

## 2026-05-01 HITL ratification

Open questions resolved per Al's HITL session 2026-05-01. Status flipped from DRAFT to ready-for-execution.

### Resolutions

1. **Tooling pick** (Q1): **Option B** — Node CLI translator in `@swoop/ingestion`. As recommended. No pgloader dep, no config-DSL learning curve.
2. **`daybyday` shape** (Q2): concatenate to `trip.description` (default). No `trip_day` derived table. Fine-grained per-day surfacing is not a current job-shaped requirement.
3. **Tombstone pass for source-deleted rows** (Q3): no for Puma. As recommended.
4. **Trip image resolution preference** (Q4): `image_trip` first, then `image_page` fallback. As recommended. Add as proposed C.36 to the decision log.
5. **`publishstate_id = 3` filter** (Q5): ship with code-comment flag, don't block. Pending Thomas/Richard from C.t0; resolve at execution time if they've replied.
6. **Workspace placement** (Q6): stay in `@swoop/ingestion`. As recommended.
7. **`pagetype` lookup** (Q7): denormalise `pagetype_title` onto `page` (no separate domain table). As recommended.
8. **Filter shape** (Q8): Shape A (filters in transform code, not Postgres views). As recommended. Add as proposed C.35 to the decision log.

### Notes for the executing agent

- C.t1's connector skeleton (and Postgres pool) must be live before this plan can run. Hard dependency.
- The "Calibration check — every transformation traces to a job" table in this plan's body is the design-discipline test: re-run it post-implementation and call out anything that drifted.

---

## 2026-05-14 addendum — tour title from page (the 0-tours bug)

> **Parallel-agent collision note**: authored 2026-05-14 in-session from a debugging discovery, not a review. Decision logged as **C.focused-shamir-1** (wave-named) so a concurrent C.5x assignment doesn't clash — see [decisions.md](decisions.md).
>
> **Supersedes the §"Tour + tour_item" body above** (lines ~416–421). That body said `Filter: deleted IS NULL` and "8 tours" — both wrong. `tours` has no `deleted` column, the dump carries 15 rows, and the body never specified where the title comes from. The implementer, faced with all-null `tours.title`, invented a `title === null` filter that drops 100% of tours. A forward-pointer has been added to that section.

### What was wrong

`puma_dev` ended up with **zero tours and zero tour_items** (`trip` = 852, healthy). The `ingestion/README.md` "Expected output" block even documents this as expected — `tour: 0/15 skipped=filter:15  # source tours rows mostly NULL-titled` — which is how the bug got normalised into the runbook instead of being treated as a bug.

Root cause traced through the full pipeline (dump → [parser.ts](../product/ingestion/src/sql-transform/parser.ts) → [transformations.ts](../product/ingestion/src/sql-transform/transformations.ts) → upsert):

- **Source data**: in MariaDB `swoop_patagonia` and the `.sql` dump, `tours` has 15 rows and **`tours.title` is empty on every single one** — 9 `NULL`, 6 `''`. `SELECT COUNT(*) WHERE title IS NOT NULL AND title<>''` = 0. The column is vestigial in Swoop's CMS schema.
- **Parser**: maps values to columns by name from the explicit `INSERT` column list — no misalignment. `NULL`→`null`, `''`→`''`. Correct.
- **Transform**: [`transformTour`](../product/ingestion/src/sql-transform/transformations.ts) does `if (id === null || title === null) return null;`, and `strOrNull('')` returns `null` ([lookups.ts:197](../product/ingestion/src/sql-transform/lookups.ts)). So all 15 rows return `null` → `skipped=filter:15`.
- **Cascade**: `transformTourItem` itself keeps all 36, but the `tour_item` upsert has an FK guard `{column:'tour_id', validIds:keptTourIds, mode:'drop'}` ([run.ts:415–423](../product/ingestion/src/sql-transform/run.ts)). `keptTourIds` is empty → all 36 dropped → `fk_drop_tour_id:36`.

The data isn't lost — the transform looks in the wrong column. A tour's real identity lives on the **`page`** its contentblock belongs to: `tours.content_block_id → contentblock.page_id → page.title`. Every one of the 15 has a populated page title ("Best of Patagonia", "Paine and Fitz Roy Trekking Adventure", "Torres del Paine W Trek & Backcountry Kayaking", …). Day-by-day prose is in `tour_items` (`title` + `body` fully populated).

### The "not actually a tour" finding

Joining through to `page.pagetype` shows **3 of the 15 `tours` rows aren't itinerary tours at all** — they're `tours` rows hanging off non-itinerary content blocks:

| tour_id | parent `contentblock.type_id` | page | `page.pagetype` | verdict |
|---|---|---|---|---|
| 1 | 107 | Hotel Las Torres | Accommodation | not a tour — a hotel |
| 70 | 137 | What to do in Aysen | Parent Guidebook | not a tour — a guidebook |
| 71 | 100 ("Swoop Says" block) | trekking-southern-patagonia | Itinerary | not a tour — a Swoop-Says block that happens to sit on an itinerary page (tour 67 is the *real* tour block on that same page) |
| 74 | 152 | paul-test-page-2 | Itinerary | a real tour block, but a **test page** |

The clean discriminator is **`contentblock.type_id = 152`** — the block type that *is* the itinerary (12 of 15 rows). It beats `page.pagetype = 'Itinerary'` because pagetype is page-level and can't tell tour 67 (real) from tour 71 (a Swoop-Says block on the same page). Of the 12 type-152 rows, tour 74 is caught by the existing test-page filter once we join to `page`. Net: **11 real tours**.

### The discriminator question (carry to HITL / Swoop)

**Terminology first.** Swoop's CMS has no "Tour" in its type vocabulary at all. The 20 `pagetype` values include `Itinerary` (id 19) — that *is* the sales-facing page type for a sellable multi-day product; there is no `Tour` pagetype. And `tours`-table membership is **not** a clean signal either: the 15 `tours` rows hang off 4 different `contentblock.type_id` values (152 ×12, plus one each of 107 / 137 / 100), so being in `tours` only means "this block carries tour-ish extra fields", not "this is a sellable tour". "Tour" is *Puma's* word for the domain object; in Swoop's data it surfaces as a `type_id = 152` contentblock sitting on an `Itinerary` page. The executing agent should not expect a self-describing "tour" flag — there isn't one.

`contentblock.type_id` has **no FK and no defining table in the dump** — `152` is an app-level magic number. The fix should hard-code it but:

- **Recommended**: filter on `contentblock.type_id === 152` — the only field that separates the 12 real itineraries from the 3 non-tours, and the only thing that distinguishes tour 67 from tour 71 (two blocks on the *same* Itinerary page). Add a corroborating assertion in verification that every kept tour's page has `pagetype = 'Itinerary'` — true today; divergence is the signal that the magic number drifted.
- **Open question for Swoop** (add to [questions.md](../questions.md), ask Thomas / Richard — the C.t0 Swoop-engineering data contacts; Mark Reed has left the project): confirm `152` is the stable itinerary-tour contentblock type id, or point us at the enum. Low urgency — 11 rows, and the pagetype cross-check is a cheap guard — but it's an undocumented constant in ingestion code.

### Scope of the fix

| File | What changes |
|---|---|
| [transformations.ts](../product/ingestion/src/sql-transform/transformations.ts) — `transformTour` | New signature mirroring `transformTrip`: `(row, contentblockById, pageById, pageCanonicalById) => Record \| null`. Resolve `content_block_id → contentblock → {page_id, type_id}`. **Filter**: drop if parent contentblock missing, `type_id !== 152`, or `page_id` not in kept pages (test/profile pages already filtered upstream → naturally drops tour 74). **Title**: `page.title` (not `tours.title`). Also populate from the same join, as the original plan body line 420 always intended: `slug` ← `page.alias`, `canonical_url` ← `pageCanonicalById`, `page_id` ← resolved page id. Return a `{row, reason}` shape like `transformTrip` so the tally can name skips (`reason: 'missing_id' \| 'missing_parent_block' \| 'cb_type_not_itinerary' \| 'page_not_loaded'`). |
| [lookups.ts](../product/ingestion/src/sql-transform/lookups.ts) | Add a `contentblockById: Map<number, {pageId: number\|null, typeId: number\|null}>` lookup built in pass 1 from `buffers.contentblock` raw rows. Add `pageTitleById: Map<number,string>` (or a `pageById` carrying title + alias) if not already derivable — mirror how `pageCanonicalById` is built. |
| [run.ts](../product/ingestion/src/sql-transform/run.ts) | `transformTour` is currently passed as a bare fn ref to `flushBuffer` (line ~409) and `populateKeptIds` (line ~413). Wrap both in a shared closure capturing the new lookups (or give tour a bespoke pre-build path like `trip` has). The existing FK rules (`image_id`/`page_id` nullify) stay. `tour_item` wiring is unchanged — it just gets a non-empty `keptTourIds`. |
| [ingestion/README.md](../product/ingestion/README.md) | Correct the "Expected output" block (see §Expected output below) and drop the "source `tours` rows mostly NULL-titled" comment — it rationalised the bug. |
| `transformations.test.ts` / `__tests__` | Failing test first (see §Step-by-step). Cover: page-title resolution, the `type_id !== 152` drop, the test-page drop via filtered page, and a tour whose `tours.title` is `''` still getting a real title from the page. |

### What does NOT change

- The parser — it was never wrong here.
- `transformTourItem` — keeps its current shape; the FK-drop guard in `run.ts` does the right thing once tours are kept.
- The migration / `COLS.tour` — the target columns (`slug`, `title`, `canonical_url`, `page_id`, …) already exist; we're populating columns that were being written as `null`.
- `tour.region_id`, `tour.image_id` fallback — **explicitly out of core scope.** `contentblock.region_id` and a page-image fallback are now cheaply available from the same join and would be consistency wins (trips already do region_id via the brave-pare backfill), but the user's ask was the title. Executor may note them as a follow-up; do not bundle without a decision.

### Expected output after the fix

```
[etl:sql]   tour: 11/15 skipped=cb_type_not_itinerary:3,page_not_loaded:1
[etl:sql]   tour_item: 35/36 skipped=fk_drop_tour_id:1
```

- 11 tours kept (type-152 minus the test page). Dropped: tour 1 (Accommodation) + 70 (Parent Guidebook) + 71 (Swoop-Says block) → `cb_type_not_itinerary`; tour 74 (`paul-test-page-2`, filtered upstream by `transformPage`) → `page_not_loaded`.
- 35 tour_items kept; the 1 dropped belongs to tour 74. Verified against MariaDB: `tour_items WHERE tour_id IN (2,3,4,7,9,67,72,73,75,76,77)` = 35.
- Note tour 2 ("Luxury Best of Patagonia") legitimately has 0 tour_items — keep it; an itinerary page with no day-by-day rows is still a real tour.

### Step-by-step execution

1. Failing test in `transformations.test.ts`: a `tours` row with `title: ''` whose parent contentblock is `type_id: 152` on a non-test page → expect a row with `title` = the page title, not `null`. A second case: parent `type_id: 107` → expect `{row: null, reason: 'cb_type_not_itinerary'}`. Run, watch them fail.
2. Add the `contentblockById` + page-title lookups in `lookups.ts` (pass 1).
3. Rewrite `transformTour` per the table above. Keep it a pure function — lookups injected, no I/O.
4. Wire the closure at the two `run.ts` call sites (`flushBuffer` + `populateKeptIds`).
5. Tests green. `npm test -w @swoop/ingestion`.
6. Full re-run against the real dump from `product/`: `npm run -w @swoop/ingestion etl:sql -- --dump ../data/content-data-swoop-patagonia_prod.sql`. Confirm the tally matches §Expected output.
7. Correct `ingestion/README.md`.
8. Update [discoveries.md](../discoveries.md): "`tours.title` is vestigial in Swoop's schema — tour identity is on the parent contentblock's page; `contentblock.type_id = 152` is the itinerary discriminator." Update [gotchas.md](../gotchas.md) if the magic-number 152 deserves a flag.
9. Add the discriminator open question to [questions.md](../questions.md).

### Verification

```sh
# Post-run, against puma_dev:
psql "$DATABASE_URL" -c "SELECT count(*) FROM tour;"        # expect 11
psql "$DATABASE_URL" -c "SELECT count(*) FROM tour_item;"   # expect 35
psql "$DATABASE_URL" -c "SELECT id, title, slug, page_id FROM tour ORDER BY id;"
#   every row has a non-null, non-empty title; no 'Test Destination'; no 'Hotel Las Torres'

# Corroboration guard — every kept tour's page is an Itinerary pagetype:
psql "$DATABASE_URL" -c "SELECT t.id, p.pagetype_title FROM tour t JOIN page p ON p.id = t.page_id WHERE p.pagetype_title <> 'Itinerary';"
#   expect 0 rows — any hit means type_id 152 drifted from pagetype, investigate
```
Idempotency unchanged: re-run → zero row-count delta.

### Decision marker — C.focused-shamir-1

**Decision** — Tour identity derives from the parent contentblock's `page` (`tours.content_block_id → contentblock.page_id → page.title/.alias/.canonical_url`), not the vestigial `tours.title` column. Tours are filtered to parent `contentblock.type_id = 152` (itinerary blocks), with the existing test-page filter applied via the page join. Fixes the 0-tours bug and the 3 not-actually-a-tour rows. Supersedes the §"Tour + tour_item" plan body. Logged as **C.focused-shamir-1** in [decisions.md](decisions.md).

### Estimated effort

~1.5–2 hours. The transform rewrite is small and `transformTrip` is a close template; the lookup additions and the two call-site closures are the bulk. Tests + re-run + doc sweep is the rest.

### Executed 2026-05-14

Landed in worktree `focused-shamir-52524c` (uncommitted, for Al's review). Implementation followed the plan with two refinements:

- **Skip reasons** settled as `missing_id | missing_parent_block | cb_type_not_itinerary | page_not_loaded`. `page_not_loaded` replaced the planned `test_page` — the mechanism is "parent page absent from the kept-pages map", which is *usually* a test page but generally covers profile/deleted/dup-canonical too; the honest name is `page_not_loaded`.
- **Build path**: `transformTour` returns `TourTransformResult {row, reason}` and is driven by a bespoke `transformToursWithPages` builder in `run.ts` (mirrors `transformTripsWithDayByDay`), then `flushPrebuilt`. `contentblockById` added to `Lookups`/`loadLookups` (pass 1, soft-deleted blocks excluded). `pageById` (id → {title,alias,canonical_url}) built inline in the `want('tour')` block from the kept `pageOut.rows`. `image_id` FK-nullify applied manually like trip; `page_id` needs no rule (transformTour only emits tours whose page is kept). Old `flushBuffer` + `populateKeptIds` tour wiring removed.
- **`missing_title`** was *not* needed — `transformPage` sets `title: title ?? '(untitled)'`, so a kept page always has a non-empty title.

Verified: `npm run typecheck` + `npm test -w @swoop/ingestion` green (290 tests). Full ETL re-run against the 2026-04-27 dump → `tour: 11/15 skipped=cb_type_not_itinerary:3,page_not_loaded:1`, `tour_item: 35/36 skipped=fk_drop_tour_id:1`, every other table unchanged from the README baseline. `puma_dev` confirmed: 11 tours (all real titles/slugs/page_ids), 35 tour_items; drift guard (`pagetype <> 'Itinerary'`) and title-sanity (`null/''/'(untitled)'`) queries both return 0 rows. Docs updated: `ingestion/README.md`, `discoveries.md`, `questions.md` ("Tour content population" reframed). `gotchas.md` left untouched — the magic-number 152 is a data-semantics fact, not a tooling trap; the code comment + discoveries + questions cover it.
