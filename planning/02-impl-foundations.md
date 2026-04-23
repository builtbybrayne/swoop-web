# 02 — Implementation: A. Foundations

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4A + the Phase 0 pre-work in §5.
**Depends on**: Nothing. Root of the dependency graph.
**Unblocks**: Every other chunk (B agent runtime, C retrieval, D chat surface, E handoff, F observability, G content, H validation).

---

## Purpose

A is the container. It produces the shared-types package, the dev loop, and the CI floor that every other chunk plugs into. It also defines (in stub form) the load-bearing contracts that cross chunk boundaries — the `ts-common` artefacts that B/C/D/E consume when they mock each other at boundaries during parallel fan-out.

This chunk deliberately does **not** finalise the contents of those contracts. The bodies firm up as the Phase 1 vertical slice progresses and real implementation meets real constraints. What A locks is the **locations** — where the handoff payload shape lives, where the streaming event shape lives, where tool I/O schemas live — so other chunks know which file to edit and the CI catches drift.

### Repo layout: project container vs code monorepo

Two layers, one git repo. The distinction is deliberate and load-bearing:

- **Project container** = `~/Studio/projects/swoop_web/` (the repo root). Holds **everything for the project** — process (planning, inbox, questions, eventual reporting / roadmap) and stuff (product code). No package manager lives here; nothing npm-aware is at the root.
- **Code monorepo** = `product/`. An npm workspace hosting the code deliverables as sibling packages (chat UI, agent runtime, data connector, data ingestion utility, shared types). This is what "monorepo" means in the standard software sense — multiple buildable/deployable packages sharing tooling via workspace links. Nothing planning- or process-related lives inside `product/`.

Deployments consume their own package's source root inside `product/` via CI config; no multi-repo split.

Terminology used below: **"the repo"** or **"the project"** means the root container; **"the monorepo"** or **"the workspace"** means `product/`.

---

## 1. Outcomes

When this chunk is done:

- `product/` scaffolded (empty packages, but real workspace wiring).
- `npm install` inside `product/` resolves the whole workspace with no errors.
- A single command (`cd product && npm run dev`) spins up whatever's been built so far; it no-ops gracefully when packages are empty.
- `ts-common` contains stub schemas for every cross-chunk contract. Stubs are real Zod schemas against which fixtures validate, even if their bodies are minimal.
- CI runs typecheck, lint, and build on every push to a branch and every PR. Green is the default state.
- Swarm branching strategy is decided and documented.
- `product/CLAUDE.md` exists and tells Claude Code execution agents how to work inside this repo (vs. the root `CLAUDE.md`, which is Cowork-level).
- A foundational decision log (`planning/decisions.md` or similar) exists where Tier 2/3 choices get recorded with dates and rationale.

**Not outcomes of this chunk**: real tool implementations, real UI, real deployment, real content. Those come from B/C/D/E/G.

---

## 2. Target functionalities

### 2.1 The code monorepo (inside `product/`)
An npm workspace rooted at `product/` hosting sibling packages — one per deployable (UI, agent runtime, data connector, etc.) plus the shared types package plus any utilities (scraper-or-api, future ETL helpers). Package names under a `@swoop/` scope (carrying forward PoC convention). Every package has its own `package.json`, `tsconfig.json`, and (where relevant) `.env.example`.

The repo root has **no** `package.json`. All workspace resolution, dev orchestration, and monorepo tooling live inside `product/`.

### 2.2 Shared types package (evolution of PoC `ts-common`)
One package holds everything that crosses chunk boundaries. The evolution from PoC:
- **Domain types** — from the PoC's `ships` / `cruises` / `activities` set to Patagonia's ontology. Known Patagonia additions from the 20 Apr meeting: **Tour** (specifically group tour — a first-class product type, not a variant of a trip; strategic priority per Luke); likely also **Region** (Torres del Paine prominent); **Accommodation** (lodges, dorms, camping). Full ontology firms up Friday 24 Apr at the data hackathon.
- Tool I/O schemas (Zod) — evolution of `chatgpt_poc/product/ts-common/src/tools.ts`.
- Streaming event shape — a new addition. Must satisfy **both** Google ADK's event stream (produced server-side) and assistant-ui's consumption model (expected client-side). The "Vercel AI SDK v5 `message.parts` shape" is the obvious candidate; confirm during Phase 0 that ADK events translate cleanly and assistant-ui accepts it.
- Handoff payload shape — triage-aware (qualified / referred_out / disqualified + reason), carrying visitor context.
- Session state shape — what the agent loop holds across turns.
- Fixtures — at least one concrete instance of every type, committed alongside the types so all chunks validate against the same examples.

