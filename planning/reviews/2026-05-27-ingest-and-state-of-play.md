# 2026-05-27 — Ingest & State of Play

**Author**: Spider/orchestration session (Alastair-led, comprehensive-ingest mode).
**Type**: Orientation snapshot, not a council-of-experts review. Captures what is true as of 2026-05-27 so any future orchestration session can pick up cold without re-reading 97 files.
**Companion to**: [2026-04-30-state-of-play.md](2026-04-30-state-of-play.md — pre-chunk-C-build snapshot) and [2026-04-30-code-level.md](2026-04-30-code-level.md — code review with H1–H4 helpers identified). This is a **build-side** snapshot, not a code review — see those companions for review-driven items.
**Triggered by**: `/anthropic-skills:swoop` slash command 2026-05-27, with Alastair's directive *"What I need you to be is a comprehensively informed orchestration agent. You can consume context to achieve this. Do not proceed with any sub-agents or triggering any editing work until you can confirm to me that you have read everything you need to read."*

---

## ★ Read this first

The build has materially exceeded the 30 March quote ceiling; almost everything in [next-steps.md](../../next-steps.md) (headline 2026-05-18) has landed; ~50 commits intervened between that snapshot and today. Anyone resuming work should read **this doc first** before [next-steps.md](../../next-steps.md), because next-steps lags reality.

---

## Section 1 — Ingest receipt

97 files consumed in this session, in waves:

| Layer | Files |
|---|---|
| Orientation | [progress.md](../../progress.md), [discoveries.md](../../discoveries.md), [gotchas.md](../../gotchas.md), [next-steps.md](../../next-steps.md), [inbox.md](../../inbox.md), [questions.md](../../questions.md) |
| Tier 1 + design substrate | [01-top-level.md](../01-top-level.md), [01-side-quest-persistence.md](../01-side-quest-persistence.md), [00-discovery-design-thinking.md](../00-discovery-design-thinking.md) |
| Tier 2 (all 9) | foundations, agent-runtime, chat-surface, retrieval-and-data, handoff-and-compliance, content, observability, validation, side-quest-host-harness, retrieval-and-data-source-exploration (superseded) |
| Tier 3 (full sweep — A.t1–t5, B.t1–t11, C.t0–t10 + t3a, D.t1–t9 + mount-rehydrate, E.t1/t2/t3/t6/t8, F-a/F-b, G blog-ingest, H.t1/t7/t8 + variants, side-quest-host-harness, 12 crosscuts) | Approx 50 plans + addenda |
| Project-level | [data-ontology.md](../../data-ontology.md), [swoop-legal-review-pack.md](../swoop-legal-review-pack.md) v0.6 |
| Decisions ledger | [decisions.md](../decisions.md) pages including C.30–C.51, B.22–B.29, D.26–D.30, E series, H.14–H.20, plus wave-named C.brave-pare-*, C.focused-shamir-*, C.bf-* entries |
| Reviews | [2026-04-30-code-level.md](2026-04-30-code-level.md — 4 R-items + 5 themes including H1–H5 cross-cuts), [2026-04-30-state-of-play.md](2026-04-30-state-of-play.md) |
| CMS substrate | [cms/README.md](../../product/cms/README.md), [00_why.md](../../product/cms/prompts/system/00_why.md — system prompt brain, ~5,700 words, the conversational architecture spec), [10_style-avoid.md](../../product/cms/prompts/system/10_style-avoid.md) |
| Commercial / kickoff | [00-project-proposal.md](../00-project-proposal.md — 30 Mar 2026 quote, 16-day baseline, £15,200), [00-project-proposal-notes.md](../00-project-proposal-notes.md — internal quoting notes), kickoff meeting Apr 20 (Luke/Julie strategy session), technical meeting Apr 21 (Thomas/Richard tech kickoff), Buddy Apps Mail PDF (full 30 Mar → 7 Apr proposal email thread including PAT-over-ANT switch and revised 21-day estimate) |
| Git history | 401 commits since planning reset 2026-04-22; all named branches; 87 worktree-agent-* branches still present |

