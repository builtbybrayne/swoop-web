# Swoop data ontology — what exists, what's missing

Reference view of the Swoop Patagonia data we've been able to inspect so far, the record types it implies, and what's clearly absent. The point of this doc is to let us write a precise "please give us access to X, Y, Z" ask to Swoop engineering rather than a vague "we need more data".

## Sources inspected

| Tag | Source | Notes |
|---|---|---|
| **[S-SQLDUMP-2026-04-27]** | `data/content-data-swoop-patagonia_prod.sql` — full Sequel Ace export of Swoop's MariaDB 5.5.64 database, ~210 MB, 129 tables. Loaded locally for inspection during C.t0 (2026-04-29). | **Canonical source going forwards.** Supersedes the public-feed inspection below for any conflict. The first-pass [S-INDEX]/[S-DETAIL-*] tags below remain as "what was visible from outside" reference; the dump is what we actually ETL. |
| **[S-INDEX]** | `https://www.swoop-patagonia.com/trips/get_trip_finder_data` — JSON feed behind the Trip Finder listing. Saved snapshot at `~/Downloads/get_trip_finder_data.html`. | 119 records (111 trips + 8 tours), plus filter / sort / tag vocabularies, plus global price ceilings. Public catalogue view — narrower than the dump. |
| **[S-DETAIL-HTML]** | `https://www.swoop-patagonia.com/chile/torres-del-paine/hiking/w-trek/original` — server-rendered HTML as returned by WebFetch. | Shell only. Missing everything JS-populated (itinerary, departures, prices & departures table, difficulty visualisation, includes/excludes). |
| **[S-DETAIL-JS]** | Same URL, as seen in the browser screenshot. | Fully rendered — reveals day-by-day itinerary, a departures table with dated rows + GBP prices, includes/excludes/additional-notes panels, video, trust badges, B Corp block. |
| **[REUSE-POC]** | `chatgpt_poc/product/cms/` content files from the Apps SDK prototype. | Not freshly re-read for this doc — referenced for where we already hand-modelled cruises/ships/activities. |

Every attribute below is tagged with the source it came from. **Where [S-SQLDUMP-2026-04-27] disagrees with [S-INDEX], the dump wins** (Julie call 2026-04-27: "the dump is canonical, period").

---

## Headline product rulings (Julie call 2026-04-27 + C.t0 2026-04-29)

These rulings shape the rest of the doc. They're called out first because they invalidate or demote whole sections below:

- **No departures surfaced.** Patagonia is demand-driven; departure data shifts daily; misrepresentation risk too high. Decision C.14. §3 below is preserved as legacy reading but recast as out-of-scope.
- **No calculated price ranges.** Headline `trip.base_price` only, exactly as authored, currency-normalised. `raw_price` / `window_price` / `cabin_*` are website-runtime calculations and **not surfaced**. §4 demoted.
- **`swooper_*` fields are customer PII**, not staff. Off-limits. §11 recast.
- **`tag` table is dead; `ntag` is live.** §15 rewritten in §15-LIVE below.
- **`adventurousness` table is deprecated.** Difficulty (0–5) and wilderness (0–5) on `trip` are raw integers without an in-DB legend. The `adventurousness` table is in fact a parallel "trip style" classifier (Adventurous / OBT / Camping / Luxury / Winter / Group / Budget / Independent / Yurt / Huts/W Trek / Day Hikes — 11 entries) — not the difficulty/wilderness legend the public-feed inspection assumed.
- **Image filenames live on `file`, not `image`.** `image.image_id` FKs into `file.id`; `file.name` carries the filename. URLs are constructed at runtime as imgix-prefixed (`https://swoop-patagonia.imgix.net/<file.name>?<params>`); the dump does not store imgix URLs directly.
- **Page-as-hub pattern.** Records with `page_id` (hotel, trip, location) reach their canonical URL + image set via the linked `page`. Trips also carry direct `image_trip` joins (3,361 rows), so trips have *both* paths.
- **URL rule**: `override_url || alias`. Confirmed: 100% of trips have an alias; 67% have an override_url. 100% of pages have an alias; 91% have an override_url. The fallback to alias works universally.

---

## Record-type inventory

This is the shape of the entity graph we need. Entities observed in the data are marked **Observed**; entities we can see gaps for but have no record of are **Implied**. Implied entities are the gap list.

```
Tour ──contains──► Trip ──uses──► Vessel ──has──► Cabin
  │                 │ │            │              │
  │                 │ │            └──sails──► Itinerary-leg
  │                 │ └──stays-at──► Accommodation (Refugio / Hotel / Estancia / Camp)
  │                 │ └──does──► Activity
  │                 │ └──visits──► Location ──in──► Region ──in──► Country
  │                 │ └──schedules──► Departure ──prices──► PricePoint (per-currency, per-occupancy)
  │                 │ └──itinerary──► Day ──has──► Highlight, Walking-stats
  │                 │ └──tagged──► Tag (area / activity / style / trip-type / interest)
  │                 │ └──reviewed-by──► Review
  │                 │ └──championed-by──► Swooper (specialist)
  │                 └──illustrated-by──► MediaAsset (image / video)
  │                 └──answered-by──► FAQ
```

---

## 1. Tour — Observed

