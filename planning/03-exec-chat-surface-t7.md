# 03 — Execution: D.t7 Mobile Reflow Pass

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: D (chat surface).
**Implements**: [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §2.9 (mobile responsive baseline). Also discharges verification item §9.9 ("Mobile viewport at 375px wide renders without horizontal scroll, widgets reflow").
**Depends on**: D.t1–t5 all shipped. D.t4's disclosure surfaces, D.t3's four widgets, D.t5's ErrorBanner + "New conversation" button are the live targets of this pass.
**Produces**:
- Small Tailwind class additions on a handful of surfaces (enumerated below).
- Possibly one extra grid-breakpoint tweak in `search-results.tsx` and one form-layout tweak in `lead-capture.tsx`.
- No new files, no new components, no structural restructures.
- A three-viewport verification walkthrough captured in the "Verified" section after implementation.
**Estimate**: ~1.5–2h focused work including live preview verification at three viewports.

---

## Purpose

M1 shipped on a desktop viewport. Tailwind classes were written with breakpoint awareness in places (search-results grid already has `sm:grid-cols-2 lg:grid-cols-3`) and without it in others (header row, banner, composer, consent screens). This is a dedicated pass through every visible surface at phone-portrait (375px) with the specific goal of **no horizontal scroll, widgets reflow sanely, consent screen usable one-handed**. Tablet (768px) and desktop (1280px) verified alongside so nothing regresses.

Scope is deliberately narrow: inspection + tweaks, not a redesign. Any surface that already looks right at 375px gets a verify-only pass, no edits. Any surface that breaks gets the minimum Tailwind-class change needed to make it reflow cleanly. If a surface would need a layout restructure to work, raise it back to Al rather than quietly re-architecting — D.t7 is a cleanup pass, not a surface rewrite.

Not in scope:
- Swoop brand styling — still Swoop's in-house team's layer (D.7 decision).
- Formal WCAG audit — touch-target sizing comes in incidentally if a button is obviously too small (<44×44 CSS px) but no formal pass.
- A dedicated mobile pane / drawer / bottom-sheet layout — the chat reflows, it doesn't mode-switch (D.6 decision).
- Landscape-phone viewport (~667×375) — Tailwind defaults catch it for free; if something breaks we log and defer.
- Handover doc (D.t8) — separate task.
- Testing against real iOS Safari / Android Chrome — M1 preview tool is Chromium-only; real-device testing happens after M4 deploy.

---

## Breakpoint decision

Confirm Tailwind defaults are adequate. No custom breakpoint needed for Puma:

| Breakpoint | Viewport | Role |
|---|---|---|
| (none / base) | ≥0 | Phone portrait. Single-column everything. Our baseline at 375px. |
| `sm:` | ≥640 | Large phone / small tablet portrait. Two-column grids become viable. |
| `md:` | ≥768 | Tablet portrait. Nothing special — `sm:` classes carry. |
| `lg:` | ≥1024 | Tablet landscape / small desktop. Three-column grid affordable. |
| `xl:` / `2xl:` | ≥1280 / ≥1536 | Not used by Puma. Desktop caps at `lg:` behaviour because the chat column is `max-w-2xl` (672px) anyway. |

Argument for keeping defaults: every chat surface is capped at `max-w-2xl` (672px), which means the only real layout decisions are phone/tablet. `sm:` and `lg:` cover the two transitions we actually make — single-column → two-column (search results cards) and two-column → three-column (same grid) — and Tailwind's default values don't hurt. A custom 375 breakpoint would add maintenance burden for zero gain.

**Decision D.15 (to log on landing)**: keep Tailwind default breakpoints.

---

## Surface inventory

Every visible surface, its current suspected 375px behaviour, and the fix. "Verify only" means inspect in preview; if it renders clean, no edit. "Edit" means a concrete Tailwind class addition expected.

### OpeningScreen (`disclosure/opening-screen.tsx`) — **verify only**

Current classes: `flex h-full w-full items-center justify-center bg-slate-50 p-4` on the outer section, `w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm` on the card, `mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` on the button row.

Expected behaviour at 375px: card fills width with `p-4` outer padding (375 - 32 = 343px card), reads one paragraph per line at `text-sm`, buttons stack vertically (`flex-col-reverse` at base, `sm:flex-row` from 640px upwards). Continue is above Decline on mobile so thumb lands on the primary action — already correct.

**One-handed usable?** Yes — button stack is vertical, tap targets ~40px tall (`py-2` + text), thumb reach from the middle of the screen covers both buttons.

Risk: none suspected. Verify only.

### ChromeBadge (`disclosure/chrome-badge.tsx`) — **verify only**

Small inline pill (`inline-flex items-center gap-1.5 rounded-full … px-2.5 py-1 text-xs`). Natural width, no overflow risk. Left-aligned inside the header row (see next item for the surrounding context).

Verify only.

### Header row in `App.tsx` — **edit**

Current markup (`ThreadSurface`):
```
<div className="flex w-full items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
  <ChromeBadge />
  <div className="flex items-center gap-3">
    <button data-testid="new-conversation" … className="… h-7 … px-2.5 text-xs … ">New conversation</button>
    <div className="text-xs text-slate-400">Swoop Discovery</div>
  </div>
</div>
```

At 375px: ChromeBadge pill (~120px wide) + gap-3 + "New conversation" button (~120px) + gap-3 + "Swoop Discovery" label (~120px) = ~360px + 2×16 horizontal padding = ~392px. **Crowded or wrapping suspected.** Almost certainly one of:
- The right-hand group wraps below the ChromeBadge (acceptable but visually lumpy).
- The "Swoop Discovery" brand label and the New-conversation button overlap or the label truncates (`text-xs` means no natural wrapping inside a single row).

**Fix**: hide the purely-decorative "Swoop Discovery" label below `sm:` — it's brand residue, not a load-bearing surface, and the ChromeBadge already discloses what the tool is. Add `hidden sm:block` (or `sr-only sm:not-sr-only` if we want it for screen readers on every breakpoint — probably not, it's visual-only).

