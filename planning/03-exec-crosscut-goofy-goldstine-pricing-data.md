# 03 — Execution: Crosscut — Pricing data (hotel-pricing ingest + `get_pricing` raw-matrix tool + §5 staleness guardrails)

> **Status**: DRAFT — pending HITL ratification of this document. The load-bearing design calls were made by Alastair in the 2026-06-11 HITL session (worktree `goofy-goldstine-2ed1c1`); see the ratification appendix at the bottom. Decision IDs proposed `C.goofy-goldstine-{1..}` (wave-named per the 2026-05-13 parallel-author collision discipline; numeric ids TBD on merge).
>
> **Back-links**: [2026-06-10 Luke Loom ledger items D1/D2/D5](reviews/2026-06-10-luke-loom-feedback.md) (stale prices / Product-Library deferral / budget-query-returns-Explora), [2026-06-11 widget-emptiness diagnosis](reviews/2026-06-11-widget-emptiness-diagnosis.md) (M1 zero-trap context), [retrieval-provenance plan execution log §5](03-exec-crosscut-magical-poincare-retrieval-provenance.md) (the D5 probes that found `hotel_pricing` empty), [decision C.14 — headline pricing only](decisions.md).
>
> **Workspaces touched**: `@swoop/ingestion` (sql-transform + compose), `@swoop/connector` (migration, query-hotels, new tool), `@swoop/common` (tool schema), `cms/prompts/` (system §5 + new tool description), `@swoop/orchestrator` (tool registration pins).
>
> **Pairs with**: [03-exec-crosscut-goofy-goldstine-find-options-reshape.md](03-exec-crosscut-goofy-goldstine-find-options-reshape.md). **Merge this plan first** — both add a tool, so registration lists and tool-count test pins collide; the reshape plan rebases on this one.

---

## ★ Read this first — verified facts this plan stands on (all probed 2026-06-11)

