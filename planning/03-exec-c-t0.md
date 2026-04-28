# 03 — Execution: C.t0 SQL-dump load + clarifying SELECTs

**Status**: Tier 3 execution plan. Draft, 2026-04-29. Executed in the same session that authored it (see §"Execution log" at the end).
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §10 — the **C.t0** task ("SQL-dump load + clarifying SELECTs"). Closes residual schema questions left open by the 2026-04-27 first-pass dump inspection so C.t1+ can proceed without semantic ambiguity.
**Depends on**: 2026-04-27 SQL dump received (`/Users/al/Studio/projects/swoop_web/data/content-data-swoop-patagonia_prod.sql`, ~210 MB). Julie call rulings captured in [inbox.md](../inbox.md) 2026-04-27 entry. First-pass inspection findings in [questions.md](../questions.md) "Data pipeline" section.
**Blocks**: C.t1 (connector skeleton — needs the resolved schema picture before deciding which tables map into the derived store), C.t2 (entity model + tool surface schemas — depends on knowing what `tripvariant`, `season`, `daybyday` mean), C.t3 (`export.sql` — same).
**Produces**:
- Updates to [`data-ontology.md`](../data-ontology.md) — `S-SQLDUMP-2026-04-27` source tag at the top, rewritten sections per Julie-call rulings, new "URL & image construction rules" section, deprecation flags on `tag` + `adventurousness`.
- Updates to [`questions.md`](../questions.md) — close Q6/Q7/Q8/Q9/Q10/Q11/Q12/Q16 (already substantially closed but not all moved to "Closed" yet); promote semantic-walkthrough sub-items resolvable by SELECT.
- Updates to [`discoveries.md`](../discoveries.md) — graduate any non-obvious findings (URL/imgix patterns, page-as-hub, dead/live tag systems, `daybyday` revision logic, etc.).
- Execution log appended to this file (§"Execution log") summarising what was found, what was deferred to C.t1+.
**Estimate**: ~2–4 h focused work. Most of the cost is reading SELECT output, not running it.

---

## Purpose

The 2026-04-27 first-pass inspection enumerated the 129 tables and answered most schema questions, but a tail of semantic questions stayed open because they need actual SELECTs against loaded data, not just `DESCRIBE`/`information_schema`. Julie's call closed several of those by product ruling (no departures, no calculated pricing, `ntag` is live, `adventurousness` deprecated). The remaining tail — currency-id mapping, `tripvariant` semantics, `season` semantics, `daybyday` revision logic, `contentblock_*` triage, `ntag`/`ntags_lookup` shape, page-as-hub verification — is what this task closes.

C.t0 is **inspection only**. No code change to product; no ETL written; no schema designed. Just SELECTs against a local MariaDB load of the dump, write down what we find, update the canonical reference docs.

The output makes C.t1+ tractable: by C.t1 we know which tables are in scope, by C.t2 we know each entity's actual columns and FK shape, by C.t3 we know which subtypes of `contentblock_*` to keep. Without C.t0, those tasks would each have to re-load the dump and re-discover the same answers.

---

## Out of scope

Name it so future agents don't drift:

- **No `export.sql` authoring** — that's C.t3.
- **No Postgres derived-store schema** — C.t2.
- **No connector code, no tool-handler code** — C.t4.
- **No embedding pass, no chunking strategy** — C.t3a.
- **No image annotation** — C.t6.
- **No blog ingest** — `03-exec-blog-ingest.md`.
- **No re-decision on `ntag` vs `tag`** — Julie-call ruled `tag` dead, `ntag` live (decision C.17 pending in `decisions.md`). C.t0 just confirms `ntag`'s shape so C.t3 knows how to ETL it.
- **No PII boundary policy negotiation** — that's a Swoop-input question (Q14) and stays open.
- **No semantic walkthrough confirmation with Swoop engineering** — `tripvariant` / `season` / `daybyday` get our best inspection-driven guess; if the guess turns out wrong during C.t3 we revisit. We don't block on Thomas/Richard for this.