**Definition (as implied by data):** a multi-region, multi-week itinerary composed of smaller Trips stitched together. 8 tour records in [S-INDEX], durations 6–19 days.

**Observed attributes [S-INDEX]:**

| Attribute | Type | Notes |
|---|---|---|
| `id` | string | `tour_<n>` — e.g. `tour_9` |
| `title` | string | `"Best of Patagonia"`, `"Luxury Highlights of Patagonia"` |
| `page_id` | int | CMS page id |
| `publishstate_id` | enum (all `3`) | Publishing state flag — vocabulary unknown |
| `override_url` | string | e.g. `tours/tailor-made/best-of` |
| `alias` | string | `best-chile-argentina` |
| `url` | string | full URL |
| `difficulty` | 1–5 | See section on controlled scales |
| `wilderness` | 1–5 | "off the beaten track" index |
| `duration` | int days | sum of legs, 6–19 in data |
| `bookings_count` | int | popularity proxy; sort key |
| `recommended_index` | int | editorial rank; primary sort |
| `image_id` / `image_src` / `image_srcs[]` | img CDN URLs | imgix-served |
| `wmtts` | text | "We Made This To Say" — editorial teaser paragraph |
| `trip_ids[]` | array of trip.id | **The only explicit graph edge.** Tour→Trip link. |
| `durations[]` | parallel array | per child trip |
| `raw_prices[]` / `currency_ids[]` | parallel arrays | per child trip |
| `locations[]` | array of region names | parallel to trip_ids; free-text |
| `vessel_id` / `vessel_title` / `vessel_page_id` / `vessel_max_passengers` | nullable | **Populated on 2/8 tours** (both `Ventus Australis`, max 210). Rest null. |
| `trips_with_vessels[]` | array | One entry per child trip; non-empty means that leg uses a ship |
| `raw_price` / `base_price` / `price_per_day` / `formatted_base_price` | money | Totalled figures for the tour |
| `tags` | object keyed by tag type | See §Tag taxonomy |

**Gaps on Tour:** no start/end dates, no departure calendar, no season availability, no itinerary day plan (only the ordered list of child trips), no inclusions/exclusions list, no lead-specialist, no per-region breakdown beyond `locations[]` strings.

---

## 2. Trip — Observed

**Definition:** an individual experience of 2–12+ days, e.g. *The Original Torres del Paine W Trek*, *Ushuaia 4-day excursion*, *Perito Moreno ice-hike day*. 111 trip records in [S-INDEX]; **852 trip records in [S-SQLDUMP-2026-04-27]**. The public feed surfaces a curated subset — there's a long tail of legacy/alt/internal trips in the dump.

**Observed attributes [S-INDEX]:**

| Attribute | Type | Notes |
|---|---|---|
| `id` | numeric string | e.g. `369` — no prefix |
| `title` | string | "The Original Torres del Paine W Trek" |
| `alias` | string | `w-trek-torres-del-paine` |
| `override_url` | string | `chile/torres-del-paine/hiking/w-trek/original` |
| `url` | string | full URL |
| `trip_type` | enum: `trip` | distinguishes from `tour` |
| `category_id` | enum: `1` (101 recs), `2` (10 recs) | vocabulary unknown — probably trip vs. add-on/daytour |
| `difficulty` | 1–5 | dist in data: 1×17, 2×36, 3×41, 4×20, 5×5 |
| `wilderness` | 0–5 | "off the beaten track" |
| `duration` | int days | 2–12 |
| `location` | string | single primary region, e.g. `Torres del Paine` |
| `location_alias` | string | `torres-del-paine` |
| `bookings_count` | int | popularity proxy |
| `recommended_index` | int | editorial rank |
| `raw_price` | money | headline "from" price |
| `window_price` | money | present on 21/119 — likely a promo field (guess) |
| `base_price` | money | display price, sometimes = `raw_price × currency FX`, sometimes larger ($4,119 vs $2,900 on the W-Trek — unresolved) |
| `cabin_original_price`, `cabin_price` | money | only meaningful on cruise trips |
| `price_per_day` | computed | |
| `currency_id` | enum: `1`, `2`, `4` | Dist: 1×1, 2×110, 4×8. Mapping unknown — probably USD/GBP/EUR. |
| `formatted_base_price` | string | pre-formatted |
| `image_src` / `image_pos` | CDN URL + sort-weight | |
| `wmtts` | text | editorial teaser |
| `tags` | object keyed by tag type | See §Tag taxonomy |
| `reviews` | nullable | populated on 2/119 only |

**Attributes declared but empty in this feed** (field exists in schema, value always null): `swooper_first_name`, `swooper_last_name`, `swooper_avatar_src`, `swooper_says_blurb`, `vessel_comfort`, `vc_id`, `signifiers`, `trip_finder_blurb`, `ag_link`. These are real fields in their data model that this endpoint doesn't fill — worth asking Swoop where they do get filled (detail endpoint? CMS?).

**Attributes visible on the detail page but not in this feed [S-DETAIL-JS]:**
- Day-by-day itinerary (each day: title, activities, accommodation)
- Departures list (date, price, availability flag)
- Includes/excludes/additional-notes lists
- Linked refugio/hotel names per night
- Star rating + review count as numbers (4.6 / 338 on W-Trek)
- Trust / certification badges
- Video asset