### 2.3 Dev workflow
From inside `product/`, a single `npm run dev` starts every runnable package in watch mode. Packages that aren't runnable (like `ts-common`) join the same orchestration with `tsc --watch`. This follows the PoC's `concurrently` pattern — no new tooling unless we hit a concrete pain.

### 2.4 CI skeleton
Fast fail on type, lint, and build errors. Runs in < 3 minutes. Provider defaults to GitHub Actions; Cloud Build is alternative to consider for the Swoop handover narrative (they're a GCP shop), not a blocker. Test running is scaffolded but thin — Puma's real test surface is the Tier 2 H validation harness, not per-package unit tests.

Each deployable package has its own deploy pipeline that consumes its own source root (e.g. `product/orchestrator/` or `product/ui/`) — no multi-repo split.

### 2.5 Contract stubs
The `ts-common` package lands with stub schemas for every cross-chunk contract. Each stub is real enough to validate fixtures against but minimal in body. Other chunks import these stubs from day one. As they implement, they propose edits back to the stubs via PR — the CI catches downstream consumers that break.

### 2.6 Decision log
A running record of Tier 2 and Tier 3 decisions with date, rationale, and who decided. Prevents the re-litigation pattern of the archived docs. One-line-per-decision is fine.

### 2.7 Runtime targets
Cloud Run is the runtime target for every deployable in Puma — both persistent services (agent orchestrator, data connector) and any scheduled/batch jobs (scraper or API-ingest, if either lands). **Firebase Functions is not in scope** unless a concrete need emerges that Cloud Run + Cloud Scheduler can't serve; keeping the deployment surface uniform reduces complexity and avoids the Firebase Emulator yak-shave.

**Firebase Emulators are not used in Puma local dev.** For persistence during the Phase 1 vertical slice, use in-memory or file-backed adapters behind the `ts-common` session / handoff store interfaces. When real persistence becomes necessary (post-M4), connect to a real GCP dev Firestore (or whichever store gets picked in chunk B/E). This sidesteps emulator setup pain without compromising production fidelity — all the real integration happens against real GCP.

---

## 3. Architectural principles applied here

- **PoC-first**: carry forward the PoC's `ts-common/`, the package-per-chunk structure, `concurrently`-based dev orchestration, the per-package `.env.example` pattern, and the `product/CLAUDE.md` + root `CLAUDE.md` split. Only add new tooling where Puma's production bar demands it.
- **Content-as-data**: foundations chunk itself has no content; but the repo structure must reserve a `cms/`-style location at a level every runtime can load from. Don't lock it down here — chunk G settles the internal shape.
- **Swap-out surfaces named**: every tooling choice in this chunk (npm workspaces, ESLint, TypeScript version, GitHub Actions) gets annotated in the decision log with "swap cost: low/medium/high + what breaks."
- **Interface-first for cross-chunk work**: contracts that span multiple chunks land in `ts-common` on day 1 in stub form. Chunks mock each other at those boundaries.

---

## 4. PoC carry-forward pointers

Path-level only. Specific file contents get copied / adapted during Tier 3 execution, not specified here.

- `chatgpt_poc/product/ts-common/` — the existing shared-types package. Its `domain.ts`, `enrichment.ts`, `tools.ts`, `mcp.ts`, `widgets.ts` structure is the starting point; the evolution for Puma is named above (§2.2).
- `chatgpt_poc/product/package.json` — monorepo root pattern (`concurrently`-orchestrated dev watcher, per-package build scripts).
- `chatgpt_poc/product/mcp-ts/tsconfig.json` + `chatgpt_poc/product/ui-react/tsconfig.json` — the two flavours of TS config (Node servers vs bundler/React) that Puma packages also need.
- `chatgpt_poc/product/mcp-ts/.env.example` — the `.env.example`-per-package pattern.
- `chatgpt_poc/CLAUDE.md` + `chatgpt_poc/product/CLAUDE.md` — the pair that separates Cowork planning from Claude Code execution. Root `swoop_web/CLAUDE.md` already exists; `product/CLAUDE.md` doesn't yet.
- `chatgpt_poc/product/cms/` — the content-as-data pattern. Puma uses the same idea; contents shaped by chunk G.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| A.1 | Workspace tooling (inside `product/`) | **npm workspaces** | Closest to PoC (plain npm). Zero new vocabulary for Swoop's in-house team. No compelling Puma-scale reason to introduce pnpm / Turborepo / Nx. Revisit if build times become painful. |
| A.2 | Branching strategy for the swarm | **Trunk-based with per-stream `STREAM.md`** | Vertical-slice-first means a single agent on main until M1. Post-M1 fan-out to 2–4 parallel agents still doesn't need long-lived branches at this scale — each agent works on a named branch, PRs into main, CI catches interface drift within minutes. Worktrees are the escape hatch if parallel agents start trampling each other. |
| A.3 | Lint + format | **ESLint + Prettier** | PoC had none. Julie's production bar justifies adding them. ESLint + Prettier is the conservative choice; Swoop's in-house team is likely already familiar. Biome (faster, single tool) is the alternative if CI times later demand it — mark as low swap-cost. |
| A.4 | Node + TypeScript versions | **Node 20 LTS pinned via `.nvmrc`, TS 5.x pinned in root `package.json`** | Standard, boring. Matches PoC's de facto versions. |
| A.5 | CI provider | **GitHub Actions default; re-evaluate for Cloud Build at M4** | Lowest friction to start. Cloud Build is more "native" for the GCP handover story and worth switching to if the deploy pipeline starts to want it. Mark as medium swap-cost (CI workflow rewrite). |
| A.6 | Test-runner-at-foundation-level | **Scaffold Vitest; author no tests yet** | Real test surface is the Tier 2 H harness. A package-level runner exists so a future chunk (translator layer, classifier) can drop focused tests in when the failure mode is genuinely narrow. |
| A.7 | Runtime target | **Cloud Run for all deployables (services + jobs)** | Uniform deployment surface; avoids Firebase Functions scope + the Emulator yak-shave. Firebase Functions remains a future option if a concrete need appears. |
| A.8 | Local persistence during Phase 1 vertical slice | **In-memory / file-backed adapters behind `ts-common` interfaces** | Skips Firebase Emulator setup pain. Real GCP dev Firestore (or equivalent) gets wired when persistence genuinely matters (post-M4). |

Decisions deferred out of this chunk — they don't gate the foundation:

- Dockerfile strategy (chunk B or C decides when deployment becomes real)
- Secrets management production path (GCP Secret Manager is the default; wire at M4)
- Pre-commit hooks (opinionated — CI is source of truth; add if a concrete pain appears)

---

## 6. Shared contracts produced as stubs

These are the interface boundaries that cross multiple chunks. Each lands in `ts-common` as a stub schema + validated fixture. Other chunks consume them from the first day of the vertical slice.

| Contract | Primary consumer | Other consumers | Shape origin |
|---|---|---|---|
| Tool I/O schemas (per MCP tool) | Chunk C (connector) | B (orchestrator invokes), D (widgets render `structuredContent`), H (validation asserts trajectories) | Evolved from `chatgpt_poc/product/ts-common/src/tools.ts`. PoC's 7-tool set is the starting point; Puma may collapse / rename during Phase 1. |
| Streaming event shape | B (producer) + D (consumer) | F (observability reads) | Vercel AI SDK v5 `message.parts` is the candidate. Phase 0 task: confirm ADK event stream translates cleanly; confirm assistant-ui accepts unchanged. |
| Handoff payload | E | B (builds it), F (logs it), H (asserts on it) | Triage-aware — three-state verdict + reason + visitor context. No PoC equivalent (PoC was binary). |
| Session state shape | B | F (derives metrics), D (rehydrates on resume if in scope) | ADK's session primitives set the base; Puma adds wishlist-in-progress + triage state. |
| Event schema for observability | F | B, C, D, E (all emit events) | New. Authored so BigQuery (or whatever analytics tool Swoop prefers — see `questions.md`) export is possible later without rework. |

**Authoring responsibility**: Al drafts the initial stub; Phase 1 vertical-slice agent validates by using it in real code. Changes to a stub go through a PR that updates the stub, the fixtures, and any consuming chunks in the same commit. CI catches drift.

---

## 7. Open sub-questions for Tier 3

These are the things the execution plan for chunk A closes — too fiddly for Tier 2:

- Exact `tsconfig` base shape (what to hoist to `tsconfig.base.json`, what each package overrides).
- Project-references vs. workspace-only type resolution.
- `concurrently`-based `dev.sh` exact shape.
- GitHub Actions workflow file exact steps and caching.
- Decision-log file format and location (`planning/decisions.md` leaning).
- Where `cms/`-style content actually lives in the package tree.

---

## 8. Dependencies + coordination

- **Inbound**: none beyond Al's time.
- **Outbound**: every other chunk. As soon as the stubs in §6 land, B/C/D/E can start mocking each other at boundaries. Content chunk G starts in parallel with no wait.
- **Agent coordination**: A is a single-agent chunk. No parallelism benefit; the payoff is downstream.

---

## 9. Verification

Chunk A is done when:

1. `git clone && nvm use && cd product && npm install` succeeds clean on a fresh machine.
2. From `product/`, `npm run dev` starts cleanly and the watchers idle green (no errors, even if there's nothing to build).
3. From `product/`, `npm run typecheck && npm run lint && npm run build` all pass green.
4. CI runs on a throwaway PR, hits all the same checks, passes in < 3 minutes.
5. `ts-common` exports validated fixtures for every stub contract; `tsc` + Zod round-trips without errors.
6. `product/CLAUDE.md` exists and reads cleanly (sets up the Claude Code execution context distinct from the root `CLAUDE.md`).
7. Decision log exists and records A.1–A.6 with dates.
8. An empty downstream package (e.g. `product/orchestrator` or `product/connector` as a stub) can import from `@swoop/common` via the workspace link without path hacks.

No deployed service, no live data, no running agent, no real widgets. This chunk is the launchpad, not the launch.

---

## 10. Order of execution (Tier 3 hand-off)

When Tier 3 execution plans are produced for this chunk, the natural split is:

- [x] **A.t1 — Repo scaffold**: `.nvmrc`, `.gitignore`, `.editorconfig` at repo root; `product/package.json` + workspaces, `product/tsconfig.base.json`, `product/.eslintrc`, `product/.prettierrc`, `product/scripts/dev.sh`, `product/CLAUDE.md`.
- [x] **A.t2 — `ts-common` package**: package skeleton, evolved structure, stub schemas for the contracts in §6, fixtures, exports. Lives at `product/ts-common/`.
- [x] **A.t3 — CI skeleton**: GitHub Actions workflow(s) at `.github/workflows/`, scoped to `product/` paths, caching, PR check.
- [x] **A.t4 — Empty package scaffolds**: one placeholder directory per downstream chunk under `product/` (orchestrator, connector, chat-ui, scraper-or-api, cms) with minimal `package.json` + `tsconfig.json` so the workspace resolves. No source.
- [x] **A.t5 — Decision log + handover note**: `planning/decisions.md` with A.1–A.8 (+A.9 scope normalisation); a short "how to pick up this repo" note for downstream agents.

A.t1–A.t5 are sequential (each builds on the previous). Estimated: 0.5–1 day of focused work for a single agent. **Chunk A closed 2026-04-22.**
