# 03-exec-crosscut — Prompt overrides setup (`agent_prompts` repo)

> **DEPRECATED 2026-05-27**. This workstream is replaced by the docs at
> [docs/sales-team-prompt-workflow-sales.md](../docs/sales-team-prompt-workflow-sales.md) and
> [docs/sales-team-prompt-workflow-devs.md](../docs/sales-team-prompt-workflow-devs.md), plus a
> future Claude skill for sales teams to refine feedback before submission. This plan was
> the upstream dependency of the sales-team curation workstream (also deprecated); both
> were displaced together when the git PR approach was judged unlikely to fit
> non-technical contributors' workflow. The override-repo + bootstrap-clone design stays
> on the shelf in case sales-team write access becomes a real need later. Body preserved
> as path-not-taken design thinking.

**Status**: Draft. Awaiting ratification.
**Authored**: 2026-05-21
**Position**: Inside M5, sequenced **before** [03-exec-crosscut-sales-team-prompt-curation.md — Sales-team prompt curation](03-exec-crosscut-sales-team-prompt-curation.md) — the Curator's PAT scopes, GitHub Action location, repo URLs, and edit semantics all depend on this landing first.

**Filename note**: the title says "split" but this work doesn't actually migrate files out of swoop_web. It renames the canonical content in place (`prompts/` → `prompt-defaults/`, `templates/` → `template-defaults/`) and introduces a separate override repo. The original content stays as a safe fallback in main repo; the override repo holds the additions and replacements. Filename preserved for backlink stability.

**Relates to:**
- [01-top-level.md §3 theme 2 — Content-as-data](01-top-level.md) — substrate this enforces a write-permissions separation on
- [03-exec-crosscut-sales-team-prompt-curation.md — Sales-team prompt curation](03-exec-crosscut-sales-team-prompt-curation.md) — the downstream consumer
- [03-exec-agent-runtime-t1a.md — multi-file system-prompt loader](03-exec-agent-runtime-t1a.md) — the loader that needs to merge two trees after this lands
- [gotchas.md — `product/cms/` is NOT a workspace package](../gotchas.md) — closes-historical after this lands (the workspace question becomes moot)

---

## 1. Outcome

After this lands, the swoop_web codebase holds **canonical default content** in `product/cms/prompt-defaults/` and `product/cms/template-defaults/`. These directories carry everything the agent reads today — system prompts, the 14 adk skills, tool descriptions, ETL prompts, handoff templates. They are the safe fallback: if the override mechanism breaks, blow it away and the agent reads what's in main repo.

A new repository, **`agent_prompts`**, holds **overrides and augmentations**. It is structured as a multi-project asset — `projects/<project>/agents/<agent>/<override-tree>` — so future agents (other Swoop products, other clients) can land in the same repo without needing new infrastructure.

At deploy and dev-bootstrap time, the relevant agent's slice from `agent_prompts` clones into swoop_web's worktree alongside the defaults. The runtime loader merges the two trees according to per-folder rules (override, new, or augment) and the agent reads the merged result.

