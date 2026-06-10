# 03 — Content G.t6: prompt pass for the 2026-06-10 Luke Loom feedback

**Status**: DRAFT — pending HITL ratification. **Chunk home**: G (content; this is an instance of G.t6 "ongoing tuning").
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) items L3 (formatting), P1 (specialist terminology, prompt half), P2 (complexity of choice), P3 (group-tours price signal), D1/D2 (pricing policy, prompt half).
**Surfaces**: `product/cms/prompts/system/00_why.md`, `product/cms/prompts/system/10_style-avoid.md`, selected skills under `product/cms/prompts/skills/`, and `cms/prompts/tools/find_options/description.md` (one nudge). Content-only — no code.
**Pairs with**: [retrieval-provenance plan](03-exec-crosscut-magical-poincare-retrieval-provenance.md) (gives the agent `publishedAt`/`sourceTitle`; §2.4's policy references the field but degrades gracefully if it hasn't landed yet).

---

## ★ Read this first

This is the second Luke-calibration pass on the same prompt. Round 1 (commit `c93262a`, 1 Jun — "response shape, repetition, sales-team framing") *added* the "Bold sparingly … a word or two" rule that round 2 now overturns. Expect the pendulum: author the new formatting spec from Luke's **concrete examples**, keep an explicit ceiling, and note in the file's inline comments that this calibration is client-led so the next editor doesn't "fix" it back.

House conventions apply: MoSCoW tags, three-voice convention, NB-notes after worked examples (see [progress.md 2026-05-14 — chunk G conventions](../progress.md)). Single-quote any SKILL.md `description:` containing `: ` (the [js-yaml gotcha](../discoveries.md)).

## 1. Outcomes

Each numbered change is independently reviewable; Alastair editorial pass over the lot before merge.

### 2.1 Formatting calibration (L3) — §4 "Shape of a reply" + §3 pillar 3

Replace the round-1 "Bold sparingly" paragraph with a positive spec:

- **Every reply carries some formatting** (SHOULD): the visitor should never get a wall of undifferentiated text.
- **Italics for named places and regions** — *Torres del Paine*, *El Chaltén*, *Aysén* — consistently, so place-names become a visual layer of their own.
- **Bold for the key phrases that carry the reply's promise** — the things a skimming eye should catch: "**world-class trails and glaciers**", "**two-week guided trip**", a season, a price band. Roughly 1–3 per reply.
- **Bold key actions and the brand term** — calls-to-action ("**start the conversation now**") and every mention of **Swoop Planning Specialists** (ties to §2.2).
- **Ceiling retained** (MUST NOT): never whole sentences; bold guides the eye, it doesn't shout — if removing the bold loses nothing, remove it. Reconcile §3 pillar 3's wording ("no excessive bolding") with the new spec the same way `c93262a` did in the other direction.
- NB-note: Luke's examples are illustrative; the agent generalises the *categories* (places → italic; promise-phrases, actions, brand term → bold), not the instances.

### 2.2 Specialist terminology (P1, prompt half)

