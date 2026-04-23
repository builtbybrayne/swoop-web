// product/ui/tailwind.config.js
//
// Tailwind 3, clean defaults. No Swoop brand tokens — Swoop's in-house team
// applies brand identity post-M5 (decision D.7 in planning/02-impl-chat-surface.md).
// Content glob covers the SPA source + index.html.

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