---

## Tooling

**Local MariaDB (already running, dump pre-loaded).** Al has a Homebrew MariaDB install on `localhost:3306` with the dump already loaded into the `swoop_patagonia` database. Connect via socket auth as user `al`:

```bash
# Verify
mariadb -u al -e "SHOW DATABASES;"   # should list swoop_patagonia

# Query
mariadb -u al swoop_patagonia -e "SELECT ..."
```

Read-only inspection only — the database is not dropped or modified. Leave it loaded for ongoing inspection during C.t1+.

**Why local over Docker**: avoids dump-load latency (the dump was already in place from prior work) and the existing Homebrew install is already serving the right data. (An earlier Docker-based plan was sketched but reverted by user instruction during execution — see Execution log below.)

---

## Clarifying SELECTs to run

Each SELECT below has a target answer it's seeking. After running them, the canonical-doc updates land per §"Doc updates" — without a separate analysis pass.

### S1 — Currency-id mapping (closes Q6)

```sql
SELECT id, code, name, symbol, sign FROM currency ORDER BY id;
```

**Target**: confirm 1/2/4 → ISO codes (likely GBP/USD/EUR per data-ontology guess). Update `data-ontology.md` §Pricing semantics. The full 11 rows (per `questions.md` Q6) are noise we don't need; the three actually-used ids matter.

### S2 — `adventurousness` deprecation confirmation (closes Q7)

```sql
SELECT * FROM adventurousness ORDER BY id;
SELECT MIN(difficulty), MAX(difficulty), MIN(wilderness), MAX(wilderness) FROM trip;
```

**Target**: Julie ruled `adventurousness` deprecated and difficulty/wilderness are raw integers without legend. Confirming the table's contents either match that ruling (e.g. archaic levels nobody references) or surface a contradiction we'd want to flag back to Julie. Trip range tells us what the integers actually span.

### S3 — `tripvariant` semantics (closes a ⏳ open sub-question)

```sql
DESCRIBE tripvariant;
SELECT * FROM tripvariant LIMIT 30;
SELECT trip_id, COUNT(*) AS variant_count FROM tripvariant GROUP BY trip_id ORDER BY variant_count DESC LIMIT 20;
SELECT COUNT(DISTINCT trip_id) FROM tripvariant;
```

**Target**: are these (a) per-trip variants we need to surface to the agent (e.g. "long version" / "short version" of the W-Trek), (b) operational versioning (revision history of trip records), or (c) something else? The 584-row count vs ~111 trips suggests ~5 variants per trip. If they're surfaceable, they go into the C.t2 entity model; if operational, they get whitelisted out by `export.sql`.

### S4 — `season` semantics (closes a ⏳ open sub-question)

```sql
DESCRIBE season;
SELECT * FROM season ORDER BY id;
```

**Target**: 12 rows in a `season` table is suspicious — could be 12 months, 4 named seasons × 3 regions, or arbitrary marketing periods. Determines whether `season` participates in retrieval (e.g. "best time to visit Torres del Paine") or is back-office only.

### S5 — `daybyday` revision logic (closes a ⏳ open sub-question)

```sql
DESCRIBE daybyday;
SELECT trip_id, COUNT(*) AS row_count FROM daybyday GROUP BY trip_id ORDER BY row_count DESC LIMIT 10;
SELECT trip_id, day, COUNT(*) AS rev_count FROM daybyday GROUP BY trip_id, day ORDER BY rev_count DESC LIMIT 20;
-- If a published / version / revised_at column appears:
SELECT * FROM daybyday WHERE trip_id = <pick-one-with-many-revs> ORDER BY day, <version-col> LIMIT 50;
```

**Target**: 88K rows ÷ ~111 trips = ~800 rows per trip. That's *way* more than days × variants. There must be a revision/draft mechanism. Identify the canonical-published-version filter expression so `export.sql` can apply it correctly. This is the single most load-bearing semantic question in the dump.

