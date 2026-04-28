# Discovery Design Thinking — joint working doc for C.t2 + G.t0

**Status**: Active HITL design thinking. Updated 2026-04-28.
**Authored from**: a HITL session between Al + Claude (Opus 4.7, 1M context) where the C.t2 conversation + G.t0 conversation merged because the underlying design questions are inextricable.
**Purpose**: Persist the thinking chain across sessions. Future sessions resume here, evolve the thinking, and refine.
**Why this doc exists**: tools + system prompt + voice + the philosophy of what a conversation IS are all intimately related. Treating them as separate tasks (C.t2 vs G.t0 vs G.t1) was a planning convenience, not a design reality. This doc holds them together until they're ready to fork back into the per-task Tier 3 deliverables.

---

## How to use this doc next session

1. Read top-to-bottom — it's self-contained.
2. Load the **swoop** skill (covers engagement context + people).
3. Load `CLAUDE.md` (root) for project-wide invariants.
4. Spot-check the **Source materials** list — re-read whichever the next conversational move needs (most useful: the meeting transcripts, the PoC PROMPT_ENGINEERING.md, the PoC guidance-payload.json — see file paths in §3).
5. Pick up from **Where we are now** + **Open questions**.

This doc is **append-and-edit-friendly**. Each session can extend the thinking chain and refine the conclusions. Don't rewrite it from scratch.

---

## 1. The frame — what we're actually designing

**The deliverable is "the discovery experience" — singular, not three tasks.**

Decomposed in the planning docs as:
- **C.t2** — sales-shaped tool I/O schemas + entity model
- **G.t0** — Patagonia conversational flow mapping (HITL)
- **G.t1** — WHY system prompt
- **G.t3** — modular guidance ("skills") seeded ≥2

In the design conversation these collapsed into one question: *what does the agent need to know, and what affordances does it need, to run a great Patagonia discovery conversation?*

Three deliverables fall out of one design:
- **Tools as useful affordances** (C.t2 territory) — what they return, what makes them powerful, when they're most useful.
- **WHY context** (G.t1 territory) — Swoop's world: who we care about, what we don't do, how we sound, what makes a great handoff.
- **Skills as inflection-specific guidance** (G.t3 territory) — modular guidance the agent loads when context warrants (triage moments, customer-type-specific posture, etc.).

C.t2's Postgres entity model falls out of "what hydrates each tool's output?" — derivative, not load-bearing for the design conversation.

---

## 2. The thinking chain — full trajectory

Captured as it happened so future sessions can see *why* we landed where we did, not just what we landed.

### 2.1 Starting point — C.t2 schemas in isolation (what didn't work)

First attempt sketched `stoke_imagination(theme | region | mood)` as a discriminated input + a structured output (`framingProse`, `passages`, `images`, `customerStories`, `suggestedNextMoves`). Plus offered to walk the other 4 tools the same way.

Two questions to Al:
1. Is the input shape right?
2. Should `framingProse` be a tool output at all, or keep prose authorship as the orchestrator's job?

### 2.2 Al's first reframe — tools + workflows are inextricable

Al pushed back: designing tool I/O without the workflow leads to invented surfaces. The tools' WHY is in the conversation paths.

Suggested I read meeting transcripts + PoC sales docs + PoC cms docs.

### 2.3 Substrate read — what the meetings + PoC docs revealed

