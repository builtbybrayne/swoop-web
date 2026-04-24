# product/ — Claude Code execution context

You are inside the code monorepo for the **Swoop Web Discovery** tool (active release: **Puma**).

This file orients a Claude Code agent working inside `product/`. It is deliberately short. For Cowork-level project planning context (roadmap, releases, inbox, questions, people), read the **repo-root `../CLAUDE.md`** — do not conflate the two.

---

## What this is

`product/` is an npm-workspaces monorepo. The repo root (`../`) is a git repo that also holds planning docs, but has no `package.json` of its own. All code — every package, every dep, every build script — lives under `product/`.

## Workspace layout

Packages are declared in `product/package.json` under `workspaces`:

| Package | Role | Chunk |
|---|---|---|
| `ts-common/` | Shared types, schemas, small pure utilities consumed across packages. | A.t2 |
| `orchestrator/` | Agent runtime: prompt loop, tool calls, state. Cloud Run service. | B |
| `connector/` | Data-access layer. Wraps Swoop APIs / scraping adapters. | C |
| `ui/` | Embedded chat surface (web component or iframe host). | D |
| `cms/` | Content-as-data: authored library/trip data, sales copy, prompt fragments. Read at runtime; never inlined. | G |
| `ingestion/` | Scraper / API adapter feeding `connector/`. | C |
| `harness/` | Behavioural evals: TS CLI runs YAML scenarios through `:8080` orchestrator. Non-gating CI. | H |

Until A.t2 and A.t4 land, these are empty directories — the workspace resolves but has nothing to build.

## Running things locally

All commands run from `product/`:

```bash
nvm use                  # picks up Node 20 from ../.nvmrc
npm install              # installs workspace deps into product/node_modules
npm run typecheck        # tsc across all workspaces (--if-present)
npm run lint             # ESLint across the tree
npm run format           # Prettier --check (use format:write to apply)
npm run dev              # concurrently-driven watch; empty-workspace no-op until packages land
npm test                 # per-workspace tests (--if-present)
```

Node version is pinned to 20 LTS via `.nvmrc` at the repo root.

## Code conventions

- **TypeScript everywhere.** Shared compiler options live in `tsconfig.base.json`; each package extends it with its own `module`, `moduleResolution`, and output paths. Node-side packages use `module: Node16`; the UI package uses `module: ESNext` + `moduleResolution: bundler` + `jsx: react-jsx`.
- **ESLint owns correctness; Prettier owns style.** They do not overlap. `eslint-config-prettier` disables any stylistic ESLint rules that would fight Prettier.
- **Content is data, not code.** Authored content (library entries, sales copy, prompt fragments, brand text) lives in `cms/` and is loaded at runtime. Never inline CMS content inside TypeScript. If you find yourself pasting paragraphs of prose into `.ts`, stop and put it in `cms/`.
- **Cross-package imports** use npm workspaces' native resolution — import from the package name (e.g. `@swoop/common`) once packages are populated. No `tsconfig` project references in this scaffold; we'll add them if incremental builds become painful.

## Planning docs

Tier 1/2/3 planning lives in the repo root at `../planning/`. Once A.t5 lands, a symlink at `product/project_management_references/planning` will expose it inside this tree so agents can reference `project_management_references/planning/02-impl-*.md` without climbing out of the workspace. Until then, climb out: `../planning/`.

Tier 3 execution plans (`03-exec-<chunk>-<task>.md`) are the canonical brief for any single task. Read the relevant Tier 3 verbatim before implementing — it names every file, every verification step, and the scope guardrails.

## Testing approach

The project's validation strategy is driven by the **Tier 2 chunk H validation harness**, not dense per-package unit-test suites. Write unit tests only where failure modes are narrow and fixtures are cheap (pure utilities in `ts-common/`, schema parsers, small deterministic transforms). Integration and behavioural coverage belong in the H harness.

## Runtime target

Cloud Run only. Firebase Functions are out of scope for Puma; the Firebase Emulator suite is not used. Don't add Firebase runtime config to any package.

## Proof of concept — reference only

`../chatgpt_poc/` is a symlink to the earlier ChatGPT Apps SDK prototype (`~/Studio/projects/swoop/`). It's a read-only reference for patterns (workspace shape, TS config, content loading). **Do not modify it**, and do not import from it — copy what's useful into the new package and adapt.

## Scope discipline

- If a Tier 3 plan doesn't list a file, don't create it.
- If a decision feels wrong at implementation time, raise it against the relevant Tier 2 doc (`../planning/02-impl-*.md`) before implementing an alternative. Plan-first, code-second.
- Don't `git add` / commit unless the user asks. Leave the working tree for Al to review.
