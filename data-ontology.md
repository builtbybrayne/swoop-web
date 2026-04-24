# Swoop data ontology — what exists, what's missing

Reference view of the Swoop Patagonia data we've been able to inspect so far, the record types it implies, and what's clearly absent. The point of this doc is to let us write a precise "please give us access to X, Y, Z" ask to Swoop engineering rather than a vague "we need more data".

## Sources inspected

| Tag | Source | Notes |
|---|---|---|
| **[S-INDEX]** | `https://www.swoop-patagonia.com/trips/get_trip_finder_data` — JSON feed behind the Trip Finder listing. Saved snapshot at `~/Downloads/get_trip_finder_data.html`. | 119 records (111 trips + 8 tours), plus filter / sort / tag vocabularies, plus global price ceilings. This is the index/catalogue view. |
| **[S-DETAIL-HTML]** | `https://www.swoop-patagonia.com/chile/torres-del-paine/hiking/w-trek/original` — server-rendered HTML as returned by WebFetch. | Shell only. Missing everything JS-populated (itinerary, departures, prices & departures table, difficulty visualisation, includes/excludes). |
| **[S-DETAIL-JS]** | Same URL, as seen in the browser screenshot. | Fully rendered — reveals day-by-day itinerary, a departures table with dated rows + GBP prices, includes/excludes/additional-notes panels, video, trust badges, B Corp block. |
| **[REUSE-POC]** | `chatgpt_poc/product/cms/` content files from the Apps SDK prototype. | Not freshly re-read for this doc — referenced for where we already hand-modelled cruises/ships/activities. |

Every attribute below is tagged with the source it came from.

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

**Definition:** an individual experience of 2–12+ days, e.g. *The Original Torres del Paine W Trek*, *Ushuaia 4-day excursion*, *Perito Moreno ice-hike day*. 111 trip records in [S-INDEX].

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

## 3. Departure — **Absent from feed, Observed on detail page**

**Definition:** a specific dated instance of a Trip that can be booked.

**Observed on [S-DETAIL-JS]:** a table with columns *availability indicator, departure date (e.g. `15-NOV-2025`), price (`£2,191`), CTA*. Toggle between "Flexible Dates" and "Fixed Dates". Month-chip filters (Nov 2025 / Dec 2025 / Jan 2026). From/To date range filter. Single-supplement note at table footer.

