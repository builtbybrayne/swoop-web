// product/ui/vite.config.ts
//
// Vite dev + build for the Puma chat surface. Single SPA — no per-widget
// singlefile builds, no env-flag trickery (the PoC had those; we don't need
// them).
//
// - React plugin + TypeScript.
// - Dev port 5173 (Vite default, explicit for visibility).
// - Env var prefix `VITE_` — only `VITE_*` envs are bundled; see `.env.example`.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: "VITE_",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
