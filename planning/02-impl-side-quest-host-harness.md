# 02 — Implementation: Mock Host Harness (Side-Quest)

**Status**: Tier 2 implementation plan. Draft, 2026-04-24.
**Implements**: [`01-side-quest-persistence.md`](01-side-quest-persistence.md) §5 W3 only. **Narrower scope than the parent side-quest doc originally pitched.**
**Does NOT implement yet**: W1 (server history endpoint), W2 (client rehydration on mount), W4 (storage-medium reconfirm). These are **parked pending observation** of what actually breaks when the chat is embedded in a realistic multi-page host.
**Does not depend on**: any canonical chunk A–H work. Does not block, and is not blocked by, Friday's hackathon, chunk C retrieval, chunk G content, or the agent-runtime persistence path.

---

## Purpose

Puma's production surface is an **iframe embedded in Swoop's Patagonia pages**, opened via a nav-bar trigger. Today our dev setup is a naked chat UI on `localhost:5173` with no surrounding site. That means we cannot observe — let alone reproduce locally — any of the behaviours that emerge specifically because the chat lives inside someone else's pages:

- What happens when the visitor clicks a link in the host page (iframe is torn down with the page)
- What happens when the visitor clicks a deep-link the agent offers them (same, plus loss of the conversation they were in)
- What the iframe trigger pattern actually feels like at normal reading distance
- How the chat reads alongside Swoop-shaped visual chrome

The mock host exists to make those behaviours observable. **Its first job is diagnostic** — let us see the failure modes directly, so we can reason about fixes from evidence rather than from speculation. Its second job is as a **demo surface** for Julie and Luke. Its third job is as the **test bed** for any persistence or iframe-coordination work we decide to do afterwards.

Approach posture: **build the observation surface, then engineer the solution.** Not the other way round.

---

## 1. Outcomes

When this chunk is done:

- A multi-page static site runs locally on its own port.
- 3–5 pages shaped like a plausible Swoop-adventures-ish site (Home, Regions, one Trip detail, About, Contact).
- Every page has a nav bar with internal links and a "Chat to us" button.
- Clicking the chat button injects an iframe pointing at the Puma chat UI into a bottom-right container on the current page.
- Clicking an internal nav link triggers a **full browser page load** (not client-side routing) — reproducing the iframe-remount behaviour that production will have.
- A visible on-page banner on every page labels the site as a mock harness.
- A README explains how to run it alongside the orchestrator + chat UI, and documents known behaviours (including "chat dies on nav" as an intentional observation, not a bug).
- Al can open the harness, click around, and demo it to Julie / Luke without anyone mistaking it for the real product.

**Not outcomes**:
- Real Swoop brand styling.
- Real Patagonia content (placeholder copy only).
- Deployment to any hosted environment.
- Iframe ↔ parent `postMessage` coordination.
- Any persistence or rehydration mechanism (explicitly parked).
- Mobile layout polish beyond "doesn't break".
- Accessibility audit beyond baseline semantic HTML.
- Anything resembling a CMS.

---

## 2. Target functionalities

### 2.1 Project shape and location

- Lives at `product/mock-host/`.
- **Not a workspace package.** Same exclusion rationale as `product/cms/` — minimum monorepo surface for a non-shipping artefact.
- File structure is flat: one HTML file per page, one shared CSS file, one shared JS snippet for the iframe trigger.
- No build step. No `package.json` beyond (optionally) a tiny one for running a static server as a dev dep — the whole point is there's nothing to compile.

Directory sketch:
```
product/mock-host/
  README.md
  index.html           # Home
  regions.html         # Regions overview
  trek.html            # One trip detail
  about.html           # About
  contact.html         # Contact
  shared/
    site.css           # Layout + type (hand-written CSS, no Tailwind build)
    chat-trigger.js    # The iframe inject/dismiss logic
  assets/
    hero-placeholder.jpg  # A couple of stock images for visual weight
```

### 2.2 Pages

