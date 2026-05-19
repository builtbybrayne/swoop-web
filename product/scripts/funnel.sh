#!/usr/bin/env bash
# product/scripts/funnel.sh
#
# Expose the local UI dev server (port 5173) to the public internet via
# Tailscale Funnel so a client can hit it from outside the tailnet.
#
# Architecture (see vite.config.ts):
#   browser ──► https://<host>.<tailnet>.ts.net  (Funnel, port 443)
#               │
#               ▼
#               127.0.0.1:5173  (Vite dev server)
#               │
#               ├── /            → React SPA
#               └── /api/*       → proxied to 127.0.0.1:8080 (orchestrator)
#
# Connector (:3002) stays private — the orchestrator calls it server-side.
#
# Usage:
#   bash scripts/funnel.sh up       # start Funnel on :5173 in background
#   bash scripts/funnel.sh down     # tear it all down
#   bash scripts/funnel.sh status   # show current Funnel state + URL
#
# Prerequisites (one-time, Tailscale admin console):
#   1. DNS → HTTPS Certificates: enabled
#   2. Access Controls (ACL): your user/tag has `funnel` in `nodeAttrs`,
#      e.g.
#        "nodeAttrs": [
#          { "target": ["autogroup:member"], "attr": ["funnel"] }
#        ]
#   3. Magic DNS: enabled (default on most tailnets)
#
# This script's checks will fail loudly if any prereq is missing.

set -euo pipefail

# ----------------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------------

readonly UI_PORT=5173
readonly UI_ENV_FILE="ui/.env.local"
readonly UI_ENV_EXAMPLE="ui/.env.example"
readonly REQUIRED_ENV_LINE="VITE_ORCHESTRATOR_URL=/api"

# Colour helpers (no-op if stdout isn't a TTY).
if [ -t 1 ]; then
  readonly C_BOLD=$'\e[1m'
  readonly C_DIM=$'\e[2m'
  readonly C_RED=$'\e[31m'
  readonly C_GREEN=$'\e[32m'
  readonly C_YELLOW=$'\e[33m'
  readonly C_BLUE=$'\e[34m'
  readonly C_RESET=$'\e[0m'
else
  readonly C_BOLD=""
  readonly C_DIM=""
  readonly C_RED=""
  readonly C_GREEN=""
  readonly C_YELLOW=""
  readonly C_BLUE=""
  readonly C_RESET=""
fi

log()   { echo "${C_BLUE}[funnel]${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}[funnel]${C_RESET} $*" >&2; }
err()   { echo "${C_RED}[funnel]${C_RESET} $*" >&2; }
ok()    { echo "${C_GREEN}[funnel]${C_RESET} $*"; }

# ----------------------------------------------------------------------------
# Working directory: always run from product/ (script lives in product/scripts/)
# ----------------------------------------------------------------------------

cd "$(dirname "$0")/.."

# ----------------------------------------------------------------------------
# Pre-flight checks
# ----------------------------------------------------------------------------

require_tailscale_cli() {
  if ! command -v tailscale >/dev/null 2>&1; then
    err "tailscale CLI not found on PATH."
    err "  Install: https://tailscale.com/download"
    exit 1
  fi
}

require_tailscale_logged_in() {
  # `tailscale status` exits non-zero when logged out.
  if ! tailscale status >/dev/null 2>&1; then
    err "Tailscale is not running or not logged in."
    err "  Run: tailscale up"
    exit 1
  fi
}

# Pull this machine's MagicDNS name (e.g. alastairs-macbook-pro.tail6f2eea.ts.net)
# from `tailscale status --json`. Strips the trailing dot.
get_dns_name() {
  tailscale status --json 2>/dev/null \
    | /usr/bin/python3 -c '
import json, sys
data = json.load(sys.stdin)
name = (data.get("Self") or {}).get("DNSName") or ""
print(name.rstrip("."))
'
}

require_funnel_capable() {
  # `tailscale funnel status` works whether or not a funnel is active. It
  # fails when funnel isn't enabled in ACLs / HTTPS isn't on. Use that as
  # the smoke test.
  if ! tailscale funnel status >/dev/null 2>&1; then
    err "Tailscale Funnel doesn't appear to be enabled on this tailnet."
    err "  Admin console checklist:"
    err "    1. DNS → HTTPS Certificates → Enable"
    err "    2. Access Controls (ACL) → grant 'funnel' nodeAttr to your user/tag"
    err "    3. Magic DNS → Enabled"
    err "  Then re-run: $0 up"
    exit 1
  fi
}

