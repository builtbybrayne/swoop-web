# 03 — Execution: A.t1 — Repo scaffold

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: A (foundations).
**Task**: t1 — repo scaffold.
**Implements**: `planning/02-impl-foundations.md` §10 (A.t1) + §1 outcomes 1–3.
**Depends on**: nothing. Root of the dependency graph; first thing produced.
**Produces**: repo root config files + `product/` workspace root + `product/CLAUDE.md`. Leaves empty package directories for A.t4 to populate.
**Unblocks**: A.t2 (`ts-common`), A.t3 (CI), A.t4 (empty package scaffolds).
**Estimate**: 2–3 hours of a single Claude Code agent's time.

---

## Purpose

Initialise the `swoop_web` repo's code monorepo at `product/`. Every downstream chunk consumes what this task produces: the workspace wiring, TypeScript base config, lint + format, dev orchestration, and the Claude Code execution context (`product/CLAUDE.md`).

This is deliberately skeletal. No packages are populated (A.t2 and A.t4 do that). The goal is a clean launchpad that every other chunk can plug into without fiddling with foundations.

---

## Deliverables

### Repo-root files (at `~/Studio/projects/swoop_web/`)

| File | Role |
|---|---|
| `.nvmrc` | Pins Node 20 LTS. Single line: `20`. |
| `.gitignore` | Standard TS + macOS + IDE ignores. Also: `.env`, `.env.local`, `dist/`, `.turbo/`, `.next/`, `.vercel/`, `.DS_Store`, `.idea/`, `.vscode/settings.json` (allow `.vscode/extensions.json`). |
| `.editorconfig` | Cross-editor consistency: 2-space indent, LF line endings, UTF-8, trim trailing whitespace, insert final newline. Applies to the whole repo. |

### `product/` workspace files

