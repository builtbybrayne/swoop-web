#!/usr/bin/env bash
# product/scripts/dev.sh
#
# Orchestrates the local dev loop across workspace packages.
# Initially the workspace is empty — this script exits cleanly with a
# friendly message until packages land (A.t2 onwards).
#
# When packages gain a `dev` script, prefer wiring them in here via
# `concurrently` so `npm run dev` stays the single entry point.

set -euo pipefail

cd "$(dirname "$0")/.."

# Discover workspace packages (directories listed in package.json `workspaces`).
# Kept intentionally simple: if a package has a `dev` script, we run it; else skip.
PACKAGES=(ts-common orchestrator connector ui cms ingestion)

runnable=()
for pkg in "${PACKAGES[@]}"; do
  if [ -f "$pkg/package.json" ] && node -e "process.exit(require('./$pkg/package.json').scripts?.dev ? 0 : 1)" 2>/dev/null; then
    runnable+=("$pkg")
  fi
done

if [ ${#runnable[@]} -eq 0 ]; then
  echo "[dev] No workspace packages with a 'dev' script yet. Nothing to watch."
  echo "[dev] Scaffold packages (A.t2 / A.t4) and add dev scripts, then re-run."
  exit 0
fi

# Build concurrently args: one "npm run dev -w <pkg>" per runnable package.
cmds=()
names=()
for pkg in "${runnable[@]}"; do
  cmds+=("npm run dev -w $pkg")
  names+=("$pkg")
done

# Join names with commas for concurrently's -n flag.
IFS=, name_arg="${names[*]}"

echo "[dev] Watching: ${name_arg}"
exec npx --no-install concurrently -n "$name_arg" -c auto --kill-others-on-fail "${cmds[@]}"
