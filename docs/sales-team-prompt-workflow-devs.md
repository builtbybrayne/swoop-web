# Sales-team prompt-iteration loop — workflow for the assigned prompt engineer

**Status**: Active workflow doc. Lives in `docs/` because it's operational guidance for whoever owns the prompt-iteration loop, not a planning artefact in flight.
**Audience**: The assigned prompt engineer — initially the project owner during the engagement, then whichever Swoop dev inherits this loop post-handover. The role is the durable thing; the person occupying it may change.
**Replaces**: [planning/03-exec-crosscut-sales-team-prompt-curation.md — git-PR sales curation surface workstream](../planning/03-exec-crosscut-sales-team-prompt-curation.md) and its sibling [planning/03-exec-crosscut-prompts-repo-split.md — prompts repo split with agent_prompts override repo](../planning/03-exec-crosscut-prompts-repo-split.md). Both deprecated 2026-05-27 in favour of this lighter doc-based workflow plus a future sales-team-facing Claude skill. See §8.

The sister doc for the sales side is [sales-team-prompt-workflow-sales.md — what Luke, Julie, and the team read](sales-team-prompt-workflow-sales.md).

---

## 1. The prompt system architecture — where each kind of change lands

Five surfaces. Knowing which surface a request lands on is the single most useful thing the prompt engineer does upfront — it usually determines complexity within a tier.

### 1.1 System-prompt fragments

**Path**: `product/cms/prompts/system/<file>.md`
**Loaded by**: `product/orchestrator/src/agent/prompt-loader.ts` at orchestrator startup. Every file matching `^\d{2}_[a-z0-9-]+\.md$` is read, sorted lexicographically, concatenated with `\n\n---\n\n` between files, and used as the agent's `instruction`. In dev, re-reads on every request.

Currently two files:

- [00_why.md — identity, role, voice, refusals, sales context, what-must-not-do](../product/cms/prompts/system/00_why.md) (~5,700 words)
- [10_style-avoid.md — explicit anti-patterns at the style level](../product/cms/prompts/system/10_style-avoid.md)

Decision G.11 from [planning/decisions.md — the CMS folder structure + system-prompt assembly mechanism](../planning/decisions.md) is the structural commitment. Two-digit prefixes sparsely numbered so future inserts don't require renaming.

**When to edit here**: voice changes, tone, identity, hard rails, brand framing, sales-process framing, anything the agent should hold *on every turn*. Smaller-tier territory.

### 1.2 ADK skills

**Path**: `product/cms/prompts/skills/<skill-name>/SKILL.md`
**Loaded by**: ADK 1.0's `loadAllSkillsInDir` (wired in [planning/03-exec-agent-runtime-t9.md — B.t9 ADK skill-loader integration](../planning/03-exec-agent-runtime-t9.md)). Each skill is a folder; the model loads it on demand when its description matches the conversational situation.

Fourteen skills shipped today, in three loose groups:

- **Archetype skills** — `engaging-a-dreamer`, `engaging-a-planner`, `engaging-a-skeptic`, `engaging-a-browser` — posture for each of the four user archetypes from the PoC's R/W matrix.
- **Pattern skills** — `pattern-anniversary-couple`, `pattern-budget-solo-traveller`, `pattern-gauchos-and-estancias`, `pattern-overwhelmed-researcher`, `pattern-puma-photographer`, `pattern-w-vs-o-wrestler` — worked conversation patterns for recurring shapes.
- **Situational skills** — `arrived-with-ai-itinerary`, `group-tour-surfacing-for-solos`, `tailor-made-prospect-posture`, `triage-to-referral` — postures for specific situations.

**When to edit here**: a request that fits the shape *"when X kind of visitor / X kind of conversation, the agent should do Y"*. New patterns add a new skill folder; tweaks to existing patterns edit the relevant SKILL.md. Moderate-tier territory.

