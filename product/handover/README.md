# Swoop handover

Handover documents for the Swoop team taking ownership of Puma. Companion to the operator runbooks in [`../docs/ops/`](../docs/ops/README.md) (day-task recipes).

## Developer handover

| Doc | Read it to… |
|---|---|
| [`productionisation.md`](productionisation.md) | **Stand Puma up in Swoop's GCP the first time** — what to provision (IAM, secrets, services), the env surface, the first database build, deploy, and the go-live gates. |
| [`maintenance.md`](maintenance.md) | **Keep it running and evolve it** — data refreshes, migrations, prompt/content updates, observability + incident response, retention, dependency updates, scaling. |
| [`ui-integration.md`](ui-integration.md) | **Brand + embed the chat UI** — the 12 CSS theme tokens + the part-marker contract, and the iframe embed (build, `VITE_ORCHESTRATOR_URL`, CORS). For Swoop's web team. |

## Sales handover

*Planned, not yet written.* A separate doc for the sales team — how the agent qualifies leads, what lands in their inbox, how to read a handoff verdict. Tracked for later; this folder is its home.

## Conventions

Same as the ops runbooks: **role-based** (never named individuals — roles age better than staffing), **paste-ready**, and **cross-link, don't repeat** — the `.env.example` files, ops runbooks, compliance bundle, `discoveries.md` and `gotchas.md` stay canonical; these docs gather and sequence them. **Living documents** — Swoop's team edits them post-handover.
