// product/ui/tailwind.config.js
//
// Tailwind 3, clean defaults + a 12-token brand-extension surface (D.21).
//
// The theme.extend block defines a deliberately small set of CSS-variable-
// backed tokens that Swoop's in-house team can override without touching TS.
// All colour tokens are consumed through Tailwind as `bg-swoop-*` /
// `text-swoop-*` / `border-swoop-*`, which resolve to `var(--swoop-*)` at
// runtime. Overrides live in `src/styles/index.css` under `:root` (light)
// and `[data-theme="dark"]` (reserved; Puma ships light-only for now).
//
// Twelve tokens, no more — keeps the handover doc short and the override
// surface testable. See HANDOVER.md for the authoring contract.
//
// Token groups:
//   Brand colour      — accent, accent-fg, surface, surface-fg
//   Chrome            — border, muted, muted-fg
//   State             — success, warning, danger
//   Typography / form — font-sans (fontFamily), radius (borderRadius)
//
// The density utility (`data-swoop-density`) is a single data-attribute hook
// on the root element that scales the composer / header padding — post-M5
// brand polish lever, not consumed by any component yet.
//
// Existing slate-* classes (used throughout the tree) are intentionally
// untouched: they are utility primitives we treat as part of the unstyled
// substrate. Brand overrides land on the swoop-* tokens; slate-* is the
// scaffolding Swoop's team can leave alone.

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        swoop: {
          // Brand accent. Primary CTA + focus ring.
          accent: "var(--swoop-accent)",
          "accent-fg": "var(--swoop-accent-fg)",
          // Panel / card background.
          surface: "var(--swoop-surface)",
          "surface-fg": "var(--swoop-surface-fg)",
          // Chrome / secondary UI.
          border: "var(--swoop-border)",
          muted: "var(--swoop-muted)",
          "muted-fg": "var(--swoop-muted-fg)",
          // Semantic state. Error banner + lead-capture validation share these.
          success: "var(--swoop-success)",
          warning: "var(--swoop-warning)",
          danger: "var(--swoop-danger)",
          // Extension namespace (`--swoop-x-*`) — default-theme garnish, not
          // part of the twelve-token contract. See styles/index.css.
          deep: "var(--swoop-x-deep)",
          sky: "var(--swoop-x-sky)",
          tint: "var(--swoop-x-tint)",
        },
      },
      fontFamily: {
        swoop: "var(--swoop-font-sans)",
        "swoop-display": "var(--swoop-x-font-display)",
      },
      borderRadius: {
        swoop: "var(--swoop-radius)",
        // Cards run 2× the radius token so brand overrides scale the whole
        // shape language from the single `--swoop-radius` lever.
        "swoop-lg": "calc(var(--swoop-radius) * 2)",
      },
      boxShadow: {
        // Deep-navy-tinted soft shadows — lighter than Tailwind's grey
        // defaults; base colour is the site's #05143a.
        "swoop-card":
          "0 1px 2px rgba(5, 20, 58, 0.05), 0 4px 14px -4px rgba(5, 20, 58, 0.12)",
        "swoop-card-hover":
          "0 2px 4px rgba(5, 20, 58, 0.06), 0 10px 28px -8px rgba(5, 20, 58, 0.20)",
      },
    },
  },
  plugins: [],
};
