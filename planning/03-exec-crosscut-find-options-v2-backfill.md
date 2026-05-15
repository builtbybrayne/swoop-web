# 03 — Execution: Crosscut — `find_options` v2 backfill (tours)

> Sister plans: v1 (`03-exec-crosscut-find-options-polymorphism.md`, decisions C.48–C.51) — discriminated `ProposalCardPublicSchema` over `trip | tour | hotel | region_base`, tour variant shipped against fixtures; v3 (`03-exec-crosscut-find-options-v3-backfill.md`, decisions C.bf-1..6) — hotels + region_bases landed as live data primitives. **v2 is the last variant gated on data.** This plan closes it.
>
> **Status**: DRAFT — author 2026-05-15 in worktree `focused-shamir-52524c`. Decision IDs proposed `C.focused-shamir-{2,3}` (wave-named, TBD-on-merge — same collision-avoidance pattern as C.brave-pare-* / C.focused-shamir-1).

---

## ★ Read this first — what v2 actually changes

[C.focused-shamir-1](decisions.md) (2026-05-14) populated the `tour` table — 11 tours + 35 tour_items in `puma_dev`. v2 makes that data **reachable by the agent** by wiring the matching derived-table + query primitive + dispatch swap. The UI tour-card variant has been live since v1 against fixtures; this is purely a backend tranche. No new prompt copy, no new contract.

