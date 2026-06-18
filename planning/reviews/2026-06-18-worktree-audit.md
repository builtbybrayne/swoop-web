# 2026-06-18 — Worktree Estate Audit

**Author**: Alastair-led HITL session (worktree-hygiene audit).
**Type**: Git-hygiene / unmerged-material audit — *not* a code review or council-of-experts review. It answers one question: **does the worktree estate hold any work that is not already in `main`?**
**Scope**: All 98 git worktrees (excluding the main checkout) + all ~95 named branches, as of 2026-06-18, `main` at `1f77bed` (*fix(connector): cryptographically verify the staff JWT at the memory backstop*).
**Method**: per-worktree `git rev-list --count main..HEAD` for DAG-ahead, `git cherry` / `git rev-list --cherry-pick --right-only` for **patch-id-aware** novelty (so rebase/cherry-pick twins do *not* read as unmerged), `git status --porcelain` for working-tree state. Deep-dives confirmed verdicts with patch-id twin-matching + code/grep against `main` and (for the planning docs) six parallel read-only research agents.
**Tooling gotcha surfaced**: the zsh shell-snapshot makes piped coreutils (`awk`/`grep`/`wc`) intermittently `command not found` *inside* `$(...)` command substitution; this analysis was run under `/bin/bash` with an explicit `PATH`. Logged to [gotchas.md](../../gotchas.md).

---

## ★ Read this first

**The worktree estate holds no unmerged material that we want. Everything we want in `main` is in `main`.** Nothing needs rescuing; no build or planning follow-up falls out of this audit. The estate (98 worktrees, ~95 branches) is safe to prune whenever convenient.

> **Do not read effort/cost into the counts below.** Worktree counts, commit counts and branch counts say nothing about invoiced days — see root [CLAUDE.md → "Project time & cost"](../../CLAUDE.md). This audit is purely about *where content lives*, not how much was spent producing it.

---

## Section 1 — Census

| Bucket | Count | Meaning |
|---|---|---|
| Clean & fully merged | 57 | HEAD is an ancestor of `main`, clean tree — nothing to do |
| Dirty with only `graphify-out/` | ~27 | Generated `understand-anything` graph output; pure noise |
| Novel committed commits | 7 worktrees | Commits with no patch-twin in `main` — assessed in §2/§3, all accounted for |
| Ahead-but-patch-equivalent | 1 (`luke-questioning-tone`) | 4 commits already in `main` via rebase-replay (§3) |
| Uncommitted tracked-file edits | 5 worktrees | Working-tree scratch — **judged aborted, see §4** |

(Buckets overlap — e.g. one novel-commit worktree is also dirty — and the remainder is untracked-only noise, so the column does not sum to 98.)

---

## Section 2 — Uncommitted planning docs (the deep-dive)

Seven untracked docs sat in stale worktrees, committed to no branch. Each was assessed against `main`; **every one is already accounted for**:

| Doc (worktree) | Verdict | Where it lives in `main` now |
|---|---|---|
| `03-exec-agent-runtime-t11.md` (`agent-a97e4397…`) | **Implemented as-spec** | This is **B.t11** — the `GET /session/:id/history` replay endpoint. Plan committed `834d259`, code `5d39bfc`, merged `c18bd03`. Worktree file is a stale duplicate of an already-committed doc. |
| `03-exec-chat-surface-t9-mount-rehydrate.md` (`agent-a97e4397…`) | **Implemented as-spec** | **D.t9** UI-side mount rehydrate. Implemented `d4a59f7` + fix `34af1de`; plan committed `06148db`, HITL-ratified `aad3f2b`. See [03-exec-chat-surface-t9-mount-rehydrate.md](../03-exec-chat-surface-t9-mount-rehydrate.md). |
| `reasoning-leak-handoff.md` (`luke-questioning-tone`) | **Implemented as-spec** | Agent reasoning/tool-narration leak fixed via native Anthropic thinking (on by default) + Sonnet-4.6 default + silent-working prompt belt + UI separator fix (RL.1–8). Branch `claude/reasoning-leak` fully merged. Plan: [03-exec-crosscut-reasoning-leak-native-thinking.md](../03-exec-crosscut-reasoning-leak-native-thinking.md). |
| `03-exec-crosscut-find-options-soft-filter.md` (`elastic-ishizaka…`) | **Superseded** | The goofy-goldstine find/show reshape solved the empty-result root problem differently (agent-private browse + hybrid embedding ranking). [03-exec-crosscut-goofy-goldstine-find-options-reshape.md](../03-exec-crosscut-goofy-goldstine-find-options-reshape.md). Confirms the "let the agent reason over surfaced data, don't pre-filter programmatically" direction. |
| `customer-story-ingest-recipe.md` (`elastic-ishizaka…`) | **Implemented differently** | `customertip` ingest shipped as a standalone `customer_tip` table + new 9th tool **`find_tips`** (migration `013`), not the recipe's fold-into-`customer_story`-via-`find_someone_who`. [03-exec-customer-tips-tool.md](../03-exec-customer-tips-tool.md). No successor runbook was written in `product/docs/`. |
| `audit-2026-05-22-punchlist.md` (`elastic-ishizaka…`) | **Superseded** | An ephemeral one-day audit doc; replaced as canonical ledger by [2026-05-27-ingest-and-state-of-play.md](2026-05-27-ingest-and-state-of-play.md). Genuine stragglers tracked in their home files. |
| `dev-process-graph.html` (`elastic-ishizaka…`) | **Generated noise** | A rendered "Swoop Puma — Development Process Graph" visualization, not source. |

