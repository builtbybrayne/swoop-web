# Discovery Design Thinking — joint working doc for C.t2 + G.t0

**Status**: Active HITL design thinking. Persistable across sessions.
**Authored from**: a HITL session 2026-04-28 between Al and Claude (Opus 4.7, 1M context) where the C.t2 conversation and G.t0 conversation merged because the underlying design questions are inextricable.
**Why this doc exists**: tools + system prompt + voice + the philosophy of what a conversation IS are all intimately related. Treating them as separate Tier 3 tasks (C.t2 vs G.t0 vs G.t1) was a planning convenience, not a design reality. This doc holds them together until the design firms enough to fork back into the per-task deliverables.

> **2026-04-29 supersession note**: The tool names referenced throughout this doc (`stoke_imagination`, `offer_options`, `recall_someone_who`, `build_confidence`, `compare_paths`) are from the 2026-04-28 sales-shaped + composer surface, **superseded** by the eight intent-named tools in [02-impl-retrieval-and-data.md](02-impl-retrieval-and-data.md) §2.2 (decisions C.24 + C.25). Mapping: `stoke_imagination` → `find_inspiring`; `recall_someone_who` → `find_someone_who` *(conditional on C.26)*; `build_confidence` → `find_proof`; `offer_options` + `compare_paths` collapse into `find_options`; `lookup` is new for direct factual questions. The thinking chain in this doc is still valid; the tool naming is dated.

---

## How to use this doc next session

1. Read top-to-bottom. It's self-contained.
2. Load the **swoop** skill (engagement context, people, voice).
3. Load `CLAUDE.md` (root) for project-wide invariants.
4. Spot-check the **Source materials** list — re-read whichever the next move needs (most useful: meeting transcripts, PoC `PROMPT_ENGINEERING.md`, PoC `guidance-payload.json`).
5. Pick up from **Where we are now** + **Open questions**.

This doc is **append-and-edit-friendly**. Each session can extend the thinking chain and refine the conclusions. Don't rewrite from scratch.

---

## 1. The frame — what we're actually designing

**The deliverable is "the discovery experience" — singular, not three tasks.**

Decomposed in the planning docs as:
- **C.t2** — sales-shaped tool I/O schemas + Postgres entity model
- **G.t0** — Patagonia conversational flow mapping (HITL session)
- **G.t1** — WHY system prompt
- **G.t3** — modular guidance ("skills") seeded ≥2

In the design conversation these collapsed into one question: *what does the agent need to know, and what affordances does it need, to run a great Patagonia discovery conversation?*

Three deliverables fall out of one design:
- **Tools as useful affordances** (C.t2 territory) — what they return, what makes them powerful, when they're most useful.
- **WHY context** (G.t1 territory) — Swoop's world: who we care about, what we don't do, how we sound, what makes a great handoff.
- **Skills as inflection-specific guidance** (G.t3 territory) — modular guidance the agent loads when context warrants (triage moments, customer-type-specific posture, etc.).

C.t2's Postgres entity model falls out of "what hydrates each tool's output?" — derivative, not load-bearing for the design conversation.

---

## 2. Source materials (with paths)

Paths in this repo unless noted. The PoC repo is at `/Users/al/Studio/projects/swoop/`.

### Meeting transcripts (load these first to ground the conversation)
- `planning/archive/meetings/Luke _ Julie _ Alastair kick off for the Conversational AI tool - 2026_04_20 16_00 BST - Notes by Gemini.md` — kickoff with Luke + Julie. Defines Patagonia customer segmentation, group-tour priority, motivation anchors, profit floor, inventory constraint, no-itineraries rail.
- `planning/archive/meetings/AI Tool Technical Requirements  – 2026_04_21 14_00 BST – Notes by Gemini.md` — technical kickoff with Julie + Thomas + Richard. Note: the Vertex AI Search + scrape paths discussed there are now superseded (Postgres + SQL dump per C.18 + C.21).

### PoC sales docs (Swoop's actual sales-team training material)
- `/Users/al/Studio/projects/swoop/sales docs/extracted/sales-process.md` — Discover → Propose → Close. TED/probing/B&W question types. LEAR objection handling. Closing techniques.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/the-brand-platform-toolkit---oct-14th-sales.md` — brand platform: "Your adventure story", 400,000 hours of lived experience.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/tone-of-voicedecember-2025-for-presenting.md` — voice + tone bible. Four pillars. Don't-vs-Do swap table for formal-to-natural language.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/why-swoop---elevator-pitch-training-ant.md` — 7 Why-Swoop pillars + the full pitch script.
- `/Users/al/Studio/projects/swoop/sales docs/extracted/why-swoop-emails.md` — sample handoff-style email body language.

