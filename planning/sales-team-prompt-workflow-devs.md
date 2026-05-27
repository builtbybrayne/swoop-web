# Sales-team prompt-iteration loop — dev workflow

**Status**: Active workflow doc. Lives in `planning/` because it's operational guidance for whoever owns the prompt-iteration loop, not a planning artefact in flight.
**Audience**: Alastair (current); future Swoop dev who inherits this loop.
**Replaces**: [03-exec-crosscut-sales-team-prompt-curation.md — the sales-team prompt curation surface workstream](03-exec-crosscut-sales-team-prompt-curation.md) and its sibling [03-exec-crosscut-prompts-repo-split.md — the prompts repo split](03-exec-crosscut-prompts-repo-split.md). Both superseded 2026-05-27 in favour of this lighter, doc-based workflow. See §7.

The sister doc for the sales side is [sales-team-prompt-workflow-sales.md — what Luke and Julie read](sales-team-prompt-workflow-sales.md).

---

## 1. The prompt system architecture — where each kind of change lands

Five surfaces. Knowing which surface a request lands on is the single most useful thing the implementer does upfront — it usually determines complexity within a tier.

### 1.1 System-prompt fragments

**Path**: `product/cms/prompts/system/<file>.md`
**Loaded by**: `product/orchestrator/src/agent/prompt-loader.ts` at orchestrator startup. Every file matching `^\d{2}_[a-z0-9-]+\.md$` is read, sorted lexicographically, concatenated with `\n\n---\n\n` between files, and used as the agent's `instruction`. In dev, re-reads on every request.

Currently two files:

- [00_why.md — identity, role, voice, refusals, sales context, what-must-not-do](../product/cms/prompts/system/00_why.md) (~5,700 words)
- [10_style-avoid.md — explicit anti-patterns at the style level](../product/cms/prompts/system/10_style-avoid.md)

Decision G.11 from [planning/decisions.md — the CMS folder structure + system-prompt assembly mechanism](decisions.md) is the structural commitment. Two-digit prefixes sparsely numbered so future inserts don't require renaming.

**When to edit here**: voice changes, tone, identity, hard rails, brand framing, sales-process framing, anything the agent should hold *on every turn*.

### 1.2 ADK skills

**Path**: `product/cms/prompts/skills/<skill-name>/SKILL.md`
**Loaded by**: ADK 1.0's `loadAllSkillsInDir` (wired in [03-exec-agent-runtime-t9.md — B.t9 ADK skill-loader integration](03-exec-agent-runtime-t9.md)). Each skill is a folder; the model loads it on demand when its description matches the conversational situation.

Fourteen skills shipped today, in three loose groups:

- **Archetype skills** — `engaging-a-dreamer`, `engaging-a-planner`, `engaging-a-skeptic`, `engaging-a-browser` — posture for each of the four user archetypes from the PoC's R/W matrix.
- **Pattern skills** — `pattern-anniversary-couple`, `pattern-budget-solo-traveller`, `pattern-gauchos-and-estancias`, `pattern-overwhelmed-researcher`, `pattern-puma-photographer`, `pattern-w-vs-o-wrestler` — worked conversation patterns for recurring shapes.
- **Situational skills** — `arrived-with-ai-itinerary`, `group-tour-surfacing-for-solos`, `tailor-made-prospect-posture`, `triage-to-referral` — postures for specific situations.

**When to edit here**: a request that fits the shape *"when X kind of visitor / X kind of conversation, the agent should do Y"*. New patterns add a new skill folder; tweaks to existing patterns edit the relevant SKILL.md.

The frontmatter `description` is load-bearing — the model uses it to decide whether to load the skill. A small change to the description can have a large effect on when the skill fires.

### 1.3 Tool descriptions

**Path**: `product/cms/prompts/tools/<tool>/description.md` (and any sibling files specific to a tool, e.g. `post-handoff-guidance.md`)
**Loaded by**: each tool's TypeScript handler explicitly, via `readFileSync` (no auto-discovery). Wiring lands in [03-exec-c-t4.md — C.t4 tool implementations](03-exec-c-t4.md) (decision C.34).

Seven tool surfaces:

- `find_inspiring` — vivid passages for visitors who are curious but not yet specific
- `find_someone_who` — customer stories for social proof
- `find_proof` — concrete trust signals (operator partnerships, hours of expertise)
- `lookup` — direct factual answers to concrete questions
- `find_options` — small set of trip cards when a visitor is ready to look at concrete shapes
- `illustrate` — image rendering for visual surface
- `handoff` / `handoff_submit` — the lead-capture pair

