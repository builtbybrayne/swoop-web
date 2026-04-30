# State-of-Play Review — Swoop Web Discovery (Puma)

**Date**: 2026-04-30
**Author**: 12-expert parallel council with synthesis
**Trigger**: Alastair's HITL request for an independent sanity check after ~10 days of intensive parallel-agent build, heavy decision churn, and a perception that data ingestion was forcing aspirational decompositions to recouple
**Status**: complete; close-out patches landing alongside (`inconclusive` 4th verdict, Firestore sweep, discovery-design-thinking body fixes)

---

## How this was produced

12 parallel sub-agents, each with a tight self-contained brief and the same evidence corpus (orientation files + planning corpus + product code + decisions log). Each produced a structured findings report (≤800 words, severity-rated 🟢/🟡/🔴). The synthesis below collapses ~9000 words of council output into a working summary.

The council was deliberately **not** decomposed along the planning chunks (A–H), to avoid ratifying that partition. Three orthogonal lens clusters were used: drift-detection (lenses 1–5), coupling/architecture/method (6–8), forward-risk (9–12).

| # | Lens | Verdict |
|---|---|---|
| 1 | Plan-vs-State Drift Auditor | 🟡 → 🟢 (post-customerreview-agent doc refresh) |
| 2 | Internal Coherence Checker | 🟡 |
| 3 | Tier-3-vs-Code Drift Detector | 🟢 |
| 4 | Decision-Log Coherence Auditor | 🟡 |
| 5 | Stale Reference Hunter | 🔴 → 🟢 (post-patches) |
| 6 | Data ↔ Tool Coupling Critic | 🟡 (improved on `find_someone_who` post-C.26) |
| 7 | Architecture Cohesion Reviewer | 🟡 |
| 8 | Method-Note Compliance Auditor | 🟡 |
| 9 | Scope / Critical-Path Reality Check | 🟡 (calendar-flavoured) |
| 10 | Premortem / Devil's Advocate | 🔴 (forward) |
| 11 | Quality-Bar Verifier | 🟡 |
| 12 | Compliance + External Dependencies | 🟡 (with 🔴 thread on legal SLA) |

---

## Headline verdict

**Not gyrating off-rails.**

The wobbles are real but the system keeps detecting and self-correcting them. Severity inventory:
- **2 🔴 close-out items** (closed alongside this review): inconclusive 4th verdict propagation; Firestore staleness sweep
- ~14 🟡 watch items, no individual blocker
- Strong 🟢 baseline: M1 verified live; 397+ tests passing; 3 of 3 audited Tier 3 plans matched code with high fidelity; decision-log discipline exemplary; tool descriptions journey-anchored

The single biggest forward risk is **calendar**, not drift: HITL bottleneck through one human (Al) against the 2 Aug 2026 EU AI Act cliff with an unknown Swoop legal SLA.

The system has been catching its own drift. Three exemplary self-corrections in evidence:
1. Composer-pattern reversal (C.24, 2026-04-29) — bottom-up reasoning detected within 24 hours of being introduced
2. C.t2 `find_someone_who` description over-execution caught in spec-compliance review pass
3. Worktree-base hash-verification gate caught all 4 dispatched-from-stale-main agents

The customerreview ingest agent that landed 2026-04-30 demonstrated Phase-1-inspect → Phase-2-graduate, the textbook execution of Theme 11.

---

## Recent shifts that materially changed the risk picture

| Item | Was | Now | Why |
|---|---|---|---|
| `find_someone_who` data supply | 🔴 collapse risk if Swoop refused | 🟢 live | C.26 granted 2026-04-30; migration 006 + 2,563 rows ingested; PII non-issue (public reviews) |
| Premortem #2 (corpus collapse) | medium × medium-high | low × low | Resolved by C.26 |
| Documentation lag (progress.md / next-steps.md) | 🟡 9 commits stale | 🟢 fresh | Commit `fa3bfc5` refresh |
| Plan-vs-State chunk-C row | 🟡 wrong | 🟢 accurate | Same |
| Method-discipline at customerreview leg | 🔴 risk if shipped without inspection | 🟢 Phase 1 inspection happened | Running agent self-organised the discipline |
| Inconclusive 4th verdict not in code | 🔴 closed-but-not-landed | 🟢 (closed by patches) | Inline edit-pass alongside this review |
| Firestore stale references | 🔴 in 14 product files | 🟢 (closed by patches) | Inline edit-pass alongside this review |

Items still open and **not** resolved by today's work:
- Quality bar gaps (placeholder copy, WHY prompt is stub) — gated on Lane sales doc + HITL editorial
- Architecture seams (connector workspace responsibility creep) — fix-when-touched
- Tier 3 plans with deferred Firestore→Postgres rename — kept deferred per Al's batched-with-M4 stance (inbox 2026-04-28)
- Broader corpus inspection (blog narrative texture, page prose, contentblock subtypes) — pending

