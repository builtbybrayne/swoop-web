// product/ui/src/parts/__tests__/reasoning-guard.test.tsx
//
// Verifies the dev/prod split documented in reasoning-guard.ts.
//
// Vitest runs with `import.meta.env.DEV === true` by default. We toggle
// `import.meta.env.MODE` via `vi.stubEnv` to drive the production branch
// without having to restart the runner.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import {
  ReasoningGuard,
  REASONING_GUARD_MESSAGE,
} from "../reasoning-guard";

/**
 * Swallow React's console.error during the expected-throw case so the test
 * output stays readable. We assert on the thrown error, not on console.
 */
function silenceReactErrorLog() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => spy.mockRestore();
}

describe("ReasoningGuard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  describe("in development", () => {
    beforeEach(() => {
      // jsdom vitest runs with MODE=test (falsy !== "production") by default
      // so the guard already fires. Be explicit for readability.
      vi.stubEnv("MODE", "development");
    });

    it("throws with the chunk-B pointer when rendered", () => {
      const restore = silenceReactErrorLog();
      try {
        expect(() =>
          render(React.createElement(ReasoningGuard)),
        ).toThrowError(REASONING_GUARD_MESSAGE);
      } finally {
        restore();
      }
    });

    it("names the translator as the fix site", () => {
      // Cheap regression on the error text so a sloppy refactor can't
      // silently lose the breadcrumb.
      expect(REASONING_GUARD_MESSAGE).toMatch(/translator/);
      expect(REASONING_GUARD_MESSAGE).toMatch(/D\.9/);
      expect(REASONING_GUARD_MESSAGE).toMatch(/chunk B/);
    });
  });

  describe("in production", () => {
    beforeEach(() => {
      vi.stubEnv("MODE", "production");
    });

    it("silently renders null — no error surface", () => {
      // Should not throw.
      const { container } = render(React.createElement(ReasoningGuard));
      expect(container.firstChild).toBeNull();
    });
  });
});
