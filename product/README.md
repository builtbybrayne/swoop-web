# product/ — Puma code monorepo

The npm workspace holding every deployable for the Swoop Web Discovery tool (release: **Puma**). The repo root (`../`) holds project planning and process; no `package.json` lives there.

For the Claude Code execution context (conventions, scope discipline, testing posture) read **`./CLAUDE.md`**. For Cowork-level project context (releases, people, inbox) read **`../CLAUDE.md`**.

## Workspace layout

| Package | Role | Chunk |
|---|---|---|
| `ts-common/` | Shared types, Zod schemas, small pure utilities. Published as `@swoop/common` inside the workspace. | A.t2 |
| `orchestrator/` | Agent runtime: prompt loop, tool dispatch, session state. Cloud Run service. | B |
| `connector/` | Data-access layer. Wraps Swoop APIs and/or scraping adapters. Cloud Run service. | C |
| `ui/` | Embedded chat surface (web component or iframe host) for the Swoop marketing site. | D |
| `ingestion/` | Scraper / API adapter feeding `connector/`. Cloud Run job. | C |
| `cms/` | Content as data — prompts, skills, legal copy, templates, fixtures. **Not a code package.** Loaded at runtime; never inlined in TS. | G |

Every code package has its own `package.json`, `tsconfig.json`, and (where relevant) `.env.example`. Cross-package imports resolve via npm workspaces — import from `@swoop/common`, not relative paths.

## Dev loop

All commands run from `product/`:

```bash
nvm use              # picks up Node 20 from ../.nvmrc
npm install          # installs workspace deps into product/node_modules
npm run dev          # concurrently-driven watch; see scripts/dev.sh
npm run typecheck    # tsc across all workspaces (--if-present)
npm run lint         # ESLint across the tree
npm run format       # Prettier --check (use format:write to apply)
npm test             # per-workspace tests (--if-present)
npm run build        # tsc --build across packages
```

`npm run dev` no-ops gracefully when no package has a `dev` script yet (pre-A.t2 state).

## Planning docs

Tier 1 / 2 / 3 planning lives at the repo root under `../planning/`. A convenience symlink exposes the same tree inside this workspace:

- `./project_management_references/planning/01-top-level.md` — Tier 1 top-level plan (canonical).
- `./project_management_references/planning/02-impl-*.md` — Tier 2 implementation plans per chunk.
- `./project_management_references/planning/03-exec-*.md` — Tier 3 execution plans per task.
- `./project_management_references/planning/decisions.md` — running decision log.
- `./project_management_references/planning/archive/` — pre-reset planning docs (superseded by the 2026-04-22 reset; kept for historical source material).

Read the relevant Tier 3 plan verbatim before starting any task — it names every file, every verification step, and every scope guardrail.

## Per-package working notes

Each code package carries a `STREAM.md` with its current working context (active task, open questions, decisions in flight). Consult it before touching the package; update it when you finish.