The frontmatter `description` is load-bearing — the model uses it to decide whether to load the skill. A small change to the description can have a large effect on when the skill fires.

### 1.3 Tool descriptions

**Path**: `product/cms/prompts/tools/<tool>/description.md` (and any sibling files specific to a tool, e.g. `post-handoff-guidance.md`)
**Loaded by**: each tool's TypeScript handler explicitly, via `readFileSync` (no auto-discovery). Wiring lands in [planning/03-exec-c-t4.md — C.t4 tool implementations](../planning/03-exec-c-t4.md) (decision C.34).

Seven tool surfaces:

- `find_inspiring` — vivid passages for visitors who are curious but not yet specific
- `find_someone_who` — customer stories for social proof
- `find_proof` — concrete trust signals (operator partnerships, hours of expertise)
- `lookup` — direct factual answers to concrete questions
- `find_options` — small set of trip cards when a visitor is ready to look at concrete shapes
- `illustrate` — image rendering for visual surface
- `handoff` / `handoff_submit` — the lead-capture pair

**When to edit here**: a request that's about *when the agent reaches for a particular tool* or *what it expects from that tool's output*. Authored using the WHY/HOW/WHAT × User/Agent/Swoop matrix from the PoC's `PROMPT_ENGINEERING.md` as scratchpad; published as prose. Usually Smaller or Moderate, occasionally Higher if it implies a new output shape.

### 1.4 Code changes (new tool, new data primitive, new ingestion path)

A meaningful subset of "prompt change" requests turn out to be code changes in disguise. **This is the Higher-tier territory — and the asymmetry the sales-side doc names.** Common shapes:

- **New tool** — the agent should be able to do something it can't currently do. Adds a folder under `product/cms/prompts/tools/<new-tool>/`, a handler at `product/connector/src/tools/<new-tool>.ts`, an MCP registration in `product/connector/src/tools/index.ts`, a Zod I/O contract in `product/ts-common/src/tools.ts`, and (usually) a UI widget under `product/ui/`. Sized in [planning/03-exec-c-t4.md — C.t4 tool implementations](../planning/03-exec-c-t4.md). **A "new outcome" in sales-doc language.**
- **New data axis** — the agent should know something about a trip / region / visitor it currently doesn't. Adds a column or table in the schema (migration), an ingestion path (ETL classifier or source-side data plumbing — see [planning/03-exec-c-t3a.md — C.t3a Haiku ETL classifiers and embedding pass](../planning/03-exec-c-t3a.md)), and a path through the relevant tool's output schema to the UI. **A "new data axis" in sales-doc language.** Contingent on Swoop's data side delivering the underlying info.
- **New widget surface** — the agent's visual channel can't currently render the shape the request needs. Sized in [planning/03-exec-d-t9.md — D.t9 chat-surface widget rewrite](../planning/03-exec-d-t9.md). **A "new outcome" in sales-doc language.**

A useful diagnostic: if the request's natural completion is *"...and then the agent reads the new data"* or *"...and then the agent produces a new kind of output"*, it's a code change masquerading as a prompt change. Size accordingly.

### 1.5 Templates and errors

**Path**: `product/cms/templates/handoff-email.md`, `product/cms/errors/en.json`
**Loaded by**: orchestrator for templates, UI for errors. Single consumer per file.

**When to edit here**: handoff email copy, UI error-state copy. Low-frequency change surface but worth knowing about. Usually Smaller.

---

## 2. The data/outcomes asymmetry — read every request against this first

**This is THE asymmetry sales-side contributors can't see from outside, and the single thing most likely to mis-size a request.** Always run this test before tier-assigning anything.

Sales-side feedback often looks easy because the contributor is describing a behaviour they can imagine clearly. *"When a visitor mentions dietary requirements, the agent should surface trips that suit them."* That sentence is one line. It sounds like a Moderate-tier pattern.

