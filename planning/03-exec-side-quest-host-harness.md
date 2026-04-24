# 03 — Execution: Mock Host Harness (MH.t1–t3)

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: Side-quest (not A–H).
**Tasks**: MH.t1 (scaffold + one page) + MH.t2 (full five-page set) + MH.t3 (README + dev-workflow) — bundled because the artefact is small and the tasks share all their files. Separate execution would be ceremony.
**Implements**: [`02-impl-side-quest-host-harness.md`](02-impl-side-quest-host-harness.md).
**Depends on**: UI dev server at `:5173` (already running). No workspace changes.
**Produces**: `product/mock-host/` — plain static HTML + CSS + JS test harness.
**Unblocks**: ability to observe iframe-remount failure modes in a realistic host; demo surface for Julie/Luke; later persistence work (parked W1/W2).
**Estimate**: 1–2 hours of focused work.

---

## Purpose

Stand up the smallest multi-page static site that can host the Puma chat iframe and reproduce production navigation behaviour (full page loads → iframe remount). Diagnostic + demo surface; not a product.

Posture from the Tier 2: intentionally scruffy. Plain HTML, hand-written CSS, vanilla JS. No build step. No framework. No Tailwind. No workspace package entry.

---

## Deliverables

### Files

| File | Role |
|---|---|
| `product/mock-host/README.md` | Dev-only banner, run instructions, known behaviours (including "chat dies on nav" as intentional observation), screenshot placeholder. |
| `product/mock-host/index.html` | Home page — hero + intro + three region cards + footer. |
| `product/mock-host/regions.html` | Regions overview — four region cards (Torres del Paine, El Chaltén, Carretera Austral, Tierra del Fuego). |
| `product/mock-host/trek.html` | Trip detail — "W Trek" with hero, five-day itinerary stub, gallery stub, specialist-CTA. |
| `product/mock-host/about.html` | About — who "Swoop-ish" are, values. |
| `product/mock-host/contact.html` | Contact — phone/email placeholders + chat CTA. |
| `product/mock-host/shared/site.css` | Minimal layout (nav, cards, footer, banner) + type. Hand-written, no framework. |
| `product/mock-host/shared/chat-trigger.js` | Vanilla JS: toggle iframe open/closed on "Chat to us" nav-button click. |

### Not produced (explicit)

- No `package.json` in `product/mock-host/` — the directory is not a workspace.
- No build artefacts.
- No automated tests.
- No shared nav partial — nav is copy-pasted into each page (five copies). Faster than any include mechanism, and the harness never needs to evolve the nav structure meaningfully.
- No real imagery — `placehold.co` URLs or CSS-gradient placeholders only.

---

## Key implementation notes

### 1. Serving the site

Run from `product/` with one of:

```bash
# One-liner (no deps):
npx --yes serve mock-host -l 4173

# If Al prefers a script entry: add
#   "mock-host": "npx --yes serve mock-host -l 4173"
# to product/package.json (non-invasive — no new dep, no new workspace).
```

Recommendation: add the script to `product/package.json` so `npm run mock-host` works. Keep it minimal.

### 2. Nav bar shape

Same structure on every page (copy-pasted):

```
[MOCK HOST — dev only]   ← banner bar, full width, muted colour
Swoop-ish | Home | Regions | Trips | About | Contact  [Chat to us →]
```

- `Trips` links to `trek.html` (the single trip detail page).
- Active page gets a small visual highlight (optional, nice-to-have).
- "Chat to us" is a `<button>` (not a link) — triggers the iframe toggle via `chat-trigger.js`.

### 3. Chat iframe trigger behaviour

`chat-trigger.js` exports nothing; on load, attaches click handler to any element with `data-chat-trigger`.

- Click → injects `<iframe src="http://localhost:5173" ...>` into a **right-docked sidebar**: `position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw)`. Full viewport height.
- On desktop (≥ 721px), the script also adds `mock-chat-open` to `<body>`; CSS reflows page content via `padding-right: 420px` so the sidebar sits beside content instead of over it.
- On mobile (< 721px), no body reflow — sidebar takes full viewport width and overlays the page.
- Sidebar has a header row with the conversation title and a `×` close button.
- Clicking the nav button again, or `×`, removes the sidebar DOM and the body class.
- **No state persistence across pages yet** — the sidebar is re-created from empty DOM on every page load. That is the observation target.
- **Forward-looking**: this file is the natural hook point for auto-reopening the sidebar when a conversation is in flight, once a persistence layer lands (W1/W2). Do not add that now — it's parked — but the sidebar pattern is chosen specifically so auto-reopen becomes a natural extension rather than a redesign.

### 3a. Sidebar width — user-resizable

A 6–8px resize handle sits on the sidebar's left edge (`cursor: col-resize`, subtle hover highlight). Pointer-event-based drag (covers mouse + touch):