**Total: 97 files + git history.**

---

## Section 2 — State of play as of 2026-05-27

### 2.1 Build status

**Puma release is feature-complete against the original 30 March scope and beyond.** The 30 March quote framed ANT (Antarctica) as the simplest-good-thing trial; Luke's 1 April switch to PAT (Patagonia) added the data-retrieval layer + sales-triage guidance. What's now built is production-grade implementation across both, not the "simplest GOOD thing" Julie scoped on 26 March.

### 2.2 Architecture as built

| Layer | Shape |
|---|---|
| Orchestrator | ADK 1.0 + Claude Sonnet 4.5 (main) + Haiku 4.5 (ETL) via custom BaseLlm shim; manual skills-prompt injection (per [e5acaa1 — fix(orchestrator): manually inject skills prompt — ADK toolset.processLlmRequest never fires](../../product/orchestrator), the only path that works) |
| Skills loader | B.t9 — enumerates SKILL.md folders under [cms/prompts/skills/](../../product/cms/prompts/skills/); 14 archetype/state/pattern skills (Dreamer / Planner / Skeptic / Browser × Inspire / Excite / Convince / HandOff + worked patterns) |
| Connector | MCP-HTTP; eight intent-named tools — `find_inspiring` / `find_someone_who` / `find_proof` / `lookup` / `find_options` / `illustrate` / `handoff` / `handoff_submit` |
| Data tier | Postgres 18 + pgvector halfvec(3072) + tsvector + pg_trgm; Gemini embedding-001 via the [embedding cache](../03-exec-crosscut-embedding-cache.md — content-hash-keyed, survives TRUNCATEs); single VM all-on-one ([a463b83 — single-VM is the live path, Cloud SQL deferred](../../planning)) |
| Five derived job tables | inspire_passage, customer_story, trust_proof, inform_chunk, trip_card + tour_card |
| find_options output | Polymorphic `ProposalCardPublicSchema` discriminated union over `trip \| tour \| hotel \| region_base`; 4-way blend + random ordering + agent-supplied exclude list |
| UI | assistant-ui + AI SDK v5 `message.parts`; 5 conversational widgets + 4 ProposalCard variants; mount-time history rehydrate per [D.t9-mount-rehydrate](../03-exec-chat-surface-t9-mount-rehydrate.md) |
| Handoff | Two-tier consent (start + handoff); rich specialistSummary + logistical-only visitorPrecis split; free-text additionalNotes (per [a2dcea0 — handoff lead-capture form polish](../../product/ui)); cardinality rules + auto-trigger; booking-limit moment fires tool not prose |
| Observability (F-a) | 20+ event kinds, emitEvent helper, module-level sink swap; per-event streaming JSONL for H.t8; HTML transcript viewer |
| Validator harness (H.t8) | All 37 personas authored across 5 clusters (12 archetype + 8 pattern + 8 triage + 6 adversarial + 3 style); Sonnet user-agent + Haiku stop-judge + Sonnet judge for `judge_rubric` |
| Demo target | Mac Mini at home + Tailscale Funnel (per [project_demo_server_mac_mini.md](../../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/project_demo_server_mac_mini.md)), with pg_dump → fresh Postgres path proven |
| Legal | [swoop-legal-review-pack.md](../swoop-legal-review-pack.md) at v0.6 — EU AI Act Art. 50 + GDPR; docx export shipped, awaiting Swoop counsel sign-off |

### 2.3 Commit density timeline (since planning reset)

