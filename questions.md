# Questions for Swoop

Open questions that need Swoop-side input before they can be closed. Periodically asked of the right person (Luke / Julie / Thomas / Richard / Martin / Lane / legal) depending on the topic.

**Entry format**: `## Topic — who to ask` then a short body stating the question, the context, and why it matters.

Mark `✅ Answered: ...` inline once resolved, then move to the closed section at the bottom during periodic triage.

---

## Open

### Data pipeline — Thomas / Richard / Martin (batch, pending Monday 2026-04-27 SQL dump)

On 2026-04-24 Swoop engineering agreed to ship a full SQL database export on Monday. That reshapes chunk C §2.1 — API-vs-scrape is superseded by "ingest the dump, map against our ontology, then decide steady state". The questions below came out of the first-pass web-surface inspection ([data-ontology.md](data-ontology.md), [planning/02-impl-retrieval-and-data-source-exploration.md](planning/02-impl-retrieval-and-data-source-exploration.md)) and should be worked through as the dump is explored.

Why it matters: the answers here define the shape of the derived datasource (chunk C §2.2), the retrieval tool set (chunk C §2.3), and whether the dump is a bootstrap or an operating model.

Where it lands: Tier 2 chunk C.

**Schema questions — answerable by inspecting the dump:**

1. What tables exist? Which map to our ontology entities (Trip, Tour, Location, Accommodation, Vessel, Cabin, Departure, Itinerary-Day, Page, Tag, Image, Review, Swooper)?
2. What are the actual FKs between tables — especially Tour↔Trip, Trip↔Departure, Trip↔Itinerary-Day, Itinerary-Day↔Accommodation, Location hierarchy, Vessel↔Cabin?
3. Is there a canonical Media/Image table, or are image URLs embedded on owner records?
4. Is there a canonical FAQ / CMS-block / "Page" content table? The detail page's Includes / Excludes / Additional Notes panels live somewhere.
5. How are tags stored — one polymorphic table keyed by `type`, or per-type tables?

**Semantic questions — need Swoop input regardless of dump:**

6. Currency-id mapping: 1 / 2 / 4 → ?
7. `difficulty` 1–5 and `wilderness` 0–5 — user-facing definitions of each level?
8. `base_price` vs `raw_price` — why they diverge (W-Trek: raw 2,900 → base 4,119), what formula produces base?
9. `window_price` — promotional? seasonal? time-windowed? Only populated on ~18% of records.
10. Departures model — fixed-date group vs. demand-driven bespoke? How's "Flexible Dates" vs "Fixed Dates" represented on the detail page stored underneath?
11. Swooper (specialist) assignment — manual per trip, rule-based per region, or CRM-driven?
12. Reviews — Trustpilot aggregate vs. Swoop-owned per-trip store. Is the detail page's "4.6 / 338" derivable from our dump or does it need an external pull?

**Operational questions:**

13. Is Monday's dump a one-off, or can it become a scheduled feed? I.e. is steady state `/weekly-dump`, or do we switch to API / CDC later?
14. Licensing / PII / what to redact before storing or querying the dump.
15. Expected dump size and format — raw `.sql`, CSV per table, parquet, `pg_dump` binary?
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

(Move resolved questions here with date + who answered + the resolution. Empty for now.)
