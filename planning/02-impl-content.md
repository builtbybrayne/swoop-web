# 02 — Implementation: G. Content

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4G + theme 2 (content-as-data) + theme 3 (prompt architecture empirical).
**Depends on**: A (foundations — `ts-common` content schema stubs, `product/cms/` location agreed). Not on B/C/D — content drafting runs parallel from day 1.
**Coordinates with**: B (agent runtime loads the system prompt), E (handoff uses the email template).

---

## Purpose

G authors the content that gives Puma its Swoop-ness. The system prompt, the handoff email template, and placeholder trip / tour / region content sufficient for the Phase 1 vertical slice. It's the chunk that makes the difference between "a chat that works" and "a chat that sounds like Swoop".

This chunk is **taste-driven**. The mechanics of loading content at runtime live in chunks A (schema contracts) and B (prompt loader). G is almost entirely prose: reading Emma's Antarctica sales corpus + Luke's + Lane's forthcoming Patagonia sales-thinking doc, and producing Patagonia-voiced equivalents.

Al authors. Claude Code agents can draft from source material and iterate against critique, but final voice passes are Al's — the same way a ghostwriter drafts and the author edits. This chunk is also the one most likely to iterate post-launch: real user conversations are the fastest path to prompt tuning.

---

## 1. Outcomes

When this chunk is done:

- **A worked-through Patagonia conversational flow exists**, mapped out collaboratively with Al in a HITL session (see §2.5). Output is a narrative spec under `planning/` that names the triage inflections, user-type differentiation, psych-profile signals, budget-reading cues, motivation anchors, and handoff triggers Puma's agent needs to be aware of. This spec informs everything else in G.
- A single WHY system prompt exists at `product/cms/prompts/why.md`, Patagonia-voiced, covering brand voice, refusals, triage posture, group-tour bias, handoff intent. Loaded verbatim by chunk B's orchestrator.
- **Modular guidance ("skills") scaffolded** at `product/cms/skills/` — at least two seeded entries drawn from the HITL flow-mapping session, covering known-important inflection points (candidates in §2.6). Loader mechanism lives in chunk B (B.t9); chunk G authors the content.
- A handoff email template exists at `product/cms/templates/handoff-email.md`, triage-aware (different tone per verdict).
- Placeholder content exists for the M1 vertical slice: 2–3 trips, 1–2 tours (group-tour-focused, per Luke's strategic bias), a handful of regions, maybe one or two "inspiration" stories. Schema-valid against `ts-common`. Invented detail is fine at M1 — real content lands in chunk C.
- All content authored lives under `product/cms/` in markdown or JSON. Zero content inlined in TypeScript.
- The system prompt is short enough to be read in one sitting, long enough to carry the brand. Length target: 1500–3000 words.

**Not outcomes of this chunk**:
- A full skills library covering every possible inflection. Puma ships with ~2 seeded skills; the library grows post-launch informed by real conversations.
- Per-trip sales overlays, per-region narrative variants, or any per-session *content* composition (deferred — distinct from skills, which are *guidance* composition).
- Real Patagonia trip data (that's chunk C).
- Production-ready content finalised (see §8 — some content is blocked on Luke + Lane's sales-thinking doc; placeholders carry M1–M2).
- A sales-team-owned skill-editing UI (deferred; Al edits during Puma).

---

## 2. Target functionalities

### 2.1 The WHY system prompt

A single markdown file — not JSON, not chunks. Authored to be read like a brief to a new sales hire, not a machine configuration.

Structure (draft — refine during Tier 3):
- **Brand voice**: warm, adventurous, expert, human. "Knowledgeable friend who's been to Patagonia", not an FAQ bot.
- **Role**: imagination-stoking discovery agent. The tool helps visitors explore and build confidence to speak with a specialist. It does not build itineraries, quote prices, or book.
- **Refusals**: no itinerary construction (Julie's explicit 20 Apr concern), no authoritative pricing, no availability guarantees, no medical/legal/safety promises.
- **Triage posture**: Patagonia-specific. Polite redirection for backpacker-tier or <$1k-profit fits. Never rude, never exclusionary. Group tours are strategic — surface them proactively; solo travellers are strong group candidates (Luke, 20 Apr).
- **Handoff intent**: end the conversation with a warm handoff when the visitor is ready — persona + wishlist + motivation captured in the handoff payload.
- **What the agent talks like**: a couple of illustrative paragraphs as the positive-example anchor (show, don't tell for what *good* looks like) **paired with an explicit anti-pattern list for what good does not look like** (see §2.1a). Both are load-bearing — the positive paragraphs carry voice; the anti-pattern list suppresses the AI-assistant defaults that would otherwise bleed through every turn.

### 2.1a Style control: anti-patterns and signature-phrase suppression

Default LLM output carries tells the instant the visitor reads it: em-dash-heavy prose, corporate hedging, openers like "Let me help you with that!" or "I'd be happy to…", "it's worth noting that", "delve into", "dive into", "unpack", "navigate the complexities", unnecessary parentheticals, em-dash+comma sandwiches, and friendly-but-empty affirmations ("Great question!"). None of this reads like "knowledgeable friend who's been to Patagonia". All of it reads like a chatbot. Swoop's production bar (Julie's 26 Mar reset) rules it out.

The WHY prompt alone is not enough to suppress it — Claude honours stylistic instructions but regresses toward defaults under load (long conversation, complex tool orchestration, strong lean on the visitor's own phrasing). Puma's approach is two-layer:

1. **A positive-example block** inside `cms/prompts/why.md` — two or three paragraphs of the agent speaking as we want it to, including punctuation and rhythm. Show, don't tell. Drafted by Al; iterated.
2. **An explicit avoidance block** at `cms/prompts/style-avoid.md` (new file, referenced from `why.md`). Enumerates the specific patterns to avoid, with short rationale so Claude isn't just pattern-matching. Living document — new tells surface in real conversations and get added.

Starter avoidance list (Al refines during G.t1):
- **Em-dashes** used as mid-sentence pause — use commas, semicolons, or a full stop instead. Em-dash-as-parenthetical allowed sparingly; em-dash-as-rhythm-crutch banned.
- **Openers** like "Let me help you with that", "I'd be happy to", "Sure!" — open with substance, not warmth-performance.
- **Corporate hedging**: "it's worth noting", "that said", "generally speaking", "in many cases" when not actually modulating claim confidence.
- **AI-signature verbs**: "delve", "dive into", "unpack", "navigate" (metaphorical), "journey" (verb).
- **Empty affirmations** before the real answer ("Great question!", "That's a really interesting point").
- **Trailing offers**: "Let me know if you'd like to explore…" appended to every response.
- **Excessive enumeration**: bullet lists where a sentence would do; numbered sub-points where context is conversational.
- **Parenthetical-heavy sentences** where the parenthetical adds nothing substantive.

Reference inputs Al can draw from:
- Alastair's own `alastair-writing-style` skill (his personal voice conventions — informs the human tell-me-how-to-write-this layer).
- Swoop's `chatgpt_poc/sales docs/extracted/tone-of-voicedecember-2025-for-presenting.md` — brand voice.
- Real LLM outputs from the running Puma chat — as soon as real conversations exist, grep for offenders + add.

Production loop: post-launch, conversations accumulate in chunk F's event log. Tells that slip through get logged as style-regression patterns and roll into the next `style-avoid.md` revision. This is the single most likely piece of `cms/` content to iterate frequently.

### 2.2 Handoff email template

Markdown template with variable placeholders resolved against the handoff payload (from `ts-common`). Three verdict paths, same template:
- `qualified` — warm summary to sales, emphasising the specialist will pick up the thread.
- `referred_out` — redirect to an appropriate partner or a general Swoop page; polite closure.
- `disqualified` — silent close (no email) or an opt-in soft-bounce. Exact behaviour decided with chunk E.

The template is authored so a sales team member can read it and believe it — it quotes the visitor's own language, surfaces the motivation, and names the handoff as the visitor's next best step.

### 2.3 Placeholder content for M1

Enough substance to demonstrate the vertical slice. Shape:
- 2–3 sample Patagonia trips (could be real Swoop trips dressed as placeholders, or invented; schema must be valid).
- 1–2 sample group tours (Tour domain type — see chunk A §2.2).
- 3–5 regions (Torres del Paine; El Chaltén / Fitz Roy; Carretera Austral; Puerto Natales base; Tierra del Fuego). Enough for a demo answer to "where should I go?".
- 2–3 "inspiration" stories (the blog-style narrative content — glacier trekking, puma photography, W-trail recap).

This is throwaway — chunk C replaces it with scraped or API-sourced real content. But it must validate against `ts-common` schemas so chunk B's vertical slice can exercise the tool layer.

### 2.4 Content location

`product/cms/` — carrying forward the PoC's content-as-data convention. Proposed layout (Tier 3 finalises):
```
product/cms/
├── prompts/
│   ├── why.md
│   └── style-avoid.md        # G.10 — explicit anti-pattern list; referenced from why.md
├── skills/
│   ├── tailor-made-prospect.md     # example seed — name TBD in G.t0
│   └── group-tour-for-solo.md      # example seed — name TBD in G.t0
├── templates/
│   └── handoff-email.md
└── fixtures/
    ├── trips/
    ├── tours/
    ├── regions/
    └── stories/
```

### 2.5 Conversational flow mapping (HITL with Al)

Before the WHY system prompt can be drafted with confidence — and before the skills library has coherent seeds — Puma needs a worked-through picture of the Patagonia conversational flow. This picks up from the PoC's enrichment / workflow work (`chatgpt_poc/planning/enrichment_model.md`, `chatgpt_poc/planning/conversational_workflows_plan.md`) but extends it with Patagonia-specific nuances Luke surfaced on 20 Apr:

- **Triage inflections**: how the agent distinguishes Group Tourer / Tailor-Made / Independent / Backpacker-exclude early enough to shape the rest of the conversation, but gently enough to not feel like a sorting hat.
- **User-type differentiation**: solo travellers as group-tour candidates; luxury-lodge prospects vs W-trail hikers; post-retirement trip-of-a-lifetime framing vs bucket-list travellers; puma-photography motivators vs multi-day trekker motivators.
- **Budget-dimension reading**: how the agent infers budget band without asking directly, and adjusts between group tours and luxury lodges.
- **Motivation anchoring**: puma photography, W trail, glaciers, bragging-rights lodges — the "why" everything else hangs off. Per Luke, anchoring to motivation is load-bearing.
- **Handoff signals**: when the agent's conviction tips into the handoff flow vs. keeps discovery going.
- **Season / inventory constraints**: December–February luxury lodge scarcity; the 6–12 month booking lead time Luke flagged.

**This work cannot be "just done" by Claude alone.** It's HITL — Al and Claude working through it together, iteratively. The output is a Patagonia conversational-architecture spec, analogous to the PoC's enrichment and workflow docs, that directly feeds the WHY prompt (§2.1), the skills library (§2.6), and the behavioural eval harness (chunk H).

**A dedicated HITL working session is a prerequisite** for G.t1 (prompt first pass) and G.t3 (seed skills) closing. Early drafting can proceed on PoC-sourced placeholders in parallel; finishing requires the mapping.

### 2.6 Modular guidance ("skills")

The WHY system prompt is load-bearing but not infinitely expandable. Some guidance only makes sense when applied in specific contexts — e.g. once the agent has identified a visitor as a high-budget tailor-made prospect, the posture shifts in ways not worth pre-loading for every conversation. Same for psych-profile signals (status-seeking vs bucket-listing), triage states, and season-specific constraints (December lodge shortage).

Modular guidance — "skills" in loose terms — is how Puma accommodates this. A library of small guidance snippets that the agent can load when specific triggers fire. Whether "skills" here means Claude Agent SDK's `SKILL.md` convention, ADK's skill primitive (if it has one), or a bespoke tool that fetches relevant snippets is a chunk B mechanism decision (B.t9) — this chunk authors the content regardless of loading mechanism.

**Puma launch scope**:
- Library scaffolded (directory exists, loader wired via chunk B).
- **At least two seeded skills** drawn from the HITL flow-mapping session (§2.5). Likely candidates, subject to what comes out of the mapping:
  - Tailor-made prospect posture (once visitor signals high budget + independence)
  - Group-tour surfacing for solo travellers (Luke's strategic priority)
  - Triage-to-referral polite redirect (for low-fit or low-profit cases)
- Skills live under `product/cms/skills/` as markdown. Content-as-data. Authorable by non-engineers.

**Not in scope for Puma**:
- A full library covering every known inflection — the library grows post-launch.
- Sales-team-owned editing UI for skills — deferred to post-Puma CMS work.

This chunk **commits to**:
1. Mapping out which inflections are load-bearing (§2.5 output).
2. Authoring the seed skills.
3. Structuring skills so chunk B's loader can read them cleanly (schema agreed with B during Tier 3).

This chunk **does not decide**:
- The loading mechanism (chunk B, B.t9).
- Which specific two skills seed Puma — falls out of the HITL mapping session.

---

## 3. Architectural principles applied here

- **Content-as-data** (theme 2, firmly): every artefact this chunk produces is markdown or JSON, loaded at runtime by code in other chunks. No exceptions. This is a placeholder for a real CMS maintained by Swoop's sales staff post-Puma.
- **PoC-first**: distil and adapt Antarctica material — don't rewrite from a blank page. The brand voice and sales methodology are not Puma-specific; Patagonia-specific details are.
- **Prompt architecture empirical, but we plant flags early** (theme 3, refined in Tier 2): the WHY system prompt is the default mechanism; modular guidance (§2.6) is **additive from day one** for known inflection points (triage, user-type, psych-profile) rather than deferred to "once real conversations prove need". Refusing to pre-build any inflection mechanism would leave the agent blunt at launch. Start minimal (WHY + ~2 seeded skills), iterate from real data.
- **Triage-aware** (theme 10): the system prompt carries the triage posture; specific triage skills refine it per user-type; the handoff template encodes the three verdicts.
- **HITL authorship** (new): the conversational flow mapping and the final voice pass on the system prompt are Al-authored, not Claude-authored. Claude Code agents draft from source material and iterate against critique; Al is the editor.

---

## 4. PoC carry-forward pointers

Path-level only.

Source material (what to distil):
- `chatgpt_poc/product/cms/guidance-payload.json` — `aboutSwoop`, `salesMethodology`, `toneOfVoice`, `brandPillars`, `howToUseThisGuidance`, `dimensionsFramework`, `readinessWarmthModel`, `handoffTriggers`, `constraints`, `affordabilityGuidance`, `domainSummaries`. The Antarctica-facing version of everything this chunk needs a Patagonia-facing version of.
- `chatgpt_poc/sales docs/extracted/sales-process.md` — Emma's sales process. The conversational posture to carry across.
- `chatgpt_poc/sales docs/extracted/the-brand-platform-toolkit---oct-14th-sales.md` — brand platform. Swoop's self-described identity; largely portable.
- `chatgpt_poc/sales docs/extracted/tone-of-voicedecember-2025-for-presenting.md` — tone of voice guide. Directly applicable.
- `chatgpt_poc/sales docs/extracted/why-swoop---elevator-pitch-training-ant.md`, `why-swoop-emails.md` — the Antarctica elevator pitch and email samples. Structure portable; content needs Patagonia equivalents.
- `chatgpt_poc/product/cms/PROMPT_ENGINEERING.md` — the WHY/HOW/WHAT × User/Agent/Swoop rationale document. Read once for context; don't treat as scripture (see theme 3).

Patagonia-specific inputs (coming):
- Luke + Lane's Patagonia sales-thinking doc (1–2 weeks from 20 Apr — tracked in `questions.md`).
- Luke's Patagonia strategy document (group-tours future, customer types, three strategic threads). Owed from 20 Apr.
- Julie's cleaned raw customer age / inquiry data (personas in development).

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| G.1 | Content root location | **`product/cms/`** | Carries forward PoC convention. Zero new structure. Chunk A scaffolds the directory; this chunk populates it. |
| G.2 | Prompt format | **Markdown, single file for the WHY layer.** | Authorable by non-engineers; readable as a brief rather than a configuration. JSON-blob approach from PoC is over-structured for our needs now. |
| G.3 | Prompt composition in Puma | **Static WHY system prompt + modular-guidance library (skills) with ≥2 seeded entries.** | The pure-static approach was too spare given the known Patagonia inflections (triage, user-type, psych-profile). Modular guidance lets the agent access context-triggered posture without committing to per-turn fragment composition or a stance classifier. Mechanism lives in chunk B (B.t9); content lives here. |
| G.4 | Handoff email template | **Single markdown template with verdict branching via handoff-payload fields.** | Simplest consistent model. Three fully distinct templates is over-engineering at M3 scale. |
| G.5 | Placeholder content fidelity | **Schema-valid, narratively plausible, invented detail acceptable.** | M1 is a vertical slice demo — the content serves the architecture check, not the user. Chunk C replaces it. |
| G.6 | Language | **English only.** | Top-level out-of-scope for Puma. |
| G.7 | Tone authorship authority | **Al owns voice. Claude Code agents draft and iterate against critique; final pass is Al's.** | Taste-driven. Agents are good at distilling source material; Al is the editor. |

Deferred — not closed here:
- Per-trip `salesTalkingPoints` overlays (deferred to post-Puma).
- Per-region narrative variants (deferred).
- A sales-team-owned prompt / skill editing UI (deferred; Puma manual edits by Al).
- Prompt versioning / rollback tooling (deferred; git history suffices).

Added in this revision:

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| G.8 | Conversational flow mapping | **Dedicated HITL working session with Al required** before G.t1 (prompt drafting) and G.t3 (seed skills) close. Output is a Patagonia conversational-architecture spec under `planning/`. | Taste-driven and Patagonia-specific. Only Al (reading 20 Apr meeting + Luke's strategy doc + Luke/Lane's sales-thinking doc) can steer the inflections correctly. Claude Code drafts from source material; Al edits. |
| G.9 | Skill schema / loader contract | **Coordinated with chunk B (B.t9)** during Tier 3. Default: markdown files with frontmatter (trigger metadata) + body (guidance content), loaded via a tool call from the orchestrator. | The mechanism (B) and the content (G) have to agree on the file shape. B.t9 and G.t3 cross-coordinate through `ts-common` skill metadata schema. |
| G.10 | Style control authoring | **Two-layer: positive-example paragraphs inside `cms/prompts/why.md` + explicit avoidance list at `cms/prompts/style-avoid.md`.** Referenced from the WHY prompt. Living doc — updated as real-conversation telltales surface. | Prompt-only voice guidance regresses toward Claude's defaults under load. Positive examples anchor the "good" direction; explicit anti-patterns suppress the specific AI-slop tells (em-dash cringe, "Let me help", "delve into", empty affirmations) that bleed through otherwise. Separating the two files keeps the positive voice pass (taste-driven, Al-authored once) decoupled from the avoidance list (pattern-driven, updates whenever real output reveals a new offender). See §2.1a. |

---

## 6. Shared contracts consumed

From `ts-common` (stubbed during chunk A):
- **Content schemas** — `Trip`, `Tour` (group tour), `Region`, `Story`, `Image`. Placeholder fixtures in `product/cms/fixtures/` validate against these.
- **Handoff payload shape** — the email template resolves against an instance of this.

This chunk **does not** author new contracts — it only produces content that respects contracts authored elsewhere.

---

## 7. Open sub-questions for Tier 3

- Exact WHY prompt section order and headings (to be refined via live testing in Phase 1).
- Whether the handoff email template supports one-shot rendering (Markdown → email HTML at send time) or pre-rendered variants.
- Whether placeholder "stories" are loaded by a tool (`illustrate` equivalent) or embedded in regions.
- Localisation-ready content structure (out of scope in behaviour but possibly in structure — stretch only if trivial).
- Content review-and-approval workflow when Luke + Lane's doc lands.
- Whether to keep Antarctica's PoC content accessible behind a region-switch for reference, or cleanly delete it from Puma's cms.

---

## 8. Dependencies + coordination

- **Inbound (drafting-phase dependencies)**:
  - **HITL conversational flow mapping session with Al** (§2.5). Blocks finished state of G.t1 and G.t3. Schedule early — before Phase 1 vertical slice lands, ideally during the Phase 0 contract work window.
  - Patagonia sales-thinking doc from Luke + Lane. Expected ~May 4. Drafts can proceed on PoC-distilled + Antarctica-voiced placeholders in the meantime; refined pass happens when the doc lands.
  - Patagonia strategy document from Luke (group-tours future, customer types). Informs strategic bias in the prompt and triage skills.
  - Cleaned customer / inquiry data from Julie (personas). Informs the audiences the prompt speaks to.

- **Inbound (wiring dependencies)**:
  - Chunk A's `product/cms/` directory scaffolded and loadable (with `skills/` subdir).
  - Chunk B's system-prompt loader wiring (the prompt file exists before B loads it — this chunk delivers the file).
  - Chunk B's modular-guidance loader (B.t9) and the skill schema agreed between B and G during Tier 3.
  - Chunk E's handoff payload finalised (the email template depends on its shape).

- **Outbound**:
  - B consumes `cms/prompts/why.md` at startup.
  - E consumes `cms/templates/handoff-email.md` when producing handoff emails.
  - C's M1 stub can load placeholder trip/tour/region content from `cms/fixtures/`.

- **Agent coordination**: this chunk is solo (Al-authored). Claude Code agents can be spawned for:
  - Drafting a first-pass system prompt from the PoC source material.
  - Drafting the handoff email template from the PoC mailer's sample emails.
  - Generating schema-valid placeholder trips / tours / regions for M1.
  - Iterating against specific critique ("tighten the triage posture paragraph", "rewrite the group-tour surfacing section with less salesy language").

---

## 9. Verification

Chunk G is done when:

1. `product/cms/prompts/why.md` exists and reads cleanly end-to-end. A non-Swoop reader can understand what the agent is for, and what it refuses to do, after one read.
2. Chunk B's orchestrator loads `why.md` at startup and agent behaviour reflects its contents (e.g. refuses itinerary requests; surfaces group tours proactively for solo traveller scenarios).
3. `product/cms/templates/handoff-email.md` exists, renders cleanly against a sample handoff payload, and produces something the sales team would actually want to receive.
4. Placeholder trip / tour / region / story content validates against `ts-common` schemas (Zod round-trip clean).
5. Chunk H's behavioural eval harness can run its M1 cases against the prompt + placeholder content and produce meaningful pass/fail.
6. Zero inlined content in the TypeScript codebase — `grep -r "welcome to swoop\|knowledgeable friend\|patagonia" product/ --include='*.ts'` returns nothing outside comments.

---

## 10. Order of execution (Tier 3 hand-off)

Natural split:

- **G.t0 — HITL conversational flow mapping session with Al**: worked-through Patagonia conversational architecture — triage inflections, user-type differentiation, psych-profile signals, motivation anchors, handoff triggers, season/inventory constraints. Output: Patagonia conversational-architecture spec at `planning/patagonia-conversational-architecture.md` (name TBD). Directly informs G.t1, G.t3, and chunk H's eval scenarios.
- **G.t1 — WHY prompt first pass**: Al-directed, Claude-drafted from PoC source material + G.t0 spec. Antarctica-voiced placeholder for specifics Luke/Lane's doc will refine. Length target, structure, refusals, triage posture, group-tour bias, handoff intent all land in this pass.
- **G.t2 — Handoff email template**: drafted from the PoC's mailer samples; verdict-branching via handoff payload fields.
- **G.t3 — Seed skills**: ≥2 modular-guidance files drawn from G.t0 inflections. Schema agreed with chunk B's B.t9 (skill loader). Content is Al-edited, Claude-drafted.
- **G.t4 — Placeholder Patagonia content**: 2–3 trips, 1–2 tours, 3–5 regions, 2–3 stories. Schema-valid. Invented where real detail isn't available.
- **G.t5 — Post-sales-doc refinement pass**: when Luke + Lane's doc lands, rework Patagonia-specific sections of the WHY prompt; iterate seed skills; refresh placeholder content if clearly wrong; re-run behavioural evals.
- **G.t6 — Ongoing tuning (post-launch)**: iterate WHY prompt + expand skill library based on real conversation logs. Not strictly a G task — more "how G evolves once real data arrives".

Ordering: **G.t0 is a prerequisite** for the finished form of G.t1 and G.t3 (drafts can start in parallel on PoC material; closing requires the mapping). G.t2 and G.t4 don't depend on G.t0 — they can proceed earlier.

Parallelism: G.t0–G.t4 run parallel to all code chunks from day 1 (per top-level §5). G.t5 blocks on external input (~May 4). G.t6 is continuous.

Estimated: 0.5 day for G.t0 (HITL session); 1–1.5 days for G.t1 + G.t3 drafting + iteration; 0.5 day each for G.t2 and G.t4; further 0.5 day for G.t5 when the sales doc arrives. Total: ~3–4 days of content work spread across the Puma window.