### S6 — `contentblock_*` triage (closes a ⏳ open sub-question)

```sql
SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.tables
WHERE table_schema = 'swoop_patagonia'
  AND TABLE_NAME LIKE 'contentblock%'
ORDER BY TABLE_ROWS DESC;

-- For each subtype with non-trivial row count, sample shape:
SELECT * FROM contentblock_customerreview LIMIT 5;
SELECT * FROM contentblock_customertip LIMIT 5;
SELECT * FROM contentblock_<other> LIMIT 5;  -- per result of prior query
```

**Target**: which `contentblock_*` subtypes carry useful prose for the agent? `customerreview` (2,390) and `customertip` (119) are confirmed candidates. Find the others worth ingesting (anything with prose-shaped narrative content) and the others to skip (back-office text).

### S7 — `ntag` + `ntags_lookup` shape (semi-closes Julie's "ntag operational meaning" sub-question)

```sql
DESCRIBE ntag;
SELECT * FROM ntag ORDER BY id LIMIT 50;
SELECT * FROM ntag ORDER BY id DESC LIMIT 50;

DESCRIBE ntags_lookup;
SELECT * FROM ntags_lookup LIMIT 30;
SELECT lookup_table, COUNT(*) AS link_count FROM ntags_lookup GROUP BY lookup_table ORDER BY link_count DESC;
-- If columns look like (ntag_id, target_table, target_id):
SELECT ntag_id, COUNT(DISTINCT target_id) AS distinct_targets
FROM ntags_lookup GROUP BY ntag_id ORDER BY distinct_targets DESC LIMIT 20;
```

**Target**: the 79 ntags + 157,537 lookups form a polymorphic many-to-many. Surface (a) what the 79 ntags actually are (semantic categories? interest tags? voice descriptors?), (b) which target tables the lookups link into. We don't fully resolve "what is `ntag`" here — Julie said her side wasn't sure either; Thomas/Richard during C.t3 design — but we get enough shape to design an ETL that doesn't accidentally drop relevant joins.

### S8 — Page-as-hub verification (closes C.16 territory)

```sql
-- Confirm hotel → page → image traversal:
SELECT h.id, h.name, h.page_id, p.alias, p.override_url
FROM hotel h LEFT JOIN page p ON p.id = h.page_id
LIMIT 10;

-- Are images attached to hotel rows directly, or only via page?
DESCRIBE image_hotel;  -- if exists
SELECT COUNT(*) FROM image_hotel;  -- if exists
SELECT COUNT(*) FROM image_page;
SELECT COUNT(*) FROM image_trip;

-- Trip → page traversal:
SELECT t.id, t.title, t.page_id, p.alias
FROM trip t LEFT JOIN page p ON p.id = t.page_id
WHERE t.page_id IS NOT NULL LIMIT 10;
```

**Target**: confirm the page-as-hub pattern Julie described — that records like `hotel`, `location`, `trip` reach images via their `page_id` rather than carrying their own image joins. If `image_hotel` exists with content, the rule is more nuanced and `data-ontology.md` needs to capture both paths.

### S9 — URL construction confirmation

```sql
-- override_url presence rate
SELECT
  COUNT(*) AS total,
  SUM(override_url IS NOT NULL AND override_url <> '') AS has_override,
  SUM(alias IS NOT NULL AND alias <> '') AS has_alias
FROM trip;

SELECT
  COUNT(*) AS total,
  SUM(override_url IS NOT NULL AND override_url <> '') AS has_override,
  SUM(alias IS NOT NULL AND alias <> '') AS has_alias
FROM page;

-- Sample shape
SELECT id, override_url, alias FROM trip WHERE override_url IS NOT NULL LIMIT 5;
SELECT id, override_url, alias FROM page WHERE override_url IS NOT NULL LIMIT 5;
```

