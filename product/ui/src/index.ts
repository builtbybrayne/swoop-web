// product/ui/src/index.ts
//
// Package entry for when downstream code wants to import from `@swoop/ui`.
// The UI is shipped as a Vite SPA, not a library — this file is mostly a
// placeholder so `tsc --noEmit` has a root to type-check from.
//
// Real UI code lives under `src/` and is bundled by Vite (see vite.config.ts).
// If a future chunk needs to re-export components for embedding, add the
// named exports here.

export {};