---

## 3. Departure — **OUT OF SCOPE (decision C.14, Julie call 2026-04-27)**

Originally tagged as "priority gap #1". **Recast 2026-04-27**: Patagonia departures are demand-driven, change daily, and misrepresentation risk through the bot is too high. Decision C.14 — **the bot does not surface dated departures at all.** The first specialist call handles availability.

[S-SQLDUMP-2026-04-27] confirms: there is **no `departure` table** in the dump. Closest tables are `tripvariant` (584 — operational draft/active/retired versions of trip records, see §16 below), `season` (12 — annual fiscal-year periods Sept-Aug, see §17), `trip_operators_itineraries` (885 — partner-facing scheduling), `start_location` (11), `partnerbooking` (37,767 — operational booking records, PII-heavy, excluded from agent surface). Confirms the demand-driven hypothesis architecturally.

**Visitor-facing language**: when asked "when can I go?", agent points to broad seasonality (e.g. "best Patagonia weather Nov–Feb"); specific dates route to the specialist handoff.

The original "what we need" sub-table is preserved here only for posterity — none of those fields are surfaced:

<details>
<summary>Legacy field list (no longer pursued)</summary>

`departure_id`, `trip_id` FK, `start_date`, `end_date`, `price` per currency / per occupancy (single/twin-share), `availability_status`, `spaces_remaining`, `group_size`, `is_fixed_date` vs `is_flexible`, `single_supplement`, `discounts` / `promotion_tags`.

</details>

---

## 4. PricePoint — **OUT OF SCOPE (decision C.14, Julie call 2026-04-27)**

**Recast 2026-04-27**: agent surfaces `trip.base_price` only, exactly as authored, currency-normalised. No tier × season grids, no regional bands computed at export, no occupancy adjustments. Specifics route to the specialist handoff.

`raw_price`, `window_price`, `cabin_price`, `cabin_original_price` are all **website-runtime calculations** (the website applies FX + occupancy logic to display the public price). The dump stores the inputs; we don't replicate the runtime layer.

The first-pass guess that "currency_id 1/2/4 → GBP/USD/EUR" was **partly wrong**: per [S-SQLDUMP-2026-04-27] §S1, the actual mapping is **1=GBP, 2=USD, 3=EUR, 4=AUD** (11 currencies total in the `currency` table, with `iso_3` codes; the public feed only had 1/2/4 because EUR-priced trips happen to be rare).

The original "what actually exists commercially" list is preserved for posterity:

<details>
<summary>Legacy commercial-pricing list (no longer pursued)</summary>

Currency conversion (USD/GBP/EUR/AUD/CLP/ARS/ZAR/NZD/CAD/NOK/DKK), seasonality pricing (peak/shoulder/off-peak), occupancy basis (single/twin/triple), room/cabin tier, group-size bands, promotional/early-bird tiers.

</details>

---

## 5. Itinerary / Day — **Observed in [S-SQLDUMP-2026-04-27] as `daybyday` — sparse**

**Found in dump**: `daybyday` table, 88,367 rows. Shape per [S-SQLDUMP-2026-04-27] §S5:

| Column | Type | Meaning |
|---|---|---|
| `id`, `trip_id`, `tripvariant_id` | FKs | Trip + variant linkage |
| `day_start`, `day_end`, `counter` | int | Day numbering |
| `type` | enum: `presale` / `postsale` / NULL | **`presale` = customer-facing day-by-day for the trip page; `postsale` = booking-confirmation document. Agent surface uses `presale`.** |
| `title` | varchar(255) | e.g. "Trek to Las Torres lookout; Camping or Refugio at Las Torres" |
| `site_text`, `pre_sale_text`, `post_sale_text` | text (HTML) | Prose. Per sample row, `site_text` carries the rendered HTML. |
| `info_json` | text (JSON string) | Structured per-day metadata: `[{title:"Private transfer",value:"2.5hrs"}, {title:"Length of hike",value:"7-8hrs, 19km"}, {title:"Difficulty",value:"Medium/demanding"}, {title:"Meals",value:"Picnic lunch, dinner"}, {title:"Accommodation",value:"Camping or Refugio options at Las Torres (meals in refugio)"}, …]` |
| `start_location_id`, `end_location_id` | FK | Location-graph linkage |
| `image_id` | FK | Per-day image |
| `bookingitem_id` | FK | Cross-link to booking record (operational; not for agent) |

**Critical sparseness finding (C.t0 2026-04-29):**

- **Only 13 trips** have an `active` `tripvariant`, with **125 active daybyday rows total**. The vast majority of `daybyday` rows are `state=NULL`/draft/retired.
- 50,685 rows have `trip_id IS NULL` (orphan drafts).
- Of `presale` rows: 12,415 have `tripvariant_id=NULL` (i.e. directly tied to `trip_id` without going through a variant), 72 are draft, 10 are retired, **0 are active**.
- Of `postsale` rows: 73,551 have NULL state, 125 are active, 1,551 draft, 583 retired.

**Implication for ETL**: the canonical "active sales-page day-by-day" prose is **`daybyday WHERE type='presale' AND deleted IS NULL`**, joined directly on `trip_id` (NOT through `tripvariant`). The `tripvariant` system is being used for operational draft management of post-sale documents, not for sales-page itineraries. Active variant tied to presale data does not exist in the dump.

