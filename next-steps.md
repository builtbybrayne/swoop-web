# Next Steps — Swoop Web Discovery (Puma)

Prioritised resume guide. Read [progress.md](progress.md) first for state, [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching code.

---

## Status (2026-04-29 — overnight swarm landed)
M1 live + chunk D closed + mock-host shipped. Tonight's parallel agent swarm landed (commits `060f3da` → `fdd5cff`): **C.t0** SQL inspection (852 trips not 111; 9 first-pass-overturning findings; 8 questions closed), **E.t8** compliance-bundle skeleton (12 files), **H.t7** living-evalset growth runbook, blog ingest confirmed implemented. **HITL Q4 + Q5 closed**; Q1 expanded to all 10 tools. **Mock-host shipped + W1/W2 unparked** after observing assistant-ui doesn't auto-rehydrate.

**Tests**: 397/397 green across 6 workspaces — `@swoop/common` (43), `@swoop/orchestrator` (132), `@swoop/connector` (46), `@swoop/ui` (71), `@swoop/harness` (74), `@swoop/ingestion` (31).

**SQL dump loaded** into local MariaDB via `al`/`pick-a-password`; left up for ongoing inspection. Chunk C now gated on continuing the **discovery design HITL** at [00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md), out of which C.t2 (sales-shaped tool I/O + Postgres entity model) and Tier 3 plans for C.t1 / C.t3 / C.t3a / C.t4 fall. **Method note (top-down, not bottom-up): tools + system prompts + guidance must be designed as one coherent ensemble — don't pick off the data layer first.** See [00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) §5.

---

## Next up

### 0. Corpus content analysis [first thing next session]

Before any further chunk C tool-design work or sales-tag-taxonomy speculation, **inspect what the corpus actually contains**. Captured in detail at [inbox.md](inbox.md) 2026-04-30 entry. Headline targets:

1. **Blog content** at `data/blog/raw/<latest>/posts.ndjson` (102 posts, already fetched by `@swoop/ingestion`). Sample 20–50 random posts. Question: how much is genuine customer-narrative vs Swoop-staff-authored marketing? Is there a `recall_someone_who` corpus or do we repurpose?
2. **`trip.description` prose** in local MariaDB. Typical length, tone, content shape. Evocative or factual?
3. **`contentblock_*` subtype triage** in MariaDB. Which of the 14 subtypes beyond `customertip`/`customerreview` (the latter's source tables missing) carry useful prose?
4. **Image annotations** — random sample of the 47.5% with `image.description`. Quality check: alt-text-grade or rich enough to feed mood-filtered retrieval?

Outputs: short "blog content shape" + "trip prose shape" + "contentblock triage" addendum (probably in [data-ontology.md](data-ontology.md) or a sibling), plus refined sales-tag taxonomy grounded in observed content. **The chunk C plan rewrite + Tier 3 plans for C.t1/t3/t3a/t4 wait on this.**

Method note (now in [00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) §5): tool *bindings* come from corpus evidence, not assumption. Don't propagate up from the data shape, but don't propagate *into* the data layer without looking either.

### 1. Continue the discovery design HITL [active thread, post-inspection]

[planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) is the live HITL doc — it merges C.t2 (sales-shaped tool I/O + Postgres entity model) with G.t0 / G.t1 / G.t3 because those design questions are tangled. **Closed in §5 already**: Q5 (`inconclusive` 4th verdict approved), Q4 (main agent derives customer-type, NOT a Haiku post-classifier — the orchestrator is the most context-aware reasoner in the loop). **Q1 expanded** to walk all 10 tools (5 PoC carry-forward + 5 new sales-shaped) — the PoC tools have value (original thinking + UI widgets) but warrant refresh. **Method**: walk top-down from conversational arcs (visitor journeys, §3.2 path sketches, customer-type segmentation, motivation anchors). Tool I/O follows; Postgres entity model emerges last. Remaining outputs:

- Re-sketched 10 tools as a coherent ensemble (input/output shapes; WHY/HOW/WHAT × User/Agent/Swoop matrix per tool; per-tool composer-Haiku reasoning where applicable)
- First-pass G.t1 WHY system prompt at `cms/prompts/system/00_why.md`
- ≥2 seeded skills under `cms/prompts/skills/<name>/SKILL.md`
- Postgres entity model (falls out of "what hydrates each tool's output?")
- E.t1 schema extension: add `inconclusive` 4th verdict + per-verdict reason enum from §3.2 Path 7 (`low_engagement` / `mixed_signals` / `extended_no_convergence` / `comparison_shopping` / `off_offer_in_region` / `drive_by` / `inconclusive_other`)

### 2. Chunk C — Retrieval & data [~5–7 days after #1]

- **C.t0** ✅ done 2026-04-29 — local MariaDB inspection + 9 first-pass-overturning findings + ontology rewrite + 8 questions closed + 3 new questions raised (`customerreview`/`customertip` source tables MISSING from dump is the most material gap; route to Thomas/Richard). Plan + execution log: [planning/03-exec-c-t0.md](planning/03-exec-c-t0.md).
- **C.t1** — connector service skeleton + Postgres setup (Cloud SQL prod, Postgres.app dev — `al`/`pick-a-password` @ `:5432`).
- **C.t2** — entity model + sales-shaped tool I/O schemas (lands as design HITL output; #1 is the gate).
- **C.t3** — `export.sql` MariaDB → Postgres ETL (no LLM in the loop).
- **C.t3a** — embedding pass + sales-shaped derived entity population (`vibe_passage` / `customer_story` / `trust_proof`).
- **C.t4** — 10-tool implementations (5 PoC pass-through + 5 sales-shaped composer; composer prompts in `cms/prompts/tools/<tool>/composer.md`).
- **C.t5** — image URL utility + page-as-hub resolver (`buildImgixUrl`, `resolveImagesViaPage` in `@swoop/common`).
- **C.t6** — image annotation pipeline (parallelisable from C.t0; ~13K images via Claude Vision).
- **C.t8** — ETL + annotation runbooks for Swoop's internal team.
- **Blog ingest** — parallel stream per [planning/03-exec-blog-ingest.md](planning/03-exec-blog-ingest.md); independent of the SQL ETL, can run any time.
- **Downstream augments**: B.t3a (connector adapter wrappers for new tools) + D.t9 (widgets for new tool outputs) fan out from C.t4.

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

- **C.t0 follow-up** — 3 new questions from inspection routed to Thomas/Richard: (a) `customerreview`/`customertip` source tables MISSING from dump — intentional export filter or stale FKs? (b) confirm website renders `daybyday WHERE type='presale'`. (c) semantic confirmation of ~5 less-obvious `ntag` interest entries.
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
