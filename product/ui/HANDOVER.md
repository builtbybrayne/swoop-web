# Swoop Web Discovery — UI Handover

This document is the brand-extension contract between the Puma build (Al / Cowork) and Swoop's in-house web team. Everything below is a stable surface: we commit to keeping it working; you commit to using it as the override lever rather than patching component internals.

Read this once, skim the selector table when you're writing overrides, and come back to the embed instructions when it's time to wire the iframe into the Swoop site.

---

## What you're looking at

The `@swoop/ui` package is a React + Vite + Tailwind SPA that renders a conversational discovery surface. It talks to a separate orchestrator service over HTTP + Server-Sent Events. For Puma, the surface is intentionally unbranded — clean Tailwind defaults, slate-grey neutrals, no typography or colour identity. You layer Swoop's brand on top using the two extension surfaces below.

Two surfaces. That's it.

1. **Theme tokens** — twelve CSS variables. Change colours, font, corner radius, density.
2. **Part markers** — `data-swoop-part` attributes on the surfaces that actually matter. Your stylesheet targets these; you never need to reach into Tailwind classes or component internals.

If a brand override feels like it needs a third surface, raise it with Al before forking. The two-surface contract keeps the upgrade path clean when Puma's components evolve.

---

## 1. Theme tokens (twelve of them)

All tokens are defined in `src/styles/index.css` under `:root`. Override by declaring the same variables in a higher-specificity selector loaded after the app's stylesheet — a `<style>` block in the host page, a brand stylesheet imported into `main.tsx`, or (for a clean seam) a dedicated `brand.css` in the iframe wrapper.

| Token | Default | What it drives |
|---|---|---|
| `--swoop-accent` | `#0f172a` | Primary CTA background, active focus ring. |
| `--swoop-accent-fg` | `#ffffff` | Text on the primary CTA. |
| `--swoop-surface` | `#ffffff` | Panel and card backgrounds. |
| `--swoop-surface-fg` | `#0f172a` | Text on surfaces. |
| `--swoop-border` | `#e2e8f0` | Chrome borders, card borders, composer frame. |
| `--swoop-muted` | `#f1f5f9` | Secondary surface (hovered rows, disabled chips). |
| `--swoop-muted-fg` | `#475569` | Text on muted surfaces, helper copy. |
| `--swoop-success` | `#16a34a` | Success state (confirmation copy). |
| `--swoop-warning` | `#d97706` | Recoverable-error banner (unreachable, stream drop). |
| `--swoop-danger` | `#dc2626` | Hard-error banner (session expired), validation text. |
| `--swoop-font-sans` | System sans stack | All sans-serif text. |
| `--swoop-radius` | `0.5rem` | Default corner radius for cards, buttons, inputs. |

### How to override

```css
/* brand.css — loaded after the app stylesheet */
:root {
  --swoop-accent: #ef5b2b;          /* Swoop orange */
  --swoop-accent-fg: #ffffff;
  --swoop-border: #d9dce1;
  --swoop-font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --swoop-radius: 0.25rem;
}
```

Dark mode is reserved but not wired. If you need it, declare a `[data-theme="dark"]` block with the same twelve tokens and flip `data-theme` on the root element from your host page.

### Density

One data-attribute hook: `data-swoop-density` on any surface scales its vertical padding by `--swoop-density` (default `1`). Set `--swoop-density: 0.75` for compact, `1.25` for roomy. Puma ships with the hook defined but unused — a lever for your brand pass, not something we rely on.

---

## 2. Part markers

Every surface a brand team realistically wants to restyle carries a `data-swoop-part` attribute. Target these in CSS rather than reaching for Tailwind classes — the classes will change; the attributes won't.

| Selector | What it is | Where it lives |
|---|---|---|
| `[data-swoop-part="thread-header"]` | The chrome row above the messages (badge, New-conversation button). | `src/App.tsx` |
| `[data-swoop-part="chrome-badge"]` | The persistent "AI assistant" disclosure pill. | `src/disclosure/chrome-badge.tsx` |
| `[data-swoop-part="composer"]` | The message-input frame at the bottom of the thread. | `src/App.tsx` |
| `[data-swoop-part="composer-send"]` | The Send button inside the composer. | `src/App.tsx` |
| `[data-swoop-part="error-banner"]` | The inline error banner (five surfaces: unreachable, stream drop, session expired, rate limited, unknown). | `src/errors/error-banner.tsx` |
| `[data-swoop-part="opening-dialog"]` | The paired AI-disclosure + GDPR tier-1 consent dialog shown on first visit. | `src/disclosure/opening-screen.tsx` |
| `[data-swoop-part="opening-continue"]` | The primary Continue button on the opening dialog. | `src/disclosure/opening-screen.tsx` |
| `[data-swoop-part="opening-decline"]` | The secondary "No thanks" button on the opening dialog. | `src/disclosure/opening-screen.tsx` |
| `[data-swoop-part="widget"]` | Every tool-call widget carries this marker on its root. | `src/widgets/*` |
| `[data-swoop-widget="<name>"]` | Per-widget discriminator — values: `search-results`, `item-detail`, `inspiration`, `lead-capture`. | `src/widgets/*` |
| `[data-swoop-widget-state="<state>"]` | Per-widget state discriminator on the placeholder states — values: `loading`, `malformed`, `empty`, `summary`, `form`, `pending`, `confirmation`. | `src/widgets/*` |
| `[data-swoop-part="lead-capture-submit"]` | Wrapper around the primary handoff-submit button. Style the descendant button here for the primary-action look you want. | `src/widgets/lead-capture.tsx` |

### Worked examples

Brand the Send button:

