# 06 — Repo Structure

**Status**: Draft, v2 (prototype + augmentations).
**Purpose**: Canonical repo layout, tooling choices, dev ergonomics, build / CI shape. The document Claude Code agents consult when placing files or setting up scaffolding.
**Depends on**: `01-architecture.md` §11 (summary layout), `05-workstreams.md` §13 (branching), `02-data-access.md` (data-connector package), `07-validation-harness.md` (Python eval sub-tree).

**House rule**: **carry forward the PoC's package topology and tooling choices as the starting point**; add new packages and only introduce new tooling where V1 genuinely needs it.

---

## 0. PoC baseline (what we carry forward)

Reference: `~/studio/projects/swoop/product/` (PoC root), mirrored at `swoop_web/chatgpt_poc/product/` in this repo.

| Aspect | PoC choice | V1 stance |
|---|---|---|
| Monorepo tool | **Plain npm**, root `package.json` orchestrates with `cd package && npm run ...` scripts | **Keep plain npm**, but move to **npm workspaces** (see §3) |
| Cross-package linking | `"@swoop/common": "file:../ts-common"` | Replace with workspace protocol |
| Package naming | `@swoop/common`, `@swoop/mcp-server`, `@swoop/widgets` | Keep `@swoop/` scope; rename per §1.1 |
| TS config | Per-package `tsconfig.json`, no root base. `target: ES2022`, `strict: true`, `isolatedModules: true`. `module: Node16` for servers, `ESNext`/`bundler` for React | **Add** `tsconfig.base.json` + project references; keep the split between Node and bundler configs |
| Dev orchestration | Root script: `concurrently -n common,mcp,widgets` running three watchers | Same pattern, extended to new services |
| Build | Sequential `tsc` per package, then Vite per widget | Same, plus new service builds |
| React UI build | Vite + `vite-plugin-singlefile` — one env-flag-driven build per widget | Unchanged for any re-used widgets; new chat-shell UI is a standard Vite SPA build |
| Lint / format | **None** (no ESLint / Prettier / Biome config in PoC) | **Add** ESLint + Prettier for V1 (Julie's "real users / production" bar) |
| Tests | **No unit tests.** `test-prompts/test-suite.json` = manual prompt scenarios | Evolve the same pattern into Stream 7's evalset JSON; add narrow unit tests only where fixtures make sense |
| Env vars | `.env.example` + `.env` **per package** (e.g. `mcp-ts/.env`, `scripts/.env`) | Keep per-package `.env`; add new packages' env surfaces |
| CMS | `cms/` at `product/` root. JSON + MD only. Loaded at runtime by mcp-ts | **Unchanged principle**, extended content set |
| CLAUDE.md pair | Root `CLAUDE.md` (project planning) + `product/CLAUDE.md` (Claude Code execution) | Keep the pair |
| Symlinks | `product/project_management_references/planning -> ../../planning` | Keep |
| Node version | Not pinned in PoC (no `.nvmrc`) | **Pin** Node 20 LTS via `.nvmrc` + `packageManager` field |

---

## 1. Top-level layout

**Repo location**: `~/studio/projects/swoop_web/` — bootstrapped fresh, per the swoop skill. PoC (`~/studio/projects/swoop/`) stays untouched as reference.

```
swoop_web/
├── CLAUDE.md                        # Project-root planning context (Cowork)
├── README.md
├── .gitignore
├── .nvmrc                           # Node 20 LTS
├── package.json                     # Monorepo root, npm workspaces (see §3)
├── tsconfig.base.json               # Shared compilerOptions; each package extends
├── .eslintrc.cjs                    # Root ESLint config (see §5)
├── .prettierrc                      # Root Prettier config
├── .github/
│   └── workflows/
│       ├── ci.yml                   # PR + main checks
│       └── deploy.yml               # Cloud Run deploy (post-M4)
│
├── planning/                        # This folder
│
├── scripts/                         # Root-level dev / deploy helpers
│   ├── dev.sh                       # concurrently wrapper
│   └── deploy.sh
│
├── chatgpt_poc/                     # Read-only reference copy of Phase 1 (optional)
│
└── product/
    ├── CLAUDE.md                    # Claude Code execution context
    │
    ├── ts-common/                   # Shared types / schemas (Stream 0) — PoC name retained
    │   ├── src/
    │   │   ├── domain.ts            # Trip, Story, Image, Handoff (carried from PoC + Patagonia extensions)
    │   │   ├── enrichment.ts        # Readiness x Warmth model (from PoC)
    │   │   ├── tools.ts             # Tool schemas + descriptions (evolved from PoC)
    │   │   ├── mcp.ts               # MCP / connector message shapes
    │   │   ├── parts.ts             # NEW: AI SDK v5 message.parts types
    │   │   ├── session.ts           # NEW: session state shape
    │   │   ├── handoff.ts           # NEW: handoff persistence shape (see 03-handoff-schema.md)
    │   │   ├── fixtures/            # NEW: shared example records (Trip, Story, Handoff)
    │   │   └── index.ts
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── STREAM.md
    │
    ├── orchestrator/                # ADK Cloud Run service (Stream 1) — NEW
    │   ├── src/
    │   │   ├── agent/               # ADK agent graph
    │   │   ├── classifier/          # HOW-layer stance classifier
    │   │   ├── translator/          # ADK events → message.parts
    │   │   ├── session/             # Session adapters (memory / Firestore)
    │   │   ├── server/              # SSE endpoint, HTTP handlers
    │   │   └── index.ts
    │   ├── test/
    │   │   └── fixtures/            # Recorded ADK event streams
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── Dockerfile
    │   ├── .env.example
    │   └── STREAM.md
    │
    ├── mcp-connector/               # Data-access Cloud Run service (Stream 2)
    │   │                            # Renamed from PoC's `mcp-ts`. Same scope, extended to Vertex Search.
    │   ├── src/
    │   │   ├── tools/               # One file per tool (carried from PoC; extended set)
    │   │   │   ├── get-conversation-guidance.ts   # from PoC
    │   │   │   ├── get-library-data.ts            # from PoC
    │   │   │   ├── search-trips.ts                # NEW (Vertex)
    │   │   │   ├── search-stories.ts              # NEW (Vertex)
    │   │   │   ├── illustrate.ts                  # from PoC
    │   │   │   ├── handoff.ts                     # from PoC
    │   │   │   └── handoff-submit.ts              # from PoC
    │   │   ├── lib/                 # from PoC: data-loader, component-search, embeddings, image-search, mailer
    │   │   ├── search/              # NEW: Vertex Search adapter (+ Weaviate fallback stub)
    │   │   ├── resources/           # MCP widget resource handlers (from PoC) — may be retired if not reused
    │   │   ├── server.ts            # Express + transport
    │   │   └── index.ts
    │   ├── test/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── Dockerfile
    │   ├── .env.example
    │   └── STREAM.md
    │
    ├── ui-react/                    # React chat UI (Stream 3) — PoC name retained
    │   │                            # Major rewrite: PoC built 4 single-file widget bundles for ChatGPT's iframe;
    │   │                            # V1 is a single Vite SPA (assistant-ui shell) embedded as our own iframe.
    │   │                            # Any reused widgets (ship cards, detail view, handoff form) live under src/widgets/.
    │   ├── src/
    │   │   ├── main.tsx             # App entry
    │   │   ├── App.tsx
    │   │   ├── chat/                # assistant-ui shell
    │   │   ├── tools/               # makeAssistantToolUI registrations
    │   │   ├── widgets/             # Reused/ported widget components (from PoC ui-react/src/widgets)
    │   │   ├── disclosure/          # EU AI Act / GDPR UI (see 04-legal-compliance.md)
    │   │   └── shared/              # SwoopBranding, theme.css, hooks — carried from PoC
    │   ├── public/
    │   ├── test/
    │   ├── index.html
    │   ├── vite.config.ts           # Simplified vs PoC: single SPA build, no WIDGET env flag
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example             # VITE_ORCHESTRATOR_URL etc.
    │   └── STREAM.md
    │
    ├── scraper/                     # ETL utility (Stream 4) — NEW
    │   │                            # Replaces / supersedes PoC's `scripts/` package (which built library/images
    │   │                            # from MongoDB exports). V1 scrapes the live website instead.
    │   ├── src/
    │   │   ├── fetch/               # HTTP + optional headless browser
    │   │   ├── extract/             # Claude-based extraction
    │   │   ├── normalise/           # Schema coercion (Zod) against ts-common types
    │   │   ├── persist/             # Cloud Storage writer
    │   │   ├── ingest/              # Cloud Storage → Vertex Search
    │   │   └── cli.ts
    │   ├── prompts/                 # Extraction prompts (markdown)
    │   ├── test/
    │   │   └── fixtures/            # Sample HTML + expected JSON
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example
    │   └── STREAM.md
    │
    ├── cms/                         # Structured content (Stream 5) — PoC location retained
    │   │                            # JSON + MD only. Loaded at runtime by orchestrator + mcp-connector.
    │   │                            # Eventually a real CMS maintained by Swoop's sales staff.
    │   ├── prompts/
    │   │   ├── why.md               # Static system prompt (01-architecture.md §2.1)
    │   │   └── how/                 # Stance fragments
    │   │       ├── discovery-stance.md
    │   │       ├── convergence-stance.md
    │   │       ├── triage-stance.md
    │   │       ├── qualification-stance.md
    │   │       └── sensitive-stance.md
    │   ├── templates/
    │   │   └── handoff-email.md
    │   ├── guidance-payload.json    # Carried from PoC (evolved)
    │   ├── library-data.json        # Carried from PoC (Antarctica) + new Patagonia equivalents
    │   ├── image-catalogue.json     # Carried from PoC
    │   ├── image-annotations.json   # Carried from PoC
    │   ├── legal/                   # Stream 6 content
    │   │   ├── disclosures/
    │   │   └── runbooks/
    │   ├── PROMPT_ENGINEERING.md    # Carried from PoC
    │   └── README.md
    │
    ├── validation/                  # Python eval sidecar (Stream 7) — NEW
    │   │                            # See 07-validation-harness.md §14 for full layout.
    │   │                            # Python sub-tree — NOT a workspace package. Separate tooling island.
    │   ├── pyproject.toml
    │   ├── conftest.py
    │   ├── tests/
    │   ├── cases/                   # Evalset JSON (evolves PoC's test-prompts/test-suite.json pattern)
    │   ├── rubrics/
    │   ├── calibration/
    │   └── STREAM.md
    │
    ├── execution_plans/             # Claude Code execution plans per milestone
    │   ├── M1-hello-world.md
    │   └── ...
    │
    └── project_management_references/
        └── planning -> ../../planning   # Read-only symlink (PoC convention)
```

### 1.1 Renames from PoC → V1

| PoC | V1 | Why |
|---|---|---|
| `mcp-ts/` | `mcp-connector/` | Reflects its role as the data-access connector in a two-service setup. It may still speak MCP, but the name shouldn't lock us in. |
| `@swoop/mcp-server` (package name) | `@swoop/mcp-connector` | Match the directory. |
| `@swoop/widgets` (package name) | `@swoop/ui-react` | Directory name retained; package name tracks it. V1 isn't primarily "widgets" anymore. |
| `@swoop/common` | `@swoop/common` | Unchanged — stable name, semantic fit. Directory `ts-common/` unchanged. |
| `scripts/` (data pipeline) | `scraper/` | Different scope: PoC transformed MongoDB exports; V1 scrapes the website. Old `scripts/` package is retired. Root-level `scripts/` (dev helpers only, not a package) remains. |

### 1.2 New packages (not in PoC)

- `orchestrator/` — ADK Cloud Run service. The most net-new thing.
- `scraper/` — ETL utility, Cloud Run Job.
- `validation/` — Python eval harness (non-JS sub-tree).

---

## 2. Design rules

### 2.1 Packages, not modules (carried from PoC)

Each stream is an independent TS package with its own `package.json`, `tsconfig.json`, build output. Consumes `ts-common` via workspace link. Benefits:

- Independent builds; CI can skip unchanged packages
- Clear dependency boundaries; enforced by TS project refs
- Each deploys independently (two Cloud Run services, scraper Cloud Run Job)

### 2.2 `ts-common` is the only cross-package source (carried from PoC)

No direct imports between streams. All cross-stream contracts go through `ts-common`. If a contract needs to change, that's a deliberate coordinated change (see `05-workstreams.md` §14).

### 2.3 CMS content is data, not code (carried from PoC — firmly)

- Prompts, fragments, templates, library data, images all live in `cms/` as markdown or JSON.
- Code loads them at runtime.
- This was a firm Phase 1 decision. It's a placeholder for what will eventually be a rich CMS maintained by Swoop's sales staff. **No inlining content in TS.**
- Content changes don't require code deploys in principle (Cloud Run image boundary complicates this; plan for hot reload or fast deploy).

### 2.4 `STREAM.md` per package (augmentation over PoC)

PoC did not have `STREAM.md` — V1 adds it because we're parallelising Claude Code agents across streams. Every package root has a `STREAM.md`:

```markdown
# Stream: <name>

**Status**: active | blocked | done
**Current task**: <description>
**Blockers**:
- <blocker 1>
**Interface changes proposed**:
- <proposal, affected consumers>
**Last updated**: <date>
```

Claude Code agents update it at start/end of each work session. Cheap coordination artefact.

### 2.5 Python sub-tree is a separate island

`product/validation/` is Python (see `07-validation-harness.md` §3). It's **not** a workspace package, **not** installed by `npm install`, **not** built by `npm run build`. It has its own `pyproject.toml` and runs from its own venv. `ts-common` schemas are consumed via HTTP (black-box) or via generated JSON schemas — never by importing TS.

**Decision to confirm in 07**: whether `validation/` sits inside `product/` (treated as a sibling package with its own tooling) or moves to a top-level `validation/` to underscore the separation. Current default: inside `product/`.

---

## 3. Monorepo tooling

**PoC used**: plain npm with root scripts that `cd` into each package and run `npm install` / `npm run build`. Cross-package linking via `"file:../ts-common"`. `concurrently` for dev watchers.

**V1 default**: **npm workspaces**. Rationale:

- Closest to PoC (no new package manager to learn / onboard Swoop's team to)
- Eliminates the `file:` reference and the `install:all` cascade script
- Single `npm install` at root resolves everything
- No Turborepo / Nx — unnecessary at this scale; PoC shipped without it

**Not chosen**: pnpm, Turborepo, Nx. Revisit only if build times become painful (unlikely).

### 3.1 Root `package.json` shape

```json
{
  "name": "swoop-web",
  "private": true,
  "workspaces": [
    "product/ts-common",
    "product/orchestrator",
    "product/mcp-connector",
    "product/ui-react",
    "product/scraper"
  ],
  "packageManager": "npm@10.x",
  "scripts": {
    "build": "npm run build -ws --if-present",
    "typecheck": "npm run typecheck -ws --if-present",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "npm run test -ws --if-present",
    "dev": "bash scripts/dev.sh"
  },
  "devDependencies": {
    "concurrently": "^9.1.0",
    "typescript": "^5.7.0",
    "eslint": "...",
    "prettier": "..."
  }
}
```

Root `scripts/dev.sh` reproduces the PoC's `concurrently` watcher pattern, extended to the new services:

```bash
npm run build -w @swoop/common   # prime ts-common so others resolve types
concurrently \
  -n common,orch,mcp,ui \
  -c blue,cyan,green,magenta \
  "npm run dev -w @swoop/common" \
  "npm run dev -w @swoop/orchestrator" \
  "npm run dev -w @swoop/mcp-connector" \
  "npm run dev -w @swoop/ui-react"
```

Scraper runs on demand, not part of `dev`.

### 3.2 Per-package scripts (consistent shape — PoC pattern, extended)

```
build      — tsc (or vite build for ui-react)
dev        — tsx watch / tsc --watch / vite
typecheck  — tsc --noEmit
test       — (per package; may be empty for some)
start      — node dist/index.js (servers only)
```

---

## 4. TypeScript config

PoC had no root `tsconfig.base.json` — each package duplicated compiler options. V1 consolidates into a base + project references.

### 4.1 `tsconfig.base.json` (root)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

Each package extends with its own `module`, `moduleResolution`, `outDir`, `rootDir`, `lib`, `jsx`:

- **`ts-common`, `orchestrator`, `mcp-connector`, `scraper`** → `module: Node16`, `moduleResolution: Node16`, `lib: [ES2022]` (match PoC's mcp-ts config).
- **`ui-react`** → `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `lib: [ES2022, DOM, DOM.Iterable]`, `noEmit: true` (match PoC's ui-react config).

### 4.2 Project references

Each package declares `references: [{ "path": "../ts-common" }]` where applicable. Unlocks incremental builds and cross-package type checking.

### 4.3 Strict rules

- `strict: true` everywhere (as per PoC).
- `any` requires an inline comment explaining why. Enforced via ESLint (§5).
- No `@ts-ignore` without a comment + issue link.

---

## 5. Linting & formatting

**PoC had none.** Reasonable for a 10-day demo, but Julie's "not a PoC, real users, production" bar means we add it for V1.

**Chosen**: **ESLint + Prettier**.

- Widely understood, Swoop's in-house team likely familiar
- Rich TypeScript + React plugin ecosystem
- Compatible with editors / CI with zero friction

Biome was considered (fast, single tool) but ESLint is the conservative choice given handover to Swoop. Revisit if boot/CI times demand it.

**Config shape**:
- Root `.eslintrc.cjs` extends `@typescript-eslint/recommended` + `react-hooks` (for ui-react) + `prettier` (disable stylistic rules).
- Root `.prettierrc` with project conventions (2-space indent, single quotes, trailing commas — match PoC's de facto style).
- Enforced by CI (§9). Pre-commit hook optional — CI is source of truth.

---

## 6. Testing

### 6.1 Philosophy (PoC precedent)

PoC's `product/README.md` is explicit: *"No unit tests. This is a demo prototype. Testing is manual, via ChatGPT."* And: *"`test-prompts/test-suite.json` contains structured test scenarios."*

V1 evolves this pragmatically. Per `07-validation-harness.md`, end-to-end correctness is covered by the Python eval sidecar — the direct descendant of `test-prompts/test-suite.json`. Unit tests exist only where fixtures make them cheap and the failure mode is narrow.

### 6.2 Runners

- **TS unit / integration**: Vitest (where used). Not in PoC, but lightweight to add.
- **Agent-level correctness**: Python sidecar (`product/validation/`) — see Stream 7.
- **UI**: React Testing Library under Vitest for component-level logic only. No deep UI interaction tests.

### 6.3 Where tests are worth writing

- Translator layer (recorded ADK event fixtures → expected message.parts)
- Zod schema validators (against realistic fixtures in `ts-common/src/fixtures/`)
- Connector tool endpoints (fixture-driven, contract tests)
- Scraper extraction per page type (sample HTML → expected JSON)
- Classifier stance selection (conversation fixtures → expected stance)

### 6.4 Where not

- Trivial getters / setters
- Third-party library behaviour
- Deep UI interaction (Stream 7 harness + manual review covers)

### 6.5 Shared fixtures

Live in `ts-common/src/fixtures/` so all TS streams consume the same examples. Changes to fixtures are coordinated like schema changes (see `05-workstreams.md` §14). The Python harness consumes equivalent evalsets under `validation/cases/`.

---

## 7. Environment variables

### 7.1 Principles (PoC pattern, carried)

- Per-package `.env.example` committed, no secrets — as PoC already does (`mcp-ts/.env.example`, `scripts/.env.example`).
- `.env` and `.env.local` gitignored, loaded per package.
- Production: GCP Secret Manager, injected via Cloud Run env config.
- Never log env var values.

### 7.2 Minimum surface per package

**`orchestrator/.env.example`**
```
# Model config
ANTHROPIC_API_KEY=
ADK_MODEL_PROVIDER=anthropic
ADK_CLASSIFIER_MODEL=gemini-flash
VERTEX_PROJECT_ID=
VERTEX_LOCATION=us-central1

# Downstream
MCP_CONNECTOR_URL=http://localhost:3001

# Session
SESSION_BACKEND=memory
FIRESTORE_PROJECT_ID=

# CMS paths
WHY_PROMPT_PATH=../cms/prompts/why.md
HOW_FRAGMENTS_DIR=../cms/prompts/how
GUIDANCE_PAYLOAD_PATH=../cms/guidance-payload.json

PORT=8080
```

**`mcp-connector/.env.example`** (extends PoC's file)
```
# Search backend
VERTEX_PROJECT_ID=
VERTEX_LOCATION=us-central1
VERTEX_TRIPS_INDEX=
VERTEX_STORIES_INDEX=

# Storage
CLOUD_STORAGE_BUCKET=

# Handoff email (from PoC)
SMTP_USER=yourname@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
LEAD_EMAIL_TO=sales@swoop-adventures.com

PORT=3001
```

**`ui-react/.env.example`**
```
VITE_ORCHESTRATOR_URL=http://localhost:8080
```

**`scraper/.env.example`**
```
ANTHROPIC_API_KEY=
SCRAPE_BASE_URL=https://www.swoop-patagonia.com
SCRAPE_OUTPUT_BUCKET=
SCRAPE_CONCURRENCY=3
```

---

## 8. Local dev runbook

### 8.1 First-time setup

```bash
git clone <repo> swoop_web
cd swoop_web
nvm use                       # pick up .nvmrc
npm install                   # workspaces resolves everything in one go
for d in product/*/; do
  [ -f "$d/.env.example" ] && cp "$d/.env.example" "$d/.env"
done
npm run build -w @swoop/common   # prime ts-common
```

### 8.2 Running everything

```bash
npm run dev
```

Starts (via `scripts/dev.sh` + `concurrently`):
- `@swoop/common` — `tsc --watch`
- `@swoop/orchestrator` — `tsx watch` on `:8080`
- `@swoop/mcp-connector` — `tsx watch` on `:3001`
- `@swoop/ui-react` — Vite dev server on `:5173`

Scraper runs on demand:
```bash
npm run start -w @swoop/scraper -- --urls seed-urls.txt --out out/
```

Python validation harness (separate venv):
```bash
cd product/validation
python -m venv .venv && source .venv/bin/activate
pip install -e .
pytest tests/
```

### 8.3 Running individual services

```bash
npm run dev -w @swoop/orchestrator
npm run dev -w @swoop/mcp-connector
npm run dev -w @swoop/ui-react
```

---

## 9. CI

### 9.1 Provider — open

**Default**: GitHub Actions (ubiquitous, low setup cost, fine for V1).

**Alternative**: Cloud Build — arguably more natural given the GCP narrative and Swoop's handover. Worth considering if Swoop's team already uses it. **Decide before M4**.

### 9.2 PR workflow (`ci.yml` — shape, not spec)

Runs on every PR and push to `main`:

- Checkout + `nvm` setup
- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- Validation harness smoke subset (Stream 7) — fast cases only, < 2 min

Fails fast; no deploy.

### 9.3 Deploy workflow (`deploy.yml`)

Runs on push to `main` post-M4:

- Build Docker images for `orchestrator` and `mcp-connector`
- Push to GCP Artifact Registry
- Deploy to Cloud Run (dev → staging → prod as envs firm up)
- Smoke test deployed endpoints

### 9.4 Pinning

- Node via `.nvmrc`
- npm via `packageManager` field
- GCP region pinned in deploy config

---

## 10. Secrets management

### 10.1 Local dev

Per-package `.env` files (PoC pattern), not committed. Each developer / agent has their own.

### 10.2 Production

GCP Secret Manager, referenced by Cloud Run env var injection:

```yaml
env:
  - name: ANTHROPIC_API_KEY
    valueFrom:
      secretKeyRef:
        name: anthropic-api-key
        key: latest
```

Rotation: Swoop's responsibility post-handover. We document recommended cadence in the runbook (`cms/legal/runbooks/`).

---

## 11. Symlinks for AI context (PoC convention)

As in Phase 1, `product/project_management_references/planning -> ../../planning` gives Claude Code agents read-only access to planning docs from inside the product tree. Keeps `product/CLAUDE.md` lean; agents reference planning on demand.

---

## 12. Handoff artefacts for Swoop

When we hand over to Swoop's team (post-M5):

- **Runbook** (`product/cms/legal/runbooks/` — starts with data deletion runbook; grows)
- **Architecture overview** (`01-architecture.md` extracted + simplified)
- **Operations guide** (deploy / scale / monitor)
- **Ingestion operations** (run the scraper + ingestion)
- **Prompt editing guide** (edit WHY/HOW without breaking the system)
- **Troubleshooting guide**

Out of V1 planning; revisit closer to M5.

---

## 13. Status of decisions

| # | Decision | State | Leaning |
|---|---|---|---|
| 1 | Monorepo tool | **Settled** | npm workspaces (evolves PoC's plain npm) |
| 2 | Package manager | **Settled** | npm (PoC baseline) |
| 3 | TS base config | **Settled** | Root `tsconfig.base.json` + project refs |
| 4 | Lint + format | **Leaning** | ESLint + Prettier (PoC had none) |
| 5 | Test runner (TS) | **Leaning** | Vitest where used |
| 6 | Agent eval runner | **Settled** (in 07) | Python ADK AgentEvaluator + pytest |
| 7 | `validation/` location | **Open** | Default: inside `product/` |
| 8 | CI provider | **Open** | Default: GitHub Actions; revisit Cloud Build |
| 9 | Dockerfile strategy | **Leaning** | One per service (simpler) |
| 10 | Local dev: Compose vs raw | **Leaning** | Raw `concurrently` (PoC pattern) |
| 11 | Pre-commit hook | **Open** | Default: none, CI is source of truth |
| 12 | Root `CLAUDE.md` + `product/CLAUDE.md` split | **Settled** | Carried from PoC |
| 13 | `STREAM.md` per package | **Settled** | Augmentation over PoC |

---

## 14. Kickoff checklist (echoes `05-workstreams.md` §16)

Before any Claude Code execution plan is generated:

- [ ] Repo bootstrapped at `~/studio/projects/swoop_web/` with root `package.json` (workspaces), `tsconfig.base.json`, `.nvmrc`, ESLint + Prettier config
- [ ] `ts-common/` skeleton committed (carries forward PoC `domain.ts`, `enrichment.ts`, `tools.ts` as starting point)
- [ ] `cms/` skeleton committed (carries forward PoC `guidance-payload.json`, `library-data.json`, images; adds `prompts/why.md` + `prompts/how/` placeholders)
- [ ] Node / TypeScript / ADK versions pinned
- [ ] Per-package `.env.example` files created
- [ ] `scripts/dev.sh` written
- [ ] CI config skeleton in place
- [ ] Branching strategy decision made (`05-workstreams.md` §13)
