#!/usr/bin/env bash
# product/scripts/setup-demo-services.sh
#
# Install / uninstall / manage Puma demo-server launchd services on the Mac Mini.
#
# Each service is a LaunchAgent (user-level, ~/Library/LaunchAgents/) so it:
#   • starts at login without requiring root / sudo;
#   • runs as the repo owner — correct file permissions, same .env access;
#   • is fully controlled per-user by launchctl.
#
# Services managed (all under label prefix uk.co.swoop.puma.*):
#   connector    — @swoop/connector on :3002 (node --import tsx src/server/index.ts)
#   orchestrator — @swoop/orchestrator on :8080 (node dist/index.js)
#   ui           — vite preview on :5173 (/api/* proxy → :8080)
#
# Usage (from product/ or any path):
#   bash scripts/setup-demo-services.sh install      # write plists + load all
#   bash scripts/setup-demo-services.sh uninstall    # unload all + remove plists
#   bash scripts/setup-demo-services.sh status       # show launchctl status
#   bash scripts/setup-demo-services.sh restart      # unload + load all
#   bash scripts/setup-demo-services.sh restart-ui   # rebuild UI + restart ui svc only
#   bash scripts/setup-demo-services.sh logs [svc]   # tail logs (connector/orchestrator/ui/all)
#
# Prerequisites:
#   1. npm install completed in product/.
#   2. Orchestrator built: npm run build -w @swoop/orchestrator
#      (orchestrator start = node dist/index.js — requires compiled dist/).
#   3. UI built: npm run build -w @swoop/ui (or run `install` which builds for you).
#   4. .env files present: orchestrator/.env and connector/.env (gitignored).
#
# Node path detection:
#   The script resolves `node` from PATH at install time and writes its
#   absolute path into the plists. If you use nvm, ensure the correct version
#   is active before running install. The plists invoke node directly — no
#   npm wrapper — so launchd's SIGTERM reaches the service process (see the
#   npm SIGTERM gotcha in gotchas.md).
#
# Logs:
#   ~/Library/Logs/puma/{connector,orchestrator,ui}.{log,err.log}

set -euo pipefail

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PRODUCT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_TEMPLATES_DIR="$SCRIPT_DIR/launchd"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOGS_DIR="$HOME/Library/Logs/puma"

LABELS=(
  "uk.co.swoop.puma.connector"
  "uk.co.swoop.puma.orchestrator"
  "uk.co.swoop.puma.ui"
)

# ----------------------------------------------------------------------------
# Colour helpers
# ----------------------------------------------------------------------------

if [ -t 1 ]; then
  C_BOLD=$'\e[1m'; C_DIM=$'\e[2m'; C_RED=$'\e[31m'
  C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_BLUE=$'\e[34m'; C_RESET=$'\e[0m'
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_RESET=""
fi

log()  { echo "${C_BLUE}[setup-demo-services]${C_RESET} $*"; }
ok()   { echo "${C_GREEN}[setup-demo-services]${C_RESET} $*"; }
warn() { echo "${C_YELLOW}[setup-demo-services]${C_RESET} $*" >&2; }
err()  { echo "${C_RED}[setup-demo-services]${C_RESET} $*" >&2; }

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

require_built_orchestrator() {
  if [ ! -f "$PRODUCT_DIR/orchestrator/dist/index.js" ]; then
    err "orchestrator/dist/index.js not found. Build first:"
    err "    npm run build -w @swoop/orchestrator"
    exit 1
  fi
}

require_built_ui() {
  if [ ! -f "$PRODUCT_DIR/ui/dist/index.html" ]; then
    err "ui/dist/index.html not found. Build first:"
    err "    npm run build -w @swoop/ui"
    err "  or run: bash scripts/setup-demo-services.sh install (builds automatically)"
    exit 1
  fi
}

resolve_node_path() {
  command -v node 2>/dev/null || { err "node not found on PATH"; exit 1; }
}