But it isn't, because **the agent doesn't know which trips suit which dietary requirements**. The behaviour the contributor described requires:

1. Swoop to capture that data per trip / per operator (currently not in the system → schema work, ingestion path).
2. The data to surface through the relevant tool (here: `find_options`) — schema extension, query plumbing.
3. The agent's instructions to teach it when to read for the signal and when to surface the filtered result.

Steps 1 and 2 are real engineering work, often days each, often contingent on Swoop's data side. Step 3 is the cheap-looking pattern the contributor wrote. The full request is **Higher-tier**, not Moderate.

The diagnostic, fast:

> Does this change ask the agent to behave differently based on signals it can already read from the conversation? → **conversational-flow**, usually cheap (Smaller / Moderate).
>
> Does this change ask the agent to know or surface something not currently in the system, or to produce a new kind of output? → **new data axis or new outcome**, usually expensive (Higher).

The contributor-facing version of this test is in the sales doc — but the prompt engineer's version is sharper because we know what's in the system. **Read every request against the current data model and tool surface before sizing.**

A second-order tell: phrasing like *"the agent should surface X when relevant"* hides the load-bearing word "relevant". If relevance is something the agent can already read from the conversation, it's conversational-flow. If relevance requires a per-trip attribute the system doesn't track, it's a new data axis. The contributor often can't see the difference; the prompt engineer must.

---

## 3. Translating sales-side feedback into implementation

The hardest part of this loop isn't writing the change. It's reading the request correctly. A few translation patterns worth holding:

### 3.1 Vague tone request → which surface?

> *"The agent should be warmer with families."*

Three possible homes, and the right one depends on the trigger:

- **System prompt §3 (voice)** — if "warmer" is a voice-level posture that should apply whenever family signals appear *anywhere* in the conversation. Cheap. Smaller-tier.
- **A new pattern skill** — if "warmer with families" means a specific set of moves (mentioning kid-friendly trails, surfacing accommodation that suits multi-generational groups, asking different qualifying questions). Moderate-tier.
- **A tool description nudge** — if the trigger is specifically *when the agent surfaces options*, families should see a different shape of option. Smaller or Moderate depending on whether existing `find_options` output already supports the variant.

Best move: write back to the contributor asking *what's the trigger* — what does the agent see that tells it the visitor's a family? Often the answer surfaces the right home.

### 3.2 Behaviour request → pattern or new data?

> *"The agent should suggest accommodation with wheelchair access when relevant."*

Looks like a behavioural change ("when X, do Y"). But the prerequisite is *knowing which accommodation has wheelchair access*. If that data isn't in `trip_card` (or whatever the downstream entity is), the prompt change is downstream of an ingestion change.

The test: can the agent already *answer* the question if asked directly via `lookup`? If yes, it's a behavioural change (Moderate). If no, it's a data axis (Higher), and the prompt-side work waits for the ingestion-side work.

### 3.3 "Stop doing X" requests

Often look like Smaller. Sometimes are Smaller (add to `10_style-avoid.md`). Sometimes hide a deeper pattern.

> *"Stop using the word 'journey' as a verb."*

Pure Smaller — add to the AI-signature-verbs list.

> *"Stop pushing the handoff so hard."*

Looks Smaller-shaped, but "so hard" is doing work. Investigate: is the handoff actually firing too early (a pattern problem)? Is the language too eager (a voice problem)? Is the threshold for readiness mis-set (a system-prompt §7 problem — the R/W reading)? The right surface depends on the diagnosis.

### 3.4 Requests with multiple homes

Some requests genuinely touch multiple surfaces. *"The agent should be more candid about Patagonia's downsides — weather, cost, difficulty — without scaring people off"* probably wants:

- A small system-prompt tweak in the Candid-and-Trustworthy pillar to make the rule explicit.
- A skill (or extension of `engaging-a-dreamer`) for visitors whose warmth is running far ahead of grounded expectation.
- A possible tool-description nudge on `find_proof` to surface honest-tradeoff content rather than only positive proof.