# Ensure ui/.env.local has VITE_ORCHESTRATOR_URL=/api. If the file doesn't
# exist we seed it from .env.example and flip the comment. If the file
# exists but is set to a localhost URL we warn the user — overwriting an
# existing edited env file would be rude.
ensure_ui_env() {
  if [ ! -f "$UI_ENV_FILE" ]; then
    if [ -f "$UI_ENV_EXAMPLE" ]; then
      log "Creating $UI_ENV_FILE from $UI_ENV_EXAMPLE (funnel mode)…"
      # Copy, then enable the /api line and comment out the localhost line.
      /usr/bin/sed \
        -e 's|^VITE_ORCHESTRATOR_URL=http://localhost:8080|# VITE_ORCHESTRATOR_URL=http://localhost:8080|' \
        -e 's|^# VITE_ORCHESTRATOR_URL=/api.*$|VITE_ORCHESTRATOR_URL=/api|' \
        "$UI_ENV_EXAMPLE" > "$UI_ENV_FILE"
    else
      log "Writing minimal $UI_ENV_FILE for funnel mode…"
      printf '%s\n' "$REQUIRED_ENV_LINE" > "$UI_ENV_FILE"
    fi
    ok "Wrote $UI_ENV_FILE with $REQUIRED_ENV_LINE"
    return
  fi

  if /usr/bin/grep -qE '^[[:space:]]*VITE_ORCHESTRATOR_URL=/api[[:space:]]*$' "$UI_ENV_FILE"; then
    log "$UI_ENV_FILE already has $REQUIRED_ENV_LINE — leaving it alone."
    return
  fi

  warn "$UI_ENV_FILE exists but $REQUIRED_ENV_LINE is not the active setting."
  warn "  For funnel demos the UI must fetch via /api (Vite proxy) so the"
  warn "  client browser and orchestrator share a single public origin."
  warn "  Edit $UI_ENV_FILE: comment out any other VITE_ORCHESTRATOR_URL"
  warn "  line and add: $REQUIRED_ENV_LINE"
  warn "  Continuing anyway — but the UI will fail to reach the API until fixed."
}

# ----------------------------------------------------------------------------
# Commands
# ----------------------------------------------------------------------------

cmd_up() {
  require_tailscale_cli
  require_tailscale_logged_in
  require_funnel_capable

  local dns_name
  dns_name="$(get_dns_name)"
  if [ -z "$dns_name" ]; then
    err "Could not resolve this machine's Tailscale DNS name."
    err "  Output of: tailscale status --json"
    tailscale status --json | head -20 >&2
    exit 1
  fi

  ensure_ui_env

  log "Starting Funnel: 0.0.0.0:443 → 127.0.0.1:${UI_PORT}"
  # --bg runs in background and persists across shell sessions; `tailscale
  # funnel reset` or `cmd_down` clears it. Older clients without --bg fall
  # back to foreground, in which case we'd block here — we explicitly need
  # --bg for the npm script ergonomics.
  if ! tailscale funnel --bg "$UI_PORT"; then
    err "tailscale funnel --bg ${UI_PORT} failed. See message above."
    err "  Common cause: 'funnel' nodeAttr missing in ACL — see admin console."
    exit 1
  fi

  echo
  ok  "Public URL:  ${C_BOLD}https://${dns_name}${C_RESET}"
  echo "${C_DIM}  Share this with the client. Funnel persists until you run:"
  echo "    npm run funnel:down  (or)  bash scripts/funnel.sh down${C_RESET}"
  echo
  log "Next steps in this terminal (or another):"
  echo "    npm run dev          # starts orchestrator + UI on :8080 and :${UI_PORT}"
  echo
  log "Things to know:"
  echo "  • Your laptop must stay awake & online — Funnel is just a tunnel."
  echo "  • Connector (:3002) stays private. Orchestrator calls it locally."
  echo "  • Vite proxies /api/* → http://localhost:8080 (orchestrator)."
}

cmd_down() {
  require_tailscale_cli
  require_tailscale_logged_in

  log "Resetting all Funnel configuration on this device…"
  if tailscale funnel reset; then
    ok "Funnel disabled."
  else
    err "tailscale funnel reset returned an error (above)."
    exit 1
  fi
}

cmd_status() {
  require_tailscale_cli
  require_tailscale_logged_in

  local dns_name
  dns_name="$(get_dns_name)"

  echo "${C_BOLD}Funnel config:${C_RESET}"
  tailscale funnel status || true
  echo

  if [ -n "$dns_name" ]; then
    echo "${C_BOLD}Device hostname:${C_RESET} ${dns_name}"
    echo "${C_BOLD}Expected URL:${C_RESET}    https://${dns_name}"
  fi
}

# ----------------------------------------------------------------------------
# Dispatch
# ----------------------------------------------------------------------------

usage() {
  cat <<EOF
${C_BOLD}funnel.sh${C_RESET} — expose the UI over Tailscale Funnel for client demos.

Usage:
  bash scripts/funnel.sh up        Start Funnel on port ${UI_PORT}
  bash scripts/funnel.sh down      Tear down all Funnel config on this device
  bash scripts/funnel.sh status    Show current Funnel state + public URL

After 'up', run 'npm run dev' in another terminal to start orchestrator + UI.
EOF
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    up)      cmd_up ;;
    down)    cmd_down ;;
    status)  cmd_status ;;
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
