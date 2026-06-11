# Tech Review Preflight — Swoop Web Discovery (Puma)
**Generated**: 2026-04-30 by main-thread orchestrator before council dispatch.
**Purpose**: deterministic facts every council subagent reads before doing any work.

## Repo state

- Branch: `main` (worktree `claude/objective-mendeleev-eec679` is currently merged, both at `48fc6fe`)
- Project root: `/Users/al/Studio/projects/swoop_web/.claude/worktrees/objective-mendeleev-eec679`
- Code root: `product/` (npm workspaces monorepo)
- Tests passing: 416/416 across 6 workspaces (verified `npm test --workspace=...`)
- Typecheck: clean across all 6 workspaces

## Workspace inventory

| Workspace | LOC | Files | Test files | Test cases | External deps |
|---|---|---|---|---|---|
| `@swoop/common` (`ts-common/`) | 3,468 | 31 | 3 | 62 | zod |
| `@swoop/orchestrator` | 9,158 | 48 | 13 | 132 | @anthropic-ai/sdk, @google/adk, @modelcontextprotocol/sdk, @swoop/common, @swoop/connector, dotenv, express, zod |
| `@swoop/connector` | 1,487 | 9 | 4 | 46 | @swoop/common, nodemailer, zod |
| `@swoop/ui` | 6,017 | 46 | 12 | 71 | @ai-sdk/react, @assistant-ui/react, @assistant-ui/react-ai-sdk, @swoop/common, ai, react, react-dom, react-markdown, remark-gfm, zod |
| `@swoop/harness` | 3,034 | 12 | 4 | 74 | @swoop/common, yaml, zod |
| `@swoop/ingestion` | 1,436 | 3 | 1 | 31 | @swoop/common, zod |

## Cross-workspace import graph

```
ts-common    →   (no @swoop/* imports — single source of contracts)
orchestrator →   common (32 files), connector (4 files)
connector    →   common (8 files), self (1 — relative import)
ui           →   common (16 files)
harness      →   common (4 files)
ingestion    →   (no @swoop/* imports)
```

All consumers depend on `@swoop/common`. `@swoop/connector` is imported only by `@swoop/orchestrator` (4 sites).

## Public surface (barrel exports)

- `ts-common/src/index.ts`: re-exports `domain`, `derived`, `tools`, `streaming`, `session`, `handoff`, `events`, `emit-event`. Fixtures via `@swoop/common/fixtures` subpath.
- `connector/src/index.ts`: 4 named exports — `sendHandoffEmail` + types, `renderTemplate`, `FsHandoffStore` + types, `submitHandoff` + types. Today only handoff side-effects; data tools land in chunk C.
- `orchestrator/src/index.ts`: 236 lines, no exports — application entrypoint. Loads dotenv with `override: true`, builds prompt loader → connector → agent → triage classifier → session store → InMemoryRunner → warm pool → handoff store + mailer config → server → listen.
- `ui/src/index.ts`: empty placeholder; UI is a Vite SPA.
- `harness/src/index.ts`: not present (CLI under `cli.ts`).
- `ingestion/src/index.ts`: empty.

## HTTP route inventory (orchestrator)

| Method | Path | Handler |
|---|---|---|
| GET | `/healthz` | inline |
| POST | `/session` | `createSessionBootstrapHandler` |
| PATCH | `/session/:id/consent` | `createConsentHandler` |
| DELETE | `/session/:id` | `createSessionDeleteHandler` |
| GET | `/session/:id/ping` | `createSessionPingHandler` |
| POST | `/chat` | `createChatHandler` |
| POST | `/handoff/submit` | `createHandoffSubmitHandler` (only when handoffStore + mailerConfig present) |

## Top 25 largest files (LOC)

```
753 ingestion/src/blog/fetch.ts
682 ingestion/src/blog/__tests__/fetch.test.ts
665 harness/src/__tests__/assertions.test.ts
660 ui/src/runtime/orchestrator-adapter.ts          ← AI SDK ↔ orchestrator SSE bridge
539 orchestrator/src/agent/claude-llm.ts            ← ADK BaseLlm shim for Claude
525 harness/src/assertions.ts
512 orchestrator/src/server/chat.ts                  ← /chat SSE handler
430 ts-common/src/tools.ts
427 ui/src/session/__tests__/preflight.test.ts
420 orchestrator/src/functional-agents/triage-classifier.ts
420 orchestrator/src/__tests__/integration/hello-world.test.ts
418 orchestrator/src/session/__tests__/warm-pool.test.ts
411 orchestrator/src/session/warm-pool.ts
394 ui/src/widgets/lead-capture.tsx
353 ts-common/src/handoff.ts
337 orchestrator/src/server/__tests__/handoff-submit.test.ts
325 ts-common/src/events.ts
324 orchestrator/src/server/__tests__/server.test.ts
322 orchestrator/src/server/handoff-submit.ts
313 harness/src/scenario.ts
309 ui/src/disclosure/use-consent.ts
309 harness/src/orchestrator-client.ts
306 connector/src/handoff/__tests__/submit.test.ts
305 orchestrator/src/connector/tools.ts
300 orchestrator/src/translator/block-parser.ts
```