**When to edit here**: a request that's about *when the agent reaches for a particular tool* or *what it expects from that tool's output*. Authored using the WHY/HOW/WHAT × User/Agent/Swoop matrix from the PoC's `PROMPT_ENGINEERING.md` as scratchpad; published as prose.

### 1.4 Code changes (new tool, new data primitive, new ingestion path)

A meaningful subset of "prompt change" requests turn out to be code changes in disguise. Common shapes:

- **New tool** — the agent should be able to do something it can't currently do. Adds a folder under `product/cms/prompts/tools/<new-tool>/`, a handler at `product/connector/src/tools/<new-tool>.ts`, an MCP registration in `product/connector/src/tools/index.ts`, a Zod I/O contract in `product/ts-common/src/tools.ts`, and (usually) a UI widget under `product/ui/`. Sized in [03-exec-c-t4.md — C.t4 tool implementations](03-exec-c-t4.md).
- **New data axis** — the agent should know something about a trip / region / visitor it currently doesn't. Adds a column or table in the schema (migration), an ingestion path (ETL classifier or source-side data plumbing — see [03-exec-c-t3a.md — C.t3a Haiku ETL classifiers and embedding pass](03-exec-c-t3a.md)), and a path through the relevant tool's output schema to the UI.
- **New widget surface** — the agent's visual channel can't currently render the shape the request needs. Sized in [03-exec-d-t9.md — D.t9 chat-surface widget rewrite](03-exec-d-t9.md).

A useful diagnostic: if the request's natural completion is *"...and then the agent reads the new data"*, it's a code change masquerading as a prompt change. Size accordingly.

### 1.5 Templates and errors

**Path**: `product/cms/templates/handoff-email.md`, `product/cms/errors/en.json`
**Loaded by**: orchestrator for templates, UI for errors. Single consumer per file.

**When to edit here**: handoff email copy, UI error-state copy. Low-frequency change surface but worth knowing about.

---

## 2. Translating sales-side feedback into implementation

The hardest part of this loop isn't writing the change. It's reading the request correctly. A few translation patterns worth holding:

### 2.1 Vague tone request → which surface?

> *"The agent should be warmer with families."*

Three possible homes, and the right one depends on the trigger:

- **System prompt §3 (voice)** — if "warmer" is a voice-level posture that should apply whenever family signals appear *anywhere* in the conversation. Cheap. Tweak-tier.
- **A new pattern skill** — if "warmer with families" means a specific set of moves (mentioning kid-friendly trails, surfacing accommodation that suits multi-generational groups, asking different qualifying questions). Medium-tier.
- **A tool description nudge** — if the trigger is specifically *when the agent surfaces options*, families should see a different shape of option. Small or Medium depending on whether existing `find_options` output already supports the variant.

Best move: write back to the contributor asking *what's the trigger* — what does the agent see that tells it the visitor's a family? Often the answer surfaces the right home.

### 2.2 Behaviour request → pattern or new data?

> *"The agent should suggest accommodation with wheelchair access when relevant."*

Looks like a behavioural change ("when X, do Y"). But the prerequisite is *knowing which accommodation has wheelchair access*. If that data isn't in `trip_card` (or whatever the downstream entity is), the prompt change is downstream of an ingestion change.

The test: can the agent already *answer* the question if asked directly via `lookup`? If yes, it's a behavioural change (Medium). If no, it's a data axis (Big), and the prompt-side work waits for the ingestion-side work.

### 2.3 "Stop doing X" requests

Often look like Tweaks. Sometimes are Tweaks (add to `10_style-avoid.md`). Sometimes hide a deeper pattern.

> *"Stop using the word 'journey' as a verb."*

Pure Tweak — add to the AI-signature-verbs list.

> *"Stop pushing the handoff so hard."*

Looks Tweak-shaped, but "so hard" is doing work. Investigate: is the handoff actually firing too early (a pattern problem)? Is the language too eager (a voice problem)? Is the threshold for readiness mis-set (a system-prompt §7 problem — the R/W reading)? The right surface depends on the diagnosis.

### 2.4 Requests with multiple homes

Some requests genuinely touch multiple surfaces. *"The agent should be more candid about Patagonia's downsides — weather, cost, difficulty — without scaring people off"* probably wants:

- A small system-prompt tweak in the Candid-and-Trustworthy pillar to make the rule explicit.
- A skill (or extension of `engaging-a-dreamer`) for visitors whose warmth is running far ahead of grounded expectation.
- A possible tool-description nudge on `find_proof` to surface honest-tradeoff content rather than only positive proof.

Don't shy away from multi-surface changes — they're often the right shape. But account for them in the sizing.