---

## Key findings by lens

### 🔴 — closed by this review's patches

**Inconclusive 4th verdict was declared closed but never landed in code.** Q5 closed in `planning/00-discovery-design-thinking.md:221` and progress.md:5; but `product/ts-common/src/handoff.ts`, `tools.ts:136`, `events.ts:43,131`, `cms/prompts/system/00_why.md:7`, `evalset-growth.md:40,52`, and the entire compliance bundle (`01-overview`, `02-data-flow`, `05-retention-policy`, `08-data-subject-rights`) all encoded the 3-verdict enum. Tier 1 §3 theme 8 and `02-impl-handoff-and-compliance.md` were silent on `inconclusive`. The system prompt taught the agent the wrong taxonomy. Two lenses caught this independently. Per HITL Q5: no email, 90-day retention, reason codes per §3.2 Path 7 (`low_engagement | mixed_signals | extended_no_convergence | comparison_shopping | off_offer_in_region | drive_by | inconclusive_other`). **Closed by inline patches.**

**Firestore drop sweep was incomplete.** C.23 dropped Firestore project-wide and listed 3 follow-up files; the actual blast radius was ~5×. Per Al's 2026-04-28 inbox stance, session-backend rename items pair with post-M4 work — kept deferred. **Closed by inline patches** for: handoff-related comments (`connector/handoff/{store,submit,mailer}.ts`), orchestrator log strings + README, `evalset-growth.md` runbook, `planning/03-exec-handoff-t2-t3.md`, `planning/03-exec-observability-b.md:279`, `planning/01-side-quest-persistence.md:77,80`, `compliance-bundle/02-data-flow.md` row.

### 🟡 — watch / fix-when-touched

**Documentation lag against working code** (Lens 1, 2, 4) — mostly cured by today's `fa3bfc5` refresh; remaining: Tier 1 §3 theme 8 (closed by patch), `02-impl-handoff-and-compliance.md` inconclusive references (closed by patch), `00-discovery-design-thinking.md` body still uses superseded composer tool names + Haiku post-classifier recommendation (closed by patch).

**Method discipline cracked once on the data-inspection rail** (Lens 8) — the 2026-04-30 inbox directive said *"prioritise corpus inspection before any further tool-design work"*. C.t2 shipped the same day with concrete Postgres tables encoding assumptions about content shapes that hadn't been inspected (blog narrative texture, page prose evocativeness, contentblock subtype distribution). Forward-only migrations + throwaway-ETL theme bound the cost. Customerreview leg is now Phase-1-inspected; the rest of the corpus survey is still pending.

**Architecture seams getting weak** (Lens 7) — `@swoop/connector` becoming three things in one workspace: side-effects (handoff), DDL authoring (migrations), incoming MCP tool implementations. Its `package.json` claims MCP-over-HTTP but orchestrator imports concrete classes in-process. `ts-common` crossed from "shared types" into "fixtures library" (17 sample files). Stub connector advertises tools real connector doesn't expose. Migrations live in `connector/` but `pg`/migration runner not in deps.

**Quality bar: mechanics shipped, content placeholder** (Lens 11) — surface-by-surface: opening/disclosure 🟡 (TODO(E.t5) strings; `privacy@example.com` cited), chat surface 🟢, lead-capture mechanics 🟢, error states 🟢 (cms/errors/en.json done well), voice/content 🔴 (00_why.md is 5-line stub; tool descriptions surprisingly strong; skills directory empty), compliance bundle 🟡 (5 filled / 1 partial / 4 blocked / 1 empty), handoff emails 🟢. Counterweight: lead-capture + 10_style-avoid.md + tool descriptions + ErrorBanner are at production bar.

**Decision-log cosmetics** (Lens 4) — C.30/C.30b numbering anomaly; C.13 vs C.14 pricing-ranges contradiction (one-sentence reconciliation needed); C.18 buries Voyage-3 lock-in in older entry. Counterweight: supersession discipline (strikethrough + "**SUPERSEDED by C.X**" pattern) is exemplary and machine-greppable.

