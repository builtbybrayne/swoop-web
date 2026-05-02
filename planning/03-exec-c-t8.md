# 03 — Execution: C.t8 ETL + annotation runbooks

**Status**: **HITL-ratified 2026-05-01 — ready for execution.**
**Chunk**: C (retrieval & data).
**Implements**: [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §10 — the **C.t8** task ("ETL + annotation runbooks for Swoop"). Operationalises the "hand-off clarity" architectural principle (the connector + Postgres is the operational surface Swoop's team will eventually own; clean boundary, clear ops handbook). Companion runbook to the existing `evalset-growth.md` (per H.t7) — same `product/cms/ops/` home, same operator-facing tone.
**Depends on**: C.t1 closed (connector + Postgres pool), C.t3 closed (`export.sql` SQL-dump → Postgres transform), C.t3a closed (embedding pass + Haiku ETL classifiers), C.t4 closed (eight-tool handlers), C.t5 closed (image URL utility), C.t6 closed (image annotation pipeline). C.t8 is the *last* chunk-C task because it documents the operational surface those tasks ship.
**Blocks**: M5 ship — Swoop's internal team can't operate Puma without this.
**Produces**:
- `product/cms/ops/etl-rerun.md` — operator runbook for re-running the SQL-dump → Postgres transform when source data changes.
- `product/cms/ops/embedding-rerun.md` — operator runbook for re-running the embedding + classifier pass.
- `product/cms/ops/image-annotation.md` — operator runbook for running the image annotation pipeline (cost preview, dry-run, partial-by-tag).
- `product/cms/ops/migrations.md` — operator runbook for running, rolling forward, and recovering from Postgres migrations (`node-pg-migrate` operational story).
- `product/cms/ops/troubleshooting.md` — symptom-driven recovery guide spanning all four runbooks above.
- `product/cms/ops/README.md` — index linking the runbooks (existing file already lists `evalset-growth.md`; append the new four).
- Decision-log entries (`planning/decisions.md`) — likely C.41 (audience: who exactly is the runbook target), C.42 (where monitoring lives — Cloud Logging vs local-only at first), and C.43 (cadence assumptions: when does Swoop's team re-run each pipeline).
**Estimate**: ~0.5 day. The work is documentation, not authoring net-new logic — every runbook describes a pipeline that already runs by the time C.t8 starts. Cost is in operator-friendly framing, screenshot capture (where useful), and surfacing the failure modes that earlier tasks didn't write down.

---

## ★ Read this first — calibration before code

> **Before you write a single runbook step, read [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) §"★ Read this first — the WHY of chunk C" end-to-end.** Even a documentation task lands top-down. The discipline matters here especially because runbook writing tempts you to start from "what does the pipeline do?" — which is bottom-up.

The compressed reminder for C.t8 specifically:

- **The runbooks exist to serve a journey moment for the operator, not to document the pipeline.** When Swoop's ops engineer (Thomas / Richard / a future hire) shows up on a Tuesday morning to *"check why yesterday's data ingest didn't refresh"*, they need a runbook that gets them from symptom to recovery in under fifteen minutes. They don't need a system architecture lecture. They don't need to read C.t3's Tier 3 plan. They need *"here's the symptom, here's the command, here's how you know it worked"*.
- **The bottom-up trap here**: *"Document every command and option exhaustively so the runbook is comprehensive."* Wrong direction. Comprehensive runbooks are unread runbooks. The right shape: each runbook covers the 3–5 operations Swoop's team actually does, in operator-task order, with screenshots / one-liners / paste-ready commands. Edge cases get a small "when things go wrong" section, not a 40-line table of every flag.
- **The other bottom-up trap**: anchoring the runbook on Puma's internal architecture (workspaces, decisions log, planning docs). Operators don't care about decision IDs. They care about: *"my command failed, what now?"* The runbook can mention `decisions.md` once, in a "where do design decisions live" pointer for the curious, but the body is operator-task-shaped.
- **The runbooks are content** (G.11). They live in `product/cms/ops/` with the existing `evalset-growth.md`. Iteration is content work — Swoop's team can edit them post-handover.

Anti-pattern signals to push back on, hard:

- *"Let's document the pipeline architecture first, then layer operator tasks on top."* — Wrong. Operator tasks first. Architecture is one short pointer at the bottom.
- *"This runbook should be self-contained — every command, every option, every concept defined."* — Wrong. Cross-link to other runbooks; assume operator can read the existing `evalset-growth.md` for tone/shape.
- *"We need to handle every failure mode."* — No. Cover the 3–5 failure modes that have actually been observed (or that are obvious; e.g. Postgres connection refused). New failures get added when they happen.
- *"Operators should understand decision-log rationale before running anything."* — They shouldn't. Rationale is for plan-readers. Runbooks are for runners.

---

## Purpose

C.t8 ships the operational handover surface. Every chunk-C pipeline (`export.sql` → Postgres; embedding pass; image annotation; migrations) is a Cloud Run Job (or a one-shot Node CLI in dev). C.t8 documents *how to run them, when to run them, and what to do when they break*.

The runbooks are the "hand-off clarity" architectural principle made concrete. Without them, every operational question routes back to Al ("how do I re-run the embed pass after the dump refreshes?"); with them, Swoop's ops team can do their own work.

The companion runbook for context: `product/cms/ops/evalset-growth.md` (shipped 2026-04-29 per H.t7). It's the tonal benchmark — operator-task ordering, visible-from-the-top-of-the-page commands, *"open this alongside the runbook in a tab"* pragmatism. Don't overthink the C.t8 set; match its shape and tone.

---

## Out of scope

- **No authoring of new pipelines**. Every pipeline documented by C.t8 was shipped in C.t1 / C.t3 / C.t3a / C.t6. C.t8 only documents.
- **No CI / GitHub Actions configuration**. Cloud Run Job scheduling and CI workflow files belong elsewhere (M4 deploy work).
- **No monitoring infrastructure**. Whether logs end up in Cloud Logging or Sentry or Datadog is open question 2; C.t8 documents the chosen path, doesn't build it.
- **No incident response process**. Severity grading, escalation paths, on-call rotation — out. C.t8 covers operator-side troubleshooting, not org-side process.
- **No legal compliance docs**. The compliance bundle at `product/cms/legal/compliance-bundle/` (per E.t8) is a separate workstream; C.t8 doesn't reach there.
- **No Docker Compose / local-parity work**. The handoff `docker-compose.yml` per chunk-C plan §2.5 is the C.t1 task's slot; C.t8 references it.

---

## Inputs (files to read before authoring)

- [`02-impl-retrieval-and-data.md`](02-impl-retrieval-and-data.md) — especially §1 (outcomes, particularly "Swoop's internal team can run the ETL"), §2.1 (data ingestion), §2.7 (image annotation pipeline), §10 (Tier 3 hand-off).
- All four sibling C.t* execution plans + their execution logs (each one's *open questions* and *risks* sections list the operational gotchas worth surfacing in runbooks).
- [`03-exec-c-t2.md`](03-exec-c-t2.md) — entity model + migrations 001–006 reference.
- [`product/cms/ops/evalset-growth.md`](../product/cms/ops/evalset-growth.md) — tone/shape reference. Match this.
- [`gotchas.md`](../gotchas.md) — every non-obvious environmental trap an operator might hit (Postgres.app v18 binary path, dotenv override, model IDs, npm workspaces empty-package quirk). Cherry-pick the chunk-C-relevant entries into runbook bodies.
- [`discoveries.md`](../discoveries.md) — non-obvious architectural truths an operator might trip over (page-as-hub fallback, two-table image model, source-data dump cadence assumptions).
- [`decisions.md`](decisions.md) — pointer-only; runbook bodies don't lecture from the decision log.
- [`questions.md`](../questions.md) — open Swoop dependencies (SMTP, IAM, customertip pending) that affect runbook content.
- `chatgpt_poc/sales docs/extracted/tone of voice.md` — Swoop's brand voice reference (operator-facing prose still represents Puma; should not contradict Swoop's voice elsewhere).

---

## Outputs (files to write/modify, with paths)

### CMS ops directory

`product/cms/ops/`:

| File | Length target | Purpose |
|---|---|---|
| `etl-rerun.md` | ~200–300 lines | Operator runbook for re-running the SQL-dump → Postgres transform when source data changes. |
| `embedding-rerun.md` | ~150–250 lines | Operator runbook for re-running the embedding + classifier pass. |
| `image-annotation.md` | ~150–250 lines | Operator runbook for running the image annotation pipeline. |
| `migrations.md` | ~100–200 lines | Operator runbook for running, rolling forward, and recovering from Postgres migrations. |
| `troubleshooting.md` | ~150–250 lines | Symptom-driven recovery guide spanning all four pipelines + the orchestrator/connector itself. |
| `README.md` | ~50 lines | Index. Append the new four to the existing `evalset-growth.md` entry. |

Each runbook starts with the same `evalset-growth.md`-shaped header — a one-paragraph purpose, "what you'll do every time", cadence + ownership, then numbered operator-task steps.

### Each runbook's required sections

Every chunk-C runbook (`etl-rerun.md`, `embedding-rerun.md`, `image-annotation.md`, `migrations.md`) covers:

1. **Why this exists** — one paragraph naming the journey moment for the operator (when do they reach for this runbook). Don't lecture about the pipeline.
2. **What you'll do every time** — numbered operator-task list, 4–7 items. *"Pull the latest dump → land it at `data/<dump-name>.sql` → run the transform → check the row counts → confirm tools still respond"*.
3. **Cadence + ownership** — when this runs (event-triggered vs scheduled), who runs it (Thomas / Richard / Al until handover), how long it takes.
4. **Step-by-step** — paste-ready commands per step, expected output, "you'll know it worked when…" markers.
5. **When things go wrong** — 3–5 failure modes from real experience. Each: symptom → diagnosis → fix.
6. **Cost preview** (where applicable — embedding-rerun + image-annotation specifically) — one-liner that estimates cost before spending.
7. **Open items for Al** — visible at the bottom; persists until each is resolved. Mirrors the `evalset-growth.md` pattern.

### `troubleshooting.md` — slightly different shape

Symptom-indexed: *"`/chat` returns 500 with `connection refused`"* → *"connector or Postgres down; check connector health; restart if needed; verify connection pool"*. Cross-references the per-pipeline runbooks for deeper recovery.

Sections:
1. **How to use this** — symptom-first. If you don't see your symptom here, escalate to Al / file an issue.
2. **Connector won't start** — Postgres unreachable, port collision, secret-manager auth fail.
3. **Tool calls returning empty results** — empty derived tables (re-run ETL); embeddings missing (re-run embedding pass); index corrupted (re-index).
4. **`/handoff/submit` failing** — handoff store path missing, mailer config incomplete, SMTP auth fail.
5. **ETL run hangs** — deadlock, dump file truncated, source schema drift.
6. **Annotation run hangs / overspends** — rate-limit, network, cost-cap not configured.
7. **Migration fails halfway** — manual rollback path; when to drop and re-create.
8. **General "where do I look first?"** — Cloud Logging path, log filename conventions, how to share a log dump with Al.

### `README.md` update

Append to the existing `product/cms/ops/README.md` — the new five entries listed alongside `evalset-growth.md`. Each entry is one line: filename + one-sentence purpose + a *"start here when…"* trigger.

### Decision log

`planning/decisions.md` — likely three entries:

- **C.41** — Audience. Recommended: assume the runbook reader is an operator who's never opened the codebase but is comfortable in a terminal. Not Al; not a designer; not a manager. Records the call so future agents writing more runbooks calibrate to the same audience.
- **C.42** — Where monitoring lives. Cloud Logging is the canonical destination once Cloud Run deploy lands; local stdout in the meantime. Records the call + how runbooks reference it ("once Cloud Logging is live, replace the local-stdout instructions with…").
- **C.43** — Cadence assumptions. Recommended: ETL re-run is event-triggered (when Swoop sends a fresh dump); embedding pass runs after every ETL re-run; image annotation runs once at handover + on-demand for new image batches; migrations run when a forward-only schema change lands. Records the call.

---

## Architectural principles applied here

- **Operator-task shape, not pipeline-architecture shape**. Each runbook starts from *"what's the operator about to do?"*, not *"what does this pipeline contain?"*. Match `evalset-growth.md`.
- **Paste-ready commands, expected output, success markers**. Every step has a one-liner the operator can copy. Every step has a *"you'll know it worked when…"* assertion. No hand-waving.
- **Failure modes from real experience**. Each runbook's "When things go wrong" section pulls only from observed failures (or the obvious-and-cheap-to-document ones like *"Postgres connection refused"*). Don't speculate.
- **Cross-link, don't repeat**. ETL runbook references migrations runbook for any schema-touching step; troubleshooting runbook references the four task runbooks. One source of truth per concept.
- **Living document posture**. Operators iterate them post-handover. The runbooks live in `cms/`, not `planning/`, precisely because content management surfaces are owned by Swoop's team eventually.
- **Voice consistency**. Runbook prose stays in Swoop's brand voice (warm, expert, honest about uncertainty). No corporate-ops jargon. No emoji unless `evalset-growth.md` has set the precedent (it hasn't).

---

## Components, file paths

| Component | Path | Existing or new |
|---|---|---|
| ETL re-run runbook | `product/cms/ops/etl-rerun.md` | New |
| Embedding re-run runbook | `product/cms/ops/embedding-rerun.md` | New |
| Image annotation runbook | `product/cms/ops/image-annotation.md` | New |
| Migrations runbook | `product/cms/ops/migrations.md` | New |
| Troubleshooting runbook | `product/cms/ops/troubleshooting.md` | New |
| Index | `product/cms/ops/README.md` | Existing — append |
| Tone benchmark | `product/cms/ops/evalset-growth.md` | Existing — read-only here |
| Decision-log update | `planning/decisions.md` | Existing — append |

No code changes. No tests (documentation isn't tested at unit level; verification is "an operator can follow it cold and succeed").

---

## Verification

Task is done when:

1. All five new runbook files exist at the paths above.
2. Each runbook has the required sections (purpose, cadence + ownership, step-by-step, failure modes, open items for Al where applicable).
3. `product/cms/ops/README.md` lists all six runbooks (the four new task-specific + the new troubleshooting + the existing evalset-growth).
4. **Cold-read test**: Al — or a future agent simulating the operator — reads each runbook end-to-end without prior context and can describe what they'd do step-by-step. The "would the operator be able to act?" question lands cleanly.
5. **Cross-reference audit**: every runbook that references a sibling runbook does so with a relative-path link that resolves. Every gotcha referenced from `gotchas.md` actually exists there.
6. **Brand-voice audit**: prose stays out of em-dash rhythm, AI-tells, and corporate-ops jargon. Run grep for *"unpack" / "delve" / "dive into" / "leverage" / "synergy"* — zero matches.
7. **Length budget audit**: each runbook within its target range. Going over isn't fatal; 50% over flags that the runbook's reaching for completeness rather than operator-task focus — re-cut.
8. `planning/decisions.md` has C.41–C.43 entries (or whatever is closed at execution time).
9. Execution log appended to this Tier 3 plan summarising what landed.

---

## Open questions for execution time

Numbered for tracking. Items 1 + 2 are HITL calls Al should close before the executing agent starts.

1. **Audience: who exactly is the runbook target?** Candidates:
   - **Thomas Forster / Richard Ault** at Swoop — known names, known tooling familiarity (Thomas is the IAM gate-keeper; Richard is closer to the CMS surface). Recommended.
   - **Generic "Swoop ops engineer"** — cleaner if ownership shifts post-handover.
   - **Operator who's never seen the codebase** — most defensive; runbooks need to be more thorough, slower to write.

   Recommendation: address to "the harness owner" / "the ETL operator" — *role-based, not name-based* (matches `evalset-growth.md`'s convention of "currently Al; Thomas/Richard at handover"). C.41 records the call.

2. **Where does monitoring live**? Candidates:
   - **Cloud Logging only** — canonical destination post-M4. Runbooks describe Cloud Logging filters; in dev, replace with stdout.
   - **Local-only at first** — simpler runbook now; needs revisit post-M4.
   - **Cloud Logging + a small dashboard** — overkill for M1.

   Recommendation: Cloud Logging structured the right way; runbooks have a "during dev / pre-deploy" callout for stdout. C.42 records the call.

3. **Should each runbook's cost preview live as a CLI flag** (e.g. `--cost-preview`) or as a separate runbook section? Recommendation: CLI flag where the pipeline already supports it (image annotation does per C.t6); section-only otherwise (ETL doesn't have direct cost — the dump is free; embedding pass cost is one Voyage call per chunk; cheap and predictable).

4. **Migrations runbook scope: forward-only or document the rollback path?** Per C.31, migrations are forward-only — derived store is throwaway. But the runbook should still document the *recovery path* when a migration partially fails: drop the database, re-run all migrations forward, re-run ETL. *"Recovery is not a rollback; it's a rebuild."* Recommendation: document the rebuild path explicitly so operators don't reach for `node-pg-migrate down`.

5. **Should troubleshooting include orchestrator/connector startup issues**, or scope to chunk-C pipelines only? Recommendation: include them — the operator hits *"`/chat` returns 500"* and doesn't care which chunk owns the failure. Scope by symptom, not by chunk. The orchestrator team can extend the troubleshooting doc with their own symptoms post-launch.

6. **Should the runbooks include "how to roll back a bad embedding-prompt revision"?** I.e. a re-run with the old prompt overwrites the new one. Recommendation: yes, brief. C.t6's per-prompt-version checkpoint mention belongs here.

7. **Cadence of re-runs**. Open question for Swoop ops:
   - How often will Swoop send a fresh SQL dump? Weekly assumed; depends on Swoop's process.
   - Will image batches arrive incrementally or in big drops?
   - Are migrations expected to land in batches or one-by-one?

   The runbooks document the *current* assumptions and link to `questions.md` for the open Swoop dependencies. C.43 records the assumption set.

---

## Risks

- **Runbooks describe pipelines that haven't stabilised**. If C.t3 / C.t3a / C.t6 land within days of C.t8, the runbooks may codify behaviour that drifts. Mitigation: C.t8 is *the last task in chunk C* — it runs against settled pipelines, not in-flight ones. Sequencing matters.
- **Comprehensive trap** — runbooks bloat past the operator-task budget into pipeline-architecture exposition. Mitigation: target lengths (200–300 lines), tone benchmark (`evalset-growth.md`), grep audit for AI-jargon.
- **Operator readability blind spot** — Al writes the runbooks; Al has all the context; Al can't tell what's operator-readable. Mitigation: cold-read test (verification step 4); ideally a Swoop-side reader (Thomas / Richard) reviews before handover, not after.
- **Runbooks reference paths that move** — e.g. `product/orchestrator/var/handoffs/` becomes Postgres at E.t2 proper. Mitigation: per-runbook "open items for Al" section flags the moving paths so updates land alongside the migration.
- **Failure-mode lists become trivia trees**. Mitigation: only document modes seen in real runs (or obvious cheap ones). New failures get appended when observed; the runbook is a living doc.
- **Cost previews drift from real costs** — the preview formula bakes in current API rates; rates change. Mitigation: cost-preview commands print a "rates as of [date]" footer; operator updates the constants in `cost.ts` when rate change material.
- **Brand-voice slip** — operational documentation is the easiest place to slide into corporate-ops jargon. Mitigation: explicit grep audit (verification step 6).

---

## Coordination

- **Sibling C.t* tasks** — C.t8 reads each one's execution log and risks section; failure modes named there become runbook entries. Sequence: C.t8 starts after the others land and stabilise.
- **H.t7 (`evalset-growth.md`)** — tone + shape benchmark. Match its conventions.
- **E.t7 (data-deletion script)** — when shipped, the script's runbook is a sibling of these four. C.t8 doesn't author it (chunk E owns it), but the troubleshooting doc points at it.
- **M5 ship gate** — Swoop's legal counsel review (E.t9) is independent; M5 also requires Swoop's ops team having usable runbooks. C.t8 is one of the M5 enabling artefacts.
- **Future runbooks** — the convention C.t8 sets (`product/cms/ops/<topic>.md`, operator-task-shaped, failure-mode appendix, open-items-at-bottom) is the convention for any future runbook (e.g. orchestrator deploy runbook, monitoring-alert runbook).

---

## Execution log

*(Appended by the executing agent post-execution. Format: dated entries, what landed, what was deferred, what surfaced for downstream tasks.)*

### 2026-05-02 — C.t8 landed; chunk C closed

Seven docs-only commits authored against the merge tip carrying the entire chunk-C spine (C.t1 + C.t3 + C.t3a + C.t4 + C.t5 + C.t6 fold + H1/H2 helpers).

**Files landed** (all under `product/cms/ops/`):

- `etl-rerun.md` — operator runbook for re-running the SQL-dump → Postgres transform. Covers expected row counts (852 trips / 79 tags / 13K images / 906 FAQ / 2,160 customer reviews), idempotency, page self-FK two-pass write, FK-orphan policy, within-batch UNIQUE-column dedupe, parity check against the live Swoop website.
- `embedding-rerun.md` — operator runbook for re-running the Voyage-3 embedding pass + Haiku batch classifiers. Covers `--mode={embed,classify,compose,all}`, `--source=<corpus>`, `ENRICH_BUDGET_GBP` cap (£10 dev / £15 prod), £5 soft warning, batch-boundary kill-switch, anonymous-customerreview exclusion (HITL Q3), prompt-version invalidation via `content_hash`, link to Anthropic Batches API docs.
- `image-annotation-rerun.md` — operator runbook for the C.t6 Vision pipeline. Covers dry-run default, `--max-budget=N` (USD, distinct from embedding-rerun's GBP), 6-output structure (description + annotation + 4 tag arrays per fold C.40), upstream-`image.description` skip (~6,300 of 13K images), batches-mode caveat (request-build verified, submission deferred), checkpoint-resume.
- `migration-management.md` — operator runbook for `node-pg-migrate` operations. Covers `npm run migrate:up`, "Can't determine timestamp for NNN" benign warnings (per C.t1 finding), forward-only posture (C.31), full-rebuild recovery path, adding new migrations with `IF NOT EXISTS` guards.
- `troubleshooting.md` — symptom-indexed recovery guide. Covers connector boot failures (DATABASE_URL validation, port collision, pgvector missing, /readyz 503), orchestrator-can't-reach-connector, empty-tool-results triage (derived tables empty / embeddings missing / filter mismatch), ETL slow runs, Vision-pipeline budget overrun, migration-failed-halfway, stale-node_modules false-green, `npm dev` SIGTERM doesn't kill `tsx` (per C.t1 finding), Cloud Logging vs stdout per C.45.
- `prompt-version-rollback.md` — brief runbook for reverting a bad prompt-version bump using per-prompt-version checkpoint namespacing (per HITL Q6).
- `README.md` — index linking all seven runbooks (six new + existing `evalset-growth.md`); voice-coherent conventions section.

**Decisions logged** in `planning/decisions.md`:

- **C.43** — Re-run cadence assumptions (event-triggered ETL, embedding-after-ETL, on-demand image annotation, migration-on-schema-change).
- **C.44** — Operator-runbook audience: role-based, not name-based.
- **C.45** — Monitoring lives in Cloud Logging post-M4, stdout in dev.

(Note: the plan body proposed C.41–C.43; those slots had been taken by C.t5 execution between plan authoring and execution time. Re-numbered to C.43–C.45 to keep the log monotone — same rationale captured in C.38/C.39 in the same log.)

**Voice-coherence audit**:
- Grep for AI-jargon (`unpack` / `delve` / `dive into` / `leverage` / `synergy` / `streamline` / `robust` / `seamless` / `cutting-edge` / `landscape` / `realm` / `tapestry` / `in the world of`) across all seven runbooks: zero matches.
- Cross-reference audit: README links resolve; body cross-references use plain filename references that resolve in the ops directory.
- Tonal benchmark match: each runbook has the same evalset-growth.md-shaped header (purpose / what you'll do / cadence + ownership / step-by-step / failure modes / open items for Al / where the rules came from). Sampled one operator scenario from each runbook (e.g. "I just received a fresh dump"; "the agent's returning empty results"); each scenario routes cleanly to the relevant section.

**Verification**:
- All six runbook files at `product/cms/ops/` plus the README index — confirmed via `ls`.
- `planning/decisions.md` has C.43 + C.44 + C.45 entries.
- `npm run typecheck --workspaces --if-present` (sanity check; this is a docs-only task) — green.

**Deviations from plan**:
- File names match the briefing (`migration-management.md` / `image-annotation-rerun.md` / new `prompt-version-rollback.md`) rather than the plan body's earlier names (`migrations.md` / `image-annotation.md` / no separate prompt-rollback runbook). The briefing's names are more explicit and don't conflict with the plan's intent.
- Decision-log numbering shifted C.41–C.43 → C.43–C.45 because of intervening C.t5 work that took the original slots. No semantic change.

**Chunk C status after C.t8**: chunk-C spine complete. Downstream B.t3a (orchestrator's connector-adapter rewrite) and D.t9 (chat-surface widget rewrite) can begin against a known-good real-data substrate.

---

## 2026-05-01 HITL ratification

Open questions resolved per Al's HITL session 2026-05-01. Status flipped from DRAFT to ready-for-execution.

### Resolutions

1. **Audience** (Q1): **role-based**. Use generic role labels ("ETL operator" / "harness owner") rather than named individuals. Ages better when staffing changes.
2. **Monitoring location** (Q2): Cloud Logging post-M4, stdout in dev. As recommended.
3. **Cost-preview placement** (Q3): CLI flag where pipeline supports, section otherwise. As recommended.
4. **Migrations rollback scope** (Q4): document rebuild path explicitly (forward-only per C.31, recovery is rebuild not rollback). As recommended.
5. **Troubleshooting scope** (Q5): include orchestrator/connector startup symptoms (operator hits symptoms, not chunks). As recommended.
6. **Prompt-version rollback** (Q6): yes, brief, per-prompt-version checkpoint namespace. As recommended.
7. **Re-run cadence assumptions** (Q7): tracked in `questions.md` for ongoing Swoop dependencies.

### Notes for the executing agent

- All seven resolutions accept the agent's recommendations from the plan body. Author the runbook accordingly.
- Voice-coherent with `evalset-growth.md` already at `product/cms/ops/`. Same role-based framing.
