// product/ui/vitest.config.ts
//
// Vitest configuration for `@swoop/ui`.
//
// - jsdom env so React Testing Library can mount components against a DOM.
// - Loads `vitest.setup.ts` which wires `@testing-library/jest-dom` matchers.
// - Restricted to `src/**/*.test.{ts,tsx}` so fixtures and app source don't get
//   globbed as tests.
// - Reuses the vite React plugin so TSX compiles the same way as the dev build.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