**What we need** (not in any data we've touched):
- `departure_id`
- `trip_id` FK
- `start_date`, `end_date`
- `price` per currency, per occupancy (single/twin-share)
- `availability_status` (enum: available / limited / waitlist / full)
- `spaces_remaining` (optional)
- `group_size` min/max for that departure
- `is_fixed_date` vs. `is_flexible`
- `single_supplement`
- `discounts` / `promotion_tags`

**This is priority gap #1.**

---

## 4. PricePoint — **Implied**

Prices in [S-INDEX] are a flattened snapshot. What actually exists commercially:

- Currency conversion (USD / GBP / EUR at least — currency_id 1/2/4)
- Seasonality pricing (peak / shoulder / off-peak)
- Occupancy basis (single, twin, triple)
- Room / cabin tier (standard / premium refugio, inside / ocean-view cabin)
- Group-size bands
- Promotional / early-bird tiers (`window_price` hints at this)

**Not exposed anywhere we can see yet.**

---

## 5. Itinerary / Day — **Absent from feed, Observed on detail page**

**Observed on [S-DETAIL-JS]:** W-Trek page shows a 4-item "Operator's Itinerary" block:
1. Trek to Los Cuernos lookout — overnight *Refugio Los Cuernos*
2. Trek to French Valley — overnight *Refugio Paine Grande*
3. Trek to Glacier Grey, optional kayaking — overnight *Refugio Grey*
4. Boat trip to base of Glacier Grey, optional ice hiking

**What we need per day:**
- `day_number`
- `title` / summary
- `walk_distance_km`, `walk_time_hours`, `ascent_m`, `descent_m`
- `start_accommodation`, `end_accommodation` (FK → Accommodation record)
- `meals_included` (B/L/D flags)
- `highlights[]` (FK → Highlight records)
- `optional_activities[]` (FK → Activity records, with prices)
- `transfers` (FK → Transport segments)

**Not in feed.** Probably lives in the CMS as prose blocks or structured — Swoop would know.

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

## 11. Swooper (specialist / advisor) — **Field exists, data empty**

**Observed [S-INDEX]:** fields `swooper_first_name`, `swooper_last_name`, `swooper_avatar_src`, `swooper_says_blurb` exist on every record, **all null in this feed.**

They must live somewhere — the W-Trek page shows trust badges ("The Patagonia experts") but no named advisor on the page. The handoff-to-human flow needs a Swooper record. Ask: where is this populated? CRM? CMS sidebar? Manual?

**Required:** `swooper_id`, `name`, `photo`, `bio`, `regions_of_expertise[]`, `trips_championed[]`, contact handle.

---

## 12. Review — **Field exists, data near-empty**

**Observed [S-INDEX]:** `reviews` null on 117/119, populated on 2.

**Observed [S-DETAIL-JS]:** aggregate rating (4.6 / 338 reviews, Trustpilot) shown near title; "Read all customer reviews" link; separate reviews page.

**What we need:** per-trip review list with text, date, reviewer, rating — probably lives in Trustpilot + Swoop's internal reviews table. Aggregate stats per trip (count, mean, recency) should be trivially derivable.

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

## 15. Tag taxonomy (controlled vocabularies) — **Fully observed [S-INDEX]**

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

### Scale-type fields (1–5)
`difficulty` and `wilderness` act like ordinal tags. No legend in the feed — need Swoop to define what each level means in user-facing terms.

### Filters exposed on the Trip Finder
`activity`, `area` (location), `trip-type`, `priceperday`.

### Sort fields exposed
`recommended_index` (default), `bookings_count`, `wilderness`, `base_price` (both directions), `duration` (both), `difficulty` (asc only).

---

## Pricing semantics — partially decoded, needs confirmation

| Field | What we think it is |
|---|---|
| `min_ppd`, `middle_ppd`, `max_ppd` (top-level) | global price-per-day range for the whole listing. Observed: 0 / 1,090 / 2,190. |
| `raw_price` on a trip | "from" headline, per person, in the trip's native currency |
| `currency_id` | 1, 2, 4. Mapping unconfirmed — guess 1=GBP, 2=USD, 4=some composite. |
| `base_price` | display figure after FX/occupancy adjustment. W-Trek: raw 2,900 → base 4,119. Gap unexplained. |
| `formatted_base_price` | pre-formatted with `$`. So all final display is USD despite `currency_id` diversity. |
| `price_per_day` | `base_price / duration` |
| `window_price` | only on 21 records. Possibly promotional / limited-window price. |
| `cabin_price` / `cabin_original_price` | only meaningful for cruise trips |

**Questions to confirm with Swoop:**
1. Currency-id mapping.
2. Why `base_price` ≠ `raw_price × FX` for many records (is there a commission/markup step?).
3. `window_price` definition.
4. Is `raw_price` always single-traveller, twin-share, or lead-in?

---

## What this feed does NOT contain (the ask list)

Priority-ordered gaps Swoop engineering should know about. Framing each as "to answer question X, we need data Y":

| # | To answer... | We need access to... | Priority |
|---|---|---|---|
| 1 | "When can I go? What's available in December?" | **Departures** table: per-trip dated departures with price, currency, availability, single-supplement | **Critical for Puma** |
| 2 | "What does the W-Trek cost in GBP with a single supplement?" | **Full pricing matrix**: per-currency, per-occupancy, per-season, per-departure | **Critical for Puma** |
| 3 | "What does each day involve?" | **Itinerary / Day** records: distance, ascent, accommodation FK, meals, highlights | High |
| 4 | "Where am I staying?" | **Accommodation** catalogue (refugio / hotel / estancia / ship) with rooms, amenities, images | High |
| 5 | "How does this compare to the O Circuit?" | Structured `comparison_attributes` across trips, or enough shared attrs to do it ourselves | High |
| 6 | "What's included? What's not?" | **Includes / excludes / additional-notes** as structured lists, not prose blobs | High |
| 7 | "Which cruise ship? What cabin?" | **Vessel** + **Cabin** records as proper entities, not embedded flat fields | Medium (Antarctica sequel) |
| 8 | "Who's my Swoop specialist?" | **Swooper** records populated on the endpoint | Medium |
| 9 | "What do reviewers say?" | **Review** records per trip (or aggregate stats with recent excerpts) | Medium |
| 10 | "Can I add a Perito Moreno glacier day to my trip?" | **Activity** catalogue with add-on prices + eligibility | Medium |
| 11 | "Will I have good weather in October?" | Trip-weather / Region-weather data (seasonality per location) | Low (could model ourselves) |
| 12 | "What's the airport / transfer plan?" | Transport segments: airport, transfer, internal flight, ferry | Low (often bespoke) |
| 13 | "What's the cancellation policy?" | T&Cs blob per trip or per booking type | Low (legal) |

**If we can only ask for three things**, the order is: **Departures, Itinerary-by-day, Accommodation**.

---

## Open questions for Swoop

Track in `questions.md` under a new "Data & ontology" section:

1. **What endpoints / feeds exist besides `get_trip_finder_data`?** Is there a `get_trip_detail(id)` that returns itinerary, departures, includes/excludes for one trip? The page is clearly rendering from *something*.
2. **Is the data in this feed the same data the sales team and booking system operate on, or is there a separate source of truth?** (Sitecore? HubSpot? Airtable? a reservations platform like Rezdy / TourPlan / FareHarbor?)
3. **Currency-id → currency-code mapping.** 1/2/4 → ?
4. **What do `difficulty` 1–5 and `wilderness` 0–5 mean in user-facing terms?**
5. **Where are `swooper_*` fields populated?** The feed has them nulled — are they live elsewhere, or is the specialist mapping manual?
6. **Departures** — how are they stored? (Fixed-date calendar vs. demand-driven bespoke dates.) The page offers both tabs; what's the underlying model?
7. **Vessels and cabins** — is there a canonical catalogue, or is vessel info authored per tour?
8. **Accommodation** — is there a property catalogue, or only free-text in CMS prose?
9. **Reviews** — Trustpilot is aggregate; is there a per-trip review dataset (Swoop-owned) we can consume?
10. **API auth / rate limits / licensing** — if an API exists, what are the terms of access?

---

## How to extend this doc

- Every time we inspect a new endpoint / feed / CMS area, add a new **source tag** at the top and new rows under the affected entities.
- When a Swoop dev confirms a field meaning, remove the "guess" / "unconfirmed" annotation.
- Promote "Implied" entities to "Observed" as soon as we see them.
- Resolved questions move to the bottom / out to `questions.md` closed.