Five pages, each ~80–150 lines of hand-written HTML. Content is placeholder — recognisable as adventure-travel copy without claiming any real Swoop accuracy.

| Page | File | Content shape |
|---|---|---|
| Home | `index.html` | Hero + intro + three region cards + footer |
| Regions | `regions.html` | Grid of Patagonia regions (Torres del Paine, El Chaltén, Carretera Austral, Tierra del Fuego) |
| Trip detail | `trek.html` | One example trip ("W Trek") with hero, itinerary stub, gallery stub, "speak to a specialist" CTA |
| About | `about.html` | Who Swoop are, values, team stub |
| Contact | `contact.html` | Phone/email + "chat with us" CTA prominently placed |

Placeholder copy is fine. Placeholder-ish images (free-licence stock, or geometric placeholders) are fine. Goal: looks like a site, not a prototype.

### 2.3 Navigation

- Top nav bar on every page: `Home | Regions | Trips | About | Contact | [Chat to us →]`.
- Internal links use `<a href="regions.html">` — browser performs a **full page load**.
- **No client-side router.** This is load-bearing. A React Router or similar SPA approach would hide the real failure mode (iframe remount) that we specifically want to observe.
- One or two in-page links per page that cross-link naturally (e.g. "See the W Trek" on the Regions page links to `trek.html`).

### 2.4 Chat iframe trigger

- "Chat to us" button lives in the top nav.
- Clicking it injects an iframe (~400×600, bottom-right, fixed position) into the current page, pointing at `http://localhost:5173`.
- Clicking it again closes the iframe.
- No state persistence of open/closed across pages — because the page reload nukes the DOM. **That's the observation we want.**
- Iframe has a visible close button (`×` in the corner) for manual dismissal.
- Implementation: ~50 lines of vanilla JS in `shared/chat-trigger.js`, wired via `<script src="shared/chat-trigger.js" defer>` on every page.

### 2.5 Dev-only markers