---

## 3. Complexity assessment from the implementer side

The contributor-facing rubric in the sales doc maps roughly to implementer effort, but two patterns are worth noticing because they look small and aren't:

### 3.1 Cheap-looking that spawns work

- **"The agent should KNOW X"** — anything that involves the agent acting on information it doesn't currently have access to. Spawns ingestion + schema + tool surface.
- **"The agent should surface X when relevant"** — "relevant" is the load-bearing word. If the relevance is something the agent can already read from the conversation (e.g. "when the visitor mentions hiking"), it's a pattern. If relevance requires a per-trip attribute the system doesn't track, it's data work.
- **"The agent should never say X"** — usually a Tweak. But *"never say X *to people who are doing Y*"* is a pattern because it has a conditional trigger.
- **"The agent should be friendlier"** — voice changes touch all conversations. Cheap to write, expensive in surface area covered. Always worth a sample-conversation pass to verify the change doesn't break tone elsewhere.

### 3.2 Expensive-looking that isn't

- **"Add a new skill for X conversation pattern"** — a skill is one new folder with one SKILL.md. The substance work is the prose; the wiring is free. Often Medium even when the contributor pitches it as Big.
- **"Rewrite the handoff intro paragraph"** — a single paragraph in a single file. Half-day including a few sample conversations.
- **"Add a new banned phrase to the style-avoid list"** — Tweak even if the contributor flags it as a big concern.

### 3.3 The data-vs-pattern test

The simplest diagnostic at triage time:

> Does this change ask the agent to behave differently based on signals it can already read from the conversation? → pattern (cheap)
>
> Does this change ask the agent to know or surface something not currently in the system? → data axis (expensive)

The contributor-facing version of this test is in the sales doc — but the implementer's version is sharper because we know what's in the system. Read the request against the current data model when in doubt.

---

## 4. Pushing back on under-specified requests

Most requests arrive under-specified. The good move is to ask for the missing concrete signal, not to guess. A small script:

> *"To size this and ship it cleanly I need one more thing — a concrete visitor prompt that should trigger the new behaviour. Either one you saw recently or one you can clearly imagine. Reason: the agent reads triggers from what the visitor says, so 'when X happens' needs to be expressible as 'when the visitor says or implies Y'. Without that, I'll likely ship something that fires too often, too rarely, or on the wrong signal."*

Variations by request shape:

- **Vague tone request** — *"What does the visitor say that signals to you we should sound warmer? Once I know the signal I can teach the agent to read it."*
- **Behaviour change without a clear scope** — *"Should this fire on every conversation, or only when [obvious subset]? I want to be honest about how big the surface is before scoping."*
- **'Make the agent X' where X is a brand/voice dial** — *"This one touches the brand voice. Worth a quick call before I write anything — happy to scope on a 20-min walk-through."*

Push back without friction by framing it as helping ship the right thing, not as gatekeeping. The contributor isn't a feature requester; they're a customer-facing operator with signal Alastair doesn't have. The implementer's job is to convert that signal into the right shape of change.

**Don't push back on**: requests where the right move is a Tweak, where the contributor is just asking for one specific word to change, or where the diagnosis is clear from the request alone. Ship cleanly when the request is well-formed.

---

## 5. Workflow operations

### 5.1 Triage cadence

Currently weekly. Aim is to read every new entry within seven days of it landing. Beyond that, contributors lose confidence the doc is being read.

At triage time, each entry gets one of four outcomes (these mirror what the sales doc tells contributors to expect):

1. **Ship-this-batch** — bundled into the next prompt-iteration drop. Notes back to the doc: *"shipping in batch of [date]"*.
2. **Scheduled** — sized, planned into a sprint. Note back: *"sized as [tier], scheduled week of [X]"*.
3. **Parked-pending-conversation** — design-decision items, multi-surface requests, things where the trigger isn't clear. Note back: *"need [specific thing] before I can scope — happy to chat"*.
4. **Closed-with-note** — already shipped, superseded, or talked-out. Note back: *"shipped 2026-X-X under [tag]"* or *"superseded by [X]"* or *"talked out, see [conversation reference]"*.

The four outcomes match the sales-doc's promise to contributors. If a new outcome category appears in practice (e.g. *"sent back for rewrite"*), update the sales doc too — keep the promise honest.

### 5.2 Batching changes

System-prompt tweaks (the Tweak and Small tier) batch well. Ship 3–10 in a single drop. Skill changes batch less well — each new skill is a self-contained piece of authored prose and benefits from being read against the agent's existing skills as a coherent set.

