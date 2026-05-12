# 03 — Execution: Crosscut — `find_options` polymorphism (ProposalCard discriminated union)

**Task**: settle the polymorphic contract for `find_options` so that the tool's `cards: ProposalCard[]` output discriminates over `trip | tour | hotel | region_base`, and ship the implementation in three tranches: v1 trips-only (matches today's behaviour); v2 trips + tours (Luke upsell priority); v3 + hotels + region_bases.

**Crosscut owner**: spans `@swoop/common` (schema), `@swoop/connector` (handler + data primitives), `product/cms/prompts/tools/find_options/description.md` (tool description rewrite). Sits between the closed chunk C (data + tool contracts) and the in-flight chunk D (UI).

**Why crosscut**: not a chunk-C nor chunk-D plan because it changes the C.t2 settled contract (`@swoop/common` schemas) while also gating D.t9's UI work. The right shape is one Tier 3 plan owning the cross-workspace change, executed before D.t9's widget executor and before the find-options handler tranches v2/v3.

**Implements**: HITL ratification 2026-05-12 (the `find_options` discussion). Captured in [`03-exec-chat-surface-t9.md`](03-exec-chat-surface-t9.md) §"HITL ratification record" item 4.

**Depends on**:
- C.t2 closed (eight intent-named tool schemas + five `*PublicSchema` projections settled in `@swoop/common`). This plan extends `FindOptionsOutputPublicSchema` from `cards: TripCardPublic[]` to `cards: ProposalCard[]` (discriminated union).
- C.t4 closed (eight tool handlers wired over data primitives in `product/connector/src/tools/`). v1 of this plan refactors `find_options.ts` to return the discriminated shape; v2/v3 extend the data layer.
- Migration 002 + 003 (domain tables: `trip`, `tour`, `tour_item`, `hotel` all exist; `area` + `page` cover region_base derivations).

**Pairs with**: [`03-exec-chat-surface-t9.md`](03-exec-chat-surface-t9.md). The crosscut's v1 tranche MUST land before D.t9's UI executor — the UI widget imports the discriminated union shape from `@swoop/common`. The UI plan ships all four card-variant renderers day-one against fixtures; the v2/v3 tranches unlock live data for tour/hotel/region_base cards downstream.

**Blocks**: D.t9 closure. D.t9 can author + ratify + execute, but the UI's "tour-card live-data smoke" verification waits on this plan's v2 tranche; "hotel-card / region-base-card live-data smoke" waits on v3.

**Produces**:
- `product/ts-common/src/tools.ts` — **edit** — replace `FindOptionsOutputPublicSchema` with the polymorphic shape (see §2.1).
- `product/ts-common/src/__tests__/tools.test.ts` — **edit** — extend tests for discriminated union round-tripping.
- `product/ts-common/src/fixtures/find-options.ts` — **edit (or new file)** — add fixtures for tour / hotel / region_base variants so D.t9 widget tests have something to render.
- `product/cms/prompts/tools/find_options/description.md` — **rewrite** — update tool description so Sonnet knows it can return mixed proposal types and how to choose per conversational signal. Includes the Tours upsell instruction (Luke priority).
- `product/connector/src/tools/find-options.ts` — **edit** — v1 handler returns trip cards in the new discriminated shape (`{ type: 'trip', ... }`). v2 + v3 land in subsequent tranche commits.
- `product/connector/src/data/find-options.ts` (or wherever the data primitive lives) — **edit (v1) + extend (v2/v3)** — v2 adds `findTourOptions(filter)` data primitive; v3 adds `findHotelOptions(filter)` + `findRegionBaseOptions(filter)`. The handler stitches results from multiple primitives based on the agent's input signal (or a per-type weighting).
- `product/connector/src/tools/__tests__/find-options.test.ts` — **extend** — v1 tests assert discriminated shape; v2/v3 add per-type tests.
- `planning/decisions.md` — append entries for the contract extension, the tranche strategy, the Tours-as-distinct-from-Trips ruling, the "settle contract day-one" discipline.
- `questions.md` — add a Swoop ask under "Open / Data pipeline" for tour content population (15 source `tours` rows are mostly NULL-titled; v2 tranche is unlocked once Swoop populates).

