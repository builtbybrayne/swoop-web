# Questions for Swoop

Open questions that need Swoop-side input before they can be closed. Periodically asked of the right person (Luke / Julie / Thomas / Richard / Martin / Lane / legal) depending on the topic.

**Entry format**: `## Topic — who to ask` then a short body stating the question, the context, and why it matters.

Mark `✅ Answered: ...` inline once resolved, then move to the closed section at the bottom during periodic triage.

---

## Open

### Julie call — 2026-04-27 ✅ Held; outcomes captured below

Most topics resolved during the call. Headline rulings landed in [inbox.md](inbox.md) 2026-04-27 entry "Swoop-side answers from Julie call" + decisions C.13–C.17 + B.22 + E.10 + C.18 + C.23 in [planning/decisions.md](planning/decisions.md). Per-topic status:

- **Sales-funnel "golden thread"** ✅ **Confirmed**. Decision C.13. Bot's job is Awareness → Interest → Strong Consideration. With the gradient: bot engages on specifics when pushed, refuses only on the shadow-itinerary boundary (Al's "without the fascism").
- **Pricing exposure** ✅ **Resolved tighter than proposed**: headline `base_price` only, no calculated ranges. Decision C.14. ETL surfaces `from_price` from `base_price` as-is, currency-normalised. Specifics route to specialist.
- **Departures stance** ✅ **Confirmed**: no departures surfaced. Patagonia is demand-driven, departure data shifts daily, misrepresentation risk too high. Decision C.14.
- **Specialist handoff persona** ✅ **Confirmed**: generic Patagonia specialist; no named advisor pre-call. Underlying reason sharper than expected — `swooper_*` fields are *customer* PII (Swoop's term for their customers), so we can't access them anyway. Decision C.14.
- **Data refresh cadence** ✅ **Working agreement**: weekly manual SQL dump during M1–M5 is fine. Steady-state still TBC — could become an API, CDC, or scheduled feed. Captured under "Data pipeline" Q13 below.
- **Derived data store posture** ✅ **Confirmed (Postgres approved post-call)**: Swoop are happy for us to use Postgres. Original optical concern unfounded. Decisions C.18 + C.23 + E.10 + B.22 follow from this.
- **`ntag` system purpose** ⚠️ **Partly answered**: Julie confirmed `tag` is dead and `ntag` is live (decision C.17). Operational meaning of `ntag` (what each entry means; how `ntags_lookup` joins) is **still open** — route to Thomas / Richard during the chunk-C ETL design pass (`questions.md` data-pipeline Q5 territory).
- **Refresh of existing open items** — touched on; the underlying items (Patagonia sales-thinking doc / sales inbox / legal counsel / Claude account tier / analytics platform) remain open as their own entries below.

### Pre-purge conversation analysis policy — Julie + Swoop legal

Opened 2026-04-28 by the chunk F refresh. Chunk F's new placeholder task (F.t6, see [planning/02-impl-observability.md](planning/02-impl-observability.md) §2.7) builds a council-of-experts analysis harness that runs over conversations *before* retention TTL deletes them. Findings (anonymised summaries, expert observations on what visitors are asking for, where conversations get stuck, etc.) would land in a `conversation_analysis` table in Cloud SQL Postgres, retained longer than the raw conversation data.

Open questions:
1. **Legal stance on retaining conversation derivatives** past the raw-data TTL. Anonymised expert findings — OK to keep indefinitely? Or do they inherit the raw conversation's TTL?
2. **What do you want to learn from real conversations?** — drives which expert prompts we build. Candidates: sales-process effectiveness, voice/tone consistency, content quality (did imagination land?), refusal compliance, unmet visitor needs, content gaps in the catalogue / blog.
3. **Reporting cadence + surface**: per-conversation summaries to a Swoop inbox? Daily/weekly batch reports? Spreadsheet feed? In-product dashboard?
4. **Cost tolerance**: each expert pass is a Claude call per conversation. What's the per-conversation analysis budget? (Drives whether we run experts on every conversation or sample/batch.)

Why it matters: F.t6 is the chunk's "Puma learns from itself before forgetting itself" mechanism. Without Swoop's WHAT-to-learn input, the harness ships with a single starter prompt and no defined ongoing analyses. Real loss of learning if the question is left open through M5.

Where it lands: Tier 2 chunk F (observability & analytics).

---

### Data pipeline — Thomas / Richard / Martin (batch — SQL dump arrived 2026-04-27)
The SQL dump has landed at `data/content-data-swoop-patagonia_prod.sql` (gitignored). Ingest session not yet held. That reshapes chunk C §2.1 — API-vs-scrape is superseded by "ingest the dump, map against our ontology, then decide steady state". The questions below came out of the first-pass web-surface inspection ([data-ontology.md](data-ontology.md), [planning/02-impl-retrieval-and-data-source-exploration.md](planning/02-impl-retrieval-and-data-source-exploration.md)) and should be worked through as the dump is explored.

Why it matters: the answers here define the shape of the derived datasource (chunk C §2.2), the retrieval tool set (chunk C §2.3), and whether the dump is a bootstrap or an operating model.

Where it lands: Tier 2 chunk C.

**Status after dump inspection (2026-04-27):** schema questions 1, 3, 4, 5 closed by inspection. Semantic 11 + 12 closed (no swooper, no review tables). Semantic 7 + 10 partly closed. Operational 15 closed. Remaining open items still need Swoop input. See Closed section for the batch entry; inline ✅ markers below.

**Status after C.t0 SELECT inspection (2026-04-29):** semantic questions 6, 7, 8, 9, 10, 16 closed fully by SELECT/Julie ruling. New finding routed back to Swoop: `customerreview`/`customertip` source tables are missing from dump (FKs dangle). Tracked under "New from C.t0 inspection" below. See Closed section's 2026-04-29 batch entry.

**Schema questions — answerable by inspecting the dump:**

1. ✅ **Answered** (2026-04-27, dump inspection): 129 tables enumerated. Mapping written to [data-ontology.md](data-ontology.md). Trip / Tour (via `tours`+`tour_items`) / Location / Accommodation (`hotel`) / Vessel / Cabin / Itinerary-Day (`daybyday`) / Page / Tag / Image present and first-class. **Departure: no table.** **Swooper: no table.** **Review: no per-trip table** (curated review excerpts exist as `contentblock_customerreview`, 2,390 rows). Notable additions not anticipated: full hotel pricing matrix, partner ops layer (PII), CMS chunk family, parallel `ntag` system.
2. ✅ **Answered** (2026-04-27, dump inspection): FKs are extensive — 19 declared FK constraints on `trip` alone. Confirmed expected edges: Tour↔Trip via `tour_items`, Trip↔Itinerary via `daybyday.trip_id`, Vessel↔Cabin via `cabintype_vessel`, Location hierarchy via `country`/`area`/`location`/`location_map`. Trip↔Departure does not exist (no Departure table); see Q10 below.
3. ✅ **Answered** (2026-04-27, dump inspection): Canonical `image` table (13,261 rows) plus polymorphic join tables: `image_trip`, `image_page`, `image_location`, `image_tag`, `image_month` (empty). Imgix CDN URLs are stored on the `image` record itself.
4. ✅ **Answered** (2026-04-27, dump inspection): `page` (684) + `pagetype` (20) + `pagelayout` (3) + `page_banner` (688) + `contentblock` (10,110) + 14 `contentblock_*` sub-tables + `chunk` (46) family + `faqitem` (928). Includes / Excludes are columns on `trip` (`includes`, `excludes` text fields). Additional Notes likely live in linked `contentblock`s.
5. ✅ **Answered** (2026-04-27, dump inspection): Polymorphic — single master `tag` table (2,374 rows) plus per-target join tables (`tag_trip`, `tag_video`, `image_tag`, `page_tag`, `partner_tag`). NOTE: parallel `ntag` (79) + `ntags_lookup` (157,537) system also exists; purpose unclear, asked Julie.

**Semantic questions — need Swoop input regardless of dump:**

6. ✅ **Answered** (2026-04-29, C.t0 SELECT): `currency.iso_3` is the lookup column. Mapping: 1=GBP, 2=USD, **3=EUR**, 4=AUD, 5=CLP, 6=ZAR, 7=ARS, 8=NZD, 9=CAD, 10=NOK, 11=DKK. (First-pass guess that 4=EUR was wrong; EUR is id 3.)
7. ✅ **Answered** (2026-04-27 + 2026-04-29): Julie ruled `adventurousness` deprecated. Confirmed by C.t0 SELECT — `adventurousness` is in fact a parallel "trip style" classifier (Adventurous/OBT/Camping/Luxury/Winter/Group/Budget/Independent etc., 11 rows, all `rating: 5` unused), not the difficulty/wilderness legend. Difficulty/wilderness on `trip` are raw integers 0–5; **no in-DB legend exists**. Agent surfaces raw integers without trying to map.
8. ✅ **Answered** (2026-04-27, Julie call): Out of scope. `raw_price` is a website-runtime calculation; ETL surfaces only `trip.base_price` (currency-normalised via `currency.iso_3`). The base/raw divergence is by design and irrelevant to our path.
9. ✅ **Answered** (2026-04-27, Julie call): Out of scope. `window_price` is also a website-runtime calculation; ETL ignores it.
10. ✅ **Answered fully** (2026-04-29, C.t0 SELECT + Julie ruling): No first-class `departure` table. Semantic walkthrough of nearby tables:
    - **`tripvariant` (584 rows)** — operational draft/active/retired versioning of trip records. `state` enum {draft, active, retired}. **Operational only — exclude from agent surface**.
    - **`season` (12 rows)** — annual fiscal-year periods (1 Sept → 31 Aug). Used for booking-year scoping and webinar campaign flags. **Back-office only — exclude from agent surface**.
    - **`trip_operators_itineraries` (885)** — partner-facing operational scheduling, not surfaced to public.
    - **`start_location` (11)** — likely small reference table; not load-bearing.
    Departures decision per Julie (C.14): **not surfaced**. Operational tables also excluded. Closes Q10 fully.
11. ✅ **Answered** (2026-04-27, dump inspection + Julie call): No `swooper`/specialist table in this DB. **`swooper_*` fields are customer PII** (Swoop's term for their customers). Per Julie call, the bot will hand off to a generic "Patagonia specialist" — no named-advisor pre-call assignment needed.
12. ✅ **Answered** (2026-04-27, dump inspection) + **new finding 2026-04-29 (C.t0)**: No per-trip review store in the dump — Trustpilot aggregate is external. **Side-finding from C.t0**: `contentblock_customerreview` (2,390) and `contentblock_customertip` (119) are *junction tables* with FKs to `customerreview` and `customertip` source tables — and **those source tables are NOT in the dump**. The 2,390 + 119 junction rows dangle. Either the export filtered them out (PII?) or the schema migration left stale FKs. **New question for Thomas/Richard** — see "New from C.t0 inspection" below.

**Operational questions:**

13. Is Monday's dump a one-off, or can it become a scheduled feed? I.e. is steady state `/weekly-dump`, or do we switch to API / CDC later?
14. ✅ **Partly answered** (2026-04-27, dump inspection): PII-heavy tables identified — `partnerbooking` (37,767 customer bookings), `partnerbookingfile` (20,767 attachments), `inspection` (210 partner inspections), `partnertask` (294), `partnercomment`, `partnerrelationship`. These must be excluded from the LLM-accessible derived store. Still need Swoop sign-off on what level of redaction they want before we even hold the data locally / on GCS.
15. ✅ **Answered** (2026-04-27, dump received): Raw `.sql` Sequel Ace export, MariaDB 5.5.64-flavoured. ~210 MB plain SQL plus a 38 MB zip alongside. Also confirms source DB version.
16. ✅ **Answered** (2026-04-27, Julie call): Dump is canonical, period. Even derived parts treated canonically. Closes Q16.

### New from C.t0 inspection (2026-04-29) — Thomas / Richard

Routed during the chunk-C ETL design pass (C.t3). Surfaced by the SELECTs in `planning/03-exec-c-t0.md`:

a. ✅ **CLOSED 2026-06-01 — both source tables delivered and live.** `customerreview` arrived 2026-04-30 (→ `find_someone_who`, C.26); `customertip` arrived 2026-05-27 (→ `find_tips`, the 9th MCP tool, built 2026-06-01). Full closure detail in the [Closed §"2026-06-01 — customertip delivered → `find_tips` live"](#closed) entry below. Original request preserved there for context.

b. **`daybyday` is much sparser than expected — confirm canonical filter.** The `daybyday` table holds 88,367 rows but only 13 trips have an `active` `tripvariant`, with 125 active rows. Of `presale`-typed rows (the candidate for sales-page rendering), 12,415 have `tripvariant_id=NULL` (i.e. not linked through a variant) and 0 are active. Best-guess ETL filter: `WHERE type='presale' AND trip_id IS NOT NULL AND deleted IS NULL` — but only 12,415 candidate rows for 852 trips means many trips will have no day-by-day data. **Question**: confirm the website renders these `presale` rows (or which other source it draws from). Critical for C.t3.

c. **`ntag` operational meaning of less-obvious entries.** Most of the 79 ntags are self-evident (areas, activities). A few `interest` tags need confirmation: `Futa`, `Queulat`, `Pumalin`, `Navarino`, `San Martin` — are these region-bounded sub-themes, specific routes, or marketing campaigns? Affects how `stoke_imagination` weights them.

### Tour content population — Thomas / Richard (raised 2026-05-12, route via Julie; reframed 2026-05-14)

**Update 2026-05-14 — the "`tour: 0/15`" problem is fixed.** The `tours` table's own `title` column is vestigial: empty (NULL or `''`) on every source row. Tour identity actually lives on the *page* the tour's `contentblock` belongs to (`tours.content_block_id → contentblock.page_id → page.title`). The C.t3 ETL now derives title/slug/canonical_url from there and filters to itinerary-type contentblocks — `puma_dev` carries **11 real tours + 35 tour_items**. See the 2026-05-14 addendum in [planning/03-exec-c-t3.md](planning/03-exec-c-t3.md) (decision C.focused-shamir-1). So the original "is tour content intended to be populated" question is largely answered: it always was — the ETL was just looking in the wrong column.

**Still open — confirm the contentblock type id.** The filter keys on `contentblock.type_id = 152` (the itinerary-block type). Swoop's dump carries no defining table for contentblock types, so `152` is an undocumented app-level enum value. We've confirmed it empirically (12 of 15 `tours` rows are type-152; the other 3 are a hotel / guidebook / "Swoop Says" block) and added a `page.pagetype = 'Itinerary'` cross-check as a drift guard. **Ask Thomas / Richard**: confirm `152` is the stable itinerary-tour contentblock type id, or point us at the enum definition. Low urgency — 11 rows, cheap guard in place — but it's a magic number in ingestion code.

**Also worth a sentence from Swoop**: `tours.title` and `tours.description` are empty (NULL) on all 15 source rows. Confirm these columns are genuinely unused (we read identity off the page) rather than a population gap we should wait on.

**Why it matters**: Luke's stated upsell priority is Tours. The `find_options` polymorphic-card design ([planning/03-exec-crosscut-find-options-polymorphism.md](planning/03-exec-crosscut-find-options-polymorphism.md)) ships a distinct `tour` variant with group-size badge + day-by-day affordance. With 11 tours + 35 tour_items now in `puma_dev`, the live-tour-card backend is no longer data-blocked — Al to re-judge the v2 tranche gating against this.

**Decision gate**: Al ratified 2026-05-12 that Tours stay a first-class proposal type in the contract regardless of timing.

### Analytics platform preference — Julie / Thomas

Where would Swoop want ad-hoc analysis of chat event logs to land? The default GCP path is BigQuery (simple sink from Cloud Logging, cheap, queryable), but they may already have a preferred BI / warehouse / analytics tool — Looker, Metabase, something else — that we should integrate with instead. Also: do they want the event schema to match conventions their analysts already use?

Why it matters: Puma ships with structured event logging. The schema we author now is what enables (or constrains) later analysis. Getting this wrong costs rework.

Where it lands: Tier 2 chunk F (observability & analytics).

### Observability — Cloud Logging + Error Reporting provisioning — Thomas (raised 2026-06-16)

Puma's event stream is now wired to a pluggable sink (`EVENT_SINK`; F-c). The dev/demo path (`postgres` → `event_log`) works today; the **production** path is **Cloud Logging + Cloud Error Reporting** (chosen 2026-06-16 — GCP-native, captures real app interest GA can't, and gives the dev team fast error alerting). To turn it on in the "AI Pat Chat" project, Swoop devops need to provision the following — **full paste-ready how-to in [product/docs/ops/observability.md](product/docs/ops/observability.md) §"Cloud Logging mode — the GCP flip"**:

1. Enable the **Cloud Logging** + **Error Reporting** APIs.
2. Grant the runtime service account (orchestrator + connector, GCE VM or Cloud Run) `roles/logging.logWriter`.
3. **GCE VM**: install the **Google Cloud Ops Agent** to ship both services' stdout to Cloud Logging. **Cloud Run**: nothing — stdout is captured natively.
4. Set `EVENT_SINK=cloud-logging` in both services' env.
5. Create a Cloud Monitoring **alert policy** on `severity >= ERROR` → a dev-team notification channel (email / Slack). This is the "surface issues to the dev team fast" requirement.
6. Region `europe-west2` (matches Cloud Run / Cloud SQL per the legal pack D-3.3.5).

Why it matters: until this lands, production events are ephemeral (stdout) and there is **no error alerting**. Gated on the same "AI Pat Chat" IAM as the rest of M4. **No new processor** — Cloud Logging is already in the compliance processor list ([06-processors.md](product/cms/legal/compliance-bundle/06-processors.md)); **add Error Reporting** to that list for completeness (it is a Google Cloud sub-service under the existing GCP DPA, so no new DPA).

Where it lands: Tier 2 chunk F + the M4/M5 prod handover (currently only `product/ui/HANDOVER.md` exists, which is UI-scoped — a backend prod-provisioning checklist is an M4/M5 deliverable; this entry is the interim home).

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

Specifically need: `HANDOFF_EMAIL_FROM`, `HANDOFF_EMAIL_TO_QUALIFIED`, `HANDOFF_EMAIL_TO_REFERRED_OUT` (or confirmation that referred-out leads share the qualified inbox with a subject prefix), `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`.

Why it matters: as of 2026-04-28 the handoff submit flow is wired end-to-end and writes durable records on submit, but the email leg is **off by default** behind `HANDOFF_EMAIL_ENABLED=false`. Flipping it on requires the env vars above; the boot-time config refine fails fast if any are missing while ENABLED. The flow is shipped, just gated.

Where it lands: Tier 2 chunk E (handoff & compliance).

### Patagonia sales-thinking doc status — Luke / Lane

Luke + Lane committed (20 Apr) to producing the Patagonia equivalent of Emma's Antarctica sales document within 1–2 weeks. Target arrival ~May 4. Is that on track?

Why it matters: chunk G (content) depends on this for the Patagonia-voiced system prompt. If it slips, the content draft goes in on Antarctica-voiced placeholders and gets rewritten later.

### Legal counsel engagement model — Luke / Julie

What's the review loop with Swoop's legal counsel for the EU AI Act + GDPR surfaces? Who sends what to whom, and what's the turnaround? The 30 Mar proposal framed it as "I handle this simply; available to work with your legal team if you want to go further" — need to confirm Swoop's posture.

Why it matters: M5 ships only after legal sign-off. SLA uncertainty is the biggest schedule risk.

Where it lands: Tier 2 chunk E.

### "Swoop Planning Specialists" canonical wording + terminology-card copy — Luke (raised 2026-06-10)

Two asks from the 10 Jun Loom feedback round ([triage ledger](planning/reviews/2026-06-10-luke-loom-feedback.md) item P1):

1. **The exact canonical term.** Luke wants the sales team treated "almost as sacredly as a trademark" with consistent, always-bold naming — transcript says *"swoops, uh, planning specialists or something like that"* and that he'd *"put this in an email somewhere"*. We're proceeding with **"Swoop Planning Specialists"** as the working term (centralised — a rename is one edit). Need his email with the final wording.
2. **Card copy sign-off.** A small "About Swoop Planning Specialists" card will appear in the sidebar on first mention ([terminology-card plan](planning/03-exec-crosscut-magical-poincare-terminology-card.md)) — 2–3 lines pitching their experience and what they do. We'll draft from existing brand material; Luke/Julie to review the wording.

Why it matters: the term lands across the system prompt, skills, handoff form, emails, and the new card — getting the string wrong means a sweep twice.

### Swoop Group Tours — which 4, and the page URL — Luke, then Thomas / Richard (raised 2026-06-10)

Luke (10 Jun Loom): there are **4 Swoop Group Tours**, listed on the Swoop Group Tours page, which he can point us to; they're a business priority and price-conscious visitors should be steered toward them. Our `tour_card` table holds **11** CMS-derived tours (see "Tour content population" above). Need:

1. The Swoop Group Tours page URL (Luke offered).
2. Which 4 of our 11 tours are the current Swoop Group Tours — or whether some of the 4 aren't in the dump at all. Ideally a CMS-side discriminator (flag / page placement) so the mapping survives content changes; route the mechanics to Thomas / Richard.
3. Whether the other 7 tours should surface at all, or only the 4.

Why it matters: the [content plan](planning/03-exec-content-t6-luke-loom.md) adds price-consciousness as a tour-surfacing signal now, but the agent can't privilege "the 4" until we can identify them in data.

### Production-first prioritisation of data-layer investments — Luke (Alastair emailing, 2026-06-10)

Luke's 10 Jun feedback surfaced two non-trivial data-layer items ([ledger D2 + D5](planning/reviews/2026-06-10-luke-loom-feedback.md)): **Product Library ingestion** (the authoritative pricing source — website/blog content can't guarantee contemporary figures) and **trip-card relevance** (needs better data *and* more sophisticated search methodologies than vector search alone). **Neither is being planned now** — both are deliberate deferrals pending a priorities conversation.

Alastair is proposing to Luke by email: **prioritise getting Puma into production**, and come back to these if and when there's evidence they're suppressing **marketing conversion rates** — conversion being the project's real aim.

The ask: Luke's agreement on that prioritisation (or a steer that one of these matters enough to pull forward — which then becomes a scoped commercial conversation, not a quiet absorption).

In the meantime, the standing in-fence mitigations ship with the current wave: provenance dates + broad-band/contemporaneity pricing policy ([retrieval-provenance plan](planning/03-exec-crosscut-magical-poincare-retrieval-provenance.md) + [content plan §2.4](planning/03-exec-content-t6-luke-loom.md)), and the cheap budgetBand/region probes (ledger D5).

Why it matters: keeps the build pointed at production and conversion rather than speculative data work — and names the evidence gate so the deferral stays principled instead of forgotten.

### Stale cost figures in FAQ content — Luke / Julie (raised 2026-06-10)

The 2026-06-10 provenance work traced Luke's "$300–350/day" complaint to its actual source: it is **not** the 2011 blog post — it lives in an **undated FAQ row** ("How much does hiking in Patagonia cost?"), which is the top retrieval hit for cost-shaped questions. FAQ content carries no editorial date in the CMS dump, so the agent's new dated-source rule can only treat it as *undated* (usable for colour, not citable figures) — it cannot age it out the way it now can with blog content.

The ask: have someone Swoop-side **correct or retire the stale figures in that FAQ entry** (and any sibling cost FAQs) at source. One content edit fixes what no amount of agent-side guardrail fully can; the corrected row flows in at the next weekly SQL dump.

Why it matters: pricing is the highest-sensitivity accuracy item in Luke's feedback; the guardrail now prevents the agent *citing* the stale figure, but the right answer to "what does it cost?" needs a current source to exist.

---

## Closed

### 2026-06-01 — customertip delivered → `find_tips` live (closes item (a) fully)

The long-pending customertip half of item (a) ("New from C.t0 inspection") is now closed. Both source tables the C.t0 inspection flagged as missing have been delivered and turned into live conversational surfaces:

- **`customerreview`** — delivered 2026-04-30, powers `find_someone_who` (Mirror). Closed at [decisions.md C.26](planning/decisions.md).
- **`customertip`** — delivered 2026-05-27, powers **`find_tips`** (Inform job, second shape — traveller-sourced practical wisdom). Schema-lookup confirmed **47 live rows** (not the 119 the junction-count implied — clean editorial selections), no email/IP/customer-FK PII. Built 2026-06-01 per [planning/03-exec-customer-tips-tool.md — customer_tips ingest + `find_tips` tool](planning/03-exec-customer-tips-tool.md); decisions C.tip-1…C.tip-4 in [decisions.md](planning/decisions.md).

**Original ask (preserved for context)**: Swoop was formally asked for a redacted export of `customerreview` + `customertip` (the junction tables `contentblock_customerreview` (2,390) and `contentblock_customertip` (119) carried FKs to source tables absent from the original dump — PII redaction at export time the likely cause). The ask was routed via Julie. Both grants landed within Swoop's normal turnaround. The data is sales-curated excerpts already published on Swoop's website, so the privacy fence around the prose was always smaller than around the customer record. `pressreview` was never delivered and is unused — out of scope for Puma.

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

### 2026-04-29 — Data pipeline tail closed by C.t0 SELECT inspection

The C.t0 task ([planning/03-exec-c-t0.md](planning/03-exec-c-t0.md)) loaded the dump into local MariaDB and ran ten clarifying SELECT batches. Closes the remaining schema/semantic tail. Inline `✅ Answered (2026-04-29, C.t0 SELECT)` markers under "Data pipeline" above carry the per-question detail. Headline closures:

- **Q6** Currency mapping resolved — confirmed 1=GBP, 2=USD, **3=EUR** (first-pass guess of 4=EUR was wrong; 4=AUD), and the full 11-currency table includes CLP, ZAR, ARS, NZD, CAD, NOK, DKK.
- **Q7** Difficulty/wilderness legend resolved — `adventurousness` is *not* a legend at all; it's a parallel "trip style" classifier (deprecated). Difficulty/wilderness are raw integers 0–5 with no in-DB legend; agent surfaces raw values.
- **Q8** Base/raw divergence — out of scope per Julie. Closed.
- **Q9** `window_price` — out of scope per Julie. Closed.
- **Q10** Departure storage + semantic walkthrough of nearby tables — `tripvariant`/`season`/`trip_operators_itineraries` all confirmed operational/back-office only; excluded from agent surface. Closed fully.
- **Q16** Dump-as-canonical — confirmed by Julie. Closed.

**New question raised** (kept under "Data pipeline" / "New from C.t0 inspection" above, route to Thomas/Richard):
- The `customerreview` and `customertip` source tables are absent from the dump — junction tables exist but FK targets are missing. Is the export selective, or has the schema migrated?
- The `daybyday` canonical-filter best guess is `type='presale' AND trip_id IS NOT NULL AND deleted IS NULL`, yielding only 12,415 candidate rows for 852 trips. Confirm the website actually renders these.
- A few `ntag` interest entries need semantic confirmation (Futa, Queulat, Pumalin, Navarino, San Martin).