## Top test-cases-per-file

```
40 harness/src/__tests__/assertions.test.ts
31 ingestion/src/blog/__tests__/fetch.test.ts
25 ts-common/src/__tests__/fixtures.test.ts
19 ts-common/src/__tests__/handoff-schema.test.ts
18 orchestrator/src/translator/__tests__/block-parser.test.ts
16 orchestrator/src/server/__tests__/server.test.ts
15 ui/src/session/__tests__/preflight.test.ts
15 connector/src/handoff/__tests__/store.test.ts
```

## Agent runtime structure (orchestrator/src)

```
agent/                  — claude-llm shim, factory, prompt-loader
config/                 — index, load, models, schema (Zod env)
connector/              — MCP-over-HTTP client, retry, ADK FunctionTool wrappers
functional-agents/      — triage-classifier (layer-2 Haiku agent)
server/                 — Express handlers (one file per route + index composition)
session/                — interface + 4 backends (in-memory, adk-native, vertex-ai, firestore — last 2 are stubs)
                         + warm-pool + warm-pool-bootstrap
translator/             — ADK event stream → @swoop/common MessagePart parts
                         block-parser (state machine for <fyi>/<reasoning>/<adjunct>/<utter>)
                         adk-to-parts, reasoning-filter, types
```

## UI structure (ui/src)

```
App.tsx                  — top-level gate + ConsentProvider
disclosure/              — opening-screen, chrome-badge, privacy-info-modal, use-consent
errors/                  — error-banner, classify, use-runtime-errors
parts/                   — fyi-channel, fyi-renderer, fyi-signaling-text, reasoning-guard
runtime/                 — orchestrator-adapter (custom AI SDK ChatTransport), handoff-client, emit-ui-event
session/                 — preflight, use-preflight
shared/                  — AttributeTable, Card, CtaButton, ImageBlock
widgets/                 — inspiration, item-detail, lead-capture, search-results, widget-shell
```

## CMS layout

```
cms/errors/en.json                              — UI error copy (D.t5)
cms/legal/compliance-bundle/{01..09}*.md       — compliance bundle (5 ✅ filled / 1 🟡 partial / 4 🔴 blocked / 1 empty screenshots dir)
docs/ops/evalset-growth.md                       — H.t7 operator runbook
cms/prompts/system/00_why.md                    — STILL PLACEHOLDER (5 lines, "PLACEHOLDER — chunk G.t1 overwrites")
cms/prompts/system/10_style-avoid.md            — substantive (Al-authored)
cms/prompts/skills/.gitkeep                     — EMPTY (G.t3 not yet run)
cms/prompts/tools/find_inspiring/description.md — substantive (C.t2 first-pass)
cms/prompts/tools/find_options/description.md   — substantive
cms/prompts/tools/find_proof/description.md     — substantive
cms/prompts/tools/find_someone_who/description.md — substantive
cms/prompts/tools/lookup/description.md         — substantive
cms/prompts/tools/illustrate/                   — DOES NOT EXIST yet
cms/prompts/tools/handoff/                      — DOES NOT EXIST yet
cms/prompts/tools/handoff_submit/               — DOES NOT EXIST yet
cms/templates/handoff/qualified.md              — full plain-text template
cms/templates/handoff/referred-out.md           — lighter plain-text template
                                                  (no `disqualified.md` or `inconclusive.md` — both no-email per E.3 + Q5)
```

## Postgres migrations (connector/migrations)

```
001_extensions.sql              — pgvector + pg_trgm + btree_gin
002_domain_tables.sql           — 21 source-mirror domain tables (trip, tour, hotel, vessel, location, area, country, activity, faqitem, image, page, contentblock, chunk, tag, blog_post, blog_chunk, etc.)
003_derived_tables.sql          — 5 job-shaped derived tables (inspire_passage, customer_story, trust_proof, inform_chunk, trip_card)
004_indexes.sql                 — HNSW + GIN tsvector + GIN array + pg_trgm + B-tree
005_canonical_url_function.sql  — IMMUTABLE PARALLEL SAFE
006_customerreview_tables.sql   — added 2026-04-30 after C.26 graduated (customerreview + customerreview_trip)
```

## Tier 3 plan inventory (33 plans)