**Target**: verify Julie's `override_url || alias` rule. If a meaningful chunk of records have neither, `data-ontology.md` and the C.15 decision need to capture the fallback (probably "skip deep-linking for those records").

### S10 — Image filename + imgix verification

```sql
DESCRIBE image;
SELECT id, filename, alt_text FROM image LIMIT 5;
SELECT
  COUNT(*) AS total,
  SUM(filename IS NOT NULL AND filename <> '') AS has_filename,
  SUM(alt_text IS NOT NULL AND alt_text <> '') AS has_alt_text
FROM image;
```

**Target**: Julie confirmed the dump stores filenames only and URLs construct as `https://swoop-patagonia.imgix.net/<filename>?<params>`. Verify the column actually called `filename` exists and is populated. Also: `alt_text` populated rate matters for C.t6 (image annotation) — if alt-text is universally present and non-trivial, the annotation pipeline can use it as a first-pass annotation source rather than calling Claude Vision on every image.

---

## Doc updates per finding

After each SELECT block, update the canonical docs in place. Don't accumulate findings in scratch and re-write at the end — that loses the per-question audit trail.

### `data-ontology.md` (substantial rewrite)

1. **Add `S-SQLDUMP-2026-04-27` source tag** to the "Sources inspected" table at the top.
2. **§3 Departure** — flip from "priority gap #1" to "explicitly out of scope by product decision (C.14, Julie call 2026-04-27)". Strike the "what we need" sub-table.
3. **§4 PricePoint** — flip from "Implied" to "out of scope by product decision (C.14)". Headline `base_price` only, no calculated ranges.
4. **§11 Swooper** — recast from "Field exists, data empty, ask Swoop" to "PII boundary — `swooper_*` fields are *customer* PII, off-limits; do not surface". Reference Julie call.
5. **§15 Tag taxonomy** — `tag` is dead (Julie call); replace the §15 enumeration with a "Live tagging system: `ntag`" section sourced from S7 results. Mark old `tag`/`area`/`activity`/`style`/`trip-type`/`interest` enumerations as derived-from-public-feed, deprecated upstream.
6. **§Pricing semantics** — collapse to a single line: "Use `trip.base_price` only. `raw_price`, `window_price`, `cabin_*` are website-runtime calculations and must not be surfaced".
7. **§Open questions for Swoop** — strike the answered ones (Q6, Q7, Q11, Q12, Q16); demote Q3 (departure storage) since departures are out of scope.
8. **§"Ask list" priority table** — strike or demote rows 1, 2, 7, 8, 9 (departures, pricing matrix, vessel/cabin upgrade detail, swooper records, per-trip reviews). Remaining rows still relevant.
9. **NEW section: URL & image construction rules.** Author this fresh, after the existing §15. Cover:
   - imgix prefix + render-variant params concept (small/medium/large variants)
   - `override_url || alias` precedence
   - page-as-hub traversal rule (verified per S8)
   - the "general principle: page = presentation hub for any record that points at one" framing.
10. **§controlled scales / difficulty / wilderness** — note `adventurousness` table is deprecated; difficulty (1–5) and wilderness (0–5) are raw integers without an in-DB legend.

### `questions.md`

Move the following from "Open" to the "Closed" section under a `### 2026-04-29 — Data pipeline tail closed by SELECT inspection (C.t0)` heading:

- Q6 (currency mapping) — close per S1.
- Q7 (difficulty/wilderness legend) — close per Julie call + S2 confirmation.
- Q8 (`base_price` vs `raw_price`) — close per Julie call (Q8 outcome: ignore `raw_price`).
- Q9 (`window_price`) — close per Julie call (ignore).
- Q10 (departure storage) — close fully. Was "partly answered"; the semantic walkthrough of `tripvariant`/`season`/`trip_operators_itineraries` is now folded into S3/S4 closures.
- Q11 (swooper) — close per Julie call (PII).
- Q12 (per-trip reviews) — close per dump inspection (only `contentblock_customerreview` remains as a useful surface).
- Q16 (authoritative vs denormalised) — close per Julie call ("dump is canonical, period").