- **Page banner**: a small bar at the top of every page reading "MOCK HOST — dev only, not shippable". Bright enough to be unmissable, muted enough not to obliterate the rest of the page.
- **Title bar**: `[MOCK] <page name>` so browser tabs read `[MOCK] Home — Swoop-ish`.
- **README banner**: the first paragraph of `README.md` says, in so many words, "do not deploy this to any environment. It is a local testing harness for the Puma chat iframe."
- **Port separation**: 4173 (just next door to 5173, but distinct enough that a mis-clicked URL can't confuse the two).

### 2.6 Dev workflow integration

Three processes now need to run for a full dev session:
1. Orchestrator at `:8080`
2. Chat UI at `:5173`
3. Mock host at `:4173`

Simplest integration: add a `mock-host` script to `product/package.json` that does `npx serve product/mock-host -l 4173` (or `npx http-server` equivalent). Optionally a `dev:all` script using `concurrently` that runs all three.

README documents both the one-process-per-terminal path and the combined path. No new infrastructure.

---

## 3. Architectural principles applied here

Extends canonical [`01-top-level.md`](01-top-level.md) §3 themes:

- **Theme 4 — Swap-out surfaces named**: the mock host has zero swap cost because it never ships. If real Swoop integration behaviour differs in ways the mock host didn't predict, we throw the mock host away and learn from the real thing.
- **Theme 5 — Disposable ETL**, generalised: disposable **test harnesses**, same posture. The mock host is throwaway infrastructure; no engineering investment in "making it good enough to keep".
- **Theme 7 — Production quality on minimum surface**: the mock host is NOT production surface, so the production quality bar does not apply. Intentionally scruffy is fine.
- **New invariant for this chunk**: **the harness must reproduce production iframe behaviour faithfully, especially the unpleasant parts.** If we make the harness do client-side routing or iframe-surviving navigation because it feels nicer, we blind ourselves to the failure modes the harness exists to surface.

---

## 4. PoC carry-forward pointers

None directly. The PoC never had a host site — ChatGPT was the host.

Tangential references:
- `chatgpt_poc/product/ui-react/src/dev-harness.tsx` — PoC's dev harness pattern, but for widget-level testing, not site-level. Not directly reusable.
- Swoop's actual website (publicly browsable at swoop-adventures.com) — **reference only**, for nav structure inspiration and visual weight. Do not copy their actual assets or copy — placeholder everywhere.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| MH.1 | Tech stack | **Plain static HTML + hand-written CSS.** No build step. No Tailwind. No React. | Zero build, zero deps, maximum honesty about the throwaway nature. Also avoids any confusion with the real chat UI's stack. |
| MH.2 | Routing style | **Full browser page reloads via `<a href>`.** No client-side router. | Load-bearing. The iframe-remount failure mode is the entire observation target. Client-side routing would hide it. |
| MH.3 | Workspace integration | **Not a workspace package.** Standalone folder. | Minimum monorepo surface. Matches `product/cms/` exclusion rationale. |
| MH.4 | Deploy targets | **None. Local only.** | Cannot accidentally become production. Enforced by `.gitignore`-style convention + README banner. |
| MH.5 | Iframe trigger + chrome | **Top-nav "Chat to us" button toggles a right-docked sidebar** (full viewport height, default 420px wide on desktop, full-width overlay on mobile). On desktop the page reflows via `body.mock-chat-open { padding-right: var(--mock-chat-width) }`. | Sidebar, not popup. Rationale: once a persistence layer lands, the sidebar's natural mode is "present across navigations if a conversation is in flight" — auto-reopen on page load when state says so. A bottom-right popup implies a user-dismissable affordance, which doesn't fit "resume where you left off". Decided 2026-04-24 after Al observed the popup pattern in the live preview. |
| MH.11 | Sidebar width — user-resizable | **User can drag the sidebar's left edge to resize.** Constraints: min 320px, max 70vw. Width is exposed via `--mock-chat-width` custom property on `:root`; both the sidebar and `body.mock-chat-open` padding-right consume it. Chosen width persists in `sessionStorage` under key `mock-chat-sidebar-width` and is re-applied on every open (including after full page reload). | Natural ergonomic affordance for a sidebar, plus the stored-width behaviour rehearses the same `sessionStorage` pattern the persistence workstream will use for session-id storage — keeps the harness's storage contract coherent with future work. |
| MH.6 | Content | **Placeholder copy + free-licence or geometric placeholder images.** | Fastest path to visible structure. No risk of misrepresenting real Swoop content. |
| MH.7 | Port | **`:4173`**. | Adjacent to 5173 but distinct enough to avoid mis-clicks. Conventional "preview" port for Vite-adjacent tooling, so mentally tagged as "non-primary". |
| MH.8 | Styling scope | **Minimal hand-written CSS for layout + type.** Readable, clearly a site, nothing more. | Brand styling belongs on the real Swoop site. Even a light Tailwind dep is over-engineering here. |
| MH.9 | Dev-only signalling | **Page banner + title prefix + README banner + port separation.** | Multiple overlapping signals. A reasonable person cannot mistake this for a real product. |
| MH.10 | Static server | **`npx serve -l 4173`** or equivalent via `product/package.json` script. | No custom Node process. Off-the-shelf static serving. |

---

## 6. Shared contracts consumed

**None.** The mock host's only interface with the rest of the system is the hard-coded iframe `src="http://localhost:5173"`. No message passing, no typed contracts, no shared schemas. If 5173 isn't running, the iframe loads broken — that's fine, it's just dev.

If later work (W1/W2 persistence) introduces iframe ↔ parent `postMessage` coordination, the mock host becomes one end of that contract. That's a future decision; not closed here.

---

## 7. Open sub-questions for Tier 3

- Exact content of each of the five pages — drafting placeholder copy is a small creative task but does want a single pass through.
- Image sourcing: free-licence stock vs geometric placeholders vs hand-drawn noise patterns.
- Whether to include a deliberately tempting in-page link on one page (e.g. "See the full itinerary") specifically so the observer can click it mid-conversation and feel the iframe die. Useful for demos.
- Whether the nav "Chat to us" button persists as visible even when the iframe is already open, or swaps to a "Chat is open →" indicator.
- Whether to add a dev-only keyboard shortcut (e.g. `Cmd+Shift+C`) to toggle chat from any page, for faster testing.
- Whether to add a second "trigger from a page element" button somewhere (e.g. on the trip detail page, a "Ask about this trip" link that opens chat) — useful for later deep-linking tests.

None of these block scaffolding; decide during Tier 3 authoring of MH.t1–t3.

---

## 8. Dependencies + coordination

- **Inbound**: needs the chat UI already running at :5173 for the iframe to load into something. Currently running as part of the M1 stack. No new work.
- **Outbound**: none. No other chunk consumes this.
- **Agent coordination**: contained. One Tier 3 agent can own MH.t1–t3 end-to-end without touching anyone else's work. Does not block the hackathon subagent at all.
- **Swoop coordination**: none. This is internal tooling.

---

## 9. Verification

Chunk is done when:

1. Running the documented one-liner brings up `:4173` serving `index.html`.
2. All five pages load and render visibly as recognisable-if-scruffy Swoop-shaped pages.
3. Top-nav internal links navigate between pages via full page loads (verifiable via DevTools Network tab showing fresh document requests).
4. "Chat to us" button injects the iframe; chat inside the iframe connects to `:8080` orchestrator and works identically to hitting `:5173` directly.
5. Navigating to a different page **visibly destroys the iframe and any active conversation**, reproducing the production failure mode we want to observe. Ideally captured in a screenshot / screen recording for the record.
6. The mock-host banner is unmissable on every page.
7. README gives a competent developer everything they need to stand this up cold.
8. Al demos the harness to an imagined Julie or Luke without cognitive dissonance.

---

## 10. What happens after this ships

The harness exists. Al clicks around. The chat dies on navigation, loudly and visibly. At that point we have evidence, not speculation, about:

- How disruptive the loss actually feels at reading distance.
- Whether any adjacent behaviours (consent re-prompting? iframe load time? re-triggering the button state?) emerge as secondary problems.
- Whether a "minimised/re-appear" pattern from Swoop's side would obviate the need for our side to do anything clever.
- Whether the specific failure modes match what the parent side-quest Tier 1 doc anticipated, or whether they're different.

**Only then** do we decide whether to execute W1 (server history endpoint) and W2 (client rehydration on mount), or a different fix entirely (parent-page `postMessage` coordination, localStorage, Swoop integration pattern changes, or "accept as-is"). That decision is explicitly post-observation — not pre-scoped here.

If the answer turns out to be "rehydrate on mount" (W1 + W2 as pitched), the parent Tier 1 side-quest plan at [`01-side-quest-persistence.md`](01-side-quest-persistence.md) §5 still holds and the cascaded Tier 2 edits in that doc still apply.

If the answer is something else, we write a new Tier 1 / Tier 2 plan against the evidence the harness surfaced.

---

## 11. Order of execution (Tier 3 hand-off)

Three small tasks. Expect ~0.5 day total for a focused agent.

- **MH.t1 — Scaffold + single page + iframe embed.** One HTML file (`index.html`), shared CSS, shared JS, iframe pointing at `:5173`. Proves the minimal shape works end-to-end. Nav bar with the chat trigger in place but only self-linking.
- **MH.t2 — Full five-page set + internal nav.** Clone the scaffold into the four remaining pages. Populate with placeholder content. Wire internal links. Confirm full-page-load navigation tears down the iframe as expected.
- **MH.t3 — README + dev-workflow script + verification sweep.** Authoring `README.md` with run instructions and "known behaviour: chat dies on nav" documentation. `mock-host` script added to `product/package.json`. Walkthrough of all verification items in §9.

Optional follow-up:
- **MH.t4 (optional)** — add the deliberate "tempt the user to navigate mid-conversation" link on the trip page and/or a keyboard shortcut for chat toggle, if demo use shows these would help.
