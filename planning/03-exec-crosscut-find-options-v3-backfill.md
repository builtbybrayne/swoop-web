## 03 — Execution: Crosscut — `find_options` v3 backfill (hotels + region_bases)

**Task code**: `BF-FO-v3` (custom `backfill / find_options / v3 tranche` prefix — chosen to avoid numeric collisions with parallel Tier-3 plan authors per 2026-05-13 dispatch session).

**Task**: implement the **v3 tranche** of the `find_options` polymorphic-output crosscut. Add two new connector data primitives (`queryHotelCardsByFilter`, `queryRegionBaseCardsByFilter`); extend the `find_options` handler to dispatch to them based on `preferredType` (and, when unset, to surface a sensible mixed/blended set across the three live variants — trip / hotel / region_base). Tours (v2) remain out of scope here — gated on Swoop populating the `tour` table.

**Crosscut owner**: extends [`03-exec-crosscut-find-options-polymorphism.md`](03-exec-crosscut-find-options-polymorphism.md). Sits in `@swoop/connector` only — the contract (`@swoop/common`), UI renderers (D.t9), and tool description (`product/cms/prompts/tools/find_options/description.md`) all shipped polymorphic day-one in the v1 tranche and require no schema changes.

**Why crosscut and not a chunk-C task**: the data-primitives plus handler-dispatch work is across-cutting the eight-tool surface settled in C.t4 and the v1 contract settled in C.48–C.51. It modifies the find_options handler that lives in chunk C's territory but it follows the established crosscut-fix convention (see `planning/03-exec-crosscut-*-fix.md`). Naming it `crosscut-find-options-v3-backfill` keeps it discoverable next to v1 (`crosscut-find-options-polymorphism.md`).

**Implements**: HITL ratification 2026-05-12 (crosscut polymorphism plan §2.4 v3 tranche); user instruction 2026-05-13 (Al: "find backfill data items… The first data type handled was trips. But there's also tours and other stuff. That's not wired up yet.").

**Depends on**:
- [`03-exec-crosscut-find-options-polymorphism.md` (v1 tranche)](03-exec-crosscut-find-options-polymorphism.md) — `ProposalCardPublicSchema` (discriminated union), `HotelProposalCardSchema`, `RegionBaseProposalCardSchema`, `FindOptionsInputSchema.preferredType` — all shipping on `main` per 2026-05-12 merge. Decisions C.48–C.51.
- Migration `002_domain_tables.sql` — `hotel`, `hotel_pricing`, `area`, `country`, `location`, `page`, `trip` tables. All present and FK-correct on the dev DB; live row-counts per C.t3 (2026-05-12 psql verify): `hotel: 44`, `area: 16`, `country: 239`, `location: 764`, `page: 636/684 post-filter`, `trip: 852`.
- C.t4 closed (eight tool handlers wired). The `find_options` handler at [product/connector/src/tools/find_options.ts](../product/connector/src/tools/find_options.ts) is the dispatch point.

**Pairs with**: D.t9 widget rewrite (also merged 2026-05-13). The hotel + region_base card renderers ship as fixture-driven sub-renderers in [find-options.tsx](../product/ui/src/widgets/find-options.tsx); v3 lights them up against live data.

**Blocks**: nothing — D.t9's UI work renders against whatever the handler returns. v2 (tours) remains separately gated.