**Action for C.t3**: include `daybyday WHERE type='presale' AND trip_id IS NOT NULL AND deleted IS NULL` in `export.sql`. Surface `title`, `site_text` (or whichever text column is non-null), `info_json`-parsed per-day metadata. Skip `postsale` entirely (post-purchase confirmation, not relevant to discovery).

**Open question for Swoop ops**: confirm that `daybyday WHERE type='presale'` is what the Swoop website actually renders on a trip page. The website is rendering *something* — needs cross-check during C.t3.

---

## 6. Activity — **Currently a tag, needs to be a record**

**Observed [S-INDEX] (tag only):** 12 distinct activity tags — Trekking (47), Excursions (56), Wildlife (13), Zodiac (12), Horseriding (9), Kayaking (8), Biking (5), Road Trip (4), Multi-activity (4), Mountaineering (3), Rafting (1), Multi (17).

Top-level filter `activity` in [S-INDEX] maps to these.

**What's missing for each activity** (needed if we're going to offer "add optional ice-hiking on Glacier Grey for $X"):
- Activity description
- Difficulty / skill prerequisites
- Duration / half-day vs full-day
- Price (when sold as add-on)
- Eligibility constraints (age, weather, fitness)
- Operated-by (direct vs. partner operator)
- Per-location availability

---

## 7. Location / Region / Country — **Currently a string, needs to be a record**

**Observed [S-INDEX]:** 14 distinct location strings in `location` / `locations[]` fields: Torres del Paine (42), Los Glaciares (24), Tierra del Fuego (15), Chilean Lakes (12), Aysen (8), Santiago (6), The Fjords (6), Multi-region tour (6), Argentinian Lakes (6), Buenos Aires (5), The Atacama (5), Valdes (4), Iguazu (2), Easter Island (1).

Also 15 `area` tags (overlapping but not identical — e.g. Antarctica appears as a tag but not a `location`).

**What's missing:**
- Hierarchy: Country → Region → Park → Sub-area → POI
- Geography (lat/long, bounding box)
- Gateway city / nearest airport
- Peak season windows per location
- Linked Activities available there
- Inter-location travel legs (ferry, bus, flight; duration, cost, operator)

---

## 8. Accommodation — **Absent as record; appears as names in itinerary text**

**Observed [S-DETAIL-JS]:** three refugios named in the W-Trek itinerary: *Refugio Los Cuernos*, *Refugio Paine Grande*, *Refugio Grey*.

**Observed [S-INDEX] (tag only):** 7 style tags that double as accommodation categories — Hotel (51), Luxury (32), Camping (32), Glamping (16), Ship (12), Refugio (11), Estancia (7).

**What we need** (a proper Accommodation catalogue):
- `accommodation_id`
- `name`
- `type` enum (refugio / hotel / estancia / camp / glamping / ship)
- `operator`
- `location` FK
- `room_types[]` → each with bed config, occupancy, en-suite flag
- `board_basis` default (B&B / half-board / full-board)
- `amenities`
- `images`
- `description`
- `coordinates`
- `seasonal_availability`

Without this we cannot answer "where will I sleep each night, and can I upgrade?".

---

## 9. Vessel / Ship — **Partially observed, embedded-flat**

**Observed [S-INDEX]:** fields exist on every record but populated on only 2 (both tours using *Ventus Australis*, max 210 passengers). Fields: `vessel_id`, `vessel_title`, `vessel_page_id`, `vessel_max_passengers`, `vessel_comfort` (always null), `vc_id` (always null), `trips_with_vessels[]`.

**What we need** (real ship catalogue — we already had parts of this in the ChatGPT PoC CMS, worth aligning):
- `vessel_id`, `name`, `operator`
- Passenger capacity, crew, length, flag, build year, refit
- Ice class, stabilisers, bow type, expedition gear (zodiacs, kayaks)
- Deck plan, cabin types (see below)
- Common areas / amenities
- Images & video
- Typical routes / departure ports

---

## 10. Cabin / Room — **Implied from pricing; no record**

**Clue [S-INDEX]:** `cabin_price` field populated on 6/119 records, `cabin_original_price` universal but usually 0.

**What we need:**
- `cabin_id`, `vessel_id` FK, `cabin_class`, `deck`, `capacity`, `bed_config`, `window/porthole`, `square_metres`, `images`, `price_by_occupancy`.

---

## 11. Swooper (specialist / advisor) — **PII boundary, OFF-LIMITS**

**Recast 2026-04-27 (Julie call)**: `swooper_*` fields are **Swoop's internal term for their *customers*** — not staff/specialists. The fields name a customer who has booked or is on a trip. **This is customer PII, not staff data.**

We do not surface, ingest, or otherwise touch `swooper_*` columns. The handoff-to-human flow uses a generic "Patagonia specialist" persona; no named-advisor pre-call assignment is required (decision C.14).

The first-pass guess that "specialists live in a CRM" was wrong twice over: (a) these aren't specialists, and (b) the dump has no specialist table at all (specialists, if they're in any database, are in a separate CRM not part of this dump).

**ETL action**: `export.sql` whitelist excludes any column with prefix `swooper_` and any table containing customer-attribution data. The `partner*` table family is similarly excluded (operational/PII).

