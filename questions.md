# Questions for Swoop

Open questions that need Swoop-side input before they can be closed. Periodically asked of the right person (Luke / Julie / Thomas / Richard / Martin / Lane / legal) depending on the topic.

**Entry format**: `## Topic — who to ask` then a short body stating the question, the context, and why it matters.

Mark `✅ Answered: ...` inline once resolved, then move to the closed section at the bottom during periodic triage.

---

## Open

### Julie call — 2026-04-27 (today)

Topics for Julie. Some are stance-confirmation (we have a working hypothesis, want her sign-off); some are unblockers; some refresh existing open items.

**Sales-funnel "golden thread" — stance confirmation**

We're proposing the bot's job is to move users Awareness → Interest → Strong Consideration. Stoking imagination + supporting consideration. Specialist call closes the loop. The bot does NOT try to build itineraries or simulate booking — that's sales-team territory and risks a "shadow itinerary" that misrepresents what's actually bookable. The bot CAN engage with specifics (including price ranges) when a user pushes, as long as it's not crossing into shadow-itinerary territory.

Confirm Julie agrees this is the right framing.

**Pricing exposure — where's the line?**

We want to talk pricing because users will ask. Default proposal:
- Headline "from £X per person" on every trip.
- Calculated band ("£2,200–£3,800 for this trip across season + tier") when relevant.
- Calculated regional/category bands ("Patagonia treks typically £1,500–£4,500").
- On a user push: tier-by-tier or season-by-season ranges if derivable from the data.
- Off-limits by default: specific dated departures with prices, single-supplement specifics, occupancy-specific quotes — those route to specialist.

Where's Swoop's line? In particular: are they comfortable with the bot quoting calculated ranges, or do they want a tighter "from £X — let's talk for the rest" stance?

**Departures stance — confirm we don't surface dates**

Patagonia is largely demand-driven; the SQL dump has no `departure` table. We're proposing the bot answers "departures run throughout the season — let's talk to a specialist about your preferred dates" rather than ever quoting bookable dates. Confirm.

**Specialist handoff persona — generic vs named**

The dump has no `swooper` / specialist table. We're proposing the bot hands off to a generic "Patagonia specialist" rather than assigning a named advisor pre-call. Confirm — and if there's a CRM-side mapping she wants us to surface eventually, capture how.

**Data refresh cadence**

Weekly manual ingest of a SQL dump while we iterate — OK with her? What's Swoop's preferred steady-state? (Scheduled dump, API, CDC, hybrid?) Affects chunk C §2.1 final shape.

**Derived data store posture**

We're proposing to ingest the dump into our own derived store (DuckDB-leaning — embedded, AI-side, optically distinct from her MariaDB) rather than ever querying Swoop's MariaDB directly. Confirm she's comfortable with that (separation, security, operational independence).

**`ntag` system purpose** — 79 entries plus 157K lookups. Is this the live tagging system superseding the legacy `tag` table (2,374 entries), or a different domain? Julie may know; if not, route to Thomas/Richard.

**Refresh of existing open items** — also worth raising while we have her:
- Patagonia sales-thinking doc status (Luke + Lane, target ~May 4) — see "Patagonia sales-thinking doc status" below.
- Sales inbox + SMTP — see below.
- Legal counsel engagement model — see below.
- Claude account Enterprise tier — see below.
- Analytics platform preference — see below.

---

### Data pipeline — Thomas / Richard / Martin (batch, pending Monday 2026-04-27 SQL dump)

On 2026-04-24 Swoop engineering agreed to ship a full SQL database export on Monday. That reshapes chunk C §2.1 — API-vs-scrape is superseded by "ingest the dump, map against our ontology, then decide steady state". The questions below came out of the first-pass web-surface inspection ([data-ontology.md](data-ontology.md), [planning/02-impl-retrieval-and-data-source-exploration.md](planning/02-impl-retrieval-and-data-source-exploration.md)) and should be worked through as the dump is explored.

