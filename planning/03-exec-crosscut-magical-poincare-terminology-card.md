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
