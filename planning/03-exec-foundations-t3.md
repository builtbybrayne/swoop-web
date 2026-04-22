# 03 — Execution: A.t3 — CI skeleton

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: A (foundations).
**Task**: t3 — CI skeleton.
**Implements**: `planning/02-impl-foundations.md` §2.4 + decision A.5 (GitHub Actions default).
**Depends on**: A.t1 (workspace + scripts exist).
**Produces**: `.github/workflows/ci.yml` — typecheck + lint + build + (later) test.
**Unblocks**: confidence in downstream work; PR reviews gain an automatic integrity check.
**Estimate**: 1–2 hours.

---

## Purpose

Add a fast, PR-triggered CI pipeline that catches TypeScript and lint errors on every push. No deploys, no eval harness yet (H.t6 adds the eval layer later). Target: runs in under 3 minutes, fails fast, green by default.

---

## Deliverables

### `.github/workflows/ci.yml` at the repo root

One workflow, triggered on:
- `push` to `main`
- `pull_request` targeting `main`
- Paths filter: only runs if anything under `product/`, `.github/workflows/`, `.nvmrc`, or the root config files changed. Planning-only PRs don't spin CI.

Jobs:
1. **`build`** (Ubuntu latest, Node 20 via `.nvmrc`):
   - `actions/checkout@v4`
   - `actions/setup-node@v4` with `node-version-file: '.nvmrc'` and `cache: 'npm'` with `cache-dependency-path: 'product/package-lock.json'`
   - `cd product && npm ci`
   - `cd product && npm run typecheck`
   - `cd product && npm run lint`
   - `cd product && npm run build --if-present`
   - `cd product && npm run test --if-present` (Vitest — will be a no-op until `ts-common`'s fixture test lands)

Single job keeps it simple; split later if runtime exceeds the budget.

### Optional nice-to-have (include if trivial)

- Cache the Node modules between runs (already handled by `setup-node`'s `cache: 'npm'`).
- Job summary markdown that reports file counts or package counts (skip if non-trivial).

### What this task does **not** do

- No deploy workflow. `deploy.yml` lands with chunk B/C/D packages that actually deploy.
- No eval harness trigger. Chunk H's H.t6 adds an `eval.yml` workflow later.
- No security scanning (Dependabot, Snyk, etc.). Reactively added if needed.
- No release / publish automation. None of Puma's packages publish to npm.
- No matrix builds. Single Node version, single OS.

---

## Key implementation notes

### 1. Paths filter

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    paths:
      - 'product/**'
      - '.github/workflows/**'
      - '.nvmrc'
      - '.gitignore'
      - '.editorconfig'
```

Planning-only commits shouldn't burn CI minutes.

### 2. Working directory

Jobs `cd product` before running npm commands. GitHub Actions `working-directory` config can set this once for all steps if that's cleaner — either pattern is fine.

### 3. `--if-present` for flexibility

Build and test use `--if-present` so packages without those scripts don't fail the job. Packages opt in by adding the script.

### 4. Concurrency

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Cancels superseded runs on rapid PR pushes. Keeps CI cost down and signal fresh.

### 5. No secrets

No `Secrets.*` access. If a job ever needs one (e.g. Claude API for the eval harness — chunk H), add it explicitly with least privilege.

---

## References

- GitHub Actions docs for `setup-node@v4` — the `node-version-file` + `cache-dependency-path` combo is the current best practice.
- No PoC precedent — PoC shipped without CI.

---

## Verification

1. Commit `.github/workflows/ci.yml` on a branch.
2. Open a PR targeting `main` — CI triggers, completes green.
3. CI run duration: under 3 minutes (with empty packages; may rise as packages populate — tune later).
4. Intentionally introduce a TS error in a scratch branch (`const x: number = "foo"` somewhere under `product/`) — CI fails with the expected error. Revert.
5. Intentionally introduce a lint error — CI fails. Revert.
6. Commit a planning-only change (`planning/foo.md`) — CI does **not** trigger (paths filter).

---

## Handoff notes

- Don't add a deploy step here. Deploy comes per-service during chunk B/C work and lands in a separate workflow.
- Don't try to gate on coverage. No coverage in Puma — Tier 2 H's harness is the behavioural gate.
- Don't set up branch protection in this task (that's a GitHub settings change, not a code change — raise it as a decision for Al separately).
- If CI gets slow (>3 min consistently), consider splitting typecheck and lint into parallel jobs. Don't optimise prematurely.
