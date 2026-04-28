# Next Steps — Swoop Web Discovery (Puma)

Prioritised resume guide. Read [progress.md](progress.md) first for state, [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching code.

---

## Status (2026-04-28)
M1 live + chunk D closed. Today's work landed in two waves: **G.11 / B.t1a** (CMS folder restructure + multi-file system-prompt loader) and **E.t2 / E.t3 / E.t4** (`@swoop/connector` workspace populated; durable handoff store as interim file-backed; verdict-aware mailer off-by-default; `POST /handoff/submit` endpoint wired end-to-end).

**Tests**: 311/311 green across 5 workspaces — `@swoop/common` (43), `@swoop/orchestrator` (132), `@swoop/connector` (46), `@swoop/ui` (71), `@swoop/harness` (19). Full workspace typecheck clean.

**SQL dump arrived** Mon 2026-04-27 — `data/content-data-swoop-patagonia_prod.sql` (already gitignored). Tier 2 rewrite + Julie-call decisions landed 2026-04-28 (see [decisions.md](planning/decisions.md) C.13–C.23 + B.22 + E.10; rewrite at [02-impl-retrieval-and-data.md](planning/02-impl-retrieval-and-data.md)). Chunk C is now gated on continuing the discovery design HITL at [00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md), out of which C.t2 (sales-shaped tool I/O + Postgres entity model) and Tier 3 plans for C.t1 / C.t3 / C.t3a / C.t4 fall.

---

## Next up

### 1. Continue the discovery design HITL [active thread]

[planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) is the live HITL doc — it merges C.t2 (sales-shaped tool I/O + Postgres entity model) with G.t0 / G.t1 / G.t3 because those design questions are tangled. §4 of that doc lists 6 open questions for the next session. Closing them produces:

- Re-sketched 5 sales-shaped composer tools (input/output shapes; WHY/HOW/WHAT × User/Agent/Swoop matrix per tool; per-tool composer-Haiku reasoning)
- First-pass G.t1 WHY system prompt at `cms/prompts/system/00_why.md`
- ≥2 seeded skills under `cms/prompts/skills/<name>/SKILL.md`
- Customer-type derivation mechanism (recommendation: Haiku post-classifier at handoff submit)
- Decision on the proposed 4th `inconclusive` verdict
- Postgres entity model (falls out of "what hydrates each tool's output?")

### 2. Chunk C — Retrieval & data [~5–7 days after #1]

- **C.t0** — load dump into local MariaDB + clarifying SELECTs (can start immediately; not blocked on #1).
- **C.t1** — connector service skeleton + Postgres setup (Cloud SQL prod, Docker Compose for handoff parity).
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
- **E.t5** — Real legal copy authoring at `product/cms/legal/*` (disclosure-opening, chrome-badge, consent-handoff, privacy-info, etc.). Today's strings are placeholders inline in the components.
- **E.t6** — Retention enforcement. No cron / sweeper for the handoff store yet; `var/handoffs/` grows forever in dev. Swap into Firestore TTL semantics post-IAM.
- **E.t7** — Data-deletion runbook for the durable store backend.
- **E.t8** — Compliance bundle for legal counsel (disclosure copy, consent flow screenshots, retention policy, processor list, DPAs, data flow diagram).
- **E.t9** — Swoop's legal counsel review (external; gates M5).
- **Mailer flip-on**: when Julie confirms SMTP + sales inbox → set `HANDOFF_EMAIL_ENABLED=true` + supply `HANDOFF_EMAIL_FROM` / `HANDOFF_EMAIL_TO_QUALIFIED` / `SMTP_USER` / `SMTP_PASS`. Cross-field config refine ensures fail-fast at boot if any of those are missing while ENABLED.
- **Firestore swap (E.t2 proper)**: when GCP IAM lands → write `FirestoreHandoffStore implements HandoffStore` → conditional instantiate in `index.ts`. Caller code unchanged.

### 5. Visitor-facing copy review [~1 day, HITL]

Belongs partly to chunk G + partly to E.t5. The copy displayed earlier in this work cycle (opening screen, chrome badge, privacy modal, lead-capture verdict intros, form labels, consent tickbox text, confirmation card, agent-facing handoff messaging, email body) is all still placeholder. Al's editorial pass needed before legal review.

### 6. Remaining chunk H — Validation harness [~2 days]

H.t1 (scaffold) shipped. Still open:
- **H.t3** — assertion catalogue (tool-call, triage-verdict, handoff-event, disclosure, refusal). Imports from `@swoop/common/events` (now stable after F-b).
- **H.t4** — real evalset from G.t0's HITL output (replaces the 10 stubs).
- **H.t5** — Claude Opus judge + Cohen's κ calibration.
- **H.t7** — living-evalset runbook (real conversations feed new scenarios).

### 7. Chunk B — Deferred remaining [~0.5 day]

B.t1a (multi-file prompt loader) shipped 2026-04-27. B.t10 (warm pool) shipped 2026-04-24 disabled-by-default. Still open:
- **B.t8** — Response-format parser (conditional; only if post-M1 real conversations surface the need).
- **B.t9** — Modular-guidance loader via ADK-native skill primitive (pairs with chunk G.t3). Folder structure already settled per G.11.

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

- **C.t0 clarifying SELECTs** — the residual semantic questions (`tripvariant` / `season` / `daybyday` revision logic / `contentblock_*` triage) that resolve by inspection, not by Swoop input.
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

---

## What NOT to do

- Don't touch the ChatGPT PoC at `chatgpt_poc/` — read-only reference (symlink to `~/Studio/projects/swoop/`).
- Don't inline content (prompts, brand copy, legal text, email bodies) in TypeScript — use `product/cms/`.
- Don't commit `.env` files or `var/handoffs/*.json` (the latter holds visitor PII; gitignored already).
- Don't hand back to Swoop without the legal counsel sign-off loop (M5 gate).
- Don't re-raise parked threads (Prompt Loom integration, Platform48 joint pitch) without Al explicitly reopening them — see `swoop` skill's "What not to do" section.
