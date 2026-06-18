# Swoop handover

Handover documents for the Swoop team taking ownership of Puma. Companion to the operator runbooks in [`ops/`](ops/README.md) (day-task recipes).

## Developer handover

| Doc | Read it to… |
|---|---|
| [`productionisation.md`](productionisation.md) | **Stand Puma up in Swoop's GCP the first time** — what to provision (IAM, secrets, services), the env surface, the first database build, deploy, and the go-live gates. |
| [`maintenance.md`](maintenance.md) | **Keep it running and evolve it** — data refreshes, migrations, prompt/content updates, observability + incident response, retention, dependency updates, scaling. |
| [`ui-integration.md`](ui-integration.md) | **Brand + embed the chat UI** — the 12 CSS theme tokens + the part-marker contract, and the iframe embed (build, `VITE_ORCHESTRATOR_URL`, CORS). For Swoop's web team. |

## Understanding the codebase

Two code knowledge-graphs cover `product/` — both **regenerated locally and gitignored** (large, derived, not committed):

- **understand-anything** — an interactive graph (~990 nodes; 10 layers = the workspaces; import / call / tested-by edges; a 15-step guided tour). The best first stop for onboarding or an architecture overview. Browse it with `/understand-dashboard`; (re)build with `/understand` (incremental after the first run). When regenerating, set `.understand-anything/.understandignore` to exclude `graphify-out/`, `project_management_references/` (a symlink to the planning tree), `harness/runs/`, `.omc/`, and `.understand-anything/` itself — otherwise the scan tries to ingest tens of thousands of generated cache files.
- **graphify** — query-oriented (`graph:query` / `graph:rebuild`); see [`../product/CLAUDE.md`](../product/CLAUDE.md) "graphify". Good for "what relates to X" and path-between-symbols questions.

Neither is in git; a built understand-anything graph lives on the build machine (first generated 2026-06-17). Regenerate from a clone before consulting.

## Sales handover

Docs for the Swoop sales team, written for them rather than for developers.

| Doc | Read it to… |
|---|---|
| [`sales-memory.md`](sales-memory.md) | **Teach the agent what you know** — log in, then tell the agent facts (seasonality, prices, availability) it should carry into every visitor conversation. |

Its sibling lives in [`../docs/`](../docs/sales-team-prompt-workflow-sales.md): **Shaping how the agent behaves** — how to feed back tone and behaviour changes via the shared Google Doc.

*Still planned:* a lead-handling guide — how the agent qualifies leads, what lands in the sales inbox, how to read a handoff verdict. This folder is its home.

## Conventions

Same as the ops runbooks: **role-based** (never named individuals — roles age better than staffing), **paste-ready**, and **cross-link, don't repeat** — the `.env.example` files, ops runbooks, compliance bundle, `discoveries.md` and `gotchas.md` stay canonical; these docs gather and sequence them. **Living documents** — Swoop's team edits them post-handover.
