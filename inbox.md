# Inbox

Append-only capture for ad-hoc ideas, questions, and nudges that don't have a long-term home yet. Triage periodically into: planning docs (`planning/`), commercials (archive), or deletion.

**Entry format**: `## YYYY-MM-DD — short title` then body. One- or two-line entries are fine.

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