write_plist() {
  local label="$1"
  local template="$PLIST_TEMPLATES_DIR/${label}.plist"
  local dest="$LAUNCH_AGENTS_DIR/${label}.plist"

  if [ ! -f "$template" ]; then
    err "Template not found: $template"; exit 1
  fi

  local node_path
  node_path="$(resolve_node_path)"

  mkdir -p "$LAUNCH_AGENTS_DIR"
  mkdir -p "$LOGS_DIR"

  # Substitute placeholders and write resolved plist. The generic
  # PRODUCT_DIR_PLACEHOLDER substitution also covers the vite.js path in the
  # ui plist (PRODUCT_DIR_PLACEHOLDER/node_modules/vite/bin/vite.js). Plists
  # invoke node directly (no npm wrapper — see the SIGTERM note in each plist).
  /usr/bin/sed \
    -e "s|PRODUCT_DIR_PLACEHOLDER|${PRODUCT_DIR}|g" \
    -e "s|LOGS_DIR_PLACEHOLDER|${LOGS_DIR}|g" \
    -e "s|/usr/local/bin/node|${node_path}|g" \
    "$template" > "$dest"

  ok "Wrote $dest"
}

load_service() {
  local label="$1"
  local plist="$LAUNCH_AGENTS_DIR/${label}.plist"
  if launchctl list "$label" &>/dev/null; then
    log "$label already loaded — reloading…"
    launchctl unload "$plist" 2>/dev/null || true
  fi
  launchctl load "$plist"
  ok "Loaded $label"
}

unload_service() {
  local label="$1"
  local plist="$LAUNCH_AGENTS_DIR/${label}.plist"
  if launchctl list "$label" &>/dev/null; then
    launchctl unload "$plist" 2>/dev/null && ok "Unloaded $label" || warn "Could not unload $label"
  else
    log "$label not loaded — skipping unload"
  fi
  if [ -f "$plist" ]; then
    rm "$plist" && ok "Removed $plist"
  fi
}

# ----------------------------------------------------------------------------
# Commands
# ----------------------------------------------------------------------------

cmd_install() {
  log "Installing Puma demo services…"
  log "Product dir: ${C_BOLD}$PRODUCT_DIR${C_RESET}"
  log "Logs dir:    ${C_BOLD}$LOGS_DIR${C_RESET}"
  echo

  require_built_orchestrator

  # Build UI if not already built (idempotent).
  if [ ! -f "$PRODUCT_DIR/ui/dist/index.html" ]; then
    log "UI dist not found — building…"
    (cd "$PRODUCT_DIR" && npm run build -w @swoop/ui)
  fi

  # Write all plists.
  for label in "${LABELS[@]}"; do
    write_plist "$label"
  done

  echo
  # Load in dependency order: connector first, then orchestrator (needs connector
  # to be accepting connections), then UI (proxies to orchestrator).
  log "Loading services in dependency order…"
  load_service "uk.co.swoop.puma.connector"
  sleep 3
  load_service "uk.co.swoop.puma.orchestrator"
  sleep 2
  load_service "uk.co.swoop.puma.ui"

  echo
  ok "All services installed and loaded."
  echo "${C_DIM}  Logs: tail -f ${LOGS_DIR}/*.log${C_RESET}"
  echo "${C_DIM}  Status: bash scripts/setup-demo-services.sh status${C_RESET}"
  echo "${C_DIM}  Start Funnel: npm run funnel:up${C_RESET}"
}

cmd_uninstall() {
  log "Uninstalling Puma demo services…"
  # Unload in reverse order.
  for label in "${LABELS[@]}"; do
    unload_service "$label"
  done
  ok "All services uninstalled."
}