Don't shy away from multi-surface changes — they're often the right shape. But account for them in the sizing, and if any one surface tips into a new data axis or new outcome, the whole change is Higher.

---

## 4. Complexity assessment from the implementer side

The contributor-facing rubric in the sales doc (Smaller / Moderate / Higher) maps to implementer effort, but two patterns are worth noticing because they look small and aren't:

### 4.1 Cheap-looking that spawns work

- **"The agent should KNOW X"** — anything that involves the agent acting on information it doesn't currently have access to. Spawns ingestion + schema + tool surface. **Higher.**
- **"The agent should surface X when relevant"** — "relevant" is the load-bearing word. If the relevance is something the agent can already read from the conversation, it's a pattern (Moderate). If relevance requires a per-trip attribute the system doesn't track, it's data work (Higher).
- **"The agent should never say X"** — usually Smaller. But *"never say X *to people who are doing Y*"* is a pattern because it has a conditional trigger.
- **"The agent should be friendlier"** — voice changes touch all conversations. Cheap to write, expensive in surface area covered. Always worth a sample-conversation pass to verify the change doesn't break tone elsewhere.

### 4.2 Expensive-looking that isn't

- **"Add a new skill for X conversation pattern"** — a skill is one new folder with one SKILL.md. The substance work is the prose; the wiring is free. Often Moderate even when the contributor pitches it as Higher.
- **"Rewrite the handoff intro paragraph"** — a single paragraph in a single file. Half-day including a few sample conversations. Smaller.
- **"Add a new banned phrase to the style-avoid list"** — Smaller even if the contributor flags it as a big concern.

### 4.3 The data-vs-pattern test (recap)

The simplest diagnostic at triage time — repeated from §2 because it's the most-used:

> Does this change ask the agent to behave differently based on signals it can already read from the conversation? → pattern (Smaller / Moderate)
>
> Does this change ask the agent to know or surface something not currently in the system, or to produce a new kind of output? → data axis or new outcome (Higher)

---

## 5. Pushing back on under-specified requests

Most requests arrive under-specified. The good move is to ask for the missing concrete signal, not to guess. A small script:

> *"To size this and ship it cleanly I need one more thing — a concrete visitor prompt that should trigger the new behaviour. Either one you saw recently or one you can clearly imagine. Reason: the agent reads triggers from what the visitor says, so 'when X happens' needs to be expressible as 'when the visitor says or implies Y'. Without that, I'll likely ship something that fires too often, too rarely, or on the wrong signal."*

Variations by request shape:

- **Vague tone request** — *"What does the visitor say that signals to you we should sound warmer? Once I know the signal I can teach the agent to read it."*
- **Behaviour change without a clear scope** — *"Should this fire on every conversation, or only when [obvious subset]? I want to be honest about how big the surface is before scoping."*
- **'Make the agent X' where X is a brand/voice dial** — *"This one touches the brand voice. Worth a quick call before I write anything — happy to scope on a 20-min walk-through."*
- **Looks-like-a-pattern-but-actually-data** — *"Quick check before I size this: does the agent currently know [the relevant attribute]? If not, this is downstream of a data-side change in Swoop's system — happy to scope what that looks like, but it shifts the timeline."*

Push back without friction by framing it as helping ship the right thing, not as gatekeeping. The contributor isn't a feature requester; they're a customer-facing operator with signal the prompt engineer doesn't have. The job is to convert that signal into the right shape of change.

**Don't push back on**: requests where the right move is a Smaller, where the contributor is just asking for one specific word to change, or where the diagnosis is clear from the request alone. Ship cleanly when the request is well-formed.

---

## 6. Workflow operations

### 6.1 Triage cadence

Currently weekly. Aim is to read every new entry within seven days of it landing. Beyond that, contributors lose confidence the doc is being read.

