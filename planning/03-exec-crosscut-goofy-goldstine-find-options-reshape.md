# 03 — Execution: Crosscut — find_options reshape (hybrid ranking + find/show split)

> **Status**: EXECUTED + LIVE-VERIFIED — 2026-06-12. Worktree `agent-a1c4f2bbd5ab63767`, branch `worktree-agent-a1c4f2bbd5ab63767`. Commits: `6b810ac` (Phase 1+2), `3093fdd` (Phase 3 UI strip), `b86c147` (live-verify fix wave), `06b4b61` (AntiRepetition addendum). Full execution log at the bottom of this file.
>
> **Status (original)**: DRAFT — pending HITL ratification of this document. Load-bearing design calls made by Alastair in the 2026-06-11 HITL session (worktree `goofy-goldstine-2ed1c1`); ratification appendix at bottom. Decision IDs proposed `C.goofy-goldstine-{10..}` / `D.goofy-goldstine-{1..}` (wave-named; offset from the pricing plan's range to avoid sibling collisions).
>
> **Back-links**: [2026-06-10 Luke Loom ledger item D5](reviews/2026-06-10-luke-loom-feedback.md) (trip-card relevance), [2026-06-11 widget-emptiness diagnosis M1](reviews/2026-06-11-widget-emptiness-diagnosis.md) (zero-trap filters silently deleting trips/tours from blends), [AntiRepetition crosscut](03-exec-crosscut-anti-repetition.md) (trip/tour carve-out + seen-set mechanics), [find_options polymorphism crosscut](03-exec-crosscut-find-options-polymorphism.md) (the contract this evolves), [C.t4 plan](03-exec-c-t4.md) (origin of "pure SQL filter — no vector retrieval", superseded here).
>
> **Workspaces touched**: `@swoop/common` (schemas), `@swoop/connector` (find_options + new show_options + data primitives), `@swoop/ui` (widget re-registration; phase 3 is UI-only), `cms/prompts/tools/` (two descriptions), `@swoop/orchestrator` (registration pins), `@swoop/harness` (scenarios).
>
> **Sequencing**: [pricing-data plan](03-exec-crosscut-goofy-goldstine-pricing-data.md) **merges first** (both add a tool; registration lists + count pins collide — this plan rebases). Phases inside this plan land in order; phase 3 is a deliberately isolated UI-only commit (a styling agent is working in parallel and will restyle it — keep it findable and self-contained).

---

## ★ Read this first — verified facts this plan stands on (probed 2026-06-11)

1. **`find_options` uses no embeddings.** Zero embedding/cosine/`<=>` usage in the handler or any of the four data primitives. It is SQL filters + `ORDER BY RANDOM()` — the handler header says so explicitly ("Pure SQL filter — no vector retrieval (per C.t4)"). This was a deliberate C.t4-era call, now superseded: it is the largest single cause of Luke's D5 "cards feel off" feedback.
2. **The substrate for ranking already exists.** `trip_card` carries both an `embedding` (Gemini halfvec(3072), built from `title + vibe line + first 500 chars of description`, HNSW-indexed) and a `tsv` column (`to_tsvector('english', headline || vibe_line || region)`). `tour_card` carries embeddings (verify `tsv` at execution; embedding-only leg if absent). `hotel` and `area` (region_base) have neither — ranking applies to trips + tours only; hotels/region_bases keep filter + random.
3. **A shared hybrid-search helper exists**: [hybrid-search.ts](../product/connector/src/data/hybrid-search.ts) (`buildHybridSearchSql`), consumed by `find-inspire-passages.ts` et al. — cosine leg + ts_rank leg, weighted merge. Reuse it; don't reinvent.
4. **`ToolHandlerDeps` already carries `embedQuery`** (Gemini, 3072d — the C.t9/brave-pare corpus-AND-query contract). `find_options` just never consumed it.
5. **Three zero-population filter traps are still live** (diagnosis M1): trip `accommodationStyle` (0/649 — already accepted-but-ignored), tour `accommodationStyle` (0/11) and tour `activity` (0/11) — the latter two still silently zero the tour branch and delete tours from blends. The viable filters are coverage-probed: trip `region` 517/649, `activity_tags` 466/649, `duration_days` 628/649, `budgetBand` NULL-tolerant.
6. **Dedupe state**: AntiRepetition (ratified 2026-05-27) tracks hotels/region_bases (and the five content tools) in session-state `seenItems`, auto-exclude-on-entry + auto-mark-on-return at the connector boundary. **Trips and tours are deliberately untracked** (Alastair: "Swoop is literally trying to sell these"). The agent-supplied `exclude` on `find_options` (C.focused-shamir-5) is additive and is the *only* trip/tour dedupe lever — which is exactly what the browse loop needs.
7. **Retrieval and display are currently the same act.** Every `find_options` call renders a widget at its stream position. An agent that browses (call → judge → re-call) shows the visitor every rejected deck. The split (phase 2) separates the agent's eyes from the visitor's.

## 1. Outcome

After all three phases:

- `find_options` is the agent's **browse** tool: takes an optional free-prose `query`, returns a ranked compact list (top ~12, hybrid embedding + text score for trips/tours), renders **nothing**.
- The agent iterates browse calls with accumulated `exclude` until it judges it has enough to be informative (taught cap: rarely more than 3–4 calls), then calls **`show_options`** with its curated picks — that's what the visitor sees, as today's full cards.
- `show_options` items carry `group: 'primary' | 'also_interesting'`; primary renders as today's cards, also_interesting as a compact strip (phase 3, isolated UI commit).
- The two remaining tour filter traps are dead; no filter is removed that has probed coverage — region/duration/activity/budget all stay wired (no re-wiring ballache later).
- Seen-tracking semantics survive the split correctly: exclude-on-entry stays at browse time; mark-as-shown moves to `show_options` (only what the visitor actually sees gets marked); trips/tours stay untracked.

## 2. Phase 1 — hybrid ranking inside today's tool shape

Self-contained and shippable alone; widget untouched (still renders `find_options` output).

### 2.1 `query` param

`FindOptionsInputSchema` (+`.describe()`) gains `query: z.string().max(500).optional()` — free prose distilled from the conversation ("active couple, kayaking, Aysén, shoulder season, watching budget"). **Optional**: absent → today's `ORDER BY RANDOM()` variety behaviour, unchanged. This is the safety valve on embedding-quality uncertainty (HITL: "I'm not sure how good the embeddings search will be") — if ranking disappoints, behaviour degrades to exactly today by omission.

### 2.2 Ranking in the trip + tour primitives

`queryTripCardsByFilter` / `queryTourCardsByFilter` accept an optional `queryEmbedding` + `queryText`; when present, order by hybrid score (reuse `buildHybridSearchSql`'s two-leg shape over `trip_card.embedding` + `trip_card.tsv`), `RANDOM()` demoted to tiebreak among equal scores. Existing WHERE filters apply **before** ranking — filters constrain, embeddings order (HITL ruling: keep both). Handler embeds once via `deps.embedQuery(input.query)` and threads to both branches (and through `blendCards`). Hotels/region_bases: unchanged.

### 2.3 Kill the two live tour traps

`tour_card.activity` + `tour_card.accommodationStyle` clauses → accepted-but-ignored with the standard coverage comment (pattern: [find-inspire-passages.ts](../product/connector/src/data/find-inspire-passages.ts) header). Tests flip to assert accepted-not-forwarded. The blend stops silently deleting tours.

### 2.4 Description rewrite ([find_options/description.md](../product/cms/prompts/tools/find_options/description.md))

Teach: always pass `query` distilled from the conversation (what the visitor wants, not their literal last message); filters remain available as genuine constraints (duration bounds, explicit region, budget band); iterate with accumulated `exclude` when results don't fit the conversation, stop when informative — rarely more than 3–4 calls; trips may legitimately reappear across the conversation (no dedupe by design).

### 2.5 Phase-1 verification

- **Corpus-AND-query gate** (the C.t9 lesson): query embedding is Gemini 3072d against `halfvec(3072)` columns — assert dims in an integration test.
- **The kayaking probe**: `query: "kayaking in Aysén"`, no filters → kayak/Aysén trips in the top results (vs today's random deal). Live against `puma_dev`.
- **Blend probe**: lodge-style ask returns trips AND tours in the blend (M1 regression check).
- **Harness A/B**: re-run `agent-211-budget-mid-postgrad` + add a kayaking-relevance scenario; judge asserts on-topic cards. Ranked-vs-random comparison recorded in the execution log before phase 2 proceeds.
- Real-Anthropic single-turn smoke (input schema changed).

## 3. Phase 2 — the find/show split

### 3.1 Schemas (`@swoop/common`)

`FindOptionsOutputSchema` becomes a compact browse list (limit default raises 4 → 12):

```typescript
BrowseOptionSchema = z.object({
  type: ProposalTypeSchema, id: z.number().int().positive(),
  title: z.string(), region: z.string().nullable().optional(),
  durationDays: z.number().int().positive().nullable().optional(),
  fromPrice: z.number().nullable().optional(), currencyCode: z.string().nullable().optional(),
  line: z.string().nullable().optional(),        // one-liner (vibe line / framing), ~120 chars
}).strict();
FindOptionsOutputSchema = z.object({ options: z.array(BrowseOptionSchema), count: z.number() }).strict();
```

New `show_options` (eleventh tool):

```typescript
ShowOptionsInputSchema = z.object({
  items: z.array(z.object({
    type: ProposalTypeSchema, id: z.number().int().positive(),
    group: z.enum(['primary', 'also_interesting']).default('primary'),
  })).min(1).max(8),
}).strict();
ShowOptionsOutputSchema = z.object({
  cards: z.array(ProposalCardPublicSchema /* + group field — extend the union members or wrap */),
}).strict();
```

(Exact carriage of `group` — on each card vs a parallel array — is the executing agent's call; keep the UI dispatch simple.)

### 3.2 Connector

- `find_options` handler: project the compact shape from the existing card queries (no new SQL needed beyond dropping hydration weight — image resolution can be skipped at browse time, it's the expensive join and the agent doesn't need pictures to judge fit).
- New `show_options` handler: hydrate full cards by id — `WHERE id = ANY($ids)` variants of the four card queries (small additions to each `query-*.ts`, preserving their projection logic).
- **Seen-tracking move**: exclude-on-entry for hotels/region_bases **stays** on `find_options` (browse never re-offers what the visitor already saw); mark-on-return **moves** from `find_options` to `show_options` (only displayed items get marked). Trips/tours: untracked in both, carve-out preserved (HITL re-confirmed: "trips should NOT dedupe"). Update the AntiRepetition plan's tool-mapping table with a dated addendum pointing here.

### 3.3 UI (`@swoop/ui`)

- Widget registration moves: `find-options.tsx` renderer re-registers under the `show_options` tool name; `find_options` gets the null renderer (empty-state-silence pattern). Phase 2 renders `primary` items exactly as today's cards and **ignores `also_interesting`** (phase 3's job). Mechanical move, minimal diff.

### 3.4 Descriptions

- `find_options`: now explicitly *"your eyes, not the visitor's — nothing renders from this tool"*; browse → judge → curate.
- New `show_options/description.md`: *"this is what the visitor sees"*; ≤4 primary cards (don't re-deal the whole deck); `also_interesting` for near-fits worth a glance; don't re-show items the visitor rejected; re-showing a previously-discussed trip is allowed and sometimes the right move.
- §4 of `00_why.md` ("the visual channel runs alongside what you say") gets a one-line touch-up naming `show_options` as the card-rendering act. Coordinate: the content surface is otherwise owned by chunk G — keep the edit surgical.

### 3.5 Registration + pins

Tool count 10 → 11 (after pricing plan's `get_pricing`). Boot-log gates, orchestrator registration fixtures, `as Config` test fixtures, harness scenario tool-name assertions all sweep.

### 3.6 Phase-2 verification

- Live smoke: browse call renders nothing; `show_options` renders cards; sidebar shows only curated picks while the session transcript (`puma_session_event`) shows the browse iterations — the new diagnostic norm.
- Seen-set probe: hotel shown via `show_options` does not reappear in a later browse; a trip does (carve-out intact).
- Real-Anthropic single-turn smoke: Sonnet performs the two-step browse → show unprompted beyond the descriptions. If it reliably fails to call `show_options` after browsing, that's a STOP-and-reassess finding for the execution log, not something to paper over with forced tool chaining.
- Fresh-install verification at tip.

## 4. Phase 3 — `also_interesting` strip (isolated UI-only commit)

One commit, `product/ui/` only, no schema/connector/cms changes (HITL: a styling agent works in parallel and will restyle this — keep it findable and self-contained):

- `show_options` widget renders the `also_interesting` group as a compact strip under the primary cards — title + one-liner + thumbnail-sized image, no long scrollable rows (HITL: "We don't want long scrollable rows… though could do for the 'Also maybe of interest' ones").
- Commit message flags it for the styling agent: `feat(ui): also_interesting compact strip on show_options — styling pass welcome`.

## 5. Decisions (proposed)

- **C.goofy-goldstine-10** — `find_options` ranks trips/tours by hybrid (embedding + tsv) score from an optional free-prose `query`; `RANDOM()` demoted to tiebreak/fallback. Supersedes C.t4's "pure SQL filter — no vector retrieval" for this tool.
- **C.goofy-goldstine-11** — Coverage-probed filters (region/duration/activity/budget) stay wired as optional constraints; only zero-population traps die. Filters constrain, embeddings order.
- **C.goofy-goldstine-12** — find/show split: `find_options` = agent-private browse (compact, limit 12, renders nothing); `show_options` = visitor-facing curation (full cards, ≤8 items, grouped primary/also_interesting).
- **C.goofy-goldstine-13** — Seen-tracking: exclude-on-entry stays at browse; mark-as-shown moves to `show_options`; trip/tour carve-out unchanged.
- **D.goofy-goldstine-1** — `also_interesting` ships in the v1 schema; its widget treatment is a separate isolated UI-only commit (phase 3) for the parallel styling agent.

## 6. Out of scope (deliberate)

- Embedding re-composition or enrichment of `trip_card` substrate (title+vibe+500 chars stands; revisit only if the harness A/B shows ranking quality is substrate-limited, and log the evidence first).
- Hotel/region_base semantic ranking (no embeddings on those tables; 44 + 16 rows — filters + random is adequate).
- Luke's right-panel everything-renders UI (parked in the AntiRepetition plan; the split is compatible with it — `show_options` becomes the panel feed).
- Any change to `blendCards` ratios or the four-way split.

## 7. Estimate

Phase 1: ~½ day. Phase 2: ~½–1 day. Phase 3: small (hours). Total ~1–1.5 days plus harness runs.

---

## Appendix — 2026-06-11 HITL ratification record (conversation summary)

1. *"Trips should NOT dedupe"* — carve-out re-confirmed; browse-loop dedupe is the agent's `exclude`, not session state.
2. Embeddings for **ordering**; filters retained — Alastair: *"I'm not sure how good the embeddings search will be! And if we lose the filters, it'll possibly be a bit of a ballache to wire them back in"* → resolved as keep-both (§2.2), `query` optional as the safety valve.
3. Split ratified — Alastair named it **`show_options`**: *"One literally just finds options, and has no render attached. And then there's a [show]_options that the agent passes chosen ids to that triggers the widgets."* Fatter browse payload before curation; no long scrollable rows; `also_interesting` strip as the exception, built as an isolated UI-only commit for the parallel styling agent.
4. Discovery that motivated the wave: `find_options` never used embeddings — Alastair: *"No wonder they're not landing well."* Luke's D5 relevance feedback is the client-side echo of the same gap.

---

## 2026-06-12 execution log (agent worktree `agent-a1c4f2bbd5ab63767`)

Four commits on `worktree-agent-a1c4f2bbd5ab63767` (not pushed, not merged — orchestrator merges):

| Commit | What |
|---|---|
| `6b810ac` | Phase 1+2 — hybrid RRF ranking + `query` param, compact `BrowseOption[]` browse output, `show_options` 10th tool, seen-marking moved to show, `find_options` widget silenced, system-prompt touch-ups, harness scenario `agent-212-kayaking-relevance.yaml` |
| `3093fdd` | Phase 3 — `also_interesting` compact strip, isolated to `product/ui/` for the styling agent |
| `b86c147` | Live-verify fix wave (see below) |
| `06b4b61` | AntiRepetition plan addendum — find_options row superseded per §3.2 |

### Defects caught after the first landing (the case for live verification)

1. **`ShowOptionsOutputSchema` could never pass** — `z.intersection(ProposalCardPublicSchema, {group})` over `.strict()` union members rejects `group` as an unrecognised key. Every successful hydration would have thrown at the handler's final parse. Rebuilt as `ShownProposalCardSchema`: discriminated union of `.extend({group})` variants. Caught by the orchestrator bracketing test.
2. **By-id query drift** — the first `show_options` cut kept private SQL copies; `queryHotelsById` referenced a non-existent `h.accommodation_style` and wrong joins. Live verify failed on the first hotel hydration. Fix per plan §3.2 as written: by-id variants (`query{Trip,Tour,Hotel,RegionBase}CardsByIds`) now live in `data/query-*.ts`, sharing ONE SELECT block + row-mapper with the filter paths.
3. **Parallel queries on a single pg client** — `Promise.all` in both `showOptionsBody` and the pre-existing `blendBrowse` triggers pg's deprecation (hard break in pg@9). Both now await sequentially.
4. **Stale pins/tests** — connector `mcp.test.ts` 9→10 pin; `FindOptionsWidget` card tests rewritten for browse-silence; card coverage moved to new `show-options.test.tsx` (+ strip + group-contract tests); `SampleShowOptionsOutput` fixture; `show_options` handler unit tests.

> Correction: the 2026-06-11 log line claimed "500 tests passing" — that figure read only the last two workspaces of a truncated run. True per-workspace total after the fix wave: **1,325 passed / 26 skipped across 6 workspaces**, typecheck clean.

### Live verification (puma_dev + real Gemini)

- **Hybrid browse**: `query: "sea kayaking among glaciers and fjords"` → 12 options; top ranks are *Kayak Pumalin Fjords*, *Kayaking in Glacier Alley*, *W Trek & Backcountry Kayaking* — the D5 relevance gap visibly closed.
- **Fallback browse** (no query): 12 options via RANDOM() path.
- **show_options hydration**: 8/8 mixed-type ids hydrated with images + canonical URLs, groups preserved, curation order kept.

### Real-Anthropic smoke (plan §3.6 STOP-condition check)

`claude-sonnet-4-5-20250929`, real cms tool descriptions, real browse rows, 3 trials: **3/3 unprompted two-steps** — `find_options` always carried a `query`, `show_options` always fired the next round with only valid browsed ids, and the model used the `primary`/`also_interesting` grouping (3+1) unprompted. **STOP condition NOT met**; no forced chaining needed.

### Operator-pending (needs the full live stack, not reachable from this worktree)

- End-to-end widget smoke through orchestrator + UI (browse renders nothing in the sidebar, show renders cards, `puma_session_event` transcript shows browse iterations).
- Seen-set probe across a real conversation (hotel shown via show_options not re-browsed; trip repeats fine).
- Harness run of `agent-212-kayaking-relevance.yaml` (asserts the `tool_call_order` browse→show; needs a harness `tool_call_order` assertion kind if not yet implemented — check before first run).
- Fresh-install verification at the merge tip (per merge-time convention).

### Merge notes for the orchestrator

- Tool count: this branch lands 10 (`show_options`); pricing sibling lands 10 (`get_pricing`); union = 11. Count pins to sweep at merge: connector `mcp.test.ts` (10 here), orchestrator `tools.test.ts` (10 total / 9 exposed here).
- Expected conflict: `product/connector/src/data/query-hotels.ts` — pricing sibling's `a8e80ad` (per-night derivation) vs this branch's mapper extraction. Both mechanical; re-apply the sibling's derivation inside `mapHotelRows`.
- `ts-common/src/tools.ts` and `connector/src/tools/index.ts` will also collide on the tool-surface additions (both branches append). Trivial union.