**Patagonia sales reality (Apr 20 kickoff with Luke + Julie):**
- Patagonia ≠ Antarctica — the Antarctica PoC welcomed every lead; Patagonia needs **active triage during discovery**.
- Customer types (Luke's segmentation): **Group Tourer / Tailor-Made / Independent / Backpacker (out)**. First dimension is independence level.
- Region segments: **Torres del Paine only / TdP+1 / off-the-beaten-track**. 80%+ of bookings touch TdP.
- Activity segments: **softer-adventure / hikers / multi-day-trekkers**.
- Budget: Patagonia "surprisingly expensive". Luxury lodges thousands per day. Group tours improve unit economics.
- Strategic priority: **group tours target 50% of bookings**. Surface them proactively for solo travellers (Luke's flagged single biggest priority).
- Floor: <$1k profit = negative contribution → refer out.
- Inventory constraint: **Dec–Feb luxury lodges need 6–12 month lead time**. Useful urgency lever for premium leads.
- Motivations Luke called out: W-trail hike, accessible glaciers, **puma photography**, **bragging-rights-luxury-lodge stays**.
- Julie's hard line: **the agent must not construct itineraries** — explicit safety rail.

**Technical reality (Apr 21 kickoff with Julie + Thomas + Richard):**
- Initial GCP target was Vertex AI Search — superseded by C.18 (Postgres + pgvector + tsvector + pg_trgm).
- Initial source of truth was discussed as scrape-vs-API — superseded by the SQL dump arriving 2026-04-27 (canonical now per C.21 + C.23).
- React + assistant-ui as UI; ADK TS as agent runtime. Both still settled.

**Swoop's "Discover" sales methodology (PoC sales docs):**
- Three-stage process: **Discover → Propose → Close**. The PoC handled only Discover; Puma also handles only Discover.
- Discover techniques: **listen actively, ask lots of questions, encourage, respond positively, find mutual connections**.
- Three question types: **TED (Tell, Explain, Describe), Probing, Black-and-white**.
- Recap → check → agree-next-step closing pattern.
- Discovery is complete when "you understand the customer's needs AND have made a connection".
- LEAR objection-handling framework: **Listen, Acknowledge, Explore, Respond**.

**The PoC's behavioural brain (PoC `cms/guidance-payload.json` + `cms/PROMPT_ENGINEERING.md`):**
- **2x2 conversation state matrix**: **Readiness × Warmth → Browse / Excite / Convince / Convert**.
- **6 content dimensions + meta-Affordability**: Destination, Timing, Desires, Concerns, Practical, Emotional, each 0–3.
- **4 user archetypes**: Dreamer / Planner / Skeptic / Browser.
- **Tool sequencing strategy**: tools chosen by state cell — but this was over-prescriptive (see 2.6).
- **PROMPT_ENGINEERING framework**: every tool description authored as **WHY → HOW → WHAT** crossed with **× User / × Agent / × Swoop** = a 3×3 reasoning matrix. The matrix lives as code comments next to the description; the description string is the prose output. Reasoning is preserved for future iteration.
- **Brand voice (Tone of Voice doc)**: "Attenborough not the encyclopedia" + "candid & trustworthy — the negatives as well as the positives" + "playful & enthusiastic — penguin poo and whale snot" + the "if-Swoop-were-the-guide-at-a-refugio-bar-would-they-speak-this-way" test.
- **Why Swoop pillars (elevator pitch)**: SPECIALISM / EXPERIENCE (150+ Antarctic trips) / PARTNERSHIPS (impartial across the polar fleet) / GLOBAL TEAM (22h support) / ONE POC (dedicated CX colleague) / EMERGENCY COVER (24/7) / SAME COST (no markup).
- **Constraints (PoC's 10-point list)**: don't lead with specific ship names; let `show_component_list` browse; bookings via handoff not instructions; detailed itineraries via specialist not text; weave knowledge naturally; concerns first then validate then address; budget directly when natural; etc.
- **Affordability gating**: NOT a gate for the conversation (everyone deserves an inspiring conversation), IS a gate for handoff (don't waste sales time below £5k tier).

### 2.4 Synthesis — 7 candidate Patagonia conversation paths (drafted)

Drafted 7 outcome shapes:

| # | Path | Verdict | Reason code |
|---|---|---|---|
| 1 | Solo → Group Tour | qualified | `group_tour_intent` |
| 2 | Premium Tailor-Made | qualified | `bespoke_request` / `budget_and_timeline_confirmed` |
| 3 | Confident Hiker / Independent | qualified | `ready_booking_named_trip` |
| 4 | Specialist Photography | qualified | `bespoke_request` |
| 5 | Backpacker → Disqualified | disqualified | `backpacker_no_budget` |
| 6 | Off-region / sub-$1k | referred_out | `out_of_region` / `below_profit_floor` |
| 7 | **Inconclusive** (NEW) | **inconclusive (proposed 4th verdict)** | `low_engagement` / `mixed_signals` / `extended_no_convergence` / `comparison_shopping` / `off_offer_in_region` / `drive_by` / `inconclusive_other` |

Path 7 covers visitors who don't fit qualified / referred-out / disqualified — agent never reaches confidence to verdict. The PoC's posture for these visitors is "don't push, keep it warm and inspiring, leave the door open" (the "tell a friend, save up, enjoy dreaming" mode from `affordabilityGuidance`). Sales never sees them; durable record exists for analytics.

### 2.5 Al's second reframe — trust the agent

Two corrections:

1. **Don't over-prescribe.** Sonnet is good at reading context and reasoning. The PoC's `howToUseThisGuidance` over-encodes ("Turn 1: do X. Turn 2: do Y. Turn 3+: bias toward Z"). Better posture: rich WHY context + clear tool affordances + clear motivations, then trust the agent.
2. **The 7-path model is at the wrong altitude.** Paths-as-state-machine is over-engineering. The dimensions framework already exists; paths are *outcomes* that emerge from dimensions, not states the agent tracks.

### 2.6 The reframe absorbed — what the design now looks like

**Conversation model (clean):**
- Agent is given **rich WHY context** + **tools as affordances** + **voice + refusals**.
- Agent reads context, reads visitor, picks tools. **No state machine encoded in code.**
- The PoC's dimensions framework + R/W matrix + archetypes are useful *mental models the agent can use*, NOT formal state the agent must track.
- Patagonia adds **customer-type as a derived signal** (Group Tourer / Tailor-Made / Independent / Backpacker / Off-region). Not formally classified at runtime — read from signals like dimensions.
- The 7 paths are useful for: **eval harness scenarios (H.t4)**, **compliance-bundle failure-mode coverage**, **sales-team mental model** — NOT for agent state.

**Verdict taxonomy (proposed addition):**
- E.t1 currently has 3 verdicts: `qualified` / `referred_out` / `disqualified`.
- Add **4th verdict: `inconclusive`** for Path 7 visitors.
- Reason codes per verdict (per E.t1's existing per-verdict enum pattern).
- **Agent self-asserts the reason code** (Al confirmed) — Sonnet is sophisticated enough to pick from a small enum at handoff time. The PoC's `handoff` tool already has the agent producing structured args; this extends the pattern.
- Codes are useful for: sales routing, prioritisation, email-template selection, analytics queries, H.t3 assertions.

**Tool design lens:**
- Less "design tool I/O for inflection X in path Y".
- More **"design tools as useful affordances"** — what content makes a great response when the agent reaches for this tool?
- Tool descriptions in prose (per-tool `cms/prompts/tools/<tool>/description.md`) carry chunks of WHY context — the WHY/HOW/WHAT × User/Agent/Swoop matrix from the PoC's PROMPT_ENGINEERING framework.

**The 5 sales-shaped tools (per Tier 2 chunk C §2.2):**
- `stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`
- Roughly right but **not yet validated** under the looser frame.
- Need re-sketching: what does each return? What's the data shape that makes a great response possible?
- Postgres entities (`vibe_passage`, `customer_story`, `trust_proof`, `trip_card`) fall out of "what hydrates the output?".

---

## 3. Source materials

Paths in this repo unless noted. The PoC repo is at `/Users/al/Studio/projects/swoop/` (no symlink in this worktree).

### Meeting transcripts (load these first to ground the conversation)
- `planning/archive/meetings/Luke _ Julie _ Alastair kick off for the Conversational AI tool - 2026_04_20 16_00 BST - Notes by Gemini.md` — kickoff with Luke + Julie. Defines Patagonia customer segmentation, group-tour priority, motivation anchors, profit floor, inventory constraint, no-itineraries rail.
- `planning/archive/meetings/AI Tool Technical Requirements  – 2026_04_21 14_00 BST – Notes by Gemini.md` — technical kickoff with Julie + Thomas + Richard. ADK / React / Cloud Run / Vertex (now superseded) / scraping (now superseded by SQL dump).

### PoC sales docs (Swoop's actual sales-team training material)
- `/Users/al/Studio/projects/swoop/sales docs/extracted/sales-process.md` — Discover → Propose → Close. TED/probing/B&W questions. LEAR objection handling. Closing techniques.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/the-brand-platform-toolkit---oct-14th-sales.md` — brand platform: "Your adventure story", 400,000 hours of lived experience, tap-into framing.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/tone-of-voicedecember-2025-for-presenting.md` — voice + tone bible. Four pillars: Authoritative-yet-Approachable / Candid-&-Trustworthy / Playful-&-Enthusiastic / Language-Choices. Don't-vs-Do swap table for formal-to-natural language.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/why-swoop---elevator-pitch-training-ant.md` — 7 Why-Swoop pillars + the full pitch script.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/why-swoop-emails.md` — sample handoff-style email body language.

### PoC cms (the behavioural brain of the ChatGPT prototype)
- `/Users/al/Studio/projects/swoop/product/cms/PROMPT_ENGINEERING.md` — **the framework** for writing tool descriptions. WHY/HOW/WHAT × User/ChatGPT/Swoop matrix, principles, do/don't, the test. **This is the canonical authoring framework Puma should inherit** (substituting × Agent for × ChatGPT).
- `/Users/al/Studio/projects/swoop/product/cms/README.md` — content-as-data posture; how content reaches the agent.
- `/Users/al/Studio/projects/swoop/product/cms/guidance-payload.json` — **the actual prose** for `aboutSwoop`, `salesMethodology`, `toneOfVoice`, `brandPillars`, `howToUseThisGuidance`, `dimensionsFramework`, `readinessWarmthModel`, `handoffTriggers`, `constraints`, `affordabilityGuidance`, `domainSummaries`, `postHandoffGuidance`. Antarctica-flavoured; needs Patagonia-specific equivalents authored.

### Tier 1 plans (project orientation)
- `planning/01-top-level.md` — Puma roadmap, JTBDs, themes, milestones, parallelisation strategy.
- `planning/01-side-quest-persistence.md` — cross-iframe rehydration plan (W1+W2 unparked 2026-04-28 after mock-host evidence).

### Tier 2 plans (chunk-level implementation context)
- `planning/02-impl-content.md` — chunk G. **Most relevant** for G.t0 + G.t1 design. Authoritative on G.10 (style-avoid) + G.11 (CMS folder structure).
- `planning/02-impl-retrieval-and-data.md` — chunk C, rewrite of 2026-04-28. **Most relevant** for tool design + Postgres entity model. 10-tool surface, composer pattern, sales-shaped derived entities.
- `planning/02-impl-handoff-and-compliance.md` — chunk E. Verdict + reason taxonomy + consent two-tier model.
- `planning/02-impl-validation.md` — chunk H. Eval harness scope (H.t4 will scenario-author Path 1–7).
- `planning/02-impl-agent-runtime.md` — chunk B. Two-layer agent model (orchestrator Sonnet + functional internal Haiku agents).
- `planning/02-impl-chat-surface.md` — chunk D. Disclosure + consent UX context.
- `planning/02-impl-foundations.md` — chunk A. Workspace + ts-common contracts.
- `planning/02-impl-observability.md` — chunk F. Event schema for handoff/triage events.

### Tier 3 plans (most relevant landed during this session)
- `planning/03-exec-blog-ingest.md` — blog ingest pipeline. Implemented in this session (`worktree-agent-a0b7dfee4cfcd79d3`). 102 posts pulled live.
- `planning/03-exec-handoff-t1.md` — verdict + reason taxonomy in `@swoop/common/handoff`. **Authoritative on E.t1's contract**; the proposed `inconclusive` verdict extends this.
- `planning/03-exec-validation-scaffold.md` — H.t1 harness scaffold. The 13 stub scenarios under `product/harness/scenarios/` are where Path 1–7 walk-throughs eventually land as YAML.

### Decisions log
- `planning/decisions.md` — running log. Most relevant entries for this design:
  - **G.10** (2026-04-24) — two-layer voice control (positive examples + explicit avoidance list)
  - **G.11** (2026-04-27) — CMS folder structure (`prompts/system/`, `prompts/skills/`, `prompts/tools/`)
  - **C.13–C.23** (2026-04-28) — golden thread, no departures/swoopers/calc-pricing, page-as-hub, ntag live, Postgres lock, sales-shaped tool surface, blog ingest, composer pattern
  - **B.22** (2026-04-28) — sessions on ADK in-built first; custom Postgres `SessionService` post-M4
  - **E.1–E.15** — verdict + reason taxonomy + storage + email + consent + connector home + endpoint + payload-enrichment + consent-timestamp
  - **H.9–H.13** + new **H.14–H.16** (this session) — harness language, scenario format, orchestrator invocation, event-schema imports, CI gating, event-capture interface, Zod-discriminated-union refinements

### Discoveries + gotchas
- `discoveries.md` — non-obvious architectural truths. Particularly: form submission is a discrete user action (not a chat turn), connector returns `{ok, value}` envelopes, `<reasoning>` filtered from outbound SSE, Two-layer agent model works cleanly in ADK, etc.
- `gotchas.md` — environmental traps. dotenv override, model IDs, session-state-is-in-memory, etc.

---

## 4. Where we are now (2026-04-28 EOD)

### Design state
- **Reframe absorbed**: trust-the-agent posture; rich context + tools, not workflow encoding.
- **7 path sketches drafted** — held as outcome-shapes for eval scenarios + sales-team mental model + compliance-bundle failure-mode coverage. Not encoded as agent state.
- **4th verdict `inconclusive` proposed** — touches E.t1's contract but E.t1's schema is fresh enough to extend cheaply. Reason codes: `low_engagement` / `mixed_signals` / `extended_no_convergence` / `comparison_shopping` / `off_offer_in_region` / `drive_by` / `inconclusive_other`. **Awaits Al's go-ahead** to land in `@swoop/common/handoff.ts`.
- **Customer-type as new dimension** — Group Tourer / Tailor-Made / Independent / Backpacker / Off-region. Derived signal alongside existing 7 dimensions. **Not formalised yet.**
- **Reason codes — agent self-asserts** (Al confirmed). Codes stay structured for queryability + sales routing + H.t3 assertions.
- **Tool design lens** flipped — affordances + content shape, not state-machine inflections.

### What's NOT done — open questions for next session

1. **Re-sketch the 5 sales-shaped tools under the looser frame.** For each:
   - What's the input? (Likely simpler than I first sketched — mostly free-text seed strings.)
   - What's the output? (Rich content payload that makes a great response possible.)
   - What's the WHY/HOW/WHAT × User/Agent/Swoop matrix for the tool description?
   - Which composer Haiku reasoning does this tool need internally (per chunk C §2.3)?

   Tools to walk: `stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`.

2. **G.t1 WHY system prompt — first pass.** The PoC's `aboutSwoop` + `salesMethodology` + `toneOfVoice` + `brandPillars` are the substrate. Patagonia equivalents authored from those + Luke's 20 Apr motivation segmentation + the strategic group-tour priority. Fits the G.10 two-file pattern (positive examples + style-avoid). **Lane's sales-thinking doc (~May 4) will refine** — first pass can land on PoC + meeting-derived placeholders.

3. **G.t3 seed skills — at least 2.** Likely candidates from Path sketches:
   - `tailor-made-prospect-posture` (when high-budget + independence signals present)
   - `group-tour-surfacing-for-solos` (Luke's strategic priority — load when solo + mid-budget + active)
   - `triage-to-referral-polite-redirect` (when low-fit signals reach threshold)
   Candidate selection falls out of which path-shapes need their own loaded posture.

4. **Customer-type signal — derivation mechanism.** Options:
   - Free-form: agent infers + writes into handoff payload as text.
   - Haiku post-classifier: composer pattern at handoff time, fills `customerType` field.
   - Continuous classifier: Haiku per-turn updates session state (heavy; probably not Puma).
   Recommend option 2: Haiku post-classifier fills customer type alongside reason code at handoff submission.

5. **Inconclusive verdict — go-ahead?** Adding to `@swoop/common/handoff.ts` is small. Email behaviour: no email (per E.3 disqualified pattern). Retention: 90 days (per E.7 disqualified pattern, since these aren't future-leads-with-substance).

6. **Postgres entity model.** Fall-out from the tool re-sketches. Unblocks C.t3 (ETL) + C.t3a (embeddings) + C.t4 (tool implementations).

### Agent work landed this session — branches awaiting review

| Task | Branch | Status |
|---|---|---|
| B.t11 (server history endpoint) | `worktree-agent-a8e6c237df1d50495` | Clean. 7 new tests. |
| D.t9 (UI rehydration) | `worktree-agent-aca0f1cf63634e3d6` | **WIP**. Translator + fetch + hook + 23 tests pass. assistant-ui seed call needs swap to "replay parts through transport". Forward path documented. |
| E.t5 (legal copy authoring) | `worktree-agent-a95b92173d0d6db38` | Clean. 6 markdown files + UI loader + 3 components rewired. Voice notes captured for editorial pass. 5 consent-flow gotchas surfaced. |
| E.t6 (retention sweeper) | `worktree-agent-a67216b65b2f02c64` | Clean. 20 tests. Decisions E.16/E.17/E.18 logged. |
| E.t7 (data-deletion runbook) | `worktree-agent-a457c8a59ea51c863` | Clean. 178-line runbook. |
| E.t8 (compliance bundle) | `worktree-agent-aa937af55c9b5ea42` | Clean. 9-doc bundle with verified mermaid diagram. 10 open questions for Julie + counsel. |
| H.t3 (assertion catalogue) | `claude/nervous-goodall-1fe7d6` (this branch — isolation didn't engage) | Clean. 6 new assertion kinds + EventCapture helper + 62 new tests. Decisions H.14/H.15/H.16 logged. |
| H.t7 (evalset growth runbook) | `worktree-agent-aa4ecd7b52da09acb` | Clean. 217-line runbook. |
| Blog ingest implementation | `worktree-agent-a0b7dfee4cfcd79d3` | Clean. 31 tests. **Live verification pulled 102 real posts.** |
| C.t1 (connector skeleton + Postgres) | `worktree-agent-ab15fbf1e1e56aec9` | **WIP**. Tier 3 plan committed clean. Implementation scaffolded (Express + MCP SDK + pg + migrations + health endpoints + 2 tests) committed but **runtime verification deferred** (docker-compose up + migrate-up not run). |

**Notes for the merge pass:**
- WIP branches (D.t9, C.t1) want a follow-up pass before main. D.t9 needs the seed-call swap; C.t1 needs runtime verification.
- E.t6's report flagged that it scaffolded `FsHandoffStore` itself because its base branch didn't have E.t2's work — when merging, expect a conflict against E.t2's already-merged version. E.t6's interface differs slightly; reconcile in the merge.
- E.t7's report flagged forward-references to E.t5's files (which now exist post-merge of E.t5).
- E.t8's report flagged `E.1–E.10` decisions live in `02-impl-handoff-and-compliance.md` §5 not `decisions.md` — minor consistency tidy.

---

## 5. Cross-references

- **The 7 paths sketch** in full prose — see the conversation transcript / chat session.
- **Tier 3 plans for C.t2 / G.t0 / G.t1 / G.t3** — not yet authored. They'll fall out of this thinking doc once the design firms.
- **H.t4 evalset authorship** — depends on this thinking. Each path becomes 1–2 scenarios under `product/harness/scenarios/` with appropriate assertions (tool-call, triage-verdict, handoff-event, judge-rubric).
- **Compliance bundle (E.t8)** — `product/cms/legal/compliance-bundle/consent-flow.md` describes the consent flow but assumes 3 verdicts; needs a small update if `inconclusive` lands.
- **F.t6 conversation-analysis harness** — the experts that read conversations need to know the path taxonomy + verdict taxonomy. This doc is input to F.t6 prompt design.

---

## 6. Method notes (for future-Claude)

- **Don't treat the 7 paths as state.** They're outcome shapes. The agent reasons; paths emerge.
- **PROMPT_ENGINEERING.md (PoC) is the authoring framework** — every tool description should be authored with the WHY/HOW/WHAT × User/Agent/Swoop matrix as code-comment scratchpad above the prose.
- **Voice is authoritative-yet-approachable + candid + playful + plain-language.** "If Swoop were the guide at the refugio bar, would they speak to their customers this way?" is the test.
- **Don't over-describe the negative space.** Anti-pattern lists belong in `cms/prompts/system/10_style-avoid.md`. Positive examples in `00_why.md`. Decoupled.
- **Trust Sonnet's reasoning**, but give it lots of context to reason from. Rich brief > prescriptive workflow.
- **Patagonia ≠ Antarctica** in three load-bearing ways: triage during discovery; group-tour strategic priority; customer-type segmentation (Group Tourer / Tailor-Made / Independent / Backpacker-out).