cmd_status() {
  echo "${C_BOLD}Puma demo service status:${C_RESET}"
  echo
  for label in "${LABELS[@]}"; do
    local short_name="${label##*.}"
    printf "  %-16s " "$short_name"
    if launchctl list "$label" &>/dev/null; then
      local pid
      pid="$(launchctl list "$label" 2>/dev/null | awk 'NR==1{print $1}')" || pid="?"
      if [ "$pid" = "-" ] || [ "$pid" = "0" ]; then
        echo "${C_YELLOW}loaded (not running)${C_RESET}"
      else
        echo "${C_GREEN}running (PID $pid)${C_RESET}"
      fi
    else
      echo "${C_RED}not loaded${C_RESET}"
    fi
  done
  echo
  echo "${C_DIM}Logs: ${LOGS_DIR}/${C_RESET}"

  # Health checks if services appear to be up.
  echo
  echo "${C_BOLD}Health endpoints:${C_RESET}"
  for endpoint in "http://localhost:8080/healthz" "http://localhost:8080/readyz"; do
    printf "  %-42s " "$endpoint"
    if curl -sf --max-time 2 "$endpoint" >/dev/null 2>&1; then
      echo "${C_GREEN}OK${C_RESET}"
    else
      echo "${C_RED}unreachable${C_RESET}"
    fi
  done
  printf "  %-42s " "http://localhost:5173/ (UI)"
  if curl -sf --max-time 2 "http://localhost:5173/" >/dev/null 2>&1; then
    echo "${C_GREEN}OK${C_RESET}"
  else
    echo "${C_RED}unreachable${C_RESET}"
  fi
}

cmd_restart() {
  log "Restarting all Puma demo services…"
  for label in "${LABELS[@]}"; do
    local plist="$LAUNCH_AGENTS_DIR/${label}.plist"
    if [ -f "$plist" ]; then
      launchctl unload "$plist" 2>/dev/null || true
    fi
  done
  sleep 1
  load_service "uk.co.swoop.puma.connector"
  sleep 3
  load_service "uk.co.swoop.puma.orchestrator"
  sleep 2
  load_service "uk.co.swoop.puma.ui"
  ok "All services restarted."
}

cmd_restart_ui() {
  log "Rebuilding UI + restarting ui service…"
  (cd "$PRODUCT_DIR" && npm run build -w @swoop/ui)
  local plist="$LAUNCH_AGENTS_DIR/uk.co.swoop.puma.ui.plist"
  if [ -f "$plist" ]; then
    launchctl unload "$plist" 2>/dev/null || true
    sleep 1
    launchctl load "$plist"
    ok "ui service restarted with fresh build."
  else
    err "uk.co.swoop.puma.ui.plist not found — run install first."
    exit 1
  fi
}

cmd_logs() {
  local svc="${1:-all}"
  case "$svc" in
    connector|orchestrator|ui)
      tail -f "$LOGS_DIR/${svc}.log" "$LOGS_DIR/${svc}.err.log"
      ;;
    all|"")
      tail -f "$LOGS_DIR"/*.log "$LOGS_DIR"/*.err.log
      ;;
    *)
      err "Unknown service: $svc (choose: connector orchestrator ui all)"
      exit 2
      ;;
  esac
}

# ----------------------------------------------------------------------------
# Dispatch
# ----------------------------------------------------------------------------

usage() {
  cat <<EOF
${C_BOLD}setup-demo-services.sh${C_RESET} — launchd management for Puma demo services.

Usage:
  bash scripts/setup-demo-services.sh install        Write plists + load all services
  bash scripts/setup-demo-services.sh uninstall      Unload all + remove plists
  bash scripts/setup-demo-services.sh status         Show status + health checks
  bash scripts/setup-demo-services.sh restart        Unload + reload all services
  bash scripts/setup-demo-services.sh restart-ui     Rebuild UI + restart ui only
  bash scripts/setup-demo-services.sh logs [svc]     Tail logs (connector/orchestrator/ui/all)
EOF
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    install)     cmd_install ;;
    uninstall)   cmd_uninstall ;;
    status)      cmd_status ;;
    restart)     cmd_restart ;;
    restart-ui)  cmd_restart_ui ;;
    logs)        cmd_logs "${1:-all}" ;;
    -h|--help|help|"") usage ;;
    *)
      err "Unknown command: $cmd"
      echo >&2
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