- **`pointerdown` on the handle** starts a drag. A transparent full-viewport overlay is injected at `z-index: 200` so the iframe can't swallow subsequent `pointermove` events. `pointermove` listeners are attached to `window` (not the handle) so the drag keeps tracking even when the cursor leaves the handle.
- **`pointermove`** computes `newWidth = window.innerWidth - event.clientX`, clamps to `[MIN_WIDTH, MAX_WIDTH]`, and writes to the `--mock-chat-width` CSS custom property on `:root`. Both the sidebar's `width` and `body.mock-chat-open`'s `padding-right` consume that variable, so the page reflows in lockstep.
- **`pointerup`/`pointercancel`** removes the overlay, tears down the window listeners, and writes the final width to `sessionStorage` under `mock-chat-sidebar-width`.

Constants in the JS:
- `MIN_WIDTH = 320` — below this the chat UI cramps.
- `MAX_WIDTH_VW = 0.7` — above this the host site becomes too narrow to observe.
- `DEFAULT_WIDTH = 420` — initial value when no stored width exists.

Width is read from `sessionStorage` on every open (not just first open) and clamped to the current viewport's `MAX_WIDTH`, so if the viewport has shrunk since the user set their width, we don't overflow.

A `window.resize` listener re-clamps the stored width if the viewport shrinks while the sidebar is open.

**Why sessionStorage rather than localStorage**: same-session scope matches the conversation scope (the thing the width is sized for). It also rehearses the storage contract the persistence workstream will use — one less thing to design later. No cross-tab or cross-session carry-over is intended.
- Minor nicety: disable body scroll while the iframe is open? No — breaks scroll-testing. Leave body scrollable.

### 4. Placeholder content posture

- Copy is Patagonia-shaped but obviously placeholder. One or two sentences per card. Do not imitate Swoop's real marketing voice; we're not claiming to be them.
- Images: `<img src="https://placehold.co/600x400/1f3a3d/c8d9db?text=Torres+del+Paine" />`-style URLs. Cheap, no assets to manage, visually distinctive as placeholder.
- One or two in-page links that cross-link naturally (e.g. on Regions, "See the W Trek" → `trek.html`).

### 5. CSS scope

- Target: readable as a site, looks intentional-if-modest, no dependency on any framework.
- ~150 lines of CSS max. Custom properties for colours + spacing at the top, component classes below (`.nav`, `.banner`, `.hero`, `.card-grid`, `.card`, `.footer`, `.chat-iframe-container`).
- Colour palette: earth tones (greens, greys, warm accent). Suggests "adventure travel" without brand-claiming.
- No media queries beyond a single `@media (max-width: 720px)` for nav collapse. Mobile is not a priority.

### 6. Dev-only markers

- Banner bar above the nav, every page, text: **"MOCK HOST — dev only. Not the real Swoop site."** Muted yellow or coral, full width, small type.
- `<title>[MOCK] <Page name></title>` on every page.
- README's first paragraph states the harness is not for deployment.

### 7. Scope fences (re-state here so they don't drift in implementation)

- No `postMessage` from host → iframe. None. Iframe is completely unaware of the host.
- No "minimise" state. Open or gone.
- No persistence across pages (that's the whole point).
- No consent-flow interaction (the chat handles its own consent; host doesn't care).

---

## Verification

1. `npm run mock-host` (once the script is added) serves `:4173`.
2. All five pages load at `http://localhost:4173/<page>.html` and render as recognisable placeholder pages.
3. Clicking any internal nav link triggers a full document load — verify via DevTools Network tab: fresh `index.html`/`regions.html`/etc. request, not an XHR.
4. Clicking "Chat to us" injects the iframe; the Puma chat (assuming `:5173` is running) loads and functions inside it.
5. Click "Chat to us" again (or the `×`) → iframe disappears.
6. Open chat → type a message → click any internal nav link → observe: new page loads, iframe is gone, conversation lost. **This is expected.** Capture a screenshot into `README.md` if useful.
7. MOCK banner is visible on every page above the nav.
8. Browser tab titles all start with `[MOCK]`.
9. `product/mock-host/` has no `node_modules/` or build artefacts.
10. `git status` shows only the new files under `product/mock-host/` and the one-line change to `product/package.json` — nothing elsewhere.

---

## Out of scope for this task (deferred to later work if needed)

- Iframe/parent coordination (W1/W2 persistence work — parked per Tier 2).
- Real Patagonia content.
- Tailwind.
- React.
- A workspace entry.
- Dev-harness keyboard shortcuts.
- "Tempt the user to navigate mid-conversation" deliberately seeded links.
- Any screenshot beyond an optional README addition.

---

## Handoff / next step

Once this ships, Al clicks around, observes iframe-remount behaviour, and the parked W1/W2 workstreams get revisited (or replaced) from evidence. See `02-impl-side-quest-host-harness.md` §10 for the decision loop.