Stays open (genuinely needs Swoop input):

- Q13 (one-off vs scheduled feed — operational call with Swoop ops).
- Q14 (PII redaction sign-off — needs Swoop legal/ops sign-off).
- The **Julie-call section's** ⚠️ "Operational meaning of `ntag`" stays open — S7 gives shape but not full semantic coverage. Route to Thomas/Richard during C.t3 design.
- Pre-purge conversation analysis policy (chunk F item).
- Analytics platform preference, Claude account tier, sales inbox + SMTP, Patagonia sales-thinking doc, legal counsel engagement, cross-page chat persistence — all unchanged.

### `discoveries.md`

Graduate the following as new entries dated 2026-04-29 (latest at top per file convention). Each gets a short body explaining what's non-obvious and where it shows up in code/planning later:

1. **URL construction rule: `override_url || alias`** — the deterministic rule for any deep-linkable record. Lives in `export.sql` + the `canonical_url` derived column. Wherever a downstream caller needs the URL, that derived column is the source of truth.
2. **Imgix render-variant pattern** — image filenames stored bare; URLs constructed as `https://swoop-patagonia.imgix.net/<filename>?<params>` where the params control sizing/format. Carry the variant concept (`thumb`/`hero`/`detail`) on the data primitive surface, not as raw URL strings.
3. **Page-as-hub traversal** — records with `page_id` reach their image set + canonical URL via the `page` row, not via direct image joins. Verified for `hotel`, `trip`, `location` per S8.
4. **`tag` is dead, `ntag` is live** — public-feed-era `tag` system (5 facets, 50+ values) is dead per Julie. Live system is `ntag` (79 entries) + `ntags_lookup` (157K rows, polymorphic m:m). Operational-meaning sub-question routed to Thomas/Richard.
5. **`adventurousness` table is deprecated** — difficulty (1–5) and wilderness (0–5) on `trip` are raw integers without an in-DB legend. Don't try to map them to user-facing labels at ETL time.
6. **`daybyday` revision logic** — *S5 outcome captured here verbatim once known.* This is the load-bearing one for C.t3 — the canonical-published-version filter must be in `export.sql`'s WHERE clauses.
7. **Pricing stance: headline `base_price` only** — `raw_price`/`window_price`/`cabin_*` are website-runtime calculations; ETL surfaces only `base_price` per C.14.
8. **PII boundary: `swooper_*` are customer fields** — not staff. Any field prefixed `swooper_` or any reference to `partner*` tables is customer PII and excluded from the derived store.

---

## Verification checklist

- [x] Local MariaDB reachable: `mariadb -u al -e "SHOW DATABASES;"` lists `swoop_patagonia`.
- [x] Dump loaded: `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='swoop_patagonia'` returns 129.
- [x] All ten S1–S10 SELECT blocks executed, output captured into the execution log section below.
- [x] `data-ontology.md` rewritten per the bullets in §"Doc updates"; new "URL & image construction rules" section authored (§20-LIVE).
- [x] `questions.md` — Q6/Q7/Q8/Q9/Q10/Q11/Q12/Q16 marked closed with `2026-04-29 (C.t0 SELECT)` markers; batch entry appended to "Closed" section.
- [x] `discoveries.md` — nine new entries added at the top.
- [x] Database left in place (read-only inspection only) per user instruction.
- [ ] Commit lands on the agent worktree branch. Conventional commit message.
- [ ] No `data/` folder accidentally committed (check `git status` after).

