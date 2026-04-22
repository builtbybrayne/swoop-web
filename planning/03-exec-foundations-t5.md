# 03 — Execution: A.t5 — Decision log + handover artefacts

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: A (foundations).
**Task**: t5 — decision log + handover artefacts.
**Implements**: `planning/02-impl-foundations.md` §2.6 (decision log) + §10 A.t5.
**Depends on**: A.t1–A.t4.
**Produces**: `planning/decisions.md`, `product/cms/` directory + README, `product/project_management_references/planning` symlink, `product/README.md`.
**Unblocks**: planning / decision traceability throughout the build; makes onboarding a new agent / developer low-friction.
**Estimate**: 1 hour.

---

## Purpose

Close out chunk A with three thin but important handover artefacts:
1. A running decision log so chunk A's decisions (A.1–A.8) are traceable and future decisions land in the same place.
2. The `product/cms/` directory with a README that explains the content-as-data posture to anyone reading cold.
3. A symlink from inside `product/` pointing at the repo-root `planning/` directory — so Claude Code agents executing inside `product/` can reference planning docs without path gymnastics (PoC convention).
4. A terse `product/README.md` explaining the workspace layout and dev loop.

---

## Deliverables

### `planning/decisions.md`

Running log of Tier 2 / Tier 3 decisions. Format: one entry per decision, reverse-chronological (newest at top).

Initial content records chunk A decisions. Each entry:
```
## A.1 — npm workspaces as workspace tooling
**Decided**: 2026-04-22
**Owner**: Al
**Rationale**: Closest to PoC; zero new vocabulary for Swoop's in-house team; no compelling Puma-scale reason to introduce pnpm / Turborepo / Nx.
**Swap cost**: Low. Re-initialising with a different tool is a few hours' work; schema of per-package files survives.
```

Populate entries for A.1 through A.8 (from `planning/02-impl-foundations.md` §5). Same terse format.

Going forward, **any Tier 2 or Tier 3 decision gets a one-paragraph entry here**. Not aspirational — if the entry isn't there, the decision isn't real.

### `product/cms/` directory + README

```
product/cms/
├── README.md
└── (empty — chunk G populates)
```

`product/cms/README.md` content (short):

- Purpose: all Puma content that isn't code lives here (prompts, skills, legal copy, email templates, placeholder fixture content). Markdown and JSON only.
- Loaded at runtime by orchestrator / connector / UI. Never inlined in TS.
- Structure subject to chunk G's Tier 3. Expected layout: `prompts/`, `skills/`, `templates/`, `legal/`, `fixtures/` (or similar).
- Authorable by non-engineers (this is a placeholder for a real CMS maintained by Swoop's sales staff post-Puma).

### `product/project_management_references/planning` symlink

Symlink:
```
product/project_management_references/
└── planning → ../../planning
```

Read-only reference for Claude Code agents working inside `product/`. They follow the symlink when they need to consult planning docs without having to leave the package tree.

Note: this is a convention carry-forward from the PoC (`chatgpt_poc/product/project_management_references/planning -> ../../planning`).

### `product/README.md`

Short (~40 lines), covers:

- **What this is**: the Puma code monorepo. Workspace hosts sibling packages — see table below.
- **Workspace layout table**: `ts-common/`, `orchestrator/`, `connector/`, `ui/`, `ingestion/`, `cms/` (content, not a package).
- **Dev loop**: `cd product && npm install && npm run dev`. Points at `scripts/dev.sh`.
- **Planning docs**: link to `./project_management_references/planning/01-top-level.md` and note that it supersedes prior docs in `./project_management_references/planning/archive/`.
- **Claude Code agents**: cross-reference `./CLAUDE.md` for the execution context.
- **Per-package notes**: each package has a `STREAM.md`; consult it before starting work.

### Update `planning/02-impl-foundations.md` checkbox state

Mark A.t1–A.t5 in the §10 task list as completed (or flag for the coordinator to mark). Lightweight bookkeeping — `[x]` checkboxes or strike-throughs, whichever matches the existing pattern.

---

## Key implementation notes

### 1. Symlink is OS-dependent

On macOS / Linux, use `ln -s`. On Windows, the scaffold can skip this; the symlink gets recreated locally. Since Puma's primary dev is on macOS (Al's machine), optimise for that.

### 2. Decision log format consistency

If the PoC or any prior Swoop project has a decision-log format, match it. Otherwise, the format above is the house standard. Don't innovate on the format.

### 3. `product/README.md` is not a marketing doc

Terse, scannable, points at truth. The root `CLAUDE.md` handles the project-context framing.

### 4. Decision log grows

A.t5 seeds it with A.1–A.8. Every subsequent Tier 2 or Tier 3 task that closes a decision adds an entry. The log becomes a navigation aid for any future reader asking "why did we do this?"

---

## References

- `chatgpt_poc/CLAUDE.md` — Cowork-level context pattern (reference only; already applied at `swoop_web/CLAUDE.md`).
- `chatgpt_poc/product/CLAUDE.md` — Claude Code execution context (reference; applied at `product/CLAUDE.md` via A.t1).
- `chatgpt_poc/product/project_management_references/` — the symlink convention. Replicate.

---

## Verification

1. `planning/decisions.md` exists, lists A.1 through A.8 with dates, rationale, swap cost.
2. `product/cms/` exists with a README.
3. `ls -la product/project_management_references/` shows the `planning` symlink resolving to `../../planning`.
4. `cat product/project_management_references/planning/01-top-level.md` reads the top-level plan without error.
5. `product/README.md` exists, is under ~60 lines, covers the workspace layout and dev loop.
6. `planning/02-impl-foundations.md` §10 task list marks A.t1–A.t5 complete (or coordinator does this post-merge).
7. A new Claude Code agent spinning up inside `product/` can find its way around: root `CLAUDE.md`, `product/CLAUDE.md`, workspace `README.md`, symlinked planning — all reachable.

---

## Handoff notes

- The decision log is the **primary** anti-amnesia artefact for Puma. Future agents should add entries when they close decisions; skipping it accumulates invisible drift.
- If `planning/decisions.md` already exists (from some prior task's over-reach), merge rather than overwrite.
- The symlink is a convenience for agents, not a publishing surface. Don't ship it in deploy artefacts.
- Do not commit build artefacts (`node_modules/`, `dist/`) even if they appear at this stage — `.gitignore` from A.t1 handles it.
- Chunk A completion gate: all five A.t* tasks pass their verification, and Al has eyeballed the decision log + READMEs for coherence.
