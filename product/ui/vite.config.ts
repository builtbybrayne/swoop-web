// product/ui/vite.config.ts
//
// Vite dev + build for the Puma chat surface. Single SPA — no per-widget
// singlefile builds, no env-flag trickery (the PoC had those; we don't need
// them).
//
// - React plugin + TypeScript.
// - Dev port 5173 (Vite default, explicit for visibility).
// - Env var prefix `VITE_` — only `VITE_*` envs are bundled; see `.env.example`.
// - `host: true` binds 0.0.0.0 so Tailscale Funnel can reach the dev server
//   when sharing the demo publicly (see `product/scripts/funnel.sh`).
// - `allowedHosts` lets Vite accept the `*.ts.net` Funnel hostname; without
//   it Vite 5+ blocks unknown Host headers with "Blocked request" errors.
// - `/api` proxy keeps the demo on a single public origin: the UI fetches
//   the orchestrator under same-origin `/api/...`, Vite strips the prefix
//   and forwards to the local orchestrator on :8080. Opt in by setting
//   `VITE_ORCHESTRATOR_URL=/api` in `.env.local`; the default localhost
//   URL still works for plain `npm run dev` without Funnel.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: "VITE_",
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
