# Next Steps — Swoop Web Discovery (Puma)

Prioritised resume guide. Read [progress.md](progress.md) first for state, [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching code.

---

## Status (2026-05-01 — review fix-wave fully landed; chunk-C tier-3 plan drafts ready)
M1 live + chunk D closed + mock-host shipped + **C.t2 done** + **C.26 graduated** + **2026-04-30 review fix-wave fully merged**. 2026-05-01 work landed across 14 agent branches + 2 integration fixes (1 schema-tightening, 1 cluster-bundle): all fourteen pre-chunk-work items closed (R1, R2, R3, R4-handoff, R4-server, Sec-1, Sec-2, Sec-3, Theme-A.1, H3, H4, H5, Perf-1, Perf-3, Test-1) + seven new chunk-C tier-3 DRAFT plans (C.t1, C.t3, C.t3a, C.t4, C.t5, C.t6, C.t8) authored for HITL review. See [progress.md](progress.md) §"Review fix-wave + chunk-C plan drafts (2026-05-01)" for the full breakdown including notable findings (agent self-verification false-green pattern, worktree-base race, background-await turn-budget death, latent Express 5 `req.on('close')` bug).

**Tests**: 492/492 green across 6 workspaces — `@swoop/common` (102), `@swoop/orchestrator` (158), `@swoop/connector` (56), `@swoop/ui` (71), `@swoop/harness` (74), `@swoop/ingestion` (31).

**Postgres setup**: `puma_dev` is live at `postgresql://al:pick-a-password@localhost:5432/puma_dev` (PG 18 + pgvector 0.8.1 + pg_trgm 1.6 + tsvector). Migrations 001–006 at `product/connector/migrations/` apply cleanly to a fresh test DB; `puma_dev` deliberately untouched (that's C.t3's job to populate). MariaDB `swoop_patagonia` left up with both the original dump and the supplementary customerreview dump for ongoing inspection.

**Method note (top-down, not bottom-up)** is now load-bearing in three places: (a) [planning/01-top-level.md](planning/01-top-level.md) §3.0 + theme 11; (b) [planning/02-impl-retrieval-and-data.md](planning/02-impl-retrieval-and-data.md) "★ Read this first — the WHY of chunk C"; (c) [planning/03-exec-c-t2.md](planning/03-exec-c-t2.md) opening callout. Future agents picking up any of these hit the calibration layer before they touch a Zod schema or CREATE TABLE. *"We have data X, what tool would query it?"* is now the explicit anti-pattern theme 11 names. The original ensemble note in [00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) §5 still holds; it's now reinforced upstream.

---

## 2026-04-30 review close-out — status

| Item | Status | Branch / commit |
|---|---|---|
| **R1** — inconclusive on TriageStateSchema | ✅ landed | `worktree-agent-a1bb7720…` `14630eb` + `77ecfbd` |
| **R3** — handoff contact regex + control-char strip | ✅ landed | `worktree-agent-a13de24…` `0bde8f4` + `1d743f6` |
| **R4-handoff** — `.max()` on contact + motivationAnchor + reason.text | ✅ landed | (bundled w/ R3) |
| **Sec-1** — `FsHandoffStore` perms `0o700`/`0o600` | ✅ landed | `worktree-agent-ae6c289…` `d3398d2` |
| **Sec-2** — helmet middleware (CSP frame-ancestors + HSTS + Referrer-Policy) | ✅ landed | `worktree-agent-a585656…` `d9181ea` |
| **Sec-3** — entryUrl scheme allowlist | ✅ landed (integration fix on top of Theme-A.1) | `be9ca95` |
| **Theme-A.1** — Zod schemas at HTTP boundary | ✅ landed | `worktree-agent-ad31149…` `4539053` |
| **H3** — `handoff.email.{sent,skipped,failed}` event kinds | ✅ landed | (bundled w/ Sec-1) `ac296e4` |
| **H4** — `parseToolResult` helper | ✅ landed | `worktree-agent-a6e1814…` `9e4bfbd` + `48621f5` |
| **H5** — shared SSE parser in `@swoop/common/streaming` | ✅ landed | `worktree-agent-acd7eb9…` 4 commits |
| **Perf-1** — Anthropic prompt caching | ✅ landed | `worktree-agent-a2f3b90…` `ae6dd72` + `a9884bd` + `fcd7366` |
| **R2** — per-session async mutex on `store.update` | ✅ landed | `worktree-agent-a075681…` `dc2af42` |
| **R4-server** — `express.json` 64kb→16kb + max(8000) on chat message | ✅ landed | (same bundle) `a9ede99` |
| **Perf-3** — skip triage classifier on turn 1 | ✅ landed | (same bundle) `7c505ab` |
| **Test-1** — `/chat` error-path integration tests | ✅ landed | (same bundle) `6e2731a` — surfaced + fixed an Express 5 latent bug (req.on('close') → res.on('close')) |
| **H1** — `messageOf(err)` helper in `@swoop/common` | ⏸ deferred | pair with next chunk-C agent that touches the 16-site sweep |
| **H2** — `emitErrorRaised` helper | ⏸ deferred | (same — depends on H1) |
| **Theme-A.2/3/4/5** — small Zod hygiene tightenings | ⏸ deferred | not in pre-chunk-work scope |
| **Perf-2** — parallel-not-serial triage classifier | ⏸ deferred | needs design work post-G.t0 |

Master ledger + checklist: [planning/reviews/2026-04-30-code-level.md](planning/reviews/2026-04-30-code-level.md).

**Convention**: each fix commits as `fix(<scope>): close <item-id> — <one-liner> (2026-04-30 review)`. After landing, tick the checkbox in the review file's status table and append the commit ref to the addendum's `Commits:` slot.

---

## Next up

### 0. Dispatch chunk-C implementation [first thing next session]

The 2026-05-01 swarm authored seven new tier-3 plans covering the chunk-C implementation spine. **All seven are HITL-ratified 2026-05-01 — ready for execution.** Each plan has a `## 2026-05-01 HITL ratification` addendum at the bottom resolving every open question.

Dispatch order (hard dependency: C.t1 first; C.t3, C.t3a, C.t4 chain off it; C.t5/C.t6/C.t8 parallelisable side-streams):

1. **C.t1** — [planning/03-exec-c-t1.md](planning/03-exec-c-t1.md) — connector skeleton + Postgres pool wiring. ~0.5 day. Foundational; smallest; fastest. 7 numbered open questions (pg pool config, migration runner placement, data primitives directory, MCP-HTTP surface timing, secret hygiene, port assignment, Postgres handoff-store swap timing).
2. **C.t3** — [planning/03-exec-c-t3.md](planning/03-exec-c-t3.md) — SQL-dump → Postgres transform. ~1.5–2 days. Tooling-pick recommendation: **Option B (Node CLI translator in `@swoop/ingestion`)** with 6 reasons articulated. 8 numbered open questions including `daybyday` shape (concatenate to `trip.description` vs adding `trip_day` table requiring tiny C.t2 amendment).
3. **C.t3a** — [planning/03-exec-c-t3a.md](planning/03-exec-c-t3a.md) — Voyage-3 embeddings + Haiku ETL classifiers. ~2 days. Recommended `ENRICH_BUDGET_GBP=10` dev / £15 prod with batch-boundary kill-switch. 12 numbered open questions; persona-aggregation grouping is load-bearing.
4. **C.t4** — [planning/03-exec-c-t4.md](planning/03-exec-c-t4.md) — eight intent-named tool handlers over data primitives. ~2 days. 7 numbered open questions including `illustrate`-vs-C.t6 dependency (recommend ship against whatever annotation coverage exists at execution time) and `handoff_submit` boundary (recommend MCP tool as thin wrapper over E.t2/E.t3-shipped HTTP endpoint).
5. **C.t5** — [planning/03-exec-c-t5.md](planning/03-exec-c-t5.md) — `@swoop/common` image URL utility + page-as-hub resolver. ~0.5 day. 5 open questions.
6. **C.t6** — [planning/03-exec-c-t6.md](planning/03-exec-c-t6.md) — Claude Vision annotation pipeline over ~6.3K images. ~1 day setup. 6 open questions including journey-shaped vs generic annotation prompt + cost-cap design + write-back column choice (`image.description` vs derived).
7. **C.t8** — [planning/03-exec-c-t8.md](planning/03-exec-c-t8.md) — ETL + annotation runbooks at `product/cms/ops/`. ~0.5 day. Last task in chunk-C. 7 open questions including audience (operator vs Swoop ops) + monitoring location.

**Downstream augments triggered by C.t4** (live in their owning chunks; not authored as tier-3 plans yet):
- **B.t3a** — orchestrator's connector adapter rewrite. Drop `@deprecated` `Search*` / `GetDetail*` schemas; register the eight intent-named tools. ~0.5–1 day, mostly mechanical.
- **D.t9** — chat-surface widget rewrite. Add new widgets for the five intent-named tool outputs from `*PublicSchema` shapes; `inspiration` and `lead-capture` survive from D.t3 (rendering `illustrate` and `handoff`); `component-list` and `component-detail` deprecate alongside `search` / `get_detail`. ~1–2 days.

**Coordination point with cross-cuts**: H1 (`messageOf` helper) and H2 (`emitErrorRaised` helper) are deferred until they pair with chunk-C work. Whoever picks up C.t4 first should land H1 + H2 in `@swoop/common` as the same agent's first commits — they're consumed by the new tool handlers' error envelopes anyway.

**Downstream augments triggered by C.t4** (live in their owning chunks):
- **B.t3a** — orchestrator's connector adapter rewrite. Drop `@deprecated` `Search*` / `GetDetail*` schemas; register the eight intent-named tools. ~0.5–1 day, mostly mechanical.
- **D.t9** — chat-surface widget rewrite. Add new widgets for the five intent-named tool outputs from `*PublicSchema` shapes; `inspiration` and `lead-capture` survive from D.t3 (rendering `illustrate` and `handoff`); `component-list` and `component-detail` deprecate alongside `search` / `get_detail`. ~1–2 days.

**Method discipline**: every Tier 3 plan above gets a "★ Read this first" pointer that calibrates the executing agent against theme 11 (top-down from sales, not bottom-up from data) before they touch code. The chunk-C plan's anchor section in [02-impl-retrieval-and-data.md](planning/02-impl-retrieval-and-data.md) is the canonical calibration text — refer to it from each Tier 3 brief.

### 1. Discovery design HITL [active thread; partly absorbed by C.t2 closure]

[planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) had merged C.t2 with G.t0 / G.t1 / G.t3 because those design questions were tangled. **C.t2's contract is now settled** outside the HITL doc — eight intent-named tools, five job-shaped derived tables, persona_summary natural-language shape, all in code at `product/ts-common/src/tools.ts` + `derived.ts` + production tool descriptions at `product/cms/prompts/tools/<tool>/description.md`. The HITL doc retains a 2026-04-29 supersession banner pointing readers at the new architecture. Remaining HITL outputs are now content-shaped, not contract-shaped:

- **G.t0** — Patagonia conversational-architecture spec (triage inflections, user-type differentiation, motivation anchoring, handoff triggers). HITL session with Al. Output: `planning/patagonia-conversational-architecture.md`.
- **G.t1** — first-pass WHY system prompt at `cms/prompts/system/00_why.md` (replacing the placeholder). Sibling style-avoid file already exists at `cms/prompts/system/10_style-avoid.md`.
- **G.t3** — ≥2 seed skill directories under `cms/prompts/skills/<skill-name>/SKILL.md` (ADK 1.0 directory format).
- **G.t5** — refinement pass when Luke + Lane's sales-thinking doc lands (~May 4).
- **E.t1 schema extension**: add `inconclusive` 4th verdict + per-verdict reason enum from §3.2 Path 7 (`low_engagement` / `mixed_signals` / `extended_no_convergence` / `comparison_shopping` / `off_offer_in_region` / `drive_by` / `inconclusive_other`).

### 2. Chunk C — Retrieval & data implementation [post-#0 plan authoring]

- **C.t0** ✅ done 2026-04-29 — local MariaDB inspection + 9 first-pass-overturning findings + ontology rewrite + 8 questions closed + 3 new questions raised. Plan + execution log: [planning/03-exec-c-t0.md](planning/03-exec-c-t0.md).
- **C.t2** ✅ done 2026-04-30 — entity model + tool I/O schemas + migrations 001–006 + production-quality tool descriptions + fixtures. C.26 graduated alongside; `find_someone_who` live; 2,563 customer reviews + 163 trip junctions in domain layer; customertip pending separate Swoop delivery. Plan + execution log: [planning/03-exec-c-t2.md](planning/03-exec-c-t2.md).
- **C.t1** — pending Tier 3 plan. See §0 above.
- **C.t3** — pending Tier 3 plan.
- **C.t3a** — pending Tier 3 plan. Carry forward Phase 1's load-bearing finding: aggregate by reviewer `name` before generating `persona_summary` (~80% of customerreview rows are short snippets that compose into coherent personas only when grouped by author).
- **C.t4** — pending Tier 3 plan.
- **C.t5** — pending Tier 3 plan (small).
- **C.t6** — pending Tier 3 plan; Phase 0 cost estimate ~£30–£150 one-time at ~$0.005/image Claude Vision over the ~6.3K images without upstream `image.description`.
- **C.t8** — pending Tier 3 plan; runbook authoring task.
- **Blog ingest** ✅ implemented; running in `@swoop/ingestion`. Per-post-classification at C.t3a.
- **Downstream augments**: B.t3a + D.t9 fan out from C.t4 in parallel.

### 3. Chunk G — Content (bulk) [~3–4 days incl. HITL session]

- **G.t0** — HITL conversational flow mapping with Al (Patagonia triage inflections, user-type differentiation, motivation anchoring, handoff triggers). Output: `planning/patagonia-conversational-architecture.md`.
- **G.t1** — WHY system prompt first pass at `cms/prompts/system/00_why.md` (replacing the placeholder). Sibling style-avoid file already exists at `cms/prompts/system/10_style-avoid.md` — Al's editorial pass partial, ongoing.
- **G.t3** — ≥2 seed skill directories under `cms/prompts/skills/<skill-name>/SKILL.md` (ADK 1.0 directory format).
- **G.t5** — Refinement pass when Luke + Lane's sales-thinking doc lands (~May 4).

### 4. Remaining chunk E — handoff-and-compliance follow-ups [~1–2 days]

E.t1 / E.t2 (interim) / E.t3 / E.t4 shipped. Still open:
- **E.t5** — Real legal copy authoring at `product/cms/legal/*` (disclosure-opening, chrome-badge, consent-handoff, privacy-info, etc.). Today's strings are placeholders inline in the components. **Hold until Q1/Q2/Q3 voice anchors land** — drafts now would be rewritten.
- **E.t6** — Retention enforcement. No cron / sweeper for the handoff store yet; `var/handoffs/` grows forever in dev. Swap into Postgres `DELETE … WHERE scheduled_deletion_at < NOW()` cron post-IAM.
- **E.t7** — **Data-deletion script** (was a runbook; now a `psql DELETE … WHERE email=…` script per C.18/E.10 Postgres lock-in). Operationally merges with the Art. 15 SELECT path for data-access requests — see E.t8 §08 HITL flag.
- **E.t8** ✅ skeleton landed 2026-04-29 — 12-file compliance-bundle scaffold at [product/cms/legal/compliance-bundle/](product/cms/legal/compliance-bundle/). 5 filled / 1 partial / 4 blocked / 1 empty (screenshots). Counsel review checklist landed. **Blocked-on**: E.t5 (3 files), Swoop legal sourcing (DPAs), real copy + screenshots (consent flow). Plan: [planning/03-exec-e-t8.md](planning/03-exec-e-t8.md).
- **E.t9** — Swoop's legal counsel review (external; gates M5). Tickable checklist ready in `09-review-checklist.md`.
- **Mailer flip-on**: when Julie confirms SMTP + sales inbox → set `HANDOFF_EMAIL_ENABLED=true` + supply `HANDOFF_EMAIL_FROM` / `HANDOFF_EMAIL_TO_QUALIFIED` / `SMTP_USER` / `SMTP_PASS`. Cross-field config refine ensures fail-fast at boot if any of those are missing while ENABLED.
- **Postgres swap (E.t2 proper)**: when GCP IAM lands → write `PostgresHandoffStore implements HandoffStore` → conditional instantiate in `index.ts`. Caller code unchanged.

### 5. Visitor-facing copy review [~1 day, HITL]

Belongs partly to chunk G + partly to E.t5. The copy displayed earlier in this work cycle (opening screen, chrome badge, privacy modal, lead-capture verdict intros, form labels, consent tickbox text, confirmation card, agent-facing handoff messaging, email body) is all still placeholder. Al's editorial pass needed before legal review.

### 6. Remaining chunk H — Validation harness [~2 days]

H.t1 (scaffold) + **H.t7 (living-evalset growth runbook, 2026-04-29)** shipped. H.t3 (assertion catalogue: 74 tests in harness now) appears to also be complete based on the test count + decisions H.14–H.16 in the log. Still open:
- **H.t4** — real evalset from the discovery-design-thinking HITL output (replaces the 10 stubs).
- **H.t5** — Claude Opus judge + Cohen's κ calibration.

### 7. Chunk B — Deferred remaining [~0.5–1.5 day]

B.t1a (multi-file prompt loader) shipped 2026-04-27. B.t10 (warm pool) shipped 2026-04-24 disabled-by-default. Still open:
- **B.t8** — Response-format parser (conditional; only if post-M1 real conversations surface the need).
- **B.t9** — Modular-guidance loader via ADK-native skill primitive (pairs with chunk G.t3). Folder structure already settled per G.11.
- **B.t11** — **Server-side session history projection endpoint** (unparked 2026-04-29). Original commit `6d31124` was nearly OK from an assistant-ui perspective but predates the C.18/B.22/E.10/C.23 Postgres lock-in — needs Postgres-aware retry framing. Pairs with D.t9 (UI-side rehydrate-on-mount).

### 7a. Side-quest persistence — W1 + W2 unparked [~1 day]

After observing in active mock-host use that **assistant-ui doesn't auto-rehydrate**, [01-side-quest-persistence.md](planning/01-side-quest-persistence.md) §5 W1 + W2 are unparked. Need to:
- Flip W1 + W2 in `01-side-quest-persistence.md` from "parked" to "active"
- Author Tier 3 plans for B.t11 (orchestrator history endpoint) + D.t9-mount-rehydrate (UI-side)
- Salvage shape from reverted commit `6d31124`
- Add `discoveries.md` entry: "assistant-ui doesn't auto-rehydrate — server history projection + client mount-time replay required"
- W4 storage medium stays at sessionStorage (settled).

### 8. M4 deployment

- Swoop-provided GCP "AI Pat Chat" IAM (blocked on Thomas Forster).
- Cloud Run deploys for orchestrator + connector (separate services); Cloud Run Job for ingestion.
- Session backend flips from in-memory → Vertex AI Session Service or Firestore.
- Handoff store flips from `FsHandoffStore` → `FirestoreHandoffStore`.
- Secrets via GCP Secret Manager.
- CI extended with `deploy.yml` workflow.

### 9. M5 ship

- Legal sign-off from Swoop's counsel.
- Iframe embed by Swoop's in-house team (Thomas/Richard).
- Brand styling (Swoop-owned).

---

## Open dependencies on Swoop

Tracked in [questions.md](questions.md). Blockers:

- **C.t0 follow-up** — original 3 questions, status as of 2026-04-30:
  - (a) ~~`customerreview`/`customertip` source tables MISSING from dump~~ ✅ **CLOSED for customerreview** — Swoop delivered `customerreview_tables_-_swoop-patagonia_prod.sql` on 2026-04-30 (2,563 reviews + 163 trip junctions; ingested in migration 006). **`customertip` remains pending** — separate Swoop ask outstanding; the 119 `contentblock_customertip` junction rows continue to dangle.
  - (b) confirm website renders `daybyday WHERE type='presale'` — open, route to Thomas/Richard.
  - (c) semantic confirmation of ~5 less-obvious `ntag` interest entries — open.
- **Patagonia sales-thinking doc** (Luke + Lane, ~May 4) — shapes chunk G.
- **GCP "AI Pat Chat" IAM** (Thomas) — required for M4 + the Firestore handoff-store swap.
- **Claude account tier confirmation** (Julie → Tom) — affects scraper cost routing in C.
- **Sales inbox + SMTP** (Julie) — flips the handoff mailer from off-by-default to live.
- **Legal counsel review** (Swoop-owned) — blocks M5.
- **Analytics platform preference** (Julie) — shapes F's schema and BigQuery export decision.

---

## Process gotchas to watch for

See full list in [gotchas.md](gotchas.md). The greatest hits:
- `dotenv({ override: true })` — Claude Code's shell injects empty `ANTHROPIC_API_KEY`.
- Haiku 4.5 model id: `claude-haiku-4-5-20251001` (NOT `-20250929`).
- Orchestrator restart → in-memory sessions die → clear `sessionStorage` + re-consent.
- `preview_stop` + `preview_start` if Vite modules get stuck.
- `HANDOFF_EMAIL_ENABLED=true` requires four other env vars present at boot — the cross-field refine fails fast.
- **Agent dispatch via `isolation: "worktree"` branches from `main`, NOT from the spawning agent's branch.** Every dispatched agent needs a hash-verification gate as its first action (`git rev-parse HEAD` must match an expected hash; if not, `git reset --hard <hash>` if commit exists in worktree's git, else HALT). Confirmed across 4 agents on 2026-04-29 — gate caught and self-recovered every time. Pattern documented; never dispatch without it.

---

## What NOT to do

- Don't touch the ChatGPT PoC at `chatgpt_poc/` — read-only reference (symlink to `~/Studio/projects/swoop/`).
- Don't inline content (prompts, brand copy, legal text, email bodies) in TypeScript — use `product/cms/`.
- Don't commit `.env` files or `var/handoffs/*.json` (the latter holds visitor PII; gitignored already).
- Don't hand back to Swoop without the legal counsel sign-off loop (M5 gate).
- Don't re-raise parked threads (Prompt Loom integration, Platform48 joint pitch) without Al explicitly reopening them — see `swoop` skill's "What not to do" section.