Why it matters: the answers here define the shape of the derived datasource (chunk C §2.2), the retrieval tool set (chunk C §2.3), and whether the dump is a bootstrap or an operating model.

Where it lands: Tier 2 chunk C.

**Status after dump inspection (2026-04-27):** schema questions 1, 3, 4, 5 closed by inspection. Semantic 11 + 12 closed (no swooper, no review tables). Semantic 7 + 10 partly closed. Operational 15 closed. Remaining open items still need Swoop input. See Closed section for the batch entry; inline ✅ markers below.

**Schema questions — answerable by inspecting the dump:**

1. ✅ **Answered** (2026-04-27, dump inspection): 129 tables enumerated. Mapping written to [data-ontology.md](data-ontology.md). Trip / Tour (via `tours`+`tour_items`) / Location / Accommodation (`hotel`) / Vessel / Cabin / Itinerary-Day (`daybyday`) / Page / Tag / Image present and first-class. **Departure: no table.** **Swooper: no table.** **Review: no per-trip table** (curated review excerpts exist as `contentblock_customerreview`, 2,390 rows). Notable additions not anticipated: full hotel pricing matrix, partner ops layer (PII), CMS chunk family, parallel `ntag` system.
2. ✅ **Answered** (2026-04-27, dump inspection): FKs are extensive — 19 declared FK constraints on `trip` alone. Confirmed expected edges: Tour↔Trip via `tour_items`, Trip↔Itinerary via `daybyday.trip_id`, Vessel↔Cabin via `cabintype_vessel`, Location hierarchy via `country`/`area`/`location`/`location_map`. Trip↔Departure does not exist (no Departure table); see Q10 below.
3. ✅ **Answered** (2026-04-27, dump inspection): Canonical `image` table (13,261 rows) plus polymorphic join tables: `image_trip`, `image_page`, `image_location`, `image_tag`, `image_month` (empty). Imgix CDN URLs are stored on the `image` record itself.
4. ✅ **Answered** (2026-04-27, dump inspection): `page` (684) + `pagetype` (20) + `pagelayout` (3) + `page_banner` (688) + `contentblock` (10,110) + 14 `contentblock_*` sub-tables + `chunk` (46) family + `faqitem` (928). Includes / Excludes are columns on `trip` (`includes`, `excludes` text fields). Additional Notes likely live in linked `contentblock`s.
5. ✅ **Answered** (2026-04-27, dump inspection): Polymorphic — single master `tag` table (2,374 rows) plus per-target join tables (`tag_trip`, `tag_video`, `image_tag`, `page_tag`, `partner_tag`). NOTE: parallel `ntag` (79) + `ntags_lookup` (157,537) system also exists; purpose unclear, asked Julie.

**Semantic questions — need Swoop input regardless of dump:**

6. Currency-id mapping: 1 / 2 / 4 → ? (`currency` table has 11 rows — a quick `SELECT *` once the dump is loaded should resolve this without needing Swoop input. Promote to closed once confirmed.)
7. `difficulty` 1–5 and `wilderness` 0–5 — user-facing definitions of each level? **Likely answerable by inspection** — `adventurousness` table (11 rows) almost certainly carries the legend (5 difficulty + 6 wilderness levels ≈ 11). Promote to closed once confirmed via SELECT.
8. `base_price` vs `raw_price` — why they diverge (W-Trek: raw 2,900 → base 4,119), what formula produces base?
9. `window_price` — promotional? seasonal? time-windowed? Only populated on ~18% of records.
10. ✅ **Partly answered** (2026-04-27, dump inspection): No first-class `departure` table. Closest candidates: `tripvariant` (584), `season` (12), `trip_operators_itineraries` (885), `start_location` (11), `partnerbooking` (37,767 — but operational, not catalogue). Confirms the demand-driven hypothesis for Patagonia. Per Julie call (2026-04-27), we won't surface dated departures anyway. Still need Swoop's semantic walkthrough of which of `tripvariant` / `season` / `trip_operators_itineraries` carry which meaning.
11. ✅ **Answered** (2026-04-27, dump inspection + Julie call): No `swooper`/specialist table in this DB. Specialists live in another system (CRM, likely). Per Julie call, the bot will hand off to a generic "Patagonia specialist" — no named-advisor pre-call assignment needed.
12. ✅ **Answered** (2026-04-27, dump inspection): No per-trip review store in the dump — Trustpilot aggregate is external. Useful side-finding: `contentblock_customerreview` (2,390) and `contentblock_customertip` (119) are sales-curated excerpts/tips authored for marketing use. Perfect surface for our sales-funnel content layer.