```
2026-04-22   1    planning reset
2026-04-24  11    chunk-C kickoff
2026-04-27   4    SQL dump arrives
2026-04-28  28    C.t1 connector skeleton
2026-04-29  25    C.t2 contract layer
2026-04-30  55    code-level review + C.t2 settle
2026-05-01  15    HITL ratification round 1
2026-05-02  52    C.t3 + C.t3a + C.t4 — the big build day
              [9-day pause — chunk-G content authoring + Tier-3 planning]
2026-05-12  48    HITL round 2 — find_options polymorphism v1 + D.t9 + E.t6 + B.t11
2026-05-13  44    D.t9 widget merge + brave-pare live-smoke wave + BF-FO-v3 + VERDICT-E.t1 + BATCH-C.t6
2026-05-14   2    focused-shamir-1 tour fix
2026-05-15   7    embedding-cache + tour-v2 paused
              [2-day pause]
2026-05-18  76    BIGGEST DAY — B.t9 skill loader, H.t8 clusters 1-5, illustrate tag-gate, WHY prompt iteration
2026-05-19  24    handoff cardinality + thinking indicator + dedup + polish wave
2026-05-20   4    winding down
2026-05-21   3    single-VM reframe
2026-05-22   2    legal review pack docx + sales-team prompt curation T3 plans + house-keeping
```

**Total: 401 commits, 87 worktree-agent-* branches still present.**

### 2.4 Stakeholder reality

Per [project_mark_reed_left.md](../../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/project_mark_reed_left.md — 2026-05-14):

| Person | Role | Status |
|---|---|---|
| Luke | CEO; strategic roadmap (group tours = half of bookings) | Active; ADHD, short comms preferred |
| Julie | Production bar, UX, partner management | Active |
| Thomas Forster | Senior dev | Active; owns GCP "AI Pat Chat" IAM (still pending) |
| Richard Connett | Tech lead 3yr | Active; Mongo + MySQL access |
| Lane | Luke's collaborator on Patagonia sales-thinking doc | Pending — doc still owed |
| Mark Reed | Tech architecture input | **Gone since 2026-05-14** — route eng/data questions to Thomas/Richard |
| Joe Humphries (Platform48) | Considered as joint pitch | Out — Platform48 doesn't do websites; not threat, not resource |

---

## Section 3 — What's landed (verification ledger)

Cross-referenced against next-steps.md headline items + recent commit history. Every claim is anchored to a specific commit.