At triage time, each entry gets one of four outcomes (these mirror what the sales doc tells contributors to expect):

1. **Ship-this-batch** — bundled into the next prompt-iteration drop. Notes back to the doc: *"shipping in batch of [date]"*.
2. **Scheduled** — sized, planned into a sprint. Note back: *"sized as [Smaller/Moderate/Higher], scheduled week of [X]"*.
3. **Parked-pending-conversation** — design-decision items, multi-surface requests, things where the trigger isn't clear, anything touching a brand dial or the Discover/Propose boundary. Note back: *"need [specific thing] before I can scope — happy to chat"*.
4. **Closed-with-note** — already shipped, superseded, or talked-out. Note back: *"shipped 2026-X-X under [tag]"* or *"superseded by [X]"* or *"talked out, see [conversation reference]"*.

The four outcomes match the sales-doc's promise to contributors. If a new outcome category appears in practice (e.g. *"sent back for rewrite"*), update the sales doc too — keep the promise honest.

### 6.2 Batching changes

System-prompt tweaks (Smaller tier) batch well. Ship 3–10 in a single drop. Skill changes batch less well — each new skill is a self-contained piece of authored prose and benefits from being read against the agent's existing skills as a coherent set.

Tool description changes are rare and usually one-off — they ship singly.

Higher-tier work (new tools, new data axes, new widgets) follows the project's [worktree-vs-main policy](../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/feedback_worktree_vs_main.md) — autonomous/parallel work in a worktree, HITL on main. Don't merge speculatively.

### 6.3 Communicating back

The Google Doc is the canonical channel. Notes back on the doc itself, in-line under the relevant entry, so contributors see the response next to their request rather than in email.

For shipped changes, a one-line release note appended to a `prompt-changelog.md` (TBD — currently the change log is the git log) lets contributors see *what landed when* without having to track individual entries.

For parked items, the note explains *exactly what's needed to unpark*. "Need more concrete trigger" is too vague — "need a visitor prompt that should fire this new behaviour" is the right level of specificity.

### 6.4 Voice and tone in notes back

Match the contributor's register. Luke (CEO, short comms): short reply, no preamble. Julie (production-focused): one extra line about what the trade-off looks like. The doc itself is the artefact of the conversation — make it useful to read back in three months.

### 6.5 Coordinating with the future sales-team Claude skill