**Out of scope**:
- v2 tour data primitive (gated on Swoop populating the `tour` table — separate ask in [questions.md](../questions.md)).
- Vector retrieval for hotels / region_bases. v3 is structured SQL only; semantic match is a v4-or-later concern if the conversational data shows it's needed.
- Tool-description.md rewrites. The v1 tranche already taught Sonnet all four card variants and the per-type pricing rule. v3 may surface tone fixes after live-data smoke; iterate post-merge if so (not in this plan's scope).
- Migration changes. The schema is sufficient for v3.

**Estimate**: ~1 day TDD. Three primitive files + handler refactor + tests + fresh-install verification + live-data smoke. No HITL turns expected (the open considerations in v1's §6 don't fire on v3 — those were about tour-vs-trip discriminator ambiguity, which is v2-only).

---

## ★ Read this first — what v3 actually changes

Today's handler at [find_options.ts](../product/connector/src/tools/find_options.ts) calls one primitive (`queryTripCardsByFilter`) regardless of input. Every card it returns carries `type: 'trip'`. The `preferredType` input field is accepted but ignored (v1 schema-only per C.51).

After v3, the handler:
1. Reads `preferredType` from the input.
2. If `preferredType === 'hotel'` → routes only to `queryHotelCardsByFilter`. Returns up to `limit` hotel cards.
3. If `preferredType === 'region_base'` → routes only to `queryRegionBaseCardsByFilter`. Returns up to `limit` region_base cards.
4. If `preferredType === 'trip'` → routes only to `queryTripCardsByFilter` (today's behaviour, preserved).
5. If `preferredType === 'tour'` → routes to the trip primitive as a v2-not-ready fallback (matches the v1 contract pin in the test at line 124 of `find_options.test.ts`). When v2 lands, this branch swaps to the tour primitive.
6. If `preferredType` is **unset** → blended set. Default blend: 2 trips + 1 hotel + 1 region_base when `limit === 4`; proportional when `limit` differs. Each sub-query uses the same shared filters (region, budget, etc.) — primitives that don't apply a given filter just ignore it.

UI is forward-compatible per v1 — D.t9's `find-options.tsx` polymorphic-dispatches over `card.type` already.

The "lean toward tours when signal could go either way" rule in `find_options/description.md` is unaffected: it's an agent-side instruction telling Sonnet which `preferredType` to pass; v3 doesn't change the contract Sonnet reads. (When v2 lands, the `'tour'` branch starts returning real tour cards; until then, Sonnet's tour-preference still results in trip cards via the v2-fallback above — matching today's behaviour.)

---

## 1. Outcome

When this task is done:

- `product/connector/src/data/query-hotels.ts` exists, exports `queryHotelCardsByFilter(client, opts)`, validates output against `HotelProposalCardSchema`, returns `[]` for an empty result set.
- `product/connector/src/data/query-region-bases.ts` exists, exports `queryRegionBaseCardsByFilter(client, opts)`, validates output against `RegionBaseProposalCardSchema`, returns `[]` for an empty result set.
- `product/connector/src/tools/find_options.ts` dispatches per the §1–6 rules above. The handler stays small — primitives carry the SQL.
- `product/connector/src/tools/__tests__/find_options.test.ts` extends with per-type assertions + blend-when-unset assertions + v2-fallback pin. Empty-result test extended to cover hotel + region_base primitives.
- Unit tests for each new primitive exist (`query-hotels.test.ts`, `query-region-bases.test.ts`) following the existing `query-trips.test.ts` mock-`PoolClient` pattern (if one exists; otherwise establish it). DB-gated integration tests skipped without `DATABASE_URL`.
- `planning/decisions.md` carries entries `C.bf-1` through `C.bf-6` (numbered with the `bf-` prefix to avoid collision with any parallel Tier-3 numeric C.43+ allocations).
- `progress.md`, `next-steps.md`, `discoveries.md` (if any non-obvious findings) updated.
- Live-data smoke: agent prompts steered to `preferredType: 'hotel'` and `'region_base'` return cards of the expected type via the running connector at `:3002`.

Not outcomes:
- Tour cards live (v2 — separate plan).
- Tool-description.md rewrites (live shape teaches Sonnet enough already).
- New tools (`find_options` stays the single propose-options surface).
- Migration changes.
- Cost / pricing UI changes (v1 settled).

---

## 2. Target functionalities

### 2.1 `queryHotelCardsByFilter` data primitive

New file `product/connector/src/data/query-hotels.ts`. Mirrors `query-trips.ts` in structure (filter composition → SQL → row mapping → schema validation → image hydration). Header comment mirrors `query-trips.ts` for consistency.

**Filter shape** (`QueryHotelCardsOptions`):
```ts
export interface QueryHotelCardsOptions {
  region?: string | null;          // ILIKE match against area.name / area.alias / location.name
  budgetBand?: BudgetBand | null;  // applied against MIN(hotel_pricing.price) for that hotel
  accommodationStyle?: string | null; // ILIKE against hotel.description (no dedicated style col)
  limit: number;
}
```

`durationMin` / `durationMax` / `activity` — **NOT applied** to hotels (a hotel has no duration; activity comes via region not hotel). Handler passes them as undefined when dispatching to this primitive.

**SQL shape**:
```sql
SELECT
  h.id,
  h.slug,
  h.name AS headline,
  h.description AS vibe_line_source,
  h.star_rating,
  h.canonical_url,
  h.page_id,
  COALESCE(loc.name, area.name)             AS location,
  COALESCE(area.name, country.name)         AS region,
  MIN(hp.price) FILTER (WHERE hp.price IS NOT NULL) AS from_price,
  -- pick the most-common currency_code across price rows; tie-break by COUNT
  (SELECT hp2.currency_code FROM hotel_pricing hp2
    WHERE hp2.hotel_id = h.id AND hp2.currency_code IS NOT NULL
    GROUP BY hp2.currency_code
    ORDER BY COUNT(*) DESC, hp2.currency_code ASC
    LIMIT 1)                                AS currency_code,
  p.image_id                                AS page_image_id
FROM hotel h
LEFT JOIN location loc       ON loc.id = h.location_id
LEFT JOIN area               ON area.id = h.area_id
LEFT JOIN country            ON country.id = area.country_id
LEFT JOIN page p             ON p.id = h.page_id
LEFT JOIN hotel_pricing hp   ON hp.hotel_id = h.id
${where}
GROUP BY h.id, loc.name, area.name, country.name, p.image_id
ORDER BY from_price NULLS LAST, h.id
LIMIT ${limitBind}
```

Filters (ANDed via `clauses[]` pattern matching `query-trips.ts`):
- `region` → `(area.alias ILIKE $N OR area.name ILIKE $N OR loc.name ILIKE $N)` with `%region%`.
- `budgetBand` → `(MIN(hp.price) IS NULL OR MIN(hp.price) <= ceiling)` via HAVING.
- `accommodationStyle` → `h.description ILIKE $N` with `%style%`.

**Row → schema mapping** mirrors `query-trips.ts` spread-when-present pattern. Output per row:
- `type: 'hotel'` literal.
- `id: String(r.id)`, `slug?: r.slug`, `headline: r.headline`.
- `vibeLine?` — derive from the first sentence of `description` (regex `/^[^.!?]+[.!?]/`, then trim). If `description` is null, omit. Cap at ~140 chars to keep cards punchy.
- `region?`, `location?`, `starRating?` (1–5; clamped — defensive against bad source data).
- `fromPrice` (nullable per base schema), `currencyCode?`.
- `canonicalUrl`: prefer `h.canonical_url`; fall back to derived `https://www.swoop-patagonia.com/${slug}` if both `canonical_url` and `slug` are present (treat as bug if canonical_url is missing — log a `data.integrity.hotel_no_canonical_url` event but still attempt to return the card if a slug exists; skip the row if no canonical_url AND no slug since base schema requires a URL).
- `accommodationStyle?` — null for v3 (the schema field exists but the source `hotel` table has no dedicated column; we'd be guessing from `description`).
- `pricingUnit: 'per_night'` literal (default in the schema; explicitly passed so it's not surprising at the field level).
- `image?` — hydrated via `resolveImagesByIds(client, [page_image_id])` then `images.get(page_image_id)`. Hotels have NO direct image_id (per 2026-04-29 discoveries: "Hotels have ONLY the page path"); we resolve via `hotel.page_id → page.image_id`.

Final `HotelProposalCardSchema.parse(...)` on every row. Reject = surface the validation error; don't silently drop. (Mirrors `query-trips.ts` behaviour.)

### 2.2 `queryRegionBaseCardsByFilter` data primitive

New file `product/connector/src/data/query-region-bases.ts`. Pattern follows `query-hotels.ts`.

**Filter shape**:
```ts
export interface QueryRegionBaseCardsOptions {
  region?: string | null;  // ILIKE on area.name / area.alias / country.name (often the agent
                            // sets this to the country name when the visitor is choosing where to base)
  limit: number;
}
```

`durationMin` / `durationMax` / `budgetBand` / `activity` / `accommodationStyle` — **NOT applied** (a region as a base has no duration / budget / activity / accommodation style itself).

**Approach**: a `region_base` card represents an *area* that has enough trip coverage to be worth basing yourself in. Source signal:
- `area` rows (16 total live) for the entity.
- A page hub per area for `canonicalUrl` + `image_id`. Heuristic: `page` row whose `alias = area.alias` AND `parent_id IS NOT NULL` (i.e. not the absolute root page). When multiple match, pick lowest-id (deterministic). When none match, fall back to any page whose `canonical_url` ends with `/${area.alias}` (path-suffix match).
- `nearbyTripsCount` = `COUNT(t.id) FROM trip t WHERE t.region_id = area.id`.
- Min-trip threshold to surface as a base: `nearbyTripsCount >= 1` (don't surface bases with no trips to recommend).

**SQL shape**:
```sql
WITH area_trip_count AS (
  SELECT region_id AS area_id, COUNT(*) AS trip_count
  FROM trip
  WHERE region_id IS NOT NULL
  GROUP BY region_id
),
area_page AS (
  -- Pick the page-hub for each area: alias match first, fallback to URL suffix.
  -- Lowest page.id wins on ties.
  SELECT DISTINCT ON (a.id)
    a.id AS area_id,
    p.id AS page_id,
    p.canonical_url,
    p.image_id,
    p.summary,
    p.intro_text
  FROM area a
  LEFT JOIN page p
    ON (p.alias = a.alias AND p.parent_id IS NOT NULL)
    OR p.canonical_url LIKE '%/' || a.alias
  ORDER BY a.id, (CASE WHEN p.alias = a.alias THEN 0 ELSE 1 END), p.id
)
SELECT
  a.id,
  a.alias,
  a.name AS headline,
  country.name AS country_name,
  ap.canonical_url,
  ap.image_id,
  COALESCE(ap.summary, ap.intro_text) AS vibe_line_source,
  atc.trip_count AS nearby_trips_count
FROM area a
LEFT JOIN country         ON country.id = a.country_id
LEFT JOIN area_page ap    ON ap.area_id = a.id
LEFT JOIN area_trip_count atc ON atc.area_id = a.id
${where}
ORDER BY atc.trip_count DESC NULLS LAST, a.id
LIMIT ${limitBind}
```

Filters:
- `region` (when set) → `(a.alias ILIKE $N OR a.name ILIKE $N OR country.name ILIKE $N)` with `%region%`.
- Implicit floor `WHERE atc.trip_count >= 1` always applied (an area with no trips can't be recommended as a base).
- Implicit floor `WHERE ap.canonical_url IS NOT NULL` always applied (the base schema requires `canonicalUrl`; an area with no page hub can't be surfaced).

**Row → schema mapping**:
- `type: 'region_base'` literal.
- `id: String(r.id)`, `slug?: r.alias` (areas don't have a separate slug, but `alias` is slug-shaped).
- `headline: r.headline`.
- `vibeLine?` — first sentence of `vibe_line_source` (page summary or intro_text). Same regex + trim + 140-char cap as hotels.
- `region?` — `r.country_name` (e.g. "Chile" / "Argentina") so the card carries the country context even though the headline is the area name.
- `canonicalUrl: r.canonical_url`.
- `image?` — hydrated via `resolveImagesByIds(client, [r.image_id])`.
- `nearbyTripsCount: Number(r.nearby_trips_count ?? 0)`.
- `baseFraming?` — null in v3 (the schema field exists for future agent / ETL composition; we don't synthesise from the data yet).
- `fromPrice`: null (a region-as-base has no price; UI drops the price line per v1's "drop the price line entirely if fromPrice is null" rule).
- `currencyCode?` — omitted.

Final `RegionBaseProposalCardSchema.parse(...)` on every row.

### 2.3 Handler dispatch logic

[product/connector/src/tools/find_options.ts](../product/connector/src/tools/find_options.ts) becomes:

```ts
export async function findOptionsBody(
  input: FindOptionsInput,
  deps: ToolHandlerDeps,
): Promise<FindOptionsOutput> {
  const cards = await deps.withClient(async (client) => {
    const filters = {
      region: input.region,
      durationMin: input.durationMin,
      durationMax: input.durationMax,
      budgetBand: input.budgetBand,
      activity: input.activity,
      accommodationStyle: input.accommodationStyle,
      limit: input.limit,
    };

    switch (input.preferredType) {
      case 'trip':
        return queryTripCardsByFilter(client, filters);
      case 'hotel':
        return queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          limit: filters.limit,
        });
      case 'region_base':
        return queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          limit: filters.limit,
        });
      case 'tour':
        // v2 fallback: tours not yet wired (gated on Swoop tour-content population).
        // Pin: until v2 lands, `preferredType: 'tour'` returns trip cards. Behaviour
        // matches v1 contract (find_options.test.ts line 124). Event emitted so
        // operators see how often tours-without-data is being asked for.
        deps.emitEvent?.({ kind: 'find_options.tour_fallback' });
        return queryTripCardsByFilter(client, filters);
      case undefined:
      default:
        return blendCards(client, filters);
    }
  });

  return FindOptionsOutputSchema.parse({ cards, count: cards.length });
}
```

**`blendCards` (private)**: when `preferredType` is unset, build a mixed set across the three live variants. Default blend for `limit === 4`: 2 trips + 1 hotel + 1 region_base. For other limits, proportional: `floor(limit / 2)` trips, `ceil((limit - trips) / 2)` hotels, remainder region_bases. If any sub-query returns fewer than its quota, redistribute to the next-priority bucket (priority order: trip → hotel → region_base). Cap final result at `limit`.

```ts
async function blendCards(client: pg.PoolClient, filters: BlendFilters): Promise<ProposalCardPublic[]> {
  const tripQuota = Math.floor(filters.limit / 2);
  const hotelQuota = Math.ceil((filters.limit - tripQuota) / 2);
  const regionBaseQuota = filters.limit - tripQuota - hotelQuota;

  const [trips, hotels, regionBases] = await Promise.all([
    tripQuota > 0
      ? queryTripCardsByFilter(client, { ...filters, limit: tripQuota })
      : Promise.resolve([]),
    hotelQuota > 0
      ? queryHotelCardsByFilter(client, {
          region: filters.region,
          budgetBand: filters.budgetBand,
          accommodationStyle: filters.accommodationStyle,
          limit: hotelQuota,
        })
      : Promise.resolve([]),
    regionBaseQuota > 0
      ? queryRegionBaseCardsByFilter(client, {
          region: filters.region,
          limit: regionBaseQuota,
        })
      : Promise.resolve([]),
  ]);

  // Redistribute deficits down the priority chain (decision C.bf-3).
  const out = [...trips, ...hotels, ...regionBases];
  if (out.length < filters.limit) {
    // Top up with trips first (the most-populous variant), then hotels.
    const deficit = filters.limit - out.length;
    if (trips.length < tripQuota + deficit) {
      const moreTrips = await queryTripCardsByFilter(client, {
        ...filters,
        limit: tripQuota + deficit,
      });
      // Avoid dupes: filter out trip ids already in `out`.
      const seenIds = new Set(out.filter(c => c.type === 'trip').map(c => c.id));
      for (const t of moreTrips) {
        if (out.length >= filters.limit) break;
        if (!seenIds.has(t.id)) out.push(t);
      }
    }
  }
  return out.slice(0, filters.limit);
}
```

**`deps.emitEvent` shape**: confirm at implementation time. If it doesn't exist, omit the fallback-event emit (it's nice-to-have, not load-bearing). Don't add a new dep just for this.

### 2.4 Tests

Three test files touched / created:

**`product/connector/src/tools/__tests__/find_options.test.ts`** (extend):
- Existing 5 tests preserved.
- New `describe('v3 dispatch')` block:
  - `preferredType: 'hotel'` calls `queryHotelCardsByFilter` (mock) — not `queryTripCardsByFilter`. Returns hotel cards.
  - `preferredType: 'region_base'` calls `queryRegionBaseCardsByFilter` (mock) — not the other two.
  - `preferredType: 'trip'` still calls `queryTripCardsByFilter` (regression).
  - `preferredType: 'tour'` falls back to `queryTripCardsByFilter` (v2-not-ready pin). This is the same as today's v1 behaviour — pinning here so the v2 PR has a visible test diff when it swaps.
  - `preferredType` unset → all three primitives called (`blendCards`); cards array mixes types up to `limit`.
  - Blend-deficit: when trip primitive returns fewer than its quota AND total < limit, additional trips are queried (deficit-redistribution path).
  - Output validates against `FindOptionsOutputSchema` for each branch (discriminated union round-trip).

**`product/connector/src/data/__tests__/query-hotels.test.ts`** (new — mock `pg.PoolClient`):
- Filter composition: each filter (region / budgetBand / accommodationStyle) generates the expected SQL clause.
- Image hydration: when row carries `page_image_id`, `resolveImagesByIds` is called; returned card has `image` field.
- `from_price` aggregation: `MIN(price)` from `hotel_pricing` flows through.
- `currencyCode` mode-pick: when multiple price rows have different currencies, the most-common wins.
- Edge: empty result returns `[]`.
- Edge: hotel with no `page_id` (no image hydration) returns a card with no `image` field.
- Edge: hotel with `canonical_url` null AND no slug → skipped from output (with `data.integrity` event if `emitEvent` is available; no throw).

**`product/connector/src/data/__tests__/query-region-bases.test.ts`** (new — mock `pg.PoolClient`):
- Filter composition: `region` filter generates the area/country ILIKE clause.
- `nearbyTripsCount` reflects the `trip_count` aggregate.
- Page-hub fallback: when no page matches `alias`, the URL-suffix match takes over.
- Sort: highest `nearbyTripsCount` first.
- Edge: empty result returns `[]`.
- Edge: area with no page-hub at all → not returned (canonicalUrl required).
- Edge: area with `trip_count = 0` → not returned (>= 1 floor enforced).

**DB-gated integration tests** (skip without `DATABASE_URL`): optional pattern check after the unit tests pass. If `query-trips.test.ts` already has a DB-gated section, mirror it. Otherwise, an integration test in `product/connector/src/data/__tests__/find_options.integration.test.ts` is acceptable but not required for v3 acceptance (the unit tests against mocks cover the SQL-shape correctness; the live-data smoke covers end-to-end).

### 2.5 Decisions to log

Append to `planning/decisions.md`:

- **C.bf-1** — `find_options` v3 wires hotels + region_bases as live data primitives. v2 (tours) remains deferred separately. Rationale: hotels and region_bases are not Swoop-gated; tours are. Don't bundle.
- **C.bf-2** — Hotel image resolution goes via `hotel.page_id → page.image_id` (no direct `image_id` on `hotel`). Confirms the 2026-04-29 "Hotels have ONLY the page path" discovery as the canonical resolution rule in the projection layer.
- **C.bf-3** — When `preferredType` is unset, `find_options` returns a **blended set** across live variants (default ratio for `limit=4`: 2 trips + 1 hotel + 1 region_base). Deficits redistribute down the priority chain (trip → hotel → region_base). Reasoning: the agent's most common ask will be open-ended; surfacing variety nudges Sonnet (and the visitor) toward seeing the proposal-type spread instead of always defaulting to trips.
- **C.bf-4** — Region-base canonical URL resolution: `area.alias` matches `page.alias` first (with `parent_id IS NOT NULL`); URL-suffix match (`canonical_url LIKE '%/' || area.alias`) as fallback. Areas without a page hub are not surfaced. Rationale: every card requires a deep-link CTA; better to drop the area than render a card without one.
- **C.bf-5** — `nearbyTripsCount = 0` areas are NOT surfaced as region_bases. Threshold is `>= 1`. Rationale: a base-and-explore framing implies things to explore; an area with no trip coverage breaks the value proposition.
- **C.bf-6** — `preferredType: 'tour'` continues to route through the trip primitive (v2 fallback) and **emits a `find_options.tour_fallback` event** (when `emitEvent` is available) so operators can see how often tours-without-data is being asked for. Provides upstream data to prioritise the Swoop tour-content ask. The v2 PR swaps this branch's dispatch when content lands.

(Numbering uses the `bf-` prefix per the user's 2026-05-13 instruction to avoid numeric collision with parallel agents allocating decisions `C.43+` on `main`. The plan's commit can renumber to standard `C.N` form if Al wants — but the prefix is unambiguous and surfaces the backfill provenance.)

### 2.6 `progress.md` / `next-steps.md` / `discoveries.md` updates (post-impl)

- **`progress.md`**: append a `## 2026-05-13 — find_options v3 backfill (hotels + region_bases)` block, mirroring the structure of the 2026-05-12 entries. Lists what landed; test deltas; what unblocks downstream.
- **`next-steps.md`**: in the "Crosscut tranche queue" section under §0 / today's status — mark `v3 (hotels + region_bases backend)` as ✅ landed; update the v2 tours note to say "still gated on Swoop tour-content; `preferredType: 'tour'` falls back to trips and emits `find_options.tour_fallback` so the gate is observable."
- **`discoveries.md`**: only add an entry if v3 surfaces a non-obvious truth (e.g. the page-hub fallback heuristic doesn't generalise, or the blend's redistribution path interacts weirdly with `limit=2`). Likely no new entry needed; if added, keep the format consistent.

---

## 3. Architectural principles applied here

- **Theme-11 top-down**: hotels and region_bases serve the same job (propose options) but earn their distinct visual register because the conversational moment for "where could we stay" is genuinely different from "what should we do for 7 days". The schema discriminator carries; the handler routes.
- **One tool, polymorphic output** (decision C.48): no new tools. v3 implements behind the v1 contract.
- **Forward-only**: no migration changes. The schema's columns are sufficient.
- **Same code shape across primitives**: every primitive in `product/connector/src/data/` follows the same filter-composition → SQL → row-mapping → schema-validation → image-hydration pattern (mirrors `query-trips.ts`). Consistency makes review trivial and future v2 tour primitive can copy-paste structure.
- **Spread-when-present mapping**: per v1's deviation note in the crosscut plan, `.optional()` (not `.nullable().optional()`) fields require spread-when-present at the row → schema boundary so SQL nulls translate to omitted keys, not explicit `null`s.
- **`fromPrice` is the lone `.nullable().optional()`**: per v1's contract, `fromPrice: null` is the signal to drop the price line entirely. Don't omit the key; pass `null` explicitly.

---

## 4. Implementation order

TDD throughout — every primitive starts with its test file, every handler change starts with the dispatch test.

1. **Hotel primitive**:
   1. Write `query-hotels.test.ts` (mock `pg.PoolClient`) with the 6 cases in §2.4 (failing).
   2. Implement `query-hotels.ts` until tests pass.
   3. Typecheck the connector workspace; fix any drift.
2. **Region-base primitive**:
   1. Write `query-region-bases.test.ts` with the 6 cases in §2.4 (failing).
   2. Implement `query-region-bases.ts` until tests pass.
   3. Typecheck.
3. **Handler dispatch**:
   1. Extend `find_options.test.ts` with the 6 new v3-dispatch cases in §2.4 (failing — the `'hotel'` / `'region_base'` mocks aren't being called by the handler yet).
   2. Refactor `find_options.ts` body to switch on `preferredType` + implement `blendCards`.
   3. Re-run; cases pass.
4. **Fresh-install verification** (§5).
5. **Decisions logged** (§2.5). One commit per logical chunk: (a) hotel primitive + test, (b) region-base primitive + test, (c) handler dispatch + test extensions, (d) decisions + orientation docs.
6. **Live-data smoke** (§5).
7. **Hand-off** (§9): update orientation docs.

---

## 5. Verification

### Fresh-install gate (mandatory per the 2026-05-13 false-green lesson)

```bash
cd /Users/al/Studio/projects/swoop_web/.claude/worktrees/jolly-pasteur-77252a
pwd  # must end in .claude/worktrees/jolly-pasteur-77252a (per 2026-05-13 wrong-cwd discovery)

cd product
rm -rf node_modules */node_modules
npm install
npm run typecheck --workspaces --if-present  # all 6 workspaces green
npm test --workspaces --if-present            # all green; no flakes
```

Expected per-workspace deltas:
- `@swoop/connector`: +~18 tests (6 hotel + 6 region-base + 6 v3-dispatch). Was 126 (+ 3 DB-gated skipped) → expect ~144 (+ 3 skipped).
- Other workspaces unchanged.

### Sweep checks

```bash
grep -rn "queryHotelCardsByFilter\|queryRegionBaseCardsByFilter" product/connector/src
# Expected: exports in data/ + import in tools/find_options.ts (+ test files)

grep -rn "preferredType" product/connector/src
# Expected: tools/find_options.ts switch statement + tests
```

### Live-data smoke

Run connector against `puma_dev` (live populated via C.t3); orchestrator can be a thin curl harness against `:3002`'s MCP tool surface.

```bash
# Terminal 1 — connector
cd /Users/al/Studio/projects/swoop_web/.claude/worktrees/jolly-pasteur-77252a/product
npm run dev -w @swoop/connector

# Terminal 2 — verify each branch
# Hotel: should return hotel cards (44 hotels live in puma_dev).
mcp-cli call find_options '{"preferredType":"hotel","region":"torres del paine","limit":3}'

# Region base: should return region_base cards (16 areas; up to 4 with page hubs + trip coverage).
mcp-cli call find_options '{"preferredType":"region_base","limit":4}'

# Trip (regression): still returns trip cards.
mcp-cli call find_options '{"preferredType":"trip","region":"patagonia","limit":4}'

# Tour fallback: returns trip cards (logs find_options.tour_fallback if events wired).
mcp-cli call find_options '{"preferredType":"tour","limit":2}'

# Blend (no preferredType): mixed set, mostly trips, ~1 hotel, ~1 region_base.
mcp-cli call find_options '{"region":"patagonia","limit":4}'
```

Each call should:
- Return 0 < `count` <= `limit` (a fully-empty result is a red flag for the live DB).
- Every `card.type` is one of `'trip' | 'hotel' | 'region_base'`.
- `cards[i].canonicalUrl` is a real Swoop URL (begins with `https://www.swoop-patagonia.com/`).
- Hotel cards have `pricingUnit: 'per_night'` and optionally `starRating` + `location`.
- Region-base cards have `nearbyTripsCount > 0`.

If a smoke fails (zero cards from a branch that should produce some), check `puma_dev` row counts via psql and consult `gotchas.md` before iterating.

### What the UI should render

Once the smoke clears, browse to `http://localhost:5173`, complete consent, ask:
- *"Where could we stay near Torres del Paine?"* → expect hotel cards in the UI.
- *"What's the best region to base ourselves for a Patagonia trip?"* → expect region_base cards.
- *"Show me some 7-day hiking trips in Patagonia."* → expect trip cards (regression).
- *"What are my options for Patagonia?"* → blend (probably trips + 1 hotel + 1 region_base).

(The UI executors merged `D.t9 widget rewrite` 2026-05-13; the polymorphic dispatch in `find-options.tsx` is already live against fixtures. v3 just supplies real data into the same renderers.)

---

## 6. HITL questions

**None expected.** The crosscut polymorphism plan §6 ratified the open considerations:
- Tour-vs-trip ambiguity → v2 concern, not v3.
- Region_base eventual usefulness → flagged as "easiest-to-retire if mid-implementation evidence suggests redundant"; the implementation here is shallow enough to retire later if needed.

**Items that MAY surface during execution** (flag inline if encountered; halt and ratify only if they imply contract change):
- If `puma_dev` has materially fewer than 16 `area` rows with usable page hubs, the threshold `>= 1` may need rethinking — but that's a tuning concern not a contract concern. Continue and surface in the execution log.
- If the page-hub heuristic (alias match → URL-suffix match) misses obvious bases, the heuristic may need a third fallback (e.g. parent_page walking). Resolve mid-execution; document.
- If `hotel_pricing` carries no rows for the live `hotel` dump (44 rows; pricing may be sparse), `fromPrice` is null on every hotel card — UI drops the price line per v1 rules; the card still renders. Confirm in the live-data smoke.

---

## 7. PoC carry-forward pointers

None directly applicable. The ChatGPT PoC's widgets at `chatgpt_poc/product/ui-react/src/widgets/` are styled for ChatGPT, not Puma (per 2026-04-22 discoveries). The schemas in this plan are derived bottom-up from the Postgres tables, top-down from the polymorphic contract — not from PoC code.

---

## 8. Coordination with siblings

- **Parallel UI agent (2026-05-13 dispatch)** — they're working on end-to-end UI flow against current data. v3 work lands **after** their commits or in parallel without collision: v3 changes only `product/connector/`, never `product/ui/`. Their `find-options.tsx` polymorphic-dispatch already handles all four variants from fixtures. Merge order doesn't matter.
- **Parallel Tier-3 plan authors (per Al 2026-05-13)** — Numeric IDs `C.43+` may be allocated in parallel. The `bf-` prefix on this plan's decisions sidesteps that.
- **Crosscut polymorphism plan (v1, merged)** — this plan executes v3 of that plan's three-tranche strategy. Decisions in this plan reference C.48–C.51 via inline title + context per the [feedback_inline_comprehension_for_refs.md](../../../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/feedback_inline_comprehension_for_refs.md) rule.
- **D.t9 widget rewrite (merged 2026-05-13)** — its hotel + region_base renderers are already wired to consume `HotelProposalCardSchema` / `RegionBaseProposalCardSchema`. v3 lights them up with real data.
- **C.t3 ETL** (closed) — provides the populated `hotel`, `area`, `page`, `trip` tables this primitive reads. No coordination required; the schema is settled.

---

## 9. References

- [`03-exec-crosscut-find-options-polymorphism.md`](03-exec-crosscut-find-options-polymorphism.md) — v1 contract this builds on.
- [`03-exec-c-t4.md`](03-exec-c-t4.md) — eight-tool handler surface; pattern this primitive joins.
- [`03-exec-c-t3.md`](03-exec-c-t3.md) — domain-table ETL; the live-counts that anchor the v3 viability (`hotel: 44`, `area: 16`, etc.).
- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) — chunk-C ★ Read this first; theme-11 calibration.
- `product/connector/src/data/query-trips.ts` — pattern the new primitives mirror.
- `product/connector/src/data/resolve-image.ts` — image hydration helper.
- `product/connector/migrations/002_domain_tables.sql` — `hotel`, `hotel_pricing`, `area`, `country`, `location`, `page`, `trip` schemas.
- `product/cms/prompts/tools/find_options/description.md` — the prose Sonnet reads; unchanged by v3.
- [discoveries.md](../discoveries.md) — 2026-04-29 "Page-as-hub pattern, but trips also have direct image joins" (the rule v3's hotel image-resolution follows); 2026-05-13 "find_options is polymorphic" (the rule v3 extends).
- [gotchas.md](../gotchas.md) — `pg.Pool` `on('connect')` deprecation, `client.query()` warnings, etc. — sanity-checks for the primitive's DB interactions.

---

## Execution log

### 2026-05-13 — Plan authored

Tier-3 plan written by primary session (`jolly-pasteur-77252a` worktree); ratified inline against current-state reads of:
- `product/connector/src/tools/find_options.ts` (v1 handler — single-primitive dispatch).
- `product/connector/src/data/query-trips.ts` (pattern to mirror).
- `product/connector/src/data/resolve-image.ts` (image hydration helper).
- `product/connector/migrations/002_domain_tables.sql` (table schemas).
- `product/ts-common/src/tools.ts` (HotelProposalCardSchema / RegionBaseProposalCardSchema contracts).
- `product/connector/src/tools/__tests__/find_options.test.ts` (existing test pattern).
- `product/cms/prompts/tools/find_options/description.md` (Sonnet-facing tool description, unchanged).

### 2026-05-13 — v3 implementation landed (same session)

TDD throughout, four atomic-shaped change clusters (uncommitted — user's product/CLAUDE.md says don't `git add` without ask):

| Cluster | Files | Tests |
|---|---|---|
| 1. Hotel data primitive | `product/connector/src/data/query-hotels.ts` + `__tests__/query-hotels.test.ts` | +10 |
| 2. Region-base data primitive | `product/connector/src/data/query-region-bases.ts` + `__tests__/query-region-bases.test.ts` | +7 |
| 3. Handler dispatch + `blendCards` | `product/connector/src/tools/find_options.ts` (refactored) + `__tests__/find_options.test.ts` (extended from 5 → 14 tests) | +9 |
| 4. Orientation docs + decisions | `planning/decisions.md` (C.bf-1..6), `progress.md`, `next-steps.md` | — |

**Fresh-install verification (false-green guard satisfied)**:

```
cd /Users/al/Studio/projects/swoop_web/.claude/worktrees/jolly-pasteur-77252a/product
rm -rf node_modules */node_modules
npm install                                  # exit 0
npm test --workspaces --if-present           # exit 0
```

| Workspace | Tests |
|---|---|
| `@swoop/common` | 160 |
| `@swoop/orchestrator` | 170 |
| `@swoop/connector` | **149 + 3 DB-gated skipped** (was 126+3 → +23 net) |
| `@swoop/ui` | 112 |
| `@swoop/ingestion` | 266 |
| `@swoop/harness` | 74 |
| **Total** | **931 + 3 skipped** (was 908+3 → +23 net) |

**Typecheck status**: `@swoop/connector` clean. `@swoop/ui` errors with `'args' is of type 'unknown'` in `lead-capture.tsx`, `lookup.tsx`, `widget-shell.tsx`. **Confirmed pre-existing on `main` HEAD by `git stash && tsc -p ui/tsconfig.json`** — these errors exist without v3 changes. Likely the parallel UI agent's WIP from the same 2026-05-13 dispatch session. Not caused by v3; flagged here so reviewers don't blame this work.

**Deviations from the plan**:

1. **`deps.emitEvent` deferred (decision C.bf-6 amendment)**. The plan §2.3 named a `find_options.tour_fallback` event emission for the tour-fallback branch. The `ToolHandlerDeps` shape (`product/connector/src/tools/deps.ts`) doesn't currently expose an `emitEvent` channel — only `withClient` and `embedQuery`. Adding the channel is out of scope for v3 (it's a cross-workspace observability concern, not a `find_options` concern). The branch is wired and tested without the event emit; a one-line add lands when the affordance arrives. Decision body amended in `decisions.md`.
2. **Defensive clamping in `query-hotels.ts`**. The plan called for clamping `star_rating` to the schema's `[1, 5]` range; implementation added an explicit `clampStarRating` helper (rejects 0, > 5, NaN, non-integer). One extra unit-test case (the 9th, "clamps star_rating values outside 1-5 to undefined") pins this.
3. **Defensive `nearby_trips_count` coercion in `query-region-bases.ts`**. The pg driver returns COUNT(*) as a string by default; the row mapper applies `Number(...)` with a `?? 0` fallback. Two extra unit-test cases pin this (string coercion + null defensive). Net region-base tests: 7 (plan said 6).
4. **Deficit-redistribution guard in `blendCards`**. Initial implementation top-up'd whenever `out.length < limit && trips.length < tripQuota + 1`, which fired even when every primitive returned empty — wasting a round-trip. Tightened to `out.length > 0 && out.length < limit`: redistribution only fires when at least one primitive delivered. Two test cases caught this and pinned the new condition.
5. **`as unknown as never` cast NOT needed**. The plan didn't anticipate this; the connector workspace doesn't use `@google/adk` so the `ZodObject` mismatch gotcha doesn't apply.

**Items surfaced for downstream**:

- **Live-data smoke** still pending Al per plan §5. Run `npm run dev -w @swoop/connector` then exercise each `preferredType` branch via the MCP surface. Especially worth verifying: page-hub heuristic finds enough bases for the 16-area corpus, and `hotel_pricing` is populated enough that `from_price` aggregation produces non-null prices for most hotels.
- **`deps.emitEvent` channel** — a tracked add-on rather than a v3 blocker. When it lands, the tour-fallback branch in `find_options.ts` gets a one-line emit.
- **`@swoop/ui` typecheck errors** unrelated to v3 — pre-existing on `main`, likely the parallel UI agent's WIP. Reviewers shouldn't blame v3.

**Hand-off**:
- `progress.md` updated with the v3 batch entry.
- `next-steps.md` "Crosscut tranche queue" updated: v3 ✅ landed; v2 still gated on Swoop tour content.
- `decisions.md` carries C.bf-1..6.
- This plan's hand-off section §10 below remains true: v3 done; v2 lands when Swoop populates tours.

No HITL items surfaced during execution. The §6 open considerations remain queued for v2.