**Estimate**:
- v1 tranche (contract + tool description + handler refactor returning discriminated trip cards + fixtures + tests): ~0.5 day.
- v2 tranche (tour data primitive + handler integration + per-type selection logic + tour-card live-data verification): ~1 day. **Gated on Swoop populating the `tour` table.**
- v3 tranche (hotel + region_base data primitives + handler integration + per-type selection logic): ~1–1.5 days. Hotel content already exists in the dump (44 rows in `hotel` table per C.t3 live-counts); region_base is derived from `page` + `area`. **Not gated on Swoop input.**

---

## ★ Read this first — why polymorphic

The conversational moment `find_options` serves is *"propose concrete options the visitor can compare"*. A visitor who's narrowed to *"a 7-day Patagonia trip in March, mid-budget"* gets trip cards. A visitor who's gravitated to *"I want a guided experience with a small group"* gets tour cards (group-size becomes a salient affordance). A visitor who's asked *"where could we base ourselves to explore Torres del Paine?"* gets hotel cards (per-night pricing, location-anchored) or region-base cards (page + area-anchored, "use this region as a base"). A visitor in the early Strong-Consideration phase could get a mixed set.

**This is theme-11 top-down reasoning, not bottom-up.** The conversational moment doesn't change per proposal type — it's the same job. What changes is the *shape of the concrete option* that lands at that moment. The bottom-up alternative — separate `find_trips` / `find_tours` / `find_hotels` tools — would fragment Sonnet's tool-selection rationale ("which tool? hmm, depends on the visitor's last sentence…") and dilute the intent-named-tool surface theme 11 was authored against.

**One tool, polymorphic output.** Sonnet picks `find_options` whenever the conversational moment is "propose concrete options"; the connector handler + the agent's input filter decide which proposal type(s) come back.

The previously-deleted `SearchResultsWidget` had uniformly-shaped polymorphism ("any entity rendered as the same card"). That was bottom-up. This plan's polymorphism is the *inverse* — each card type renders with its right visual register; the discriminator carries.

---

## 1. Outcome

When this task is done (across all three tranches):

- `@swoop/common` exports `ProposalCardPublicSchema` as a discriminated union with four variants (`trip | tour | hotel | region_base`). `FindOptionsOutputPublicSchema` is updated to `{ cards: ProposalCardPublic[], count }`.
- `product/cms/prompts/tools/find_options/description.md` describes the polymorphism and tells Sonnet how to pick between trip / tour / hotel / region_base based on conversational signal. Explicitly names Tours as Luke's upsell priority.
- `product/connector/src/tools/find-options.ts` returns the discriminated shape from day one. v1 returns only trip variants; v2 adds tour; v3 adds hotel + region_base.
- D.t9's UI widgets render against the polymorphic shape from day one (the crosscut plan + D.t9 execute against the same `@swoop/common` schema).
- Swoop is asked to populate the `tour` table; v2 tranche unblocks when they do.

Not outcomes:
- Schema changes to migrations (the tables exist; this plan only changes the projection layer).
- New tools (`find_options` stays the single tool surface for the propose-options job).
- UI widget design (D.t9 owns that).
- Cost / pricing display rules per type (already settled — see §2.3).

---

## 2. Target functionalities

### 2.1 `ProposalCardPublicSchema` discriminated union (`@swoop/common`)

New schema in `product/ts-common/src/tools.ts`:

```ts
// Shared base for every proposal card variant — what the UI always renders
// (image + headline + vibe-line + deep-link CTA + region context).
const ProposalCardBaseSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
  headline: z.string(),
  vibeLine: z.string().optional(),
  region: z.string().optional(),
  fromPrice: z.number().nullable().optional(),
  currencyCode: z.string().optional(),
  canonicalUrl: z.string(),
  image: DerivedImagePublicSchema.optional(),
});

// Trip — flexible package. Today's shape (preserved); migrated to discriminated.
const TripProposalCardSchema = ProposalCardBaseSchema.extend({
  type: z.literal('trip'),
  durationDays: z.number().int().positive().optional(),
  accommodationStyle: z.string().optional(),
  activityTags: z.array(z.string()).default([]),
});

// Tour — guided fixed-itinerary group product (per schema's `tour` + `tour_item`).
// Group-size and day-by-day affordance are the discriminators vs trip.
const TourProposalCardSchema = ProposalCardBaseSchema.extend({
  type: z.literal('tour'),
  durationDays: z.number().int().positive().optional(),
  groupSizeMax: z.number().int().positive().optional(),
  dayCount: z.number().int().positive().optional(), // count of tour_item rows
  accommodationStyle: z.string().optional(),
  activityTags: z.array(z.string()).default([]),
});

// Hotel — accommodation as a concrete option (location-anchored, /night pricing).
const HotelProposalCardSchema = ProposalCardBaseSchema.extend({
  type: z.literal('hotel'),
  location: z.string().optional(),
  starRating: z.number().int().min(1).max(5).optional(),
  accommodationStyle: z.string().optional(),
  pricingUnit: z.literal('per_night').default('per_night'),
});

// Region-base — a region/area framed as a launchpad ("use this as a base, explore around").
const RegionBaseProposalCardSchema = ProposalCardBaseSchema.extend({
  type: z.literal('region_base'),
  nearbyTripsCount: z.number().int().nonnegative().optional(),
  baseFraming: z.string().optional(), // e.g. "Use El Calafate as a base for…"
});

// The discriminated union.
export const ProposalCardPublicSchema = z.discriminatedUnion('type', [
  TripProposalCardSchema,
  TourProposalCardSchema,
  HotelProposalCardSchema,
  RegionBaseProposalCardSchema,
]);
export type ProposalCardPublic = z.infer<typeof ProposalCardPublicSchema>;

// FindOptionsOutput evolves accordingly.
export const FindOptionsOutputPublicSchema = z.object({
  cards: z.array(ProposalCardPublicSchema),
  count: z.number().int().nonnegative(),
});
```

`TripCardPublicSchema` (the prior name) is **superseded** — remove from exports; D.t9 imports `ProposalCardPublicSchema` and narrows via `type === 'trip'` where needed. No grace period: B.t3a already retired deprecated schemas verbatim; this plan does the same for `TripCardPublicSchema` since C.t4 is the only consumer and refactors in-place.

### 2.2 Tool description rewrite (`product/cms/prompts/tools/find_options/description.md`)

Current description (excerpt): *"The output is two to four trip cards: image, headline, one-line vibe pitch, region, headline price, duration, and a canonical URL."*

Rewrite must teach Sonnet:
- The tool returns 2–4 cards; each card is one of `trip | tour | hotel | region_base`.
- **When to expect trip cards**: visitor wants a self-contained package; flexible duration; can be private or join-a-group.
- **When to expect tour cards**: visitor signals preference for guided group experience, "small group", "with a guide", or asks about group size or itinerary structure. **Luke's priority**: when the conversational signal could go either way, lean toward surfacing tours — they're a distinctive Swoop product and a key upsell motion.
- **When to expect hotel cards**: visitor asks "where could we stay", asks about specific accommodation styles, or has signalled a base-and-explore intent rather than a packaged-trip intent.
- **When to expect region_base cards**: visitor is choosing the launchpad region first, trip second ("we're thinking Torres del Paine — what's the best base?").
- The agent doesn't pick the type; the tool picks the type based on the agent's input filter + the data's match against the conversational signal. If the agent wants to steer toward Tours, it sets `preferredType: 'tour'` (or similar) in the input.
- Mixed sets are allowed and often the right answer.

Filter input gets extended to optionally express preference:

```ts
export const FindOptionsInputSchema = z.object({
  // … existing filters …
  preferredType: z.enum(['trip', 'tour', 'hotel', 'region_base']).optional(),
});
```

When `preferredType` is set, the handler weights toward that type. When unset, the handler picks the best-matching set across types based on the filter + the data's coverage.

### 2.3 Per-type pricing rendering rules (settles a UI question via schema)

Already in D.t9; restated here so the contract carries the intent:

- `trip` / `tour` / `region_base`: *"from £X"* (total). Matches decision C.14 (no departures / headline pricing only).
- `hotel`: *"from £X / night"*. Per-night framing; the schema's `pricingUnit: 'per_night'` literal carries this discriminator so the UI can branch deterministically.

If `fromPrice` is null, no price line renders (per D.t9 §"`find_options`"). The schema allows nullable `fromPrice` already.

### 2.4 Connector handler tranches

**v1 (contract refactor; ships day-one with the schema change):**
- `find-options.ts` handler queries `trip` table (current behaviour).
- Maps each row to `{ type: 'trip', ... }` (NEW: the type literal).
- Returns `{ cards: ProposalCardPublic[], count }` with all cards `type === 'trip'`.
- Tests assert: shape valid against `FindOptionsOutputPublicSchema`; discriminator present on every card.
- D.t9 UI executes against this contract.

