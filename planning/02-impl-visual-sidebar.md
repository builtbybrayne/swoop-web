# 02 — Implementation: Visual Sidebar (widget relocation)

**Status**: Tier 2 implementation plan. Draft, 2026-06-01.
**Implements**: Luke's Jun-2026 feedback, "UI Layout" items — move images/cards out of the inline transcript into a right-hand sidebar so they stop "confusing the conversation". Builds directly on **D. Chat Surface** (`02-impl-chat-surface.md`).
**Depends on**: D (the assistant-ui chat surface + the `tools.by_name` widget registry + the `fyi-channel` side-channel pattern). Nothing server-side changes.
**Coordinates with**: the merged AntiRepetition work (`946da94`) — it keys image suppression on `canonical_url`; this plan does **not** touch that logic, but a future curation layer would build on it.

---

## Purpose

Today every tool-call widget renders **inline in the transcript**: assistant-ui parses each tool-call part out of the streamed message and mounts the registered component (`product/ui/src/widgets/`) at the point in the conversation where the call landed. Luke's feedback is that the visual material crowds the conversation — images and cards interleaved with prose read as noisy.

This chunk relocates the **visual channel** to a dedicated right-hand sidebar on desktop, while leaving the conversation column as words. It does so with the **minimum viable mechanism**: an intercept that *copies* each incoming widget into an app-owned sidebar store, the same widget components re-rendered in the sidebar, and pure-CSS visibility rules that show the sidebar / hide the inline copy on desktop and do the reverse on mobile.

The deliberate design bet: **change where widgets display, change nothing about what they are or what drives them.** Both render surfaces always mount; only visibility differs. That keeps the change small, reversible, and leaves the door open to richer solutions later (curation, agent-directed canvas, mobile drawer) without committing to them now.

---

## 1. Outcomes

When this chunk is done:

- The six **display** widgets (`find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`, `illustrate`) render in a **right-hand sidebar** on desktop viewports, in arrival order, using the **existing widget components unchanged**.
- On desktop, the **inline** copies of those widgets are hidden (the transcript column shows prose + the visitor's own messages + the `handoff` form only).
- On mobile, the sidebar is hidden and the widgets render **inline as they do today** — i.e. current behaviour is preserved exactly on small viewports.
- The relocation is driven by an **intercept** at the existing part-renderer boundary that publishes each tool-part into an app-owned sidebar store (same pub/sub shape as the existing `fyi-channel`). Both surfaces subscribe; neither owns the data.
- The `handoff` lead-capture form **stays inline** in both layouts (it's an interactive CTA bound to the conversational moment, not visual reference material).
- Sidebar state **clears on fresh-chat / thread reset** and **repopulates on rehydrate** with no special-casing — because the intercept lives in the render path, replayed history re-publishes naturally.
- No regression to streaming, error states, consent gating, or the existing inline behaviour on mobile.

**Not outcomes** (explicitly out of scope for this item — named so we don't silently absorb them):

- **No curation.** "A bit random at the moment" is *not* interpreted as a request for dedup / grouping / relevance / pinning. The sidebar shows every display widget that fired, in order. Curation is a separate, later item.
- **No widget redesign.** The widget components and their internal containers are reused verbatim. We do not re-style cards into a "rail", change their layouts, or touch their markup.
- **No new link surface.** Luke's separate "links to relevant pages should sit in the sidebar" item (auto-surfacing a link for every concrete mention) is **deferred** — there is no existing inline link-widget to relocate, so it falls outside "move what we have". `lookup` (which already renders a source-page link widget) moves with the rest because it *is* an existing widget; the broader auto-linking ask is its own future item.
- **No image fixes.** The cropping-loses-meaning and annotation-quality notes (Luke's "needs more info" section) are not addressed here.
- **No mobile sidebar.** Mobile keeps today's inline rendering. A mobile drawer / tab-toggle is a future possibility this design leaves open, not a deliverable.
- **No prompt changes.** The system-prompt visual-channel guidance (§4 of `00_why.md`) is untouched this round; any re-tuning to reflect a two-panel reality is a follow-on once the layout is proven.

---

## 2. Target functionalities

### 2.1 The intercept

The seam is the existing tool-widget registration in `product/ui/src/parts/index.ts` (`tools.by_name` → `toolWidgetComponents`). Each registered display widget is wrapped so that, in addition to rendering inline as now, it **publishes its tool-part** — `{ toolCallId, toolName, args, result, status }` — to the sidebar store on mount and on update.

- Keyed by `toolCallId` so streaming updates (args → result) and React re-renders **update in place**, never duplicate.
- The publish is a side-effect of rendering the registered component; no change to assistant-ui's message model, no change to the orchestrator contract.
- `handoff` is **not** wrapped — it keeps its current inline-only registration.

This mirrors the precedent already in the codebase: `fyi-channel` pulls ephemeral status out of the assistant-ui flow into an app-owned channel. We generalise the same pattern for tool-parts.

### 2.2 The sidebar store

A small app-owned store (pub/sub, in the shape of `parts/fyi-channel.ts`) holding an **ordered, id-keyed list** of published tool-parts.

- **Append-by-id**: first publish for a `toolCallId` appends; subsequent publishes for the same id replace that entry's payload (so a widget that streams from args to result updates rather than stacking).
- **Order = arrival order.** No sorting, no relevance, no dedup beyond identity. (Image-level "don't show twice" already happens upstream in the AntiRepetition retrieval layer; the sidebar does not re-implement it.)
- **Reset hook**: the store is cleared by the same paths that reset the thread — `handleFreshChat` and the rehydrate `onExpired` flow in `App.tsx` already call `runtime.threads.switchToNewThread()`; the store subscribes to / is cleared alongside those.
- No persistence of its own — it is a projection of what the thread rendered, so rehydrate rebuilds it for free (see 2.5).

### 2.3 The sidebar shell + responsive behaviour

The app shell (`App.tsx` `ThreadSurface`) gains a **two-column layout at desktop breakpoint**: the existing centered thread column on the left, a fixed-width sidebar on the right. Below the breakpoint it collapses to the current single column.

Visibility is **CSS-only**, and both surfaces always render:

| Viewport | Sidebar | Inline widgets |
|---|---|---|
| Desktop (≥ breakpoint) | **visible** — renders the store's widgets | **hidden** (CSS) |
| Mobile (< breakpoint) | **hidden** (CSS) | **visible** — current behaviour |

- The inline-hide targets the relocated display widgets specifically, via a stable `data-swoop-part` / class hook (the codebase already uses `data-swoop-*` hooks for exactly this kind of styling seam). The visitor's own message bubbles, prose, and the `handoff` form are never hidden.
- "Both always render" is the explicit design choice — it costs a little redundant render work but buys clean reversibility and the freedom to pick a different mobile answer later without re-plumbing data.
- The sidebar has its own scroll region, an empty state, and is `aria`-labelled as a complementary region. Baseline a11y care, consistent with D's "baseline, not formal WCAG audit" posture.

### 2.4 Widget reuse

The sidebar renders the **same component instances** from `product/ui/src/widgets/` that the inline path uses, fed from the store rather than from assistant-ui's part props. No widget code changes. The dev-trace wrapper (`wrapWithDevTrace`) and the unregistered-tool fallback behaviour are unaffected on the inline path; the sidebar renders the widgets directly (dev-trace on the sidebar copy is a Tier-3 nicety, not required).

### 2.5 Lifecycle integration

- **Fresh chat / restart**: store clears with the thread (2.2). Sidebar returns to empty state.
- **Rehydrate on reload**: `useRehydrate` replays history parts into the assistant-ui thread; those replayed tool-parts run through the wrapped renderers, which re-publish into the store — so the sidebar reconstructs itself with no rehydrate-specific code.
- **Error / preflight**: unchanged; the sidebar is a passive projection and has no failure modes of its own beyond rendering whatever the store holds.

---

## 3. Architectural principles

- **Tap, don't re-route.** We do not pull tool-calls out of assistant-ui's message model; we observe at the render boundary and mirror. assistant-ui keeps owning the transcript.
- **One source, two views.** The store is the single projection; inline and sidebar are two views of it. This is what makes "show one, hide the other" a CSS decision rather than a data decision.
- **Reversible by construction.** Because both surfaces always mount and nothing about the widgets changes, reverting to inline-everywhere is a CSS/flag change, and switching mobile to a drawer later is additive.
- **Minimum blast radius.** No orchestrator change, no widget change, no prompt change, no content/data change. The diff is: one intercept, one store, one layout/CSS change, plus tests.

---

## 4. Reuse pointers (existing code)

| Need | Existing thing to build on |
|---|---|
| Side-channel pub/sub pattern | `product/ui/src/parts/fyi-channel.ts` (+ `subscribeFyiChannel` / `emitFyiChannel` / `resetFyiChannel`) |
| Widget registry / intercept seam | `product/ui/src/parts/index.ts` (`toolWidgetComponents`, `wrapWithDevTrace`) |
| The six display widgets (reused verbatim) | `product/ui/src/widgets/` (`find-inspiring`, `find-someone-who`, `find-proof`, `lookup`, `find-options`, `inspiration` [= illustrate]) |
| App shell / layout + thread-reset hooks | `product/ui/src/App.tsx` (`ThreadSurface`, `handleFreshChat`, `useRehydrate.onExpired`) |
| Styling seam for show/hide | existing `data-swoop-part` / `data-swoop-role` hooks + `styles/index.css` (precedent: the dev-affordance `body.swoop-hide-dev` toggle) |

---

## 5. Open questions / Tier-3 decisions

- **Breakpoint + sidebar width.** Which Tailwind breakpoint counts as "desktop", and a fixed vs proportional sidebar width. Affects how much the thread column narrows.
- **Sidebar ordering granularity.** Newest-at-top vs newest-at-bottom (follow the transcript's top-to-bottom reading, most likely bottom-append with scroll-to-latest).
- **Dev-trace on the sidebar copy.** Whether the `DevToolCallTrace` diagnostic also appears in the sidebar in dev mode, or stays inline-only.
- **Empty-state copy** for the sidebar before any widget has fired.

These are all Tier-3-sized; none changes the shape above.

## 6. Verification approach

- Unit/component: the store appends-by-id and resets correctly; the wrapped renderer publishes on mount and update.
- Render: on a desktop viewport the sidebar shows the fired widgets and the inline copies are hidden; on a mobile viewport the inverse. Both assert against the same conversation fixture.
- Integration: fresh-chat clears the sidebar; a rehydrate fixture reconstructs it. `handoff` remains inline in both layouts.
- Regression: existing chat-surface tests still pass (inline mobile path is the current behaviour).

---

*Back-link: this plan was created in response to Luke's Jun-2026 conversational-AI feedback (Google Doc "Conversational AI Jun26 Feedback"). The conversational/prompt items from the same doc were applied separately in commit `c93262a`.*
