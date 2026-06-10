# 03 — Crosscut: "About Swoop Planning Specialists" terminology card (Luke Loom feedback, 2026-06-10)

**Status**: DRAFT — pending HITL ratification.
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) item P1 (card half).
**Workspaces touched**: `@swoop/ui` (trigger + card + sidebar store extension), `product/cms/` (card content — content-as-data).
**Depends on**: nothing hard. Pairs with the [content plan](03-exec-content-t6-luke-loom.md) (which makes the agent bold + introduce the term) and the sidebar substrate ([02-impl-visual-sidebar.md](02-impl-visual-sidebar.md)).

---

## ★ Read this first

Luke's ask: when the Specialists are first mentioned, a small card appears on the right explaining who they are — "a little pitch of their experience and what they do" — once per conversation. Alastair's suggested mechanism stands: **client-side keyword trigger on the agent's visible text**, no orchestrator involvement, no new tool. This keeps the agent's turn structure untouched and makes the card a pure presentation concern — same philosophy as the sidebar itself ("tap, don't re-route").

## 1. Outcomes

1. First time the assistant's rendered text matches the Specialists term in a conversation, an "About **Swoop Planning Specialists**" card appears at the top of the visual sidebar (desktop). Once per conversation; resets with the thread; never re-fires on the same session.
2. Card content lives in `product/cms/` (e.g. `cms/content/terminology/swoop-planning-specialists.json` — title, 2–3 short lines, optional CTA-free link), loaded at build/runtime like other content surfaces — **never inline in TSX**. Copy drafted from existing brand material (§9's team-depth framing: design trips for a living, on-the-ground experience), then **Luke/Julie review the wording** ([questions.md](../questions.md)).
3. Rehydrate-correct: on reload, replayed history re-triggers the match naturally (same render path), so the card reappears without special-casing; the once-guard keys on conversation, not on event count.
4. Mobile: card renders inline at first-match position (consistent with the sidebar plan's mobile-inline posture) — or is deferred mobile-side if inline placement fights the transcript; executor decides with a screenshot, logs the call.

## 2. Components

### 2.1 Trigger

A small matcher in the assistant text render path (sibling of the sidebar-publish tap): case-insensitive match on `/planning specialists?/` (term centralised with the UI's `SPECIALIST_TERM` const from the [handoff-form plan](03-exec-crosscut-magical-poincare-handoff-form.md)). Fire-once guard in the store. Match on *streamed-complete* text (debounce until the part settles) so a mid-stream partial word doesn't double-fire.

### 2.2 Sidebar store extension

[sidebar-channel.ts](../product/ui/src/parts/sidebar-channel.ts) entries are tool-parts keyed by `toolCallId`. Add a second entry kind: `{ kind: 'static-card', id: 'terminology:specialists', payload }` — union the entry type, keep Map-by-id semantics (the once-guard falls out of id-keying for free). `resetSidebar()` clears it with everything else. Pinned placement: static cards render above tool-part entries (it's an explainer, not part of the flow's chronology).

### 2.3 Card component

A quiet, brand-respecting card (`data-swoop-widget="terminology-card"`): title, the 2–3 lines, no CTA (the handoff form is the CTA surface; this card informs). Dismissable (×) — dismissed = stays gone for the conversation.

**Decision (proposed) D.poincare-4**: terminology cards are client-side keyword-triggered static sidebar entries, once per conversation, content from `cms/`; the mechanism generalises (future cards: B-Corp, "why book with Swoop") but only this one ships now.

## 3. Out of scope

- More terminology cards (mechanism generalises; one card ships).
- Agent awareness of the card beyond the one-line NB in the content plan (no tool, no prompt machinery).
- Animation/delight pass.

## 4. Verification

1. Unit: matcher fires once across multi-mention conversations; reset clears; static-card entries sort above tool-parts; dismiss works.
2. Rehydrate test: replayed history containing the term re-surfaces the card once.
3. Live smoke: conversation reaching a Specialist mention → card appears top-of-sidebar; fresh-chat clears it. Screenshot for Luke.
4. A11y: card is part of the existing `aria`-labelled complementary region; dismiss reachable by keyboard.

## 5. Estimate

~0.5 day + copy review round-trip with Swoop (non-blocking: ship behind the draft copy, swap on sign-off).

---

## 2026-06-10 execution log

Executed in worktree `agent-add4f6fb97099a5ed` from `64dd132` (Luke Loom feedback triage merge). All four components landed; `@swoop/ui` suite green.

**Decision D.poincare-4 — CONFIRMED as proposed.** Terminology cards are client-side keyword-triggered static sidebar entries, once per conversation, content from `cms/`; mechanism generalises (the store API is `publishStaticCard(id, payload)` / `dismissStaticCard(id)`, not specialists-specific) but only this card ships.

**What landed** (files):

- `product/ui/src/shared/specialist-term.ts` — canonical `SPECIALIST_TERM` / `SPECIALIST_TERM_RE` consts (cross-agent coordination file, byte-identical with the handoff-form agent's copy; merges cleanly).
- `product/cms/content/terminology/swoop-planning-specialists.json` — title + 3 lines, no CTA. **DRAFT copy awaiting Luke/Julie sign-off** — drafted from `00_why.md` §9's team-depth framing (design trips for a living; 400,000 hours on-the-ground; same-cost-as-direct; no invented individual CVs). Loaded via Vite JSON import, the same mechanism `error-banner.tsx` uses for `cms/errors/en.json`. Swap-on-sign-off is a JSON edit only.
- `product/ui/src/parts/sidebar-channel.ts` — `SidebarEntry = SidebarToolPartEntry | SidebarStaticCardEntry`; two insertion-ordered maps so "static cards above tool-parts" is concatenation, not sorting, and id namespaces can't collide. Once-guard = id-keying. `dismissStaticCard` blocks re-publication for the conversation; `resetSidebar()` clears entries + dismissals.
- `product/ui/src/parts/terminology-trigger.ts` — `useSpecialistTermTrigger(text, enabled)` called from `FyiSignalingText` (the assistant text render path), role-gated via `useMessage`. **Settled-text semantics**: the effect re-arms a 500 ms timer on every text change, so streaming chunks keep cancelling the publish and a mid-stream partial word can never fire; replayed history arrives fully formed and settles immediately. Typographic apostrophes (U+2018/U+2019) normalised to ASCII before matching so "Swoop's" with a curly quote still triggers — the shared regex itself untouched.
- `product/ui/src/parts/terminology-card.tsx` — quiet card (`data-swoop-widget="terminology-card"`), title + lines from the store payload, dismiss ×, no CTA, no aria region of its own (inherits the sidebar's labelled complementary region).
- `product/ui/src/parts/visual-sidebar.tsx` — branches on entry kind; static cards render first.

**Mobile call (plan §1.4): deferred mobile-side.** Evidence, from the substrate rather than a screenshot: (a) unlike tool widgets — which assistant-ui already mounts inline, so mobile-inline was the *zero-cost* posture for the sidebar plan — the static card has **no pre-existing inline mount path**; inline-at-first-match would need a new transcript surface plus first-match arbitration (on rehydrate several replayed text parts match simultaneously — which one renders the card?) plus cross-surface dismissal sync. (b) Luke's underlying feedback is that visual material crowds the conversation; injecting an explainer card into the mobile transcript — where space is scarcest — works against that. (c) The sidebar pane is `hidden` below `lg`, so deferral is the natural consequence of the card being a pure sidebar concern: zero extra code, reversible later by giving static cards an inline surface if mobile evidence demands one. A live mobile screenshot would only show the card's absence; the structural evidence above is what the call rests on.

**Rehydrate (plan §1.3)**: correct by construction — replay renders through the same `FyiSignalingText` path, the trigger re-fires, id-keying collapses to one card. Covered by the two-matching-parts replay test. Note the deliberate corollary, matching the store's "projection, not persistence" posture: a card dismissed *before* a reload legitimately reappears after it (the dismissed set is in-memory; §1.3's "the card reappears without special-casing" is the documented intent).

**Verification**: `@swoop/ui` 24 files / 164 tests, all passing (was 23 / 148 → **16 new tests**: 5 store static-card, 7 trigger, 2 card component, 2 sidebar integration). Typecheck: `@swoop/ui` clean; the 5 pre-existing `@swoop/connector` errors in `src/data/__tests__/embed-query.test.ts` remain untouched (not worsened). Live smoke + screenshot for Luke (§4.3) left for the HITL review pass at the merge tip — it needs a real conversation reaching a Specialists mention.

**Deviations from plan**: none material. §2.1's sketch regex `/planning specialists?/` was superseded by the stricter canonical `SPECIALIST_TERM_RE` (requires the Swoop prefix) per the shared-term coordination — bare "planning specialists" without "Swoop('s)" deliberately does not fire (tested).

**Open**: copy sign-off (Luke/Julie — tracked in [questions.md](../questions.md) per plan outcome 2); live smoke screenshot for Luke at the merge tip.
