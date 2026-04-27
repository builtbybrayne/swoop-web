# 03 - Execution: D.t8 Handover doc (brand-extension surface)

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: D (chat surface).
**Implements**: [`02-impl-chat-surface.md`](02-impl-chat-surface.md) §9 verification item 11 ("Swoop's in-house team can apply their brand styling via a documented extension surface"), plus §2.8 (minimal styling baseline) and §2.9 (mobile reflow baseline).
**Depends on**: D.t1–t7 (all shipped). The chat surface is stable; what remains is to freeze which parts of it are extension surface for Swoop's in-house team versus Puma-internal.
**Produces**:
- `product/ui/src/styles/tokens.css`. The CSS custom-properties surface scoped under `[data-swoop-root]` with sensible defaults.
- `product/ui/src/styles/index.css`. Edits to consume tokens and import `tokens.css` first.
- `product/ui/tailwind.config.js`. Edits referencing the token variables via `theme.extend` so Tailwind utilities and tokens stay in lockstep.
- `data-swoop-*` attribute hooks on load-bearing primitives (ChromeBadge, ErrorBanner, OpeningScreen buttons, Composer, ThreadSurface header, widget shells). Purely additive, no logic change.
- `product/ui/HANDOVER.md`. The Swoop-facing brief. The only file the in-house team needs to read cover-to-cover.
**Estimate**: ~half day focused work.

---

## Purpose

Close the last chunk-D task. Make the chat surface brand-extensible by Swoop's in-house team (Thomas, Richard) without forking Puma and without re-touching component TypeScript. Define the extension contract narrowly enough that future Puma releases ship without breaking Swoop's overrides, and broadly enough that Swoop matches their site visually without filing tickets.

The shape: a small CSS custom-properties surface, a minimal set of `data-swoop-*` attribute hooks, and an iframe embed recipe. Documented in one file Swoop's team reads, signs off on, and returns to when their brand evolves.

This task does not redesign anything. The surface is already minimally styled; D.t8 chooses what of it becomes public API and what stays internal.

---

## Scope fences