1. **Trips already carry prices.** Decision C.14 (Julie, 2026-04-27) was "headline `trip.base_price` only", not "no prices". `trip_card.from_price` is populated on 464/649 cards and displayed by the TripCard widget. Nothing trip-side needs ingesting; this plan's data work is hotels.
2. **The 2026-04-27 dump contains a structured, current-season hotel pricing matrix that the ETL never loads.** Source tables: `hotel_pricing` (239 rows: hotel × roomtype × nights), `hotel_pricing_prices` (1,051 rows: price per season), `hotel_seasons` (108 rows, titles like "2025/26 low"), `roomtype` (97 rows). 26 of 44 kept hotels are priced. `hotel.currency_id` carries the currency.
3. **The consuming plumbing already exists and is starved.** puma_dev's `hotel_pricing` table (migration 002: `id, hotel_id, room_id, season, price, currency_code`) has 0 rows. [query-hotels.ts](../product/connector/src/data/query-hotels.ts) computes `from_price = MIN(hp.price)` and budget-filters via HAVING — currently a complete no-op (the Explora-on-a-budget-query case, ledger D5). `HotelProposalCardSchema.pricingUnit` is hard-coded `'per_night'`.
4. **The nights trap.** Source prices are per *package* of 1–6 nights (distribution: 18×1n, 29×2n, 65×3n, 62×4n, 41×5n, 23×6n). The puma_dev flatten has no `nights` column, so a naive load makes `MIN(price)` mislabel a 5-night package as a nightly rate. A wrong-by-5× price is worse than no price. This plan keeps `nights` raw and derives per-night only at the query/display boundary.
5. **`transformHotel` drops the hotel prose.** `why_we_like`, `what_we_dont_like`, `rooms_and_pricing_description` exist in source (populated, HTML with WYSIWYG style-attribute spam) and are discarded (`description: null`). `query-hotels.ts` already selects `h.description AS vibe_line_source` — populating it lights that up.
6. **No fresh dump is available** (Alastair, 2026-06-11). All prices are as-of 2026-04-27; the staleness guardrails (§2.5) therefore carry full weight, and the captured-at date is a config constant, not a per-ingest variable, until the weekly-dump cadence resumes (questions.md "Data pipeline" Q13).
7. **The canonical costs page is unreachable by `lookup`.** Page 723 "Patagonia travel costs explained" (`/visit/costs`) has 15 contentblocks in domain tables and 9 passages in `inspire_passage` (one literally lorem ipsum), but **0 rows in `inform_chunk`** — the table `lookup` searches. Meanwhile the undated FAQ "How much does hiking in Patagonia cost?" (faqitem 232, source of Luke's $300–350/day incident) is the top retrieval hit for cost questions. The §5 steering rule cannot work until this is fixed (§2.6).
8. **Raw-data-to-the-agent is the ruling design principle** (Alastair, 2026-06-11): faithful flatten, no ETL-time normalisation guesses; interpretation happens at conversation time where context disambiguates. The `get_pricing` tool returns the matrix as Swoop authored it.

## 1. Outcome

After this lands:

- `puma_dev.hotel_pricing` carries ~1,051 flattened rows (price per hotel × room × season × nights, currency-resolved); `hotel_room` carries the per-hotel room catalogue.
- Hotel cards show "from $X / night" (per-night MIN, honestly derived) for the 26 priced hotels; the `budgetBand` filter actually filters — a budget-band hotel query can no longer surface the Explora.
- A new `get_pricing` tool (tenth tool) gives the agent the raw pricing matrix on demand, scoped by hotel ids / region / trip ids, full-matrix fallback, every response stamped `capturedAt`.
- §5 of the system prompt gains the three remaining staleness guardrails: as-of awareness, a proactive "prices are dynamic" line whenever a figure is given, and top-end generosity on agent-constructed ranges.
- Cost-shaped `lookup` queries can retrieve the costs page instead of only the stale FAQ.
- `trip_card.from_price = 0` rows are nulled (1 observed) — zero is a data bug, not a price.

## 2. Target functionalities

### 2.1 Migration — `nights` on `hotel_pricing` (forward-only idempotent)

New migration `product/connector/migrations/0NN_hotel_pricing_nights.sql` (next free number at execution):

```sql
ALTER TABLE hotel_pricing ADD COLUMN IF NOT EXISTS nights INTEGER;
COMMENT ON COLUMN hotel_pricing.price IS
  'Package price for `nights` nights in `season` for `room_id`, in `currency_code`, exactly as authored in the Swoop CMS. NOT per-night. Per-night derivation happens at read time (price::numeric / nights).';
```

Update `migrate.test.ts` migration-manifest pin (the predicted-conflict file — see the cross-plan note in the header).

### 2.2 ETL — load the pricing chain + hotel prose (`@swoop/ingestion` sql-transform)

**New parsed tables** in [run.ts](../product/ingestion/src/sql-transform/run.ts) `COLS`: `hotel_pricing` (id, hotel_id, roomtype_id, nights), `hotel_pricing_prices` (id, hotel_pricing_id, hotel_season_id, price), `hotel_seasons` (id, hotel_id, title, season_type), `roomtype` (id, title, maximum_occupancy, deleted). Add `currency_id`, `why_we_like`, `what_we_dont_like`, `rooms_and_pricing_description` to the existing `hotel` column list.

**`transformHotelRoom`** — synthesise per-hotel rooms from the distinct `(hotel_id, roomtype_id)` pairs appearing in source `hotel_pricing`:
- `id = hotel_id * 1000 + roomtype_id` (deterministic for idempotency; hotel ids < 100, roomtype ids < 1000 — assert both bounds at transform, fail loud if violated).
- `name = roomtype.title`, `capacity = roomtype.maximum_occupancy`, `description = NULL`. Respect `roomtype.deleted` via the existing `isDeleted` helper.

**`transformHotelPricing`** — one target row per `hotel_pricing_prices` row:
- `id = hpp.id`; `hotel_id` via parent `hotel_pricing`; `room_id` = the synthetic hotel_room id above; `nights` from parent; `season = hotel_seasons.title` (NULL when `hotel_season_id` is NULL — flat-rate rows exist); `price = hpp.price`; `currency_code` via `hotel.currency_id → lookups.currencyById` (same lookup `transformTrip` uses).
- Drop rows whose parent hotel was dropped (deleted) — mirror the existing FK-drop guard pattern.

**`transformHotel` prose carry** — `description` becomes labelled markdown assembled from the three prose fields, each passed through `trimCmsDecorativeWhitespace` plus a new strip for inline `style="…"` attributes (the Tailwind-spam pattern verified on hotel 1 "Patagonia Camp"):

```
**Why we like it**\n<cleaned why_we_like>\n\n**What we don't like**\n<cleaned what_we_dont_like>\n\n**Rooms & pricing**\n<cleaned rooms_and_pricing_description>
```

Sections whose source field is empty are omitted. Raw-data principle: keep Swoop's own candid wording (including `what_we_dont_like` — it's the Candid & Trustworthy pillar in data form).

**Zero-price hygiene** — in `transformTrip`, `base_price` parsing maps `0` to `null` (one `trip_card` row observed at `from_price = 0.00`; zero is not a price).

### 2.3 `query-hotels.ts` — per-night derivation + recalibrated ceilings

