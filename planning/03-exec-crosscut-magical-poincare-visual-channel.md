# 03 — Crosscut: visual channel — one image, hidden annotations, one-page emphasis (Luke Loom feedback, 2026-06-10)

**Status**: DRAFT — pending HITL ratification.
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) items D3, D4.
**Workspaces touched**: `@swoop/ui` (primary), `cms/prompts/tools/illustrate/description.md` + `cms/prompts/tools/lookup/description.md` (limit/teaching nudges). No schema changes, no migrations.
**Builds on**: [02-impl-visual-sidebar.md](02-impl-visual-sidebar.md) — its "Not outcomes" §1 deferred image fixes and the link surface; this feedback round activates them (see the T2 addendum dated 2026-06-10).

---

## ★ Read this first

Luke's direction for the sidebar is convergence: per conversational moment, **one strong image + one page reference + cards**. Two display changes deliver it; neither touches retrieval substrate (annotations stay embedded + searchable — they just stop being visitor-visible).

The annotation-*quality* complaint ("immense views" that aren't; "tourist") is real but is NOT fixed here: the fix is the parked re-annotation run (vision prompt v2 + [the in-message reminder bug](03-exec-c-t4.md), batches ~£14). Hiding the captions makes that non-blocking for the visitor surface.

## 1. Outcomes

1. `illustrate` renders **one large image** (sidebar-width hero, not a strip/grid). No visible caption, no mood-tag chips. The annotation remains `alt` text (and the lightbox keeps no caption — `aria-label` carries the alt).
2. `lookup` renders the **single most-relevant source page** as a prominent link card — anchor text per the provenance plan's "Find out more about {title} →" — instead of a stack of up to ~5 source links. (Secondary sources: dropped from display; the agent still receives all chunks and can name them in prose.)
3. Tool descriptions updated: `illustrate` default `limit: 1` — "fetch the one image that best illustrates the moment; ask for more only for an explicit visual-comparison moment"; `lookup` unchanged in retrieval breadth (the agent still wants ≥5 chunks for answering) but taught that the widget shows only the top source.
4. Mobile inline rendering follows the same single-image / single-link shape (no separate mobile variant this round).

## 2. Components

### 2.1 `inspiration.tsx` (illustrate)

[product/ui/src/widgets/inspiration.tsx](../product/ui/src/widgets/inspiration.tsx): replace the strip/2-col grid (lines ~118-156) with a single `ImageBlock` hero — first image of the result. Remove the visible `caption` + `moodTags` block; keep `altText`; keep the lightbox (tap to enlarge) minus its caption line. If the tool returns >1 image (agent explicitly asked), render the first as hero + the rest as small thumbnails below — judgement call ratified here so multi-image moments still work.

**Decision (proposed) D.poincare-2**: annotations are retrieval substrate + alt text, never visitor-visible captions.
**Decision (proposed) D.poincare-3**: illustrate defaults to a single hero image; multi-image is agent-explicit, rendered hero+thumbs.

### 2.2 `lookup.tsx`

[product/ui/src/widgets/lookup.tsx](../product/ui/src/widgets/lookup.tsx): `pickAffordances` already collapses chunks → source pages; take the top affordance only and render it as a slightly stronger card (title-as-anchor per [provenance plan §1.4](03-exec-crosscut-magical-poincare-retrieval-provenance.md), favicon-less, quiet). Delete the multi-link stack. Keep the existing empty-state silence.

**Sequencing**: lands cleanly before or after the provenance plan — before it, the anchor uses the existing `hint` fallback copy; after it, the real `sourceTitle`. State which at execution.

### 2.3 Tool description nudges

- `cms/prompts/tools/illustrate/description.md`: default-1 framing + when-more-is-right.
- `cms/prompts/tools/lookup/description.md`: "the widget shows the visitor your top source only — your prose carries anything else worth citing".
(The connector's Zod default for `IllustrateInput.limit` may also drop to 1 — verify whether description-only steering suffices; if changing the Zod default, that's one line in `ts-common` + connector test updates. Executor's call, log it.)

## 3. Out of scope

- Re-annotation run (parked; gate: cost go-ahead — raised priority noted in ledger D3).
- Sidebar curation/dedup/pinning (explicitly out per the T2's "Not outcomes" — still out).
- AntiRepetition logic (already handles cross-turn image dedup upstream).
- find_options card design.

## 4. Verification

1. Unit: inspiration renders exactly one hero for an N-image result (+ thumbs when N>1), no caption/mood text in the DOM, alt present; lookup renders exactly one link.
2. Sidebar + inline (mobile) snapshots both honour the new shapes; lightbox works.
3. Live smoke: "show me Torres del Paine" → sidebar gets one large image; a practical question → one source link titled per the page. Screenshot for Luke-readable proof.
4. Existing widget test suites green; sidebar store untouched (entries are tool-parts; rendering changed, identity didn't).

## 5. Estimate

~0.5 day.