In:
- CSS custom-properties for the minimum set of visual axes (colour, type-family, radius, density).
- Attribute hooks on the primitives Swoop is most likely to re-skin.
- Iframe embed recipe for Swoop's HTML integrators.
- `HANDOVER.md` covering all of the above plus operational notes (deploy URL placeholder, when to break glass, what's frozen).

Out:
- Full design-system extraction (shadcn, tokens.json, Style Dictionary). Overkill for an iframe Swoop hosts once.
- Dark-mode support. Puma ships one palette; the mock-host harness runs light.
- Component slot APIs via React `children` or render-prop patterns. Logic change; D.t8 is additive-only.
- i18n hooks. English-only per top-level §7.
- Storybook or a component gallery. Nice-to-have; chunk H's harness covers behavioural regression; visual regression is Swoop's problem post-handover.
- Any change to message-part rendering, consent UX, or widget behaviour.
- Real brand tokens from Swoop. The surface defaults stay vanilla. When Swoop's brand is ready they override by writing their own `.swoop-override.css` (see HANDOVER §5).

---

## 1. The CSS custom-properties surface

### 1.1 Rationale for the chosen set

The competing failure modes: too few tokens means Swoop forks; too many tokens means we've committed to a public API we can't break without pain. Puma's chat is visually narrow: a header, a scrollable message viewport, a composer, four widget shells, one error banner, one opening screen. The axes that meaningfully change when a brand is applied are brand accent, surface/ink contrast, type family, corner radius, and density. Everything else is implementation detail.

Decision **D.21 (see §6)**: ship twelve tokens, grouped into four axes. No token for hover/focus colour shifts; derived from the base tokens via `color-mix()` inside component styles. No token for shadow; too design-system-shaped, and the current shadow vocabulary (`shadow-sm`) stays acceptable across brand palettes at Puma's size.

### 1.2 The set

Authored in `product/ui/src/styles/tokens.css`:

| Token | Default | Used by |
|---|---|---|
| `--swoop-color-surface` | `#ffffff` | Message-bubble background, composer background, cards |
| `--swoop-color-surface-muted` | `#f8fafc` (slate-50) | Thread viewport background, opening-screen page |
| `--swoop-color-border` | `#e2e8f0` (slate-200) | Every border |
| `--swoop-color-ink` | `#0f172a` (slate-900) | Primary text, primary buttons |
| `--swoop-color-ink-muted` | `#475569` (slate-600) | Secondary text |
| `--swoop-color-accent` | `#0f172a` (slate-900) | Primary action fill (Continue, Send, Retry) |
| `--swoop-color-accent-ink` | `#ffffff` | Text on accent fills |
| `--swoop-color-danger` | `#be123c` (rose-700) | Session-expired banner, form errors |
| `--swoop-radius-sm` | `0.375rem` | Buttons, inputs, banner |
| `--swoop-radius-md` | `0.5rem` | Cards, widget shells, opening-screen dialog |
| `--swoop-font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Everything (Puma has no serif or mono surface yet) |
| `--swoop-density` | `1` | Unitless multiplier Swoop can set to `0.875` or `1.125` to compress or relax padding globally (consumed via `calc()` in a small set of padding utilities, see §1.4) |

Twelve tokens. Each one earns its place because a brand application needs it and none of its neighbours covers it. `--swoop-density` is the one clever token and it's pulling meaningful weight: it lets Swoop compress the chat without touching individual paddings, and lets them relax it for a more premium feel, without committing us to fourteen separate spacing tokens.

### 1.3 Scope: `[data-swoop-root]`, not `:root`

Tokens live under a `[data-swoop-root]` selector, not `:root`. Reasons:

1. The chat is an iframe. `:root` would work, but scoping the tokens to a named attribute makes them unambiguously Puma's and prevents accidental cross-talk if Puma's build ever ends up loaded into a parent document (unlikely for Puma, defensive for the future).
2. Swoop's override file targets `[data-swoop-root]` with the same specificity, so their overrides sit alongside the defaults in the cascade rather than fighting `:root`-declared tokens.
3. Storybook-adjacent dev surfaces (if they arrive later) opt in by adding the attribute.

`index.html` adds `data-swoop-root` to the `<html>` element. One line, no JS.

### 1.4 Consumption pattern

Two mechanisms:

1. **Tailwind theme extension**. `tailwind.config.js` extends `theme.colors`, `theme.borderRadius`, and `theme.fontFamily` with named keys that resolve to `var(--swoop-color-*)`. Existing utilities like `bg-surface`, `border-border`, `text-ink`, `rounded-md` then resolve through the token layer. Puma's components keep their current Tailwind vocabulary; they route through tokens.
2. **Raw CSS for density-dependent padding**. Four small utilities in `index.css` (`.swoop-pad-tight`, `.swoop-pad-default`, `.swoop-pad-relaxed`, and the corresponding vertical variants) compute padding via `calc(var(--swoop-density) * <base>)`. Used in the ThreadSurface header, Composer root, widget shells, and OpeningScreen dialog. Not applied everywhere, just the frames where compression or relaxation lands visibly.

Net effect: a Swoop team that reads HANDOVER.md writes a stylesheet that sets eight of the twelve tokens, loads it after Puma's built CSS, and re-skins the chat. No React, no rebuild on Puma's side.

---

## 2. Component override hooks

### 2.1 What gets a hook, what doesn't

Not every primitive needs an override hook. The discriminator: if Swoop's brand team wants to re-skin this element specifically (as opposed to re-colouring it globally via tokens), an attribute hook earns its place. Anywhere token overrides suffice, no hook.

Decision **D.22 (see §6)**: data-attribute hooks on the following primitives only. Other primitives stay hook-free and are re-skinnable via tokens.

| Primitive | Hook | Why it earns a hook |
|---|---|---|
| ThreadSurface header | `data-swoop-part="header"` | Swoop might match their site's own header height or background treatment; token-only doesn't cover layout shifts. |
| ChromeBadge | `data-swoop-part="chrome-badge"` | Legally-required disclosure affordance. Swoop can re-style but not remove. Hook lets their CSS target it precisely without depending on our class soup. |
| Composer root | `data-swoop-part="composer"` | Most brand-sensitive affordance next to widgets. Swoop may want a different edge or shadow treatment. |
| Composer send button | `data-swoop-part="composer-send"` | Accent button specifically; different from generic CTA. |
| ErrorBanner root | `data-swoop-part="error-banner"`, plus the existing `data-error-surface` stays | Five sub-surfaces; Swoop may want to theme them collectively without touching five selectors. |
| OpeningScreen dialog | `data-swoop-part="opening-dialog"` | First impression; legally-required surface; distinct from ongoing chat chrome. |
| OpeningScreen continue/decline | `data-swoop-part="opening-primary"` / `data-swoop-part="opening-secondary"` | Same rationale, first-impression affordance pair. |
| Widget shell (all four widgets' outer frame) | `data-swoop-part="widget"` plus `data-swoop-widget="search-results"` / `"item-detail"` / `"inspiration"` / `"lead-capture"` | Widgets are where content density is highest; brand-specific card treatment is the single most likely local override. Per-widget discrimination via the second attribute without multiplying hook names. |
| Lead-capture submit | `data-swoop-part="lead-capture-submit"` | Handoff conversion moment; Swoop brand team may want heavier treatment here specifically. |

Ten hooks total across seven primitive files.

### 2.2 Mechanism: attributes only. No React slots.

Explicitly not in scope:
- React `children` slot props.
- Render-prop component overrides (`renderChromeBadge={...}`).
- Theme context that lets Swoop inject React components.

Reasons to keep it attribute-only:

1. **Swoop's in-house team writes HTML, CSS, and enough React to integrate an iframe. They do not fork npm packages.** The iframe boundary is the API; everything inside it ships as a built bundle. Slot props only help if Swoop is consuming Puma as a React library; they aren't.
2. **Data attributes are schema-stable across major refactors.** If we rename `.composer-root` to `.chat-composer` in a Puma internal refactor, `data-swoop-part="composer"` survives. If we'd committed to a React slot shape, a refactor is a breaking change.
3. **Attribute hooks are visible at HTML inspection time.** Swoop's team DevTools-inspects the running iframe, sees `data-swoop-part="composer"`, and writes CSS against it. They don't need to read our component source.

Scope boundary: if Swoop ever asks for a React-slot override pattern, that's a signal Puma is being consumed as a library, not an iframe, which reshapes the handover entirely and is a new Tier 2 conversation, not a D.t8 edit.

### 2.3 Implementation touch

Each primitive gets a single attribute added to its existing root element. Zero logic change, no prop additions, no test updates beyond re-running the existing suite to confirm attribute presence doesn't break selectors. Widgets' `data-testid` attributes stay; tests keep using them, Swoop's team uses `data-swoop-*`. Separate concerns, separate names.

---

## 3. Iframe embed recipe

### 3.1 What HANDOVER.md tells Swoop's integrator

Puma ships as a built SPA served from a Cloud Run URL (post-M4; placeholder during handover). Swoop's site embeds it via iframe, triggered from a nav-bar button. The mock-host pattern at `product/mock-host/` is the **reference implementation**, not authoritative and not a contract, included to show shape.

The recipe covers:

1. **Iframe HTML snippet**. Exact attributes Puma requires: `src` pointing at the Cloud Run URL, `title="Swoop AI assistant"` (accessibility), `allow="clipboard-write"` (lets visitors copy the handoff confirmation if they want to), and no `sandbox` attribute. Sandbox breaks assistant-ui's internal `postMessage` usage (flagged).
2. **Trigger pattern**. Swoop's nav-bar button inserts the iframe into a sidebar wrapper (the mock-host's right-docked sidebar is the reference shape). Dismiss removes the wrapper. No coordination with Puma is required; Puma doesn't care how it's mounted.
3. **Minimum dimensions**. Width ≥ 320px (opening screen clips below this), height ≥ 520px (opening-dialog card plus below-the-fold affordance). Reflow below those thresholds is Swoop's layout problem to solve, usually full-screen mobile overlay, as the mock host does.
4. **Responsive behaviour**. Puma itself reflows across Tailwind breakpoints (D.t7). Swoop's sidebar or overlay container decides how to carry that; the mock host's `@media (max-width: 720px)` full-width overlay is the reference.
5. **Origin and CSP headers Puma requires**. Cloud Run serves the SPA with `Content-Security-Policy: frame-ancestors https://*.swoop-adventures.com https://swoop-adventures.com`. The exact origin list is a Swoop-provided input, placeholder in HANDOVER, filled in at M5. `X-Frame-Options` is deliberately unset; CSP `frame-ancestors` supersedes it per MDN, and setting both creates conflicting signals for older proxies. The orchestrator's CORS allow-list (`ORCHESTRATOR_ALLOWED_ORIGINS`) must include the same origins; this is an env-var change at deploy time, not a code change.
6. **What not to do**. Don't `postMessage` into Puma (no contract exists). Don't inject CSS into the iframe from the parent (the iframe boundary blocks it; override via the CSS-vars file loaded inside the iframe, per §1). Don't re-host the built SPA on a Swoop origin (breaks the audit trail; session IDs are scoped to the Puma origin).

### 3.2 Trigger integration: the explicit punt

HANDOVER.md does not prescribe a trigger-button design. Swoop's brand team picks copy, placement, icon treatment, and animation. The constraint Puma imposes: the trigger must open something that contains the iframe at the minimum dimensions in §3.1.3. Everything else is Swoop's call.

Reasoning: the mock-host pattern (right-docked resizable sidebar) is one viable answer, not the only one. A bottom-right popup, a full-screen modal, an inline drop-in: all work. Prescribing one pattern invites arguments we don't need to have; documenting the constraint pattern avoids them.

---

## 4. `HANDOVER.md` authoring brief

Lives at `product/ui/HANDOVER.md`. The audience is Swoop's in-house team: Thomas (fractional CTO-adjacent), Richard (receiving engineer), and whoever does Swoop's CSS. Assume technical competence, assume no prior Puma context.

### 4.1 Structure

Sections in order:

1. **TL;DR**. One paragraph. What Puma is, what this doc is for, who to contact (Al via `al@buddyapps.co` during the support window post-M5).
2. **What you CAN change**. The CSS-vars surface (§1), the attribute hooks (§2), and the trigger integration (§3.2). Each with a concrete worked example: set `--swoop-color-accent: #2f5e4c`, Send button changes.
3. **What you CANNOT change without forking**. The disclosure and consent flow (EU AI Act Art. 50 and GDPR; legal-owned, not visual), the session lifecycle (orchestrator-owned), the widget rendering contracts (`ts-common` schemas), the chat message part types. Each with a one-line "why", never just a NO.
4. **When to break glass**. If Swoop needs a change inside the boundaries in §3, they email Al. Process: describe the change and the user-observable motivation. Al's response within two business days during the support window. Post-support-window escalation path TBD (flagged as Al-side follow-up before M5).
5. **Worked examples**. Two end-to-end sketches: (a) re-skinning to a Swoop brand palette, (b) matching the dimensions of the mock-host sidebar. Each ~20 lines. Enough to unblock first contact.
6. **Iframe embed recipe** (§3.1 content). Exact HTML snippet, exact CSP header value (with origin placeholder), exact minimum dimensions, exact allow-list.
7. **Operational**. Cloud Run URL (placeholder `https://chat.swoop-adventures.com` until M4 confirms), how to test locally against Puma's staging Cloud Run, how to report a bug (GitHub issue template link as placeholder, or email Al).
8. **Compliance handback**. One paragraph: the compliance bundle lives at `product/cms/legal/` and is authored by Al during M5 prep; Swoop's legal counsel reviews and signs off before M5 goes live. Nothing in this handover alters that flow.

### 4.2 Voice

Follows Al's voice conventions (see `alastair-writing-style` skill's Don't list). Direct, no filler, no "it's worth noting". Bullet-dense where it helps; prose where it doesn't. No emojis. No AI-platitudes.

### 4.3 What the doc is NOT

- Not marketing. Thomas and Richard don't need selling to.
- Not a tutorial on CSS custom properties. Audience is professional.
- Not a complete Puma architecture reference. `planning/` holds that. HANDOVER.md points at relevant planning docs for anyone who wants to go deeper; it does not duplicate them.
- Not versioned. This is Puma's handover; when Condor or Guanaco ships, it gets its own HANDOVER.md or a v2 section. No semver on this doc.

---

## 5. Verification

D.t8 is done when:

1. `npm run dev -w ui` still runs; the chat surface is visually unchanged from pre-D.t8 state. The extension surface is additive; defaults match the current appearance.
2. A manual test: copy the worked example from HANDOVER.md §5 into a small `.swoop-override.css` loaded after Puma's built CSS; verify the Send button, opening-screen Continue button, and error-banner accent-fill all shift to the override colour without any other component breaking.
3. DevTools inspection shows all ten `data-swoop-part` attributes present on the expected primitives in a running session.
4. All existing UI tests pass. No new tests required for D.t8; attribute additions are a mechanical change; test framework already asserts on `data-testid` which is unchanged.
5. The iframe embed recipe in HANDOVER.md §6 works verbatim when pasted into the mock-host as a replacement for the current inline `chat-trigger.js` block. Puma loads, disclosure appears, conversation runs end-to-end.
6. A second pair of eyes (Al, or a reviewing agent) reads HANDOVER.md cold and correctly answers: what can they change, what can they not change, how do they override the accent colour, what CSP header do they need, who do they email if they're stuck. If any of those fails, revise.
7. `product/CLAUDE.md` is updated to reference HANDOVER.md under "Key references" (one line).

---

## 6. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| D.21 | CSS custom-properties surface set | **Twelve tokens across four axes (colour, radius, type, density), scoped to `[data-swoop-root]`, consumed via Tailwind's `theme.extend` plus a small `swoop-pad-*` utility set for density-scaled padding.** | Too few tokens and Swoop forks; too many and we've committed to a public API we can't break. Twelve is the minimum that covers brand accent, surface/ink contrast, type family, corner radius, and density: the axes that meaningfully shift under a brand application. `[data-swoop-root]` scope avoids cross-talk with any future parent-document rendering. Tailwind extension keeps the component vocabulary unchanged. |
| D.22 | Component override mechanism | **`data-swoop-part="<name>"` attributes on ten selected primitives. No React slot props, no render-prop overrides, no theme-context component injection.** | The iframe boundary IS the API. Swoop's team consumes Puma as a running iframe, not a React library. Attribute hooks survive refactors that slot-prop APIs wouldn't. Scope is ten primitives (the load-bearing ones: header, chrome badge, composer, error banner, opening-screen buttons, widget shells, lead-capture submit), not every DOM node. |
| D.23 | Iframe trigger integration scope | **Puma documents minimum iframe dimensions, required CSP `frame-ancestors`, and required CORS allow-list. Trigger design (button copy, placement, icon, animation, container pattern) is Swoop's call.** | The mock-host right-docked sidebar is one viable pattern; prescribing it invites arguments we don't need. Constraint-based documentation is more durable than pattern prescription. |
| D.24 | HANDOVER.md location | **`product/ui/HANDOVER.md`, co-located with the `ui/` package that is the subject of the handover.** | The ui package is what gets embedded; keeping the doc alongside means a future maintainer reading `ui/` sees the external contract. The alternative (`/HANDOVER.md` at repo root) conflates internal project management with an external handoff. |
| D.25 | Versioning of HANDOVER.md | **Not versioned in Puma. Next release (Condor or Guanaco) gets its own HANDOVER.md or a v2 section when the extension surface actually changes.** | The release-naming convention (`CLAUDE.md`) already handles the "which release is this?" question; adding semver to a handover doc is overhead without payoff at Puma's scale. If the surface breaks between releases, the new release's doc says so explicitly. |

---

## 7. Out-of-scope reminders (don't drift)

- No dark-mode support.
- No design-tokens.json or Style Dictionary export. The CSS-vars file IS the source.
- No Storybook or component gallery.
- No React slot-prop APIs.
- No animation or motion tokens.
- No spacing scale beyond the single density multiplier.
- No brand-token authoring from Swoop's side inside this repo. They write their own `.swoop-override.css` in their own codebase.
- No automated visual regression. Swoop owns visual regression post-handover.
- No Storybook-driven contract tests for the hooks. DevTools inspection in verification §5 is enough at Puma's surface size.

---

## 8. Handoff

D.t8 is the last chunk-D task. On land:
- `progress.md`. Chunk D moves from partial-with-D.t8-deferred to complete.
- `planning/decisions.md`. D.21–D.25 added.
- `discoveries.md`. One entry on "the iframe boundary IS the API" if the reviewing agent hasn't already captured it.
- `next-steps.md`. #2 (D.t8) drops off the list; remaining priorities renumber.

The brand-extension surface is then stable input into M5: Swoop's in-house team reads HANDOVER.md, writes their override stylesheet, embeds the iframe. Compliance sign-off (E.t9, Swoop-owned) remains the M5 gate; D.t8 does not touch it.