```
03-exec-foundations-{t1..t5}.md        — chunk A (5 plans)
03-exec-agent-runtime-{t1, t1a, t2..t7, t10}.md — chunk B (9 plans)
03-exec-c-{t0, t2}.md                  — chunk C (2 plans, t1/t3/t3a/t4/t5/t6/t8 still pending)
03-exec-blog-ingest.md                 — parallel C-stream
03-exec-chat-surface-{t1..t8}.md       — chunk D (8 plans)
03-exec-handoff-{t1, t2-t3}.md         — chunk E (2 plans for t1+t2/t3; t4..t9 elsewhere)
03-exec-e-t8.md                        — compliance bundle skeleton
03-exec-h-t7.md                        — living-evalset runbook
03-exec-observability-{a, b}.md        — chunk F
03-exec-side-quest-host-harness.md     — mock-host
03-exec-validation-scaffold.md         — H scaffold
```

## Notable implementation decisions in code (cross-referenced from planning)

- `claude-llm.ts:1-539` — custom BaseLlm shim translating ADK ↔ Anthropic streaming (genai → JSON Schema 2020-12 normalisation, thinking_delta → Part.thought)
- `orchestrator-adapter.ts:1-660` — custom AI SDK ChatTransport bridging Puma's `{sessionId, message: string}` SSE to assistant-ui's UIMessageStreamPart taxonomy
- `block-parser.ts:1-300` — state-machine parser for `<fyi>`/`<reasoning>`/`<adjunct>`/`<utter>` block types
- `chat.ts:1-512` — SSE endpoint, applies `reasoning-filter` before sending parts wire-side
- `connector/src/handoff/{store, mailer, submit, template-renderer}.ts` — handoff side-effect chain
- `triage-classifier.ts:1-420` — layer-2 functional agent on Haiku (placeholder until G.t0)
- `warm-pool.ts:1-411` — LIFO stack of pre-created sessions, default size 0
- `session/{firestore, vertex-ai}.ts` — STUBS (post-M4 backends; deferred per inbox 2026-04-28)
- `ui/src/runtime/handoff-client.ts` — POST /handoff/submit + error normalisation
- `ui/src/widgets/lead-capture.tsx:394` — async submit + addResult lifecycle
- `widget-shell.tsx` — auto-unwraps `{ok: true, value}` envelopes from connector

## Headline observations from preflight (for council to verify or refute)

1. **`ts-common` is the contract spine** — every other workspace depends on it; it depends on nothing internal.
2. **Three large files >500 LOC** that look load-bearing: `claude-llm.ts`, `orchestrator-adapter.ts`, `chat.ts`. Worth deep-reading.
3. **`ingestion/blog/fetch.ts` is 753 LOC in a single file** — substantial; check whether decomposition would help.
4. **Two `session/` stubs (`firestore.ts`, `vertex-ai.ts`)** — legitimately deferred per inbox 2026-04-28; not drift, but worth confirming they're not silently being depended on.
5. **5 of 8 tool description.md files exist** in CMS; 3 (illustrate/handoff/handoff_submit) absent. The `tools.ts` `TOOL_DESCRIPTIONS` map carries placeholder labels for the missing ones.
6. **`00_why.md` is a 5-line stub** explicitly labelled placeholder; G.t1 not yet run.
7. **Skills directory is empty** (G.t3 deferred).
8. **`connector/` workspace barrel exports 4 things** today, but the package description (per planning) says it'll grow to host MCP tools (chunk C). Boundary will widen.
9. **Test cases total: 401 it/test calls** (matches the 416 vitest-reported test count once parametrised cases are counted).

## Where the planning corpus lives (for drift auditors)

- `planning/01-top-level.md` — Tier 1 plan
- `planning/02-impl-*.md` — 8 Tier 2 implementation plans
- `planning/03-exec-*.md` — 33 Tier 3 execution plans
- `planning/decisions.md` — decision log (~106KB, ~50+ decisions)
- `planning/reviews/2026-04-30-state-of-play.md` — yesterday's planning-level review (for context only)

## Evidence rule for every council member

Every claim in your output **must** cite `file:line` or a command/output. No "I think" or "appears to". If you can't cite, mark as **UNVERIFIED** and explain what evidence would resolve it. This is non-negotiable — drift between agent claims and code reality is the failure mode this discipline prevents.

## Output format every council member must follow

```
## [Lens name] — verdict

**Headline** (one sentence): single most important thing for Al to know.

**Overall severity**: 🟢 (sound) / 🟡 (watch) / 🔴 (intervene).

### Findings (3–8, ranked by severity)

1. **[Title]** — 🟢/🟡/🔴
   - Evidence: file:line OR command output OR explicit UNVERIFIED.
   - Implication.
   - (Optional) suggested follow-up.

### Cross-lens signal
Things you noticed that other lenses might be tracking — flag for synthesis.

### What's working well
1–3 counterweights.
```

Cap at ~800 words unless otherwise specified.
