// product/ui/src/runtime/dev-tools.ts
//
// Single source of truth for whether the dev/test-only affordances should
// render: the conversational model picker, the Show/Hide-dev toggle, and the
// in-widget tool-trace / malformed-widget debug surfaces.
//
// Enabled when EITHER:
//   1. the build is non-production (the `npm run dev` server, any
//      `vite build --mode development`, or the vitest runner — i.e.
//      MODE !== "production"), OR
//   2. the build baked in `VITE_SHOW_DEV_TOOLS=true`.
//
// (2) is what makes the affordances available under `npm run demo`. Demo mode
// serves a *production* `vite build` (MODE === "production", DEV === false),
// which would otherwise dead-code-strip every dev affordance — so
// scripts/demo.sh sets VITE_SHOW_DEV_TOOLS=true for the build and this returns
// true. A served static build can't read runtime env, so the flag is a
// *build-time* `VITE_` var that `vite build` inlines into the bundle (the same
// mechanism as VITE_ORCHESTRATOR_URL).
//
// Both reads use the bare `import.meta.env.<KEY>` form (NOT an aliased copy of
// `import.meta`) so Vite statically replaces them with literals at build time —
// that is the documented, guaranteed-inlined contract; an alias is not
// guaranteed to inline. `MODE` (a string) is also what `vi.stubEnv` can
// override in the unit tests; the boolean `DEV` can't be stubbed cleanly, which
// is why we key off MODE rather than DEV (mirrors reasoning-guard.ts).
//
// NB on dead-code elimination: because each call site is a function call rather
// than an inlined `import.meta.env.DEV` literal, the gated dev code is no longer
// eliminated from a real production build — it ships, inert. That is safe by
// construction: the orchestrator independently 404s `GET /models` and ignores
// any per-request `model` override when NODE_ENV=production (M-PICK-2/3), so the
// *server*, not the bundle, is the security boundary.
//
// See planning/03-exec-crosscut-test-mode-model-picker.md.

/**
 * Whether the dev/test affordances should be active in the current build.
 *
 * True when the build is non-production OR `VITE_SHOW_DEV_TOOLS=true` was set at
 * build time (the `npm run demo` path). Only the exact string `"true"` enables
 * the flag; anything else is treated as off.
 */
export function isDevToolsEnabled(): boolean {
  // Build-time opt-in (the demo build). Checked first so it wins regardless of
  // MODE.
  if (import.meta.env.VITE_SHOW_DEV_TOOLS === "true") return true;
  // Production Vite builds set MODE === "production"; the dev server and the
  // vitest runner do not.
  return import.meta.env.MODE !== "production";
}
