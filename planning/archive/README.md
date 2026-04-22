# Planning Archive

**Archived**: 2026-04-22

These docs were the pre-reset working planning set. They became historical when `planning/01-top-level.md` was written as the new canonical top-level plan.

**They are not deleted because the thinking in them is still useful source material**:
- 20/21 Apr meeting capture (in `meetings/`) — non-derivable client voice
- Research docs (in `research/`) — UI library analysis, eval-harness options, discovery-agent architecture brief
- 30 Mar proposal (`project_proposal.md`) — the commercial fence
- Quoting notes (`project_proposal_notes.md`) — scope deferrals, time calibration, Julie's production bar
- 00–07 docs — mixture of good substrate (decisions, PoC carry-forward inventory) and over-specification (prescribed file paths, env var shapes) that the new tiered plans deliberately avoid

## Why the reset

The pre-reset docs conflated four altitudes (top-level intent, architectural blueprint, repo scaffold, execution brief) into single documents. That ages badly, constrains execution agents, and buries useful thinking under premature inventory.

The new four-tier structure (Tier 1 top-level, Tier 2 implementation per chunk, Tier 3 execution per task, Tier 4 agent swarm) separates those altitudes so each tier is at the right fidelity for its readers.

## How Tier 2/3 plans reference this archive

Tier 2 implementation plans are allowed to cite specific sections of archived docs when the archive contains material at the right altitude — e.g. "see `archive/01-architecture.md` §2.3 for the WHY/HOW/WHAT × User/Agent/Swoop matrix rationale". The archive is source material; the new tiers are the canonical plans.

## Canonical plan going forward

See `planning/01-top-level.md`.