**v2 (Luke priority — tours):**
- Adds `findTourOptions(filter)` data primitive in `product/connector/src/data/`. Joins `tour` + `tour_item` (count) + `area` (region).
- `find-options.ts` handler dispatches based on `preferredType` (when present) or the filter's content alignment with tour content (when absent).
- Selection logic: if `preferredType === 'tour'` → only tours; if unset and filter aligns better with tours (e.g. "guided", "group" in the signal) → tours; otherwise mixed or trips-only.
- Tests assert: tour cards include `groupSizeMax` + `dayCount`; selection logic respects `preferredType`.
- **Gated on Swoop populating the `tour` table.** Tracking question added to `questions.md` (§2.7 below).

**v3 (hotels + region_bases):**
- Adds `findHotelOptions(filter)` data primitive. Joins `hotel` + `location` (location) + `area` (region).
- Adds `findRegionBaseOptions(filter)` data primitive. Derives from `area` + `page` (region pages) + a count of nearby trips per region.
- `find-options.ts` handler extends the dispatch logic to cover all four types.
- Tests assert: hotel cards include `starRating` + `pricingUnit: 'per_night'`; region_base cards include `nearbyTripsCount`.
- **Not gated on Swoop input.** Hotel data exists (44 rows live per C.t3); region_base is fully derivable.

### 2.5 Fixtures

`product/ts-common/src/fixtures/find-options.ts` adds:
- `SampleFindOptionsOutputTripsOnly` — current shape, all `type: 'trip'`.
- `SampleFindOptionsOutputToursOnly` — new, all `type: 'tour'`.
- `SampleFindOptionsOutputMixed` — one card of each type (4 cards).
- `SampleFindOptionsOutputHotels` — new, all `type: 'hotel'`.
- `SampleFindOptionsOutputRegionBases` — new, all `type: 'region_base'`.

D.t9 UI widget tests consume these. Schema round-tripping tests in `@swoop/common` consume them.

### 2.6 Decisions to log (post-implementation)

Append to `planning/decisions.md`:

- **C.43** — `find_options` output is polymorphic. `ProposalCardPublicSchema` is a discriminated union over `trip | tour | hotel | region_base`. Reverses C.t2's TripCard-only contract. Rationale: top-down — the propose-options conversational moment ranges across proposal types; one tool, polymorphic output. Settle contract day-one; tranche backend.
- **C.44** — Tours are a structurally-distinct entity from Trips in the dump (`tour` table + `tour_item` day-by-day breakdown; `group_size_max` is a tour-only column). Don't collapse to trips. Surface `groupSizeMax` + `dayCount` as tour-specific affordances. Luke's upsell priority lands in the tool description's "lean toward tours when signal could go either way".
- **C.45** — Tranche strategy: v1 trips → v2 tours (Swoop-data-gated) → v3 hotels + region_bases. Each tranche is an independent landing on top of the v1 contract.
- **C.46** — `findOptionsInput.preferredType` lets the agent steer the tool toward a specific proposal type when the conversational signal is decisive; when unset, the handler picks based on filter-to-data alignment.

### 2.7 Swoop ask (`questions.md` addition)

Add under "Open / Data pipeline":