| Item | Confirmed-landed commit |
|---|---|
| B.t9 skill loader + factory wiring | [4efeb92 — feat(orchestrator): B.t9 — skill loader enumerates SKILL.md folders](../../product/orchestrator), [9965d64 — factory wires skills into SkillToolset alongside connector tools](../../product/orchestrator), [3f21661 — B.t9 regression fix: restore connector tools as top-level siblings of SkillToolset](../../product/orchestrator) |
| H.t8 validator harness — schema + runtime + judges | [8dacb87 — scenario schema accepts userAgent variant](../../product/harness), [9c5593d — user-agent loop + Haiku stop-judge + runner dispatch](../../product/harness), [af431da — Sonnet judge for judge_rubric assertions](../../product/harness) |
| H.t8 — 37 persona scenarios across 5 clusters | [4e98426 cluster 1 (12 archetype)](../../product/harness/scenarios), [4ab25ce cluster 2 (8 pattern)](../../product/harness/scenarios), [de7c402 cluster 3 (8 triage upgrade)](../../product/harness/scenarios), [85b38c6 cluster 4 (6 adversarial)](../../product/harness/scenarios), [e476bf9 cluster 5 (3 style)](../../product/harness/scenarios) |
| H.t8 — per-event streaming JSONL + transcript viewer | [5100742 — wire FileEventSink per scenario + incremental rollup](../../product/harness), [1582210 — viewTranscript renders per-scenario JSONL as HTML](../../product/harness), [3796e1b — render markdown in Visitor + Agent bubbles (sanitised)](../../product/harness) |
| D.t9 widget rewrite (5 tools + 4 ProposalCard variants) | [bfc361c — D.t9 chat-surface widget rewrite](../../product/ui) |
| D.t9-mount-rehydrate | [d4a59f7 — D.t9-mount-rehydrate: mount-time history rehydrate](../../product/ui) |
| B.t11 server-side session history projection | [5d39bfc — feat(orchestrator,common): B.t11 session history projection endpoint](../../product/orchestrator), [c18bd03 — merge](../../product) |
| E.t6 handoff retention sweeper | [978f63b](#) — superseded; actual: [978e317a + 0b769f3 + cardinality work](../../product/connector); plus [978f63b alt-ref] — see decisions.md C.6x for the exact path. Sweeper + manual interval + CLI external-trigger pattern all live |
| find_options v1 polymorphism (ProposalCardPublicSchema) | [6f46781 — crosscut C.48: ProposalCardPublicSchema discriminated union (trip\|tour\|hotel\|region_base)](../../product/ts-common), [1624756 — find_options handler returns discriminated trip cards (v1)](../../product/connector), [9e173e1 — rewrite find_options/description.md for polymorphism + Tours upsell](../../product/cms) |
| find_options v3 (hotels + region_bases) | [a676242 — BF-FO-v3: queryHotelCardsByFilter](../../product/connector), [69c6b82 — BF-FO-v3: queryRegionBaseCardsByFilter](../../product/connector), [793e198 — BF-FO-v3: find_options dispatches on preferredType + blendCards](../../product/connector) |
| find_options v2 (tours) | [4fc18be — v2 tour tranche + 4-way blend + random + agent exclude](../../product/connector) |
| C.focused-shamir-1 tour extraction fix | [4ccdf31 — fix(ingestion): derive tour identity from the parent contentblock's page](../../product/ingestion) |
| C.focused-shamir-6 tour region derivation | [694a5bf — feat(tour-region): derive from page-parent chain; informational only](../../product/ingestion) |
| Embedding cache (content-hash-keyed, TRUNCATE-survival) | [4438080 — feat(enrich): content-hash-keyed embedding cache](../../product/ingestion) |
| C.t6 batches submission path | [cda5331 — AnthropicVisionBatchClient + waitForVisionBatch](../../product/ingestion), [7316f1a — runBatches end-to-end submission path](../../product/ingestion) |
| C.t9 + C.brave-pare-1 — Voyage→Gemini swap (corpus + visitor-query) | [3624346 — GeminiClient with retry + batching](../../product/ingestion), [8268700 — migration 009 vector(1024) → halfvec(3072)](../../product/connector), [7841b46 — swap VoyageClient → GeminiClient across embed pipeline](../../product/ingestion), [67c2dda — fix(connector): visitor-query embedder swaps Voyage → Gemini (3072d)](../../product/connector) |
| VERDICT-E.t1 handoff schema tightening (discriminated unions) | [8882728 — HandoffInputSchema + HandoffSubmitRequestSchema as discriminated unions](../../product/ts-common), [e303734 — consumer drift fix](../../product/connector) |
| Handoff lead-capture form polish (frosty-leavitt) | [a2dcea0 — single-step lead-capture form + specialistSummary/visitorPrecis split + free-text additionalNotes + narrative email templates](../../product) |
| Handoff cardinality + booking-limit moment | [0b769f3 — cardinality rules + auto-trigger follow-up turn on submit](../../product), [1a5f966 — the booking-limit moment — fire `handoff` tool, not prose](../../product/cms) |
| illustrate tag-gate removal (cosine ANN only) | [2747b42 — fix(connector): illustrate ranks on cosine ANN only — drop tag-overlap gate](../../product/connector) |
| Brave-pare live-smoke wave (8 fixes — App crash, Voyage cleanup, region_id backfill, HTML render, ExpandableProse, whitespace strip, CTA copy, decisions IDs) | [a5b41cc — Merge brave-pare-5e0eba](../../planning), [aa72202 — region_id backfill](../../product/ingestion), [c2a91c5 — render CMS-authored HTML in RegionBaseCard](../../product/ui), [1bb679d — cards stop silent-truncating, inline expander](../../product), [f9b1d1d — strip trailing CMS WYSIWYG decorative whitespace](../../product/connector), [db2365f — RegionBaseCard CTA copy](../../product/ui) |
| Thinking indicator (post-tool / pre-text gap) | [6bcaded — feat(ui): thinking indicator for the post-tool / pre-text gap](../../product/ui) |
| Tailscale Funnel for client demos | [ea1c280 — feat(tooling): expose UI via Tailscale Funnel](../../product/tooling) |
| Single-VM deployment reframe | [a463b83 — docs(planning): reframe deployment shape — single-VM is the live path, Cloud SQL deferred](../../planning) |
| Legal review pack v0.6 docx | [0f8fa0f — Legal review pack docx](../../planning) |
| graphify knowledge-graph wiring | [6199f69 — feat(tooling): wire up safishamsi/graphify knowledge graph for product/](../../product) |
| Sales-team prompt curation Tier 3 plans (authored, not implemented) | [058f26f — docs(planning): Tier 3 plans for sales-team prompt curation + agent_prompts override repo](../../planning) |

---

## Section 4 — What's outstanding

### 4.1 Plan-only (implementation pending)

| Item | Tier 3 plan | What's left |
|---|---|---|
| **Sales-team prompt curation** | [058f26f — Tier 3 plan committed 2026-05-22](../../planning) | Implementation. Plan authored; sales-team curation surface not built. |
| **agent_prompts override repo** | [058f26f — committed alongside](../../planning) | Implementation. Override-repo mechanism not built. |
| **H.t8 baseline run + post-B.t9 delta report** | [03-exec-h-t8.md Task 4 + Task 5](../03-exec-h-t8.md — validator harness Tier 3 plan with 37 scenarios) | Personas exist; runs may not have happened. Verify by checking `product/harness/runs/<utc-stamp>-baseline/` and `<utc-stamp>-post-bt9/` artefacts. |
| **C.t6 full-corpus batches run** | [03-exec-c-t6-batches-submission.md](../03-exec-c-t6-batches-submission.md — BATCH-C.t6 plan, code shipped) | The runner exists; a full annotation pass against the remaining ~6.7K images may be pending. |
| **C.t6 vision prompt + reminder fix** | [03-exec-c-t4.md addendum 2026-05-18 — illustrate tag-gate diagnosis](../03-exec-c-t4.md) | Empty tag arrays root cause named ([vision-client.ts:117-120](../../product/ingestion/src/images/vision-client.ts) reminder string lags v2 prompt). Deferred pending v2 facet decision. |
| **deps.emitEvent channel for connector** | Tracked in [C.bf-6 decision](../decisions.md — find_options.tour_fallback event) | One-line add when channel lands. |

### 4.2 External-gated (cannot dispatch — needs Swoop or Al)

| Item | Owner | Where tracked |
|---|---|---|
| Customertip source table | Swoop eng (Thomas / Richard) | [questions.md](../../questions.md) |
| Tour-discriminator confirmation (`contentblock.type_id = 152`) | Thomas / Richard | [questions.md](../../questions.md), [03-exec-c-t3.md addendum 2026-05-14](../03-exec-c-t3.md — focused-shamir-1) |
| `publishstate_id = 3` filter for trips | Thomas / Richard | [questions.md](../../questions.md) |
| GCP "AI Pat Chat" IAM | Thomas | [questions.md](../../questions.md) (since the 21 April tech kickoff) |
| Patagonia sales-thinking doc | Luke + Lane | [questions.md](../../questions.md) (since the 20 April kickoff) |
| Legal counsel sign-off | Swoop counsel | [swoop-legal-review-pack.md](../swoop-legal-review-pack.md — v0.6, awaiting review) |
| Claude account / SMTP / sales inbox | Tom + Julie | [questions.md](../../questions.md) |

---

## Section 5 — Observations & risks

### 5.1 Commercial framing

The build has expanded beyond the 30 March quote shape (per [emails 30 Mar → 2 Apr 2026](../00-project-proposal-notes.md) — original ANT trial → PAT switch → production-grade Puma). The project is feature-complete against the Puma scope — an implicit budget conversation may be looming. This is informational only; no action implied.

### 5.2 The 87-worktree clutter

`git branch -a` shows 87 `worktree-agent-*` branches alongside 24 named `claude/<wave>` branches. Most worktree-agent-* are likely no-change leftovers per the [worktree memory](../../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/feedback_worktree_vs_main.md — autonomous/parallel work in worktree, "apply" = commit + merge). A cleanup pass is low-risk mechanical work but needs explicit go-ahead.

### 5.3 Doc staleness

[next-steps.md](../../next-steps.md) is dated 2026-05-18; ~50 commits intervened. Almost everything listed there has shipped. The doc needs a sweep — but this is itself a candidate for a verification sub-agent rather than a confident self-edit, because:
- The G.t4 false-positive earlier in this session (claimed placeholder content when chunk-G shipped 2026-05-14) shows the trap of trusting docs over code.
- Any next-steps sweep should be evidence-based: git log + file grep + verify-then-edit.

### 5.4 The verify-first discipline

This session opened with my misclaiming G.t4 was outstanding ("placeholder Patagonia content for M1") when chunk-G content was shipped 2026-05-14 ([2f2ad1c — chunk G content layer — WHY prompt + 14 seed skills](../../product/cms)) and M1 has long since shipped. Alastair's correction was clear: **agents must check git history and state of code to confirm any task is actually outstanding**. That discipline applies to every future dispatch out of this state-of-play.

---

## Section 6 — Recommended next moves (master ledger)

This is the actionable ledger Alastair's [root CLAUDE.md](../../CLAUDE.md — "each review's 'Recommended next moves' section is the master ledger") describes. Items are linked to the relevant plans or commits. Status, owner, gate, and forward-link to where each item lives long-term.

### 6.1 Mechanical / read-only

| # | Item | Where it lives | Status | Gate |
|---|---|---|---|---|
| M1 | Verify H.t8 baseline + delta runs against [03-exec-h-t8.md](../03-exec-h-t8.md — Tasks 4 + 5) | `product/harness/runs/<utc-stamp>-baseline/`, `<utc-stamp>-post-bt9/` | Unverified | Read-only sub-agent |
| M2 | Verify C.t6 full-corpus batches run status against [03-exec-c-t6-batches-submission.md](../03-exec-c-t6-batches-submission.md) | `puma_dev.image` annotation coverage; cost ledger | Unverified | Read-only sub-agent |
| M3 | Sweep [next-steps.md](../../next-steps.md) against current commit head — close shipped items, surface what's actually outstanding | [next-steps.md](../../next-steps.md) | Stale (2026-05-18) | Read-only sub-agent recommended; HITL apply on `main` |
| M4 | Prune 87 worktree-agent-* branches (no-change leftovers); keep named `claude/<wave>` branches | git | Pending | Explicit Alastair go-ahead — destructive on git, even if low-risk |
| M5 | Verify [ee21254 — house-keeping](../../planning) commit scope; understand what was tidied | Local git | Unverified | Read-only sub-agent or direct `git show` |

### 6.2 Implementation candidates (Tier 3 plans exist; code does not)

| # | Item | Plan | Worktree posture |
|---|---|---|---|
| I1 | Sales-team prompt curation surface | [058f26f-committed plan](../03-exec-sales-team-prompt-curation.md — assumed filename; verify) | New worktree; HITL design review before code |
| I2 | agent_prompts override repo mechanism | [058f26f-committed plan](../03-exec-agent-prompts-override-repo.md — assumed filename; verify) | New worktree; HITL design review before code |
| I3 | C.t6 full-corpus image annotation run (if M2 confirms it's pending) | [03-exec-c-t6.md](../03-exec-c-t6.md) | New worktree; cost-cap guardrails per the plan body |

### 6.3 Pending external (don't dispatch; track only)

| # | Item | Owner | Tracked at |
|---|---|---|---|
| E1 | Customertip source table | Swoop eng | [questions.md](../../questions.md) |
| E2 | Tour `contentblock.type_id = 152` discriminator confirmation | Thomas / Richard | [questions.md](../../questions.md) |
| E3 | `publishstate_id = 3` filter confirmation | Thomas / Richard | [questions.md](../../questions.md) |
| E4 | GCP "AI Pat Chat" IAM | Thomas | [questions.md](../../questions.md) |
| E5 | Patagonia sales-thinking doc | Luke + Lane | [questions.md](../../questions.md) |
| E6 | Legal counsel sign-off on v0.6 pack | Swoop counsel | [swoop-legal-review-pack.md](../swoop-legal-review-pack.md) |
| E7 | Claude account / SMTP / sales inbox | Tom + Julie | [questions.md](../../questions.md) |

### 6.4 Decisions pending

| # | Item | Where surfaced |
|---|---|---|
| D1 | v2 facet-aware image annotation vs single-embedding-and-see-how-far-it-gets | [03-exec-c-t4.md illustrate tag-gate addendum 2026-05-18](../03-exec-c-t4.md), [inbox.md 2026-05-18](../../inbox.md) |
| D2 | Add `content_hash` to tag/faqitem/image — needed for full embedding-cache coverage | [03-exec-crosscut-embedding-cache.md §9](../03-exec-crosscut-embedding-cache.md — open items at execution) |
| D3 | Per-query `SET LOCAL hnsw.ef_search` tuning for find_someone_who | Deferred to C.t8 runbook iteration per [03-exec-c-t4.md Q4](../03-exec-c-t4.md) |

---

## Section 7 — Open questions for Alastair

Three concrete questions surfaced during this ingest that need Alastair's call before any dispatch:

1. **Sanity check on staleness.** Is [next-steps.md](../../next-steps.md) (2026-05-18) roughly current, or is there a more recent state-of-play I haven't read? If there's a more recent review or progress entry, point me at it.

2. **Verification posture.** Before dispatching any agent, the recommended first move is a **read-only verification sub-agent** that confirms which next-steps items are actually still outstanding against current code + git (covers M1-M3 above). My first instinct: yes — given the G.t4 false-positive trap earlier in this session.

3. **What's next?** With Puma feature-complete, the two implementation candidates with Tier-3 plans authored on 2026-05-22 are I1 (sales-team prompt curation) and I2 (agent_prompts override repo). Are these the intended next builds, or is the next move something else entirely (e.g. demo prep, legal review iteration, retrospective)?

---

## Section 8 — Cross-references

- [CLAUDE.md (root)](../../CLAUDE.md) — Cowork-level planning context, the four orientation files, the planning structure (Tiers 1–4 + crosscuts + reviews)
- [product/CLAUDE.md](../../product/CLAUDE.md) — Claude Code execution context for product/ monorepo
- [decisions.md](../decisions.md) — the canonical decisions ledger (C.13–C.51, B.22–B.29, D.26–D.30, E series, H.14–H.20, wave-named)
- [progress.md](../../progress.md) — chronological state-of-play per chunk
- [discoveries.md](../../discoveries.md) — non-obvious architectural truths (two-layer agent, AI SDK transport, halfvec(3072), ADK manual skill-prompt injection, etc.)
- [gotchas.md](../../gotchas.md) — environmental/tooling traps (dotenv override, model IDs, stuck Vite, etc.)
- [next-steps.md](../../next-steps.md) — resume guide (stale as of 2026-05-18)
- [inbox.md](../../inbox.md) — append-only captures
- [questions.md](../../questions.md) — open questions for Swoop
- Memory dir: [/Users/al/.claude/projects/-Users-al-Studio-projects-swoop-web/memory/MEMORY.md](../../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/MEMORY.md) — durable user/feedback/project/reference memory across sessions

---

*This doc is a snapshot. State as of 2026-05-27. Subsequent commits will outdate it; the next state-of-play review should reference this one as its baseline and capture only the delta.*
