# 03 — Crosscut: trip.region_id backfill (brave-pare worktree, 2026-05-13)

**Status**: Tier 3 execution plan. Draft, 2026-05-13.
**Chunk**: Crosscut — fixes a C.t3 ETL gap that surfaced post-BF-FO-v3 (the v3 backfill's region_base widget returns 0 cards every time because the upstream column is empty).
**Filename suffix `-brave-pare-`**: worktree-slug-stamped per the 2026-05-13 collision-avoidance discipline.
**Depends on**: nothing — read-only against the worktree tip + the existing `tag` + `area` tables in `puma_dev`.
**Produces**: `trip.region_id` populated for ~672/852 trips (79% coverage), unblocking the `region_base` proposal-card variant for live use.
**Estimate**: ~2 hours.

---

## ★ Read this first — the WHY

The BF-FO-v3 crosscut (commits `f4d28de` → `c5a475b`, merged 2026-05-13) wired the `region_base` data primitive and dispatch path correctly — schemas, fixtures, widgets, and SQL all align with the C.t2 contract. Browser smoke against `puma_dev` (2026-05-13 afternoon, this branch) revealed that every `find_options preferredType: 'region_base'` call returns `{cards: [], count: 0}` — the connector is producing nothing.

Root cause: `trip.region_id` is **NULL across all 852 trips** in the derived schema. `queryRegionBaseCardsByFilter` filters areas by `trip_count >= 1` per decision C.bf-5 ("no trips → can't recommend as a base"). With every trip's `region_id` empty, the area-trip join produces zero rows for all 16 areas, so the filter excludes everything.

The gap is in C.t3's `transformTrip` function. Line 368 of `product/ingestion/src/sql-transform/transformations.ts` reads:

```ts
region_id: null, // Trip → region via ntags_lookup (area-typed tag), not direct FK.
```

The comment correctly names the intended source (area-typed tags in `trip.ntag_ids`) but the implementation punts. This Tier 3 closes that punt.

**The widget, schema, dispatch, and renderer are all correct — the data just doesn't satisfy the filter.** Fix the data source; everything downstream lights up.

---

## Source-of-truth investigation (done in advance, 2026-05-13)

Tag-typed area mapping versus URL parsing — coverage measured live against `puma_dev`:

| Source | Trips matched | % of 852 | Notes |
|---|---:|---:|---|
| `tag` rows where `type='area'` intersected with `trip.ntag_ids` | **630** | 74% | Swoop-authored, semantic |
| `canonical_url` second-path-segment match against `area.alias` | 241 | 28% | Pattern-fragile; misses meta pages |
| Either | 672 | 79% | |

**Tag-table area-typed entries vs area-table alignment:**

| | Count |
|---|---:|
| `area` rows with no matching area-typed `tag` | 0 |
| `tag` area-typed rows with no matching `area` (sub-areas / campaign tags: Welsh, Atlantic, Fjords, Multi-region tour, Valparaíso) | 5 |
| Overlap (area.alias == tag.alias) | 16 |

**Multi-area distribution** (`SELECT n_area_tags, COUNT(*) FROM trip-with-tag-count GROUP BY 1`):

| Area-tags per trip | Trips |
|---:|---:|
| 0 | 222 |
| 1 | 536 |
| 2 | 53 |
| 3+ | 41 |

94 trips (11%) carry multiple area tags — typically multi-region tours like "south-america-wild-patagonia" (7 areas). The scalar `trip.region_id` column needs a primary-area rule.

**Decision (load-bearing for this plan)**:
- **Source**: tag-table area-typed entries intersected with `area.alias` (16-way alignment). URL parsing rejected — 2.6× less coverage, brittle to URL pattern changes, no semantic backing.
- **Multi-area rule**: pick the area with the lowest `area.id` (= most canonical / oldest in the Swoop taxonomy; Antarctica=2, Aysén=4, BA=10, etc.). Deterministic. Trivially explainable. Reversible if a better rule emerges.
- **Coverage**: 630 trips get a `region_id` (74%); 222 stay NULL (correctly — they're meta/index trips like `/adventure-travel-in-patagonia` with no area scope).
- **Out of scope this round**: `trip.country_id` (also NULL across 852, same root cause, derivable from `area.country_id` post-region_id). Add as a single-line follow-up commit if review supports it; this plan focuses on the user-visible region_base bug only.

---

## Deliverables

### Code changes

| File | Change |
|---|---|
| [product/ingestion/src/sql-transform/lookups.ts](../product/ingestion/src/sql-transform/lookups.ts) | Add `areaIdByTagAlias: Map<string, number>` field to `Lookups` interface. Build it inside `loadLookups` by streaming the source dump's `area` and `ntag` tables: for each `ntag` with `type='area'`, look up the corresponding `area.id` by alias match. Only entries with matching `area` rows make it into the map (the 5 sub-area / campaign tags fall out cleanly). |
| [product/ingestion/src/sql-transform/transformations.ts](../product/ingestion/src/sql-transform/transformations.ts) | In `transformTrip`, replace `region_id: null` with a derived value: iterate `tagIds`, intersect with the new `lookups.areaIdByTagAlias.values()`-keyed lookup (need a reverse `tagIdToAreaId` map for O(1)), collect resulting `area.id`s, return `Math.min(...)` or `null` if empty. Drop the placeholder comment. |
| [product/ingestion/src/sql-transform/__tests__/transformations.test.ts](../product/ingestion/src/sql-transform/__tests__/transformations.test.ts) | Add 3 cases: (a) trip with 1 area tag → `region_id` is that area's id; (b) trip with 3 area tags → `region_id` is the lowest area.id; (c) trip with no area tags → `region_id: null`. Mirror the existing `transformTrip` test shape. |
| [product/ingestion/src/sql-transform/__tests__/lookups.test.ts](../product/ingestion/src/sql-transform/__tests__/lookups.test.ts) (if exists; otherwise inline) | Cover the `areaIdByTagAlias` build path: given fixture dumps with `area` + `ntag` rows that overlap by alias, the resulting map has the right size + content. |

### What does NOT change

- **`trip.country_id`** — staying NULL this round. Same root cause but separate user-visible value. One-line follow-up commit can derive it from `area.country_id` once `region_id` is populated.
- **`queryRegionBaseCardsByFilter` SQL** (`product/connector/src/data/query-region-bases.ts`) — untouched. The filter is correct; only the data was missing.
- **C.bf-5 decision** — staying as-is. "Region_base value-prop requires trips to explore" remains the right rule; the trips just need to actually be linked to areas.
- **Migration files** — no schema change. `trip.region_id` column already exists; only its population path changes.
- **Other transforms** — `transformHotel` etc. don't need this work.

---

## Step-by-step execution

1. **Hash gate** — `git rev-parse HEAD` matches the brave-pare worktree tip (currently `7cefcae` post-merge of main).
2. **Failing tests first** — add the 3 `transformTrip` cases in `transformations.test.ts` (single-area, multi-area lowest-id wins, no-area). Run `npm test -w @swoop/ingestion -- transformations` → should fail with "expected region_id 60, got null" or similar.
3. **Add `Lookups.areaIdByTagAlias`** — extend the interface; build the map inside `loadLookups`. Streaming order in `loadLookups` already handles cross-references via accumulator pattern; mirror it.
4. **Derive `region_id` in `transformTrip`** — use a `tagIdToAreaId: Map<number, number>` derived from the alias map at function-entry time (or thread through the inverted map directly to keep `transformTrip` fast). Multi-area: `Math.min(...)` over the area-ids the trip's tags map to.
5. **Run tests** — `npm test -w @swoop/ingestion` → green.
6. **Live ETL re-run + verify** — drop + reload the trip table against `puma_dev`:
   ```sh
   npm run -w @swoop/ingestion etl:sql -- --dump ../data/sql-dump/swoop-patagonia_prod.sql --tables trip
   ```
   Then verify via psql:
   ```sql
   SELECT 'with region_id', COUNT(*) FROM trip WHERE region_id IS NOT NULL;
   -- Expected: 630 (matches the 2026-05-13 pre-fix probe).
   SELECT a.name, COUNT(*) AS n FROM trip t JOIN area a ON a.id = t.region_id
   GROUP BY a.name ORDER BY n DESC;
   -- Expected: Torres del Paine cluster dominates; FTE & Chalten, Aysén, etc. all represented.
   ```
7. **Live browser smoke** — replay the region_base query against the live stack:
   ```
   Page → consent → "What are the best regions to use as a base for exploring Patagonia?"
   ```
   Expected: agent calls `find_options preferredType: 'region_base'`; connector returns 3-4 area cards (Torres del Paine, FTE & Chalten, Aysén region, Chilean Lake District are the most likely with the heaviest trip counts); the `RegionBaseCard` widget renders for each.
8. **Connector unit tests** — `npm test -w @swoop/connector -- query-region-bases` should still pass. The data primitive's SQL is unchanged; only its inputs changed. No regression expected.
9. **Update [discoveries.md](../discoveries.md)** — entry: "ETL gaps that name the source ('via X') but leave the implementation as `null` will silently break downstream surfaces. Grep `null, //` in transformations.ts for similar punts."
10. **Update [next-steps.md](../next-steps.md)** — close the BF-FO-v3 "Live-data smoke" pending-Al-action item with a forward link to this plan's outcome. Optionally add the `trip.country_id` follow-up as a queued item.

---

## Verification table

| Verification | Pre-fix | Expected post-fix |
|---|---|---|
| `SELECT COUNT(*) FROM trip WHERE region_id IS NOT NULL;` | 0 | 630 |
| `SELECT COUNT(DISTINCT region_id) FROM trip WHERE region_id IS NOT NULL;` | n/a | 14-16 |
| `npm test -w @swoop/ingestion` | passes (with 0 region_id assertion) | passes (with new region_id assertions, +3-4 tests) |
| `npm test -w @swoop/connector -- query-region-bases` | passes | passes (no change) |
| Live browser smoke: region_base query | 0 cards, agent prose only | 3-4 RegionBaseCard widgets rendered + agent framing prose |
| Live browser smoke: blended query (no preferredType) | trip + hotel mix (no region_base) | trip + hotel + region_base mix per decision C.bf-3 |

---

## Decision marker — C.brave-pare-2

**Decision — `trip.region_id` derived from area-typed `ntag` intersection with `area.alias`; multi-area trips pick the lowest `area.id` as the primary representative.** Logged as **C.brave-pare-2** in [decisions.md](decisions.md). Closes C.t3's `transformTrip` placeholder comment and unblocks BF-FO-v3's region_base path against live data.

---

## Parallel-agent collision notes

- Filename includes the worktree slug `brave-pare-` (genuinely unique per agent dispatch).
- Decision number left as TBD.
- Touches `product/ingestion/src/sql-transform/` — single workspace, narrow surface. If another agent is mid-flight on a chunk-C ETL extension, merge order needs Al's coordination; conflicts unlikely because the change is additive (new lookup map + one-line punt-removal).
- The connector-side `queryRegionBaseCardsByFilter` SQL is intentionally not touched; the fix is purely upstream.

---

## Why this is the proper fix (vs the cheap alternative)

The 2026-05-13 smoke-finding write-up identified two paths:

1. **Patch the ETL** (this plan) — populate `trip.region_id` from the canonical source. Cost: ~2h. Benefit: region_base surfaces real areas with real trip counts; the column is honest and reusable for any future consumer (analytics, post-Puma surfaces, etc.).
2. **Relax C.bf-5** — surface areas even with `trip_count = 0`. Cost: ~1h. Benefit: region_base renders something. Cost: the renderered output is dishonest — "Aysén is a great base" with no actual trips listed below — and the trip-count signal that the BF-FO-v3 ranking depends on becomes meaningless.

Path 1 is the proper fix. The ETL had a placeholder marked `via ntags_lookup`; this plan delivers what the placeholder promised.