**Per-tool data supply audit** (Lens 6) — find_someone_who 🔴 → 🟢 (post-C.26), find_proof 🟡 (pressreview empty, external_certification has no source), illustrate 🟡 (depends on C.t6 annotation that hasn't run), find_inspiring/find_options/lookup 🟡 (corpus inspection still partly incomplete).

### 🔴 — forward risks (Lens 10, 12)

**1. HITL bottleneck → legal cliff.** Probability: high. Impact: high. Al's calendar is the bottleneck nobody is sizing. Dependency graph fans into one human against fixed regulatory cliff. Leading indicators: corpus inspection #0 unscheduled; E.t5 "hold until Q1/Q2/Q3 voice anchors"; E.t8 has 4 BLOCKED files; counsel SLA unknown.

**2. EU AI Act cliff with partial bundle.** Probability: medium. Impact: high. Counsel engagement model unscoped (questions.md:159 open). 14 weeks remaining. If counsel takes 6 weeks without retainer: misses 2 Aug. Critical path: E.t5 (~mid-May) → screenshots → DPA chase → counsel review → enforcement. Feasible if engagement model is established this week.

**3. Iframe embed reality vs mock-host.** Probability: medium. Impact: medium-high. D.t8 brand surface tested only against local mock-host. Safari ITP + Swoop CSP audit untested. Failure mode unrecoverable late.

Other watched scenarios (lower P × I): voice regression slipping past style-avoid; scope creep accumulating (F.t6, B.t11/D.t9, full C.t6 annotation); mailer flip-on hell at ship time; worktree-base bug recurrence (gate is convention, not mechanism).

---

## Cross-cutting patterns

1. **Self-correction works at the prose layer first**, then propagates to artefacts. Theme 11 elevation, supersession discipline, hash-verification gates all caught drift. Where corrections lag is in cascading sweeps after a lock-in (Firestore→Postgres scope was bigger than the 3-file follow-up list).
2. **Documentation drift cascades through orientation files** if `progress.md`/`next-steps.md` aren't refreshed. The customerreview agent demonstrated the right pattern: refresh these as part of any chunk-closing work.
3. **Method discipline holds at the prose layer; physical artefacts have minor lag**. Tool descriptions read journey-anchored; Postgres column names are job-shaped but `source_provenance` CHECK enums leak the source schema upward.
4. **Calendar is the single bottleneck**. Tier 4 swarm parallelises agent work; every gate (HITL design, voice editorial, legal copy, embed test) is single-threaded through Al.

---

## Counterweights — what's working

- M1 verified live end-to-end (real Sonnet + Haiku turn streamed; handoff submit working).
- 3 of 3 audited Tier 3 plans matched code with high fidelity (C.t2, C.t0, blog ingest).
- Execution logs at Tier 3 are dated, honest, and self-flag deviations.
- Self-correction is real not theatrical — composer reversal preserved as worked example.
- Tool descriptions in `cms/prompts/tools/` are punchy, journey-anchored, voice-coherent — Theme 11 internalised at the prose layer.
- The 1024d/1536d sweep was thorough (zero stragglers).
- Decision-log supersession discipline is exemplary.
- Connector workspace boundary, while creeping, has clean public exports (named, no default re-exports leaking internals).
- Lead-capture widget mechanics, ErrorBanner + cms/errors/en.json, two-tier consent, verdict-aware mailer — production-quality decisions that will age well.

---

## Recommended next moves

**Closed alongside this review:**
- Inconclusive 4th verdict propagated through `@swoop/common`, system prompt, compliance bundle, Tier 1 §3 theme 8, evalset-growth runbook, foundations + handoff Tier 2/3 plans
- Firestore stale-reference sweep — handoff-related code comments + docs (where Postgres lock-in is already E.10-shipped)
- `00-discovery-design-thinking.md` body fixes — superseded tool names + Haiku post-classifier line corrected

**This week (high-leverage, not in this review's patches):**
1. **Push Swoop hard on legal counsel SLA + named contact.** Single load-bearing unknown for M5.
2. **Run the broader corpus inspection** (blog narrative texture, page prose, contentblock subtypes) before C.t3 ETL author begins. Customerreview leg already done; the rest pending.
3. **Decide explicitly which scope items are Condor not Puma.** Write into Tier 1 §7. Candidates: F.t6 conversation-analysis pipeline, B.t11/D.t9 persistence, full C.t6 image annotation pass, H.t5 κ judge calibration.
4. **Schedule iframe embed test against real Swoop site** (Safari ITP + CSP) before mid-May.

**Watch:**
- Continue hash-verification gate enforcement on every dispatched agent.
- Voice regression in real conversations (style-avoid as living doc).
- Decision count is now ~50 across all chunks; consider a mid-stream pruning pass if it keeps growing.
- Architecture seams: when next touching connector, decide whether to split or accept the kitchen sink.

---

## Closing

Al's instinct to call for an external review **was the right prophylactic** even though no catastrophic gyration was found. The alternative is silent gyration; without periodic outside-eye checks against a corpus this dense, drift compounds. The 12-lens council pattern took ~25 minutes wall-clock and ~9000 words of agent output to produce one consolidated answer plus three concrete close-out patches. Worth re-running at the next inflection point (M2 close, M4 deploy, post-counsel-review).
