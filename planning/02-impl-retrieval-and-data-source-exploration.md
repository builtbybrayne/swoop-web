# 02 — Retrieval & Data: Source exploration (first pass)

**Status**: First-pass exploration note, 2026-04-24. **Not canonical.** Captured during a live call with Swoop engineering. Superseded by whatever the Monday SQL-dump ingestion reveals — treat this doc as a pre-read and orientation aid, not a source of truth.

**Parent chunk**: C. Retrieval & Data ([02-impl-retrieval-and-data.md](02-impl-retrieval-and-data.md)) — specifically §2.1 (data access strategy) and §2.2 (ingestion pipeline shape).

**Supersedes the hackathon branch**: Friday's "API vs scrape" question is overtaken. Swoop engineering has committed to a full SQL database export (Monday 2026-04-27). The ingestion utility now has a third, strongly preferred path: **ingest the SQL dump, model against it, then decide what steady-state extraction looks like.**

**Related artefacts**:
- [data-ontology.md](../data-ontology.md) — entity inventory and gap list from the first-pass web-surface inspection. Still useful as a comparison map when the SQL dump lands.
- [questions.md](../questions.md) — where new "needs Swoop input" questions should land.
- [discoveries.md](../discoveries.md) — where durable architectural findings graduate to once confirmed.

---

## Why this doc exists

We did a first-pass inspection of Swoop's public web surface (Trip Finder JSON feed + one detail page) to reason about what kind of entity graph sits behind it. Partway through, live conversation with Swoop devs confirmed or corrected several assumptions and changed the ingestion plan entirely — they'll ship a full SQL dump on Monday.

Rather than losing the inspection work or mistaking it for canonical, this doc parks it as a **reference** for whoever (agent or human) plans the SQL-dump ingestion next.

---

## 1. What we inspected (first-pass sources)

| Tag | Source | Caveats |
|---|---|---|
| **S-INDEX** | `GET /trips/get_trip_finder_data` — JSON feed behind the public Trip Finder | Index-shaped. Excludes per-trip detail. Derived, not authoritative. |
| **S-DETAIL-HTML** | `https://www.swoop-patagonia.com/chile/torres-del-paine/hiking/w-trek/original` via HTML fetch | Shell only. JS-rendered content missing. |
| **S-DETAIL-JS** | Same URL, browser screenshot | Full rendering — revealed itinerary, departures, pricing-by-date, includes/excludes. |

Full entity-by-entity walkthrough lives in [data-ontology.md](../data-ontology.md). This doc does **not** re-enumerate it.

---

## 2. Confirmations and corrections from the Swoop call (2026-04-24)

These supersede anything inconsistent in `data-ontology.md`:

- **Activities are tags only — confirmed.** No first-class `Activity` record to retrieve. If we want activity descriptions / difficulty / prices, we model them ourselves from prose or ask Swoop to author them. Same pattern likely for other "tag-only" taxonomies (`style`, `interest`).
- **Accommodation IS a first-class record.** Hotels (and plausibly refugios / estancias) have their own entries. Swoop will include these in Monday's export. This contradicts the ontology's current "Accommodation = tag + itinerary name only" framing — correct once the dump lands.
- **Locations ARE objects.** Not just the strings we see in the feed. Canonical record type in the SQL store. Expect a proper hierarchy + attributes.
- **"Pages" is a record type.** New to us. Likely Swoop's CMS page entity — probably what holds the marketing prose / detail-page blocks. Needs inspection on Monday.
- **Full SQL dump arrives Monday 2026-04-27.** Whole-DB export. Ingest locally, explore, map against our ontology, decide what the steady-state pipeline looks like.

What this means for the rest of [data-ontology.md](../data-ontology.md): the "Implied / Absent" labels on Accommodation and Location need flipping to "Observed via SQL" once the dump is parsed. Activities stay "tag only". Pages is a new entity row.

---

## 3. Findings worth keeping from the first pass

Even with a SQL dump coming, the web-surface inspection produced durable observations that inform how we interpret the dump:

1. **Tour = collection of Trips.** `trip_ids[]` on tour records is the only explicit graph edge in the feed. Expect a join table or parent/child FK in SQL.
2. **Tag taxonomy is five-way**: `area`, `activity`, `style`, `trip-type`, `interest`. Plus ordinal scales `difficulty` (1–5) and `wilderness` (0–5). Fully enumerated in `data-ontology.md`. Confirming this shape in SQL is a quick sanity check.
3. **Departures + itinerary + includes/excludes are on the detail page but not in the index feed.** Expect separate SQL tables (Departures, Itinerary-Day, Inclusion, Exclusion, Note).
4. **Fields declared but always null in the index feed** — `swooper_*`, `vessel_comfort`, `vc_id`, `signifiers`, `trip_finder_blurb`, `reviews` (nearly always null). Probably live in other tables; look for them in the dump.
5. **Pricing is layered and partly opaque.** `raw_price` vs. `base_price` diverge (W-Trek: 2,900 → 4,119). `currency_id` 1/2/4 mapping unconfirmed. `window_price` populated on ~18% of records. `cabin_price` only on cruise trips. SQL schema should reveal the true pricing model.
6. **Vessels are embedded-flat in the index.** Only 2/8 tours populate vessel fields, both the same ship. Expect a proper Vessel table in SQL, likely with Cabin and Deck-plan children.
7. **Images are served via imgix CDN** with composable URL params. No "asset record" in the index; unknown whether there's a proper media table in SQL.
8. **Detail pages are JS-rendered.** If we ever fall back to scraping (e.g. for URL enrichment or CMS prose), we need a JS-capable fetcher (Playwright/Puppeteer), not raw HTML.