### PoC cms (the behavioural brain of the ChatGPT prototype)
- `/Users/al/Studio/projects/swoop/product/cms/PROMPT_ENGINEERING.md` — **the canonical authoring framework** for tool descriptions. WHY/HOW/WHAT × User/ChatGPT/Swoop matrix. Puma should inherit it (substituting × Agent for × ChatGPT).
- `/Users/al/Studio/projects/swoop/product/cms/README.md` — content-as-data posture; how content reaches the agent.
- `/Users/al/Studio/projects/swoop/product/cms/guidance-payload.json` — **the actual prose** for `aboutSwoop`, `salesMethodology`, `toneOfVoice`, `brandPillars`, `howToUseThisGuidance`, `dimensionsFramework`, `readinessWarmthModel`, `handoffTriggers`, `constraints`, `affordabilityGuidance`, `domainSummaries`, `postHandoffGuidance`. Antarctica-flavoured; needs Patagonia-specific equivalents authored.

### Tier 1 + Tier 2 plans (project orientation)
- `planning/01-top-level.md` — Puma roadmap, JTBDs, themes, milestones.
- `planning/02-impl-content.md` — chunk G. **Most relevant for G.t0 + G.t1.** Authoritative on G.10 (style-avoid) + G.11 (CMS folder structure).
- `planning/02-impl-retrieval-and-data.md` — chunk C, **rewrite of 2026-04-28**. Most relevant for tool design + Postgres entity model. 10-tool surface, composer pattern, sales-shaped derived entities.
- `planning/02-impl-handoff-and-compliance.md` — chunk E. Verdict + reason taxonomy + consent two-tier model.
- `planning/02-impl-validation.md` — chunk H. Eval harness scope.
- `planning/02-impl-agent-runtime.md` — chunk B. Two-layer agent model.

### Decisions log
- `planning/decisions.md`. Most relevant entries:
  - **G.10** — two-layer voice control (positive examples + explicit avoidance list)
  - **G.11** — CMS folder structure (`prompts/system/`, `prompts/skills/`, `prompts/tools/`)
  - **C.13–C.23** — golden thread, no departures/swoopers/calc-pricing, page-as-hub, ntag live, Postgres lock, sales-shaped tool surface, composer pattern
  - **B.22** — sessions on ADK in-built first; custom Postgres `SessionService` post-M4
  - **E.1–E.15** — verdict + reason taxonomy + storage + email + consent

### Discoveries + gotchas
- `discoveries.md` — non-obvious architectural truths.
- `gotchas.md` — environmental traps.

---

## 3. The thinking chain — full trajectory

Captured as it happened so future sessions can see *why* we landed where we did, not just what we landed.

### 3.1 Substrate read — what the meetings + PoC docs reveal