**Operational questions:**

13. Is Monday's dump a one-off, or can it become a scheduled feed? I.e. is steady state `/weekly-dump`, or do we switch to API / CDC later?
14. ✅ **Partly answered** (2026-04-27, dump inspection): PII-heavy tables identified — `partnerbooking` (37,767 customer bookings), `partnerbookingfile` (20,767 attachments), `inspection` (210 partner inspections), `partnertask` (294), `partnercomment`, `partnerrelationship`. These must be excluded from the LLM-accessible derived store. Still need Swoop sign-off on what level of redaction they want before we even hold the data locally / on GCS.
15. ✅ **Answered** (2026-04-27, dump received): Raw `.sql` Sequel Ace export, MariaDB 5.5.64-flavoured. ~210 MB plain SQL plus a 38 MB zip alongside. Also confirms source DB version.
16. Authoritative vs. denormalised — is the dump the upstream source of truth, or is some of it itself derived from a CMS? (Matters for "derived datasource" framing in chunk C §2.2.)

### Analytics platform preference — Julie / Thomas

Where would Swoop want ad-hoc analysis of chat event logs to land? The default GCP path is BigQuery (simple sink from Cloud Logging, cheap, queryable), but they may already have a preferred BI / warehouse / analytics tool — Looker, Metabase, something else — that we should integrate with instead. Also: do they want the event schema to match conventions their analysts already use?

Why it matters: Puma ships with structured event logging. The schema we author now is what enables (or constrains) later analysis. Getting this wrong costs rework.

Where it lands: Tier 2 chunk F (observability & analytics).

### Media library location + access — Thomas / Richard / Martin (Friday hackathon scope)

Where do Swoop's product / region / activity images actually live, and what access path does Puma need? The 21 Apr meeting referenced "a media library somewhere" but didn't pin it. Options might be: Cloudinary, S3/GCS bucket, a CMS attachment store, direct-from-CDN URLs with no auth.

Why it matters: chunk C's `illustrate`-equivalent tool needs a resolution path. Image set is also bigger than the PoC's bundled JSON — likely needs its own retrieval strategy.

Where it lands: Tier 2 chunk C (retrieval & data).

### URL reconstruction from type + id — Thomas / Richard (Friday hackathon scope)

If the Friday hackathon lands on API-direct data access (vs scraping), can we still deterministically reconstruct the public page URL for any product / region / story given its type and id? This preserves the deep-link UX benefit that the scraping path gets for free.

Why it matters: if yes, API wins uncontested. If no, we need to weigh scraping's URL-generation benefit against its maintenance cost.

Where it lands: Tier 2 chunk C. See inbox entry 2026-04-22.

### Cross-page chat persistence expectation — Luke / Julie

Do they expect / want the chat to survive navigation between Swoop website pages? If deep-linking is in Puma, a visitor could click through to a page the agent recommended — and then the chat disappears unless we persist state across navigation.

Why it matters: cross-page persistence has real UX and technical cost. Default stance in the top-level plan is **no** until asked for. Worth checking before chunk D Tier 2 locks.

Where it lands: Tier 2 chunk D (chat surface).

### Meta-tag-embedded IDs on product pages — Thomas

Thomas proposed (21 Apr) adding a meta tag with the internal product ID on each public page. This would let a scraper (or any downstream consumer) carry the real internal ID on extracted records, not just slugs. Is Thomas's team willing to ship this change? It's small on their side, material for us.