---

## 4. Outstanding questions for the SQL-dump phase

Belongs in `questions.md` under a new "Data pipeline" heading. Copy-ready:

### Schema questions (answered by inspecting the dump)
1. **What tables exist?** — full list; then annotate which map to the Tier 2 chunk C ontology (Trip, Tour, Location, Accommodation, Vessel, Cabin, Departure, Itinerary-Day, Page, Tag, Image, Review, Swooper).
2. **What are the actual FKs between tables?** — especially Tour↔Trip, Trip↔Departure, Trip↔Itinerary-Day, Itinerary-Day↔Accommodation, Location hierarchy, Vessel↔Cabin.
3. **Is there a canonical Media/Image table?** — or are image URLs embedded on owner records?
4. **Is there a canonical FAQ / CMS-block table?** — the detail page's "Includes / Excludes / Additional Notes" panels live somewhere.
5. **How are tags stored?** — a single polymorphic `tags` table keyed by `type`, or per-type tables?

### Semantic questions (need Swoop input regardless of dump)
6. **Currency-id mapping**: 1 / 2 / 4 → ?
7. **`difficulty` 1–5 and `wilderness` 0–5** — user-facing definitions of each level?
8. **`base_price` vs `raw_price`** — why they diverge, what formula produces base?
9. **`window_price`** — promotional? seasonal? time-windowed?
10. **Departures model** — fixed-date group vs. demand-driven bespoke? How's "Flexible Dates" vs "Fixed Dates" represented?
11. **Swooper (specialist) assignment** — manual? rule-based per region? per trip?
12. **Reviews** — Trustpilot aggregate vs. Swoop-owned per-trip store. Is the detail page's "4.6 / 338" derivable from our dump or does it need an external pull?

### Operational questions
13. **Is the Monday dump a one-off, or can it become a feed?** — i.e. is `/weekly-dump` a realistic steady state, or do we switch to API / CDC later?
14. **Licensing / PII / what to redact** before we store or query it.
15. **Expected dump size and format** — raw SQL (`.sql`), CSV per table, parquet, pg_dump binary?
16. **Authoritative vs. denormalised** — is the dump the upstream source of truth, or is some of it itself derived from a CMS? (Matters for our "derived datasource" framing in chunk C §2.2.)

---

## 5. What happens next

**Immediate (for whoever picks up Monday):**

1. Land the dump in a local inspection workspace — **do not commit it** (PII / licensing). `.gitignore` an `ingest-exploration/` directory.
2. Enumerate tables. Diff against `data-ontology.md`'s entity list. Update the ontology doc with a new source tag `S-SQLDUMP-2026-04-27`.
3. For each entity, record: rows, key columns, FKs, non-null rates, enums. One paragraph per entity.
4. Identify the **smallest slice of tables** needed to support a minimum-useful Puma conversation (likely: Trip, Tour, Location, Accommodation, Departure, Itinerary-Day, Page, Tag, Image).
5. Decide which of those become records in the derived datasource (Vertex) vs. which get queried on demand (e.g. Departures — live pricing / availability may need a thinner, fresher path).
6. Feed the answer back into chunk C §2.1 (Path A / B / hybrid) — this doc likely renders most of that section obsolete. Update, don't append.

**Medium-term:**

- Once the schema is understood, promote confirmed findings from this doc into [discoveries.md](../discoveries.md), close questions in [questions.md](../questions.md), and retire `data-ontology.md` to `planning/archive/` or fold its surviving sections into the parent chunk C doc.
- Re-open the "steady-state extraction" question with Swoop: dump-as-feed vs. API vs. CDC. The SQL dump is a bootstrap, not an operating model.

---

## 6. What this doc is NOT

- Not a schema spec — we haven't seen the schema yet.
- Not a final source inventory — it captures a first-pass inspection before the authoritative source landed.
- Not a binding commitment to any ingestion path — the SQL dump will reshape §2.1 of the parent chunk.
- Not a replacement for [data-ontology.md](../data-ontology.md) — that's the entity-by-entity reference; this doc is the context wrapper around it.