Concrete change:
```
<div aria-hidden="true" className="hidden text-xs text-slate-400 sm:block">
  Swoop Discovery
</div>
```

That leaves ChromeBadge on the left and the "New conversation" button on the right — both load-bearing, both visible at 375px, comfortable with room to spare. No `App.tsx` structural change; one class addition.

**Coordination flag**: this is a one-class edit inside `App.tsx`. `planner-d6` is the current primary owner of `App.tsx` structural changes. `SendMessage` to `planner-d6` before landing: a one-line "I'm adding `hidden sm:block` to the Swoop Discovery label in the header's right-hand group — purely CSS, no structural change, shouldn't conflict". Proceed unless they flag.

### Thread viewport — **verify only**

`<ThreadPrimitive.Viewport className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-4">` wrapping `<EmptyState />` + `<ThreadPrimitive.Messages />`. Each `MessageView` has `max-w-2xl` which at 375px becomes 343px (fills the column minus 32px of horizontal padding). Text wraps naturally.

Verify only.

### Composer row in `App.tsx` — **verify only (probably)**

`<ComposerPrimitive.Root className="flex w-full max-w-2xl items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm focus-within:border-slate-400">` — textarea + Send button. Send is `h-9 … px-3 text-sm` — fixed ~72px wide. Textarea `flex-1 resize-none bg-transparent px-2 py-2` — fills the rest. At 375px: ~280px textarea + gap-2 + ~72px send + `p-2` wrapper = ~360px, fits inside the column.

Verify only, but watch for placeholder text ("Ask anything about an adventure…") truncating with an ellipsis before the user types. Acceptable — it's a placeholder, not content.

### ErrorBanner (`errors/error-banner.tsx`) — **verify only (probably)**

`mx-auto mb-2 mt-2 w-full max-w-2xl rounded-md border px-3 py-2 text-sm` outer. Inside: title + body + action row `mt-1 flex flex-wrap items-center gap-2`. The `flex-wrap` is the key — primary button + secondary button + dismiss × button are free to wrap onto a new line at narrow widths. The dismiss `ml-auto` pushes it to the right; at wrap-time it lands alone on the second row, on the right. That's fine behaviour.

Verify only — but explicitly test the `session_expired` surface (two action buttons, longest labels: "Start a new conversation" + "Try again" — wait, only one primary on that surface, plus dismiss ×). Also test `unreachable` which has primary "Try again" + secondary "Start over" + dismiss — three things, most likely to wrap.

### SearchResults widget (`widgets/search-results.tsx`) — **verify only**

Grid: `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3`. At 375px: single column, each card fills the column. Image on top, text below. Already handled.

Card text: `h3` at `text-base`, summary at `text-sm` with `line-clamp-3`. Entity pill is small. All handled.

Verify only.

### ItemDetail widget (`widgets/item-detail.tsx`) — **verify only with one flag**

Hero image, title, summary, attribute table (2-column grid — see `AttributeTable.tsx`), gallery strip (`flex gap-2 overflow-x-auto pb-1` with each gallery item `h-20 w-32 flex-shrink-0 sm:h-24 sm:w-40`).

AttributeTable is a 2-column grid (`dt` label / `dd` value pattern). At 375px with long activity lists ("hiking, kayaking, glacier trekking") this might crowd — but we're already using `grid` with CSS grid auto-sizing, and the value column naturally takes remaining width.

Gallery strip already scrolls horizontally — by design for a gallery, not a bug.