Why it matters: affects whether scraping can cleanly bridge back to the internal record. If API-direct wins Friday, this becomes moot.

Where it lands: Tier 2 chunk C.

### Claude account Enterprise tier status — Julie / Tom

Is Swoop's recently-extended Claude account Enterprise-tier? Julie agreed to check with Tom on 20 Apr. Affects where ETL (scraper / API-extraction) Claude usage runs — on Swoop's account ("pure data munching" per Luke) vs Al's WhaleyBear account.

Why it matters: cost routing, not architecture.

### Sales inbox address + SMTP — Julie

What email address does the handoff delivery go to? What SMTP (or transactional email provider) should Puma send through? The PoC used personal Gmail — Puma needs something real. Also: does Swoop want a human to receive the raw AI handoff email, or does it need to thread into an existing CRM / helpdesk?

Why it matters: blocks M3 (triage + handoff end-to-end).

Where it lands: Tier 2 chunk E (handoff & compliance).

### Patagonia sales-thinking doc status — Luke / Lane

Luke + Lane committed (20 Apr) to producing the Patagonia equivalent of Emma's Antarctica sales document within 1–2 weeks. Target arrival ~May 4. Is that on track?

Why it matters: chunk G (content) depends on this for the Patagonia-voiced system prompt. If it slips, the content draft goes in on Antarctica-voiced placeholders and gets rewritten later.

### Legal counsel engagement model — Luke / Julie

What's the review loop with Swoop's legal counsel for the EU AI Act + GDPR surfaces? Who sends what to whom, and what's the turnaround? The 30 Mar proposal framed it as "I handle this simply; available to work with your legal team if you want to go further" — need to confirm Swoop's posture.

Why it matters: M5 ships only after legal sign-off. SLA uncertainty is the biggest schedule risk.

Where it lands: Tier 2 chunk E.

---

## Closed

### 2026-04-27 — Data pipeline batch (closed by SQL-dump inspection)

The 2026-04-27 SQL dump arrived from Swoop engineering and resolved a chunk of the Data pipeline questions through inspection rather than needing dedicated Swoop input. Inline `✅ Answered` markers under "Data pipeline" above carry the per-question detail. Headline closures:

- **Schema 1** — 129 tables enumerated; entity coverage mapped (Trip, Tour, Location, Hotel, Vessel, Cabin, Itinerary-Day, Page, Tag, Image all first-class). Confirmed absences: no `departure` table, no `swooper` table, no per-trip `review` table.
- **Schema 2** — FKs are extensive and largely as expected; 19 FK constraints on `trip` alone.
- **Schema 3** — Canonical `image` table with polymorphic join tables.
- **Schema 4** — Page / contentblock / chunk / faqitem CMS layer fully present.
- **Schema 5** — Polymorphic master `tag` table + per-target join tables.
- **Semantic 10 (partial)** — Confirmed no `departure` table; demand-driven hypothesis holds. Semantic walkthrough of `tripvariant`/`season`/`trip_operators_itineraries` still needed from Swoop.
- **Semantic 11** — No specialist table; aligns with Julie call confirming generic-handoff stance.
- **Semantic 12** — No per-trip review table; reviews are external. Useful side-find: `contentblock_customerreview` (2,390) carries sales-curated excerpts.
- **Operational 14 (partial)** — PII-heavy tables identified for exclusion (`partnerbooking`, `partnerbookingfile`, `inspection`, `partnertask`).
- **Operational 15** — Format confirmed (Sequel Ace `.sql`, ~210 MB, MariaDB 5.5.64).

**Still open** in the Data pipeline section: 6 (currency mapping — likely closeable by SELECT), 7 (difficulty/wilderness legend — likely closeable by SELECT against `adventurousness`), 8 (base/raw price formula), 9 (`window_price` meaning), 13 (one-off vs feed), 14 (full PII redaction sign-off), 16 (authoritative vs derived).