A sales-team-facing Claude skill is on the roadmap (TBD timing — see the sales doc's *Future: a Claude skill to help write good feedback* section). It'll help contributors shape requests **before** they land in the Google Doc, asking the questions the prompt engineer would ask. Implications for the prompt engineer:

> **2026-06-16 — related but distinct workstream.** A separate capability now covers the *knowledge* slice — facts the agent should hold (e.g. seasonality) — via **inline** sales-authored agent memory: an authed staff member tells the live agent *"remember…"* and it persists to a Postgres store loaded into every conversation. Planned in [planning/02-impl-sales-memory.md](../planning/02-impl-sales-memory.md) (DRAFT, `sm-*` decisions). Keep **this** Google-Doc loop for *behaviour / voice* requests; the memory mechanism owns *knowledge facts*. The two are likely to converge later in how they elicit and curate, but they are not the same surface.

- **Requests will arrive better-shaped.** Trigger and visitor-signal more often present; sizing less often required from scratch.
- **The skill's elicitation pattern is downstream of this doc.** When the skill is authored, its question set should mirror the data-vs-pattern test in §2 and the pushback scripts in §5. Keep this doc the canonical source for *what good shaping looks like*; the skill is the interactive packaging.
- **Don't pre-empt the skill's authoring** — it lands when sales-side volume and shape signal it's worth the build. Until then, the Google Doc + this workflow does the work.

---

## 7. References

- [planning/03-exec-c-t4.md — C.t4 tool implementations](../planning/03-exec-c-t4.md) — current state of the tool surface. Read before editing any `prompts/tools/<tool>/description.md`.
- [planning/03-exec-d-t9.md — D.t9 chat-surface widget rewrite](../planning/03-exec-d-t9.md) — UI widget surface. Read before sizing requests that ask for a new visual shape.
- [planning/03-exec-agent-runtime-t1a.md — B.t1a multi-file system-prompt loader](../planning/03-exec-agent-runtime-t1a.md) — loader contract for system-prompt fragments. The reason the `^\d{2}_*.md$` filename pattern matters.
- [planning/03-exec-agent-runtime-t9.md — B.t9 ADK skill-loader integration](../planning/03-exec-agent-runtime-t9.md) — how skills are picked up at runtime.
- [planning/03-exec-c-t3a.md — C.t3a Haiku ETL classifiers + embedding pass](../planning/03-exec-c-t3a.md) — the ingestion path any new-data-axis request will eventually touch.
- [product/cms/README.md — content-as-data load contracts](../product/cms/README.md) — the layout doc; required reading for any new content surface.
- [planning/decisions.md — decision G.11: CMS folder structure + system-prompt assembly mechanism](../planning/decisions.md) — structural commitment.
- [planning/00-discovery-design-thinking.md — joint design thinking for tools + system prompt + skills](../planning/00-discovery-design-thinking.md) — the conceptual frame the agent's behaviour emerges from. Read before any change that touches the agent's job or the boundary of Discover.

---

## 8. Why this replaces the curation workstream

The original plan ([commit 058f26f — Tier 3 plans for sales-team prompt curation + agent_prompts override repo, 2026-05-22](../planning/03-exec-crosscut-sales-team-prompt-curation.md) and its dependency [03-exec-crosscut-prompts-repo-split.md — the prompts override repo split](../planning/03-exec-crosscut-prompts-repo-split.md)) shipped two Tier 3 crosscut plans totalling ~3.25–4.75 days of contingency-tier engineering work:

- A second repo (`agent_prompts`) with multi-project layout and per-folder override semantics
- A bootstrap-clone pattern wiring `prompt-defaults/` + `prompt-overrides/` together at runtime
- A two-PAT per-person model for sales-team git access
- A *Swoop Prompt Curator* Claude skill that ran in each contributor's Cowork-hosted Claude, eliciting Why/How/What and opening PRs against the override repo
- A GitHub Action that notified a reviewer
- An end-to-end M5 demo where Luke landed a PR live

The 2026-05-27 reframe from the project owner: the underlying bottleneck is contributors not being able to size their own requests, and the git-PR workflow is unlikely to fit non-technical contributors' working pattern. A workflow doc closes the sizing gap directly — the rubric in the sales doc lets contributors self-size, and this implementer-side doc sharpens the triage loop. A future sales-team-facing Claude skill will pick up the interactive-shaping role the Curator was sketched for, without the git-PR machinery underneath.

What's preserved from the curation plan:

- The Why/How/What golden-circle structure — repurposed as a request-writing prompt for contributors, not as a Curator-driven elicitation against a PR.
- The acknowledgement that some requests should be talked-out, not shipped — folded into the *Closed-with-note* and *Parked* triage outcomes.
- The recognition that sales-side and dev-side need shared language about what makes a change cheap vs expensive — folded into the rubric and the data-vs-pattern test.

What's dropped:

- The override repo and two-repo split — the system stays single-repo. If sales-team write access becomes a real need later, the override repo can be revisited.
- The Curator Claude skill **as designed** (git-PR-opening, two-PAT, self-checking) — replaced by the future, lighter sales-team-facing skill described in §6.5.
- The GitHub Action notifying a reviewer — the prompt engineer triages the Google Doc on cadence.
- The M5 live-PR demo — replaced by a working session against the rubric.

Net: same outcome (better-shaped prompt-change requests, faster cycle time), substantially lower infrastructure burden, no new auth surfaces, no new repos.
