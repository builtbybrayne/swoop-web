# 03 — Execution: A.t4 — Empty package scaffolds

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: A (foundations).
**Task**: t4 — empty downstream package scaffolds.
**Implements**: `planning/02-impl-foundations.md` §1 outcomes + §10 A.t4.
**Depends on**: A.t1 (workspace root), A.t2 (`ts-common` exists to import).
**Produces**: minimal `package.json` + `tsconfig.json` per placeholder downstream package. No source.
**Unblocks**: B, C, D's Tier 3 tasks — they have a real package to drop source into.
**Estimate**: 1–2 hours.

---

## Purpose

The downstream chunks (B, C, D, and a couple of utilities) each need a workspace package directory that resolves against `product/`'s npm workspace, imports `@swoop/common`, and builds under the shared TS config. A.t4 creates those shells. Nothing else.

---

## Deliverables

One directory per placeholder chunk, each with `package.json` + `tsconfig.json` + empty `src/` + `STREAM.md`.

### Packages scaffolded

| Directory | Package name | Role | Future owner |
|---|---|---|---|
| `product/orchestrator/` | `@swoop/orchestrator` | Cloud Run agent orchestrator. | Chunk B |
| `product/connector/` | `@swoop/connector` | Cloud Run data connector (MCP-over-HTTP). | Chunk C |
| `product/ui/` | `@swoop/ui` | React chat app. | Chunk D |
| `product/ingestion/` | `@swoop/ingestion` | Scraper or API-ingestion utility (Friday hackathon settles). | Chunk C |

Note: `product/cms/` is **not** a workspace package — it's content-as-data (markdown + JSON). No `package.json`, no `tsconfig.json`. A.t5 handles its directory creation + README.

### Per-package contents (each of the four)

**`package.json`**:
```
{
  "name": "@swoop/<slug>",
  "private": true,
  "main": "./src/index.ts",
  "dependencies": {
    "@swoop/common": "*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

Scripts expand as each chunk's Tier 3 lands (e.g. `dev`, `build`, `start`). At this stage, only `typecheck` exists.

**`tsconfig.json`**:

For Node-side packages (`orchestrator`, `connector`, `ingestion`):
```
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"]
}
```

For the bundler-side package (`ui`):
```
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

**`src/index.ts`** — a single empty export, just to make TypeScript happy:
```
export {};
```

**`STREAM.md`** — the per-package coordination doc (chunk A §2.6 + `planning/02-impl-foundations.md` §2.6). Initial content:
```
# Stream: <package-name>

**Status**: idle (scaffolded, awaiting chunk owner).
**Current task**: —
**Blockers**: —
**Interface changes proposed**: —
**Last updated**: <date>
```

---

## Key implementation notes

### 1. Workspace protocol

The `@swoop/common` dependency uses `"*"` for the version. npm workspaces resolve it to the workspace copy automatically; no `file:` reference or `workspace:*` protocol needed.

### 2. `tsconfig` extension

Each package's `tsconfig.json` extends `../tsconfig.base.json`. Per-package settings override `module`, `moduleResolution`, `jsx`, `lib`, `noEmit`, `outDir`, `rootDir`.

### 3. UI package nuance

`@swoop/ui` will later be a Vite app. In this task we just create the bare workspace package with React-compatible `tsconfig`. Vite-specific config (`vite.config.ts`, `index.html`, PostCSS, Tailwind) lands in chunk D's D.t1.

### 4. No dependencies beyond `@swoop/common`

Don't speculatively add `zod`, `express`, `react`, etc. Each chunk's Tier 3 adds what it actually needs. A.t4 is about scaffolding, not provisioning.

### 5. `product/cms/` is not here

It's content-as-data. No `package.json`. A.t5 creates the directory + README.

---

## References

- `chatgpt_poc/product/mcp-ts/package.json` — Node-side package reference.
- `chatgpt_poc/product/ui-react/package.json` — UI-side package reference.

---

## Verification

1. `cd product && npm install` — resolves all four placeholder packages + `@swoop/common`, no errors.
2. `cd product && npm run typecheck` — runs across workspaces, passes green (each package's empty `src/index.ts` typechecks fine).
3. Each package's `node_modules/@swoop/common` resolves to the workspace link (not a re-download).
4. From inside `product/orchestrator/src/`, a test file can `import { SampleTrip } from '@swoop/common/src/fixtures/trip.sample.ts'` (or equivalent import path — confirm during implementation) and Zod-validate it without path hacks.
5. `ls product/` shows: `ts-common/`, `orchestrator/`, `connector/`, `ui/`, `ingestion/`, `cms/` (directory only, no package), `scripts/`, `CLAUDE.md`, `package.json`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.prettierignore`.
6. Each `STREAM.md` exists and reads sensibly.

---

## Handoff notes

- **No source code.** A.t4 is strictly skeleton — each downstream chunk's Tier 3 adds source.
- **No runtime deps.** Dependencies are added as chunks need them.
- **No dev tooling per-package.** Shared configs at `product/` root do the work.
- If a downstream chunk's Tier 3 needs to rename a package, that's fine — rename is low cost at this stage.
- Do **not** create the `product/validation/` Python package here. That's chunk H's call; Tier 2 H recommended TypeScript, so Python may not happen at all.
