# Progress — Swoop Web Discovery (Puma)

**Snapshot date**: 2026-05-14 (chunk G content layer authored end-to-end in a single Cowork HITL session — G.t0 + G.t1 + G.t3 substantively done; details below. Previous snapshot at 2026-05-13 covered four sequenced code-side waves on `main` + `brave-pare`.)

## 2026-05-14 — Chunk G content layer authored (G.t0 + G.t1 + G.t3)

Cowork-mode HITL session with Al landed the chunk G content layer end-to-end. Three Tier-3 tasks substantively delivered in one session.

### G.t0 — Patagonia conversational flow mapping (HITL, inline)

The conversational architecture work — triage inflections, user-type differentiation, the relational-mode dimension (Tool / Companion / Confidante), motivation anchors, handoff signal-reading — was done inline through the session rather than as a separate planning doc. The output landed *directly* in the WHY prompt (G.t1) and the seed-skills library (G.t3) rather than as an intermediate `planning/patagonia-conversational-architecture.md`. Materially the same content the §2.5 spec was meant to produce; different shape.

### G.t1 — WHY system prompt authored

[product/cms/prompts/system/00_why.md](product/cms/prompts/system/00_why.md) replaced its 5-line stub with ~5,700 words of structured guidance: identity (incl. AI-honesty stance + "Swoop Web Discovery Agent" disclosure line), friction-as-positive-pull purpose hypothesis (Al's framing, quoted directly), four-pillar voice + brand platform + channelled-lived-experience pattern, Drift conversational methodology, Discover→Propose boundary (MUST NOT list + softened itinerary-sketching caveat at §5), commercial considerations (tour lean + triage posture + calibrated AI-arrival paragraph), R×W axes + relational-mode dimension + four states + four archetypes + signal patterns, LEAR concern handling with chat-appropriate Acknowledge guidance, handoff trigger/phrasing/payload directives with richness-over-terseness rule, WON'T list, and explicit *engage, don't perform alignment* + *don't over-disclaim your scope* companion principles.

[product/cms/prompts/system/10_style-avoid.md](product/cms/prompts/system/10_style-avoid.md) was already substantively authored before this session and remains untouched. Total `system/` content now ~6,300 words.

### G.t3 — Seed skills library (14 skills authored)

[product/cms/prompts/skills/](product/cms/prompts/skills/) populated with 14 skills, structured per ADK 1.0's directory contract (G.11) — one folder per skill, single `SKILL.md` with YAML frontmatter (`name` + `description` as load-trigger) and body. Well over the chunk G ≥2 minimum.

Three categorical groups:

**Archetype skills (4)** — keyed off *who the visitor seems to be*:
- `engaging-a-dreamer`
- `engaging-a-planner` (includes the `find_options` "Planner is the archetype the visual tooling was built for" move)
- `engaging-a-skeptic`
- `engaging-a-browser`

**Functional skills (4)** — keyed off *what's happening in the conversation*:
- `group-tour-surfacing-for-solos` (the solo+group commercial sweet spot)
- `triage-to-referral` (honest redirect for non-fit visitors)
- `tailor-made-prospect-posture` (highest-value lane; walks the finest Discover→Propose line)
- `arrived-with-ai-itinerary` (enhancement-not-competition framing)

**Worked patterns (6)** — illustrative conversation shapes to be consulted *fairly proactively* when shape recognition fires:
- `pattern-anniversary-couple` / `pattern-budget-solo-traveller` / `pattern-overwhelmed-researcher` (foundational, from Phase 1's product_plan.v2)
- `pattern-w-vs-o-wrestler` / `pattern-gauchos-and-estancias` / `pattern-puma-photographer` (Patagonia-specific)

Total skill content ~16,000 words. All loaded conditionally; no per-turn system-prompt budget impact beyond what the ADK loader surfaces.

### Cross-cutting conventions introduced this session

- **MoSCoW tagging** (MUST / SHOULD / COULD / WON'T) for graded boundaries within the brief.
- **Three-voice convention** (Prompt Engineer / We / You) made explicit in the brief's "how to read this" preamble so the agent can weigh whose framing is whose.
- **NB notes after worked examples** in every skill + at the three substantive example-clusters in core (§3 channelled lived experience, §7 archetype/state examples, §9 handoff intros). Reminds the agent that quoted facts/places/people in dialogue snippets are shape-illustrative; real specifics come from the tools.
- **`engage, don't perform alignment`** principle added to core §3 with the canonical bad-phrasing list and the *if you'd be willing to delete it without losing anything, delete it* test. Cross-referenced from the LEAR pattern in §8 and from the Skeptic skill, both of which used the antipattern in their initial drafts and were corrected.
- **`don't over-disclaim your scope`** principle added to core §5 as a companion to *stoke, don't commit*. The boundary is about *confirmability*, not about whether the agent has a view. Originated as a Browser-skill failure-mode bullet and lifted into core after Al flagged it as universal.

### Inbox capture (not authored — flagged for separate planning)

- [inbox.md](inbox.md) 2026-05-14: handoff form free-text *"Anything else?"* textarea. Needs a Tier-3 plan; touches UI (chunk D), `HandoffSubmitRequest` schema in `@swoop/common`, connector payload assembly, handoff email templates, evalset. Agent guidance deliberately *not* updated to mention this — it's a UI/payload concern, not an agent-behaviour concern.

### Outstanding chunk G work (not delivered this session)

- **G.t2 — Handoff email template**: `cms/templates/handoff/qualified.md` and `referred-out.md` already exist from E.t6 work; a content refinement pass against the new voice may be warranted but isn't blocking.
- **G.t4 — Placeholder Patagonia content for M1**: not touched. Separate work.
- **G.t5 — Post-sales-doc refinement pass**: still blocked on Luke + Lane's Patagonia sales-thinking doc (open in questions.md).
- **G.t6 — Ongoing tuning**: post-launch.

### Outstanding for Claude Code agents (wiring + verification)

The content layer is in place; Claude Code agents will need to verify the wiring:

- **B.t1a — system-prompt loader**: should already concatenate every `system/^\d{2}_*.md$` match into the agent `instruction` per [product/cms/README.md](product/cms/README.md). Needs a smoke test against the new ~5,700-word `00_why.md` to confirm load + concatenation works end-to-end.
- ~~**B.t9 — skill loader**~~: **landed 2026-05-18** ([03-exec-agent-runtime-t9.md — B.t9 ADK skill-loader integration](planning/03-exec-agent-runtime-t9.md)). `product/orchestrator/src/agent/skill-loader.ts` wraps ADK's `loadAllSkillsInDir` with fail-fast + empty-tolerance + sorted output; factory bundles loaded skills + connector tools into a `SkillToolset` attached to `LlmAgent.tools`. Live-boot log: `loaded 14 skills`. Behavioural trigger-firing (description-match at conversation time) is a live-traffic observation rather than a deterministic test.
- **System-prompt length sanity-check**: total `system/` content (~6,300 words) is above the original chunk G plan target of 1500–3000 words. Al explicitly authorised richness over terseness. Worth a behavioural smoke test that this doesn't degrade long-context performance; if it does, the WON'T list (§10) and worked patterns can be moved to conditional surfaces.
- **Chunk H — evalset growth**: behavioural eval cases need to be added/updated to exercise the new skills, especially the failure modes each skill names. The patterns provide ready-made dialogue templates for fixture generation.

---

## 2026-05-13 (afternoon, mid) — BATCH-C.t6 + VERDICT-E.t1 (landed on `main` after BF-FO-v3)

Two follow-on tasks landed in the same in-session pass after BF-FO-v3:

### BATCH-C.t6 — annotate-images `--mode=batches` now POSTs + polls + writes back

Closed the deliberate C.t6 scope-cut (decision C.52). `runBatches` in [product/ingestion/src/images/run.ts](product/ingestion/src/images/run.ts) was previously a request-build-only path; the executing agent had stopped before `messages.batches.create`. After BATCH-C.t6 (Tier-3 plan: [03-exec-c-t6-batches-submission.md](planning/03-exec-c-t6-batches-submission.md), decisions C.batch-1..4):

- `product/ingestion/src/images/vision-batch-client.ts` — new `AnthropicVisionBatchClient` mirroring the Haiku batches pattern from `enrich/anthropic-batch-client.ts`. +12 unit tests.
- `runBatches` end-to-ends: build → submit → `waitForVisionBatch` → fetchResults → per-result `parseAndValidate` + `writeAnnotation` + checkpoint. +5 integration tests.
- Operator runbook ([product/cms/ops/image-annotation-rerun.md](product/cms/ops/image-annotation-rerun.md)) flipped from "deferred" to "preferred for full re-runs (~$17/£14 vs ~$34/£27 at live rate)".
- [gotchas.md](gotchas.md) "annotate-images --mode=batches builds the payload then bails" entry rewritten as a closed-historical note.

### VERDICT-E.t1 — agent + wire `reasonCode` constrained to per-verdict enums

Closed the upstream gap left by the original E.t1 landing (durable-record was already strict; agent + wire schemas were freeform). Tier-3 plan: [03-exec-e-t1-wire-tightening.md](planning/03-exec-e-t1-wire-tightening.md), decisions E.verdict-1..5:

- `HandoffInputSchema` (agent tool-call args) → `z.discriminatedUnion('verdict', […])` with per-variant `reasonCode` typed against the matching enum from `handoff.ts`. Same shape for `HandoffSubmitRequestSchema` (widget → orchestrator wire); `contact` now required-on-qualified/referred_out + absent-on-disqualified/inconclusive via `.strict()`.
- Invalid `(verdict, reasonCode)` combinations now surface at the agent boundary (and the wire boundary), not late at the server-side `HandoffPayloadSchema` parse.
- Tool description (`cms/prompts/tools/handoff/description.md`) lists all 21 valid combinations — schema-as-validator + prose-as-teacher pattern (per G.11).
- Connector MCP tool registration extended with `extractDiscriminatedUnionShape` helper (decision E.verdict-5) so the SDK's `registerTool` API can carry the union — falls back to the first variant's shape with the discriminator widened to all literals; runtime narrowing preserved by `runHandler.safeParse`.
- +10 fixture round-trip + reject-path tests on `@swoop/common`.

### Pending — needs Al (BATCH-C.t6 / VERDICT-E.t1 batch)

- **Live-data smoke for BF-FO-v3** per the v3 plan §5 (find_options hotel + region_base branches against `puma_dev`). **Now closed by the brave-pare wave** (see below — hotel + region_base both verified live, region_base after a trip.region_id backfill closed the upstream data gap).
- **No live invocation for BATCH-C.t6** — the unit tests cover the wiring; live runs already done in `--mode=live`.
- **`@swoop/ui` typecheck regression** (pre-existing on main; flagged in `inbox.md`) — broader than originally noted, now 24 errors across 7 widget files. NOT introduced by today's work; revisit as a discrete cleanup.

---

## 2026-05-13 (afternoon, late) — brave-pare-5e0eba live-smoke fix wave

Picked up the brave-pare-5e0eba worktree to verify the morning's five-plan batch ran end-to-end. Surface immediately crashed; chain-reaction surfaced three more issues. All fixed with Tier 3 plans authored first per HITL.

**Commits on `claude/brave-pare-5e0eba`:**

| Commit | Change |
|---|---|
| `34af1de` | `fix(ui): D.t9-mount-rehydrate — pass runtime as prop, don't grab from context` (real crash, App.tsx blew up on mount because `useAssistantRuntime({optional:true})` throws when no provider is in scope) |
| `9178d54` | `docs(planning): Tier 3 plans for 2026-05-13 live-smoke fixes` (C.t9 addendum + new crosscut) |
| `67c2dda` | `fix(connector): C.t9 fix-up — visitor-query embedder swaps Voyage → Gemini (3072d)` (closes the visitor-query Voyage holdover that C.t9 originally missed) |
| `58d65f2` | `fix(ui): widget empty-state silence — yield to agent prose, no widget chrome` |
| `873ae33` | `docs(planning): close Plan B Part 2 — malformed-placeholder root cause named` |
| `0dd5452` | `docs(orientation): 2026-05-13 afternoon — live-smoke fix wave` |
| `928aec4` | `docs(planning): rename crosscut to worktree-slug-stamped filename` (date-suffix wasn't unique enough — other agents on the same calendar day) |
| `1bbabe2` | `docs(planning): promote the 30 Mar proposal back out of archive` (project_proposal.md + project_proposal_notes.md → `planning/00-project-proposal*.md`) |

**Live smoke verification**: stack booted (connector :3002, orchestrator :8080, UI :5173 via preview_start); consent → message → tool calls → widgets render. Real Patagonia kayaking query produced a real TripCard widget for "Multisport Rafting Adventure on Rio Futaleufu" with image, duration, price, and "See this trip" CTA — actual D.t9 widget rendering for the first time against the populated derived tables.

**Tests** (pre-BF-FO-v3-merge): `@swoop/connector` 129 + 3 DB-gated skipped (was 126 + 3, +6 from new `embed-query.test.ts`); `@swoop/ui` 112 (unchanged count, 4 cases converted to assert `container.firstChild === null`). Post-merge re-count happens once both branches share node_modules.

**Tier 3 plans authored / amended in this session:**

- `planning/03-exec-c-t9.md` — 2026-05-13 addendum: "visitor-query Voyage holdover (the half C.t9 missed)". Decision number TBD per Al's 2026-05-13 parallel-agent-collision note. The C.t9 chunk-home plan absorbs the fix as an addendum (not a new file) because the visitor-query embedder was always in scope of C.t9's "Voyage → Gemini swap" intent — execution scoped it too narrowly.
- `planning/03-exec-crosscut-brave-pare-widget-user-copy-fix.md` — new crosscut covering: (Part 1) empty-state silence across four widgets to yield to agent prose, (Part 2) diagnose-then-fix the WidgetMalformedPlaceholder firing. Worktree-slug-stamped filename per Al's 2026-05-13 collision-avoidance discipline (date-based isn't unique enough). Part 2 outcome captured as an execution log in the same file: root cause was downstream of upstream tool throws + empty-state widget churn; no additional fix needed beyond the Voyage swap + empty-state silence.

**Orientation-file updates**: `discoveries.md` gains a 2026-05-13 entry with three patterns (provider-swap corpus+query checklist, mocking-hook-hides-provider-scope-crash, upstream-throw cascades into WidgetMalformedPlaceholder). The 30 Mar `project_proposal.md` + quoting notes promoted back out of archive into the main planning folder per Al's flag.

**Pending Al action**: review-and-merge of the brave-pare-5e0eba branch to `main` (now sitting on top of the BF-FO-v3 merge). Tier 3 plans' TBD decision numbers want assignment at merge.

## 2026-05-13 (afternoon, mid) — Crosscut find_options v3 backfill (BF-FO-v3) — merged on `main`

Backfill task picked up by a parallel session (`jolly-pasteur-77252a` worktree) after the five-plan batch closed. User-instruction: *"identify and work on backfill data items… The first data type handled was trips. But there's also tours and other stuff. That's not wired up yet."* The crosscut find_options polymorphism plan §2.4 had named the v3 tranche (hotels + region_bases, NOT gated on Swoop) and the v2 tranche (tours, Swoop-gated). v3 was the natural pickup — schema, fixtures, and UI renderers all shipped polymorphic day-one in v1, only the backend data primitives were missing.

**Tier-3 plan**: [planning/03-exec-crosscut-find-options-v3-backfill.md](planning/03-exec-crosscut-find-options-v3-backfill.md) — authored + executed in the same session against the merged-to-main branch.

**Numbering note**: per Al's 2026-05-13 instruction (multiple parallel agents allocating decision ids), this plan's decisions use the non-numeric `bf-` suffix (`C.bf-1` … `C.bf-6`) to side-step numeric-id collisions with parallel Tier-3 authors who were independently allocating `C.43+`.

**What landed**:

| Component | Workspace | Files | Tests |
|---|---|---|---|
| `queryHotelCardsByFilter` data primitive | `@swoop/connector` | `src/data/query-hotels.ts` + `src/data/__tests__/query-hotels.test.ts` | +10 |
| `queryRegionBaseCardsByFilter` data primitive | `@swoop/connector` | `src/data/query-region-bases.ts` + `src/data/__tests__/query-region-bases.test.ts` | +7 |
| `find_options` handler dispatch + `blendCards` | `@swoop/connector` | `src/tools/find_options.ts` + `src/tools/__tests__/find_options.test.ts` | +9 (was 5 → now 14) |

**Test totals after BF-FO-v3 (fresh `rm -rf node_modules + npm install`, all green, pre-brave-pare-merge)**:
- `@swoop/common` 160 (unchanged)
- `@swoop/orchestrator` 170 (unchanged)
- `@swoop/connector` **149 (was 126) + 3 DB-gated skipped** — +23 net (one v1 test consolidated into the new dispatch suite)
- `@swoop/ui` 112 (unchanged)
- `@swoop/ingestion` 266 (unchanged)
- `@swoop/harness` 74 (unchanged)
- **Total: 931 + 3 skipped (was 908 + 3 skipped → +23 net)**

**Decisions logged** (in `planning/decisions.md` with `bf-` suffix):
- C.bf-1 — v3 wires hotels + region_bases live; v2 (tours) remains gated on Swoop content.
- C.bf-2 — Hotel image resolution via `hotel.page_id → page.image_id` (confirms 2026-04-29 page-as-hub discovery).
- C.bf-3 — Blended-output path when `preferredType` is unset (2 trips + 1 hotel + 1 region_base @ limit=4); deficits redistribute toward trips.
- C.bf-4 — Region-base URL resolution: alias match first, URL-suffix fallback.
- C.bf-5 — `nearbyTripsCount = 0` areas not surfaced (region_base value-prop requires trips to explore).
- C.bf-6 — `preferredType: 'tour'` v2-fallback continues to route through trips; one-line swap when v2 Swoop-data lands.

**Operator-visible behaviour after v3**:

- Agent prompts like *"Where could we stay near Torres del Paine?"* trigger Sonnet's `preferredType: 'hotel'` selection → handler returns hotel cards with `pricingUnit: 'per_night'` + `starRating` + `location`. UI's existing polymorphic dispatch in `find-options.tsx` (D.t9, merged) renders the hotel card variant.
- Agent prompts like *"What's the best region to base ourselves for a Patagonia trip?"* trigger `preferredType: 'region_base'` → handler returns up to 4 region-base cards (areas ranked by trip count, with page-hub canonical URL + image).
- Open-ended prompts (no `preferredType`) trigger the blend — mostly trips, with one hotel + one region_base at the standard `limit: 4`.
- Tour-preference prompts continue to return trips (v2 fallback, decision C.bf-6) — no breakage, no empty results.

**Pending — needs Al**:
- **Live-data smoke** against `puma_dev` per plan §5: exercise each `preferredType` branch. Hotel + region_base SQL hasn't been verified against the live row counts yet (44 hotels, 16 areas in `puma_dev`); the unit tests covered shape correctness, not SQL semantics. Worth verifying: the page-hub heuristic (alias match → URL-suffix fallback) finds enough bases for the 16-area corpus.
- **UI typecheck regression note**: when running `npm run typecheck`, the `@swoop/ui` workspace errors with `'args' is of type 'unknown'` (lead-capture.tsx + lookup.tsx + widget-shell.tsx). These errors were pre-existing on `main` HEAD per the BF-FO-v3 author's note (confirmed by stashing v3 changes); the `brave-pare` widget-shell touch did not introduce or fix them.

**Crosscut tranche queue updated**:
- v2 (tours) — still gated on Swoop; tour-content ask continues to live in [questions.md](questions.md).
- v3 (hotels + region_bases) — ✅ **landed**. The third proposal-card variant (`tour`) is the only ProposalCard type still without live data; everything else is end-to-end.

---

## 2026-05-13 — Five-plan parallel batch (HITL-ratified 2026-05-12)

After a long HITL design conversation on 2026-05-12, the four pre-existing Tier-3 plans (E.t6, D.t9, B.t11, D.t9-mount-rehydrate) were ratified and a new crosscut plan was authored (find_options polymorphism — discriminated `ProposalCardPublicSchema` over `trip|tour|hotel|region_base`, settling the contract day-one with v1 trips-only backend). All five then ran in parallel via background agents from worktrees branched off `867af2d` (the post-ratification merge to main).

**Outcomes**:

| Plan | Decisions | Tests | Notable contract change |
|---|---|---|---|
| **E.t6** — handoff retention sweeper | E.t6 internal | +22 | `HandoffStore.delete()` + `sweep()` interface methods; both call paths (in-process timer + CLI) tested |
| **D.t9-mount-rehydrate** — UI replay-on-mount | D.26–D.30 | +14 | `useRehydrate` hook fires once on mount; replays through `replayPartsIntoThread` (assistant-ui-version-isolated) |
| **Crosscut: find_options polymorphism v1** | C.48–C.51 | +15 | `TripCardPublicSchema` retired (zero hits sweep); discriminated union ships day-one even though only trip variant is wired live |
| **B.t11** — server-side session history projection | B.25–B.29 | +14 | `GET /session/:id/history`; `session.expired` payload widened to a union `{cause}\|{gate}` |
| **D.t9 widget rewrite** | D.t9 per-tool | +50 | 5 conversational widgets + 4 polymorphic ProposalCard variants (trip live, tour/hotel/region_base against fixtures pending v2/v3) |

**Test totals after the batch (fresh `rm -rf node_modules + npm install`, all green)**:
- `@swoop/common` 160 (was 152) — 7 files
- `@swoop/orchestrator` 170 (was 160) — 15 files
- `@swoop/connector` 126 (was 102) + 3 DB-gated skipped — 13 files
- `@swoop/ui` 112 (was 62) — 18 files
- `@swoop/ingestion` 266 (unchanged) — 21 files
- `@swoop/harness` 74 (unchanged) — 4 files
- **Total: 908 + 3 skipped across 78 test files (was 818 + 3 skipped → +90 net)**

**Operator findings worth carrying forward** (full detail in [discoveries.md](discoveries.md) 2026-05-13):
- Background-spawned agents need `name: <kebab-case>` and the `unsticking-stalled-background-agents` skill should be invoked *before* dispatch. Truncated-summary completions are usually stalls, not done — send `"continue"` via `SendMessage` before taking over.
- 2 of 5 agents this batch wrote into the main repo working tree instead of their isolation worktree. Hash-verification gate doesn't catch wrong-cwd; add a `pwd` assertion to the agent prompt's first action.
- The `find_options` polymorphism is the canonical "one tool, discriminated output" pattern — preserve over fragmenting into multiple narrow tools.
- `session.expired` payload now has two shapes; UI analytics consumers must check `'gate' in payload` to discriminate rehydrate-404 from sweeper-expiry.

**HITL items still open** (queued in [next-steps.md](next-steps.md)):
- D.t9 Q3 — persona-summary visual treatment in `find_someone_who` (executor's choice carries; verify in code).
- B.t11 — auth posture (legal-counsel input via E.t9), `session.expired{gate:consent}` noise tuning, rate-limiting in Phase 1, post-M4 pagination.
- D.t9-mount-rehydrate — notification copy location, 5xx retry, visibilitychange trigger, latency telemetry, in-progress form rehydration.
- E.t6 — counsel-review note for E.t9 (hard-delete posture).

**Crosscut tranche queue**:
- v2 (tours backend) — ✅ **landed 2026-05-15** (C.focused-shamir-2 in [decisions.md](planning/decisions.md)): `tour_card` derived table populated (11 rows + embeddings), `queryTourCardsByFilter` live, `find_options(preferredType: 'tour')` no longer falls back to trips. C.bf-6 superseded. **Region follow-up landed 2026-05-18** (C.focused-shamir-6): `tour_card.region` now derived via the page-parent chain (2 of 11 anchored — Atacama Desert + Torres del Paine National Park; 9 unconstrained pan-Patagonia). Region is informational on the card, NOT a filter — the agent reads it off the response and frames contextually. Region hierarchy doesn't reduce to ILIKE, and a flat filter would lose Torres del Paine ⊂ Patagonia. See [discoveries.md](discoveries.md) 2026-05-18 (supersedes 2026-05-15).
- v3 (hotels + region_bases backend) — not gated.

**`blendCards` default ratio change (2026-05-15)**: was 2 trips + 1 hotel + 1 region_base at `limit=4` (C.bf-3). Now 1 of each variant (C.focused-shamir-3 supersedes C.bf-3) — four-way even split, extras to trips. Aligned with the imagination-stoking-variety framing.

**Ordering change (2026-05-15)**: all four `find_options` primitives switched from deterministic ranking to `ORDER BY RANDOM(), id` (C.focused-shamir-4). Same-filter calls now return different sets — anti-repetition. The existing implicit ranking (cheapest first / most-popular first) was the wrong default for a variety-driven surface.

**Agent-supplied `exclude` (2026-05-15)**: `find_options` accepts `exclude: Array<{type, id}>` (C.focused-shamir-5) so the agent can omit cards across turns without the connector tracking session state. Lightweight middle path between pure-random and full `SessionState.shownCards`.

---

## Earlier snapshot (2026-05-12 — chunk-C implementation fully merged to `main`; C.t1 / C.t3 / C.t3a / C.t4 / C.t5 / C.t6 / C.t8 + B.t3a all closed; engine pin loosened to no upper cap; afternoon session landed **C.t9** (Voyage-3 → Gemini-embedding-001 at `halfvec(3072)`, decision C.46 supersedes the Voyage-3 sub-bullet in C.18) + **C.t10** (`--sync` enrich mode for dev iteration, decision C.47 carve-out from HITL Q4); two parallel agents dispatched + closure landed in spawning session; real-API smokes for both pending Al's GCP / Anthropic credentials)
**Release**: Puma (Patagonian-animals naming convention; see [CLAUDE.md](CLAUDE.md#releases))
**Status**: **M1 live + chunks D + mock-host shipped; chunk-C implementation spine closed (C.t0/t1/t2/t3/t3a/t4/t5/t6/t8 + C.26 graduated); B.t3a closed (orchestrator → real connector; eight intent-named tools registered); 2026-04-30 review wave fully landed; chunks B/E/F/G/H advancing.** **2026-05-01 (later)**: C.t1 implemented across 4 atomic commits (pool + config + URL validation, MCP-HTTP skeleton + ping tool, migration runner, libpq statement_timeout fix). Connector boots cleanly against `puma_dev`; `/healthz` + `/readyz` + `/mcp` (with no-op `ping`) all verified live; SIGTERM closes pool gracefully. Total tests now 519/519 (was 492; +27 for C.t1). 2026-05-01 (earlier) landed via 14 agent branches + 2 integration fixes: all fourteen pre-chunk-work review items closed (R1, R2, R3, R4-handoff, R4-server, Sec-1, Sec-2, Sec-3, Theme-A.1, H3, H4, H5, Perf-1, Perf-3, Test-1) + seven new tier-3 DRAFT plans (C.t1, C.t3, C.t3a, C.t4, C.t5, C.t6, C.t8) authored for chunk-C implementation. Sec-3 (`javascript:`/`data:` URL scheme rejection) was originally claimed-closed by Theme-A.1 but only validated against stale node_modules — actually closed by `be9ca95` adding a refine() check on top of `.url()`. The chat.ts-cluster agent (R2 + R4-server + Perf-3 + Test-1) also surfaced and fixed a latent Express 5 + Node 20 bug — `req.on('close')` fires synchronously after `express.json` drains, so the chat handler's mid-stream-disconnect listener never propagated to `abortController.abort()`; switched to `res.on('close')`. **Test count: 412 → 492 (+80)**. Earlier (2026-04-30): **C.t2** entity model + tool surface schemas (migrations 001–005 + 006; eight intent-named tools with five job-shaped derived tables); **C.26 graduated** with the customerreview supplementary dump (2,563 rows + 163 trip junctions); composer pattern removed (decision C.24); top-down-from-sales discipline elevated as theme 11. Earlier (2026-04-29): C.t0 + E.t8 + H.t7 + mock-host + blog ingest. Earlier (2026-04-28): G.11 / B.t1a + E.t2/E.t3/E.t4 + 12 new decisions. Next wave per [next-steps.md](next-steps.md).

**Review-fix status (2026-04-30 code review)**: 14 of 14 pre-chunk-work items closed. Cross-cuts H1+H2 (messageOf + emitErrorRaised helpers) deferred to pair with next chunk-C work; Theme-A.2/3/4/5 (Zod hygiene tightenings) and Perf-2 (parallel-not-serial triage) intentionally deferred per the review's strategic table. Master ledger: [planning/reviews/2026-04-30-code-level.md](planning/reviews/2026-04-30-code-level.md).

## 2026-05-12 session — swarm merge to main + engine-pin loosening + partial enrich kickoff

After a week's gap, the `claude/magical-johnson-3b07a1` feature branch (67 commits ahead of `main`, holding the full chunk-C swarm + B.t3a) was manually merged into `main`. Branch had been at a natural inflection point — the C.t8 commit message reads "closes chunk C" — so the merge brought in a coherent unit of work rather than half-finished state.

**State alignment vs the previous snapshot:** the swarm rolled forward most planning artefacts (decisions.md, per-task execution logs, `discoveries.md`, `gotchas.md`) but the consolidation pass on this file's headline status block + `next-steps.md` §0 was missed. Today's edits resolve that staleness only — no new direction.

**Environment changes:**

- `product/package.json` + `product/harness/package.json` engines loosened from `>=20.0.0 <21.0.0` to `>=20.0.0` (no upper cap). The original pin was set in the 2026-04-22 "Level 2 planning" scaffold commit (`8dea2fe`) with no recorded rationale in `decisions.md` or `gotchas.md`; the only related note in `gotchas.md` itself states that EBADENGINE warnings are benign. `.nvmrc` left at `20` so CI stays stable; bump in lockstep when ready to move CI forward.
- Stale `.git/index.lock` cleared (legacy from an earlier Cowork bash sandbox).

**Operational next step — running enrich:** chunk-C *code* is all merged but the C.t3a enrichment *run* hasn't fired yet. Domain tables in `puma_dev` carry the C.t3 smoke load (852 trips, 13,012 images, 906 FAQ, 2,160 customerreviews, 79 tags — all verified live today via psql). The 5 derived tables (`inspire_passage`, `customer_story`, `trust_proof`, `trip_card`, `inform_chunk`) are all 0 rows. Partial `--mode=embed` pass kicked off this session to populate `embedding` columns on domain tables without invoking the Anthropic Batches API path (synchronous Voyage-3 only, minutes-not-24h).

**Sync-classifier escape hatch — planned (not yet built):** the C.t3a classifiers hard-depend on Anthropic Batches per HITL Q4 ratification 2026-05-01 (50% cost discount, up to 24h SLA). For dev iteration loops, the 24h wait is friction. A deliberate carve-out — a `SyncMessageClient` implementing the existing `BatchClient` interface via `messages.create` + a `--no-batch` CLI flag — is being scoped via Claude Code in a separate session. Production runs continue via Batches; sync path is a dev-only escape hatch. No code changes yet; planning only.

## 2026-05-12 (afternoon) — C.t9 + C.t10 closures: Gemini swap + sync enrich mode

The afternoon session picked up the "Claude Code planning" thread above and broadened it. Al added a second change to the dev pass: switch out Voyage embeddings for Google Gemini. The two changes were authored as paired Tier-3 plans, HITL-ratified, and dispatched as parallel background agents.

### Plans authored + ratified

- [planning/03-exec-c-t9.md](planning/03-exec-c-t9.md) — Voyage-3 → Gemini-embedding-001 swap. 702 lines incl. HITL ratification appendix + post-execution deviations log. Commits `8342ab9` (initial draft) + appendix edits in this session.
- [planning/03-exec-c-t10.md](planning/03-exec-c-t10.md) — `--sync` CLI flag on enrich runner. 580 lines, same structure.

### Dispatch + closure mechanics

Two parallel `general-purpose` agents dispatched via `isolation: "worktree"` from main at `8342ab9`, each named (`ct9-gemini-swap`, `ct10-sync-mode`) so SendMessage recovery was available. Both agents ran ~10 minutes wall-clock, committed atomic feat/refactor commits per their plan, then exhausted turn budget partway through. Worktrees: `agent-a83ba1fb9d1c28045` (C.t9, 5 commits) and `agent-a66c98aa661327c72` (C.t10, 4 commits).

The closure (Step 8 + 9 + 11 for C.t9; Step 8/9 for C.t10; plus a `migrate.test.ts` bump for migration 009; plus all decisions / orientation docs) was completed in the spawning session against the merged branch.

### Notable execution deviation — `halfvec(3072)` not `vector(3072)`

The C.t9 plan body specified `vector(3072)` for migration 009. The dispatched agent discovered empirically against `puma_dev_scratch` that **pgvector's HNSW index has a hard 2000-dimension cap on the `vector` type** — `CREATE INDEX ... USING hnsw (... vector_cosine_ops)` fails at creation. The agent switched to **`halfvec(3072)`** (pgvector 0.7+, IEEE 754 binary16), which lifts the HNSW cap to 4000 dims and halves index memory with negligible recall loss. Opclass moved from `vector_cosine_ops` to `halfvec_cosine_ops` — same cosine semantics. **This is the right call**; decision C.46 records halfvec as the final shape. Documented inline in the migration header + in C.t9's "2026-05-12 Execution deviations + closure log" addendum. A new entry lands in `discoveries.md` so the next dim-change plan won't hit the same surprise.

### What landed in code

- `@swoop/ingestion`: new `GeminiClient` + tests (266 lines), retired `voyage.ts` + test, cost-ledger renames (`recordVoyage` → `recordEmbedding`; pass keys `voyage:*` → `gemini:*`; pricing $0.02 → $0.15 per 1M input tokens, ~7.5× per-token but full-corpus pass still ~£4–£8 once-off and inside the £10 dev cap), `--sync` CLI flag, `SyncMessageClient` (319 lines of tests), `isBatched: boolean` on `BatchClient` interface, classifier modules updated to consume it, `capToGeminiInput` defensive cap in `chunk.ts` (Gemini's 2048-token input ceiling — soft-truncate at the persona-aggregation boundary).
- `@swoop/connector`: migration 009 (`halfvec(3072)` column re-creation + 9 HNSW indexes); `migrate.test.ts` bumped to expect 001–009.
- `product/cms/ops/sync-mode.md`: operator runbook entry for `--sync`.
- `product/ingestion/src/enrich/index.ts`: auto-merged cleanly across the two agent branches (Gemini construction + `--sync` flag are textually orthogonal; Git's `ort` strategy handled it).

### Decisions logged

- **C.46** — Gemini-embedding-001 at `halfvec(3072)` (supersedes the Voyage-3 sub-bullet in C.18; the storage-engine choice in C.18 itself is unchanged).
- **C.47** — Sync enrich mode `--sync` flag for dev iteration (carve-out from HITL Q4).
- Inline supersession marker added to the Voyage-3 sub-bullet inside C.18's "Stack pinned" section.

### Tests after closure (fresh `npm install` → `npm test --workspaces --if-present`)

| Workspace | Tests |
|---|---|
| `@swoop/common` | 141 |
| `@swoop/orchestrator` | 160 |
| `@swoop/connector` | 97 (+ 3 DB-gated skipped) |
| `@swoop/ui` | 62 |
| `@swoop/ingestion` | 256 |
| `@swoop/harness` | 74 |
| **Total** | **790 + 3 skipped** |

One transient flake observed on `@swoop/orchestrator` `POST /chat ... CHAT_MESSAGE_MAX` on a parallel-workspace run; passed on focused re-run and on the second full run. Not introduced by C.t9 or C.t10 — flagged for awareness.

### Pending — needs Al

- **C.t9 Step 10 smoke** — set `GEMINI_API_KEY` in `product/connector/.env` (per the GCP setup notes captured in conversation: enable Generative Language API on the dev project, attach billing, generate AI Studio API key), then `npm run -w @swoop/ingestion enrich -- --mode=embed --source=tag --limit=10`. Verify: `psql -d puma_dev -c "SELECT id, vector_dims(embedding::vector) FROM tag WHERE embedding IS NOT NULL LIMIT 5;"` → 3072.
- **C.t10 Step 7 smoke** — with `ANTHROPIC_API_KEY` set, run `npm run -w @swoop/ingestion enrich -- --mode=classify --source=blog-post-job --sync --limit=5`. Verify: 5 blog_post rows gain a `primary_job` in <30s wall-clock.
- **Apply** — when smokes are good, merge `claude/reverent-yonath-f1c780` to main.

## B.t3a closed (2026-05-02 — connector adapter sunset)

Triggered by C.t4 landing the eight intent-named tools on the real `@swoop/connector` (`:3002`). Pre-this, the orchestrator's adapter still registered `search` + `get_detail` + `illustrate` + `handoff` + `handoff_submit` against the in-tree stub at `:3001`. **B.t3a folded the librarian-shaped pair, swapped the wire to the real connector, and retired the stub.** ~0.5 day. Six atomic commits.

### What landed

| Commit | Scope |
|---|---|
| `d697007` | `refactor(common)`: retire deprecated `Search*` / `GetDetail*` Zod schemas + types from `@swoop/common`. |
| `f9e81f9` | `feat(orchestrator)`: register the 8 intent-named tools on the connector adapter; load descriptions from `cms/prompts/tools/<tool>/description.md` via `loadAllToolDescriptions` (re-exported from `@swoop/connector`). New config field `TOOLS_PROMPT_DIR`. |
| `d75df3f` | `feat(orchestrator)`: `CONNECTOR_URL` default flips `:3001` → `:3002` (real connector). |
| `33ccd42` | `refactor(orchestrator)`: retire `product/orchestrator/test-fixtures/stub-connector.ts` (option a per the brief). |
| `30de639` | `chore(orchestrator,ui,common,harness)`: cross-cut sweep. UI retires `SearchResultsWidget` + `ItemDetailWidget` (D.t9 will rebuild for the new five conversational tools). Harness fixture renames. CMS event sample fixtures move off `search`. Operator runbook env-var name fixed. |
| (this commit) | `docs(planning)`: B.t3a execution log + orientation file updates. |

### Verification (per the false-green lesson)

- All 6 workspaces green on fresh `npm install`. **Total: 767 + 3 DB-gated skipped = 770/770.**
- Per-workspace: `@swoop/common` 141 (=) / `@swoop/orchestrator` **160** (was 158, +2) / `@swoop/connector` 97+3 skipped (=) / `@swoop/ui` **62** (was 71, **−9** for retired widgets) / `@swoop/ingestion` 233 (=) / `@swoop/harness` 74 (=).
- Typecheck clean across all 5 buildable workspaces.
- `grep -rn 'SearchInput\|SearchOutput\|GetDetailInput\|GetDetailOutput' product/` returns 0 hits.

### What B.t3a unblocks

- **D.t9** (UI widget rewrite for the five intent-named conversational tools — `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`). Until D.t9 lands, Sonnet weaves the structured outputs of those five tools directly into prose; only `illustrate` and `handoff` carry visible widget renderers.
- **Live smoke testing on the real connector**: orchestrator + connector now talk over real MCP-over-HTTP. The hello-world manual runbook in `product/orchestrator/README.md` is updated to point at `npm run dev -w @swoop/connector` (real connector at `:3002` against a populated `puma_dev`).

### Decision logged

**B.t3a — Option (a) Retire** the stub at `product/orchestrator/test-fixtures/stub-connector.ts`, don't rewrite for the eight-tool surface. Reasoning + reversibility cost in the [B.t3 plan's B.t3a addendum](planning/03-exec-agent-runtime-t3.md#bt3a--connector-adapter-sunset-2026-05-02-execution-log).

### Notable findings during execution

1. **The connector's `loadAllToolDescriptions` is the right place to own the loader** — re-exporting it from `@swoop/connector` keeps the description-loading contract identical on both sides of the wire (orchestrator + connector both load the same eight files). The orchestrator already depends on `@swoop/connector` for `FsHandoffStore`, so the dep is paid for.
2. **`as Config` casts in test fixtures had been masking config-shape drift.** Both `hello-world.test.ts` and `triage-classifier.test.ts` use `as Config` casts; adding `TOOLS_PROMPT_DIR` could have silently been missing. Pattern to remember: when extending the `Config` type, grep for `as Config` and update every fixture in lockstep.
3. **The `claude-llm.test.ts` `'search'` placeholders are NOT a B.t3a concern** — they exercise the Anthropic SDK shim's tool-schema serialisation; the tool name is opaque framework-level data. Distinguishing "tool surface concern" from "SDK shim concern" was the right discipline for keeping the diff minimal.

---

## C.t6 + C.t3a fold (2026-05-02 — HITL-ratified architectural collapse)

Per Al's HITL session 2026-05-02: fold C.t3a's separate Haiku-text-only image-annotation classifier into C.t6's Vision call. **One Claude Vision call per image now produces all six outputs** (description + annotation + subject_tags + mood_tags + region_tags + tags) instead of two passes (Vision for description + annotation, Haiku for the four tag arrays). Cheaper, simpler, one prompt to iterate, one cost cap to manage. Decision logged as **C.40**.

**What landed**:
- **Migration 008** (`product/connector/migrations/008_image_tag_columns.sql`) — forward-only-idempotent assertion of the four tag-array columns on `image` (already declared in 002) plus the `tags` GIN index that 004 didn't carry.
- **C.t6 Vision prompt** (`product/cms/prompts/etl/image-annotation/prompt.md`) — bumped to `version: 2` with a four-tag-array section, vocabulary cues per bucket, "what NOT to do" extended to cover tag-array hygiene (no padding, no cross-bucket repetition), worked examples now show all six outputs.
- **C.t6 Zod schema** (`product/ingestion/src/images/output-schema.ts`) — extended to `description + annotation + subject_tags[] + mood_tags[] + region_tags[] + tags[]`, all four arrays default to `[]`.
- **C.t6 write-back** (`product/ingestion/src/images/write-back.ts`) — single SQL UPDATE now touches all six output columns plus `modified_at`. Description still COALESCE-gated; annotation + tag arrays always-write.
- **C.t6 runner** (`product/ingestion/src/images/run.ts`) — threads tag arrays from parsed Vision response through `ProcessOutcome` into `writeAnnotation`.
- **C.t3a image-annotation classifier retired**: deleted `product/ingestion/src/enrich/classify/image-annotation.ts`, removed import + dispatch from `enrich/run.ts`, retired `ImageAnnotationOutputSchema` + `'image-annotation'` from `enrich/schemas.ts` `CLASSIFIER_SCHEMAS`. Help text in `enrich/index.ts` updated to point operators at the C.t6 CLI.

**Tests delta**: ingestion workspace +6 / -2 net (output-schema gained 5 cases for tag arrays + skip-signal coverage; write-back rewritten for single-shape SQL with 5 cases; run.test.ts gained the end-to-end "writes the four tag arrays" case; enrich/schemas.test.ts lost 2 cases for the retired schema). All 6 workspaces remain green (verified locally; full fresh-install verification in commit-time).

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

## C.t3 implemented (2026-05-02 — second chunk-C executor agent, ~0.5 day; under estimate)

Second chunk-C tier-3 plan executed. SQL-dump → Postgres transform end-to-end. The 2026-04-27 main dump + 2026-04-30 supplementary customerreview dump now flow into `puma_dev`'s 19 domain tables in ~10s wall-clock. Idempotent re-run produces zero row-count delta. See [planning/03-exec-c-t3.md](planning/03-exec-c-t3.md) §"Execution log" for the full breakdown.

### Four atomic commits

| Commit | Scope | Tests delta |
|---|---|---|
| `7eb8f34` | MariaDB SQL-dump parser (Option B per HITL Q1) — streaming, ~617K rows in ~4s | +16 (31→47) |
| `043ad66` | Domain-table upsert helper with ON CONFLICT DO UPDATE + non-clobbering noUpdateColumns | +5 (47→52) |
| `474575c` | Per-source-table transformations + lookup-builder — 19 transforms | +32 (52→84) |
| `5041d48` | Pipeline runner + CLI + daybyday concat (HITL Q2) + README + package.json | (no new tests; live-smoked) |

### End-to-end verification (per plan §"Verification" + the false-green lesson)

- All 6 workspaces green on fresh `npm install` + `DATABASE_URL=…puma_dev npm test --workspaces --if-present`. **Total: 576/576** (was 523; +53 from C.t3, all in @swoop/ingestion: 31→84).
- Per-workspace: `@swoop/common` 102 / `@swoop/orchestrator` 158 / `@swoop/connector` 87 / `@swoop/ui` 71 / `@swoop/ingestion` **84** / `@swoop/harness` 74.
- Typecheck clean across all 6 workspaces.
- ETL CLI runs end-to-end against the real dumps in 9.61s wall-clock (target was ≤10 minutes — beating it 60×).

### Live row counts (fresh `puma_dev`)

```
country: 239   area: 16   location: 764   activity: 751
tag: 79                        [matches plan: 79 ✓]
image: 13012/13261             [matches ~13K ✓]
page: 636/684                  [40 Profile + 7 test + 1 dup_canonical filtered]
contentblock: 2212/10110       [7,898 navigationcard/settings/etc. filtered]
chunk: 46                      [matches plan: 46 ✓]
faqitem: 906/928               [matches ~928 ✓]
trip: 852                      [matches plan: 852 ✓]
tour: 11/15                    [4 filtered: 3 non-itinerary blocks + 1 test page — C.focused-shamir-1, 2026-05-14]
tour_item: 35/36               [1 dropped: fk_drop_tour_id, parent is the filtered test-page tour]
hotel: 44   vessel: 25   cabintype: 108   cabin: 98
customerreview: 2160/2563      [403 unpublished filtered]
customerreview_trip: 145/163   [matches ~163 ✓]
```

### HITL Q resolutions verified in code

Q1 Option B (Node CLI translator) — chosen and shipped. Q2 daybyday concatenated to `trip.description` with "Day N: " prefixes. Q3 no tombstone pass. Q4 trip image `image_trip` first then `image_page` fallback (proposed C.39 in decisions log; renumbered from the plan's "C.36" because that was already taken). Q5 ship-without-publishstate-filter — flagged in execution log as still pending Thomas/Richard. Q6 stay in `@swoop/ingestion`. Q7 `pagetype_title` denormalised onto `page`. Q8 filter shape A (transform code, not Postgres views) (proposed C.38 in decisions log; renumbered from the plan's "C.35" because that was already taken).

### Smoke checks (W-Trek trip 369)

- `canonical_url` = `https://www.swoop-patagonia.com/chile/torres-del-paine/hiking/w-trek` ✓
- `from_price` = 2900.00 USD ✓
- `image_id` resolves via `image_trip` first per HITL Q4 ✓
- `ntag_ids` = 5 tags via the aggregator ✓
- `description` starts with "Day 1: …" confirming daybyday concatenation ✓
- ntag area filter `ntag_ids @> ARRAY[(SELECT id FROM tag WHERE alias='torres-del-paine')]` returns the W-Trek + 4 sibling Torres del Paine trips ✓

### Notable findings during execution

1. **Page self-FK requires a two-pass write.** `page.parent_id REFERENCES page(id)` is non-deferrable. Multi-row INSERT lands child rows before parents in the batch — Postgres rejects on the missing target. Two-pass: INSERT with `parent_id=NULL`, then UPDATE … CASE … END to wire ids. Same pattern would apply to any future self-FK at our scale.
2. **Source `override_url || alias` collisions.** A handful of source page rows have colliding canonical URLs (legacy alt versions). Within-batch dedupe by canonical_url required before INSERT to satisfy `page.canonical_url UNIQUE`; lowest-id winner. Same generic dedupe applied to `tag.alias`, `trip.slug`, `tour.slug`, `hotel.slug`, `vessel.slug`.
3. **FK-nullify vs FK-drop boundary policy.** Source rows reference filtered targets (Profile pages, soft-deleted images). Soft FKs (page.image_id, contentblock.page_id, trip.page_id, etc.) → null at write; hard FKs (cabin.vessel_id, customerreview_trip.{customerreview_id, trip_id}, tour_item.tour_id) → drop the row. Generic `FkRule` shape in `run.ts` makes the boundary explicit per table.

### Open questions surfaced for HITL (not blocking C.t3a)

1. **Source `tours` is content-empty** — 15 rows, almost all NULL-titled. The 36 `tour_items` can't anchor without a parent. Question for Thomas/Richard: do we expect `tour` to carry rows, or is multi-region/tour content rendered via `contentblock_tour` rows referencing trips directly? Won't block C.t3a; flagged for C.t4 / B.t3a tool-handler design. **— RESOLVED 2026-05-14 (C.focused-shamir-1)**: `tours.title` is vestigial; tour identity lives on the parent contentblock's page. The ETL now derives it — `puma_dev` carries 11 tours + 35 tour_items. Residual ask (confirm the `contentblock.type_id = 152` constant) tracked in [questions.md](questions.md) "Tour content population".
2. **`area` / `location` hierarchy** — source columns don't carry `country_id` / `parent_area_id`; hierarchy is via the page parent_id chain. Left null. C.t3a can derive via a page-walk if `find_locations` retrieval needs it.
3. **`activity` (751 rows)** populated as first-class but with title-only — the source `activity` is per-trip-per-area data, mostly NULL secondary fields. Worth checking whether `find_activities` semantics are better served by the `tag` taxonomy + `inspire_passage` retrieval; if so, the `activity` domain table is dead weight.

### Decisions logged

- **C.38** — Filter shape A (filters in transform code, not Postgres views) — HITL Q8.
- **C.39** — Trip image resolution: `image_trip` first, `image_page` fallback, single `trip.image_id` — HITL Q4.

### Downstream what's now possible

- **C.t3a** can begin. Domain tables populated end-to-end; embedding pass + Haiku ETL classifiers all have data to read.
- **C.t6** can begin. ~6.3K images already carry source `description` (~47.5%); ~6.7K need vision annotation — primed by the source data, less than the plan's £30–£150 estimate suggested.
- **C.t4** still gated on C.t3a's derived job-shaped tables before it can register the eight intent-named tool handlers.

**Coordination point for C.t3a**: column ownership convention is enforced by `noUpdateColumns` in the upsert helper. C.t3 owns: `id`, `canonical_url`, `intro_text`, `summary`, `description`, `width`, `height`, etc. C.t3a owns: `embedding`, `subject_tags`, `mood_tags`, `region_tags`, `alt_text`, `persona_summary`, `persona_embedding`, `primary_job`, `secondary_jobs`. Re-running C.t3's CLI never clobbers C.t3a's columns because they're explicitly excluded from the `ON CONFLICT DO UPDATE SET` clause via the COLS map in `run.ts`.

---

## C.t1 implemented (2026-05-01 — first chunk-C executor agent, ~0.5 day)

First chunk-C tier-3 plan executed. Stood up `@swoop/connector` as a runnable service: Postgres pool + Express + MCP-over-HTTP transport + health endpoints + migration runner. The orchestrator continues to talk to the existing stub at `:3001`; the new connector boots independently on `:3002` with a no-op `ping` tool until C.t4 registers the eight intent-named tools. See [planning/03-exec-c-t1.md](planning/03-exec-c-t1.md) §"Execution log" for the full breakdown.

### Four atomic commits

| Commit | Scope | Tests delta |
|---|---|---|
| `735c585` | Postgres pool + DATABASE_URL config + stricter URL validation (mirrors Sec-3 / be9ca95 shape — scheme allowlist + db name) | +19 (56→75) |
| `5bab8c4` | MCP-HTTP surface skeleton with no-op ping tool (HITL Q4 option α) | +6 (75→81) |
| `1f7ade8` | `node-pg-migrate` runner + `migrate:up` script (forward-only per C.31) | +2 (81→83) |
| `3d42175` | Live-smoke fix: `statement_timeout` via libpq startup options (no race vs `on('connect')` query queue) | +1 (83→84) |

### End-to-end verification (per plan §"Verification" + the false-green lesson)

- All 6 workspaces green on fresh `npm install`. Total: **519/519** (was 492; +27 from C.t1's new tests).
- Per-workspace: `@swoop/common` 102 (unchanged) / `@swoop/orchestrator` 158 (unchanged — orchestrator unaffected confirmed) / `@swoop/connector` **84** (was 56; +28, with 3 DB-gated tests skipped in CI mode) / `@swoop/ui` 71 (unchanged) / `@swoop/ingestion` 31 (unchanged) / `@swoop/harness` 74 (unchanged).
- Typecheck clean across all 6 workspaces.
- Service boots, `/healthz` returns `{"status":"ok"}`, `/readyz` returns `{"status":"ready","db":"ok"}` against a live test DB, MCP discovery returns exactly the `ping` tool, `ping` returns `{ok: true, version: '0.1.0'}`, SIGTERM produces graceful shutdown.
- Migration runner applies all 6 SQL files (001–006) cleanly to a fresh DB; re-run is "No migrations to run!" — idempotent forward-only confirmed (theme 5).

### HITL Q resolutions verified in code

Q1 pool defaults `max:10 / idle:30s / statement_timeout:10s` documented + tunable via env. Q2 manual `npm run migrate:up`; default `pgmigrations` table; boot-time auto-migration explicitly *not* implemented. Q3 `src/data/README.md` codifies the per-primitive convention. Q4 (option α + ping) MCP-over-HTTP server stands up empty save for the no-op `ping` tool. Q5 stricter `DATABASE_URL` validation rejects `https://example.com`, `javascript:alert(1)`, multi-segment paths, and missing db name at boot. Q6 `:3002` claimed; `:3001` stub stays. Q7 `FsHandoffStore` left untouched.

### Notable findings during execution

1. **`pg`'s `client.query()` deprecation when used in `on('connect')` is real.** Live-smoke surfaced what unit tests didn't catch: setting `statement_timeout` via the connect handler races with pg's internal driver-init queries. Fix: pass via the libpq `options` startup parameter (`-c statement_timeout=<ms>`). Cloud SQL honours this. Future pool tunables: prefer libpq startup options over `on('connect')`. Captured in `discoveries.md`.
2. **`node-pg-migrate` emits informational `"Can't determine timestamp for NNN"` warnings** when migrations don't carry timestamp prefixes. Our zero-padded prefix per C.31 is the durable choice; warnings are benign. Mention in C.t8 if operators worry.
3. **npm shell wrapper doesn't propagate SIGTERM cleanly to its tsx child.** Local-dev concern; production (Cloud Run / Docker) sends SIGTERM to PID 1 directly, not via npm. Captured in `gotchas.md`.

### Downstream what's now possible

- **C.t3** can begin. CLI in `@swoop/ingestion` imports `getPool` / `withPgClient` from `@swoop/connector` (or builds its own — design call).
- **C.t3a** can begin in parallel with C.t3 once C.t3's transform shape is settled.
- **C.t4** can begin once C.t3 + C.t3a have populated rows. Tool handlers register on the existing `createConnectorMcpServer`; the no-op `ping` is removed there.
- **C.t8** documents the operating shape stood up here.

**Coordination point for the next chunk-C agent**: H1 (`messageOf` helper) + H2 (`emitErrorRaised` helper) — pair these into the *first* commit of whichever C.t* agent next touches the 16-site sweep. They're consumed by the new tool handlers' error envelopes per the 2026-04-30 review's strategic table. C.t1 didn't touch the 16 sites so didn't pick them up.

---

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
| **C — retrieval & data** | MCP connector + Postgres derived store + ETL + eight intent-named tools + annotation pipeline | ✅ **Implementation spine closed.** C.t0 (2026-04-29), C.t2 + C.26 graduation (2026-04-30), C.t1 (2026-05-01), C.t3 + C.t3a + C.t4 + C.t5 + C.t6 + C.t8 (2026-05-02). All merged to `main` 2026-05-12. **Operational state**: domain tables populated via C.t3 live-smoke (852 trips / 13K images / 906 FAQ / 2,160 customerreviews / 79 tags); derived tables empty pending the C.t3a enrich *run* (partial `--mode=embed` pass underway 2026-05-12). | Stub connector retired by B.t3a; orchestrator now talks to the real `@swoop/connector` at `:3002`. Eight intent-named tool handlers registered, `ping` removed. C.t6 + C.t3a folded into a single Claude Vision call per decision C.40. **C.t2 contract layer** still load-bearing: 21 domain tables + 5 derived tables + 73 indexes + 5 intent-named tool I/O Zod pairs + production-quality tool descriptions + fixtures. **`find_someone_who` live**; customertip remains pending Swoop's separate delivery. Per-task execution logs in [planning/03-exec-c-t*.md](planning/) carry the implementation detail this row no longer duplicates. |
| **D — chat surface** | Full chunk shipped (t1–t8); **t9 (mount-rehydrate) unparked 2026-04-29** | ✅ Core closed; D.t9 reactivated | ErrorBanner + preflight + mobile reflow + brand extension surface all shipped. **D.t9** unparked alongside B.t11 — pairs with server-side history endpoint to resolve the assistant-ui auto-rehydrate gap. |
| **Mock-host harness** | Side-quest. 5-page static site + iframe trigger + sidebar | ✅ **Shipped** (Al-built; verified 2026-04-29) | Reproduces production iframe-remount failure mode. Active demo + observation surface. See [planning/02-impl-side-quest-host-harness.md](planning/02-impl-side-quest-host-harness.md). |
| **E — handoff & compliance** | Triage-aware handoff + persistence + email + legal | **Mostly shipped** (t1, t2 interim, t3 off-by-default, t4 functional, **t6 interim sweeper landed 2026-05-12**, t8 skeleton). **t5 + t7 + t9 open.** | E.t1 schema (2026-04-24), E.t2 file-backed interim + E.t3 mailer + E.t4 end-to-end consent flow (all 2026-04-28), **E.t8 compliance-bundle skeleton 2026-04-29**, **E.t6 interim sweeper 2026-05-12**: `HandoffStore.sweep` + `delete` at the interface + `sweepHandoffs(deps)` wrapper + in-process timer in orchestrator + `bin/sweep.ts` CLI external-trigger + 22 new tests + operator runbook + compliance-bundle §05 updated (counsel-review footnote). Cloud Run Job replaces the timer at E.t2 proper. Remaining: legal copy (t5; gates Q1 voice anchors), data-deletion script (t7; was a runbook, becomes `psql DELETE` script), legal counsel review (t9 — gates M5). |
| **F — observability** | Structured event logging + schema + producer retrofit | Partial (F-a + F-b done) | F-a schema (20+ event kinds) + F-b retrofit. `handoff.submitted` event now emitted on successful submit. Remaining: B.t9 `skill.loaded` + B.t2 sweeper's `session.ended{idle_timeout}`. |
| **H — validation** | Lightweight eval harness + post-launch ritual | Partial (H.t1 + **H.t7** done) | H.t1 scaffold + **H.t7 living-evalset growth runbook** (2026-04-29) shipped. H.t3 assertions + H.t4 real scenarios + H.t5 judge calibration still open. Decisions H.17–H.20 added with H.t7. |
| **G — content** | System prompt, skills library, HITL flow mapping, **CMS structure**, **style-control** | Partial (G.10 + G.11 + structural plumbing) | **G.10** (2026-04-24) two-layer voice: `00_why.md` + `10_style-avoid.md`. **G.11** (2026-04-27) CMS folder structure decided + plumbing in place. Real content (G.t1 prompt + G.t3 skills + G.t0 HITL flow mapping) waits on the Q1 ensemble walk in [planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) + Luke + Lane's sales-thinking doc (~May 4). |
| **Blog ingest** | Parallel C-stream — WP REST → NDJSON snapshots | ✅ **Implemented** in `@swoop/ingestion` | 753-line single-file pipeline, 31 tests passing, 5y rolling window, 102 posts in current snapshot. See [planning/03-exec-blog-ingest.md](planning/03-exec-blog-ingest.md). Embedding + Postgres insert deferred pending HITL on data shape. |

---

## Workspaces

`product/` is an npm-workspaces monorepo. **Six workspaces ship code today**. **519 tests passing** (was 492; +27 from C.t1 connector substrate):

| Workspace | Purpose | Test count |
|---|---|---|
| `@swoop/common` | Shared types, schemas, `emitEvent` helper, fixtures, eight-tool I/O Zod, derived-entity Zod | 102 |
| `@swoop/orchestrator` | Agent runtime, server, session store, prompt loader, route handlers | 158 |
| `@swoop/connector` | Mailer, durable handoff store, `submitHandoff()` orchestration. **C.t1 added**: runnable service at `:3002` (Express + MCP-HTTP + Postgres pool + health + migrate runner). Postgres migrations 001–006 at `migrations/`. | 84 |
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

1. **Real data**: ✅ Chunk-C implementation closed (C.t1–C.t8 all merged to `main` 2026-05-12). Domain tables populated via C.t3 (852 trips / 13K images / etc.). **Outstanding operational step**: run the C.t3a enrich pass to populate the 5 job-shaped derived tables — `inspire_passage` / `customer_story` / `trust_proof` / `trip_card` / `inform_chunk`. Partial `--mode=embed` pass underway 2026-05-12 (embedding columns on domain tables; synchronous Voyage-3 only, no Batches API). Full `--mode=all` deferred pending the sync-classifier escape hatch (planning in flight via Claude Code) — the Batches API's up-to-24h SLA was deemed too coarse for dev-loop iteration, so a `--no-batch` synchronous path is being scoped as a deliberate carve-out from HITL Q4. Production runs continue to use Batches for the 50% cost discount.
2. **Content**: same discovery design HITL produces G.t1 (first-pass WHY prompt) + G.t3 (≥2 seed skills); refine when Luke + Lane's sales doc lands (~May 4).
3. **Handoff (E)**: Julie confirms SMTP + sales inbox → flip `HANDOFF_EMAIL_ENABLED=true` → live email path. Legal copy review (E.t5). Firestore swap when GCP IAM lands (E.t2 proper).
4. **Compliance sign-off**: Swoop's legal counsel reviews disclosure + consent bundle (gates M5).
5. **Deploy**: Cloud Run + GCP "AI Pat Chat" IAM (Thomas owns).

All of this is planned at Tier 2 altitude in [planning/02-impl-*.md](planning/).