Tool description changes are rare and usually one-off — they ship singly.

Code changes (new tools, new data axes, new widgets) follow the project's [worktree-vs-main policy](.claude/projects/-Users-al-Studio-projects-swoop-web/memory/feedback_worktree_vs_main.md) — autonomous/parallel work in a worktree, HITL on main. Don't merge speculatively.

### 5.3 Communicating back

The Google Doc is the canonical channel. Notes back on the doc itself, in-line under the relevant entry, so contributors see the response next to their request rather than in email.

For shipped changes, a one-line release note appended to a `prompt-changelog.md` (TBD — currently the change log is the git log) lets contributors see *what landed when* without having to track individual entries.

For parked items, the note explains *exactly what's needed to unpark*. "Need more concrete trigger" is too vague — "need a visitor prompt that should fire this new behaviour" is the right level of specificity.

### 5.4 Voice and tone in notes back

Match the contributor's register. Luke (CEO, short comms): short reply, no preamble. Julie (production-focused): one extra line about what the trade-off looks like. The doc itself is the artefact of the conversation — make it useful to read back in three months.

---

## 6. References

- [03-exec-c-t4.md — C.t4 tool implementations](03-exec-c-t4.md) — current state of the tool surface. Read before editing any `prompts/tools/<tool>/description.md`.
- [03-exec-d-t9.md — D.t9 chat-surface widget rewrite](03-exec-d-t9.md) — UI widget surface. Read before sizing requests that ask for a new visual shape.
- [03-exec-agent-runtime-t1a.md — B.t1a multi-file system-prompt loader](03-exec-agent-runtime-t1a.md) — loader contract for system-prompt fragments. The reason the `^\d{2}_*.md$` filename pattern matters.
- [03-exec-agent-runtime-t9.md — B.t9 ADK skill-loader integration](03-exec-agent-runtime-t9.md) — how skills are picked up at runtime.
- [03-exec-c-t3a.md — C.t3a Haiku ETL classifiers + embedding pass](03-exec-c-t3a.md) — the ingestion path any new-data-axis request will eventually touch.
- [product/cms/README.md — content-as-data load contracts](../product/cms/README.md) — the layout doc; required reading for any new content surface.
- [decision G.11 — CMS folder structure + system-prompt assembly mechanism](decisions.md) — structural commitment.
- [00-discovery-design-thinking.md — joint design thinking for tools + system prompt + skills](00-discovery-design-thinking.md) — the conceptual frame the agent's behaviour emerges from. Read before any change that touches the agent's job or the boundary of Discover.

---

## 7. Why this replaces the curation workstream

The original plan (commits [058f26f — Tier 3 plans for sales-team prompt curation + agent_prompts override repo](https://github.com/) and its dependencies) shipped two Tier 3 crosscut plans totalling ~3.25–4.75 days of contingency-tier engineering work:

- A second repo (`agent_prompts`) with multi-project layout and per-folder override semantics
- A bootstrap-clone pattern wiring `prompt-defaults/` + `prompt-overrides/` together at runtime
- A two-PAT per-person model for sales-team git access
- A *Swoop Prompt Curator* claude skill that ran in each contributor's Cowork-hosted Claude, eliciting Why/How/What and opening PRs against the override repo
- A GitHub Action that notified a reviewer
- An end-to-end M5 demo where Luke landed a PR live

Alastair's 2026-05-27 reframe: the underlying bottleneck is contributors not being able to size their own requests. A workflow doc closes that gap directly — the rubric in the sales doc lets contributors self-size, and the implementer-side doc (this file) sharpens the triage loop. The git PR machinery, override repo, and curator skill all become unnecessary once contributors can articulate the trigger and surface concretely.

What's preserved from the curation plan:

- The Why/How/What golden-circle structure — repurposed as a request-writing prompt for contributors, not as a Curator-driven elicitation.
- The acknowledgement that some requests should be talked-out, not shipped — folded into the *Closed-with-note* and *Parked* triage outcomes.
- The recognition that sales-side and dev-side need shared language about what makes a change cheap vs expensive — folded into the rubric and the data-vs-pattern test.

What's dropped:

- The override repo and two-repo split — the system stays single-repo. If sales-team write access becomes a real need later, the override repo can be revisited.
- The Curator claude skill — sales contributors write Google Doc entries; Alastair does the curation.
- The GitHub Action notifying a reviewer — Alastair triages on cadence.
- The M5 live-PR demo — replaced by Alastair running a working session with Luke against the rubric.

Net: same outcome (better-shaped prompt-change requests, faster cycle time), substantially lower infrastructure burden, no new auth surfaces.