---

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Dump access blocked by socket-auth quirks | Resolved | `root` was rejected on socket auth; `al` user works. Captured in tooling section. |
| `daybyday` revision logic (S5) unparseable from data alone | Materialised | Resolved enough to ship: best-guess filter is `type='presale' AND trip_id IS NOT NULL AND deleted IS NULL`, with the active-tripvariant path noted as a near-empty alternative. Question raised for Thomas/Richard to confirm. |
| `ntag` semantic content (S7) too sparse to interpret | Low (resolved) | 79 rows enumerated; meaning of most is self-evident; ~5 interest tags need confirmation. Question raised. Doesn't block ETL design. |
| SELECTs surface a finding that contradicts a Julie-call ruling | Materialised | The `customerreview`/`customertip` source-table absence wasn't predicted by Julie's ruling — flagged as a new question for Thomas/Richard rather than re-opening the decision. |
| Database left in unintended state | Low | Read-only inspection; no DDL or DML run; database left loaded per user instruction. |

---

## Execution log

Run on 2026-04-29.

### Environment (final)

- Local Homebrew MariaDB on `localhost:3306` (the user's existing install).
- Database `swoop_patagonia` was already loaded from prior work.
- Connect: socket auth as user `al`. (`root` requires a different auth path.)
- Initial Docker plan was scratched mid-execution per coordinator course-correction — local MariaDB was already running and pre-loaded; spinning a Docker container would have been redundant.
- Verification: 129 tables in `swoop_patagonia`. Row counts consistent with prior inspection (`trip` 852, `image` 13,261, `page` 684, `ntag` 79, `ntags_lookup` 157,537).

### S1 — Currency mapping (Q6 closed)

- 11 currencies in the `currency` table.
- Active mapping (via `currency.iso_3`): **1=GBP, 2=USD, 3=EUR, 4=AUD**, plus 5=CLP, 6=ZAR, 7=ARS, 8=NZD, 9=CAD, 10=NOK, 11=DKK.
- First-pass guess that `currency_id` 4 = EUR was wrong: 4 is AUD, EUR is id 3. The public feed didn't expose EUR-priced trips because they're rare.
- Doc updates: `data-ontology.md` Pricing-semantics section + new currency mapping; discovery entry added; Q6 closed in `questions.md`.

### S2 — `adventurousness` deprecation (Q7 closed)

- `adventurousness` table has 11 rows, all with `rating: 5` (the rating column is unused).
- Each row names a *trip style* (Adventurous / OBT / Camping / Huts/W Trek / Day Hikes / Luxury / Winter / Group / Budget / Yurt / Independent), NOT a difficulty/wilderness legend.
- `trip.difficulty` is 0–5 raw (range confirmed); `trip.wilderness` is 0–5 raw.
- Confirms Julie ruling (deprecated). Doc updates: `data-ontology.md` §18-LIVE + scale-fields update; discovery entry added; Q7 closed.

### S3 — `tripvariant` semantics

- 584 rows total; 279 trips have at least one variant.
- Shape: `state` enum {`draft`, `active`, `retired`}, `notes` text, `created_by_id` FK to `user`.
- Verdict: operational draft/version-management for trip records, NOT visitor-facing variants. Sample row had `Version 1 Nick Hill` as a `title` — clearly an internal author tag.
- Doc updates: `data-ontology.md` §16-LIVE; discovery entry; ETL action: skip the table.

### S4 — `season` semantics

- 12 rows, each a fiscal-year period 1 Sept → 31 Aug. IDs 3–16 (with id 12 = "Undecided").
- Most recent: `26/27 Season` (start 2026-09-01).
- Used for booking-year scoping and an `enable_webinars` flag (only one season has it set: `25/26`).
- Verdict: back-office annual periods, not marketing seasonality. Excluded from agent surface.
- Doc updates: `data-ontology.md` §17-LIVE.

### S5 — `daybyday` revision logic

**The most surprising finding of C.t0.**

- 88,367 rows total — but most are dead weight:
  - 50,685 rows have `trip_id IS NULL` (orphan drafts).
  - Of `presale` rows: 12,415 with `tripvariant_id=NULL`, 72 draft, 10 retired, **0 active**.
  - Of `postsale` rows: 73,551 NULL state, 125 active, 1,551 draft, 583 retired.
  - Only **13 trips** have an `active` `tripvariant`, with 125 active rows total.
- `type` column splits into `presale` (sales-page itinerary) vs `postsale` (booking-confirmation document).
- Sample row: full HTML prose in `site_text` and `pre_sale_text` (~5 paragraphs), structured per-day metadata in `info_json` (transfer time, hike length, difficulty, meals, accommodation).
- Canonical filter (best guess): `WHERE type='presale' AND trip_id IS NOT NULL AND deleted IS NULL` — joined directly on `trip.id`, NOT through `tripvariant`. Yields ~12,415 candidate rows for 852 trips. Many trips will have no day-by-day data.
- Doc updates: `data-ontology.md` §5 rewritten; discovery entry; question raised for Thomas/Richard (confirm website renders presale rows).

### S6 — `contentblock_*` triage

- Counts (top): `contentblock_navigationcard` 33,304 (site nav widgets, skip), `contentblock` (master) 10,239, `contentblock_settings` 3,016, `contentblock_image` 2,732, `contentblock_customerreview` 2,390, `contentblock_trip` 2,058, `contentblock_page` 1,627, `contentblock_carousel` 1,334, `contentblock_reviewcarousel` 646, `contentblock_carousel_item` 222, `contentblock_customertip` 119.
- Empty: `contentblock_tour`, `contentblock_reviewcarousel_review`, `contentblock_partnercomment`, `contentblock_pressreview`, `contentblock_when_to_travel`.
- **Critical finding**: `contentblock_customerreview` and `contentblock_customertip` are *junction tables* with FKs into `customerreview.id` and `customertip.id` respectively — and **the source tables `customerreview` and `customertip` are not in the dump**. The 2,390 + 119 junction rows are dangling. Either selective export or stale FKs.
- Doc updates: `data-ontology.md` §12 rewritten; discovery entry; question raised for Thomas/Richard.

### S7 — `ntag` + `ntags_lookup` shape

- `ntag`: 79 rows. Types: 27 `interest`, 21 `area`, 17 `activity`, 7 `trip-type`, 7 `style`. Sample tags include `argentinian-lakes`, `torres-del-paine`, `kayaking`, `trekking`, `w-trek`, `o-circuit`, `perito-moreno` etc.
- Date range of `ntag` rows: oldest 2018-11-29, newest 2025-10-13 (`Valparaíso`). Mostly stable; occasional additions.
- `ntags_lookup`: 157,537 rows with `(entity_type, entity_id, tag_id)`. `entity_type` distribution:
  - `enquiry` 147,959 (PII surface, exclude)
  - `image` 4,491
  - `trip` 2,973
  - `response` 1,103, `partner` 622 (operational, exclude)
  - `contentblock` 255, `video` 134
- Old `tag` table: 2,374 rows with `tag_trip` 251 rows. Confirmed dead per Julie + recency check (`ntags_lookup` has rows modified through 2026-04-27).
- Doc updates: `data-ontology.md` §15-LIVE rewritten; discovery entry.

### S8 — Page-as-hub verification

- `hotel.title` (not `name`); has `page_id`, `alias`, prose `why_we_like` / `what_we_dont_like` / `rooms_and_pricing_description`.
- Image join tables in dump: `image_location`, `image_month` (empty), `image_page`, `image_tag`, `image_trip`. **No `image_hotel` table**.
- Counts: `image_trip` 3,361 rows, `image_page` 453 rows.
- Page-as-hub confirmed for hotels (page_id traversal). Trips have BOTH paths (direct + page).
- Trips can share a `page_id` — sample: trips 1052 + 1053 both → page 3 (`argentina/welsh-patagonia`). So `page` is a region/topic hub, not strictly per-record.
- Doc updates: `data-ontology.md` §20-LIVE (page-as-hub section); discovery entry.

### S9 — URL construction

- `trip`: 852 total, 570 (66.9%) have `override_url`, 852 (100%) have `alias`.
- `page`: 684 total, 620 (90.6%) have `override_url`, 684 (100%) have `alias`.
- Sample trip override_urls: `chile/torres-del-paine/multi-sport/6-day-refugio`, `chile/torres-del-paine/hiking/w-trek/original`. SEO-friendly nested paths.
- Sample alias slugs: `multi-activity-sport-patagonia`, `w-trek-torres-del-paine`. Flat slugs.
- Rule `override_url || alias` works universally — no record needs a fallback beyond alias.
- Doc updates: `data-ontology.md` §20-LIVE; discovery entry.

### S10 — Image filename + imgix verification

**Two-table model — load-bearing finding.**

- `image` (13,261 rows) carries metadata only — no filename column.
- Filename lives on `file.name` via FK `image.image_id → file.id` (constraint `c_fk_image_image_id`).
- Sample `file` rows: `Funnykayak.jpg`, `Acon_height.JPG`, `swoop-luke.jpg`, `Screen_shot_2010-09-20_at_22.29.53.jpg`. Bare filenames as Julie described.
- `file.path` carries the *legacy* CDN domain (`http://images.swoop-patagonia.com`) or filesystem paths (`/files/image/image/`). NOT imgix. The imgix transformation is a website-runtime concern.
- `file` table has 135,807 rows total (most are PDFs, docx, NULL — only ~13.6K image extensions).
- `image` text-field population: `title` 99.7%, `description` 47.5%, `caption` 35.2%. Affects C.t6 cost.
- Doc updates: `data-ontology.md` §19-LIVE; discovery entry.

### Deferred to C.t1+ (questions raised, not blocking)

- **`customerreview`/`customertip` source tables missing** — Thomas/Richard. Tracked as new question in `questions.md`. Not blocking C.t1/C.t2/C.t3; agent's customer-story surface falls back to blog content.
- **`daybyday` canonical filter confirmation** — Thomas/Richard. The presale-only filter is a best guess; if wrong, only ~12K rows are at stake. C.t3 should ship with the best-guess filter and a comment-flag.
- **`ntag` interest-tag semantic confirmation** — for ~5 less-obvious tags (Futa, Queulat etc.). Doesn't block any C task but useful for `stoke_imagination` weighting.
- **Trip "publishstate_id = 3" assumption** — needs SELECT to confirm what publishstates exist and which the website surfaces. Will pick up at C.t3 design time.
- **Imgix render-variant params** — the `thumb` / `hero` / `detail` variant params are an educated guess. Confirm in C.t6 against the imgix account (someone at Swoop has the imgix admin login).

### Doc updates landed

- [x] `data-ontology.md` — substantial rewrite. Added headline product rulings section, S-SQLDUMP-2026-04-27 source tag, recast §3/§4/§11/§12/§15, added §15-LIVE/§16-LIVE/§17-LIVE/§18-LIVE/§19-LIVE/§20-LIVE, rewrote §5, updated §"Pricing semantics", §"Ask list", §"Open questions for Swoop".
- [x] `questions.md` — Q6/Q7/Q8/Q9/Q10/Q11/Q12/Q16 marked `✅ Answered (2026-04-29, C.t0 SELECT)`; new sub-section "New from C.t0 inspection" added under Data pipeline; 2026-04-29 batch entry appended to Closed section.
- [x] `discoveries.md` — 9 new entries dated 2026-04-29 added at top: missing customerreview tables; daybyday sparseness; image+file two-table model; ntag entity-type firehose; currency-mapping correction; adventurousness deprecation; URL construction rule; page-as-hub finding; trip count 852 not 111.

### Database state

- `swoop_patagonia` left loaded (read-only inspection only, per user instruction). Available for C.t1+ ongoing inspection.
