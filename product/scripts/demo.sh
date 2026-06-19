#!/usr/bin/env bash
# product/scripts/demo.sh
#
# Demo-server entry point for the Mac Mini. Serves a production UI build
# with the /api/* → :8080 proxy contract preserved, then starts orchestrator
# and connector using their non-watch `start` scripts.
#
# KEY DIFFERENCES FROM dev.sh:
#   • Runs `vite build` (no HMR socket) — eliminates the Vite WS reload class
#     (hypothesis 1 in 03-exec-crosscut-magical-poincare-demo-stability.md).
#   • Runs `npm run start` for orchestrator + connector, NOT dev/watch mode —
#     eliminates file-watch restarts that destroy in-memory sessions
#     (hypothesis 2 in the same plan).
#   • No `--kill-others-on-fail`; each service runs independently. A crash
#     in one does NOT tear down the others. Supervisor (launchd / pm2) handles
#     restart — see product/scripts/launchd/ and product/scripts/setup-demo-services.sh.
#   • dev.sh stays UNTOUCHED — laptop dev workflow is unchanged.
#
# SERVE MECHANISM (OPS.poincare-1):
#   `vite preview` is used to serve the build artefact. It is the idiomatic
#   Vite tool for serving built output; adds no extra dependency; honours the
#   proxy config in vite.config.ts `preview:` block (verified: vite 5.4.11
#   reads `config.preview.proxy`; the `preview:` block was added alongside
#   this script). Port stays 5173 so funnel.sh needs no changes.
#
#   GOTCHA (verified empirically 2026-06-10): vite resolves its root from the
#   CURRENT WORKING DIRECTORY, not from the --config file's directory. Running
#   `vite preview --config ui/vite.config.ts` from product/ serves product/dist
#   (which doesn't exist → 404 on /) while still proxying /api/*. The serve
#   MUST run with CWD = ui/ — hence the `cd ui` before the exec below.
#
#   Host checking: vite 5.4.11 has no allowedHosts enforcement anywhere in its
#   serve path (grep of dist: zero hits) — the Funnel's `Host: <mini>.ts.net`
#   is accepted. The preview.allowedHosts key is forward-compat for the 5.4.12+
#   bump, mirroring the existing server.allowedHosts note in vite.config.ts.
#
# SUPERVISION (normal demo-server operation):
#   Under normal operation on the Mini each service is supervised by launchd
#   (see product/scripts/launchd/ + product/scripts/setup-demo-services.sh).
#   This script is the standalone fallback for operator-driven manual start
#   and for the cold-boot verification step in the runbook.
#
# Usage (from product/):
#   npm run demo                # standard — build + serve UI + start services
#   npm run demo:ui-only        # skip services (useful during UI-only testing)
#
# Prerequisites:
#   • npm install completed (workspaces resolved).
#   • orchestrator built: npm run build -w @swoop/orchestrator
#     (orchestrator start = node dist/index.js — needs a compiled build).
#   • connector has no separate build step (start = tsx src/server/index.ts).
#   • .env files present in orchestrator/ and connector/ (gitignored).
#
# Ports used:
#   :5173 — UI (vite preview, Funnel target)
#   :8080 — orchestrator
#   :3002 — connector (stays private, orchestrator calls it server-side)

set -euo pipefail

cd "$(dirname "$0")/.."

# ----------------------------------------------------------------------------
# Colour helpers
# ----------------------------------------------------------------------------
if [ -t 1 ]; then
  C_BOLD=$'\e[1m'; C_DIM=$'\e[2m'; C_RED=$'\e[31m'
  C_GREEN=$'\e[32m'; C_BLUE=$'\e[34m'; C_RESET=$'\e[0m'
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_BLUE=""; C_RESET=""
fi

log()  { echo "${C_BLUE}[demo]${C_RESET} $*"; }
ok()   { echo "${C_GREEN}[demo]${C_RESET} $*"; }
err()  { echo "${C_RED}[demo]${C_RESET} $*" >&2; }
step() { echo; echo "${C_BOLD}[demo] ── $* ──${C_RESET}"; }

# ----------------------------------------------------------------------------
# Parse flags
# ----------------------------------------------------------------------------

UI_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --ui-only) UI_ONLY=true ;;
    -h|--help)
      echo "Usage: bash scripts/demo.sh [--ui-only]"
      echo "  --ui-only   Build + serve UI only (no orchestrator / connector)"
      exit 0
      ;;
    *) err "Unknown flag: $arg"; exit 2 ;;
  esac
done

# ----------------------------------------------------------------------------
# 1. Build the UI
# ----------------------------------------------------------------------------

step "Building UI (vite build)"
# VITE_SHOW_DEV_TOOLS=true keeps the dev/test affordances (model picker,
# Show/Hide-dev, widget tool-traces) in this PRODUCTION build — they're gated
# behind isDevToolsEnabled() (ui/src/runtime/dev-tools.ts), which a plain
# production `vite build` would otherwise dead-code-strip. The orchestrator
# still 404s /models under NODE_ENV=production, so also set MODEL_PICKER_ALLOWLIST
# in orchestrator/.env to populate the picker's dropdown.
VITE_SHOW_DEV_TOOLS=true npm run build -w @swoop/ui

ok "UI built (with dev tools) → ui/dist/"

# ----------------------------------------------------------------------------
# 2. Start backend services (unless --ui-only)
# ----------------------------------------------------------------------------

if [ "$UI_ONLY" = false ]; then

  step "Starting connector (:3002)"
  # connector start = tsx src/server/index.ts (no pre-build needed).
  # Logs go to stderr; redirect to file when running manually for easy tailing.
  npm run start -w @swoop/connector &
  CONNECTOR_PID=$!
  log "connector PID: ${CONNECTOR_PID}"

  # Brief pause to let the connector bind before the orchestrator connects.
  sleep 2

  step "Starting orchestrator (:8080)"
  # orchestrator start = node dist/index.js (requires built dist/).
  npm run start -w @swoop/orchestrator &
  ORCHESTRATOR_PID=$!
  log "orchestrator PID: ${ORCHESTRATOR_PID}"

  # Brief pause to let the orchestrator bind before the UI starts proxying.
  sleep 2

  ok "Services started. PIDs: connector=${CONNECTOR_PID} orchestrator=${ORCHESTRATOR_PID}"

fi

# ----------------------------------------------------------------------------
# 3. Serve the built UI (vite preview — keeps /api/* proxy)
# ----------------------------------------------------------------------------

step "Serving built UI on :5173 (vite preview)"
log "Proxy: /api/* → http://localhost:8080 (orchestrator)"
log "Funnel target: 127.0.0.1:5173 (see scripts/funnel.sh)"

# CWD must be ui/ — vite's root is the CWD, not the --config dir (see header).
# vite finds ui/vite.config.ts automatically from the CWD; the vite binary is
# hoisted to product/node_modules by npm workspaces.
#
# exec replaces this shell so there's no sh/npm wrapper between the terminal
# and vite (sidesteps the npm SIGTERM-propagation gotcha in ../../gotchas.md).
# Ctrl+C still tears down the backgrounded services too: they share this
# script's process group and the terminal signals the whole group.
cd ui
exec ../node_modules/.bin/vite preview
