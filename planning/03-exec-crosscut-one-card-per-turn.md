# 03 — Crosscut: one-card-per-turn — illustrate-as-fallback + show_options sidebar wiring (Luke feedback, 2026-06-16)

**Status**: DRAFT — pending HITL ratification. Authored in worktree `one-card-per-turn` (branch `worktree-one-card-per-turn`, off `main` `3f8c093`).
**Source**: Luke feedback 2026-06-16 — *"The sidebar is effective but busy (overall, and as the conversation flows along). Can I suggest just 1 card for each response in the conversation."* Not yet captured in `planning/meetings/`; capture verbatim at ratification.
**Workspaces touched**: `@swoop/cms` (`prompts/system/00_why.md` §4 + `prompts/tools/illustrate/description.md`) — chunk G; `@swoop/ui` (`parts/index.ts` + `parts/__tests__/visual-sidebar.test.tsx`) — chunk D.
**Back-links**: [find/show split reshape](03-exec-crosscut-goofy-goldstine-find-options-reshape.md) (introduced `show_options`; §6 "show_options becomes the panel feed"), [visual-sidebar Tier 2](02-impl-visual-sidebar.md) (the relocation this restores), [AntiRepetition crosscut](03-exec-crosscut-anti-repetition.md) (parked right-panel UI), `00_why.md` §4 (the guidance being recalibrated).
**Proposed decision IDs**: `G.one-card-1` (illustrate-fallback prompt), `G.one-card-2` (illustrate description), `D.one-card-1` (show_options sidebar wiring).

---

## ★ Read this first — what this is, and the evidence it stands on

Luke's "1 card per response" is his non-technical articulation of a real problem: **the visual surface is busy, per-turn and cumulatively.** We honour the *problem* (calm the surface) without taking "exactly one card" literally — Luke doesn't mean a hard cap of one.

**The problem, quantified (live `puma_dev`, 55 sessions, 93 rendering-turns, 2026-06-16):**

- **76% of rendering-turns show 2+ cards today** (median 2); sessions accumulate **avg 3.7, max 15** sidebar widgets.
- This is partly *by design*: `00_why.md` §4 currently instructs *"render eagerly," "call multiple tools in a single turn,"* and *"render slightly more than you talk about."*
- `illustrate` is the highest-frequency display tool (73 calls) **and the only one with no prose payload** — the agent never weaves image content into text (§5 forbids repeating it). It "rode along" on a more-valuable card on **59 turns**.

