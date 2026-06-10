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
    // `allowedHosts` is a runtime option in Vite 5.4.12+ (added as a CVE-2025-30208
    // mitigation), but the installed 5.4.11 types pre-date it. Runtime accepts it
    // fine. Remove this directive when the Vite pin is bumped to ^5.4.12.
    // @ts-expect-error — Vite 5.4.11 types lag the runtime option.
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  // preview: mirrors server.proxy so `vite preview` (used by `npm run demo`)
  // preserves the /api/* → :8080 proxy contract. vite preview reads
  // config.preview.proxy, NOT config.server.proxy — without this block the
  // built UI would 404 on every API call. Verified in vite 5.4.11 source:
  // chunks/dep-CB_7IfJ-.js `const { proxy } = config.preview`.
  preview: {
    port: 5173,
    strictPort: true,
    host: true,
    // @ts-expect-error — same Vite 5.4.11 types lag as server.allowedHosts above.
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
