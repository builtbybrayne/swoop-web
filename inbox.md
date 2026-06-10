# Inbox

Append-only capture for ad-hoc ideas, questions, and nudges that don't have a long-term home yet. Triage periodically into: planning docs (`planning/`), commercials (archive), or deletion.

**Entry format**: `## YYYY-MM-DD — short title` then body. One- or two-line entries are fine.

---

## 2026-06-10 — Luke feedback round 2: commercial-fence items (for commercials triage)

The 10 Jun Loom triage ([ledger](planning/reviews/2026-06-10-luke-loom-feedback.md)) surfaced three items that sit outside the 30 Mar quote fence: (1) **Product Library ingestion** (pricing accuracy; exploration + ingest — questions.md ask raised); (2) **trip-card relevance deep work** (agentic data pipelines + richer search — Al's stance: a data-engineer engagement, recommendation available, not a cost-effective blocker to production trial); (3) **durable Postgres session backend** (B.t13 stub in the [demo-stability plan](planning/03-exec-crosscut-magical-poincare-demo-stability.md) — smallest of the three, arguably platform hygiene). Worth deciding which get quoted as a follow-on line item vs absorbed. The build already materially exceeds the quoted 16 days (per the [2026-05-27 state-of-play](planning/reviews/2026-05-27-ingest-and-state-of-play.md) §5.1) — this feedback round is a natural moment for that commercial conversation with Luke.

## 2026-05-21 — M4 milestone wording still assumes Cloud Run + Cloud SQL; needs rewrite

[planning/01-top-level.md §4 Milestones](planning/01-top-level.md) M4 reads "*Deployed to Swoop GCP ("AI Pat Chat"). Cloud Run services live; session state persisted; Cloud SQL Postgres (with `pgvector` + `tsvector` + `pg_trgm`) populated; logging.*" That language predates the 2026-05-21 deployment-shape deferral that just landed in §9 ("Deferred at top level — deployment shape") and in [planning/02-impl-retrieval-and-data.md §1](planning/02-impl-retrieval-and-data.md) outcomes. M4 should be rewritten to describe the outcome (Puma stack reachable in Swoop's GCP project, durable state persisted, logging on) without prescribing Cloud Run + Cloud SQL as the shape — single-VM-all-on-one is now the leading candidate and only loses to Cloud SQL if scale demands it. Bigger than a 1-line edit because M4 is referenced from chunk B + chunk E plans + next-steps.md §8; sweep needs to be coherent.

Lands in: a small planning-doc sweep, probably alongside whatever Tier 2 chunk B work next touches the session-backend story. ~30 min when scheduled.

## 2026-05-18 — Multi-facet image embeddings (the v2 illustrate shape)

Future shape for `illustrate`. Today: one `image.embedding` per row, derived from the `annotation` prose. Tomorrow (when retrieval quality from the single-embedding cosine ANN proves insufficient): **one image → multiple embeddings, one per facet**, each indexed independently.

Candidate facet decomposition (mirrors the tag-bucket intuition that the 2026-05-18 tag-gate removal closed for now):
- **Content embedding** — what's literally in the picture (the current `annotation`, possibly tightened to just-the-subjects).
- **Mood embedding** — aesthetic register, embedded from a mood-focused prose pass.
- **Region embedding** — geographic anchor, possibly tied through to `ntag` slugs so a visitor utterance can fuzzy-match the canonical region taxonomy.
- **Activity embedding** — what's *happening* in the image (hiking / kayaking / dining / wildlife-watching).

Tool surface evolution: `IllustrateInput` becomes axis-aware — `{ contentIntent?: string, moodIntent?: string, regionIntent?: string, activityIntent?: string, count? }`. Each field is natural-language (the agent never sees a vocabulary); each routes to its own facet ANN; results combine (RRF or simple union with per-axis diversity).

Why parked: requires re-running image annotation (cost: ~$26 batches for the full corpus per BATCH-C.t6 estimates, or splitting into 4 model passes — could be done in one call returning a structured 4-facet output). The 2026-05-18 single-embedding fix is shipping first to characterise how good the existing substrate gets without rework. If quality turns out fine for the journey moments the agent actually reaches `illustrate` for, this stays parked; if many calls still return 0 or visually-off results, this becomes urgent.

Lands in: a future Tier-3 chunk-C task (call it `C.illustrate-v2` or similar). Touches `product/ingestion/src/images/` (prompt + schema + write-back), `product/connector/src/data/find-images-by-keywords.ts` (axis dispatch), `@swoop/common` (new `IllustrateInputSchema` shape), `product/cms/prompts/tools/illustrate/description.md` (agent-facing instruction on the axes), the image table (4 embedding columns + 4 HNSW indexes — possibly a separate `image_facet_embedding` table to keep the main row narrow).

Reference: [planning/03-exec-c-t4.md — 2026-05-18 illustrate tag-gate removal addendum](planning/03-exec-c-t4.md) for the diagnosis that landed us here; [discoveries.md 2026-05-18 — illustrate tag-gate librarian-shaped on prose substrate](discoveries.md) for the substrate framing.

## 2026-05-18 — Validator scenario assertion-authoring quality pass needed

Several of the 37 H.t8 userAgent scenarios have mis-authored assertions. Concrete case from the 2026-05-18 sample run against `skeptic-ai-suspicious`: the scenario asserts `tool_call: find_someone_who` but the scenario shape is about a Skeptic wanting handoff, not someone seeking Mirror stories — `find_someone_who` is the wrong tool to expect. The persona-author sub-agents weren't deeply familiar with the eight-tool intent surface. A quick cleanup pass across all 37 `agent-*.yaml` files would remove false-failure noise. Triage: scan each scenario's `tool_call` and `handoff_event` assertions against the scenario's actual conversational goal; remove or correct any that don't fit. ~30-60 min.

## 2026-05-18 — Real WHY-prompt bugs surfaced by the skeptic-ai-suspicious transcript

Two distinct quality problems caught in the post-skill-integration sample transcript at `runs/sample-1-skeptic/views/skeptic-ai-suspicious.html`:

1. **Hallucinated phone numbers, and different ones across turns**. Turn 1: `+44 (0) 117 369 0196`. Turn 3: `+44 (0)117 325 7898`. Two different made-up UK numbers within one conversation. The chunk-G WHY prompt says the agent doesn't commit specifics but doesn't explicitly forbid hallucinating contact details. Add a `MUST NOT invent specific contact details (phone, email, address)` line to `cms/prompts/system/00_why.md`; specialist routing belongs to the `handoff` tool, not free-text invention.

2. **Self-contradiction on Patagonia seasonality within one conversation**. Turn 2 says August is "right in the heart of the season ... most stable weather". Turn 3 says (correctly) August is winter, cold, windy, snowy. Add a geographical-anchor line: *"You are talking about destinations in the Southern Hemisphere. Patagonian seasons are inverted relative to UK/Europe/North America — December–February is summer; June–August is winter."*

Both are 1-line WHY-prompt edits + a validator re-run to confirm. ~15 min.

## 2026-05-18 — Event-capture wiring (H.14) needed to make triage_verdict assertions useful

Every H.t8 scenario with a `triage_verdict` assertion currently FALSE-FAILS because the harness defaults to `NullEventCapture` (per H.14 — deferred orchestrator-stdout-capture wiring). The runner can never see `triage.decided` events; `finalTriage` is always null; the assertion always fails with *"no final triage state captured"*. This adds significant noise to every validator run. Pick up [H.14 — StreamingEventCapture against orchestrator stdout](planning/03-exec-validation-scaffold.md) and wire it into the CLI: spawn the orchestrator as a child process from the harness, attach a `StreamingEventCapture` to its stdout, pass through to `runScenario.deps.events`. Until this lands, suppress `triage_verdict` assertions in scenario authoring, or treat their failures as known-noise rather than real signal. Estimate: 2-3 hrs including the orchestrator-spawn lifecycle handling.

## 2026-05-18 — B.t9 plan artefact still overstates the ADK API discrepancy

[planning/03-exec-agent-runtime-t9.md](planning/03-exec-agent-runtime-t9.md)'s "★ Read this first" section says ADK's `loadAllSkillsInDir` doesn't exist and the CMS docs were stale. That was wrong — the function DOES exist; the executing agent confirmed empirically and the discoveries.md entry corrects it. The plan file itself is the only place still carrying the overstatement. Quick edit pass to mark that section as superseded / inline-correct it. ~10 min. Doesn't change anything that runs, just keeps the plan artefact honest for future readers.

## 2026-05-18 — Streaming + viewer post-demo cleanups

Small follow-ups from the streaming-fix + transcript-view work:
- Add a `cms/README.md` authoring rule: "If a `description:` in a SKILL.md contains a colon-space, em-dash + colon, or any js-yaml-structural character, single-quote the value." Surfaced when two of the 14 skills silently dropped on first boot.
- Add `gotchas.md` entry: `connector` reads `CONNECTOR_PORT` env var, NOT `PORT` (caused silent port collision in the validator-harness worktree boot when `PORT=3003` was set without `CONNECTOR_PORT=3003`).
- Restore the `triage_verdict: inconclusive` assertions in cluster-5 `agent-500-uncommunicative-monosyllabic.yaml` + `agent-520-unclear-confused.yaml` — they were removed mid-swarm as a workaround when VerdictSchema didn't accept `inconclusive`; schema is now widened (commit `82e2e37`); assertions can be restored.
- Investigate the **duplicated-opener bug** flagged in the pre-skill smoke 1 (dreamer-pure-curiosity turn 1 emitted two near-identical opening paragraphs in a single response). Real artefact; may be a streaming-layer issue, a tool-call interleaving issue, or a real agent regression. Not seen in the post-skill skeptic sample but worth a focused look — capture transcripts with the new HTML viewer, check whether the duplication is in the SSE frames themselves or just the rendered text.

---

## 2026-05-18 — Analytics on now-hidden widget-malformed failures

Nice-knuth wave dev/prod-gated `WidgetMalformedPlaceholder` so production renders nothing instead of the amber "Couldn't load that" card. Schema-parse failures now fire a structured `console.warn` from `safeParse` (toolName + widgetType + Zod issues — captured by Cloud Run stdout) and a `ui.widget_rendered` event whose `widgetType` field carries a `:malformed:schema` or `:malformed:lifecycle` suffix (e.g. `find-options:malformed:schema`). That's the only post-launch signal — no dashboard, no aggregation, no alert.

What we want before launch (or shortly after — depends on chunk F appetite):
- **Counts** of malformed renders broken down by `(widgetType, toolName, failure-kind)`, bucketed by day/hour. Daily-trended in whatever F lands as the analytics surface (Julie/Thomas analytics-platform question still open).
- **Alert / threshold** so a deploy that breaks a schema doesn't go unnoticed. Rough heuristic: malformed-render-rate > 0.5% of widget renders for a given toolName.
- **Rolling debug-capture** — small ring buffer of recent failures (raw candidate truncated + PII-screened, Zod issues, request id) so post-incident diagnosis doesn't need a repro.

Implementation notes:
- The suffix-on-existing-eventType pattern (`<widget>:malformed:<kind>`) was deliberate — sidesteps the `@swoop/common/events.ts` schema change while parallel worktrees are evolving wire shape. Once those settle, a discrete `ui.widget_malformed` event kind would be cleaner downstream and probably worth promoting.
- The `safeParse` call site already has the full debug payload (`{ widgetType, toolName, issues, rawCandidate }`) — extending the emit to carry it is a small additive change once the event kind is settled.

Why it matters: prod gate is silent-by-design (right UX call — agent prose covers for the visitor), but silent also means schema drift is invisible until a user complains. Cloud Run stdout has the warns but nobody watches it day-to-day.

Lands in: chunk F (observability) when its event schema work touches `@swoop/common/events.ts`. Low urgency until post-M1 real traffic; high value once we're shipping changes against live data.

## 2026-05-14 — Handoff form: free-text "Anything else?" textarea

Add a free-text textarea to the handoff form, prompted along the lines of *"Anything else you'd like the specialist to know?"* Content captured in the visitor's own words. Surfaces to the specialist alongside the agent's structured summary (in the handoff email and payload).

Came out of HITL G.t1 session — Al wanted the unstructured visitor-voice content to come from a form field, not from the agent eliciting it. The core agent guidance (`00_why.md`) was deliberately *left clean* of any mention of this — it's a UI / payload concern, not an agent-behaviour concern. The agent doesn't need to know the box exists.

Likely touches:
- UI: handoff form (chunk D widget) — new textarea, optional, character cap TBD.
- Schema: `HandoffSubmitRequest` / `HandoffInput` in `@swoop/common` — new optional `visitorNote` (or similar) field across all 21 (verdict, reasonCode) combinations.
- Payload assembly: `@swoop/connector` `handoff_submit` path — propagate the field through.
- Email template: `cms/templates/handoff/qualified.md` (and the referred-out variant) — render the visitor's note prominently, distinct from the agent's summary so the specialist can tell them apart.
- Evalset: handoff fixtures probably want a `visitorNote` populated case to lock the render.

Needs a Tier 3 plan before Claude Code execution — schema impact + multi-workspace propagation means it isn't a single-Edit job. Plausibly the next E-chunk task to scope; could fold in to a future handoff polish wave or stand alone.

## 2026-05-13 — `@swoop/ui` typecheck broken across all D.t9 widgets (NOT from parallel agent) — revisit

When BF-FO-v3 ran `npm run typecheck --workspaces --if-present`, `@swoop/ui` errored. **Al's 2026-05-13 correction**: not from the parallel agent. Confirmed pre-existing on main HEAD (`git stash` + re-typecheck on `39652aa` and `a29001c`: same errors).

**Scope (24 errors total)**:
- `lead-capture.tsx`: 12 × `'args' is of type 'unknown'` + 2 × `'resultParsed.data' is of type 'unknown'`.
- `find-inspiring.tsx` / `find-options.tsx` / `find-proof.tsx` / `find-someone-who.tsx`: each errors with `Property '<key>' does not exist on type 'unknown'` + `Parameter 'X' implicitly has an 'any' type`.
- `lookup.tsx`: `Property 'chunks' does not exist on type 'unknown'`.
- `widget-shell.tsx`: `Cannot find name 'ZodType'`.

Same root cause across all of them — assistant-ui's tool-result / tool-args generic widened to `unknown` somewhere (likely a library version bump that lost the narrowing). The widgets all consume `props.result` / `props.args` and project against a Zod schema; the widget-shell's `safeParse` lost its `ZodType` import.

**Fix shape**: probably 30–60 min sweep — re-import `ZodType` in `widget-shell.tsx`, then add the same `safeParse(Schema, props.args/result)` narrowing pattern across the affected widgets. Tests still pass because they don't hit `tsc --noEmit` the same way.

**Status**: not a regression from BF-FO-v3 or VERDICT-E.t1; ALL 24 errors are pre-existing. May resolve incidentally if the parallel UI agent's work touches these files. Otherwise needs a discrete cleanup task.

## 2026-04-29 — Blog ETL `data/` lands in worktree, not main repo

The `resolveDataRoot()` walk in `product/ingestion/src/blog/fetch.ts` walks parents looking for the first `.git` directory or `.gitignore` file. In a git worktree, `.git` is a *file* (not a directory) at the worktree root, and a `.gitignore` lives there too — so the walk stops at the worktree, not the main repo. Net: every `npm run blog:fetch:backfill` from a worktree creates `data/blog/raw/<stamp>/` *inside that worktree*, gitignored locally and invisible to other worktrees / the main repo. That's why the snapshots from agent worktrees `agent-a84896f740d205018` and `agent-a0b7dfee4cfcd79d3` weren't findable today — they were stranded in their respective worktree dirs.

Workaround used today: copied the freshest snapshot (`20260428T231414Z`, 102 posts, 6.3 MB, zero errors) into `/Users/al/Studio/projects/swoop_web/data/blog/raw/` and symlinked back into this worktree.

Fix candidates for the resolver:
1. **Walk past `.git` files** — when `.git` is a file (worktree marker), read it to find the canonical repo root (`gitdir: ../../../../.git/worktrees/<name>` → climb to the parent of `.git/`) and land `data/` there.
2. **Hard-pin to a known-good marker** — search for `.gitignore` containing the line `/data/` and only stop at that one. (Brittle; not great.)
3. **Env var override** — `SWOOP_DATA_ROOT=/Users/al/Studio/projects/swoop_web/data npm run blog:fetch:backfill`. Trivial; works around the bug, doesn't fix it.

Smallest sufficient fix is (1). ~30 minutes including a vitest case for the worktree scenario. Worth doing before the next backfill run from a worktree.

---

## 2026-04-30 — Blog + corpus content analysis MUST precede chunk C tool design

Al's signal: the chunk C tool surface (5 PoC pass-through + 3-5 sales-shaped) and the proposed sales-tag taxonomy (`evocative` / `customer-story` / `trust-proof` / `comparison-helpful` / `practical-info`) are still speculation — we haven't actually looked at what the corpus contains. Before designing further, inspect:

1. **Blog content** (already on disk): `data/blog/raw/<latest>/posts.ndjson`, 102 posts in the 5y window. Sample 20–50 random posts. What kinds of content actually exist? Travel diaries from past customers? Region overviews? Trip recaps? Practical guides? Author profiles? Are there genuine customer-story narratives we can feed into a `recall_someone_who` shape, or is most of it Swoop-staff-authored marketing?
2. **`trip.description` prose** (in MariaDB): what's the typical length, tone, content shape? Evocative or factual? Day-by-day breakdowns or holistic pitches?
3. **`contentblock_*` subtypes** (in MariaDB): which subtypes carry useful prose? Agent C identified `customertip` (119) and `customerreview` (2,390 — but source tables missing). What about the other 12 subtypes? Are any of them agent-feedable?
4. **Image annotations** (existing 47.5% via `image.description`): random sample. What's the quality? Are descriptions detailed enough to power a `mood`-filtered `illustrate` query, or do they read as alt-text-grade short labels?

Outputs: a "blog content shape" + "trip prose shape" + "contentblock triage" addendum, probably under `data-ontology.md` or a new short doc, plus refined sales-tag taxonomy that's grounded in observed content rather than assumed content.

Why it matters: today's chunk C plan defines tool surface + tag taxonomy as if we know what `customer-story` content looks like. We don't. If 100% of the blog is Swoop-staff-authored, `recall_someone_who` collapses or has to repurpose review excerpts. If 30% is travel diaries, it has a real corpus. We can't know which without looking.

Next session: prioritise this inspection pass before any further tool-design work. The chunk C plan ([02-impl-retrieval-and-data.md](planning/02-impl-retrieval-and-data.md)) waits on the inspection output.

---

## 2026-04-29 — W1 (server-side session history projection) unparked

Original side-quest plan at [planning/01-side-quest-persistence.md](planning/01-side-quest-persistence.md) parked W1 + W2 + W4 pending observation from the mock-host harness. Observation outcome (Al, 2026-04-29): **assistant-ui doesn't auto-rehydrate** — the chat UI loses thread state on iframe remount, confirming the original concern. W1 + W2 are now active; W4 still settled at sessionStorage.

The previous W1 attempt landed and was reverted as part of the worktree-base mess. **Original commit worth reviewing for shape: `6d311240aa3b99e0c53eabccac1dfbfef83682a5`.** Per Al, that implementation was nearly OK from an assistant-ui perspective but predated the C.18 / B.22 / E.10 / C.23 Postgres lock-in — so the orchestrator-side reading of session history needs to factor in the eventual Postgres `SessionService` (B.22) rather than the in-memory ADK-native shape it was built against.

Action for next session: (a) flip W1 + W2 in `01-side-quest-persistence.md` from "parked" to "active"; (b) author Tier 3 plans for `B.t11` (orchestrator history endpoint) + a UI-side rehydration task (W2); (c) review commit `6d31124` and salvage what carries; (d) add a `discoveries.md` entry: "assistant-ui doesn't auto-rehydrate — server history projection + client mount-time replay required".

---

## 2026-04-29 — Method note: tools / system prompts / guidance must be designed as one coherent ensemble, not bottom-up from data

Captured from Al, 2026-04-29 (after I'd been reaching for a tool-by-tool walk grounded in the dump's data shape). The corrective: **don't pick off the discovery design tasks one by one starting from the data**. Tools, system prompts, and modular guidance are interlocking — the agent is a working ensemble, and that ensemble has to make sense as a whole before the individual pieces can land coherently. Bottom-up-from-data risks producing five well-shaped tools whose surface contradicts the WHY prompt's voice, or skills that load at the wrong inflection because the tool boundaries weren't drawn around real conversational moments.

Practical implication for the Q1 / Q2 / Q3 thread in [planning/00-discovery-design-thinking.md](planning/00-discovery-design-thinking.md): when we resume, **start from the conversational arcs** (a typical visitor journey, the §3.2 path sketches, the customer-type segmentation, the motivation anchors) and ask "what does the agent need at each beat — guidance? a tool? a piece of WHY context?". Tool I/O shapes follow; Postgres entity model emerges last. NOT: "what fields hydrate `stoke_imagination`'s output? OK, so the entity model is X, so the tool surface is Y, so the WHY prompt should reference Z."

This is method, not just preference. Future sessions: read this entry before reaching for the data layer.

---

## 2026-04-28 — Tier 2 plan refresh + Firestore cleanup follow-up

Major Tier 2 plan refresh landed today: chunk C rewritten around Postgres + sales-shaped tools woven with existing PoC tools (C.19); B's session strategy clarified (B.22: ADK in-built → custom Postgres post-M4); E's handoff store flipped to Cloud SQL Postgres (E.10); Firestore dropped project-wide (C.23). 12 new decisions landed in [decisions.md](planning/decisions.md). All sub-decisions (C.13–C.17 sales-funnel + data rulings) also formalised.

**Code follow-up tracked but deferred** (per C.23): Firestore name-references remain in three shipped/Tier-3 places that get cleaned up alongside the post-M4 session-backend implementation, not now:

1. `planning/03-exec-agent-runtime-t2.md` — references `session/firestore.ts` and the `SESSION_BACKEND="firestore"` enum. Action: rename the file → `postgres.ts`, update enum value → `"postgres"`. Code is in `product/orchestrator/src/session/`.
2. `planning/03-exec-agent-runtime-t6.md` — documents the same enum. Update to match.
3. `planning/03-exec-observability-b.md` line 279 — describes a future contract for `createHandoffSubmitHandler` writing to Firestore. Update to "writes to Postgres `handoff` table" when chunk E.t2 lands.
4. `planning/01-side-quest-persistence.md` lines 77, 80 — references "the eventual Firestore migration" in a partially-superseded doc. Action: archive review when the persistence side-quest is next touched.

These are mechanical edits (~30 minutes total) that pair naturally with the post-M4 backend implementation work, rather than disrupting shipped Tier 3 plans now.

**Other deferred follow-ups from today's plan refresh** (none blocking):

- The `02-impl-retrieval-and-data-source-exploration.md` first-pass exploration doc has a superseded banner; eventual archival is fine when convenient.
- The C.13–C.17 decisions are now in `decisions.md`; the inbox 2026-04-27 "plans-to-update" list referencing them as "pending" can be considered closed once Al confirms.

---

## 2026-04-27 — Blog content ingest plan added

Forgotten earlier; surfaced today. Swoop blog (WordPress, `/blog/wp-json/wp/v2/posts`) has 465 posts spanning 2010-10 → 2026-03 — 15+ years available, not just 5. Sized at ~10–25 MB total; backfill is trivial. Plan landed at [planning/03-exec-blog-ingest.md](planning/03-exec-blog-ingest.md). Storage at `data/blog/raw/<utc-stamp>/{manifest.json, posts.ndjson, log.txt}`; state derived from latest manifest, no separate state file. Out of scope for this task: HTML cleaning, chunking, embedding, derived-store insert, image mirroring — all gated on inspecting the actual dump first.

Resolved 2026-04-27: 5-year rolling window, **filtered at fetch** via WP REST `?after=<5y-ago>`. Pre-window content is genuinely stale (defunct hotels, changed routes, dated voice) and not retrieved at all. ~108 posts in the current window; backfill <2 MB.

---

## 2026-04-27 — Swoop-side answers from Julie call (data + product stance)

Big batch of answers from the Julie call (post-SQL-dump). Multiple docs need updates as a result; identified at the bottom of this entry. Not actioned beyond inbox capture.

**Data-shape rulings:**
- `tag` table is **dead — ignore entirely**. `ntag` (79 entries + `ntags_lookup` 157,537) is the live tags system. Inverts what we'd assumed; rewrites the tag-taxonomy section of `data-ontology.md`.
- `adventurousness` table is **deprecated/ancient — ignore entirely**. Difficulty (1–5) and wilderness (0–5) are raw integers; we don't have a user-facing legend in this DB. Closes Q7 differently than expected.
- **`swooper`* fields = Swoop's customers**, not staff. Sensitive customer data. We don't get any of them. Confirms Q11 close, with a sharper PII boundary than I had: it's not "specialists live in CRM"; it's "these are customer PII fields, off-limits". Update PII section accordingly.
- **No departures.** Departures change daily and the risk of the bot misrepresenting them is too high. We don't get them at all. Use `trip.base_price` as the baseline only. Closes Q10 fully.
- **No calculated price ranges.** Use the headline `base_price` from `trip` as-is. No tier×season grids, no regional bands computed at export. This is simpler than what I'd proposed and tighter on misrepresentation risk. Reverses my earlier "compute ranges" plan from before the call.
- **Ignore `raw_price`.** Website-runtime calculation, complex. Use `base_price` only. Closes Q8.
- **Ignore `window_price`.** Also a website-runtime calculation. Closes Q9.
- **Dump is canonical, period.** It's the upstream source of truth; even derived parts can be treated canonically. Closes Q16.

**Architecture-shape rulings:**
- **Postgres is fine with Swoop.** My earlier optical concern was unfounded — they're happy. Keeps the door open between Postgres+pgvector and DuckDB. Note: Al's other concern (vector-RAG-only retrieval is fragile) is unaffected — agent-with-structured-tools is still the right retrieval pattern; it just doesn't dictate the backing store any more. Decision pending; both options now acceptable.

**URL + image construction rules** (need to land somewhere durable in the retrieval-design plan and in `discoveries.md`):
- **Image URLs**: dump stores filenames only. Construct as `https://swoop-patagonia.imgix.net/<filename>?<imgix-query-params>`. Example: `SWO_5_Matt_ALL_Torres-del-Paine-November-2023.jpg` becomes `https://swoop-patagonia.imgix.net/SWO_5_Matt_ALL_Torres-del-Paine-November-2023.jpg?auto=format,enhance,compress&fit=crop&w=500&h=400&q=80`. **Imgix query params control sizing and format** — useful: small thumbs for inline mentions, larger crops for widget hero images, originals for detail views. Worth carrying as a parameterised "render variant" concept on the image record / tool surface.
- **Page URLs**: use `override_url` if present, otherwise fall back to `alias`. Same rule for trip records and page records.
- **Linking records to pages (and to images via pages)**: any record with a `page_id` (e.g. `hotel.page_id`) traverses to its `page` row, which carries `override_url`/`alias` for the link AND the image set for the widget render (because the originating record — e.g. `hotel` — doesn't carry images directly). General principle: **page = presentation hub for any record that points at one**. Apply uniformly across hotel, location, trip, etc., when constructing UI cards.

**Sales-stance reinforcements** (already drafted as the "golden thread" principle; these confirm and harden it):
- No departures surfaced — too volatile.
- No calculated price ranges — only headline `base_price`, exactly as authored.
- No customer-attribution data (the `swooper` fields).

**Plans / docs that need updates as a result** (capture only — don't action yet):

1. **[data-ontology.md](data-ontology.md)** — substantial:
   - Rewrite §15 (tag taxonomy) — `tag` is dead, `ntag`/`ntags_lookup` is the live system. Update enumeration if we can pull the values from the dump.
   - §11 (Swooper) — recast as "PII, off-limits, do not surface" rather than "needs population".
   - §3 (Departure) — recast as "explicitly out of scope by product decision", not "priority gap #1".
   - §Pricing semantics — drop `raw_price`/`window_price`/`cabin_*` analysis; just `base_price`. Add note: no calculated ranges.
   - Add new top-level section: **URL & image construction rules** — imgix prefix, query-param variants, override_url/alias precedence, page_id traversal pattern.
   - Mark `adventurousness` deprecated; difficulty/wilderness are raw integers without a legend.
   - Update §"ask list" priority table — most rows now answered or moot. Demote departures, swoopers, pricing-matrix rows.
   - Add `S-SQLDUMP-2026-04-27` source tag at the top.

2. **[questions.md](questions.md)** — promote multiple to Closed:
   - Q7 (legend) — close as "no legend; adventurousness is deprecated; raw integers only".
   - Q8, Q9, Q10, Q11, Q16 — close fully.
   - Q14 (PII) — extend with swooper-as-customer note; still partly open pending broader Swoop sign-off on derived-store retention.
   - Julie-call section — mark each topic answered with a one-liner.

3. **[planning/02-impl-retrieval-and-data.md](planning/02-impl-retrieval-and-data.md)** — chunk C Tier 2:
   - Pricing strategy section — simpler: surface `trip.base_price` headline; no computation.
   - Departure-handling — explicit "out of scope" with rationale.
   - Tag-taxonomy — switch to `ntag`.
   - New section: **URL & image construction** as a retrieval-design principle.
   - New section: **page-as-hub** pattern for cross-entity widget rendering.
   - Storage decision: re-open between Postgres+pgvector and DuckDB now that the optical objection is gone.

4. **[planning/02-impl-retrieval-and-data-source-exploration.md](planning/02-impl-retrieval-and-data-source-exploration.md)** — first-pass exploration doc:
   - Add a "Post-2026-04-27 dump-load + Julie-call" addendum block summarising what Swoop confirmed/ruled out.
   - Mark §4 questions with the appropriate ✅ closures matching `questions.md`.
   - Note adventurousness as deprecated in §3.

5. **[discoveries.md](discoveries.md)** — durable findings to graduate:
   - Sales-funnel "golden thread, no shadow itinerary" stance (with nuance: engages on specifics, refuses only on shadow-itinerary boundary).
   - URL reconstruction pattern (`override_url || alias`).
   - Imgix construction with parameterised render variants.
   - Page-as-hub pattern for any record with `page_id`.
   - `tag` is dead, `ntag` is live.
   - `adventurousness` is deprecated; difficulty/wilderness are raw integers without legend.
   - Pricing stance: headline `base_price` only, no calculation, no surfacing of `raw_price`/`window_price`.
   - PII boundary clarified: `swooper_*` fields are *customer* PII, not staff.

6. **[CLAUDE.md](CLAUDE.md)** — add the golden-thread principle as a project invariant (with the non-fascist gradient framing from the earlier conversation). Touched only after the principle text is agreed.

7. **[planning/decisions.md](planning/decisions.md)** — new C-series entries to author once we lock direction:
   - C.13 (or next): Sales-funnel golden thread.
   - C.14: No-departures, no-swoopers, no-calculated-pricing stance.
   - C.15: URL + image construction rules.
   - C.16: Page-as-hub pattern.
   - C.17: `ntag` is the live tagging system; `tag`/`adventurousness` are dead.
   - C.18: Storage choice (Postgres+pgvector vs DuckDB) — pending re-decision.
   - C.19: Agent-with-structured-tools as the retrieval pattern (not vector-RAG-everywhere).

---

## 2026-04-24 — Writing-style control for the agent (Al-raised)

Observation during D.t5 live testing: real chat output regressed into classic AI-slop style — em-dash-heavy rhythm, corporate hedges ("it's worth noting"), AI-signature verbs ("delve", "unpack", "dive into"), empty affirmations ("Great question!"), trailing offers ("Let me know if you'd like to explore…"). The "a couple of illustrative paragraphs, not a style guide" stance in chunk G §2.1 is necessary but insufficient — Claude honours positive examples but regresses under load (long conversations, tool orchestration, strong lean on visitor phrasing).

Landed in `planning/02-impl-content.md`: new §2.1a (explicit anti-pattern list) + decision G.10 (two-layer voice: positive examples in `why.md` + explicit avoidance block in `cms/prompts/style-avoid.md`, referenced from WHY prompt). Avoidance list is a living doc — new tells surface in real conversations and get added. F's event log is the long-term source for regression-pattern capture.

Where it lands next: G.t1 execution now has two content deliverables (`why.md` + `style-avoid.md`). Style-avoid.md can start solo from Al's own `alastair-writing-style` skill + observed offenders — doesn't need to wait for G.t0 HITL session to bootstrap.

---

## 2026-04-22 — `<fyi>` as a tool call (post-M1 refactor candidate)

Al's observation: the `<fyi>` side-notification mechanism currently implemented as a state-machine parser (B.t4) + custom `data-fyi` AI SDK part (chunk D) could more cleanly be a **tool call**. The orchestrator would register a thin `fyi` / `announce_status` tool; model emits `tool-call` parts which assistant-ui's tool-call registry renders as ephemeral status affordances via the same `makeAssistantToolUI` path as every other widget.

**Pros**: native across ADK + AI SDK + assistant-ui; no custom parser; no custom part type; models are more reliable at tool-call structured output than at tag-parsed free text.

**Cons**: small semantic stretch — "tools *do* things" — but solvable with a better name (`announce_status`, `signal_progress`).

**Swap cost post-M1**: small. Retire `block-parser.ts` (~200 lines), retire `data-fyi` part type, add a tool + one assistant-ui renderer registration. Parser is test-covered so behaviour check on retirement is cheap.

Where it lands: post-M1 cleanup pass, or whenever we're next doing a round of prompt engineering with real conversation data.

---

## 2026-04-22 — Scraping vs API trade-off: URL generation for in-page deep links

If we scrape the website, we get real page URLs for each product / region / story as a side-benefit. The chat agent could then offer "go see this page" links that drop the visitor directly onto the relevant Swoop page.

Implication: if the visitor clicks through, the chat disappears (new page load). For that to be useful, the chat needs to survive navigation — stateful, picks up where it left off on the next page. Cross-page chat persistence has UX and technical implications (localStorage session id + rehydrate on mount; or iframe host-page coordination; or deferred until the user returns to a "home" surface).

Alternative: if we get data via API (Friday hackathon), we may still be able to reconstruct URLs given known type + id patterns — worth confirming in the hackathon.

Where this lands: Puma's chat-surface implementation plan (Tier 2 chunk D) needs to either commit to cross-page persistence or explicitly defer it. Handle in Tier 2 when chunk D is planned.

---

## 2026-04-24 — Disclosure + consent + assistant-info copy needs a pass

The current opening-screen copy ("Before we start… This is an AI assistant. It helps you explore trip ideas by chatting with you and suggesting options from our library…") is serviceable placeholder but not Patagonia-voiced and not calibrated against what legal actually needs for EU AI Act Art. 50 + GDPR. Same goes for the persistent chrome badge wording, the privacy-info modal, and wherever the agent introduces itself in-conversation.

Where this lands:
- Content pass: chunk G (content) — belongs in the HITL conversational-flow mapping session with Al + Luke + Lane's sales doc (~May 4).
- Legal copy: chunk E (handoff & compliance) — `product/cms/legal/*` authoring + counsel review before M5.
- Files to touch when we do this: `product/cms/legal/` (doesn't exist yet) + the disclosure components in `product/ui/src/disclosure/`.

Noticed while building the mock-host harness and seeing the consent screen through "new eyes" as a visitor.

---

## 2026-04-29 — pgEdge Agentic AI Toolkit for Postgres

Option to evaluate for the Postgres setup: pgEdge's Agentic AI Toolkit. Might be relevant to the agent-with-structured-tools retrieval pattern (C.19) and/or the Cloud SQL Postgres backing store. Link: https://share.google/Hxz8BG2S91t0mUwxi

Triage alongside the storage decision (C.18) when next reviewing infra options.