---

## Section 3 — Branch & commit forensics

- **`luke-questioning-tone`** — *not* an ancestor of `main` (floating ref), but all 4 commits (the **M-PICK** test-mode model picker — server `e29fda2` + UI `308d557` + T3 plan `32fd433` — and the warm closing-question prompt tweak `81d8ec4`) were **rebase-replayed** into `main` as the contiguous chain `66f63a1 → 7b5b902 → 36eefcf → 323999d` (all committed 2026-06-17 16:19:01, original author-dates preserved, no `(cherry picked from …)` trailer = rebase signature, not literal `git cherry-pick`, not a merge). The branch is a **stale pre-rebase twin**; discarding it loses nothing.
- **Perf-1 prompt caching** (`agent-a0a1cedf…`, commit `97e62ad`) — **live in `main`**: `cache_control: { type: 'ephemeral' }` on the system block and last `tools` entry at [claude-llm.ts:235-248](../../product/orchestrator/src/agent/claude-llm.ts:235), with the `Perf-1: prompt caching` test block at [claude-llm.test.ts:309-376](../../product/orchestrator/src/agent/__tests__/claude-llm.test.ts:309); landed via `a9884bd`. It is **load-bearing** — the sales-memory loader, consent-triggered greeting pre-warm, and `chat.ts` all coordinate with the cached prefix. The worktree commit is a redundant earlier copy (re-applied during later reworks, hence no exact patch-twin).
- **D.t9 rehydration WIP** (`agent-aca0f1cf…`, commit `4e59f2c`) — superseded by the merged `d4a59f7` (D.t9 mount-rehydrate).
- **Other novel-commit worktrees** — C.t1 connector skeleton (`agent-ab15fbf1…`), E.t6 handoff retention sweeper (`agent-a67216b6…`), C.t5 Tier-3 plan DRAFT (`agent-ae4962ee…`), and two orientation-doc commits (`blissful-chaum…`, `agent-aa15c927…`): late-Apr / mid-May WIP overtaken by `main`'s mature versions. Characterised as stale; nothing unique identified, not individually rescued.

---

## Section 4 — Decision: loose uncommitted edits = aborted work

Five worktrees carry uncommitted edits to *tracked* files:

| Worktree | Uncommitted tracked edits |
|---|---|
| `agent-a370449d…` | `harness/orchestrator-client.ts`, `ts-common/streaming.ts`, `ui/orchestrator-adapter.ts` (+ untracked `sse-parser.test.ts`) — a streaming/SSE change across three workspaces |
| `agent-a4a14a73…` | `ts-common/session.ts`, `__tests__/fixtures.test.ts` |
| `agent-a83ba1fb…` | `ingestion/src/enrich/chunk.ts` |
| `determined-napier…` | `CLAUDE.md` |
| `strange-satoshi…` | `connector/.../embed-query.test.ts` |

**Decision (Alastair, 2026-06-18): these are aborted work — ignore.** Not diffed against `main`, not to be rescued.

---

## Section 5 — Recommended next moves

- **Nothing to rescue.** No build or planning follow-up falls out of this audit.
- The worktree estate (98 trees, ~95 branches) is **safe to prune** whenever convenient (`git worktree remove` / `git branch -D`) — deferred as a separate housekeeping op, not required by anything in flight.
- Only unique-but-intentionally-discarded artifacts: the §4 loose edits (aborted) and the untracked `reasoning-leak-handoff.md` (superseded — leak fixed via native thinking, RL.1–8).

---

*Complements [2026-05-27-ingest-and-state-of-play.md](2026-05-27-ingest-and-state-of-play.md) (build-side state snapshot). Supersedes nothing.*