---

## 12. Review — **No first-class table; carousel/junction tables present but source tables MISSING from dump**

[S-SQLDUMP-2026-04-27] §S6 + follow-up:

- `contentblock_customerreview` (2,390 rows) — **junction table** with FKs `customerreview_id → customerreview.id` and `contentblock_id → contentblock.id`.
- `contentblock_customertip` (119 rows) — same shape, FKs `customertip_id → customertip.id`.
- `contentblock_pressreview` (0 rows) — empty; reserved.
- `contentblock_reviewcarousel` (646 rows) + `contentblock_reviewcarousel_review` (0 rows) — carousel container shells.

**Critical finding (C.t0 2026-04-29)**: the source tables `customerreview` and `customertip` referenced by these FKs **do not exist in the dump**. The 2,390 junction rows are dangling — their `customerreview_id` values point at a table the export did not include. Similarly for `customertip`.

This means **the prose content of customer reviews/tips is absent from the dump**. Either:
1. The export was selective and these tables were intentionally omitted (PII, separate sales-content store).
2. The schema migrated and the FKs are stale — no real data ever lived in those tables.

**Action**: route to Swoop ops (Thomas/Richard) — confirm whether `customerreview`/`customertip` tables exist in their primary database and were filtered out of the export, or whether this content lives elsewhere (separate CMS, Trustpilot pull, blog). Until resolved, the agent's `recall_someone_who` and `build_confidence` tools cannot rely on customer-review prose from this dump — they fall back to blog posts (parallel WP REST stream).

The Trustpilot aggregate (4.6 / 338 on the W-Trek page) is external — separate API integration if we want it, deferred to post-Puma.

---

## 13. Media asset — **URLs embedded, no asset record**

**Observed [S-INDEX]:** `image_src`, `image_srcs[]`, `image_id`, `image_pos`, all served through imgix (`https://swoop-patagonia.imgix.net/...`) with `auto=format,enhance,compress&fit=crop&w=...&h=...&q=...` params.

**Observed [S-DETAIL-JS]:** gallery + embedded YouTube-style video ("Welcome to Patagonia").

**What we need if media is to be a first-class object** (probably optional for Puma): asset_id, caption, alt text, credit, tagged-locations, tagged-activities, portrait/landscape, licensing.

---

## 14. FAQ — **Absent from feed; present on detail page as prompts**

**Observed [S-DETAIL-JS]:** three canned prompts — "Is this trip right for me?", "Include in 2–3 week itinerary", "Help with travel before/after". These are CTAs, not FAQs.

**What we probably want:** genuine FAQ records (common questions about permits, weather, fitness, money, packing) per trip or per region. Ask: does Swoop maintain FAQ copy anywhere?

---

## 15-LIVE. Tag taxonomy — `ntag` is live, `tag` is dead

**Recast 2026-04-27 (Julie call) + confirmed [S-SQLDUMP-2026-04-27] §S7:**

- **`tag` table**: 2,374 rows but **DEAD per Julie ruling**. `tag_trip` join has only 251 rows. Decision C.17 — ignore entirely.
- **`ntag` table**: 79 rows, **the live taxonomy**. Polymorphic links via `ntags_lookup` (157,537 rows) with shape `(entity_type, entity_id, tag_id)`.

**`ntag` types and counts (per S7):**

| Type | Count | Examples |
|---|---|---|
| `interest` | 27 | Whales, Photo, Wine, Volunteer, Sightseeing, Food, W Trek, O Circuit, Perito Moreno, Pumalin, Chiloe, Cerro Castillo, San Rafael, Queulat, Futa, Patagonia Park, Huemul Circuit, Navarino, San Martin, Bariloche, Ushuaia |
| `area` | 21 | Argentinian Lakes, Aysen, Glaciares, Tierra del Fuego, Chilean Lakes, Torres del Paine, Welsh Patagonia, Atlantic, Easter Island, Falklands, Iguazu, Buenos Aires, Valdes, Ruta 40, Atacama, Santiago, Antarctica, Fjords, Mendoza, Multi-region tour, Valparaíso |
| `activity` | 17 | Kayaking, Trekking, Scuba, Mountaineering, Skiing, Rafting, Climbing, Biking, Fishing, Horseriding, Ice Hike, Wildlife, Excursions, Zodiac, Multi-activity |
| `trip-type` | 7 | Guided Activity, Property Based |
| `style` | 7 | Ship |

**`ntags_lookup.entity_type` distribution:**

| entity_type | rows | Agent-relevant? |
|---|---|---|
| `enquiry` | 147,959 | NO — customer queries; PII; excluded from agent surface |
| `image` | 4,491 | YES — images carry tags directly; useful for `illustrate` retrieval |
| `trip` | 2,973 | YES — primary trip taxonomy |
| `response` | 1,103 | NO — operational |
| `partner` | 622 | NO — operational |
| `contentblock` | 255 | YES — CMS prose tagged |
| `video` | 134 | YES — video assets |

**ETL action**: include `ntag` + filtered `ntags_lookup WHERE entity_type IN ('image', 'trip', 'contentblock', 'video')` in `export.sql`. Skip `enquiry` lookups (PII surface).