- `from_price` becomes `MIN(hp.price::numeric / NULLIF(hp.nights, 0))` (⚠ integer division — `price` is INT in source; cast before dividing). Round at projection (`ROUND(…, 0)`) — "from $907/night" precision is false precision.
- `BUDGET_CEILING` in query-hotels is currently trip-scale (2_000/5_000/10_000 GBP mirror). Recalibrate to per-night scale — rough-cut `{budget: 400, mid: 800, premium: 1500, luxury: ∞}`, **then calibrate against the loaded data's quartiles at execution** (probe in §5) before pinning. Keep the NULL-tolerant HAVING shape for unpriced hotels (18/44) — the find_options description (owned by the reshape plan) tells the agent unpriced cards carry no price line.
- `vibe_line_source` now receives real prose; verify the card composition's truncation handles multi-section markdown (take the first section's first sentence — check the existing vibe-line derivation and mirror it).

### 2.4 `get_pricing` — tenth tool, raw matrix, scoped

**Schema** (`@swoop/common`, [tools.ts](../product/ts-common/src/tools.ts)):

```typescript
GetPricingInputSchema = z.object({
  target: z.enum(['hotel', 'trip']),
  ids: z.array(z.number().int().positive()).max(20).optional(),   // scope by entity ids
  region: z.string().optional(),                                   // or by region (ILIKE, same semantics as find_options)
}).strict();
// No ids AND no region → full-matrix fallback (legitimate: 26 priced hotels; ~8–15K tokens).

GetPricingOutputSchema = z.object({
  capturedAt: z.string(),                       // ISO date the source data was captured (config, §2.5)
  hotels: z.array(z.object({
    id: z.number(), name: z.string(), location: z.string().nullable(),
    currencyCode: z.string().nullable(),
    rows: z.array(z.object({
      room: z.string(), season: z.string().nullable(),
      nights: z.number().int().nullable(), price: z.number(),    // package price, AS AUTHORED
    })),
  })).optional(),
  trips: z.array(z.object({
    id: z.number(), title: z.string(),
    fromPrice: z.number().nullable(), currencyCode: z.string().nullable(),
  })).optional(),
}).strict();
```

**Handler** `product/connector/src/tools/get_pricing.ts` — plain SQL joins (`hotel_pricing × hotel_room × hotel`, or `trip_card` projection for trips), no embeddings, no interpretation. Region scoping reuses the location/area join shape from query-hotels (hotels) and `trip_card.region ILIKE` (trips).

**Description** `product/cms/prompts/tools/get_pricing/description.md` — the teaching surface, written to the schema-as-validator / prose-as-teacher pattern (G.11). Must teach:
- *Semantics*: hotel prices are **package prices for N nights**, per room type, per season, in the hotel's own currency, exactly as Swoop's website authored them. Trip prices are headline "from" prices.
- *Arithmetic transparency*: deriving per-night is fine — show the working in prose ("that's a 3-night package, so roughly $X a night").
- *Staleness*: every response carries `capturedAt`; figures are indicative as of that date; pair any figure with the dynamic-prices line (§2.5).
- *Scoping*: prefer ids/region scope; full-matrix is allowed but costs context — use when the conversation is genuinely comparative.
- *When to reach for it*: visitor pushes past band-level cost talk into "what does X actually cost"; accommodation comparisons; budget-shaping conversations.

**Registration**: connector tool list + orchestrator auto-pickup via `loadAllToolDescriptions`. Update every tool-count pin (boot-log gates assert "9 tools" / "8 exposed to model" in tests — grep `tools: 9` and the registration fixtures; the B.t3a lesson about `as Config` fixtures applies).

### 2.5 §5 prompt additions (`product/cms/prompts/system/00_why.md`)

Three additions to the existing pricing rules block (the four 10-Jun sub-rules stay untouched):

- **As-of awareness**: figures from tools come from Swoop's website data captured on the date the tool response carries (`capturedAt`). Treat that as the figure's birthday, not today.
- **Dynamic-prices line (MUST)**: any turn that gives a figure or band carries, once, a natural-phrasing version of: *"prices are dynamic — your **Swoop Planning Specialist** confirms the current number."* Once per turn, not per figure; never robotic boilerplate.
- **Top-end generosity (SHOULD)**: when constructing a range from data, round the top up generously — never present the corpus maximum as the market maximum; prices move upward between data captures. (This is requirement (a) from the HITL session: expand upper bounds to allow for increases since capture.)

`PRICES_CAPTURED_AT` lands in connector config (env, default `2026-04-27`), surfaced through `get_pricing` responses. When a fresh dump eventually arrives, one env change updates the stamp.

### 2.6 Costs page → `inform_chunk`

Extend the `swoop_practical` emitter in [inform-chunk.ts](../product/ingestion/src/enrich/compose/inform-chunk.ts) (provenance `'swoop_practical'`, currently 18 rows) so page 723's contentblocks chunk into `inform_chunk` with `canonical_url`, `source_title`, and topic tags. At execution: first diagnose **why** the existing emitter skipped it (page-type allowlist? explicit id list?) — fix the class if it's a class gap, the instance if it's an instance gap, and log which in the execution log. Add a **lorem-ipsum guard** to the compose pass (`/lorem ipsum/i` → skip + WARN) — one live lorem block verified on the costs page's `inspire_passage` rows; apply the same guard there.

