# Next Steps — Swoop Web Discovery (Puma)

Prioritised resume guide. Read [progress.md](progress.md) first for state, [discoveries.md](discoveries.md) + [gotchas.md](gotchas.md) before touching code.

---

## Status (2026-05-13 — four sequenced waves landed today; `claude/brave-pare-5e0eba` is the fourth, pending merge to `main`)

**Today's four waves in landing order:**

1. **Morning five-plan batch** — D.t9 widget rewrite + D.t9-mount-rehydrate + B.t11 + E.t6 + crosscut find_options polymorphism v1. (Detailed in the §"Status (earlier)" section below.)
2. **BF-FO-v3** — find_options v3 backfill: hotels + region_bases data primitives wired live ([planning/03-exec-crosscut-find-options-v3-backfill.md](planning/03-exec-crosscut-find-options-v3-backfill.md), decisions C.bf-1..6).
3. **BATCH-C.t6 + VERDICT-E.t1** — image-annotation batches submission path wired ([planning/03-exec-c-t6-batches-submission.md](planning/03-exec-c-t6-batches-submission.md), decisions C.batch-1..4) + handoff schema discriminated-union tightening ([planning/03-exec-e-t1-wire-tightening.md](planning/03-exec-e-t1-wire-tightening.md), decisions E.verdict-1..5).
4. **brave-pare live-smoke wave** (this branch, pending merge) — boot-and-poke verification surfaced four follow-on defects, each fixed with a Tier-3 plan authored first:

| Fix | Plan | What landed |
|---|---|---|
| App-level crash on mount | (D.t9-mount-rehydrate addendum; commit `34af1de`) | `useRehydrate` takes `runtime` as an explicit prop instead of grabbing it from context above the provider (where assistant-ui v0.12.25's `useAui` Proxy throws). |
| Visitor-query Voyage holdover | [03-exec-c-t9.md addendum — Gemini visitor-query embedder](planning/03-exec-c-t9.md) | `connector/src/data/embed-query.ts` swapped Voyage→Gemini at halfvec(3072), matching the corpus side. +6 tests. |
| Widget empty-state silence + malformed-placeholder churn diagnosis | [03-exec-crosscut-brave-pare-widget-user-copy-fix.md](planning/03-exec-crosscut-brave-pare-widget-user-copy-fix.md) | Four widgets yield to agent prose on empty results; malformed-placeholder root cause traced to upstream tool throws + empty-state churn (no widget code change needed). |
| `trip.region_id` backfill (closes C.t3 ETL punt) | [03-exec-crosscut-brave-pare-trip-region-id-backfill.md](planning/03-exec-crosscut-brave-pare-trip-region-id-backfill.md) | `transformTrip` derives `region_id` from area-typed tag intersection with `area.alias`; multi-area picks lowest `area.id`. 617/852 trips populated. Closes BF-FO-v3's live-data smoke pending-Al item (region_base now renders live). |
| Render CMS-authored HTML | [03-exec-crosscut-brave-pare-render-cms-html.md](planning/03-exec-crosscut-brave-pare-render-cms-html.md) | `RegionBaseCard.vibeLine` / `baseFraming` render via `dangerouslySetInnerHTML` (trust boundary: internal CMS, not visitor input). Wrapper switched `<p>` → `<div>` so nested `<p>` is valid. |
| Cards never silently truncate | [03-exec-crosscut-brave-pare-card-expandable-prose.md](planning/03-exec-crosscut-brave-pare-card-expandable-prose.md) | New `<ExpandableProse>` shared component (line-clamp + inline "Read more" toggle, overflow detection via temp-unclamp pass in `useLayoutEffect`). Applied to RegionBaseCard / TripCard / HotelCard. Connector stops server-side 140-char truncation. +6 tests. |
| WYSIWYG decorative whitespace strip | (folded into the expandable-prose plan; commit `f9b1d1d`) | New `trimCmsDecorativeWhitespace` helper at the connector boundary strips trailing `<br>`/`&nbsp;`/empty `<p></p>` from CMS prose. Closes a false-positive overflow detection caused by trailing `<br>` inflating unclamped `scrollHeight`. +11 tests. |
| CTA copy update | (commit `db2365f`) | RegionBaseCard CTA: "Use as a base" → "Explore {region}". Mirrors agent prose framing; aria-label matches. |

**Tests after brave-pare wave merged**: 984 + 3 DB-gated skipped on fresh-ish `npm install` — `@swoop/common` 170, `@swoop/orchestrator` 170, `@swoop/connector` 166 + 3, `@swoop/ui` 118, `@swoop/ingestion` 286, `@swoop/harness` 74.

**Decisions logged this wave**: still TBD (see plan files for context); Al to assign numeric IDs at merge.

**HITL items closed by the brave-pare wave**:
- BF-FO-v3 region_base live-data smoke → done (Santiago + Buenos Aires + Torres del Paine + Tierra del Fuego cards verified rendering live; trip.region_id backfill closed the upstream data gap).
- C.t9 visitor-query Voyage holdover → done.

**Newly-open follow-ups from the brave-pare wave**:
- **trip.country_id backfill** — same source as `region_id` (via `area.country_id`), separate user-visible value. Plan called out as scope-cut. ~30 min when needed.
- **find_options tour variant** — ✅ **landed 2026-05-15** (C.focused-shamir-2). `tour_card` populated (11 rows + embeddings), `queryTourCardsByFilter` live, `find_options(preferredType: 'tour')` returns real tour cards. **Region follow-up 2026-05-18** (C.focused-shamir-6): region now derived from the page-parent chain (Atacama for tour 72, Torres del Paine for tour 77; 9 NULL = pan-Patagonia). Region is informational on the card, not a filter — `queryTourCardsByFilter` returns every tour and the agent reasons contextually. Supersedes the 2026-05-15 "region unrecoverable" entry in discoveries.md.
- **Truncation HTML-awareness** — `vibeLineFromSource` could split mid-tag if Swoop's CMS ever populates >3-line content. Park; revisit if HITL surfaces a real case.
- **Strict CMS-HTML sanitiser** for defence-in-depth (e.g. allow-listed tags via DOMPurify) — currently rely on the trust boundary; revisit if Swoop legal counsel asks for it pre-M5.
- **`@swoop/ui` typecheck regression** (pre-existing on main, broader than originally noted: ~24 errors across 7 widget files) — flagged in inbox.md.

---

## Status (earlier — 2026-05-13 — five-plan parallel batch landed: D.t9 widget rewrite + D.t9-mount-rehydrate + B.t11 + E.t6 + crosscut find_options polymorphism v1; chunk-C voyage→Gemini swap (C.t9) + sync classifier (C.t10) merged earlier; chunk-C implementation spine fully closed; chunk-D fully closed; chunk-E retention enforcement live)

**2026-05-13 (today)**: HITL ratification batch from 2026-05-12 fully executed. Five Tier-3 plans authored, ratified, executed, and merged in parallel:

| Plan | What landed | Tests |
|---|---|---|
| **E.t6** | Handoff retention sweeper — interface-level `HandoffStore.sweep()` + in-process timer + CLI external-trigger + operator runbook + counsel-review note | +22 |
| **D.t9-mount-rehydrate** | UI-side `useRehydrate` hook + `replayPartsIntoThread` + 4 UI event kinds + 404 soft-fail with notification | +14 |
| **Crosscut: find_options polymorphism v1** | `ProposalCardPublicSchema` discriminated union (trip\|tour\|hotel\|region_base) in `@swoop/common`; trip variant wired live; description.md rewritten with Tours upsell instruction | +15 |
| **B.t11** | Server-side `GET /session/:id/history` endpoint + 4 event kinds + migration 010 placeholder | +14 |
| **D.t9 widget rewrite** | 5 conversational-tool widgets + 4 polymorphic ProposalCard variant renderers; AttributeTable consumer wired | +50 |

**Tests**: 818 → **908** (+90, all 6 workspaces green on fresh `rm -rf node_modules + npm install`). Per-workspace: `@swoop/common` 160, `@swoop/orchestrator` 170, `@swoop/connector` 126 (+ 3 DB-gated skipped), `@swoop/ui` 112, `@swoop/ingestion` 266, `@swoop/harness` 74.

**Decisions logged**: B.25–B.29 (B.t11), C.48–C.51 (find_options polymorphism), D.26–D.30 (D.t9-mount-rehydrate), D.t9 widget per-tool decisions, E.t6 retention-sweeper decisions in plans.

**Operator-side learning** (also captured in [discoveries.md](discoveries.md) 2026-05-13): always pass `name` to background `Agent` calls and invoke `unsticking-stalled-background-agents` skill *before* any parallel/background dispatch batch. When an agent's summary looks truncated: send `SendMessage(to: name, "continue")` first; only take over if two nudges fail. Two of five agents this session needed manual takeover that "continue" would have avoided.

**Open HITL queued from this batch**:
- D.t9 Q3 — persona-summary visual treatment in `find_someone_who` (italic with "Someone like…" preface / italic no preface / "Why this story?" header). Executor's choice carries forward; check the file for which option landed.
- B.t11 — auth posture (session-id-as-secret vs short-lived bearer token) needs Swoop-legal input via E.t9.
- B.t11 — `session.expired{gate:'consent'}` analytics-noise tuning.
- B.t11 — rate-limiting per session id in Phase 1.
- B.t11 — paginated history endpoint post-M4.
- D.t9-mount-rehydrate — notification copy location (inline vs `cms/errors/`), 5xx retry behaviour, visibilitychange trigger, latency telemetry, in-progress form rehydration.
- E.t6 — counsel-review note in `05-retention-policy.md` to surface at E.t9 (hard-delete posture).

**Crosscut tranche queue**:
- v2 (find_options tours backend) — ✅ **landed 2026-05-15** (C.focused-shamir-2 supersedes C.bf-6). `tour_card` populated, `queryTourCardsByFilter` live, dispatch swapped. Known limitation: `tour_card.region` is NULL (see [discoveries.md](discoveries.md) 2026-05-15). Also landed in the same wave: blendCards 4-way (C.focused-shamir-3), ORDER BY RANDOM (C.focused-shamir-4), agent-supplied exclude (C.focused-shamir-5).
- v3 (find_options hotels + region_bases backend) — ✅ **landed 2026-05-13** ([planning/03-exec-crosscut-find-options-v3-backfill.md — find_options v3 backfill (hotels + region_bases)](planning/03-exec-crosscut-find-options-v3-backfill.md), decisions C.bf-1..6). `queryHotelCardsByFilter` + `queryRegionBaseCardsByFilter` data primitives wired; handler dispatches on `preferredType`; blended-output path when unset. 26 new tests on `@swoop/connector` (was 126+3 → 149+3 skipped). Live-data smoke pending (Al to run against `puma_dev`).

---

## Earlier status (2026-05-12 — chunk-C implementation fully merged to `main`; C.t1 / C.t3 / C.t3a / C.t4 / C.t5 / C.t6 / C.t8 + B.t3a all closed; **C.t9 (Gemini embeddings @ halfvec(3072), decision C.46) + C.t10 (`--sync` enrich mode, decision C.47) landed afternoon session, pending Al's API-key smokes**; derived tables still 0 rows pending the (now-sync) full enrich run)

**2026-05-12 (today)**: `claude/magical-johnson-3b07a1` (67 commits ahead of `main`, holding the full chunk-C swarm + B.t3a) manually merged to `main` after a week's gap. Branch was at a natural inflection point — `C.t8` commit message reads "closes chunk C". Environment changes: engine pin in `product/package.json` + `product/harness/package.json` loosened from `>=20.0.0 <21.0.0` to `>=20.0.0` (no recorded rationale for the upper cap; CI continues to use `.nvmrc` at 20). **Operational state**: C.t3 domain load live-verified via psql (852 trips, 13,012 images, 906 FAQ, 2,160 customerreviews, 79 tags); 5 derived tables all 0 rows pending the enrich run. Partial `--mode=embed` pass kicked off this session (synchronous Voyage-3, no Batches API, minutes-not-24h). Full `--mode=all` deferred pending a sync-classifier carve-out from HITL Q4 — planning that work via Claude Code in parallel.

**2026-05-12 (afternoon)**: the "Claude Code planning" thread above broadened. Al added a second change to the dev pass — switch Voyage embeddings to Google Gemini. Two paired Tier-3 plans authored and HITL-ratified: [03-exec-c-t9.md](planning/03-exec-c-t9.md) (Gemini swap) + [03-exec-c-t10.md](planning/03-exec-c-t10.md) (sync enrich mode). Both dispatched as parallel background agents from main at `8342ab9`. Each ran ~10 minutes and committed atomic feat/refactor commits per their plan, then exhausted turn budget partway through. Closure (Step 8/9/11 of C.t9; Step 8/9 of C.t10; + `migrate.test.ts` bump; + all docs) landed in the spawning session against the merged branch. **Notable deviation**: C.t9's agent caught a real plan defect — pgvector's HNSW index has a hard 2000-d cap on the `vector` type, so migration 009 ships `halfvec(3072)` instead (pgvector 0.7+, IEEE 754 binary16, halves index memory, negligible recall loss). C.46's wording reflects this. Smokes for both plans (Gemini API + Anthropic-sync end-to-end) are pending Al's credentials. Tests after closure: 790 + 3 skipped across the 6 workspaces on fresh `npm install`.

**2026-05-02**: C.t6 + C.t3a image-annotation fold landed per Al's HITL ratification. One Claude Vision call per image now produces all six outputs (description + annotation + 4 tag arrays); C.t3a's separate Haiku image-annotation classifier retired. Migration 008 adds GIN-indexed tag-array columns; C.t6's prompt bumps to version 2; the C.t3a `image-annotation` classifier and `--source=image-annotation` CLI argument retire. Decision **C.40** logged.


M1 live + chunk D closed + mock-host shipped + **chunk-C implementation spine closed (C.t0/t1/t2/t3/t3a/t4/t5/t6/t8 + C.26 graduated)** + **2026-04-30 review fix-wave fully merged** + **B.t3a closed (orchestrator → real connector)**. **2026-05-02**: C.t3 implemented across 4 atomic commits — `@swoop/ingestion` now hosts a Node CLI (`etl:sql`) that streams the MariaDB SQL dumps into 19 domain tables in `puma_dev` in ~10s. Idempotent re-run produces zero row-count delta. C.t3a (Voyage-3 embeddings + Haiku batch classifiers + composers) and C.t4 (eight intent-named tool handlers over data primitives) and C.t5 (image utility) and C.t6 (Vision annotation) and C.t8 (ops runbooks) all merged the same day. **2026-05-01**: C.t1 + 14 review-fix items + 7 chunk-C plans (all HITL-ratified). See [planning/03-exec-c-t*.md](planning/) for per-task execution logs.

2026-05-01 (earlier) work landed across 14 agent branches + 2 integration fixes: all fourteen pre-chunk-work items closed (R1, R2, R3, R4-handoff, R4-server, Sec-1, Sec-2, Sec-3, Theme-A.1, H3, H4, H5, Perf-1, Perf-3, Test-1) + seven new chunk-C tier-3 plans (C.t1, C.t3, C.t3a, C.t4, C.t5, C.t6, C.t8) authored + HITL-ratified.

**Tests**: 519/519 green across 6 workspaces — `@swoop/common` (102), `@swoop/orchestrator` (158), `@swoop/connector` (84 — was 56; +28 from C.t1 with 3 DB-gated tests skipped without `DATABASE_URL`), `@swoop/ui` (71), `@swoop/harness` (74), `@swoop/ingestion` (31).

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

### 0. Run the C.t3a enrich pass — operational, not code-writing [first thing next session]

The chunk-C implementation spine closed 2026-05-02 and merged to `main` 2026-05-12. All seven Tier 3 plans executed, every per-task execution log captured. What remains is **operational**: run the enrich pipeline against the populated domain tables to fill the 5 job-shaped derived tables.

Chunk-C tasks — historical status:

1. ~~**C.t1** — connector skeleton + Postgres pool wiring~~ ✅ **done 2026-05-01.** Service runs at `:3002`; `getPool` / `withPgClient` / migration runner all available. Execution log in [planning/03-exec-c-t1.md](planning/03-exec-c-t1.md).
2. ~~**C.t3** — SQL-dump → Postgres transform~~ ✅ **done 2026-05-02.** 19 domain tables populated; idempotent. CLI: `npm run -w @swoop/ingestion etl:sql -- --dump <path>`. Decisions C.38 + C.39. Execution log in [planning/03-exec-c-t3.md](planning/03-exec-c-t3.md).
3. ~~**C.t3a** — Voyage-3 embeddings + Haiku ETL classifiers~~ ✅ **code done 2026-05-02; run still pending.** Persona aggregation, blog-post job classifier, blog-tag normalisation all in `product/ingestion/src/enrich/`. CLI: `npm run -w @swoop/ingestion enrich -- --mode={embed|classify|compose|all}`. Execution log in [planning/03-exec-c-t3a.md](planning/03-exec-c-t3a.md).
4. ~~**C.t4** — eight intent-named tool handlers over data primitives~~ ✅ **done 2026-05-02.** Handlers in `product/connector/src/tools/`, data primitives in `product/connector/src/data/` (vector + RRF + hybrid search). No-op `ping` removed; eight tools registered on `createConnectorMcpServer`. Execution log in [planning/03-exec-c-t4.md](planning/03-exec-c-t4.md).
5. ~~**C.t5** — `@swoop/common` image URL utility + page-as-hub resolver~~ ✅ **done 2026-05-02.** Shared in `@swoop/common/image.ts`. Decisions C.41 + C.42.
6. ~~**C.t6** — Claude Vision annotation pipeline~~ ✅ **done 2026-05-02; run still pending.** Folded with C.t3a's image-annotation pass per decision C.40. Code in `product/ingestion/src/images/`. Cost estimate refined down from original £30–£150: ~6.7K images need annotation (vs ~13K total), `image.description` is 47.5% pre-populated upstream.
7. ~~**C.t8** — ETL + annotation runbooks~~ ✅ **done 2026-05-02.** Six runbooks at `product/cms/ops/`: `etl-rerun.md`, `embedding-rerun.md`, `image-annotation-rerun.md`, `migration-management.md`, `prompt-version-rollback.md`, `troubleshooting.md`. Plus index `README.md`.
8. ~~**B.t3a** — orchestrator's connector adapter rewrite~~ ✅ **done 2026-05-02.** Stub at `:3001` retired; orchestrator now talks to real connector at `:3002`; deprecated `Search*` / `GetDetail*` schemas swept. Six atomic commits.
9. ~~**C.t9** — Voyage-3 → Gemini-embedding-001 swap (decision C.46)~~ ✅ **code + closure done 2026-05-12.** Provider swap to `halfvec(3072)` via Google AI Studio API key. Migration 009 drops + re-adds 9 embedding columns; 9 HNSW indexes rebuilt with `halfvec_cosine_ops`. Cost ledger renames `recordVoyage` → `recordEmbedding` (provider-neutral, future-proof). `capToGeminiInput` defensive cap in `chunk.ts` at the 2048-token Gemini input ceiling. `voyage.ts` retired. Real-API smoke pending Al (see §0a below). Plan + execution-deviations log: [planning/03-exec-c-t9.md](planning/03-exec-c-t9.md).
10. ~~**C.t10** — `--sync` enrich mode (decision C.47)~~ ✅ **code + closure done 2026-05-12.** `SyncMessageClient` implements existing `BatchClient` interface via `messages.create` with bounded concurrency (default 5); `BatchClient` gains `isBatched: boolean` so cost ledger keys discount logic off the client. Production continues to default to batches; `--sync` is dev-only opt-in. Mutually exclusive with `--dry-run`. Real-API smoke pending Al. Plan + execution log: [planning/03-exec-c-t10.md](planning/03-exec-c-t10.md).

**The actual outstanding operational work (post-C.t9 + C.t10 closure):**

- **Al needs to set up GCP for Gemini access** (~10 min): enable the **Generative Language API** on the dev project, confirm billing is attached, generate an AI Studio API key (https://aistudio.google.com → "Get API key"), drop it into `product/connector/.env` as `GEMINI_API_KEY=...`. The sanity-check curl is in conversation history.
- **C.t9 real-API smoke** (`enrich --mode=embed --source=tag --limit=10`): verifies the Gemini embedding pipeline end-to-end against the real API. Expected: 10 `tag.embedding` rows populated with 3072-element halfvec vectors. Verify with `psql -d puma_dev -c "SELECT id, vector_dims(embedding::vector) FROM tag WHERE embedding IS NOT NULL LIMIT 5;"` (cast to `vector` for the dim function; expect `3072`).
- **C.t10 real-API smoke** (`enrich --mode=classify --source=blog-post-job --sync --limit=5`): verifies sync classifier path end-to-end. Expected: 5 `blog_post.primary_job` rows populated in <30s wall-clock. Needs `ANTHROPIC_API_KEY` in env.
- **Full enrich (`--mode=all --sync`)** — once both smokes pass, this fills all 5 derived tables (`inspire_passage`, `customer_story`, `trust_proof`, `inform_chunk`, `trip_card`) in minutes, end-to-end. Cost estimate ~£5–10 once-off at full Gemini + full-rate Haiku pricing. From this point M1 has real retrieval data behind the tool surface for the first time.
- **Partial Voyage embed run** that fired earlier this morning is now superseded — migration 009 dropped + re-added the embedding columns at the new dimension, so any 1024d data is gone. Single complete Gemini-3072d pass replaces it.

**Parallel-shells full-sync workflow**: `annotate-images --mode=live --max-budget=N` is the existing sync image annotation path (built by C.t6 / decision C.40 fold). Operators doing a full sync run invoke both CLIs in parallel shells: `enrich --mode=all --sync` and `annotate-images --mode=live --max-budget=15`. *Correction 2026-05-12 post-closure*: the c-t10 ratification originally framed this as a deferred sibling task — Al pointed out the live mode already exists; no sibling task to author.

**Downstream of chunk-C closure (now actionable):**

- **D.t9** — chat-surface widget rewrite for the five intent-named tool outputs from `*PublicSchema` shapes. B.t3a deleted the orphaned `search-results.tsx` + `item-detail.tsx`; `inspiration` and `lead-capture` survive from D.t3 (render `illustrate` and `handoff`). `AttributeTable` primitive in `product/ui/src/shared/` is consumer-less and likely needed for trip-card-style widgets. ~1–2 days. Not yet authored as a Tier 3 plan.

**Cross-cuts**: H1 (`messageOf` helper) and H2 (`emitErrorRaised` helper) from the 2026-04-30 review — status to confirm against the chunk-C swarm's actual deliveries. If not picked up, they remain in the deferred queue.

**Method discipline**: theme 11 (top-down from sales, not bottom-up from data) is now load-bearing in three places. Future agents picking up D.t9 or any chunk-G work hit the calibration layer before they touch a Zod schema or React component. The chunk-C plan's anchor section in [02-impl-retrieval-and-data.md](planning/02-impl-retrieval-and-data.md) is the canonical calibration text.

### 1. Discovery design HITL [active thread; partly absorbed by C.t2 closure]

[planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md) had merged C.t2 with G.t0 / G.t1 / G.t3 because those design questions were tangled. **C.t2's contract is now settled** outside the HITL doc — eight intent-named tools, five job-shaped derived tables, persona_summary natural-language shape, all in code at `product/ts-common/src/tools.ts` + `derived.ts` + production tool descriptions at `product/cms/prompts/tools/<tool>/description.md`. The HITL doc retains a 2026-04-29 supersession banner pointing readers at the new architecture. Remaining HITL outputs are now content-shaped, not contract-shaped:

- **G.t0** — Patagonia conversational-architecture spec (triage inflections, user-type differentiation, motivation anchoring, handoff triggers). HITL session with Al. Output: `planning/patagonia-conversational-architecture.md`.
- **G.t1** — first-pass WHY system prompt at `cms/prompts/system/00_why.md` (replacing the placeholder). Sibling style-avoid file already exists at `cms/prompts/system/10_style-avoid.md`.
- **G.t3** — ≥2 seed skill directories under `cms/prompts/skills/<skill-name>/SKILL.md` (ADK 1.0 directory format).
- **G.t5** — refinement pass when Luke + Lane's sales-thinking doc lands (~May 4).
- ~~**E.t1 schema extension**: add `inconclusive` 4th verdict + per-verdict reason enum~~ ✅ **fully closed 2026-05-13** by VERDICT-E.t1 ([planning/03-exec-e-t1-wire-tightening.md](planning/03-exec-e-t1-wire-tightening.md), decisions E.verdict-1..5). The 4th verdict + per-verdict enum on the durable record were closed earlier by inline patches; the upstream agent + wire schemas (`HandoffInputSchema` + `HandoffSubmitRequestSchema`) are now also discriminated unions. Tool description.md lists all 21 valid `(verdict, reasonCode)` combinations.

### 2. Chunk C — Retrieval & data implementation [✅ implementation spine closed 2026-05-02; merged to main 2026-05-12]

All chunk-C tasks landed in code. **Operational state**: domain tables populated (live-verified 2026-05-12 via psql); 5 derived tables empty pending the enrich run. Per-task execution logs in [planning/03-exec-c-t*.md](planning/).

- **C.t0** ✅ done 2026-04-29 — local MariaDB inspection + 9 first-pass-overturning findings + ontology rewrite + 8 questions closed + 3 new questions raised.
- **C.t2** ✅ done 2026-04-30 — entity model + tool I/O schemas + migrations 001–006 + production-quality tool descriptions + fixtures. C.26 graduated alongside; `find_someone_who` live.
- **C.t1** ✅ done 2026-05-01 — connector skeleton + Postgres pool + MCP-HTTP transport + health endpoints + migration runner.
- **C.t3** ✅ done 2026-05-02 — SQL-dump → Postgres transform end-to-end; 19 domain tables populated; idempotent. Decisions C.38 + C.39.
- **C.t3a** ✅ done 2026-05-02 (code); ⏳ **enrich run still pending operationally**. Voyage-3 embeddings + Haiku batch classifiers + composers all in `product/ingestion/src/enrich/`. Persona aggregation by reviewer name implemented per Phase 1's load-bearing finding.
- **C.t4** ✅ done 2026-05-02 — eight intent-named tool handlers + data primitives (vector + RRF + hybrid search). No-op `ping` removed.
- **C.t5** ✅ done 2026-05-02 — `@swoop/common/image.ts` shared utility. Decisions C.41 + C.42.
- **C.t6** ✅ live-mode done 2026-05-02; ✅ **`--mode=batches` submission wiring closed 2026-05-13** by BATCH-C.t6 ([planning/03-exec-c-t6-batches-submission.md](planning/03-exec-c-t6-batches-submission.md), decisions C.batch-1..4). `runBatches` end-to-ends: build → submit → wait → fetchResults → per-result parse + write-back. Operator runbook ([product/cms/ops/image-annotation-rerun.md](product/cms/ops/image-annotation-rerun.md)) now recommends `--mode=batches` for full re-runs (~$17/£14 batches vs ~$34/£27 live). [gotchas.md — `annotate-images --mode=batches`](gotchas.md) entry rewritten as closed-historical. **Live run not required** — per Al's instruction, live runs already done; the script just needs to exist for later.
- **C.t8** ✅ done 2026-05-02 — six ops runbooks at `product/cms/ops/`.
- **Blog ingest** ✅ implemented in `@swoop/ingestion`; per-post-classification slated for the C.t3a enrich run.
- **Downstream augments**: B.t3a ✅ done 2026-05-02 (orchestrator → real connector). D.t9 (chat-surface widget rewrite) now actionable.

**Carve-out being scoped via Claude Code 2026-05-12**: a synchronous classifier escape hatch (`SyncMessageClient` implementing the existing `BatchClient` interface, plus `--no-batch` CLI flag). Deliberate carve-out from HITL Q4. Production continues to use Batches API for the 50% cost discount; sync path is dev-only.

### 3. Chunk G — Content (bulk) [~3–4 days incl. HITL session]

- **G.t0** — HITL conversational flow mapping with Al (Patagonia triage inflections, user-type differentiation, motivation anchoring, handoff triggers). Output: `planning/patagonia-conversational-architecture.md`.
- **G.t1** — WHY system prompt first pass at `cms/prompts/system/00_why.md` (replacing the placeholder). Sibling style-avoid file already exists at `cms/prompts/system/10_style-avoid.md` — Al's editorial pass partial, ongoing.
- **G.t3** — ≥2 seed skill directories under `cms/prompts/skills/<skill-name>/SKILL.md` (ADK 1.0 directory format).
- **G.t5** — Refinement pass when Luke + Lane's sales-thinking doc lands (~May 4).

### 4. Remaining chunk E — handoff-and-compliance follow-ups [~1–2 days]

E.t1 / E.t2 (interim) / E.t3 / E.t4 shipped. Still open:
- **E.t5** — Real legal copy authoring at `product/cms/legal/*` (disclosure-opening, chrome-badge, consent-handoff, privacy-info, etc.). Today's strings are placeholders inline in the components. **Hold until Q1/Q2/Q3 voice anchors land** — drafts now would be rewritten.
- **E.t6** — ✅ interim sweeper landed 2026-05-12; Cloud Run Job follows with E.t2 proper. `HandoffStore.sweep` lives at the interface (not inside `FsHandoffStore`) — same signature survives the Postgres swap. In-process `setInterval` inside the orchestrator handles the FS interim; the CLI binary (`npm run sweep:handoffs --workspace @swoop/connector`) is the prod external-trigger path Cloud Scheduler → Cloud Run Job will invoke. Plan + execution log: [planning/03-exec-handoff-t6.md](planning/03-exec-handoff-t6.md). Operator runbook: [product/cms/ops/handoff-retention-sweep.md](product/cms/ops/handoff-retention-sweep.md). Counsel-review note in compliance bundle §05.
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
