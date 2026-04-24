#!/usr/bin/env bash
# product/scripts/run-workspaces.sh
#
# Runs `npm run <script> --workspaces --if-present` but exits 0 cleanly when
# the workspace is empty (no packages have a package.json yet).
#
# Usage: bash scripts/run-workspaces.sh <script-name>
#
# Rationale: `npm run <x> -ws --if-present` errors ("No workspaces found!")
# when zero workspace packages exist. The `--if-present` flag only suppresses
# per-package misses; it doesn't help when the whole workspace is empty.
# During the A.t1 → A.t4 window that's exactly our situation, so we wrap it.

set -euo pipefail

cd "$(dirname "$0")/.."

script="${1:?usage: run-workspaces.sh <script-name>}"

# Count packages that actually have a package.json.
pkg_count=0
for d in ts-common orchestrator connector ui ingestion harness; do
  [ -f "$d/package.json" ] && pkg_count=$((pkg_count + 1))
done

if [ "$pkg_count" -eq 0 ]; then
  echo "[$script] no workspace packages present yet — nothing to run"
  exit 0
fi

exec npm run "$script" --workspaces --if-present