## 3. Decisions (proposed)

- **C.goofy-goldstine-1** — Hotel pricing matrix ingested from the existing dump; faithful flatten keeping `nights`/`season`/currency raw; no ETL-time normalisation. Partially relaxes C.14's "headline pricing only" for hotels; everything surfaced is data the public website displays. C.14's exclusions of `raw_price`/`window_price`/`cabin_*`/departures stand.
- **C.goofy-goldstine-2** — Hotel cards carry `fromPrice` as per-night MIN derived at query time; package prices are never stored as per-night. (HITL: "as you recommend".)
- **C.goofy-goldstine-3** — `get_pricing` raw-matrix tool, scoped with full-matrix fallback, every response stamped `capturedAt`. Interpretation moves to conversation time per the raw-data principle.
- **C.goofy-goldstine-4** — `PRICES_CAPTURED_AT` is connector config (default 2026-04-27); no fresh dump assumed.
- **C.goofy-goldstine-5** — Hotel prose carried as labelled markdown in `hotel.description`, including `what_we_dont_like`.
- **G.goofy-goldstine-1** — §5 gains as-of awareness + once-per-turn dynamic-prices line + top-end generosity.

## 4. Out of scope (deliberate)

- **Product Library ingestion** — parked per the production-first deferral (questions.md; Luke email pending). This plan is the in-fence alternative, not a step toward it.
- **Tour prices** — no in-dump source; deriving from child trips is C.14's calculated-figures territory. Waits on the 4-Swoop-Group-Tours ask (questions.md) where four headline prices can simply be provided.
- **FX conversion / display normalisation** — prices display in authored currency. Known limitation: trip `BUDGET_CEILING` compares GBP-scale ceilings against mixed-currency `from_price` (38 CLP-priced trips mis-band). Order-of-magnitude posture accepted; revisit only if harness evidence says it bites.
- **Email/Julie comms** — Alastair handles outside this plan (HITL: "don't worry about the email").

## 5. Verification (acceptance gates)

1. **Coverage probes** (the standing rule — before *and* after): `SELECT COUNT(*) FROM hotel_pricing` (expect ~1,051); `SELECT COUNT(DISTINCT hotel_id) FROM hotel_pricing` (expect 26); `hotel_room` non-empty; `SELECT COUNT(*) FROM hotel WHERE description IS NOT NULL` (expect ≳ 26 — probe source population first); zero `trip_card.from_price = 0` rows.
2. **Per-night sanity**: spot-check 3 hotels' derived per-night MIN against the website's displayed hotel pricing (e.g. Patagonia Camp, Hotel Las Torres, Explora) — the per-night figure must be plausible against the public page, not 3–5× off (the nights trap's signature).
3. **The Explora probe**: `find_options {preferredType:'hotel', budgetBand:'budget', region:'Torres del Paine'}` live against `puma_dev` — Explora must not appear; at least one priced budget-band hotel must.
4. **Ceiling calibration probe**: quartiles of derived per-night prices; pin `BUDGET_CEILING` against them; record in the execution log.
5. **Real-Anthropic single-turn smoke** (mandatory — tools array changes): one live turn where Sonnet calls `get_pricing` and the response parses; boot log shows 10 tools.
6. **`lookup` retrieval probe**: cost-shaped query returns costs-page chunks alongside/above the FAQ row; chunk carries `canonicalUrl` + `sourceTitle`.
7. **Fresh-install verification** at the merge tip (the false-green lesson): `rm -rf node_modules && npm install && npm test --workspaces`.

## 6. Estimate

~1 day: migration + ETL + tests (½ day), tool + description + prompt additions (¼ day), costs-page compose fix + probes + smokes (¼ day).

---

## Appendix — 2026-06-11 HITL ratification record (conversation summary)

Calls made by Alastair in the goofy-goldstine session, recorded verbatim-in-spirit:

1. Hotel cards carry per-night "from" price — *"as you recommend"*.
2. The pricing track is separable from the find_options reshape; both get T3 plans before implementation.
3. No email/Julie dependency in this plan.
4. **No fresh dump available** — plans work from the 2026-04-27 capture; `capturedAt` is config.
5. Raw-data principle (Alastair): *"I prefer solutions that provide raw data to the agent rather than prepared programmatic efforts. That way, valuable nuance survives."* — the design root for `get_pricing`'s as-authored matrix and the nights-stay-raw flatten.
6. Guardrails specified by Alastair at session open: (a) expanded upper bounds on ranges to allow for price increases since capture → §2.5 top-end generosity; (b) active "prices are dynamic" warning, current price via **Swoop Planning Specialists** → §2.5 dynamic-prices line.