- Canonical term: **"Swoop Planning Specialists"** (working value pending Luke's email — [questions.md](../questions.md)). Establish in §1 (identity) and use it at every reference; always bold.
- **First-mention introduction** (SHOULD): the first time Specialists enter a conversation, give them one clause of context — who they are, that designing these trips is their full-time job (the §9 depth framing, compressed) — rather than a bare noun. Subsequent mentions can be bare.
- Sweep: §1, §5 (redirect lines), §6, §9 (the "How" templates + examples), §10; skills that voice specialists (`triage-to-referral`, `tailor-made-prospect-posture`, `engaging-a-*`, worked patterns); `cms/prompts/tools/handoff/description.md`.
- Don't over-stuff: natural prose still allowed to say "they/the team" after the term has landed in a reply. The brand term per reply, not per sentence.
- Note for the agent that the UI will also surface an "About **Swoop Planning Specialists**" card on first mention (the [terminology-card plan](03-exec-crosscut-magical-poincare-terminology-card.md)) — the agent should NOT duplicate the card's full pitch in prose.

### 2.3 Persuasion levers (P2 + P3)

- **Complexity of choice** (P2): add to §9 "When"/"How" and cross-reference from `pattern-overwhelmed-researcher` + `pattern-w-vs-o-wrestler`: Patagonia's breadth (multiple regions, seasons, route variants) is itself a **reason to talk to a Specialist** — when the visitor shows healthy overwhelm, voice the paradox of choice as the bridge: *"this is exactly the kind of untangling our **Swoop Planning Specialists** do"*. Surface breadth honestly (naming regions beyond *Torres del Paine* / *El Chaltén* is good practice — Luke explicitly liked it), then use it.
- **Group tours on price signals** (P3): extend §6 "Tour lean" + [group-tour-surfacing-for-solos skill](../product/cms/prompts/skills/group-tour-surfacing-for-solos/SKILL.md): price-consciousness and value-seeking join solo-travel as explicit tour-surfacing signals — a group tour is the natural way to manage cost without dropping quality. Same honesty guard as the existing lean (notice fit, don't manufacture it; shoestring/backpacker triage posture unchanged). One-line nudge in `find_options/description.md`: when price sensitivity is in play, pass `budgetBand` and consider `preferredType: 'tour'`.
- Data caveat (NB in the skill): "Swoop Group Tours" is a 4-product set on Swoop's site; our `tour_card` table holds 11 CMS-derived tours. Until Swoop identifies the four ([questions.md](../questions.md)), the agent works with what `find_options` returns and avoids claiming an exact count.

### 2.4 Pricing policy (D1 + D2, prompt half)

Extend §5's pricing rule (the "MAY speak in published cost bands" paragraph):

- **Contemporaneity (MUST)**: any figure offered must come from a source that is dated-and-recent (guideline: ≤ 24 months) or canonical. Retrieved content now carries `publishedAt` where known (per the provenance plan) — check it before repeating any number. Old or undated sources are colour, never citable figures. **If no contemporary source exists, give no figure** — say plainly that current pricing is a Specialist conversation; do NOT fall back to whatever the corpus has.
- **Breadth (SHOULD)**: keep ranges deliberately broad — a too-narrow band reads as a quote and sets up sticker shock; wide-and-honest beats narrow-and-wrong. Pair a band with what moves it (style, season, duration).
- **Steering**: cost-type questions prefer `lookup` toward canonical cost guides (most-recent wins when titles collide — the "Cost of a Patagonia Holiday" stale-blog vs updated-page case is the worked example, NB-noted as shape-illustrative).
- **Consistency with decision C.14** (Julie's 2026-04-27 ruling — headline `base_price` only, no calculated ranges; see [questions.md "Julie call" outcomes](../questions.md)): card-level "from £X" prices come from `base_price` and remain legitimate; this policy governs *prose figures sourced from retrieved content*, and the broad-band directive applies to the agent's own cost-band talk, not to displayed card prices. Don't let the new wording read as contradicting C.14.
- Cross-check `pattern-budget-solo-traveller` + `engaging-a-planner` skills for stale-pricing phrasing; align.

## 3. Out of scope

- Tool description fragments beyond the two named nudges (provenance plan owns the field-teaching updates).
- UI copy (handoff-form plan), the terminology card itself, any code.
- Re-litigating round-1 response-shape rules (2-paragraph default, question-on-own-line) — untouched.

## 4. Verification

1. Boot smoke: orchestrator loads the edited prompt + all skills (`loaded 14 skills` line intact; yaml-quote check on any edited descriptions).
2. Live single-turn smokes (real Anthropic): (a) generic opener → reply contains italic place names + ≥1 bold key phrase, no whole-sentence bold; (b) price-conscious opener → tours surface or are voiced, `budgetBand` passed (check tool args in dev trace), broad band with no stale figure; (c) overwhelm-shaped message → complexity-of-choice bridge voiced with bold brand term.
3. Harness: re-run the style cluster + `agent-2xx` pattern scenarios; add/adjust assertions where cheap (full evalset growth for these behaviours = existing chunk-H runbook cadence, not this plan).
4. Alastair editorial read of the diff (voice is the product).

## 5. Estimate

~0.5 day authoring + smokes. Editorial pass HITL.