**Patagonia sales reality (Apr 20 kickoff with Luke + Julie):**
- Patagonia ≠ Antarctica — Antarctica welcomed every lead; Patagonia needs **active triage during discovery**.
- Customer types (Luke's segmentation): **Group Tourer / Tailor-Made / Independent / Backpacker (out)**. First dimension is independence level.
- Region segments: **Torres del Paine only / TdP+1 / off-the-beaten-track**. 80%+ of bookings touch TdP.
- Activity segments: **softer-adventure / hikers / multi-day-trekkers**.
- Budget: Patagonia "surprisingly expensive". Luxury lodges thousands per day. Group tours improve unit economics.
- Strategic priority: **group tours target 50% of bookings**. Surface them proactively for solo travellers (Luke's flagged single biggest priority).
- Floor: **<$1k profit = negative contribution → refer out**.
- Inventory constraint: **Dec–Feb luxury lodges need 6–12 month lead time**. Useful urgency lever for premium leads.
- Motivations Luke called out: W-trail hike, accessible glaciers, **puma photography**, **bragging-rights luxury-lodge stays**.
- Julie's hard line: **the agent must not construct itineraries** — explicit safety rail.

**Swoop's "Discover" sales methodology (PoC sales docs):**
- Three-stage process: **Discover → Propose → Close**. Puma handles only Discover (same as PoC).
- Discover techniques: listen actively, ask lots of questions, encourage, respond positively, find mutual connections.
- Three question types: **TED (Tell, Explain, Describe), Probing, Black-and-white**.
- Recap → check → agree-next-step closing pattern.
- Discovery is complete when "you understand the customer's needs AND have made a connection".
- LEAR objection handling: Listen, Acknowledge, Explore, Respond.

**The PoC's behavioural brain (PoC `cms/guidance-payload.json` + `cms/PROMPT_ENGINEERING.md`):**
- **2x2 conversation state matrix**: **Readiness × Warmth → Browse / Excite / Convince / Convert**.
- **6 content dimensions + meta-Affordability**: Destination, Timing, Desires, Concerns, Practical, Emotional, each 0–3.
- **4 user archetypes**: Dreamer / Planner / Skeptic / Browser.
- **PROMPT_ENGINEERING framework**: every tool description authored as **WHY → HOW → WHAT** crossed with **× User / × Agent / × Swoop** = a 3×3 reasoning matrix. Matrix as code-comment scratchpad; the prose description is the output.
- **Brand voice**: "Attenborough not the encyclopedia" + "candid & trustworthy — the negatives as well as the positives" + "playful & enthusiastic — penguin poo and whale snot" + "if-Swoop-were-the-guide-at-a-refugio-bar-would-they-speak-this-way" test.
- **Why Swoop pillars**: SPECIALISM / EXPERIENCE (150+ Antarctic trips) / PARTNERSHIPS (impartial across the polar fleet) / GLOBAL TEAM (22h support) / ONE POC / EMERGENCY COVER / SAME COST.
- **Affordability gating**: NOT a gate for the conversation, IS a gate for handoff (don't waste sales time below £5k tier).

### 3.2 The 7 path sketch — outcome shapes (NOT agent state)

| # | Path | Verdict | Reason code |
|---|---|---|---|
| 1 | Solo → Group Tour pivot | qualified | `group_tour_intent` |
| 2 | Premium Tailor-Made (anniversary, lodges) | qualified | `bespoke_request` / `budget_and_timeline_confirmed` |
| 3 | Confident Hiker / Independent | qualified | `ready_booking_named_trip` |
| 4 | Specialist Photography (puma niche) | qualified | `bespoke_request` |
| 5 | Backpacker → Disqualified (politely) | disqualified | `backpacker_no_budget` |
| 6 | Off-region or sub-$1k profit → Referred Out | referred_out | `out_of_region` / `below_profit_floor` |
| 7 | **Inconclusive** — agent never reaches confidence | **inconclusive (PROPOSED 4th VERDICT)** | `low_engagement` / `mixed_signals` / `extended_no_convergence` / `comparison_shopping` / `off_offer_in_region` / `drive_by` / `inconclusive_other` |

Path 7 covers visitors who don't fit qualified / referred-out / disqualified — agent never reaches confidence. The PoC's posture for these visitors is "don't push, keep it warm and inspiring, leave the door open" (the "tell a friend, save up, enjoy dreaming" mode from `affordabilityGuidance`). Sales never sees them; durable record exists for analytics.

**Paths are outcome shapes, NOT agent state.** They're useful for:
- Eval harness scenarios (H.t4 — test each resolves correctly)
- Compliance bundle (failure-mode coverage)
- Sales-team mental model

The agent doesn't track which path it's on — paths *emerge* from the dimensions framework as the conversation unfolds.

### 3.3 The reframe — trust the agent, don't over-prescribe

**Old PoC posture (over-prescriptive):** `howToUseThisGuidance` encodes turn-by-turn behaviour ("Turn 1: do X. Turn 2: do Y. Turn 3+: bias toward Z"). This was the ChatGPT-era pattern — necessary because ChatGPT Apps SDK has no system prompt.

**Puma posture (trust-the-agent):**
- Sonnet is sophisticated enough to read context and reason. Don't encode workflow as a state machine.
- Provide:
  - **Rich WHY context** — Swoop's world, who we care about, what we don't do, what makes a great handoff
  - **Tools as affordances** with strong WHY-flavoured descriptions
  - **Voice + refusals** — how Swoop sounds, what it won't pretend to be
- The PoC's dimensions framework + R/W matrix + archetypes are useful **mental models the agent can use**, not formal state the agent must track.
- Patagonia adds **customer-type as a derived signal** (Group Tourer / Tailor-Made / Independent / Backpacker / Off-region). Read from signals like the existing dimensions; not a new tracked state.

### 3.4 Verdict taxonomy — proposed 4th verdict

E.t1 currently ships 3 verdicts: `qualified` / `referred_out` / `disqualified`. Add **4th verdict `inconclusive`** for Path 7 visitors (agent reached no confidence). E.t1's contract is fresh enough that extending it is cheap.

- Email behaviour: **no email** (per E.3 disqualified pattern).
- Retention: **90 days** (per E.7 disqualified pattern; not future-leads-with-substance).
- Reason codes: see Path 7 in §3.2.

### 3.5 Reason codes — agent self-asserts

Al confirmed: **the agent picks reason codes** at handoff time. Sonnet is sophisticated enough to pick from a small per-verdict enum. Existing E.t1 contract already supports this. H.t3 (assertion catalogue, landed clean on this branch) consumes them via `triage_verdict { verdict, reasonCode }` assertions.

### 3.6 Tool design lens — reframed

Less: "design tool I/O for inflection X in path Y".
More: **"design tools as useful affordances"** — what content makes a great response when the agent reaches for this tool?

Tool descriptions in prose (per-tool `cms/prompts/tools/<tool>/description.md`) carry chunks of WHY context — using the WHY/HOW/WHAT × User/Agent/Swoop matrix from PoC's PROMPT_ENGINEERING.md as code-comment scratchpad above the description string.

The 5 sales-shaped tools as drafted in the 2026-04-28 Tier 2 §2.2 — **superseded 2026-04-29 by the eight intent-named surface (decision C.25)**:
- ~~`stoke_imagination`~~ → `find_inspiring`
- ~~`offer_options`~~ + ~~`compare_paths`~~ → collapse into `find_options`
- ~~`recall_someone_who`~~ → `find_someone_who` (live since 2026-04-30 per C.26)
- ~~`build_confidence`~~ → `find_proof`
- new: `lookup` for direct factual questions

Roughly right but **not yet validated under the looser frame**. Need re-sketching: what does each return? What's the data shape that makes a great response possible? Postgres entities (`inspire_passage`, `customer_story`, `trust_proof`, `trip_card`, `inform_chunk`) fall out of "what hydrates the output?".

---

## 4. Where we are now (2026-04-28 EOD)

### Design state
- **Reframe absorbed**: trust-the-agent posture. Rich context + tools, not workflow encoding.
- **7 path sketches drafted** as outcome-shapes for eval / compliance / sales-team mental model. Not encoded as agent state.
- **4th verdict `inconclusive` proposed** — awaits go-ahead to land in `@swoop/common/handoff.ts`.
- **Customer-type as derived signal** — Group Tourer / Tailor-Made / Independent / Backpacker / Off-region. Not formalised yet.
- **Reason codes — agent self-asserts** (Al confirmed). Codes stay structured for queryability + sales routing.
- **Tool design lens flipped** — affordances + content shape, not state-machine inflections.

### Open questions for next session

1. **Re-sketch the eight intent-named tools under the looser frame** (superseded the 5 sales-shaped names per C.25 + C.27). For each:
   - Input shape (likely simpler than first sketches — mostly free-text seed strings + small filter objects).
   - Output shape (rich content payload that makes a great response possible).
   - WHY/HOW/WHAT × User/Agent/Swoop matrix for the tool description.
   - **No composer layer** (C.24 supersedes C.22) — orchestrator-level Sonnet calls intent-named tools directly; cheap-Haiku-at-ETL is the only sub-LLM pass.
   Tools to walk: `find_inspiring`, `find_someone_who`, `find_proof`, `lookup`, `find_options`, plus carry-forward `illustrate`, `handoff`, `handoff_submit`.

2. **G.t1 WHY system prompt — first pass.** PoC's `aboutSwoop` + `salesMethodology` + `toneOfVoice` + `brandPillars` are the substrate. Patagonia equivalents authored from those + Luke's 20 Apr motivation segmentation + the strategic group-tour priority. Fits the G.10 two-file pattern (positive examples + style-avoid). Lane's sales-thinking doc (~May 4) will refine; first pass can land on PoC + meeting-derived placeholders.

3. **G.t3 seed skills — at least 2.** Likely candidates from the path sketches:
   - `tailor-made-prospect-posture` (when high-budget + independence signals present)
   - `group-tour-surfacing-for-solos` (Luke's strategic priority — load when solo + mid-budget + active)
   - `triage-to-referral-polite-redirect` (when low-fit signals reach threshold)

4. **Customer-type signal — derivation mechanism.** ✅ **Closed by Q4 (2026-04-29)**: customer-type derivation lives in the main chat agent, not a Haiku post-classifier. The orchestrator is the most context-aware reasoner in the loop; the signal isn't worth a separate model call. ~~Earlier draft (now superseded): "Recommended: Haiku post-classifier fills `customerType` field at handoff submission time alongside reason code. Composer pattern at handoff time, not continuous classifier per-turn."~~

5. **Inconclusive verdict — go-ahead?** Adding to `@swoop/common/handoff.ts` is small. Cheap because E.t1 schema is fresh.

6. **Postgres entity model.** Falls out of the tool re-sketches. Unblocks C.t3 (ETL) + C.t3a (embeddings) + C.t4 (tool implementations).

---

## 5. Method notes

- **Top-down, not bottom-up.** (Al, 2026-04-29.) Tools, system prompts, modular guidance are an interlocking ensemble — design them as one. Start from conversational arcs (visitor journeys, §3.2 paths, customer-type segmentation, motivation anchors) and ask "what does the agent need at each beat — guidance? a tool? a piece of WHY context?". Tool I/O follows; Postgres entity model emerges last. **Do NOT** start from the data shape and propagate up — that risks well-shaped tools whose surface contradicts the WHY voice, or skills triggered at the wrong inflection because tool boundaries didn't align with real conversational moments.
- **Deliver, not perfect — design around data gaps.** (Al, 2026-04-30.) When the data corpus has holes (e.g. C.t0 found `customerreview`/`customertip` source tables missing from the dump; `image.description` only 47.5% populated; etc.) the move is **work around them**, not block on Swoop sourcing. Imperative is to help with the marketing-side of the chat; if a tool's "great" form depends on data we don't have, design its "good" form using what we do have. Per Julie's 26 Mar reset: "simplest GOOD thing for real users". Operational consequence: the 3 questions in [questions.md](../questions.md) "New from C.t0 inspection" stay open as nice-to-know-if-asked, **not** as blockers. Q1 ensemble walk treats the dump-as-it-is as the working palette.
- **Ground tool design in real content, not assumed content.** (Al, 2026-04-30.) Speculation about what `recall_someone_who` should retrieve, or what a `customer-story` content tag would even mean, is wasted work without first inspecting what the corpus actually contains. The blog corpus is already on disk (`data/blog/raw/<latest>/posts.ndjson`, 102 posts) and the SQL dump is in local MariaDB. **Before designing the chunk C tool surface or sales-tag taxonomy any further, inspect the actual content.** Blog posts especially — they're sales material; their value depends on what's actually in them, not what we assume. Same for `trip.description` prose and `contentblock_*` subtypes: surveying what's there lets us shape tool boundaries and content tags around real material rather than imagined material. This complements the "top-down from conversational arcs" rule above — arcs come from product intuition + meeting transcripts, but tool *bindings* come from corpus evidence.
- **All 10 tools are in scope for re-sketch**, not just the 5 new ones. (Al, 2026-04-29.) The PoC tools have value (original thinking + UI widgets) but warrant refresh under the looser frame. Walk all 10 within the ensemble — some may collapse, merge, rename, or retire.
- **Q5 closed**: `inconclusive` 4th verdict approved. (Al, 2026-04-29.) Lands in `@swoop/common/handoff.ts` (E.t1 contract extension) with per-verdict reason enum from §3.2 Path 7. No email (per E.3 disqualified pattern), 90-day retention.
- **Q4 closed**: customer-type derivation lives in the main chat agent, not a Haiku post-classifier. (Al, 2026-04-29.) Most context-aware reasoner in the loop; signal not worth a separate model call.
- **Don't treat the 7 paths as state.** Outcome shapes. Agent reasons; paths emerge.
- **PoC PROMPT_ENGINEERING.md is the authoring framework** — tool descriptions authored with WHY/HOW/WHAT × User/Agent/Swoop matrix as code-comment scratchpad above the prose.
- **Voice is authoritative-yet-approachable + candid + playful + plain-language.** "If Swoop were the guide at the refugio bar, would they speak to their customers this way?" is the test.
- **Don't over-describe negative space.** Anti-pattern lists in `cms/prompts/system/10_style-avoid.md`. Positive examples in `00_why.md`. Decoupled.
- **Trust Sonnet's reasoning** — but give it lots of context to reason from. Rich brief > prescriptive workflow.
- **Patagonia ≠ Antarctica** in three load-bearing ways: triage during discovery; group-tour strategic priority; customer-type segmentation.

---

## 6. Operational note (only if you go digging into git history)

Sub-agents in the 2026-04-28 dispatch were branched from `main`'s tip rather than the current work-branch's tip — at least one agent reasoned over outdated planning docs. Several merge commits were reverted. The git history of `claude/nervous-goodall-1fe7d6` therefore contains a chain of reverts. **Ignore the reverts and their original commits unless something specifically requires git-archaeology.** They have no bearing on current state.

When dispatching parallel agents in future sessions: verify `git log main --oneline -1` matches the work-branch's relevant tip first. If `main` lags, either promote work to `main` first OR instruct each agent to fast-forward its worktree at the start of its run.