Verify only. **Flag if crowding**: if the attribute labels wrap awkwardly at 375px (likely for "Activities") consider adding `grid-cols-[auto_1fr]` or converting to a stacked `flex-col sm:grid` pattern. Decide at implementation time.

### Inspiration widget (`widgets/inspiration.tsx`) — **verify only**

Horizontal scroll strip (`flex gap-3 overflow-x-auto pb-2`) of cards at `w-48 sm:w-56`. Horizontal scroll is the intended behaviour. Lightbox overlay is `fixed inset-0 … p-4` with `max-w-3xl` inner — at 375px the `p-4` gives 343px of usable width, perfect.

Verify only.

### LeadCapture widget (`widgets/lead-capture.tsx`) — **edit**

This is the one I expect to actually need a change. Two places to inspect:

1. **Step 1 (summary)** — `rounded-lg border … p-4` card, text blocks stacked `flex-col gap-3`. Natural mobile layout. Verify only.
2. **Step 2 (form)** — form fields stack vertically (`flex flex-col gap-1` per field), which is already mobile-correct. The one concern is the "Preferred contact method" fieldset: `flex flex-wrap gap-3 text-sm` radio row. At 375px: three radios ("email", "phone", "either") should fit on one line (each ~60–70px wide including radio). Probably fine, `flex-wrap` catches edge cases.
3. **Submit buttons row** — `mt-2 flex gap-2` with "Send my details" + "Back". At 375px both `CtaButton`s fit side-by-side (~160px + ~60px + gap). Acceptable.
4. **Consent checkboxes** — `flex gap-2 text-sm` with checkbox + multi-line label text. Label text is long ("I agree Swoop can share my conversation summary and contact details with a specialist so they can follow up."). At 375px it wraps to ~3–4 lines, checkbox stays aligned top with `mt-0.5`. Fine.

**Fix suspected**: the input fields use no `max-w` — they'll fill the card width, which is what we want on mobile. Verify only.

**Flag if off**: if any input rendering overflows (`type="email"` sometimes has browser-specific sizing), add `w-full` to each `<input>` — belt-and-braces.

Most likely outcome: **verify only**, no edit. Listed as "edit" to be honest about which surface most commonly needs mobile tweaks in practice; if the preview walkthrough shows it's clean, land with zero changes.

### PrivacyInfoModal (`disclosure/privacy-info-modal.tsx`) — **verify only**

`fixed inset-0 z-50 flex items-center justify-center … p-4` outer backdrop, `w-full max-w-lg … p-5` inner. At 375px: 343px inner card with 20px padding = 303px content width. Body text wraps naturally. Close × button is 28×28, acceptable tap target.

Verify only.

### Tool-error placeholder (`widgets/widget-shell.tsx`'s `WidgetMalformedPlaceholder`) — **verify only**

`my-2 rounded-md border … px-3 py-2 text-sm`. Two text lines. Natural flow.

Verify only.

### Opening-screen declined state — **verify only**

Same card pattern as the active opening screen. Natural flow.

---

## Expected edits (summary)

After the verify-only passes filter out surfaces that already work, the expected concrete edits are:

1. **`App.tsx` header row** — add `hidden sm:block` to the "Swoop Discovery" label to remove header crowding at 375px. (One class change, touches `App.tsx`. Coordinate with `planner-d6`.)
2. **Possibly** a `w-full` addition on `lead-capture.tsx` inputs if browsers are sizing them sub-container. Verify first.
3. **Possibly** an `AttributeTable` layout tweak in `item-detail.tsx` if labels wrap ugly. Verify first.

That's it. Planning on 1 guaranteed edit + 0–2 conditional edits.

---

## Content-as-data compliance

No new copy added. Any existing copy that moves (none expected) stays sourced from its current location — `cms/errors/en.json`, opening-screen `COPY` constant (still scaffolded until E.t5 lands the cms files). This pass touches classes only.

---

## Shared contracts touched

None. No schemas, no transport, no orchestrator interaction. Pure CSS-class-level work on the UI tree.

---

## Verification

Single preview walkthrough at three viewports. Use the Claude Preview tool's `preview_resize` action (or equivalent) to hit each width. Screenshot each surface at each width for the verification record.

### Viewports

1. **Phone portrait — 375×812 (iPhone 13 mini reference).** Primary target.
2. **Tablet — 768×1024 (iPad portrait reference).** Mid-range sanity.
3. **Desktop — 1280×800.** Already-known-good baseline; regressions detector.

### Surfaces per viewport

For each viewport, click-walk through:

1. Land on OpeningScreen — screenshot. Verify: card centered, Continue button reachable one-handed at 375, Decline stacked above/below correctly.
2. Click the privacy info link → PrivacyInfoModal opens — screenshot. Verify: card fits viewport with padding, Close × reachable.
3. Close modal → click Continue → thread surface appears. Screenshot the header row — verify ChromeBadge + New-conversation button fit without overlap; at 375 the "Swoop Discovery" label is hidden (post-fix).
4. Trigger an error surface (kill orchestrator; send a message) → ErrorBanner renders — screenshot. Verify title/body/actions all readable and tap-targetable at 375.
5. Restart orchestrator, start a fresh chat, send a message that triggers each of the four widgets in turn (stubbed connector responses make this deterministic):
   - `search` → SearchResultsWidget with the fixture's multi-hit result. Screenshot grid at 375 (1-col), 768 (2-col), 1280 (3-col).
   - `get_detail` → ItemDetailWidget. Screenshot at 375; verify attribute table rows don't crowd, gallery strip horizontally scrolls cleanly.
   - `illustrate` → InspirationWidget. Screenshot horizontal strip; tap an image to open lightbox; screenshot lightbox at 375. Verify lightbox inner doesn't overflow.
   - `handoff` → LeadCaptureWidget step 1 → Continue → step 2 form. Screenshot each step at 375. Fill the form and verify consent checkbox label wraps cleanly with checkbox alignment preserved.
6. Tap "New conversation" button → thread clears → screenshot header row in cleared state at 375 to confirm button still visible and reachable.

Pass criteria:
- No horizontal scroll on any surface at 375px.
- Every interactive element has a tap target ≥40×40 CSS px at 375px. (`h-9`, `h-7`, checkbox, radios — all fine; the chrome-badge pill is `h-[~22px]` which is below target but it's a disclosure affordance not a primary action, accept.)
- No text overlaps or gets clipped at any of the three viewports.
- Widgets reflow as expected: search grid 1→2→3 cols, gallery strips remain horizontally scrolling, detail attribute rows readable.
- LeadCapture form is fillable one-handed at 375 — no field requires horizontal scroll, submit button reachable with thumb.

### Failure modes to watch for

- ComposerPrimitive.Input growing under long text pushes Send button off-screen. (assistant-ui's textarea-autosize should handle it — if not, add `max-h-40` to constrain.)
- Error banner's three-button action row wrapping ugly on the `unreachable` surface (primary + secondary + dismiss). Already using `flex-wrap` so expected-fine, but eyeball it.
- Inspiration lightbox `p-4` outer padding insufficient at 375 if the inner image has a wide aspect ratio — might cause the Close button to sit behind a notch / status bar in iOS testing (post-M4 concern, flag for later).
- `preview_stop` + `preview_start` the preview tool if Vite HMR gets stuck mid-walk (per gotchas.md).

---

## Out-of-scope reminders (don't drift)

- No new widgets, no new components, no new CMS content.
- No structural changes to `App.tsx` beyond the one-class edit to the brand label. If something "feels off" and would require a layout restructure — stop, flag it to Al, defer.
- No `tailwind.config.js` breakpoint changes. Defaults confirmed adequate.
- No typography scale changes. (Al may want a future pass for type polish; that's D.t8 / Swoop brand territory, not this.)
- No accessibility audit. Touch-target note above is incidental, not a full pass.
- No real-device testing — preview tool only.
- Do NOT touch `runtime/*` (planner-d6's territory post-M1), `ts-common/*` (planner-e1f's), or anything outside `product/ui/src/` and `product/ui/tailwind.config.js`.

---

## Agent coordination

- **`planner-d6`** — currently scoping D.t6 which also touches `App.tsx`. Send a short declarative message before landing the one-class change: "D.t7 adds `hidden sm:block` to the Swoop Discovery label in ThreadSurface's header right-group. One class, no structural change. Shouldn't conflict with D.t6's session-status UI wherever that lands — confirm?" Wait for ack (1-exchange max). If d6 flags conflict, negotiate a line or an ordering.
- **`planner-e1f`** — no overlap. No contact needed.
- **`planner-h`** — no overlap. No contact needed.

---

## Handoff

D.t8 (handover doc) immediately follows and documents the brand-extension surface for Swoop's in-house team. D.t7's verify-outcome (classes we added, classes we deliberately didn't) is an input to D.t8 — note any "this class exists because 375px requires it" decisions so the in-house team doesn't accidentally override them during brand-skin application.

---

## Landed — to be filled post-implementation

Document on landing:
- Screenshots at three viewports for each surface walked.
- Classes actually changed (expect: 1; tolerate up to 3 per the conditional edits above).
- Any surface flagged for follow-up that wasn't fixed here.
- Decision D.15 logged in `planning/decisions.md`: Tailwind default breakpoints confirmed adequate, no custom breakpoint added for Puma.
- Sibling coordination outcome with `planner-d6`.