**Open question routed to Thomas/Richard during C.t3**: are these 79 ntags the complete live taxonomy, or do new ones land regularly? Most have `created` dates in 2018-11-29 with a few additions through 2025-10-13 (`Valparaíso` is the most recent). Stable enough for hard-coded ETL.

---

## 15. Tag taxonomy — original public-feed observation (deprecated upstream)

The `tags` object on every record plus the top-level `tags` block enumerate the vocabulary. Five tag types:

### `area` (15 values)
Torres del Paine, Los Glaciares, Tierra del Fuego, Multi-region tour, Chilean Lakes, Aysen, The Fjords, Santiago, Argentinian Lakes, Buenos Aires, Atacama, Valdes, Iguazu, Easter Island, Antarctica.

### `activity` (12 values)
Excursions, Trekking, Multi, Wildlife, Zodiac, Horseriding, Kayaking, Biking, Road Trip, Multi-activity, Mountaineering, Rafting.

### `style` (7 values) — accommodation category
Hotel, Luxury, Camping, Glamping, Ship, Refugio, Estancia.

### `trip-type` (7 values) — product format
Guided Activity, All Inclusive, Private, Group Tour, Cruise, Independent, Property Based.

### `interest` (23 values) — sub-theme
Day Hike, Exped/OBT, Ushuaia, W Trek, Penguin, Perito Moreno, Sightseeing, Whale, Cerro Castillo, San Rafael, Chiloe, Puma, Winter, Patagonia Park, O Circuit, Huemul Circuit, Pumalin, Photo, Navarino, Bariloche, plus long-tail.

Parent-child relationships exist (top-level `tags` block shows e.g. `Trekking → Day Hike / W Trek / O Circuit`; `Torres del Paine → W Trek / O Circuit / Puma`).

### Scale-type fields (0–5)
`difficulty` (0–5 in [S-SQLDUMP-2026-04-27]) and `wilderness` (0–5) on `trip` are raw integers. **No in-DB legend** — the `adventurousness` table (11 rows) is *not* the legend (see §16-LIVE below). Per Julie call, this stays raw — agent surfaces "ruggedness 4/5" or similar without trying to map to user-facing words at ETL time.

### Filters exposed on the Trip Finder
`activity`, `area` (location), `trip-type`, `priceperday`.

### Sort fields exposed
`recommended_index` (default), `bookings_count`, `wilderness`, `base_price` (both directions), `duration` (both), `difficulty` (asc only).

---

---

## 16-LIVE. `tripvariant` (operational versioning, exclude from agent surface) — [S-SQLDUMP-2026-04-27] §S3

584 rows; 279 of 852 trips have at least one variant. Sample shape:

```
id | trip_id | title              | state    | notes | created             | created_by_id
115|     456 | NULL               | retired  | NULL  | 2023-02-01 14:00:31 |         17895
117|     639 | NULL               | draft    |       | 2023-02-01 14:02:32 |         17895
118|     675 | El Calafate→Chalten| retired  | NULL  | 2023-02-01 14:15:50 |         22860
596|     391 | Version 1 Nick Hill| active   | NULL  | 2022-07-12 10:20:14 |         31382
```

**Verdict**: operational draft/version-management for trip records, NOT visitor-facing variants. `state` is one of `draft` / `active` / `retired`. The 20-variant trip (id 675) carries 19 retired drafts + 1 active.

**ETL action**: skip the `tripvariant` table entirely. Only relevant if we ever want author-attribution on revisions, which we don't for Puma. The day-by-day data sometimes references `tripvariant_id` — see §5 for how that interacts.

---

## 17-LIVE. `season` (annual fiscal-year periods, back-office only) — [S-SQLDUMP-2026-04-27] §S4

12 rows. Each row is a fiscal-year period running 1 Sept → 31 Aug:

```
id | title              | short_title | start_date          | end_date
 3 | 2017 - 2018 Season | 17/18       | 2017-09-01          | 2018-08-31
 4 | 2018 - 2019 Season | 18/19       | 2018-09-01          | 2019-08-31
 …
14 | 2025 - 2026 Season | 25/26       | 2025-09-01          | 2026-08-31
15 | 2026 - 2027 Season | 26/27       | 2026-09-01          | 2027-08-31
12 | Undecided          | Undecided   | NULL                | NULL
```

**Verdict**: operational booking-year scoping (`enable_webinars` flag suggests season-tied marketing campaigns). Not the marketing-seasonality concept the public-feed inspection guessed (peak/shoulder/off-peak). **Excluded from agent surface.** If we want broad weather-seasonality language ("November–February for stable Patagonia weather"), that's hand-authored content in `cms/`, not ETL'd from `season`.

---

## 18-LIVE. `adventurousness` — DEPRECATED parallel-style classifier, NOT the difficulty/wilderness legend

[S-SQLDUMP-2026-04-27] §S2 surprise: the `adventurousness` table is **not** a difficulty/wilderness legend at all. 11 rows, all with `rating: 5` (unused). Each row names a *trip style*: Adventurous / OBT / Camping / Huts/W Trek / Day Hikes / Luxury / Winter / Group / Budget / Yurt / Independent.

Per Julie ruling: deprecated. Don't ETL it. The trip styles overlap heavily with `ntag` types `style` and `trip-type` so the live equivalent already exists in `ntag`.