**The validated lever — demote `illustrate` from eager-companion to fallback** (Alastair's strategy, modelled against the data):

| | today | illustrate-as-fallback |
|---|---|---|
| turns rendering 2+ cards | 71 | **25** |
| turns at a single card | 22 (24%) | **68 (73%)** |
| median cards/turn | 2 | **1** |

Clears **46 of 71 multi-card turns (65%)**. The residual 25 are *genuine* two-valuable-things turns (e.g. `lookup`+`find_inspiring`) — honest density we deliberately keep.

**Why fallback costs nothing (reinforces the call):** the valuable cards already carry their own image — `inspire_passage` **587/665 (88%)**, `trip_card` **614/649 (95%)**, `tour_card` **11/11**. So the suppressed `illustrate` was mostly *duplicate* imagery. (One asymmetry: `customer_story` carries an image only 68/953 (7%), so a `find_someone_who` turn loses its picture under the rule — negligible: that tool fired twice in 55 sessions, and the vignette stands alone on persona + prose.)

**The bug this also fixes (verified meticulously, 2026-06-16):** the find/show split (`6b810ac`/`25222d2`) moved the card *renderer* from `find_options` → `show_options` in `widgets/index.ts`, but **did not update the sidebar routing**: `SIDEBAR_DISPLAY_TOOLS` (`parts/index.ts`) still lists `find_options` (now renders nothing) and omits `show_options` (renders the cards). Net on desktop: **proposal cards render inline in the transcript, not the sidebar** — the exact thing the sidebar relocation removed. No CSS hides them (`styles/index.css` widget rules are animation-only); `visual-sidebar.test.tsx:79-86` pins the stale six-tool set, so CI never caught it. `find-options.tsx`'s own comment documents the intended-but-unfinished end-state. **This must be settled (restore-to-sidebar vs. keep-inline) — see decision gate in Phase 3.**

---

## 1. Outcome

After this plan:

- The agent **SHOULD aim for one card per turn** — picking the single best visual for the moment — and **SHOULD NOT** fire `illustrate` when another card is already being shown that turn. It may still call any number of *informative* tools (`find_options` browse, `find_tips`, `get_pricing`, and `lookup` for its text) — inform widely, show narrowly.
- `illustrate` is reframed as the **fallback** visual: only when the turn would otherwise put no card on screen.
- `show_options` cards render in the **visual sidebar** (desktop) / inline (mobile), like every other display widget — the find/show-split wiring is completed.
- Per-turn single-card share rises from ~24% toward ~73% (median 2→1); residual multi-card turns are genuine two-valuable-things moments, left intact.

**Not in scope** (named in §4).

---

## 2. Phase 1 — §4 recalibration: illustrate-as-fallback + priority order (chunk G)

**File**: `product/cms/prompts/system/00_why.md`, the `### The visual channel runs alongside what you say` subsection (currently ~lines 151-167).

**What changes**: replace the three density pushes — *"SHOULD render eagerly," "You can — and SHOULD — call multiple tools in a single turn… ration them per moment-that-deserves-rendering,"* and *"The asymmetric move: render slightly more than you talk about"* — with a one-card-per-turn default, a priority order, and the inform-widely/show-narrowly split. Keep the concept-enters-the-conversation trigger; keep the §4 `find_someone_who` / `find_tips` "when to reach for it" paragraphs (they're about tool choice, not density).

**Draft wording** (taste-driven, chunk G — Alastair's editorial pass owns the final voice; this is the spec + a first cut):

> ### The visual channel runs alongside what you say
>
> Tools that render structured widgets — `show_options`, `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `illustrate` — put a card on the surface the visitor sees, alongside your prose. The two channels are independent: the widget renders; your prose decides what to lean into.
>
> **SHOULD aim for one card per turn.** The visitor's eye should land on a single, well-chosen visual per reply, not a stack — a turn that puts three cards on screen reads as busy and dilutes the one that mattered. When a moment could be rendered several ways, pick the one card that best serves it and let your prose carry the rest.
>
> **The priority, when a moment deserves a visual:**
> 1. **Showing options** (`show_options`, after a private `find_options` browse) — once the conversation has narrowed toward concrete trips, tours, or places to stay. The most valuable card; when it fits, it wins the turn.
> 2. **A thematic card** (`find_inspiring`, `find_someone_who`, `find_proof`, or a `lookup` source) — when the moment is exploratory, identity-driven, a hesitation, or a concrete question. One of these, not several.
> 3. **`illustrate` is the fallback.** **SHOULD NOT** call it when another card is already being shown this turn — the passage and proposal cards already carry their own imagery, so a separate image just doubles up. Reach for `illustrate` only when the turn would otherwise show no card: a pure sensory or imagination moment with no options, no passage, no story. It lifts a turn that has nothing else to show; it doesn't pile on top of one that does.
>
> **Inform widely, show narrowly.** You may still call several tools in a turn for what they tell *you*: `find_options` browses privately and renders nothing; `find_tips`, `get_pricing`, and `lookup`'s text all feed your prose. Call those as freely as the moment needs. The one-card default governs what the *visitor* sees, not what you consult.

(Removes the now-contradictory "two illustrate calls" example and the "render slightly more than you talk about" line. The "SHOULD NOT confuse rendering with pushing in prose" paragraph stays — it's compatible.)

---

## 3. Phase 2 — `illustrate` tool description (chunk G)

**File**: `product/cms/prompts/tools/illustrate/description.md`.

Reframe from *"the visual companion to any of the other tools… amplify what it returned"* to **fallback**: keep the one-image default and the visual-comparison `count` exception, but add that `illustrate` is for turns with no richer card — when `show_options` / `find_inspiring` / a story is already on screen, those carry their own imagery and `illustrate` should sit out. One or two sentences; preserve the existing voice.

---

## 4. Phase 3 — complete the show_options sidebar wiring (chunk D) — **DECISION-GATED**

**Decision gate (`D.one-card-1`, HITL):** restore proposal cards to the sidebar (recommended — matches documented intent, Luke round-1, and keeps the conversation column clean), **or** ratify cards-stay-inline as deliberate (then instead: drop `find_options` from `SIDEBAR_DISPLAY_TOOLS`, leave `show_options` inline, and document the split-surface intent — and note the sidebar will hold only ambient visuals).

**If restore-to-sidebar (recommended):**
- `product/ui/src/parts/index.ts`: in `SIDEBAR_DISPLAY_TOOLS`, **replace `"find_options"` with `"show_options"`.** (`find_options` renders nothing, so removing it also stops it publishing a silent ghost entry to the sidebar; `show_options` gains the publish + desktop inline-hide every other display widget has.)
- `product/ui/src/parts/__tests__/visual-sidebar.test.tsx`: update the wrapped-tools enumeration (`:79-86`) `find_options` → `show_options`; add an assertion that `show_options` is sidebar-wrapped and `find_options` is **not** (the inverse of today). Consider a representative publish/render test using a `SampleShowOptionsOutput` fixture so a future rename can't silently regress the routing again.
- No schema/connector/orchestrator change. `show_options`'s `extractSeenDelta` seen-marking is unaffected (orchestrator-side, independent of UI routing).

**Why bundled here:** until cards are in the sidebar, "prioritise `show_options`" (Phase 1) trims inline clutter but its cards never reach the sidebar — the strategy can't fully land. Fixing the wiring is also what makes the post-change sidebar coherent (one curated card-or-visual per turn, all in one place).

---

## 5. Decisions (proposed)

- **G.one-card-1** — The visual channel defaults to one card per turn; `illustrate` is demoted to a fallback (SHOULD NOT fire when another card is shown that turn). Supersedes §4's "render eagerly / multiple tools / render more than you talk about." Rationale: 76%→~27% multi-card turns at zero informational cost (illustrate has no prose payload; valuable cards already carry imagery). Swap cost: low — prose edit; revert is a git revert of `00_why.md` §4.
- **G.one-card-2** — `illustrate/description.md` reframed to fallback. Swap cost: trivial.
- **D.one-card-1** — `show_options` joins the sidebar display set, completing the find/show-split routing (`find_options` leaves it). Swap cost: low — one set member + test. **Gated on the cards-inline-vs-sidebar ruling.**

## 6. Out of scope (deliberate)

- **Multi-item widget caps** (`find_inspiring` 2–4, `find_someone_who`/`find_proof` 1–3 stacks). Luke doesn't mean one *literal* card; one *block* per turn is the target. Revisit only if the surface still reads busy after this lands.
- **The residual ~25 multi-hybrid turns** (`lookup`+`find_inspiring` etc.) — honest two-valuable-things density; trimming hits the dual-purpose wall (a hybrid is called for its text, and prompt can't suppress its render). Don't touch until we see whether illustrate-fallback is "enough" (Alastair's hypothesis).
- **Cumulative-sidebar redesign** (per-turn grouping, accordion, "latest only", pinning/curation) — the structural answer to "busy as it flows"; a separate, larger piece. Fewer-per-turn reduces the cumulative total as a side effect.
- **Image re-annotation** (~£14) and the `image.alt_text` 0/13,012 a11y gap — separate parked items; not this plan.

## 7. Verification

1. **Per-turn DB probe, before/after** — re-run the invocationId-grouped query (in the 2026-06-16 investigation) against fresh post-change sessions; expect single-card-turn share ~24% → ~73%, median 2→1.
2. **Harness** — re-run the `luke-` family (`npm run -w @swoop/harness eval -- --filter luke- --judge sonnet`); add/adjust a scenario asserting `illustrate` is **not** called in a turn that also fired `show_options` or a hybrid (a "tool not co-present in turn" check — assess whether the existing assertion kinds cover it or a small new kind is needed). Record the ranked-vs-prior comparison.
3. **Live smoke** (full stack): (a) thematic turn → one hybrid card, no `illustrate`; (b) trip-focus turn → `show_options` cards **in the sidebar** (post Phase 3), no `illustrate`; (c) pure-inspiration turn (no other tool) → exactly one `illustrate`. Screenshot for Luke-readable proof.
4. **UI suite** — `visual-sidebar.test.tsx` updated and green; fresh-install verification + typecheck clean across workspaces.

## 8. Estimate

Phase 1+2 (prompt + description) ~0.5 day incl. Alastair's editorial pass. Phase 3 (wiring + test) ~0.5 day incl. live smoke. Harness run ~£3-4 / ~20 min.

---

## 9. HITL ratification appendix — open decisions for Alastair

1. **Cards: sidebar or inline?** (`D.one-card-1` gate.) Recommendation: restore to sidebar.
2. **§4 wording** — the draft in Phase 1 is a first cut; final voice is your editorial call (chunk G / G.7).
3. **Confirm** the multi-item caps + multi-hybrid residual stay deferred (§6) — i.e. ship illustrate-fallback first and measure, before any harder curation.
4. **Luke ambiguity** — proceeding on "one *block* per turn", not one literal card. Worth a line back to Luke at review (questions.md), but not blocking.