> **Tour content population.** Source `tours` table has 15 rows but almost all are NULL-titled; `tour: 0/15` populated post-ETL per C.t3 live-counts. The `tour_item` table (day-by-day) has 36 rows but no parent. Question: is `tour` content intended to be populated, or is multi-region/tour content rendered via `contentblock_tour` rows referencing trips directly? Gates the v2 tranche of the find_options polymorphism plan (Luke's priority — Tours upsell). Route to Thomas/Richard.

---

## 3. Architectural principles applied here

- **Theme-11 top-down**: the polymorphism follows from the conversational moment ("propose options" job), not from the data shape. Schema reflects the right tool shape; data is plumbed.
- **One tool, polymorphic output**: keep the eight-tool surface intact. The agent picks the tool by job, not by data type.
- **Discriminator-first**: the `type` literal is the load-bearing field. Every card carries it. UI dispatches over it. Tests assert it. No untyped branching.
- **Day-one contract, tranched implementation**: every variant's renderer exists in the UI from day one (D.t9); every variant's schema exists in `@swoop/common` from day one (this plan); backend handlers ship in tranches. The UI is forward-compatible from day one without code changes when tranches land.
- **Settle once, never backtrack**: per HITL ratification 2026-05-12, future agents must not be allowed to assume `cards: TripCardPublic[]`. The deprecated name `TripCardPublicSchema` is removed in the same commit that introduces `ProposalCardPublicSchema`.
- **Data-shape lock-step**: the schema's per-type fields (groupSizeMax for tour, starRating for hotel, etc.) are exactly what the corresponding source table provides. No invented fields; no synthetic derived attributes (the one possible exception is `region_base.nearbyTripsCount` which is a count derivable from `trip` + `area`).

---

## 4. Implementation order

### v1 tranche (ships in lockstep with the schema change)

1. Extend `ProposalCardPublicSchema` in `product/ts-common/src/tools.ts` per §2.1. Remove `TripCardPublicSchema` export.
2. Update `FindOptionsOutputPublicSchema` to use the new union.
3. Extend fixtures: rewrite `SampleFindOptionsOutput` to use the discriminated shape (all-trip); add `SampleFindOptionsOutputMixed` for D.t9 widget tests.
4. Rewrite `cms/prompts/tools/find_options/description.md` per §2.2. Reference the Luke upsell priority for tours.
5. Refactor `product/connector/src/tools/find-options.ts` to return discriminated cards. v1 = trips only with `type: 'trip'` literal.
6. Update tests in `product/connector/src/tools/__tests__/find-options.test.ts` to assert the discriminator on every card.
7. Update tests in `product/ts-common/src/__tests__/tools.test.ts` to round-trip the discriminated union.
8. Append decisions C.43–C.46 to `planning/decisions.md`.
9. Add the Swoop ask to `questions.md` per §2.7.
10. Fresh-install verification gate (see §5).

### v2 tranche (Tours — gated on Swoop input)

1. Confirm Swoop has populated the `tour` table content. If not yet, halt — this tranche unlocks when content lands.
2. Add `findTourOptions(filter)` data primitive in `product/connector/src/data/`. Join `tour` + `tour_item` count + `area` for region.
3. Extend `find-options.ts` handler with tour selection logic per §2.4.
4. Extend `cms/prompts/tools/find_options/description.md` if Sonnet needs sharper guidance after seeing real data behaviour (likely; iterate post-smoke).
5. Add tour-specific tests.
6. Live-data smoke against D.t9's tour-card renderer.

### v3 tranche (Hotels + region_bases — not gated)

1. Add `findHotelOptions(filter)` + `findRegionBaseOptions(filter)` data primitives.
2. Extend handler dispatch logic to cover hotel + region_base types.
3. Extend description.md as needed.
4. Add per-type tests.
5. Live-data smoke against D.t9's hotel-card + region-base-card renderers.

---

## 5. Verification

### v1 tranche

```bash
cd /Users/al/Studio/projects/swoop_web
rm -rf product/node_modules product/*/node_modules
cd product && npm install
npm run typecheck    # all 6 workspaces green
npm test --workspaces --if-present    # all green; updated tests pass
```

Assertions:
- `@swoop/common` exports `ProposalCardPublicSchema` and `ProposalCardPublic`.
- `@swoop/common` no longer exports `TripCardPublicSchema` (sweep check: `grep -rn 'TripCardPublic' product/` returns zero hits).
- `find_options` handler returns shape valid against `FindOptionsOutputPublicSchema`.
- D.t9 UI plan's referenced types compile.

### v2 + v3 tranches

Per-tranche: workspace tests green; live-data smoke via `npm run dev -w @swoop/connector` + `@swoop/orchestrator` + `@swoop/ui`; agent prompts that should surface tours / hotels / region_bases return cards of the expected type; D.t9's per-variant card renderers light up against real data; no shape errors in the orchestrator/connector logs.

### Operator smoke (post-v1)

After v1 lands, run a single agent prompt that's strongly trip-shaped (*"show me some 7-day Patagonia options around £2K"*). Verify:
- Connector logs show `find_options` returning cards with `type: 'trip'`.
- UI renders the trip-card variant of the `find-options` widget (the only variant connected to live data in v1).
- No console errors about unmatched discriminator types.

---

## 6. HITL questions

None open at authoring time. Settled in the 2026-05-12 conversation:
- Polymorphic over TripCard-only ✅ ratified.
- Tours-as-distinct-from-Trips ✅ ratified (schema-level distinction confirmed: `tour` table + `tour_item` + `group_size_max`).
- Tranche strategy v1 trips → v2 tours → v3 hotels+region_bases ✅ ratified.
- Tours as Luke's upsell priority ✅ ratified (lands in description.md guidance).
- Day-one contract settled even with v2/v3 implementations later ✅ ratified.

Items that may surface during execution (not strictly HITL, but flag if encountered):
- If the `tour` data turns out to be ambiguously trip-shaped after Swoop populates, the tour-vs-trip discriminator in the schema needs re-validating. Worst case: tour cards become "trip cards with extra fields" rather than a separate variant. This would be a re-open, not an executor-side decision.
- The `region_base` variant's value depends on conversation behaviour. If real conversations don't actually elicit "region as base" framing, the variant could be deferred / removed. v3 implementation should treat this as the easiest-to-retire variant if mid-implementation evidence suggests it's redundant.

---

## 7. PoC carry-forward pointers

The deleted `SearchResultsWidget` + `ItemDetailWidget` (per `git show 884815a:product/ui/src/widgets/search-results.tsx` and `…/item-detail.tsx`) had a related-but-different polymorphism shape:
- `SearchResults` rendered uniform cards across `entityType: trip | tour | region | story`. Bottom-up — every entity looks the same.
- `ItemDetail` narrowed an outer envelope's `record` against per-entity schemas (TripSchema / TourSchema / RegionSchema / StorySchema), falling back to a loose record if narrowing failed. **This is the pattern this plan inherits.** One outer envelope, per-type narrowing, per-type renderer.

The lesson: polymorphism is right when each variant gets its own visual register; polymorphism is wrong when it forces uniform shape ("any hit looks like a hit"). This plan's `ProposalCard` discriminated union follows the right pattern.

---

## 8. Coordination with siblings

- **D.t9** ([`03-exec-chat-surface-t9.md`](03-exec-chat-surface-t9.md)) — the UI widgets ship all four card-variant renderers day-one; this plan's v1 makes the contract land. v2 / v3 tranches unlock live-data smoke for the tour / hotel / region_base renderers respectively. D.t9 verification has notes for both phases.
- **C.t2** (closed) — this plan supersedes C.t2's TripCardPublicSchema. Decision C.43 logs the supersession.
- **C.t4** (closed) — this plan extends `find_options` handler. C.t4's eight-tool surface is preserved (one tool, polymorphic output); no new tools.
- **G.t0** (HITL session pending) — if Al's conversational-architecture work surfaces strong signals about which proposal type lands when, fold them into the description.md guidance. Not a gate.
- **Swoop content team** — gated by tour content population. Question open in `questions.md`.

---

## 9. References

- [`03-exec-chat-surface-t9.md`](03-exec-chat-surface-t9.md) §"HITL ratification record" item 4 — the conversation that surfaced this.
- [`03-exec-c-t2.md`](03-exec-c-t2.md) — the original contract being superseded.
- [`03-exec-c-t4.md`](03-exec-c-t4.md) — the handler being refactored.
- `planning/decisions.md` — entries C.14 (headline pricing only), C.24 (no composer layer), C.25 (eight tools), C.26 (find_someone_who graduated). New entries C.43–C.46 in this plan.
- `product/connector/migrations/002_domain_tables.sql` — schema confirmation: `trip`, `tour`, `tour_item`, `hotel`, `area`, `page` all present and FK-correct.
- `progress.md` — chunk-C status; the `tour: 0/15 populated` live-count surfaced in C.t3.
- `gotchas.md` — no entries directly relevant. The polymorphic dispatch in the UI is a new pattern, no existing gotcha applies.

---

## 10. Hand-off

When v1 lands:
- `progress.md` chunk-C status line adds a note: *"find_options output polymorphic per crosscut plan; v1 trips-only live; v2/v3 follow."*
- `next-steps.md` adds the v2/v3 tranches with their gates (v2: Swoop tour content; v3: not gated).
- `decisions.md` carries C.43–C.46.
- D.t9's executor unblocks (its prereq §0 sub-step verifies this plan's v1 landed).

When v2 lands:
- Tour-card live-data smoke clears.
- Live tour content flows through Sonnet's responses; description.md may iterate to sharpen tone post-data.

When v3 lands:
- Hotel-card + region-base-card live-data smoke clears.
- The propose-options job is feature-complete across all four proposal types.