The destination is one switch case in [find_options.ts:82–84](../product/connector/src/tools/find_options.ts#L82) — replace the `queryTripCardsByFilter` fallback with a new `queryTourCardsByFilter`. Everything else in this plan is *building the primitive that line will call*.

**Scope guardrails:**
- One variant only — no changes to trip / hotel / region_base behaviour.
- One *new* derived table (`tour_card`) + one new connector primitive + one Compose function. Mirrors the trip-card pattern; deliberate parity.
- 11 rows. Don't optimise for scale. Optimise for *symmetry* with trip_card so the next reader / future writer doesn't have to context-switch.

---

## 1. Outcome

After this lands, `find_options({ preferredType: 'tour' })` returns real tour cards built from the populated `tour` + `tour_item` data — not trip fallbacks. The cosmetic loop closes: Luke's stated upsell priority (Tours) becomes a real, agent-reachable surface; the find_options polymorphism v1→v2→v3 sequence completes.

Decision C.bf-6 (`preferredType: 'tour'` routes through trip primitive as v2 fallback) is **superseded** by the new dispatch.

---

## 2. Target functionalities

### 2.1 `tour_card` derived table — migration 011

New file: `product/connector/migrations/011_tour_card.sql`.

Shape mirrors `trip_card` ([003_derived_tables.sql:158-176](../product/connector/migrations/003_derived_tables.sql#L158)) with three intentional shifts:

| Column | Type | Differs from trip_card? | Why |
|---|---|---|---|
| `id` | `INTEGER PRIMARY KEY REFERENCES tour(id)` | — | same pattern |
| `slug` | `TEXT UNIQUE` | — | from `page.alias` (already on `tour.slug`) |
| `headline` | `TEXT NOT NULL` | — | from `page.title` (already on `tour.title`) |
| `vibe_line` | `TEXT` | — | derived (see §2.2) |
| `region` | `TEXT` | — | derived from `page.ntag_ids` ∩ area-typed tags |
| `day_count` | `INTEGER` | **new** | `COUNT(tour_item WHERE tour_id = t.id)` — the honest day signal (no `tour.duration` in source) |
| `duration_days` | `INTEGER` | — | populated as `day_count` for query-shape parity with trip_card; can diverge later if Swoop sends explicit durations |
| `group_size_max` | `INTEGER` | **new** | always null today (no source column); reserved for future Swoop population |
| `from_price` | `DECIMAL(10,2)` | — | always null today (no source column); future-proofed |
| `currency_code` | `TEXT` | — | always null today; future-proofed |
| `image_id` | `INTEGER REFERENCES image(id) ON DELETE SET NULL` | — | `tour.image_id` first, then `image_page` fallback via `tour.page_id` (see §2.2 Q on this) |
| `accommodation_style` | `TEXT` | — | always null today; future-proofed |
| `activity_tags` | `TEXT[] DEFAULT '{}'` | — | aggregated from `page.ntag_ids` ∩ activity-typed tags |
| `canonical_url` | `TEXT NOT NULL` | — | from `tour.canonical_url` (page-derived) |
| `embedding` | `halfvec(3072)` | **shape vs migration 003** | post-C.46 / migration 009 shape — Gemini-3072d via halfvec for HNSW |
| `tsv` | `tsvector` | — | `headline ‖ vibe_line ‖ region` |
| `content_hash` | `TEXT NOT NULL` | — | hash over embedding input — gates the embed pass |
| `created_at`, `modified_at` | `TIMESTAMPTZ DEFAULT NOW()` | — | same pattern |

**Indexes** (mirroring trip_card's footprint in `004_indexes.sql`):
- B-tree on `region` (filter)
- B-tree on `day_count` (filter — replaces `duration_days` as the natural-key index)
- B-tree on `from_price` (filter — future-proof; index a null-mostly column is cheap)
- GIN on `activity_tags` (`@>` filter)
- GIN on `tsv` (full-text)
- HNSW on `embedding` using `halfvec_cosine_ops` (matches post-009 pattern)

**Forward-only per C.31.** No data backfill in the migration itself — `composeTourCard` populates rows.

### 2.2 `composeTourCard` — enrich function

New file: `product/ingestion/src/enrich/compose/tour-card.ts`. Mirrors [`compose/trip-card.ts`](../product/ingestion/src/enrich/compose/trip-card.ts) (read it first).

**Query** (single SQL, joins everything cheaply for 11 rows):

```sql
SELECT
  t.id, t.slug, t.title, t.image_id AS tour_image_id,
  t.canonical_url, t.page_id,
  p.intro_text, p.summary, p.image_id AS page_image_id, p.ntag_ids AS page_ntag_ids,
  area_lookup.region_name,
  (SELECT COUNT(*) FROM tour_item ti WHERE ti.tour_id = t.id) AS day_count,
  (SELECT string_agg(
       COALESCE(ti.title, '') || ' ' || COALESCE(regexp_replace(ti.description, '<[^>]+>', '', 'g'), ''),
       E'\n' ORDER BY ti.position NULLS LAST, ti.id)
   FROM tour_item ti WHERE ti.tour_id = t.id) AS day_text,
  COALESCE(
    (SELECT array_agg(tg.alias ORDER BY tg.id)
     FROM tag tg
     WHERE tg.id = ANY(p.ntag_ids) AND tg.type = 'activity'),
    '{}'::text[]
  ) AS activity_aliases
FROM tour t
LEFT JOIN page p ON p.id = t.page_id
LEFT JOIN LATERAL (
  SELECT a.name AS region_name
  FROM area a
  JOIN tag tg ON tg.alias = a.alias
  WHERE tg.id = ANY(p.ntag_ids)
    AND tg.type = 'area'
  ORDER BY a.id ASC
  LIMIT 1
) area_lookup ON true
WHERE t.canonical_url IS NOT NULL
```

**Row composition rules:**

| Output | Source | Notes |
|---|---|---|
| `headline` | `tour.title` (= `page.title`) | non-null by construction (C.focused-shamir-1 guarantees) |
| `vibe_line` | `page.summary` first, else `page.intro_text` first sentence, else `null` | summary is the curated page-level pitch; intro_text is the secondary. Both already stripped of CMS WYSIWYG decorative whitespace (C.brave-pare-3 — connector boundary; but compose reads raw `page` text, so strip HTML inline here too: same `stripHtml` helper trip-card uses) |
| `region` | `area_lookup.region_name` | lowest-area.id wins (mirrors C.brave-pare-2 trip rule) |
| `day_count` | `COUNT(tour_item)` | 0 for tour 2 ("Luxury Best of Patagonia" — legitimately has 0 day-rows); card still emits with `day_count: 0` and `dayCount` field omitted from the ProposalCard (zod optional) |
| `duration_days` | `day_count` (or `null` if `day_count = 0`) | aliased for query-shape parity; can diverge later |
| `image_id` | `tour.image_id` first; fallback to `(SELECT image_id FROM image_page WHERE page_id = t.page_id ORDER BY position NULLS LAST LIMIT 1)` if null | mirrors trip's image-trip → image-page fallback (HITL Q4 / C.39). Without this, 3 of 11 tours (75/76/77) have null images and render blank-image cards |
| `activity_tags` | `activity_aliases` | page's activity-typed tag aliases |
| `canonical_url` | `tour.canonical_url` | from the page; non-null by construction |
| `from_price` / `currency_code` / `accommodation_style` / `group_size_max` | always `NULL` | no source columns |
| `embedding` text | `${headline} ${vibe_line} ${stripHtml(day_text).slice(0, 500)}` | tour_item titles + bodies form the corpus that distinguishes one tour from another (titles alone are too short to embed well) |
| `content_hash` | `contentHash(embedInput, 'tour_card')` | gates the embed-derived pass; only changed rows pay tokens |
| `tsv` | `to_tsvector('english', headline || ' ' || vibe_line || ' ' || region)` | full-text on the same fields as trip_card |

**Idempotency**: `TRUNCATE tour_card; INSERT FROM SELECT` (mirrors trip_card). The follow-on `embedDerivedTable` pass is `content_hash`-gated — unchanged rows don't re-embed. (Confirmed against [`enrich/embed/derived-rows.ts`](../product/ingestion/src/enrich/embed/derived-rows.ts) — same path used for trip_card.)

**Wire into `enrich/run.ts`**:
- Add `import { composeTourCard } from './compose/tour-card.js';`
- Add a compose step after `passResults['compose:trip_card']`: `passResults['compose:tour_card'] = await composeTourCard({client, dryRun});`
- Add an embed-derived step in the `!dryRun` block mirroring `embed:trip_card`: `passResults['embed:tour_card'] = await embedDerivedTable({client, embeddingClient, ledger, table: 'tour_card', textColumn: 'headline', embedColumn: 'embedding', ledgerKey: 'gemini:tour_card', populateTsv: false, idColumn: 'integer'});`
- Add `'tour_card'` to the `readDerivedRowCounts` table list.

(Note re `textColumn: 'headline'`: trip_card passes `'headline'` here but the actual embed input is built inside `embedDerivedTable` from row-shape — verify against trip_card's behaviour in execution. If the embed pass needs the *full* composed text, store `embed_text` on the row or have `embedDerivedTable` accept a concat-fn. Execution to confirm.)

### 2.3 `queryTourCardsByFilter` — connector data primitive

New file: `product/connector/src/data/query-tour-cards.ts`. Mirrors [`query-trips.ts`](../product/connector/src/data/query-trips.ts) closely.

**Signature:**

```typescript
export interface QueryTourCardsOptions {
  region?: string | null;
  durationMin?: number | null;        // mapped to day_count >= N
  durationMax?: number | null;        // mapped to day_count <= N
  activity?: string | null;
  // groupSizeMax / budgetBand / accommodationStyle: accepted but no-op for v2
  // (all NULL on every row today). Schema-compatible; future-proof.
  budgetBand?: BudgetBand | null;
  accommodationStyle?: string | null;
  groupSizeMax?: number | null;
  limit: number;
}

export async function queryTourCardsByFilter(
  client: pg.PoolClient,
  opts: QueryTourCardsOptions,
): Promise<TourProposalCard[]>;
```

**SQL shape:**

```sql
SELECT id, slug, headline, vibe_line, region, day_count, duration_days,
       from_price, currency_code, image_id, accommodation_style,
       COALESCE(activity_tags, '{}') AS activity_tags,
       canonical_url
FROM tour_card
WHERE 1=1
  /* region ILIKE $N (when provided) */
  /* day_count >= durationMin / <= durationMax (when provided) */
  /* activity = ANY(activity_tags) */
LIMIT $N
```

**Return mapping** to `TourProposalCard` ([ts-common/src/tools.ts:367-378](../product/ts-common/src/tools.ts#L367)):
- `type: 'tour'` literal
- `id: String(row.id)` (schema requires string)
- `slug`, `headline`, `vibeLine`, `region`, `canonicalUrl` — direct
- `durationDays`, `groupSizeMax`, `dayCount` — omit (zod optional) if null
- `fromPrice: null` (always today)
- `currencyCode`: omit if null
- `accommodationStyle`: omit if null
- `activityTags`: pass through
- `image`: resolved via the same shared image-projection helper trip uses (`projectImage(row.image_id)` or similar — check [query-trips.ts](../product/connector/src/data/query-trips.ts) for the exact call)

**Empty-result behaviour**: returns `[]`. The widget empty-state silence (D.brave-pare-1) handles the agent-prose layer.

### 2.4 Handler dispatch — the one-line swap

In [`product/connector/src/tools/find_options.ts`](../product/connector/src/tools/find_options.ts):

```typescript
// Before:
case 'tour':
  // v2 fallback: until Swoop populates the `tour` table, route through
  // the trip primitive so Sonnet's tour-preference still produces
  // *something*. Decision C.bf-6. v2 PR swaps this branch.
  return queryTripCardsByFilter(client, filters);

// After:
case 'tour':
  return queryTourCardsByFilter(client, filters);
```

Update the header docstring (line ~19): `'tour' → queryTourCardsByFilter (live, post-v2 / C.focused-shamir-2)`.

**`blendCards` is updated to a four-way even split** (HITL Al, 2026-05-15). Today's blend (C.bf-3) is `tripQuota = floor(N/2)`, `hotelQuota = ceil((N-trip)/2)`, `regionBaseQuota = N - trip - hotel` — at `limit=4` that's 2 trips + 1 hotel + 1 region_base. v2 makes it:

```typescript
const base = Math.floor(filters.limit / 4);
const remainder = filters.limit - base * 4;
const tripQuota = base + remainder;     // trips absorb the remainder
const tourQuota = base;
const hotelQuota = base;
const regionBaseQuota = base;
```

At the default `limit=4`: **1 of each variant.** At `limit=5`: 2 trips + 1 of each other. At `limit<4`: drops to trips-only (Sonnet's default is 4, so this rarely fires).

Deficit redistribution (the `out.length < filters.limit` top-up at the end of `blendCards`) stays as "query additional trips" — trips remain the most populous source and the natural deficit-filler. No tour-specific top-up; an empty tour quota stays empty rather than triggering an extra query.

The framing — `find_options`'s default is **imagination-stoking variety**, not population-weighted fairness or single-type dominance. The four-way mix puts every product type in the typical 4-card response.

### 2.5 Variety mechanics

Imagination-stoking demands variety — and the agent needs an explicit lever when it knows specific items shouldn't repeat. Two complementary mechanisms, both light: passive randomness as the default plus an explicit agent-supplied exclude list.

#### 2.5.a Random ordering by default — all four primitives

Imagination-stoking demands variety. Today, every card-query primitive uses a deterministic `ORDER BY` (cheapest-first / most-popular-first / etc.); same-filter calls return identical card sets every time. There's no session-side shown-card tracker either ([orchestrator's `SessionState`](../product/orchestrator/src/session/) carries `conversationHistory` but no shown-card surface). Result: repetition is structural.

Switch all four primitives to `ORDER BY RANDOM(), <id-column>` (id as a stable tiebreaker in the vanishingly-rare random-collision case):

| Primitive | File | Was | Becomes |
|---|---|---|---|
| `queryTourCardsByFilter` (new) | `connector/src/data/query-tour-cards.ts` | — | `ORDER BY RANDOM(), id` from inception |
| `queryTripCardsByFilter` | [`query-trips.ts:94`](../product/connector/src/data/query-trips.ts#L94) | `duration_days NULLS LAST, from_price NULLS LAST, id` | `ORDER BY RANDOM(), id` |
| `queryHotelCardsByFilter` | [`query-hotels.ts:139`](../product/connector/src/data/query-hotels.ts#L139) | `MIN(hp.price) NULLS LAST, h.id` | `ORDER BY RANDOM(), h.id` |
| `queryRegionBaseCardsByFilter` | [`query-region-bases.ts:107`](../product/connector/src/data/query-region-bases.ts#L107) | `atc.trip_count DESC NULLS LAST, a.id` | `ORDER BY RANDOM(), a.id` |

**Implications worth naming:**
- Loses the implicit "cheapest first / most-popular first" ranking semantics on three of the four primitives. Aligned with the variety-first framing of C.focused-shamir-3: `find_options` is for surfacing the *range*, not for ordering by a single ranking axis. Visitors who want cheapest filter with `budgetBand`; visitors who want a popular base get the existing `trip_count >= 1` viability gate (still applies — only viable bases are candidates).
- Existing tests that asserted specific cards in specific positions need updating to assert (count, shape, member-of-set) rather than ordering. The list of affected tests will surface during step 8.
- `ORDER BY RANDOM()` is a full sort over the filtered candidate set. For these pools (max ~852 trips post-filter, far less for hotels / region_bases / tours), it's trivial.
- **Critical scope clarification**: `find_options` remains pure structured-filter (region / duration / budget / activity / accommodationStyle / preferredType). The `_card.embedding` columns exist on every variant but are used by sibling tools (find_inspiring, find_someone_who), **not** as a ranking layer above find_options. If a future design wants free-text hints + hybrid filter+semantic ranking inside find_options, that's a separate Tier 3 decision — explicitly out of scope here.

**Deferred follow-up (Option C from the 2026-05-15 design conversation)**: full session-scoped "shown card" tracker. Adds `SessionState.shownCards: { [type]: number[] }`, threads it through `ToolHandlerDeps`, excludes in WHERE clauses, mutates after the tool returns, handles small-pool exhaustion. Substantial lift; revisit only if live use shows random + agent-exclude (§2.5.b) doesn't give enough variety. The small pools (tours=11, region_bases<30) are the most likely surfaces for "still repeats" complaints.

#### 2.5.b Agent-supplied exclude list

When the agent already knows specific cards shouldn't repeat (it surfaced them last turn, the visitor explicitly asked for "different options", or it's deliberately rotating an upsell), it can pass an explicit exclude list. This is the agent's lever — connector remains stateless; Sonnet is the source of truth for what's been shown.

**Schema** ([@swoop/common — tools.ts](../product/ts-common/src/tools.ts), extend `FindOptionsInputSchema`):

```typescript
exclude: z
  .array(
    z.object({
      type: z.enum(['trip', 'tour', 'hotel', 'region_base']),
      id: z.string(),
    }),
  )
  .optional()
  .describe(
    'Cards to omit from the result. Use to avoid repeating items shown earlier in the conversation (the agent owns its own history; the tool does not track it).',
  ),
```

Mirrors the discriminated `ProposalCardPublicSchema` shape so the agent can echo ids straight from previous tool results.

**Dispatch** in [find_options.ts](../product/connector/src/tools/find_options.ts):
- Parse `input.exclude` (default to `[]`).
- For `preferredType: 'X'` dispatch: filter to `exclude.filter(e => e.type === 'X').map(e => Number(e.id))` and pass to the primitive.
- For the four-way blend (§2.4): split by type at the same point each parallel query is issued — each primitive receives only its own type's excludes (distinct id spaces; a trip-id 369 is irrelevant to the tour primitive).

**Primitive interface** — each `Query*CardsOptions` gains `excludeIds?: number[]`. SQL adds (only when populated):

```sql
AND id <> ALL($N::int[])
```

`<> ALL` is empty-array safe — same code path handles "no excludes" and "with excludes" with no branching.

**Tool description** ([cms/prompts/tools/find_options/description.md](../product/cms/prompts/tools/find_options/description.md)) gains a short paragraph telling Sonnet the affordance exists and how to use it — *"If the visitor has rejected options you've shown earlier or you want fresh ones this turn, pass them via `exclude` as `{type, id}` objects. The tool does not track session history; you do."*

**Observability** — emit a `find_options.exclude_count` event when `exclude.length > 0` (post-M4 observability surface). Tells us whether Sonnet actually uses the lever once we're in front of real users. Wire deferred — `ToolHandlerDeps` doesn't yet expose an `emitEvent` channel (see C.bf-6 §2.5 note); add when that affordance lands.

### 2.6 Tests

Mirror the v3 backfill test layout. Per-file expected coverage:

- **`enrich/__tests__/compose-tour-card.test.ts`** (new): in-memory pg mock or test pool —
  - Happy path: tour with day_count > 0, page joined, region resolved → expected row shape.
  - Tour with day_count = 0 (tour 2 in real data) → row emitted, dayCount null in card.
  - Tour with null `tour.image_id` → image fallback to `image_page` returns expected id.
  - Tour with no area-typed tag on its page → `region: null`.
  - `content_hash` deterministic across re-runs.
- **`connector/__tests__/query-tour-cards.test.ts`** (new):
  - All filters apply (region, durationMin/Max via day_count, activity).
  - Returns valid `TourProposalCard[]` (zod-parse each result).
  - Null-fields-as-optional behaviour (`fromPrice: null`, omitted optionals).
- **`connector/src/tools/__tests__/find_options.test.ts`** (existing — extend):
  - Add a `preferredType: 'tour'` case asserting the new primitive is called and tour cards come back (not trip cards).
  - Existing tests for trip / hotel / region_base / undefined (blend) must stay green — but **assertions on specific ordering need to relax** (§2.5 changes all four primitives to `ORDER BY RANDOM()`). Existing position-asserting tests update to assert `{count, shape, member-of-set}` instead of "card at index 0 has id=X".
- **Existing primitive tests** — `query-trips.test.ts`, `query-hotels.test.ts`, `query-region-bases.test.ts` — sweep for ordering assertions and relax them. Also: a new case per primitive — pass `excludeIds: [<some-known-id>]` and assert that id is absent from the result.
- **`find_options.test.ts` (extended)** — a case asserting cross-type exclude filtering: an exclude entry of `{type: 'trip', id: '369'}` removes trip 369 from a `preferredType: 'trip'` call but has no effect on a `preferredType: 'tour'` call with the same exclude list.
- **Idempotency**: a second compose-tour-card run produces zero `content_hash` deltas (already covered by trip_card's idempotency test pattern).

### 2.7 Decisions to log

Propose four entries in [decisions.md](decisions.md), all wave-named to avoid concurrent collisions:

- **C.focused-shamir-2** — `tour_card` derived table + `queryTourCardsByFilter` make the populated `tour` table reachable; `find_options(preferredType: 'tour')` no longer falls back to trips. Supersedes C.bf-6. day_count is the day-signal; from_price/group_size_max/duration_days remain null on every row (no source).
- **C.focused-shamir-3** — `find_options.blendCards` becomes a four-way even split across `trip | tour | hotel | region_base`, extras to trips. At the default `limit=4`: 1 of each variant. Supersedes C.bf-3 (the 2-trip / 1-hotel / 1-region_base ratio). Rationale: `find_options`'s default is imagination-stoking *variety*, not population-weighted fairness or trip-heavy bias. Reversible: ratios are local to one function.
- **C.focused-shamir-4** — All four `find_options` card-query primitives switch from deterministic ranking to `ORDER BY RANDOM(), <id>`. Supersedes the implicit "cheapest first" / "most-popular first" ranking semantics in queryTripCardsByFilter / queryHotelCardsByFilter / queryRegionBaseCardsByFilter. Aligned with C.focused-shamir-3's variety framing. find_options is not a free-text-rankable surface (per C.t4 — pure structured filter); embedding-ranked retrieval lives in sibling tools (find_inspiring, find_someone_who). Session-scoped shown-card tracking deferred — revisit if live use shows random-only isn't enough.
- **C.focused-shamir-5** — `FindOptionsInputSchema` gains an optional `exclude: Array<{type, id}>` field; each primitive accepts `excludeIds?: number[]` and applies `AND id <> ALL($N::int[])`. Lets the agent explicitly omit cards it doesn't want to repeat (its own history, visitor-rejected options, deliberate upsell rotation). Connector remains stateless — agent (Sonnet) owns its own shown-history. Full `SessionState.shownCards` tracker (Option C) remains deferred; this is the lightweight middle path between pure-random and full session-tracking.

### 2.8 Doc updates (in the same PR)

- **`product/cms/prompts/tools/find_options/description.md`** — re-read; ensure the existing tour-upsell language (Luke's "always pitch tours when they fit" framing) still aligns now that tours are live. Update only if it still says "fallback".
- **`progress.md`** — flip the v2-tours line items (currently "still gated on Swoop populating the tour table") to ✅ landed; add row count to the live snapshot.
- **`next-steps.md`** — close the find_options v2 backfill item.
- **`discoveries.md`** — short entry on the tour-card patterns that diverged from trip-card (day_count vs duration_days; reliance on page-join for vibe/region; the always-null fields).

---

## 3. Architectural principles applied here

- **Mirror the existing pattern.** trip_card is the template; tour_card differs only where the source data forces it (no `tour.duration`, no `tour.description`, page-as-hub for identity). Every divergence has a comment pointing at the constraint.
- **Treat content as data.** Embedding text is computed from joined CMS prose (page.summary + tour_item titles/bodies). No hard-coded copy in TypeScript.
- **Pre-compose, then embed.** Mirrors C.t3a's "compose first, content_hash second, embed third" ordering — keeps the re-run loop cheap.
- **Future-proof shape without future-proofing logic.** `group_size_max`, `from_price`, `accommodation_style` columns exist on `tour_card` but every row writes NULL. When Swoop populates the source, the compose function's projection gets a value; no migration.
- **Tier-3 scope discipline.** No prompt edits beyond a verification re-read. No widget changes. No new tools. v2 closes the find_options polymorphism roadmap; nothing more.

---

## 4. Implementation order (TDD-first, per superpowers TDD)

1. **Failing test**: `compose-tour-card.test.ts` happy-path — expect a row with `headline = 'Best of Patagonia'`, `dayCount = 6` etc. against a small fixture. Watch it fail (function doesn't exist).
2. **Migration 011** apply + smoke (`SELECT * FROM tour_card LIMIT 0` succeeds).
3. **`composeTourCard`** implement — green the failing test.
4. Add failing tests for: image fallback, region resolution, null tour_image, day_count=0. Implement until green.
5. **Failing test**: `query-tour-cards.test.ts` filter-application cases.
6. **`queryTourCardsByFilter`** implement — green.
7. **Failing test**: extend `find_options.test.ts` with the `preferredType: 'tour'` real-primitive case.
8. **Dispatch swap** in `find_options.ts`. All find_options tests green.
8b. **Ordering swap** (per §2.5.a): change `ORDER BY` to `RANDOM(), <id>` in `query-trips.ts`, `query-hotels.ts`, `query-region-bases.ts` (tour is born random). Sweep existing primitive tests; relax position-asserting checks to count/shape/member-of-set; tests green.
8c. **blendCards swap** in `find_options.ts` to the four-way even split (per §2.4). Update / add the blend test to assert variety-presence at `limit=4`.
8d. **Exclude affordance** (per §2.5.b): extend `FindOptionsInputSchema` in `@swoop/common/tools.ts` with the optional `exclude` field. Each primitive's `Options` interface gains `excludeIds?: number[]`; SQL gains `AND id <> ALL($N::int[])` (empty-safe). `find_options.ts` dispatch splits the exclude list by type for each primitive call (preferredType + blendCards both routes). Test per primitive + a cross-type-isolation test in `find_options.test.ts`. Update `cms/prompts/tools/find_options/description.md` to document the affordance for Sonnet.
9. Wire into `enrich/run.ts` (compose + embed-derived steps + tally).
10. Run `npm run typecheck` + `npm run lint` + `npm test` across all touched workspaces. Green.
11. Run `enrich:dry-run` then `enrich --mode=compose`. Verify `tour_card` count = 11, embeddings populated, no token cost on second run.
12. Live smoke (§5).
13. Doc sweep + decision log entries.

---

## 5. Verification

### Fresh-install gate (per the 2026-05-13 false-green lesson — `feedback_swarm_fresh_install_verify.md`)

```sh
cd product
rm -rf node_modules package-lock.json
npm install
npm run typecheck
npm run lint
npm test
```

### Sweep checks

```sh
# tour_card populated, all 11 with embeddings + non-null headlines
psql "$DATABASE_URL" -c "
  SELECT count(*) AS rows,
         count(headline) AS with_headline,
         count(embedding) AS with_embedding,
         count(region) AS with_region
  FROM tour_card;
"
# expect rows = 11, with_headline = 11, with_embedding = 11, with_region ≥ 8

# day_count distribution (sanity-check against MariaDB pre-fix verification)
psql "$DATABASE_URL" -c "
  SELECT day_count, count(*) FROM tour_card GROUP BY day_count ORDER BY day_count;
"
# expect: 0→1 (tour 2 — "Luxury Best of Patagonia"), 2→3, 3→1, 4→2, 5→2, 6→1
# total = 11

# Drift guard — every kept tour still has pagetype = 'Itinerary' on its page
psql "$DATABASE_URL" -c "
  SELECT tc.id, tc.headline
  FROM tour_card tc
  JOIN tour t ON t.id = tc.id
  JOIN page p ON p.id = t.page_id
  WHERE p.pagetype_title <> 'Itinerary';
"
# expect 0 rows
```

### Live-data smoke (boot the stack)

```sh
# Terminal 1: connector
npm run -w @swoop/connector dev
# Terminal 2: orchestrator
npm run -w @swoop/orchestrator dev
# Terminal 3: UI
npm run -w @swoop/ui dev
```

In the chat surface:
- Ask: *"What guided tours do you have for Patagonia?"* — Sonnet should call `find_options({preferredType: 'tour', region: 'Patagonia'})` and the response should contain real tour cards (e.g. "Highlights of Patagonia", "Best of Patagonia", "Torres del Paine W Trek & Backcountry Kayaking") — not trip cards. Verify in the orchestrator's structured logs: `tool.invoked find_options ok` and the response's `cards[*].type === 'tour'`.
- Ask: *"What are some Patagonia options?"* — Sonnet should call `find_options` without `preferredType`. Result should still be trip+hotel+region_base blend (no tours unless §7 Q1 changes the recommendation).

### What the UI should render

Per the v1 tour-card spec (already shipped against fixtures): card with headline, region badge, vibe-line, day-count badge ("6-day itinerary"), image. No price line (from_price null). No group-size badge (group_size_max null). Activity tags as chips.

If the card renders any of the always-null fields with placeholder text ("from £undefined", etc.), the v1 widget needs a `null` guard — verify before claiming done.

---

## 6. HITL — resolutions

Four design calls ratified by Al 2026-05-15.

**Q1 — should tours blend into the default `find_options` result mix?** **RATIFIED: yes.** `blendCards` becomes a four-way even split — at `limit=4` that's 1 trip + 1 tour + 1 hotel + 1 region_base; extras to trips. The framing is imagination-stoking *variety*, not population-weighted fairness or trip-heavy bias (today's C.bf-3 is 2 trips + 1 hotel + 1 region_base — trip-leaning and missing tours). Implementation in §2.4; decision logged as C.focused-shamir-3 (supersedes C.bf-3).

**Q2 — embedding-text shape for tours with empty tour_items?** **RATIFIED: fall through gracefully.** Tour 2 ("Luxury Best of Patagonia") has 0 tour_items; its embed input becomes `${headline} ${vibe_line}` only (~30-100 chars). Acceptable — `find_options` is for surfacing options to stoke imagination, not for building itineraries; the headline + page-summary content carries enough signal for semantic retrieval. Tours with zero `tour_items` stay in `tour_card`.

**Q3 — repetition risk: how do we keep find_options returning fresh sets?** **RATIFIED: Option A — `ORDER BY RANDOM(), <id>` across all four primitives** (§2.5.a). Today's deterministic ordering means same-filter calls return identical card sets; nothing tracks "already shown" anywhere in connector or orchestrator. Random sampling after the WHERE clause is the lowest-cost variety lever and aligns with the imagination-stoking framing. Existing tests that asserted card ordering get relaxed (count + shape + member-of-set). Side correction during this conversation: `find_options` is *pure structured filter* (per C.t4) — the agent cannot supply free-text hint words to it for embedding-ranked retrieval; that capability lives in sibling tools (`find_inspiring` over `inspire_passage.embedding`, `find_someone_who` over `customer_story.persona_embedding`). The `_card.embedding` columns exist for cross-tool reuse, not as a `find_options` ranking layer.

**Q4 — agent-supplied exclude list?** **RATIFIED: yes** (§2.5.b). The lightweight middle path between pure-random and full session-tracking: agent passes `exclude: Array<{type, id}>` on `find_options` calls; each primitive applies `AND id <> ALL($N::int[])` over its own type's excludes. Connector stays stateless; Sonnet owns its own shown-history (which it has in context anyway). Reversible cheaply: deprecate the field if observed unused. Full `SessionState.shownCards` tracker (Option C) remains deferred for now — revisit only if random + agent-exclude proves insufficient under live use.

---

## 7. Coordination with siblings

- **C.t3a** (enrich pipeline) — owns the embed-derived pass. The tour_card embed step plugs into existing infrastructure (`embedDerivedTable`). Zero changes to embed_query, classify, or other compose tables.
- **C.bf-* (v3 backfill)** — defined `blendCards` and `preferredType` dispatch. v2 supersedes C.bf-6 (the tour-fallback). Other v3 decisions stand.
- **Customertip work (pending)** — orthogonal. Customertips feed `customer_story` (Mirror), not `tour_card`. The two tranches don't touch the same files. Run in parallel branches if desired.
- **Worktree** — recommend continuing in `focused-shamir-52524c` (deps already installed; logically extends C.focused-shamir-1). Decision IDs `C.focused-shamir-{2,3}` follow. If Al prefers a fresh worktree (clean wave separation), name it and use a new decision-id prefix.

---

## 8. Effort estimate

**~¾ day (6–8 hours)** for a single executor:
- Migration + schema work: 30m
- `composeTourCard`: 90m (mirror trip-card; the LATERAL join for region is the only novel bit)
- `queryTourCardsByFilter`: 60m (mirror queryTripCardsByFilter)
- `find_options` dispatch + blendCards four-way split + test extension: 45m
- ORDER-BY swap on trip/hotel/region_base primitives + existing-test sweep: 60m
- Exclude affordance: schema field + per-primitive `excludeIds` + dispatch split + per-primitive tests + cross-type-isolation test + prompt doc update: 60m
- TDD-driven tests across the three new files: 90m
- Doc + decision sweep + live smoke: 60m

The risk is in the embed pass shape (`embedDerivedTable` parameter conventions for the new row type). Trip_card's wiring is the reference; cross-check during execution.

---

## 9. Open items at execution

These don't block the plan but the executor should resolve them inline:

1. The exact `embedDerivedTable` parameter shape (`textColumn` semantics) — confirm against trip_card's wiring during step 9.
2. The image-projection helper used by `queryTripCardsByFilter` — re-use for tour cards verbatim; if it returns `null` for null image_id, the `image` field on the card is `undefined` (zod-optional) → renderer falls through. Verify.
3. The `find_options.tour_fallback` event noted as deferred in C.bf-6 §2.5 — by removing the fallback, that event is moot. Note in the decision entry.