Sales-team Claude has read-only access to swoop_web (for grounding conversations in code context) and read+write access to `agent_prompts` (scoped to its agent slug via the Curator skill's config). Every PR is human-reviewed. No CODEOWNERS automation — the reviewer's eye is the gate.

---

## 2. Architecture

### 2.1 The override pattern

Two-tree composition:

- **Defaults tree** — `product/cms/prompt-defaults/` and `product/cms/template-defaults/` in swoop_web. Canonical, dev-team-owned.
- **Overrides tree** — `product/cms/prompt-overrides/` and `product/cms/template-overrides/`, populated at bootstrap from `agent_prompts`. Sales-team-writable via the Curator.

When the runtime loader assembles content, it walks both trees according to per-folder rules:

- For some folder types, the overrides tree *adds* files alongside the defaults (e.g. new system fragments).
- For others, the overrides tree *replaces* same-named files (e.g. overriding an adk skill).
- For others, the overrides tree carries small augmentation files that get *concatenated* with their defaults counterparts (e.g. tool description addenda).

The defaults tree is never modified at deploy time. If the override mechanism fails (cloned repo missing, malformed content, etc.), the runtime falls back to defaults-only behaviour — the agent is degraded but functional.

### 2.2 `agent_prompts` as a multi-project asset

The override repo is named `agent_prompts` (not `swoop_web_overrides` or similar) and structured to host multiple projects and multiple agents within projects:

```
agent_prompts/
  README.md
  .github/workflows/
    notify-reviewer-on-pr.yml
    trigger-deploy.yml
  projects/
    swoop_web/
      agents/
        web_discovery/
          prompt-overrides/
            system/          # additions only (new files)
            skills/          # override or new
            tools/           # augmentation only (description.augment.md per tool)
          template-overrides/
            handoff/         # override only
```

For M5, only the `swoop_web/web_discovery` slot exists. The structure anticipates future agents (Antarctica discovery, other Swoop products) and future clients without requiring new repos. Each project/agent gets its own folder tree; the Curator skill's per-project config keeps sales-team Claude scoped to their relevant slot.

**Hosting location for the repo is a decision still owed** — see §14.

### 2.3 Main repo rename

The existing `product/cms/prompts/` → `product/cms/prompt-defaults/`. The existing `product/cms/templates/` → `product/cms/template-defaults/`. Path constants in the runtime loader and any code that references these paths gets updated in the same commit.

The renames signal the new semantics structurally: anyone walking the tree sees `prompt-defaults/` and `prompt-overrides/` as siblings (after bootstrap) and infers the relationship from the names alone. No banners, no implicit override behaviour.

### 2.4 Other cms folder relocations folded into this work

Two folders are misplaced under `product/cms/` today and should move during the rename PR:

- `product/cms/legal/compliance-bundle/` → `planning/legal/compliance-bundle/`. This is documentation for counsel review, not runtime agent content. Belongs in `planning/`.
- `product/cms/handover/` (planned, not yet authored under the Curator plan) → `planning/handover/`. Same logic — handover documentation belongs alongside other handover-facing material, not in the runtime content area.

After both relocations, `product/cms/` holds only runtime-agent-readable content (`prompt-defaults/`, `template-defaults/`) plus `ops/` (operator runbooks, which stay as dev-only).

### 2.5 Folder layout after the refactor

**Main repo (`swoop_web`):**

```
product/cms/
  prompt-defaults/                    # renamed from prompts/
    system/
      00_why.md
      10_style-avoid.md
    skills/                           # the 14 existing adk skills
    tools/
      [tool description folders]
    etl/
      [classifier prompt folders]
  template-defaults/                  # renamed from templates/
    handoff/
      qualified.md
      referred-out.md
  ops/                                # operator runbooks (unchanged)
  prompt-overrides/                   # bootstrapped from agent_prompts (gitignored)
  template-overrides/                 # bootstrapped from agent_prompts (gitignored)
  README.md                           # explains the defaults/overrides pattern
```

**Override repo (`agent_prompts`):**

See §2.2.

**Other moves:**
- `planning/legal/compliance-bundle/` ← moved from `product/cms/legal/compliance-bundle/`
- `planning/handover/` ← will host handover docs (not authored yet; the Curator plan's handover doc lands here directly)

### 2.6 Per-folder override semantics (v1)

| Folder under `prompt-defaults` / `template-defaults` | Override allowed | New file allowed | Augmentation allowed | Loader behaviour |
|---|---|---|---|---|
| `prompt-defaults/system/` | — | yes | (new file = augmentation here) | concat all `^\d{2}_*.md$` files across both trees in numeric order |
| `prompt-defaults/skills/` | yes | yes | no (deferred to v2) | for each `<skill-name>/`, prefer overrides tree if same name exists; otherwise use defaults; new folders in overrides loaded as-is |
| `prompt-defaults/tools/` | no | no | yes (via `<tool>/description.augment.md`) | for each `<tool>/`, concat `description.md` (defaults) + `description.augment.md` (overrides, if present) |
| `prompt-defaults/etl/` | — | — | — (not in scope) | defaults-only, no overrides consulted |
| `template-defaults/handoff/` | yes | — | — | for each `<template-file>.md`, prefer overrides tree if same name exists; otherwise use defaults |

Anything else (e.g. attempts to override `etl/` or to augment `handoff/`) is out of scope for v1. The Curator skill's edit-tier policy reflects these constraints at the elicitation layer; the loader simply ignores out-of-scope files.

---

## 3. Bootstrap mechanism

**Path**: `scripts/bootstrap-prompts.sh` in swoop_web (new — there's no existing setup script to fold this into; devs run it once after `git clone`).

**Behaviour**: clones `agent_prompts` into a gitignored staging location inside `product/cms/`, then moves the relevant project/agent's override subtrees into the canonical positions (`product/cms/prompt-overrides/` and `product/cms/template-overrides/`).

**Sample shape** (illustrative; actual implementation refines):

```sh
#!/usr/bin/env bash
set -euo pipefail

REPO="${AGENT_PROMPTS_REPO:-git@github.com:<org>/agent_prompts.git}"
BRANCH="${AGENT_PROMPTS_BRANCH:-main}"
PROJECT="${AGENT_PROMPTS_PROJECT:-swoop_web}"
AGENT="${AGENT_PROMPTS_AGENT:-web_discovery}"
CMS="product/cms"
STAGING="${CMS}/.agent_prompts_clone"

if [ -d "${STAGING}/.git" ]; then
  (cd "${STAGING}" && git fetch origin "${BRANCH}" && git reset --hard "origin/${BRANCH}")
else
  git clone --branch "${BRANCH}" "${REPO}" "${STAGING}"
fi

SRC="${STAGING}/projects/${PROJECT}/agents/${AGENT}"
mkdir -p "${CMS}/prompt-overrides" "${CMS}/template-overrides"

rsync -a --delete "${SRC}/prompt-overrides/" "${CMS}/prompt-overrides/"
rsync -a --delete "${SRC}/template-overrides/" "${CMS}/template-overrides/"
```

(The actual implementation pins to specific behaviour around missing-source-subtrees, handles the case where `agent_prompts` hasn't grown a project/agent yet, and emits structured logs that the runtime can echo into its startup output. Refined during execution.)

**Gitignore additions** in swoop_web's `.gitignore`:

```
product/cms/.agent_prompts_clone/
product/cms/prompt-overrides/
product/cms/template-overrides/
```

**Local dev workflow**: developer runs `bash scripts/bootstrap-prompts.sh` once after cloning swoop_web. From then on, the four sibling directories (`prompt-defaults/`, `prompt-overrides/`, `template-defaults/`, `template-overrides/`) coexist in the worktree. Re-running the script is idempotent — it fetches latest and `rsync --delete` keeps the overrides tree in sync.

**CI/deploy**: same script runs as a step before build/test/deploy. The deployed runtime image has the bootstrapped overrides baked in.

**Edit workflow for sales-team Claude**: edits route via the nested `.git` inside `.agent_prompts_clone/` — that's where the actual repo's git directory lives, so commits land in `agent_prompts`. The Curator skill operates against `.agent_prompts_clone/projects/swoop_web/agents/web_discovery/` (the working tree of the agent_prompts repo) and pushes from there. After a successful PR-merge round-trip, the next bootstrap-run brings the merged content into `prompt-overrides/` and `template-overrides/`.

---

## 4. Runtime loader changes

The existing loader reads from `product/cms/prompt-defaults/system/^\d{2}_*.md$`, `prompt-defaults/skills/<name>/SKILL.md`, etc. (post-rename). It needs three new behaviours:

1. **System fragments** — additionally walk `prompt-overrides/system/^\d{2}_*.md$`, including all matches in the numeric-prefix sort. No new code beyond pointing the existing walker at two directories.

2. **Skills override + new** — for each `<skill-name>/` directory the loader currently finds in defaults, check if an override exists at `prompt-overrides/skills/<skill-name>/`. If yes, load from there; otherwise load from defaults. Additionally, walk `prompt-overrides/skills/` for skill folders that don't exist in defaults and load those as-is.

3. **Tool augmentation** — for each tool's `description.md` in defaults, check if `prompt-overrides/tools/<tool>/description.augment.md` exists; if yes, concatenate (defaults body + separator + augmentation body) before passing the description to the agent.

4. **Handoff template override** — for each handoff template file in `template-defaults/handoff/`, check if `template-overrides/handoff/<same-filename>` exists; if yes, use the override.

All four are local changes to the relevant loader functions; no architectural redesign. Estimated ~50 lines of new code across the three loader sites (system, skills, tools) plus the template loader.

**Runtime startup logging**: on boot, the loader emits a structured log entry listing all active overrides and new content from the overrides tree. *"loaded N system fragments (M from defaults, K from overrides); loaded P skills (Q from defaults, R overridden, S new from overrides); loaded T tools (U with augmentation); loaded V templates (W overridden)"*. Anyone debugging *"why is the agent doing X?"* checks this log first. Replaces the auto-banner idea (rejected as unmaintainable).

---

## 5. GitHub Actions

Both Actions live in `agent_prompts` repo.

### 5.1 Notify reviewer on PR

**Path**: `.github/workflows/notify-reviewer-on-pr.yml`

**Trigger**: `pull_request` (opened, reopened).

**Path filter**: none for M5 — the repo is wholly agent-content. As multi-project lands, a path-pattern-to-recipient mapping is layered in.

**Email recipient**: secret `REVIEWER_EMAIL` (set to `al@lope.works` initially; swap at handover to whichever Swoop dev-team distribution list takes over).

**SMTP credentials**: repo secrets `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`.

**Email body**: PR URL, PR author, PR description (first ~500 chars), changed-files list, project/agent inferred from changed paths.

**No author exclusion**: every PR fires email regardless of author for total provenance.

**Implementation**: stable marketplace SMTP action (e.g. `dawidd6/action-send-mail`), pinned to a SHA at integration.

### 5.2 Trigger swoop_web deploy on merge

**Path**: `.github/workflows/trigger-deploy.yml`

**Trigger**: `push` to `main` (which only happens via merged PR).

**Behaviour**: inspects the merged commit's changed paths. If any path under `projects/swoop_web/**` changed, fires a `repository_dispatch` event at swoop_web with event type `agent_prompts-updated` and a payload identifying the project/agent. swoop_web's deploy workflow listens for this and runs its existing deploy pipeline (which includes `bootstrap-prompts.sh`, so the new content reaches the runtime).

**Secret**: `SWOOP_WEB_DISPATCH_TOKEN` — a fine-grained PAT scoped to swoop_web with `contents:write` permission, used to fire the dispatch.

**Future**: as more projects land, the workflow grows path-pattern-to-dispatch-target routing (e.g. `projects/<other-client>/**` fires a different repo's dispatch). Lightweight YAML config.

---

## 6. Access model

### 6.1 Two PATs per sales-team-member

Each sales-team-member who uses the Curator gets two fine-grained PATs:

**PAT 1 — read-only `swoop_web`:**
- Scope: `swoop_web` repo only.
- Permissions: `contents: read`.
- Purpose: lets the Curator read code, planning docs, and decisions when grounding a proposed change. *"This prompt change depends on a tool that does X — let me check the tool's actual implementation..."* Critical for sane elicitation.

**PAT 2 — read+write `agent_prompts`:**
- Scope: `agent_prompts` repo only.
- Permissions: `contents: read+write` (to create branches), `pull-requests: write` (to open PRs).
- Purpose: the actual write surface. The Curator's per-project config (see [03-exec-crosscut-sales-team-prompt-curation.md §2.2](03-exec-crosscut-sales-team-prompt-curation.md)) keeps writes scoped to `projects/swoop_web/agents/web_discovery/` — soft enforcement at the conversation layer.

### 6.2 No CODEOWNERS — human review is the gate

The earlier framing of this plan proposed CODEOWNERS + branch protection for path-level access control inside the override repo. **Dropped**: every PR is human-reviewed (the GitHub Action notifies the reviewer; the reviewer either merges or comments). The reviewer's eye catches off-scope changes, off-project changes, and any other surprises. CODEOWNERS would be automation for a problem the reviewer already solves.

Future addition if PR volume grows enough that human review becomes a bottleneck: lightweight CODEOWNERS rules for low-risk path categories (e.g. typo fixes in skills). Not in M5 scope.

### 6.3 Cross-project blast-radius note

PAT 2 has `contents: read+write` on the entire `agent_prompts` repo. In the current single-project state, this is functionally equivalent to scoping to `projects/swoop_web/`. Once multi-project lands, a sales-team-member could (in theory) push to a different project's folder. Mitigations:

- Curator skill's per-project config refuses to operate outside its configured scope.
- Human review on every PR catches cross-project changes.
- The reviewer email is per-project once routing lands — a wrong-project PR would land in a reviewer's inbox who'd notice immediately.

No additional enforcement needed for M5; revisit if multi-project lands with sufficient activity to warrant automation.

---

## 7. Migration steps

1. **Create `agent_prompts` repo** in the chosen org (see §14 open questions). Initialise with the directory scaffold (`projects/swoop_web/agents/web_discovery/{prompt-overrides,template-overrides}/` empty), README, and the two GitHub Actions. Set repo secrets (`REVIEWER_EMAIL`, `SMTP_*`, `SWOOP_WEB_DISPATCH_TOKEN`).
2. **Branch protection on `main`** in agent_prompts: require PR before merge; require approval from at least one reviewer; require status checks.
3. **In swoop_web, single PR for the in-place refactor:**
   - Rename `product/cms/prompts/` → `product/cms/prompt-defaults/`.
   - Rename `product/cms/templates/` → `product/cms/template-defaults/`.
   - Update all loader path constants and code references.
   - Update `product/cms/README.md` to explain the defaults/overrides pattern.
   - Add the bootstrap script (`scripts/bootstrap-prompts.sh`) and gitignore entries.
   - Move `product/cms/legal/compliance-bundle/` → `planning/legal/compliance-bundle/`.
   - (Curator plan will add `planning/handover/` as part of its own work.)
4. **Run bootstrap locally**, verify the agent boots cleanly against the empty overrides tree (i.e. defaults-only behaviour), run the full test suite. Expected: no behaviour change vs pre-refactor since overrides are empty.
5. **First round-trip PR** in agent_prompts — open a trivial PR that adds an empty placeholder file or updates the README. Verify the notify-reviewer Action emails the right address. Verify the deploy-trigger Action fires `repository_dispatch` (and the dispatch is received by swoop_web, even if there's no actual content change to propagate yet).

---

## 8. Sequencing relative to other work

This lands **before** [03-exec-crosscut-sales-team-prompt-curation.md — Sales-team prompt curation](03-exec-crosscut-sales-team-prompt-curation.md). Reasoning:

- Curator's PAT scoping uses `agent_prompts` as PAT 2's target — repo needs to exist first.
- Curator's git operations point at the agent_prompts URL and the project/agent path.
- Curator's edit-tier policy reflects the per-folder override semantics (defined here).
- Curator's GitHub Action location is in agent_prompts (per §5.1) — not in swoop_web as the original Curator plan assumed.

The Curator plan will need a small revision pass after this lands. Estimated 0.25 day for those edits — already captured.

Also relates to:

- **E.t5 (real legal copy authoring)** — when this work lands, the new legal copy can be authored as `prompt-defaults/legal/runtime/` if classified as overridable, or stay outside the override system if classified as locked. Worth deciding before E.t5 executes; for M5 default-and-safe is *not* overridable (counsel just signed off).

---

## 9. Verification

**Pre-merge dry-run on swoop_web side:**

1. After the rename PR + bootstrap, runtime agent boots cleanly. All 14 adk skills load (from defaults). System prompts concatenate correctly. Tool descriptions resolve. No silent file-missing failures. Startup log shows *"0 from overrides"* across the board.
2. Full test suite passes (`@swoop/orchestrator`, `@swoop/connector`, `@swoop/ingestion`, `@swoop/ui`, `@swoop/common`, `@swoop/harness`).
3. Manual smoke: open a real conversation in the UI, exercise `find_options`, confirm widget renders.

**Round-trip verification (post-migration):**

1. In agent_prompts, open a PR adding a tiny override — e.g. a one-word edit to one of the 14 skills as `projects/swoop_web/agents/web_discovery/prompt-overrides/skills/pattern-anniversary-couple/SKILL.md`.
2. Confirm `notify-reviewer-on-pr.yml` fires and the reviewer email arrives.
3. Merge via reviewer approval.
4. Confirm `trigger-deploy.yml` fires `repository_dispatch` at swoop_web.
5. Confirm swoop_web's deploy pipeline picks up the dispatch.
6. Confirm bootstrap-prompts step fetches the new content.
7. Confirm the deployed runtime's startup log shows *"1 skill overridden from overrides"*.
8. Confirm the agent's behaviour reflects the edit in a real conversation that triggers the relevant skill.

**Each loader behaviour exercised:**

- System fragment addition: add a `99_test.md` augmentation, confirm it loads in numeric order.
- Skill override: replace one of the 14 skills, confirm runtime uses the replacement.
- Skill new: add a new skill, confirm runtime loads it.
- Tool augmentation: add a `description.augment.md` for one tool, confirm runtime concatenates it.
- Handoff template override: replace one template, confirm runtime uses the replacement.

Once verified, the test additions can be backed out (or kept as smoke-test fixtures depending on stylistic preference).

---

## 10. Decisions to log

To be assigned numeric IDs at merge per [decisions.md](decisions.md) convention. Provisional `prs-` prefix.

- **prs-1** — Two-tree composition (defaults + overrides) over single-source-of-truth. Reasons: smaller refactor (no file migration), safe fallback (wipe overrides to recover canonical behaviour), single-direction write isolation (sales-team Claude cannot accidentally edit canonical content because they have no write access to main repo).
- **prs-2** — Override repo named `agent_prompts`, scoped multi-project: `projects/<project>/agents/<agent>/{prompt-overrides,template-overrides}/`. Reasons: anticipates future agents and clients without new infrastructure; the repo grows into a portable multi-client asset over time.
- **prs-3** — Main repo renames: `prompts/` → `prompt-defaults/`, `templates/` → `template-defaults/`. Reason: structural signalling — directory name makes the defaults/overrides relationship visible without banners or runtime checks.
- **prs-4** — Per-folder override semantics for v1: system = augmentation by new file; skills = override or new (augmentation deferred); tools = augmentation only; etl = no overrides; handoff = override only. Reason: matches each folder's editing affordances and the loader-cost tolerance.
- **prs-5** — Bootstrap-clone pattern over git submodule. Reasons: less ergonomic friction (no `git status` distance, no submodule ceremony); commits route automatically via nested `.git`; idempotent re-bootstrap is just a fetch+rsync.
- **prs-6** — No CODEOWNERS in v1. Reason: every PR is human-reviewed; the reviewer's eye is the gate. CODEOWNERS would be automation for a problem human review already solves.
- **prs-7** — Two-PAT model for sales-team-members (read-only swoop_web + read+write agent_prompts). Reason: read access enables grounding the Curator's elicitation in code context; write access stays scoped to where edits should land.
- **prs-8** — Move `product/cms/legal/compliance-bundle/` → `planning/legal/compliance-bundle/` and `product/cms/handover/` (when authored) → `planning/handover/`. Reason: these are documentation artefacts, not runtime agent content; misplaced under cms.
- **prs-9** — Runtime startup log enumerates active overrides. Reason: replaces the unmaintainable auto-banner idea; gives one observable place to see what's actually live in production.

---

## 11. Out of scope

Explicit fence:

- **No file migration.** Canonical content stays in swoop_web. Only the overrides tree lives in agent_prompts.
- **No skill augmentation.** Deferred to v2 — the merge semantics are awkward (frontmatter vs body, trigger preservation, etc.). Override or new-skill covers the M5 use cases.
- **No tool override.** Schema-coupled; opening it risks the agent calling tools with wrong arg shapes. Augmentation only.
- **No handoff template augmentation.** Templates are renderable; appending random text breaks rendering.
- **No CODEOWNERS / branch protection beyond "require PR + reviewer approval".** Human review is the gate.
- **No multi-project routing in the GitHub Actions** — for M5 there's only one project, so a simple all-PRs-notify shape is fine. Routing config lands when the second project arrives.
- **No sparse-checkout in the bootstrap.** Clones the whole `agent_prompts` repo even though only one slice is used. Trivial space cost; optimisation deferred.
- **No automated banner-syncing in main repo.** Replaced by the runtime startup log.
- **No retention policy for overrides.** Overrides accumulate; pruning is a future judgment call.
- **No per-environment override branches.** One `agent_prompts` `main`, one runtime. Multi-env is a future option.

---

## 12. Sizing

Estimated 1.0-1.5 days from the contingency window:

- 0.25 day — create agent_prompts repo, branch protection, GitHub Actions, secrets
- 0.5 day — main repo refactor: renames + loader path updates + bootstrap script + gitignore + README + legal/compliance-bundle move
- 0.25 day — runtime loader new behaviours (system additions, skill override+new, tool augmentation, template override) + smoke test against empty overrides
- 0.25 day — round-trip verification (test PR through the full mechanism)

Edge factor: hosting-org decision (see §14) could block the repo-creation step. If org choice is straightforward, no impact; if it stalls, the work can proceed on a local stub repo and migrate once the destination is decided. ~30 min if a migration is needed.

Combined with the Curator plan's revision pass (0.25 day), the two-plan sequence is roughly 1.25-1.75 days total before the Curator plan's main execution begins.

---

## 13. Open questions before execution

1. **Hosting location for `agent_prompts`.** Three plausible options: (a) Swoop's GitHub org — keeps it inside Swoop's perimeter, simplest from a security-conversation standpoint, but the multi-project framing becomes awkward if other clients ever land here. (b) WhaleyBear's org (or whichever org the engagement invoices through) — the multi-project framing makes sense, but raises a question about who owns content authored within. (c) A new shared org — overhead. The strategic call: is this a Swoop asset (host with Swoop) or a portable multi-client asset (host outside Swoop with a sharing arrangement). Worth a 5-min think before repo creation.

2. **Tool augmentation file convention.** `<tool>/description.augment.md` is the obvious shape, but alternative names worth a sense-check: `description.add.md` / `description.sales.md` / `addendum.md`. Bikeshed-light; default-named "augment" works and is consistent with the per-folder logic table. Confirm at execution.

3. **Bootstrap script language.** Shell (as sketched in §3) is the obvious default for portability. Alternative: a small Node script under `scripts/` for consistency with the rest of the codebase's tooling. Marginal. Default: shell unless there's a Node convention already in use.

4. **PR Action's project-detection logic.** §5.1 says "project/agent inferred from changed paths". Concrete: parse the first match of `projects/<project>/agents/<agent>/` from the changed-files list. Trivial. Worth being explicit so future contributors don't reinvent it.

---

## Provenance

Captured from the 2026-05-21 planning session. Earlier framings proposed (in sequence): (1) `product/cms/` as an npm workspace inside swoop_web, (2) full file migration to a separate `swoop_web` cms repo with CODEOWNERS path-level access control, (3) sales-team read access to swoop_web for grounding context + write access to a smaller content repo, (4) the override+augmentation pattern (this plan) — content stays in main repo, override repo carries additions and replacements only.

The final shape — multi-project `agent_prompts` with per-project per-agent folder scoping, two-tree runtime composition, two PATs per sales-team-member, no CODEOWNERS, defaults+overrides naming, bootstrap-clone over submodule — captures decisions made progressively through the conversation as each earlier framing's limitations surfaced.
