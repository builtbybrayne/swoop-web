# Progress — Swoop Web Discovery (Puma)

**Snapshot date**: 2026-05-01 (full review fix-wave landed; all fourteen review items merged; seven new chunk-C tier-3 plan drafts ready for HITL review)
**Release**: Puma (Patagonian-animals naming convention; see [CLAUDE.md](CLAUDE.md#releases))
**Status**: **M1 live + chunks D + mock-host shipped; C.t2 closed; C.26 graduated; 2026-04-30 review wave fully landed; chunk-C tier-3 plans drafted; chunks B/E/F/G/H advancing.** 2026-05-01 landed via 14 agent branches + 2 integration fixes: all fourteen pre-chunk-work review items closed (R1, R2, R3, R4-handoff, R4-server, Sec-1, Sec-2, Sec-3, Theme-A.1, H3, H4, H5, Perf-1, Perf-3, Test-1) + seven new tier-3 DRAFT plans (C.t1, C.t3, C.t3a, C.t4, C.t5, C.t6, C.t8) authored for chunk-C implementation. Sec-3 (`javascript:`/`data:` URL scheme rejection) was originally claimed-closed by Theme-A.1 but only validated against stale node_modules — actually closed by `be9ca95` adding a refine() check on top of `.url()`. The chat.ts-cluster agent (R2 + R4-server + Perf-3 + Test-1) also surfaced and fixed a latent Express 5 + Node 20 bug — `req.on('close')` fires synchronously after `express.json` drains, so the chat handler's mid-stream-disconnect listener never propagated to `abortController.abort()`; switched to `res.on('close')`. **Test count: 412 → 492 (+80)**. Earlier (2026-04-30): **C.t2** entity model + tool surface schemas (migrations 001–005 + 006; eight intent-named tools with five job-shaped derived tables); **C.26 graduated** with the customerreview supplementary dump (2,563 rows + 163 trip junctions); composer pattern removed (decision C.24); top-down-from-sales discipline elevated as theme 11. Earlier (2026-04-29): C.t0 + E.t8 + H.t7 + mock-host + blog ingest. Earlier (2026-04-28): G.11 / B.t1a + E.t2/E.t3/E.t4 + 12 new decisions. Next wave per [next-steps.md](next-steps.md).

**Review-fix status (2026-04-30 code review)**: 14 of 14 pre-chunk-work items closed. Cross-cuts H1+H2 (messageOf + emitErrorRaised helpers) deferred to pair with next chunk-C work; Theme-A.2/3/4/5 (Zod hygiene tightenings) and Perf-2 (parallel-not-serial triage) intentionally deferred per the review's strategic table. Master ledger: [planning/reviews/2026-04-30-code-level.md](planning/reviews/2026-04-30-code-level.md).

---

## What M1 looks like right now

A visitor at http://localhost:5173 can:
1. See the paired AI-disclosure + GDPR tier-1 consent screen.
2. Click **Continue** → orchestrator issues a session id + records consent.
3. Type a question (e.g. "Tell me about the W trek in Patagonia") and hit Send.
4. Receive a real Claude Sonnet response streamed inline, produced by an ADK agent calling stubbed MCP tools via a functional Haiku 4.5 triage classifier.
5. (When the agent triggers) See the lead-capture widget render. Tick consent, fill name + email, click Send. The widget POSTs to `/handoff/submit`, the orchestrator enriches against session state, the connector persists a JSON record under `var/handoffs/`, and the mailer is invoked (skipping cleanly when disabled). Confirmation card renders.

The three services are all running (`:5173` UI, `:8080` orchestrator, `:3001` stub connector). System prompt is now sourced from `cms/prompts/system/` — every numerically-prefixed `.md` file is concatenated and fed to the agent.

**This was verified in the preview earlier.** Orchestrator logs show a full turn: triage classifier ran → ADK user event received → tool calls happened → SSE parts streamed → assistant-ui rendered. The handoff submit flow is verified via integration tests (`handoff-submit.test.ts`); live walkthrough is pending Julie's SMTP confirmation for the email leg.

## D.t5 + waves 1–2 (2026-04-24)

- ✅ **Five error surfaces rendered by a unified `ErrorBanner`** (unreachable / stream_drop / session_expired / rate_limited / unknown), copy authored in `product/cms/errors/en.json` per content-as-data. Tool-call inline error upgraded to the same copy source via `getToolErrorCopy()`. See [planning/03-exec-chat-surface-t5.md](planning/03-exec-chat-surface-t5.md).
- ✅ **Always-visible "New conversation" button** + adapter-side error emitter pattern (decisions D.12 + D.14).
- ✅ **D.t8** brand-extension surface: 12 CSS custom-properties tokens scoped to `[data-swoop-root]`, 10 `data-swoop-part` attribute hooks on primitives, [product/ui/HANDOVER.md](product/ui/HANDOVER.md) for Swoop's in-house team, iframe embed recipe + CSP + CORS contract (D.21–D.25).
- ✅ **F-b** observability retrofit: 27 producer sites routed through `emitEvent`; UI now has a thin `emit-ui-event.ts` wrapper hiding sessionStorage boilerplate.
- ✅ **B.t10** warm session pool: shipped with `WARM_POOL_SIZE=0` default. LIFO stack, eager startup pre-warm. Two emitted kinds (`warm_pool.hit` / `warm_pool.miss`).
- ✅ **G.10** style-avoid first pass at `cms/prompts/style-avoid.md` (later renamed to `cms/prompts/system/10_style-avoid.md` under G.11).

## G.11 / B.t1a (2026-04-27)

- ✅ **CMS folder structure**: `cms/prompts/{system,skills,tools}/` with deterministic load contracts. System prompt is the concatenation of every file matching `^\d{2}_[a-z0-9-]+\.md$` in `prompts/system/`, joined by `\n\n---\n\n`. Skills are ADK 1.0 directories (per `loadAllSkillsInDir`); tools are MCP-tool-scoped fragments. See decision **G.11** + [planning/03-exec-agent-runtime-t1a.md](planning/03-exec-agent-runtime-t1a.md).
- ✅ **Multi-file prompt loader** (B.t1a): `prompt-loader.ts` reads the directory, filters by pattern, sorts lexicographically, joins. Hot-reload preserved in dev. Sub-directories silently skipped via `withFileTypes`. Config rename: `SYSTEM_PROMPT_PATH` → `SYSTEM_PROMPT_DIR`. New unit tests cover concatenation, filtering, prod cache vs dev re-read, missing/empty dir, single file, sub-dir skip.
- ✅ **Files relocated**: `cms/prompts/why.md` → `cms/prompts/system/00_why.md`; `cms/prompts/style-avoid.md` → `cms/prompts/system/10_style-avoid.md`. `cms/prompts/skills/` and `cms/prompts/tools/` created with `.gitkeep`.
- ✅ **Authoring guide**: [product/cms/README.md](product/cms/README.md) rewritten as the day-to-day rules for non-engineers (layout + load contracts + naming + "what goes where" decision tree). Pointer added in [product/CLAUDE.md](product/CLAUDE.md).

## Review fix-wave + chunk-C plan drafts (2026-05-01 — 14-agent swarm + 2 integration fixes)

Day after C.t2 closed. Worktree-isolation swarm executed the 2026-04-30 code-review close-out + authored seven new chunk-C tier-3 plan drafts in parallel. Final state on `claude/magical-johnson-3b07a1` at `a5d0b03`: 15 merge commits + 1 schema-tightening fix + 1 cluster-bundle commit; **492/492 tests** (412 → 492, +80); typecheck clean across all 6 workspaces; verified against fresh `npm install` (per the false-green lesson — see notable findings below).

### Review items closed (14)

| Item | Branch | Commits |
|---|---|---|
| **R1** — `inconclusive` on TriageStateSchema | `worktree-agent-a1bb7720bed547731` | `14630eb`, `77ecfbd` |
| **R3** — `^[^\r\n]{1,200}$` regex + control-char strip on handoff contact | `worktree-agent-a13de24569bedc8b0` | `0bde8f4`, `1d743f6` |
| **R4-handoff** — `.max()` on contact / motivationAnchor / reason.text | (same as R3) | (bundled) |
| **Sec-1** — `mkdir 0o700` + `writeFile 0o600` on `FsHandoffStore` | `worktree-agent-ae6c289a8c36cc538` | `d3398d2` |
| **Sec-2** — helmet middleware (CSP frame-ancestors + HSTS + Referrer-Policy) | `worktree-agent-a58565657e7fb1a67` | `d9181ea` |
| **Sec-3** — entryUrl scheme allowlist (closed retroactively by `be9ca95` after stale-node_modules false-green) | (orchestration worktree) | `be9ca95` |
| **Theme-A.1** — `ChatRequestSchema` / `ConsentRequestSchema` / `SessionBootstrapRequestSchema` Zod-validated at HTTP boundary | `worktree-agent-ad31149bedd696ab3` | `4539053` |
| **H3** — `handoff.email.{sent,skipped,failed}` event kinds + emission | (Sec-1 branch) | `ac296e4` |
| **H4** — `parseToolResult` helper for connector adapter | `worktree-agent-a6e1814507a383626` | `9e4bfbd`, `48621f5` |
| **H5** — shared SSE parser in `@swoop/common/streaming` (harness + UI both consume) | `worktree-agent-acd7eb95881306e3e` | `63ac862`, `20705ce`, `52c3485`, `a55ba1f` |
| **Perf-1** — Anthropic prompt caching `cache_control: { type: 'ephemeral' }` on system + last tool entry | `worktree-agent-a2f3b90fb5ba02bd4` | `ae6dd72`, `a9884bd`, `fcd7366` |
| **R2** — per-session async mutex on `store.update` (decorator wrapping every backend) | `worktree-agent-a075681279e924612` | `dc2af42` |
| **R4-server** — `express.json` 64kb→16kb + `.max(8000)` on chat message via `CHAT_MESSAGE_MAX` | (same bundle) | `a9ede99` |
| **Perf-3** — skip triage classifier on turn 1 (advisory verdict from turn N still emitted for turn N+1) | (same bundle) | `7c505ab` |
| **Test-1** — `/chat` error-path integration tests (mid-stream throw, client disconnect, connector unreachable) | (same bundle) | `6e2731a` — also surfaced + fixed a latent Express 5 bug (`req.on('close')` → `res.on('close')`) |

All fourteen 2026-04-30 pre-chunk-work review items now closed. Strategic deferrals per the review's "Strategic" table: H1 (`messageOf`) + H2 (`emitErrorRaised`) — pair with next chunk-C agent that touches the 16-site sweep; Theme-A.2/3/4/5 — small Zod hygiene tightenings, not in pre-chunk-work scope; Perf-2 (parallel triage) — needs design work post-G.t0.

### Tier 3 plan drafts authored (7) — all marked `Status: DRAFT — for HITL review. Not yet executable.`

| Plan | Lines | Worktree | What |
|---|---:|---|---|
| [planning/03-exec-c-t1.md](planning/03-exec-c-t1.md) | 364 | `worktree-agent-a35a0dc595c2d3aed` | Connector skeleton + Postgres pool wiring (foundational, smallest, fastest in chunk-C) |
| [planning/03-exec-c-t3.md](planning/03-exec-c-t3.md) | 706 | `worktree-agent-a78713f2effc14bcb` | SQL-dump → Postgres transform; recommends **Option B (Node CLI translator in `@swoop/ingestion`)** with 6 reasons |
| [planning/03-exec-c-t3a.md](planning/03-exec-c-t3a.md) | 466 | `worktree-agent-acdc531b9b01f0a00` | Voyage-3 embeddings + Haiku ETL classifiers (blog-post job, persona-summary aggregation by reviewer name, image annotation, blog-tag normalisation); recommended `ENRICH_BUDGET_GBP=10` dev / £15 prod with batch-boundary kill-switch |
| [planning/03-exec-c-t4.md](planning/03-exec-c-t4.md) | 351 | `worktree-agent-a669aa78a0995b554` | Eight intent-named tool handlers over data primitives; `handoff_submit` thin-wrapper over E.t2/E.t3-shipped endpoint; description-load fail-fast for the five conversational tools |
| [planning/03-exec-c-t5.md](planning/03-exec-c-t5.md) | 190 | `worktree-agent-adcea2f64a87b63bb` | `@swoop/common` image URL utility + page-as-hub resolver |
| [planning/03-exec-c-t6.md](planning/03-exec-c-t6.md) | 233 | (same) | Claude Vision annotation pipeline over the ~6.3K images without upstream `image.description`; ~£30–£150 cost estimate |
| [planning/03-exec-c-t8.md](planning/03-exec-c-t8.md) | 235 | (same) | ETL + annotation handover runbooks at `product/cms/ops/` |

All plans carry the ★ Read this first calibration callout pointing at chunk-C anchor + theme 11 (top-down-from-sales). Open-question lists numbered for HITL adjudication; tooling picks made with explicit reasoning.

### Tests + typecheck

- `@swoop/common`: 58 → 102 (+44 — fixtures, sse-parser, handoff-schema, route-schema + R4-server caps, others)
- `@swoop/orchestrator`: 132 → 158 (+26 — Perf-1 placement + Theme-A.1 routes + helmet + handoff-submit event + R2 mutex + R4-server + Perf-3 turn-1 + Test-1 chat error paths)
- `@swoop/connector`: 46 → 56 (+10 — Sec-1 perms + H3 email-event branches + R3+R4 mailer scrub)
- `@swoop/ui`: 71 → 71 (H5 consumer rewire only)
- `@swoop/ingestion`: 31 → 31
- `@swoop/harness`: 74 → 74
- **Total: 412 → 492 (+80)**

Typecheck clean across all 6 workspaces. Fresh-install verification (`rm -rf node_modules && npm install && npm test`) green at merge tip — required by the false-green lesson below.

### Notable findings from this wave

1. **The agent self-verification false-green pattern.** The Theme-A.1 agent reported "6/6 workspaces green" on its branch, but the Sec-3 test (rejecting `javascript:alert(1)` in `entryUrl`) actually returns 201 against a fresh `npm install` — Zod's `.url()` accepts non-http schemes. The agent's branch passed tests against stale node_modules. Caught at integration. Lesson: agent test-pass reports are necessary but not sufficient — fresh-install verification at merge time is non-negotiable. Saved as auto-memory `feedback_swarm_fresh_install_verify.md`.
2. **Worktree-base race in agent dispatch.** First wave of 12 agents: 8 of 12 worktrees branched from main (`a1a9fe3`); 4 landed on stale older commits. The over-strict initial hash gate halted the 4 cleanly without damage; the improved gate (`git cat-file -e <SHA> && git reset --hard <SHA>`) auto-recovered subsequent dispatches because worktrees share the `.git` object store. Pattern documented for future swarm dispatches.
3. **Background-await turn-budget death.** Multiple agents hit turn limits while waiting on `run_in_background` npm/test notifications that didn't arrive in time. Fix in agent briefs: explicitly mandate foreground/blocking npm/test commands.
4. **Latent Express 5 + Node 20 bug in chat.ts surfaced by Test-1.** `req.on('close')` fires synchronously when the chat handler is entered because `express.json()` has already drained the request stream. The chat handler attached its disconnect listener after that point, so real mid-stream disconnects never propagated to `abortController.abort()`. The chat.ts cluster agent confirmed the timing with a real-server probe and switched the listener to `res.on('close')`, which fires when the response socket actually closes — the correct signal for SSE cancel. Bonus fix; counted under Test-1's scope. The `/chat` error-path was the test the bug was hiding behind.

---

## C.t2 contract layer + C.26 graduation (2026-04-30 — full session)

### C.t2 — eight-tool intent-named surface, five job-shaped derived tables, production-quality tool descriptions

The substantive new artefact for chunk C. Designed both layers (Postgres migrations + ts-common Zod) together because they co-define each other. Subagent-driven-development workflow: implementer → spec-compliance reviewer → code-quality reviewer → fixes pass.

- ✅ **Postgres migrations** at `product/connector/migrations/`: `001_extensions.sql` (pgvector + pg_trgm + btree_gin), `002_domain_tables.sql` (21 domain tables — trip, tour, hotel, vessel, location, area, country, activity, faqitem, image, page, contentblock, chunk, tag, blog_post, blog_chunk, etc.), `003_derived_tables.sql` (the 5 job-shaped tables), `004_indexes.sql` (HNSW + GIN tsvector + GIN array + pg_trgm + B-tree), `005_canonical_url_function.sql` (`canonical_url(override_url, alias)` IMMUTABLE PARALLEL SAFE). Forward-only per C.31. Comprehensive column comments on load-bearing fields. ON DELETE SET NULL on optional image FKs. UNIQUE on `tag.alias`, `blog_post.slug`, `page.canonical_url`.
- ✅ **`@swoop/common` Zod surface** (`product/ts-common/src/derived.ts` new + `tools.ts` rewritten): five derived-entity schemas with `*PublicSchema` projections that strip server-only fields (`embedding`, `tsv`, `content_hash`, `sourceProvenance`); five intent-named tool I/O Zod pairs (`FindInspiring*`, `FindSomeoneWho*`, `FindProof*`, `Lookup*`, `FindOptions*`); deprecated `Search*` / `GetDetail*` schemas marked `@deprecated` with B.t3a sunset note (their actual removal is B.t3a's call). `TOOL_NAMES` const map for typed strings; `EmbeddingSchema = z.array(z.number().finite()).length(1024)`.
- ✅ **Fixtures** at `product/ts-common/src/fixtures/`: 10 new fixture files (full + public projection per derived entity, input + output per new tool I/O pair). 15 new round-trip test cases in `__tests__/fixtures.test.ts`. All pass.
- ✅ **Tool description prose** (production first-pass — ship-ready as-is) at `product/cms/prompts/tools/<tool>/description.md` for the five intent-named tools. Voice-checked against the chunk-G §2.1a avoidance list — no em-dash-as-rhythm, no banned verbs, no empty affirmations, no trailing offers. Each file 1–3 paragraphs + an italicised "When to pick this" disambiguation line (lookup vs find_inspiring is the most likely-to-confuse case).
- ✅ **Code-quality review fixes** (item-by-item from the reviewer's pass): Voyage-3 dimensionality corrected to **1024d** across all migrations + Zod (was incorrectly 1536 — that's OpenAI; **C.18 LOCKED to Voyage-3 / 1024d**); `EmbeddingSchema` adds `.finite()` to reject NaN/Infinity; ON DELETE SET NULL on the seven optional image FKs; UNIQUE on slugs/aliases/canonical_url where natural key; `lookup` description italicised-fragment fix; `find_options` voice tweak; one-line comment correction in 003_derived_tables.sql about source_id type.
- ✅ **New decisions in `decisions.md`** (C.30 was already there pre-C.t2): **C.30b** (`image_id` is FK + public projection wraps joined image), **C.31** (forward-only `node-pg-migrate` with zero-padded prefix; revisit at C.t8 handover), **C.32** (`tag` derived table holds `ntag` only, legacy `tag` excluded), **C.33** (derived `source_id` is TEXT spanning INTEGER source ids and string sources), **C.34** (markdown owns description prose; `TOOL_DESCRIPTIONS` map carries pointer labels only — runtime registration loads markdown). **C.18 reframed** to lock Voyage-3 / 1024d.
- ✅ **Tier 3 plan + execution log** at [planning/03-exec-c-t2.md](planning/03-exec-c-t2.md) with subagent reports captured (implementer summary, spec-reviewer verdict, code-quality reviewer findings, controller's amendment for the `find_someone_who` description over-execution flag, and the C.26 closure addendum at the end).

### C.26 — Mirror tool graduation (granted, customertip pending)

Phase 1 (subagent-led source inspection) → Phase 2 (graduation):

- ✅ **Phase 1 inspection** of the 2026-04-30 supplementary `customerreview_tables_-_swoop-patagonia_prod.sql` dump. 2,563 customer reviews + 163 `customerreview_trip` junction rows; the 2,390 `contentblock_customerreview` junction rows now resolve cleanly (100%, zero dangling). Length distribution median 153 chars; ~80% short snippet fragments + ~20% substantive 300–1000-char first-person testimonials; aggregate-by-reviewer-name guidance for C.t3a's persona classifier (same person often has 9–12 snippet rows that compose into a coherent persona only when joined). Geographic anchors STRONG (Torres del Paine, Fitz Roy, EcoCamp, named treks all preserved); date coverage 99.9%; image associations sparse (5.8%); only 6% of reviews are structurally `customerreview_trip`-tagged (region/season retrieval will lean on prose embeddings, not structured trip joins).
- ✅ **Phase 2 graduation**: new migration `006_customerreview_tables.sql` adds `customerreview` + `customerreview_trip` domain tables (audit columns referencing the absent `user` table dropped, but `feedbacksnippet_id` retained as commented-as-dangling for forensic value); `find_someone_who` moved from `CONDITIONAL_TOOLS` (now empty const, removed entirely) to live `TOOL_DESCRIPTIONS`; description label cleaned of conditional caveats; **C.26 in decisions.md graduated** from "ask outstanding" to "GRANTED 2026-04-30 / find_someone_who live"; **C.30** conditional reference cleared.
- **PII stance**: ingest as-is. Per Al 2026-04-30: *"these reviews are all public domain anyway — they're literally public customer reviews on the website."* No NER scrubbing, no name/location column drops, no regex flagging.
- **Customertip remains pending**. The dump did not include `customertip` (119 expected) or `pressreview`. Separate Swoop ask outstanding; the 119 `contentblock_customertip` junction rows continue to dangle and ETL ignores them.

### Architectural reframing landed in the planning suite (2026-04-29 → 2026-04-30)

This session's biggest non-code shift was making the WHY of chunk C unmissable in the docs themselves. Previous Claude sessions had drifted into bottom-up reasoning ("we have data X, what tool should query it?") and produced librarian-shaped tools that needed Haiku composer middlemen to feel sales-shaped. The 2026-04-29 review reset the substrate; the 2026-04-30 closure made it stick:

- **No composer pattern (C.24 supersedes C.22)**: tools are thin handlers over data primitives. Sonnet at the orchestrator handles synthesis directly. Cheap LLM (Haiku) moves to ETL classifier passes (blog-post job classification, persona-summary extraction with by-reviewer aggregation, image annotation, blog-tag normalisation against `ntag`). One LLM call per turn, lower latency, simpler.
- **Eight intent-named tools (C.25 supersedes C.19)** mapped to five conversational jobs: `find_inspiring` (Inspire) / `find_someone_who` (Mirror) / `find_proof` (Reassure) / `lookup` (Inform) / `find_options` (Propose options) plus `illustrate` / `handoff` / `handoff_submit`. PoC's `search` and `get_detail` deprecated alongside (their surface absorbs into `lookup` and `find_options`).
- **Top-down-from-sales discipline (theme 11)** added to top-level §3 + the new ★ Read this first anchor section in `02-impl-retrieval-and-data.md` + the matching callout in `03-exec-c-t2.md`. Future agents hit the calibration layer before they touch a Zod schema or CREATE TABLE.

### Postgres bootstrap + worktree-data-resolver gotcha

Inter-session: another agent did the Postgres bootstrap. `puma_dev` is live at `postgresql://al:pick-a-password@localhost:5432/puma_dev` with pgvector 0.8.1 + pg_trgm 1.6 + tsvector smoke-tested green; PG16 → PG18 across plans + decisions; `swoop_puma_dev` → `puma_dev` rename; DATABASE_URL stub in orchestrator's `.env.example`; bootstrap walkthrough in `gotchas.md`. Independently: blog ETL `data/` lands inside the worktree (not the main repo) because the resolver walk in `product/ingestion/src/blog/fetch.ts` stops at the worktree's `.git` file marker. Captured in `inbox.md`.

---

## C.t0 + E.t8 + H.t7 + mock-host (2026-04-29 — overnight swarm)

Five worktree-isolated agents dispatched in parallel; four committed, one (mock-host verification A) was redundant — Al confirmed mock-host already in active use. Pattern observation: `isolation: "worktree"` does branch from `main` (not from the spawning agent's branch) — every agent caught it via the hash-verification gate and self-reset to `ddada33` before doing work. Pattern works; keep it.

- ✅ **C.t0** — local MariaDB inspection of the 2026-04-27 SQL dump. Tier 3 plan + execution log at [planning/03-exec-c-t0.md](planning/03-exec-c-t0.md). Substantial rewrite of [data-ontology.md](data-ontology.md) (+413 / -108) with `S-SQLDUMP-2026-04-27` source tag. 8 questions closed in [questions.md](questions.md); 3 new questions raised for Thomas/Richard. 119 lines of durable findings added to [discoveries.md](discoveries.md). **Notable findings that overturn first-pass assumptions**: trip count is 852 (not 111 — public feed is curated subset); currency id 4 = AUD not EUR; `adventurousness` is a trip-style classifier not a difficulty/wilderness legend; `image` table has no filename column (joins to `file` via `image.image_id → file.id`); `image.description` is 47.5% populated (could materially cut C.t6 annotation cost); `tripvariant` + `season` are operational, skip from agent surface; `daybyday` canonical filter likely `type='presale' AND trip_id IS NOT NULL AND deleted IS NULL` (~12,415 rows for 852 trips, needs Thomas confirmation); **`customerreview` + `customertip` source tables are MISSING from the dump** (junction rows dangle — material gap, this was the agent's primary curated-prose corpus); `ntags_lookup` is 94% PII enquiry data (agent-relevant subset ~7,853 rows). Database left loaded for ongoing inspection.

- ✅ **E.t8 compliance-bundle skeleton** — Tier 3 plan at [planning/03-exec-e-t8.md](planning/03-exec-e-t8.md), 12-file bundle at [product/cms/legal/compliance-bundle/](product/cms/legal/compliance-bundle/). Status by file: 5 ✅ FILLED (README + status legend, 01-overview, 02-data-flow with mermaid + per-edge narrative, 05-retention-policy with values from E.6/E.7/E.8, 08-data-subject-rights, 09-review-checklist), 1 🟡 PARTIAL (06-processors — Anthropic + Google Cloud filled, SMTP TBC), 4 🔴 BLOCKED (03-disclosure-copy + 04-consent-flow on E.t5; 07-dpas on Swoop legal sourcing; screenshots/ on real copy + screenshot capture), naming convention documented for the empty dir. Counsel review checklist landed.

- ✅ **H.t7 living-evalset growth runbook** — Tier 3 plan at [planning/03-exec-h-t7.md](planning/03-exec-h-t7.md), operator-facing runbook at [product/cms/ops/evalset-growth.md](product/cms/ops/evalset-growth.md). Decisions H.17–H.20 added (cadence Friday afternoon, sanitisation by mechanism + verified grep smoke-test, sources span handoff records + Cloud Logging, ownership-as-role rather than named individual). PII-sanitisation guidance is the load-bearing bit — explicit field table per handoff payload + in-message PII pattern table.

- ✅ **Blog ingest** — confirmed already implemented in `@swoop/ingestion` workspace by an earlier session (753-line single-file pipeline + 31 passing tests). Live backfill produced 102 posts (`X-WP-Total` matches; rolling 5y window aged out 6 posts since the 2026-04-27 plan check). Plan doc at [planning/03-exec-blog-ingest.md](planning/03-exec-blog-ingest.md) flipped to "Implemented" + path corrected to `product/ingestion/src/blog/fetch.ts`.

- ✅ **Mock-host harness** — Al confirmed in active use 2026-04-29. Status flipped from Draft → Shipped on [planning/02-impl-side-quest-host-harness.md](planning/02-impl-side-quest-host-harness.md). Observation outcome: assistant-ui doesn't auto-rehydrate the chat thread on iframe remount → **W1 + W2 unparked** (see [inbox.md](inbox.md) 2026-04-29 entry; original W1 commit `6d31124` worth reviewing for shape, with Postgres-aware retry framing required given C.18 / B.22 / E.10 / C.23 lock-in).

- ✅ **HITL design thread** — Q5 (`inconclusive` 4th verdict approved) and Q4 (main agent derives customer-type, not Haiku post-classifier) closed. Q1 expanded to all 10 tools (PoC + new). Method note captured in [planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) §5: design top-down from conversational arcs, not bottom-up from data shape. Saved to long-term memory so future sessions don't repeat the misstep.

## E.t2 / E.t3 / E.t4 (2026-04-28)

- ✅ **`@swoop/connector` workspace populated**: previously an empty `export {};`. Now hosts the mailer, durable store, and `submitHandoff()` orchestration. Removed `nodemailer` dep from orchestrator, added to connector. Orchestrator now declares `@swoop/connector` as a workspace dep. Decision **E.11**.
- ✅ **`HandoffStore` interface + `FsHandoffStore` interim**: file-backed JSON under `<orchestrator-root>/var/handoffs/`. Atomic writes, filename safety regex, schema-validated round-trip. Same interface the future `FirestoreHandoffStore` will satisfy. Decision **E.12**.
- ✅ **`submitHandoff(payload, deps)`**: schema validate → consent backstop → store save → verdict-aware email. Single side-effect surface for any future MCP `handoff_submit` tool to wrap.
- ✅ **`POST /handoff/submit` orchestrator route**: validates body against `HandoffSubmitRequestSchema`, looks up session, verifies tier-1 consent, enriches into a full `HandoffPayload`, delegates to `submitHandoff()`, emits `handoff.submitted` event, returns typed `HandoffSubmitResponse`. Decision **E.13** (HTTP over MCP-tool routing) + **E.14** (server-side enrichment).
- ✅ **Lead-capture widget POSTs end-to-end**: `handleSubmit` is async; calls `postHandoffSubmit()` from the new `runtime/handoff-client.ts`; on success calls `addResult({ status: 'accepted', handoffId })` to resolve the assistant-ui tool call; on failure shows inline error and lets the visitor retry. Tier-2 consent timestamp captured client-side at submit (decision **E.15**).
- ✅ **Mailer off by default**: `HANDOFF_EMAIL_ENABLED=false`. Cross-field config refine — when flipped to `true`, `HANDOFF_EMAIL_FROM` + `HANDOFF_EMAIL_TO_QUALIFIED` + `SMTP_USER` + `SMTP_PASS` become required at boot. Boot logs name the store path + mailer state.
- ✅ **Email templates**: `cms/templates/handoff/qualified.md` + `referred-out.md` (per-verdict, plain text, `{{path.to.field}}` substitution). `disqualified` produces no email per E.3.
- ✅ **Gitignore**: `product/orchestrator/var/` + `product/connector/var/` ignored — visitor PII never enters git.
- ✅ **22 new tests** across the chain: 9 template-renderer + 13 mailer + 13 store + 11 submit + 9 route handler. See [planning/03-exec-handoff-t2-t3.md](planning/03-exec-handoff-t2-t3.md).

---

## Planning state — all four tiers

| Tier | State | Where |
|---|---|---|
| **Tier 1** — top-level plan | Done | [planning/01-top-level.md](planning/01-top-level.md) |
| **Tier 2** — implementation plans | Done (all 8 chunks) | [planning/02-impl-*.md](planning/) |
| **Tier 3** — execution plans | **Critical path + post-hoc records** for B.t1–t7 + B.t1a + D.t1–t4 + E.t1 + E.t2-t3 + E.t8 + H.t1 + H.t7 + C.t0 + blog ingest (~25 plans). Rest produced just-in-time. | [planning/03-exec-*.md](planning/) |
| **Tier 4** — agent swarm | Active execution model. 17+ subagents dispatched across A/B/D + tonight's parallel C/E/H/blog wave. All committed-and-merged work landed cleanly. **Pattern note**: `isolation: "worktree"` branches from `main`, not from the spawning agent's branch — every dispatch needs a hash-verification gate as its first action. | (mode of work, not a doc) |

Archive of superseded docs: [planning/archive/](planning/archive/) — includes 20/21 Apr meeting notes, research pack, 30 Mar quote, original over-specified 00-07 docs.

---

## Implementation state — per chunk

| Chunk | Scope | State | Notes |
|---|---|---|---|
| **A — foundations** | Repo, workspaces, `ts-common`, CI, decision log | ✅ Complete (t1–t5) | `@swoop/*` scope locked. npm workspaces at `product/` root. |
| **B — agent runtime** | ADK orchestrator, session, connector adapter, translator, SSE, config, two-layer proof, multi-file prompt loader | ✅ Core complete (t1, t1a, t2–t7) | ADK 1.0 + Claude shim + stub connector + translator + SSE + triage classifier all wired. **B.t1a** added 2026-04-27: directory-driven concatenation system-prompt loader. |
| **B — deferred** | Response-format parser (t8), modular-guidance loader (t9), warm pool (t10), **server-side history endpoint (t11 — unparked 2026-04-29)** | Partial (B.t10 done, disabled) | B.t8 parser not needed. **B.t9** skill loader pairs with G.t3 — ADK 1.0's `loadAllSkillsInDir` confirmed; structure is `cms/prompts/skills/<name>/SKILL.md`. **B.t11** unparked after observation that assistant-ui doesn't auto-rehydrate; original commit `6d31124` worth reviewing for shape, with Postgres-aware retry framing required. |
| **C — retrieval & data** | MCP connector + Postgres derived store + ETL + eight intent-named tools + annotation pipeline | Tier 2 rewrite landed 2026-04-28; revised 2026-04-29 (no composers, eight tools, page-prose dominance); **C.t0 done 2026-04-29; C.t2 done 2026-04-30; C.26 graduated 2026-04-30**. Tier 3 plans for C.t1 / C.t3 / C.t3a / C.t4 / C.t6 / C.t8 pending. | Stub connector in orchestrator's `test-fixtures/` carries M1 still. SQL dump + customerreview supplementary dump loaded into local MariaDB. **C.t2 contract layer fully shipped** — 21 domain tables + 5 derived tables + 73 indexes + 5 intent-named tool I/O Zod pairs + production-quality tool descriptions + fixtures. Live `puma_dev` Postgres 18 verified; production migrations applied cleanly. **`find_someone_who` is live**; customertip remains pending Swoop's separate delivery. |
| **D — chat surface** | Full chunk shipped (t1–t8); **t9 (mount-rehydrate) unparked 2026-04-29** | ✅ Core closed; D.t9 reactivated | ErrorBanner + preflight + mobile reflow + brand extension surface all shipped. **D.t9** unparked alongside B.t11 — pairs with server-side history endpoint to resolve the assistant-ui auto-rehydrate gap. |
| **Mock-host harness** | Side-quest. 5-page static site + iframe trigger + sidebar | ✅ **Shipped** (Al-built; verified 2026-04-29) | Reproduces production iframe-remount failure mode. Active demo + observation surface. See [planning/02-impl-side-quest-host-harness.md](planning/02-impl-side-quest-host-harness.md). |
| **E — handoff & compliance** | Triage-aware handoff + persistence + email + legal | **Mostly shipped** (t1, t2 interim, t3 off-by-default, t4 functional, t8 skeleton). **t5–t7 + t9 open.** | E.t1 schema (2026-04-24), E.t2 file-backed interim + E.t3 mailer + E.t4 end-to-end consent flow (all 2026-04-28), **E.t8 compliance-bundle skeleton 2026-04-29**. Remaining: legal copy (t5; gates Q1 voice anchors), retention enforcement (t6, post-IAM), data-deletion script (t7; was a runbook, becomes `psql DELETE` script), legal counsel review (t9 — gates M5). |
| **F — observability** | Structured event logging + schema + producer retrofit | Partial (F-a + F-b done) | F-a schema (20+ event kinds) + F-b retrofit. `handoff.submitted` event now emitted on successful submit. Remaining: B.t9 `skill.loaded` + B.t2 sweeper's `session.ended{idle_timeout}`. |
| **H — validation** | Lightweight eval harness + post-launch ritual | Partial (H.t1 + **H.t7** done) | H.t1 scaffold + **H.t7 living-evalset growth runbook** (2026-04-29) shipped. H.t3 assertions + H.t4 real scenarios + H.t5 judge calibration still open. Decisions H.17–H.20 added with H.t7. |
| **G — content** | System prompt, skills library, HITL flow mapping, **CMS structure**, **style-control** | Partial (G.10 + G.11 + structural plumbing) | **G.10** (2026-04-24) two-layer voice: `00_why.md` + `10_style-avoid.md`. **G.11** (2026-04-27) CMS folder structure decided + plumbing in place. Real content (G.t1 prompt + G.t3 skills + G.t0 HITL flow mapping) waits on the Q1 ensemble walk in [planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) + Luke + Lane's sales-thinking doc (~May 4). |
| **Blog ingest** | Parallel C-stream — WP REST → NDJSON snapshots | ✅ **Implemented** in `@swoop/ingestion` | 753-line single-file pipeline, 31 tests passing, 5y rolling window, 102 posts in current snapshot. See [planning/03-exec-blog-ingest.md](planning/03-exec-blog-ingest.md). Embedding + Postgres insert deferred pending HITL on data shape. |

---

## Workspaces

`product/` is an npm-workspaces monorepo. **Six workspaces ship code today**. **412 tests passing** (was 397; +15 from C.t2 fixture round-trip cases):

| Workspace | Purpose | Test count |
|---|---|---|
| `@swoop/common` | Shared types, schemas, `emitEvent` helper, fixtures, eight-tool I/O Zod, derived-entity Zod | 58 |
| `@swoop/orchestrator` | Agent runtime, server, session store, prompt loader, route handlers | 132 |
| `@swoop/connector` | Mailer, durable handoff store, `submitHandoff()` orchestration. Postgres migrations 001–006 at `migrations/`. | 46 |
| `@swoop/ui` | React chat surface, widgets, runtime adapter, error UX | 71 |
| `@swoop/harness` | Behavioural eval CLI + YAML scenarios | 74 |
| `@swoop/ingestion` | Blog REST → NDJSON snapshots; per-entity ETL helpers (future) | 31 |

Plus content + scripts (no workspace): `cms/`, `scripts/`, `mock-host/`.

---

## Key files to know

### Configuration
- [product/orchestrator/.env.example](product/orchestrator/.env.example) — full config surface, including the new `HANDOFF_EMAIL_*` / `SMTP_*` / `HANDOFF_TEMPLATES_DIR` keys.
- [product/orchestrator/src/config/schema.ts](product/orchestrator/src/config/schema.ts) — Zod schema; cross-field refines for warm-pool TTL + handoff-mailer-when-enabled.

### CMS layout (G.11)
- [product/cms/README.md](product/cms/README.md) — authoring rules + load contracts per subdirectory.
- [product/cms/prompts/system/](product/cms/prompts/system/) — system-prompt fragments (`00_why.md`, `10_style-avoid.md`); concatenated by the loader.
- [product/cms/prompts/skills/](product/cms/prompts/skills/) — ADK skill directories (empty pending G.t3).
- [product/cms/prompts/tools/](product/cms/prompts/tools/) — tool-scoped fragments (empty; populated as MCP tools need authored copy).
- [product/cms/templates/handoff/](product/cms/templates/handoff/) — verdict-aware email templates (`qualified.md`, `referred-out.md`).
- [product/cms/errors/en.json](product/cms/errors/en.json) — UI error-surface copy.

### Agent runtime core
- [product/orchestrator/src/agent/prompt-loader.ts](product/orchestrator/src/agent/prompt-loader.ts) — directory-driven concatenation per G.11.
- [product/orchestrator/src/agent/claude-llm.ts](product/orchestrator/src/agent/claude-llm.ts) — custom BaseLlm shim, Anthropic streaming translation, tool-schema normaliser.
- [product/orchestrator/src/agent/factory.ts](product/orchestrator/src/agent/factory.ts) — builds the ADK LlmAgent.
- [product/orchestrator/src/functional-agents/triage-classifier.ts](product/orchestrator/src/functional-agents/triage-classifier.ts) — the layer-2 agent.
- [product/orchestrator/src/server/chat.ts](product/orchestrator/src/server/chat.ts) — SSE endpoint + consent gate.

### Handoff submit pipeline (E.t2 / E.t3 / E.t4)
- [product/orchestrator/src/server/handoff-submit.ts](product/orchestrator/src/server/handoff-submit.ts) — `POST /handoff/submit` route handler. Body validation, session lookup, tier-1 gate, server-side payload enrichment, delegation to connector.
- [product/connector/src/handoff/submit.ts](product/connector/src/handoff/submit.ts) — `submitHandoff(payload, deps)` orchestration.
- [product/connector/src/handoff/store.ts](product/connector/src/handoff/store.ts) — `HandoffStore` interface + `FsHandoffStore` interim.
- [product/connector/src/handoff/mailer.ts](product/connector/src/handoff/mailer.ts) — verdict-aware nodemailer send.
- [product/connector/src/handoff/template-renderer.ts](product/connector/src/handoff/template-renderer.ts) — tiny `{{path}}` substituter.
- [product/ui/src/runtime/handoff-client.ts](product/ui/src/runtime/handoff-client.ts) — UI client for `/handoff/submit`.
- [product/ui/src/widgets/lead-capture.tsx](product/ui/src/widgets/lead-capture.tsx) — async submit + addResult lifecycle.

### UI core
- [product/ui/src/App.tsx](product/ui/src/App.tsx) — top-level gate (consent → thread). Owns the `resetKey` for "New conversation" restart path.
- [product/ui/src/runtime/orchestrator-adapter.ts](product/ui/src/runtime/orchestrator-adapter.ts) — custom AI SDK `ChatTransport` bridging orchestrator SSE.
- [product/ui/src/disclosure/](product/ui/src/disclosure/) — opening screen, chrome badge, privacy modal, `useConsent()` hook.
- [product/ui/src/errors/](product/ui/src/errors/) — D.t5 error UX.
- [product/ui/src/session/](product/ui/src/session/) — D.t6 preflight.
- [product/ui/src/widgets/](product/ui/src/widgets/) — tool-call widgets + shared primitives.

### Shared types (@swoop/common)
- [product/ts-common/src/handoff.ts](product/ts-common/src/handoff.ts) — E.t1 per-verdict reason taxonomy + E.t3 wire shapes (`HandoffSubmitRequestSchema`, `HandoffSubmitResponseSchema`).
- [product/ts-common/src/events.ts](product/ts-common/src/events.ts) — F-a: 20+ event kinds; includes `handoff.submitted`.
- [product/ts-common/src/emit-event.ts](product/ts-common/src/emit-event.ts) — F-a: `emitEvent()` helper + pluggable sink.
- [product/ts-common/src/session.ts](product/ts-common/src/session.ts) — `SessionState` + `SessionPingResponse`.

### Harness (@swoop/harness)
- [product/harness/](product/harness/) — bespoke Node CLI, YAML scenarios, 13 seeds (3 filled + 10 stubs), stub judge, markdown + JSON reporter.
- [.github/workflows/harness.yml](.github/workflows/harness.yml) — non-gating, label-gated CI.

### Stub connector (still in fixtures)
- [product/orchestrator/test-fixtures/stub-connector.ts](product/orchestrator/test-fixtures/stub-connector.ts) — returns `@swoop/common/fixtures`-backed responses over MCP-HTTP. Carries data-tool calls today; data tools migrate to `@swoop/connector` when chunk C lands.

### Decision log (grows forever)
- [planning/decisions.md](planning/decisions.md) — A.* / B.* / C.* / D.* / E.* / G.* / H.*. Add entries when closing any Tier 2 / Tier 3 decision.

---

## What's running and what's running cost

- **Orchestrator** (`@swoop/orchestrator`): Cloud Run-ready Node 20 service, ADK 1.0 + Anthropic SDK + MCP SDK. Running locally via `tsx watch`. New routes: `/healthz`, `/session`, `/session/:id/consent`, `/session/:id/ping`, `/session/:id` (DELETE), `/chat`, `/handoff/submit`.
- **Stub connector** (`product/orchestrator/test-fixtures/stub-connector.ts`): local-only Express/MCP-HTTP server, fixture responses for data tools. Not for production.
- **`@swoop/connector` package**: in-process workspace dep used by the orchestrator. No standalone process today (will become a Cloud Run service post-IAM).
- **UI**: Vite dev server.
- **Model spend**: every conversation calls Claude Sonnet (orchestrator) + Claude Haiku (triage). Ballpark £0.05–£0.25 per turn per the 30 Mar proposal.

---

## How to resume this project

1. Read [CLAUDE.md](CLAUDE.md) for project orientation (releases, inbox, questions, planning).
2. Read [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching anything.
3. Read [next-steps.md](next-steps.md) for prioritised work.
4. Load the `swoop` skill in your Claude Code session — it covers engagement context, people, day rate, voice.

---

## How to ship M1

1. **Real data**: ✅ C.t2 closed (entity model + tool I/O Zod + migrations 001–006 + production-quality tool descriptions). Next: author Tier 3 plans for C.t1 (connector skeleton + Postgres provisioning) / C.t3 (`export.sql` SQL-dump → Postgres transform) / C.t3a (embedding pass + Haiku ETL classifiers — blog-post job classification, persona-summary aggregation by reviewer name, image annotations, blog-tag normalisation) / C.t4 (eight-tool handlers over data primitives). Implement; swap stub connector for the real `@swoop/connector` data tools.
2. **Content**: same discovery design HITL produces G.t1 (first-pass WHY prompt) + G.t3 (≥2 seed skills); refine when Luke + Lane's sales doc lands (~May 4).
3. **Handoff (E)**: Julie confirms SMTP + sales inbox → flip `HANDOFF_EMAIL_ENABLED=true` → live email path. Legal copy review (E.t5). Firestore swap when GCP IAM lands (E.t2 proper).
4. **Compliance sign-off**: Swoop's legal counsel reviews disclosure + consent bundle (gates M5).
5. **Deploy**: Cloud Run + GCP "AI Pat Chat" IAM (Thomas owns).

All of this is planned at Tier 2 altitude in [planning/02-impl-*.md](planning/).
