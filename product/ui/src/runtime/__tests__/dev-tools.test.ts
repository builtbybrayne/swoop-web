// product/ui/src/runtime/__tests__/dev-tools.test.ts
//
// `isDevToolsEnabled` is the single predicate behind every dev/test-only
// affordance — the conversational model picker, the Show/Hide-dev toggle, and
// the in-widget tool-trace / debug surfaces. Two independent ways to be on:
//   1. a non-production build (the `npm run dev` server, or the vitest runner), OR
//   2. a *production* build that baked in `VITE_SHOW_DEV_TOOLS=true` — which is
//      what `npm run demo` does (see scripts/demo.sh), so the affordances reach
//      the demo server even though it serves a production `vite build`.
//
// Mirrors reasoning-guard.test.tsx: we drive `MODE` (a string `vi.stubEnv` can
// override) plus the string flag, because `vi.stubEnv` can't flip the boolean
// `DEV` cleanly.

import { afterEach, describe, expect, it, vi } from "vitest";

import { isDevToolsEnabled } from "../dev-tools";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDevToolsEnabled", () => {
  it("is enabled in a non-production build (dev server / test runner)", () => {
    vi.stubEnv("MODE", "development");
    vi.stubEnv("VITE_SHOW_DEV_TOOLS", "");
    expect(isDevToolsEnabled()).toBe(true);
  });

  it("is disabled in a production build with the flag unset (real prod)", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SHOW_DEV_TOOLS", "");
    expect(isDevToolsEnabled()).toBe(false);
  });

  it("is enabled in a production build when VITE_SHOW_DEV_TOOLS=true (the demo build)", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SHOW_DEV_TOOLS", "true");
    expect(isDevToolsEnabled()).toBe(true);
  });

  it("treats any flag value other than 'true' as off", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SHOW_DEV_TOOLS", "1");
    expect(isDevToolsEnabled()).toBe(false);
  });
});