`trip.difficulty` and `trip.wilderness` are raw integers 0–5; the in-DB legend is gone (Julie ruling: no legend exists).

---

## 19-LIVE. Images: `image` + `file` join — [S-SQLDUMP-2026-04-27] §S10

**Two-table model:**

| Table | Rows | Role |
|---|---|---|
| `image` | 13,261 | Conceptual image record. Carries `title`, `caption`, `description` (text), `copyright`, `credit`, `quality_rating`, `resolution_rating`, `width`, `height`, `banner` flag. **No filename column** on this table directly. |
| `file` | 135,807 | Physical-file table. Image rows reach a `file` row via `image.image_id → file.id` (FK constraint `c_fk_image_image_id`). `file.name` carries the filename (e.g. `Funnykayak.jpg`, `Acon_height.JPG`). `file.path` is the legacy CDN base (`http://images.swoop-patagonia.com`) — pre-imgix. |

**Image text-field population (per [S-SQLDUMP-2026-04-27] §S10):**

| Field | Coverage |
|---|---|
| `title` | 13,215 / 13,261 (99.7%) |
| `description` | 6,296 / 13,261 (47.5%) |
| `caption` | 4,671 / 13,261 (35.2%) |

`title` is near-universal so it's a reasonable first-pass alt-text source. `description` covers ~half. **Action for C.t6 (image annotation)**: where `description` is populated, prefer it over a fresh Claude Vision pass; for the ~50% gap, run vision. Cuts ~£100 of the £100–£300 annotation budget.

**File extensions across all 135,807 `file` rows:**

| extension | count | use |
|---|---|---|
| (NULL) | 96,337 | Mostly the legacy migration set |
| pdf | 23,595 | Documents (booking attachments etc., NOT for agent) |
| jpg | 8,288 | Images |
| png | 4,260 | Images |
| docx | 1,843 | Documents (NOT for agent) |
| jpeg | 991 | Images |
| heic | 93 | Images |

The agent-relevant subset is `image` rows whose linked `file.extension IN ('jpg', 'png', 'jpeg', 'heic')` (or whose `file.type LIKE 'image/%'`).

---

## 20-LIVE. URL & image construction rules — [S-SQLDUMP-2026-04-27] §S8 + §S9

### Page URL construction (`canonical_url`)

```
canonical_url = "https://www.swoop-patagonia.com/" + (override_url || alias)
```

Applies to any record with both columns: `trip` (852 rows; 100% have alias, 67% have override_url), `page` (684 rows; 100% have alias, 91% have override_url), `hotel` (has alias), `location`, `tour`. Always-fallback to `alias` works.

ETL writes a derived `canonical_url` column on each entity that supports deep-linking, so callers never have to apply the rule themselves.

### Image URL construction

```
image_url(file.name, variant) = "https://swoop-patagonia.imgix.net/" + file.name + "?" + render_params(variant)
```

Where `render_params(variant)` controls sizing/format:

| Variant | Use case | Example params |
|---|---|---|
| `thumb` | Inline mentions, list-item icons | `auto=format,enhance,compress&fit=crop&w=200&h=160&q=70` |
| `hero` | Widget hero images | `auto=format,enhance,compress&fit=crop&w=500&h=400&q=80` |
| `detail` | Detail-page large displays | `auto=format,enhance,compress&fit=crop&w=1200&h=800&q=85` |

The dump's `file.path` field stores the *legacy* CDN domain (`http://images.swoop-patagonia.com`) — **don't use it**. The imgix transformation is a website-runtime concern; we apply it ourselves at ETL or read time.

### Page-as-hub traversal

For records that don't carry images directly (e.g. `hotel`, `location`), traverse via `page_id`:

```
images_for(record) =
  if record has direct image join (e.g. image_trip):
    return image_trip.images
  else if record.page_id is set:
    return image_page.images for record.page_id
  else:
    return [] (no images)
```

[S-SQLDUMP-2026-04-27] §S8 confirms:
- `image_trip`: 3,361 rows (trips have direct image joins)
- `image_page`: 453 rows (pages do too)
- No `image_hotel` table — hotel images come strictly via `hotel.page_id → page → image_page`.

Also exists: `image_location` (per S8 listing), `image_tag`, `image_month` (empty).

**General principle**: `page` is the **presentation hub**. Many records point at one shared `page` (e.g. trips 1052 + 1053 both link to page 3 = `argentina/welsh-patagonia`). Image sets and prose blocks attached to a page apply to all records hubbed there.

---

## Pricing semantics — RESOLVED 2026-04-27

**Final stance per Julie call + decision C.14:**

- **Use only `trip.base_price`**, currency-normalised against `currency.iso_3` (looking up `trip.currency_id`).
- **Currency mapping (confirmed [S-SQLDUMP-2026-04-27] §S1)**: `1=GBP`, `2=USD`, `3=EUR`, `4=AUD`, plus 5=CLP, 6=ZAR, 7=ARS, 8=NZD, 9=CAD, 10=NOK, 11=DKK.
- **Ignore** `raw_price` (website-runtime calc), `window_price` (website-runtime calc), `cabin_price` / `cabin_original_price` (cruise-runtime). All produce numbers we can't safely surface without re-implementing the website's runtime price logic.
- **No `formatted_base_price`** synthesis at ETL — agent emits "from £X / $X / €X" using `currency.iso_3` directly.
- **No occupancy adjustment**, **no seasonality bands**, **no group-size discount logic**. Anything beyond the headline is a specialist conversation.

