#!/usr/bin/env bash
# product/scripts/graphify.sh
#
# Wrapper for the safishamsi/graphify CLI. Handles env loading (ANTHROPIC_API_KEY
# pulled narrowly from connector/.env) and gates the paid `rebuild` path behind a
# confirmation prompt.
#
# Subcommands:
#   check     graphify check-update .             (free; reports staleness flag)
#   update    graphify update .                   (free; AST-only refresh)
#   rebuild   graphify extract + cluster-only + tree
#                                                  (~$1; LLM pass on docs)
#   query Q   graphify query "Q"                  (free; subgraph traversal)
#
# The graph itself lives in product/graphify-out/ (gitignored). The integration
# with Claude Code (PreToolUse hook + CLAUDE.md awareness) is set up by
# `graphify claude install` and lives in product/.claude/settings.json.

set -euo pipefail

cd "$(dirname "$0")/.."

load_anthropic_key() {
  local env_file="connector/.env"
  if [ ! -f "$env_file" ]; then
    echo "[graphify] missing $PWD/$env_file — symlink it from main if working in a worktree" >&2
    exit 1
  fi
  local key
  key=$(grep '^ANTHROPIC_API_KEY=' "$env_file" | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -z "$key" ]; then
    echo "[graphify] ANTHROPIC_API_KEY missing or empty in $env_file" >&2
    exit 1
  fi
  export ANTHROPIC_API_KEY="$key"
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  check)
    exec graphify check-update .
    ;;

  update)
    exec graphify update .
    ;;

  rebuild)
    if [ "${GRAPHIFY_SKIP_CONFIRM:-0}" != "1" ]; then
      echo "[graphify] Full rebuild runs the semantic LLM pass over docs (~\$1 at current scale)."
      echo "[graphify] For code-only refresh use:  npm run graph:update"
      printf "[graphify] Continue with rebuild? [y/N] "
      read -r ans
      case "$ans" in
        y|Y|yes|YES) ;;
        *) echo "[graphify] aborted"; exit 1 ;;
      esac
    fi
    load_anthropic_key
    graphify extract . --backend claude
    graphify cluster-only .
    graphify tree --graph graphify-out/graph.json --output graphify-out/GRAPH_TREE.html
    echo "[graphify] rebuild complete. inspect: open graphify-out/graph.html"
    ;;

  query)
    if [ $# -eq 0 ]; then
      echo "[graphify] usage: npm run graph:query -- \"your question\"" >&2
      exit 1
    fi
    exec graphify query "$@"
    ;;

  help|--help|-h|"")
    sed -n '2,18p' "$0"
    exit 0
    ;;

  *)
    echo "[graphify] unknown subcommand: $cmd" >&2
    echo "[graphify] run: $0 help" >&2
    exit 1
    ;;
esac