| File | Role |
|---|---|
| `product/package.json` | The code-monorepo root. `"private": true`, `"workspaces": ["ts-common", "orchestrator", "connector", "ui", "cms", "ingestion"]` (names subject to A.t4; placeholder list is fine). `"packageManager": "npm@10.x"`. Scripts: `build`, `typecheck`, `lint`, `format`, `test`, `dev` — all workspace-aware via `npm run <x> -ws --if-present` or `concurrently` where watchers are needed. `devDependencies`: `typescript` ^5.x, `eslint` ^9.x, `@typescript-eslint/*`, `prettier` ^3.x, `concurrently` ^9.x. No runtime deps here. |
| `product/tsconfig.base.json` | Shared compiler options: `target: "ES2022"`, `strict: true`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`, `resolveJsonModule: true`, `skipLibCheck: true`, `isolatedModules: true`, `declaration: true`, `declarationMap: true`, `sourceMap: true`. No `module` or `moduleResolution` — each package overrides per its target (Node vs bundler). No `jsx` — `ui` package overrides. |
| `product/.eslintrc.cjs` | Extends `eslint:recommended`, `@typescript-eslint/recommended`, `prettier` (to disable style rules Prettier owns). Rules: `@typescript-eslint/no-explicit-any` = warn (not error — allows `any` with justification), `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: "^_"`. `root: true`. Overrides per-package for React where needed (eventually in `ui/.eslintrc`). |
| `product/.prettierrc` | 2-space indent, single quotes, trailing commas (`all`), semicolons on, print width 100, bracket spacing on. |
| `product/.prettierignore` | `dist/`, `node_modules/`, `*.md` (docs have their own prose rhythms), `cms/` (content-as-data — let it breathe). |
| `product/scripts/dev.sh` | `concurrently` invocation. Initially no packages to watch — keep it running cleanly even when all workspace packages are empty. Exits 0 after printing a short message if no packages are present. |
| `product/CLAUDE.md` | Claude Code execution context. **Distinct from the root `CLAUDE.md`** (which is Cowork project-level). This one tells coding agents how to operate inside `product/`: workspace structure, dev commands, where `ts-common` lives, never inline CMS content, reference planning docs via the `product/project_management_references/planning` symlink (A.t5 creates it). |

### Empty placeholder workspace directories (under `product/`)

Created as directories only (no files inside — A.t4 populates them):

- `product/ts-common/` (A.t2 populates)
- `product/orchestrator/` (chunk B lives here)
- `product/connector/` (chunk C lives here; name "connector" confirmed in chunk C Tier 3; placeholder until then)
- `product/ui/` (chunk D lives here)
- `product/cms/` (chunk G lives here)
- `product/ingestion/` (chunk C scraper / API adapter lives here)

A.t4 adds a minimal `package.json` + `tsconfig.json` to each so the workspace resolves.

### Claude Code integration artefacts

| File | Role |
|---|---|
| `product/scripts/.gitkeep` | Empty, just so `scripts/` survives. |

---

## Key implementation notes

### 1. Monorepo tooling — npm workspaces only

No pnpm, no Turborepo, no Nx. Decided in A.1 / chunk A §3. Keep it boring.

### 2. TypeScript config split

`tsconfig.base.json` at `product/` root holds shared options. Each package extends it with its own `module`, `moduleResolution`, `outDir`, `rootDir`, `lib`, `jsx` (UI only). Node-side packages use `module: Node16`; the UI package uses `module: ESNext` + `moduleResolution: bundler` + `jsx: react-jsx`. Do **not** set `module` in the base — it conflicts with the per-package choice.

### 3. Cross-package type resolution

Use npm workspaces' native resolution — no project references file (`tsconfig.json`'s `references` array) in this task. If incremental builds become painful later, we add project refs; premature now.

### 4. ESLint + Prettier separation

ESLint owns correctness; Prettier owns style. Zero overlap. The `eslint-config-prettier` extension is in the ESLint config to disable any stylistic ESLint rules that would fight Prettier.

### 5. No pre-commit hook

A.t1 does not install husky or lint-staged. CI is the source of truth (A.t3). Pre-commit can be added reactively if devs request it.

### 6. `product/CLAUDE.md` content

Keep it short — it's a starting pad, not a manual. Cover:
- This is the Claude Code execution context, not Cowork planning.
- Workspace layout overview.
- How to run dev locally.
- How to reference planning docs (via symlink, once A.t5 lands).
- Content-as-data rule (no inlining CMS content in TS).
- Tests via the Tier 2 H validation harness, not dense unit-test suites — unit tests only where failure modes are narrow and fixtures cheap.
- PoC is at `../chatgpt_poc/` (symlink from repo root); reference only, do not modify.

---

## References from the PoC (read, don't copy-paste)

- `chatgpt_poc/product/package.json` — monorepo root pattern with `concurrently`. Adapt; don't copy verbatim (PoC used `file:` references before npm workspaces).
- `chatgpt_poc/product/mcp-ts/tsconfig.json` — Node-side TS config shape.
- `chatgpt_poc/product/ui-react/tsconfig.json` — bundler-side TS config shape.
- `chatgpt_poc/product/mcp-ts/.env.example` — `.env.example`-per-package pattern (A.t4 applies, not A.t1).
- `chatgpt_poc/CLAUDE.md` and `chatgpt_poc/product/CLAUDE.md` — the Cowork-level vs Claude Code-level split. Root `swoop_web/CLAUDE.md` is already written; `product/CLAUDE.md` gets written by this task.

---

## Verification

The agent completing A.t1 demonstrates these checks pass:

1. `nvm use` (from `swoop_web/`) picks up Node 20.
2. `cd product && npm install` runs clean — no errors, no peer warnings beyond common ecosystem noise. `node_modules/` is created at `product/node_modules/`.
3. `cd product && npm run lint` runs clean (no lintable source yet; exits 0).
4. `cd product && npm run typecheck` runs clean (no source yet; exits 0 via the `--if-present` workspace flag).
5. `cd product && npm run format` (Prettier) runs clean across any files Prettier can see; `--check` exits 0.
6. `cd product && npm run dev` starts, prints something informative, and doesn't crash (empty-workspace no-op).
7. `git status` shows only the new files; `.gitignore` excludes expected noise (`node_modules/`, `.DS_Store`, etc.).
8. `cat product/CLAUDE.md` reads as a coherent brief for a Claude Code agent entering `product/` cold.
9. Placeholder workspace directories exist as empty directories; workspace resolution from `product/package.json` doesn't choke on them.

---

## Handoff notes for the swarm coordinator

- **No other chunk's files change in this task.** Anything outside the files listed above is out of scope.
- **Do not populate any workspace packages.** A.t2 handles `ts-common`. A.t4 adds placeholder scaffolds to the other directories.
- **Do not set up GitHub Actions.** That's A.t3.
- **Do not create the `product/project_management_references/planning` symlink.** That's A.t5 (decision log + handover).
- If any decision from chunk A §5 looks wrong at implementation time (e.g. ESLint + Prettier is painful; npm workspaces has an unexpected issue), raise it as a PR against `planning/02-impl-foundations.md` *before* implementing an alternative. Plan-first, code-second.
- Commit structure: one commit per concern is fine (`chore: repo-root config`, `chore: product workspace root`, `chore: product CLAUDE.md`). Or one atomic scaffold commit. Either works.

---

## Tier 3 pattern notes (for this sample — not part of the execution plan)

This file is a calibration sample for Tier 3. Production-ready Tier 3s should:
- Be runnable by a Claude Code agent without needing to re-read Tier 1 or Tier 2 docs beyond the cited sections.
- Keep concrete file paths, real config shapes, and real verification commands.
- **Not** re-litigate Tier 2 decisions — cite them.
- Include explicit "do not do X in this task" guardrails to prevent scope creep.
- Stay under ~200 lines. If a task needs more, it's probably two tasks.