The four original questions in this section close per the above:
1. ✅ Currency mapping.
2. ✅ `raw_price` divergence — irrelevant; `raw_price` is excluded.
3. ✅ `window_price` — irrelevant; excluded.
4. ✅ `raw_price` occupancy basis — irrelevant; excluded.

---

## Ask list — most rows resolved 2026-04-27/29

Substantially reshaped after the dump landed + Julie call. Surviving asks below:

| # | To answer... | We need... | Status |
|---|---|---|---|
| 1 | ~~"When can I go? What's available in December?"~~ | ~~Departures table~~ | **OUT OF SCOPE** (decision C.14, no departures surfaced) |
| 2 | ~~"What does the W-Trek cost in GBP with a single supplement?"~~ | ~~Full pricing matrix~~ | **OUT OF SCOPE** (decision C.14, headline `base_price` only) |
| 3 | "What does each day involve?" | `daybyday` rows where `type='presale'` and `trip_id IS NOT NULL` | **In dump but sparse** — see §5. Confirm with Swoop ops the website indeed renders presale rows. |
| 4 | "Where am I staying?" | `hotel` (with `page_id`-traversed images), `vessel` + `cabin` (cruise) | **In dump.** Hotel has prose: `why_we_like`, `what_we_dont_like`, `rooms_and_pricing_description`. |
| 5 | "How does this compare to the O Circuit?" | Shared attrs across trips | **In dump.** `compare_paths` composer (C.t4) builds prose-led comparisons over shared columns. |
| 6 | "What's included? What's not?" | `trip.includes`, `trip.excludes` text columns | **In dump** as text fields. HTML formatting; ETL parses. |
| 7 | "Which cruise ship? What cabin?" | `vessel`, `cabin`, `cabintype` tables | **In dump** — Antarctica sequel scope; light Patagonia use. |
| 8 | ~~"Who's my Swoop specialist?"~~ | ~~Swooper records~~ | **OUT OF SCOPE** (PII; generic specialist persona only — decision C.14). |
| 9 | "What do reviewers say?" | `customerreview` / `customertip` source tables | **MISSING from dump** — junction tables exist (2,390 + 119 rows) but the underlying prose tables aren't in the export. **Open question for Thomas/Richard.** Fall back: blog posts. |
| 10 | "Can I add a Perito Moreno glacier day to my trip?" | Activity catalogue with add-on pricing | **Partial** — `activity` exists as first-class entity (per first-pass enumeration); add-on pricing not surfaced. Not blocking Puma. |
| 11 | "Will I have good weather in October?" | Region-by-month seasonality | **Hand-author in `cms/`** — no need for Swoop data. |
| 12 | "What's the airport / transfer plan?" | Transport segments | **Specialist's job** — out of agent scope. |
| 13 | "What's the cancellation policy?" | T&Cs blob | **Specialist's job** — out of agent scope. |

**If we can only ask Swoop ops for one more thing**, it's clarification on **#9: are the `customerreview` and `customertip` source tables intentionally missing from this export, or is the data elsewhere?**

---

## Open questions for Swoop — most resolved 2026-04-27/29

The original 10 questions:

1. ✅ Replaced by SQL dump (no need for additional endpoints).
2. ✅ Dump is the canonical source (Julie call).
3. ✅ Currency mapping closed by [S-SQLDUMP-2026-04-27] §S1.
4. ✅ Resolved differently than expected — `adventurousness` is deprecated, no in-DB legend, raw integers (Julie call).
5. ✅ `swooper_*` are customer PII fields (Julie call) — not staff.
6. ✅ Out of scope (decision C.14, no departures).
7. ✅ In dump (`vessel`, `cabin`, `cabintype`).
8. ✅ In dump (`hotel` with prose fields + `hotel_pricing` + `hotel_room`).
9. ⚠️ **Still open**: per-trip review prose tables `customerreview`/`customertip` are missing from dump. Route to Thomas/Richard.
10. ✅ N/A (no API; SQL dump path).

**Open follow-ups raised by C.t0 SQL inspection** — track in `questions.md`:

- **`customerreview`/`customertip` source tables MISSING from dump** — see §12. Action: Thomas/Richard.
- **`daybyday` ETL filter** — the canonical filter is `type='presale' AND trip_id IS NOT NULL AND deleted IS NULL`, but only 12,415 rows match (no active variants link to presale). Confirm the website renders these rows.
- **`ntag` operational meaning** — Julie didn't fully know. 79 entries / 5 types / used cleanly per `ntags_lookup`; meaning of individual tags is mostly self-evident (areas/activities) but some interest tags need confirming.

---

## How to extend this doc

- Every time we inspect a new endpoint / feed / CMS area, add a new **source tag** at the top and new rows under the affected entities.
- When a Swoop dev confirms a field meaning, remove the "guess" / "unconfirmed" annotation.
- Promote "Implied" entities to "Observed" as soon as we see them.
- Resolved questions move to the bottom / out to `questions.md` closed.