```css
[data-swoop-part="composer-send"] {
  background: var(--swoop-accent);
  color: var(--swoop-accent-fg);
  border-radius: var(--swoop-radius);
  font-weight: 600;
}
```

Give every tool-call widget a lift:

```css
[data-swoop-part="widget"] {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  border-radius: var(--swoop-radius);
}
```

Target only the lead-capture form step:

```css
[data-swoop-widget="lead-capture"][data-swoop-widget-state="form"] {
  background: var(--swoop-muted);
}
```

Brand the primary handoff CTA (the submit wrapper holds the `<button type="submit">` as its only child):

```css
[data-swoop-part="lead-capture-submit"] > button {
  background: var(--swoop-accent);
  color: var(--swoop-accent-fg);
  border: none;
}
```

### What is NOT a part marker

- `data-testid` — test hooks. Don't rely on these for styling; they can be removed during a test refactor without warning.
- `data-verdict`, `data-step`, `data-entity-type` — semantic runtime metadata. Stable but not the brand-extension contract. Fine to read them; don't treat absence as a bug.
- Class names — Tailwind classes on every surface are load-bearing for the unstyled baseline and will shift as we polish. Use the part markers instead.

---

## 3. Embed instructions

The UI ships as a single-page iframe host. The orchestrator runs separately. Two integration points.

### Iframe host

The UI is a Vite-built static bundle. Build with:

```bash
cd product
npm install
npm run build -w @swoop/ui
```

Output lands in `product/ui/dist/`. Serve the `dist/` folder behind a domain you control (Vercel, Cloud Storage + CDN, or your own static host). The chat surface expects to be iframed — it sets `html, body, #root { height: 100% }` so the iframe's height governs the layout.

Minimum host markup:

```html
<iframe
  src="https://chat.swoop-patagonia.com/"
  title="Swoop Adventure discovery chat"
  style="border: 0; width: 100%; height: 640px;"
  allow="clipboard-write"
></iframe>
```

Height is your call. 640px is a reasonable single-column default; responsive hosts typically pass 100% of a fixed container.

### Orchestrator URL

The UI posts to the orchestrator's `/chat`, `/session`, and `/session/:id/ping` endpoints. The base URL is injected via a Vite env variable at build time:

| Variable | Purpose |
|---|---|
| `VITE_ORCHESTRATOR_URL` | Absolute base URL of the orchestrator. Example: `https://api.swoop-patagonia.com`. |

Set this in `.env` at `product/ui/` during development, or as a build-time env var in your CI. Staging and production get separate builds with separate values — same `dist/` artefact pattern, different env.

### CORS

The orchestrator must allow the iframe origin for `POST`, `PATCH`, `DELETE`, `OPTIONS`, and `GET`. Puma's orchestrator configures this via `ORCHESTRATOR_CORS_ORIGIN`; coordinate with the Puma team (or Al) when you pick your staging and production hostnames so the allow-list is updated in the same deploy.

### Staging vs production checklist

- Build the UI once per environment with the right `VITE_ORCHESTRATOR_URL`.
- Point the iframe to the right static host per environment.
- Confirm the orchestrator's CORS allow-list includes both the iframe's origin AND the host-page origin (the iframe embeds into a page under your main `swoop-patagonia.com` domain).
- Smoke-test: visit the host page, confirm the opening-disclosure dialog appears, click Continue, type a question, verify a response streams back.

---

## 4. What this surface does NOT give you

To save a back-and-forth later, a few things the extension surface intentionally leaves out:

- **Per-message styling overrides.** You can style the thread viewport, but individual message bubbles don't carry part markers. Branding happens at the chrome level, not per-turn.
- **Internationalisation.** Copy is English-only and authored in `product/cms/`. If you want to swap locales, coordinate with the Puma team on a second locale file — don't patch strings in-place.
- **Legal copy.** The paired AI-disclosure + GDPR consent copy lives in `product/cms/legal/` (populated in chunk E). Do not rewrite these in the iframe — they're the contract with your legal reviewer.
- **Analytics.** The UI does not emit host-page analytics events. If you need load / consent / handoff events on the host page, coordinate with the Puma team on a `postMessage` bridge — out of scope for Puma launch.
- **A/B testing of the trigger button.** The button that opens the iframe lives in your host-page code; Puma owns the iframe, not the trigger.

---

## 5. When to ask us

Raise questions to Al:

- You need a new part marker that isn't in the table above.
- You want to override a component's internal layout, not just its styling.
- A theme-token change isn't taking effect and you've ruled out cascade / specificity.
- The orchestrator URL / CORS / embed flow doesn't match your production topology.

The part-marker contract is versioned. A future major UI release may add markers; we will not remove or rename existing ones without a deprecation window. If you see a part marker change between minor versions, that's a bug — tell us.

---

## 6. Pointer to the build

| Thing | Path |
|---|---|
| Theme tokens | `product/ui/src/styles/index.css` |
| Tailwind theme wiring | `product/ui/tailwind.config.js` |
| Part-marker lock-in tests | `product/ui/src/__tests__/brand-extension-surface.test.tsx` |
| Component sources | `product/ui/src/App.tsx`, `src/disclosure/*`, `src/errors/*`, `src/widgets/*` |
| Orchestrator transport adapter | `product/ui/src/runtime/orchestrator-adapter.ts` |
| Build + dev commands | `product/ui/package.json` |

The tests in `brand-extension-surface.test.tsx` are the contract's guardrail: CI fails if a part marker disappears or moves. If you need to verify a marker is still present in a branch you receive from us, run `npm test -w @swoop/ui` and look for the "brand extension surface" suite.
