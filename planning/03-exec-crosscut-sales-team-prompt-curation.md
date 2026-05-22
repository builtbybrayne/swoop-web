# 03-exec-crosscut — Sales-team prompt curation

**Status**: Draft. Awaiting ratification.
**Authored**: 2026-05-21
**Position**: Inside M5. Adds contingency draw — flagged to Luke in the same contingency email that covers the renegotiated 21-day baseline.

**Depends on:** [03-exec-crosscut-prompts-repo-split.md — Prompts repo split](03-exec-crosscut-prompts-repo-split.md) **must land first**. The PAT scopes, GitHub Action location, repo URLs, and access-enforcement mechanism for this plan all assume the two-repo shape that plan establishes.

**Relates to:**
- [01-top-level.md §3 theme 2 — Content-as-data](01-top-level.md) — substrate this builds on
- [01-top-level.md §2.2 JTBD — Swoop sales team](01-top-level.md) — closes the *"(Post-Puma) shape AI behaviour without developer tickets"* item by pulling it forward into M5
- [02-impl-content.md — Chunk G content layer](02-impl-content.md) — the runtime artefacts this mechanism edits
- [03-exec-agent-runtime-t1a.md — multi-file system-prompt loader](03-exec-agent-runtime-t1a.md) — the loader pattern this depends on
- [03-exec-agent-runtime-t9.md — B.t9 ADK skill-loader integration](03-exec-agent-runtime-t9.md) — adk-skill-loader the existing `skills/*` files run through

**Terminology note** (load-bearing for this plan): two different things both historically called "skills" — an **adk skill** (file in `product/cms/prompts/skills/`, loaded into the runtime agent by ADK at conversation time) and a **claude skill** (installable `.skill` package loaded by Cowork in Luke's/sales team's Claude). Never just "skill" in this plan or its descendants.

---

## 1. Outcome

After this lands, the Swoop sales team (Luke first, extending to the team Luke nominates) can hold a conversation with their own Cowork-hosted Claude and emerge with a concrete, well-grounded change to the runtime agent's behaviour. The mechanism is:

1. Luke/team-member opens their Claude (Cowork) with the *Swoop Prompt Curator* claude skill installed.
2. They describe a behavioural change they want the agent to make. The claude skill elicits a **Why / How / What** triple, transparently explaining why those three components are needed.
3. If the conversation produces a coherent change, Claude commits it to a new branch on the `agent_prompts` repo (scoped to `projects/swoop_web/agents/web_discovery/`) and opens a PR. If the conversation talks itself out of the change (sometimes the right outcome — see §3.6), no PR is created.
4. A GitHub Action fires on PR open, emails the reviewer with the PR link and summary. The reviewer reviews; either merges, comments, or closes-with-note.
5. On next deploy (triggered automatically by merge — see [03-exec-crosscut-prompts-repo-split.md §5.2](03-exec-crosscut-prompts-repo-split.md)), the runtime agent picks up the change. Luke notices the agent's behaviour shift in real conversations.

By the M5 demo, Luke does a live run-through with the dev-team reviewer and lands his first PR end-to-end.

---

## 2. Artefacts

Five concrete things to produce (the GitHub Action that notifies the reviewer on PRs is owned by the [03-exec-crosscut-prompts-repo-split.md — Prompts repo split](03-exec-crosscut-prompts-repo-split.md) plan, not this one):

### 2.1 New runtime system fragment

**Path in the override repo**: `projects/swoop_web/agents/web_discovery/prompt-overrides/system/30_sales-team-guidance.md`
**Path in the bootstrapped swoop_web worktree**: `product/cms/prompt-overrides/system/30_sales-team-guidance.md`

**Loader behaviour**: the existing system-prompt loader (B.t1a, see [03-exec-agent-runtime-t1a.md — multi-file system-prompt loader](03-exec-agent-runtime-t1a.md)) walks both `prompt-defaults/system/` and `prompt-overrides/system/` for `^\d{2}_*.md$` matches and concatenates them in numeric order (per the runtime loader changes in [03-exec-crosscut-prompts-repo-split.md §4](03-exec-crosscut-prompts-repo-split.md)). This file's `30_` prefix loads it after the canonical `00_why.md` and `10_style-avoid.md`; the trailing-guidance position means it acts as overlay/correction over the core voice.

**Initial content**: just the frame. No entries.

```markdown
# Sales-team guidance

Time-stamped guidance from Swoop's sales team. Each entry is authoritative
for the moment it was added. Where two entries appear to conflict, prefer
the later one — the team's understanding has evolved.

Every entry has four parts:

- **Proposed by** — the sales-team-member who initiated this change,
  with email address. The reviewer can reach back for clarification
  without leaving the PR.
- **Why** — the motivation. What signal in the market or in sales
  conversations prompted this? What's the agent currently doing that we
  want to change, or not doing that we want it to start?
- **How** — the principle. The rule of thumb the agent should apply in
  conversational moments. Not the literal phrasing — the underlying
  posture.
- **What** — the concrete instruction. The "if you see X, do Y" — small,
  testable, doesn't try to cover every edge case.

If you encounter an entry where one of Why / How / What is genuinely
absent (e.g. the How is identical to the What), it will be marked
explicitly rather than omitted silently.

---

<!-- Entries land below this line, oldest first / newest last —
     runtime Claude has recency bias, so the latest guidance should sit
     closest to the agent's next turn. -->
```

**Append direction**: newest-last (so the agent reads older context first and the most recent override sits closest to its next turn — runtime Claude has recency bias, and we want it to favour the most current guidance). The Curator claude skill appends new entries to the bottom of the entries block.

### 2.2 The Swoop Prompt Curator claude skill

**Source location**: `product/claude-skills/swoop-prompt-curator/`

- `SKILL.md` — main skill file (YAML frontmatter + body). Runs the self-check on session start (see §3.8) and orchestrates the rest of the bundle.
- `methodology.md` — the elicitation pattern, transparency framing, edit-tier policy.
- `git-operations.md` — concrete commands for clone/branch/commit/PR.
- `reflections-library.md` — pattern-knowledge for talk-them-out-of-it moments.
- `setup-guide.md` — first-time-setup walkthrough for an end-user whose self-check failed. Read by the Curator on session start when the check fails. Covers: both PAT installations, Cowork secret-store configuration, the one-time `proposer_email` capture. Written for an end user with no git background.
- `admin-onboarding-guide.md` — for a Swoop admin setting up a new sales-team-member's machine. Read by the Curator **only when explicitly requested** by the user. Covers: PAT generation, scope configuration, install on the team-member's machine, verify-it-works step.
- `config.json` — **per-project configuration** baked into the build. For Swoop's M5 build, contains:
  - `project`: `swoop_web`
  - `agent`: `web_discovery`
  - `prompts_repo_url`: the agent_prompts repo URL
  - `working_subpath`: `projects/swoop_web/agents/web_discovery/`
  - `swoop_web_repo_url`: for the read-only grounding PAT
  - `reviewer_handle`: GitHub handle of the initial reviewer (for PR @-mentions if useful)

**Build-time parameterisation**: the skill body itself is generic. When packaging the `.skill` zip, the build step injects `config.json` with the project/agent slug and repo URLs. A future client engagement gets its own `.skill` build from the same source — different config, same authoring effort. Per [03-exec-crosscut-prompts-repo-split.md §2.2](03-exec-crosscut-prompts-repo-split.md), this is how the multi-project shape stays sane.

Building the `.skill` zip happens via the [skill-packaging](../../../.claude/skills/skill-packaging) conventions. The `.skill` artefact is what gets hand-delivered to Luke at the M5 demo.

**Why source-in-repo**: the curator skill is itself versioned alongside the artefacts it edits. PRs that change the runtime guidance can also evolve the curator's methodology as we learn what works. Per-project config separation means the same source can serve future projects.

**Content shape**: detailed in §3.

### 2.3 PAT setup procedure (two PATs)

**Where**: a short section of the handover doc (§2.5).

**Shape**: each sales-team member who'll use the Curator gets **two** fine-grained GitHub PATs.

**PAT 1 — read-only `swoop_web`:**
- Scope: `swoop_web` repo only.
- Permissions: `contents: read`.
- Purpose: lets the Curator read code, planning docs, and decisions when grounding a proposed change. *"This sounds like it depends on a tool change — let me check what `find_options` does..."* — without this PAT the Curator can't do that.

**PAT 2 — read+write `agent_prompts`:**
- Scope: `agent_prompts` repo only.
- Permissions: `contents: read+write` (to create branches), `pull-requests: write` (to open PRs).
- Purpose: the actual write surface. Soft scoping to `projects/swoop_web/agents/web_discovery/` is enforced by the Curator skill's `config.json` — it refuses to operate outside its configured working subpath. Cross-project bypass attempts are caught by human review on the PR (per [03-exec-crosscut-prompts-repo-split.md §6.3](03-exec-crosscut-prompts-repo-split.md)).

**Both PATs:**
- Stored: in Cowork's connector/secret store on their machine, not committed anywhere.
- Replacement when expired: documented step-by-step in the handover doc.

Per-person rather than shared service tokens. Cleaner audit trail — PRs show the actual author, not a faceless service account.

### 2.4 Branch and commit conventions

**Branch**: `sales/<project>/<author-handle>/<short-slug>` — e.g. `sales/swoop_web/luke/tour-leans-stronger-on-solo`. Created in the `agent_prompts` repo. The project prefix accommodates the multi-project structure.

**Commit message**: `prompt(<project>/<agent>:sales-guidance): <short description>` for guidance-fragment edits; `prompt(<project>/<agent>:skill-<skill-name>): <short description>` for adk-skill edits; `prompt(<project>/<agent>:tool-<tool-name>): <short description>` for tool-augmentation edits; `template(<project>/<agent>:handoff-<filename>): <short description>` for handoff template overrides.

**One PR per coherent change**. The Curator skill keeps a single conversation → single PR mapping unless the user explicitly splits.

### 2.5 Handover doc

**Path**: `planning/handover/sales-prompt-curation.md` (per [03-exec-crosscut-prompts-repo-split.md §2.4](03-exec-crosscut-prompts-repo-split.md), handover documentation lives under `planning/`, not under `product/cms/`).

Audience: Luke, the sales team, and the Swoop dev team that picks up reviewer duty post-handover. Covers:

- What the mechanism does and doesn't do
- The defaults-vs-overrides model (so reviewers know what's canonical vs override)
- Installing the Curator claude skill
- Setting up the two PATs (read-only `swoop_web` + read+write `agent_prompts`)
- Walking through a first PR (mirrors the M5 demo)
- The override/augmentation surface per folder (what's editable, what isn't, what shape the edit takes)
- The reviewer's job — what to look for in a PR, when to merge vs comment vs close
- The post-M5 commercial conversation (§5)
- The PAT-rotation procedure (both PATs)
- Reviewer-email secret swap procedure (lives in the agent_prompts repo's Action — see [03-exec-crosscut-prompts-repo-split.md §5.1](03-exec-crosscut-prompts-repo-split.md))

---

## 3. Curator claude skill — content shape

The Curator is the meaty piece. Six sub-shapes worth specifying.

### 3.1 Transparency-of-questioning frame

The skill opens every session by naming what it's doing. Not as a script — as a default posture the body of the skill teaches Claude to adopt.

Sample framing (illustrative, not literal):
> *I'm here to help you propose a change to how the Swoop discovery agent behaves. The agent reads its guidance in a structured way — every entry has a Why (the motivation), a How (the principle), and a What (the concrete instruction). I'll ask about all three because without them, the agent either misapplies the change or doesn't ground it consistently. If a question genuinely doesn't apply to what you're proposing, say so — we can collapse it. Walk me through what you're seeing.*

This is **not** a fixed opening line. It's a default posture. If Luke arrives with *"the agent should say less about flights when people aren't asking about flights"*, the skill responds in kind — but the *why-I'm-asking-this-way* substrate sits underneath every elicitation.

### 3.2 The Why/How/What elicitation pattern

The skill draws out three things:

- **Why**: what conversation, signal, or pattern prompted this? Often the most undermined component because the team-member arrives with the *what* already formed. The skill's job is to surface the *why* explicitly so the runtime agent can judge applicability per-conversation. Sample probes: *"What was the conversation that surfaced this?"* / *"Is this a one-off or a pattern?"* / *"What does the agent do today that you want it to stop doing?"*
- **How**: the underlying posture, not the literal words. Sample probes: *"Is this about tone, or about a specific moment in the conversation?"* / *"What's the rule of thumb you want the agent to apply?"* / *"Are there situations where this rule wouldn't apply?"*
- **What**: the concrete instruction. Small, testable, doesn't try to cover every edge case. Sample probes: *"If we wrote this as one sentence the agent could apply, what would it be?"* / *"What's the signal that triggers this — what does the agent see in the conversation that makes it apply?"*

The skill respects collapses — if Why and How are genuinely the same, mark it explicitly in the entry rather than padding.

### 3.3 Edit-tier policy

The Curator carries a **soft policy** over what edits are allowed through this mechanism. There's no hard fence — every PR is human-reviewed, and the reviewer's eye catches off-scope attempts (per [03-exec-crosscut-prompts-repo-split.md §6.2](03-exec-crosscut-prompts-repo-split.md)). The Curator's policy is about *routing the conversation cleanly* in the first place, not about enforcement; enforcement is human review.

**Allowed edits (per the per-folder semantics in [03-exec-crosscut-prompts-repo-split.md §2.6](03-exec-crosscut-prompts-repo-split.md)):**

- **`prompt-overrides/system/`** — new file additions only. The Curator authors `30_sales-team-guidance.md` (and any future numbered fragments) by appending to the working file. Cannot override `00_why.md` or `10_style-avoid.md` (they live in `prompt-defaults/`, which the Curator has no write access to).
- **`prompt-overrides/skills/<skill-name>/SKILL.md`** — either an override of one of the 14 canonical skills (same name in overrides; loader prefers overrides) or a new skill (new folder, new name). Skill augmentation is out of scope for v1 — to tweak an existing skill, the Curator does a full override (preserving the original's structure in the override file).
- **`prompt-overrides/tools/<tool>/description.augment.md`** — appends to a tool's canonical description. Cannot replace the canonical description; only adds.
- **`template-overrides/handoff/<filename>.md`** — overrides a canonical handoff template by same-name file.

**Off-limits via this mechanism (routed to dev-team conversation):**

- `prompt-defaults/*` (the canonical content) — Curator has no write access; cannot touch.
- `prompt-overrides/etl/*` (ETL classifier prompts) — not in the override surface; schema-coupled.
- Replacing `prompt-defaults/system/00_why.md` or `10_style-avoid.md` — system supports augmentation only, not override.
- Replacing tool descriptions wholesale — tools support augmentation only.
- Anything outside `projects/swoop_web/agents/web_discovery/` in the agent_prompts repo (other projects/agents).

If the team-member asks for a change that lands in the off-limits surface, the Curator skill **explains why** (the surface is coupled to agent schema or safety properties, or sits outside the override system) and **suggests the closest in-surface alternative**, or flags the request for an explicit dev-team conversation. It doesn't just refuse — it routes.

The Curator can also read swoop_web (via PAT 1) when grounding the conversation — e.g. *"this prompt change you're proposing depends on a tool that does X; let me check the tool's description and implementation before we commit"*. The Curator never writes to swoop_web; the read PAT has no write permission to fall back on.

### 3.4 Reflections library

A small body of pattern-knowledge the skill ships with, so Claude can offer reflections during the conversation rather than just elicit.

Reflection prompts (illustrative):
- *"This sounds like a one-off from one frustrated visitor. Want to wait and see if it shows up again before we change the agent?"*
- *"The way you've described it sounds more like a tone change than a behavioural change. Tone changes can be expensive because they touch a lot of conversations — worth being sure?"*
- *"This is the third time we've added a 'don't do X' instruction in a month. Worth a conversation with the dev team about whether the underlying voice prompt needs revisiting instead?"*
- *"What you're describing might already be covered by the [pattern-anniversary-couple] skill. Want me to read it and check?"*

These are not interventions to block — they're invitations to think twice. The team-member can always say "no, do it anyway" and the skill proceeds.

### 3.5 Git operations

The skill carries concrete procedure for:

- Authenticating against both PATs (read from the local secret store): PAT 1 for read access to `swoop_web` when grounding requires it, PAT 2 for write access to `agent_prompts`.
- Cloning or fetching the latest `agent_prompts` `main`.
- Working only within the configured `working_subpath` from `config.json` (for Swoop: `projects/swoop_web/agents/web_discovery/`). The Curator refuses to write outside this subpath.
- Creating a new branch (per §2.4 convention) in `agent_prompts`.
- Writing the change to the appropriate path under `working_subpath` — depending on edit type:
  - System augmentation: **append to the bottom of** `prompt-overrides/system/30_sales-team-guidance.md` (creating the file with the canonical frame if it doesn't exist yet) with the elicited Proposed-by/Why/How/What block.
  - Skill override: create or update `prompt-overrides/skills/<skill-name>/SKILL.md`.
  - Skill new: create `prompt-overrides/skills/<new-skill-name>/SKILL.md`.
  - Tool augmentation: create or append to `prompt-overrides/tools/<tool>/description.augment.md`.
  - Handoff template override: create or update `template-overrides/handoff/<filename>.md`.
- Committing with the convention-correct message. The git author identity comes from the team-member's PAT 2 — the PR is attributed to them, not to a service account.
- Pushing.
- Opening a PR with a clean description that includes the proposer's email address in the body for easy reviewer follow-up (the diff itself carries the Why/How/What rationale — see §3.7).

These commands live in `git-operations.md` for easy maintenance; the SKILL.md body references them rather than inlining.

### 3.6 Conditional success mode

The skill's success-mode is **sometimes producing a PR, sometimes not**. Explicit in the methodology — not a failure if a session ends without a commit. If the team-member talks themselves out of the change during elicitation (often because the reflections library surfaced a counter-perspective they hadn't considered), that's a successful session. The skill should:

- Make this expectation visible at session-end if no PR was created (*"sounds like we landed on 'not yet' — want me to capture a note for next time?"*).
- Optionally append a "considered-and-not-pursued" entry to a local-only note file (not committed) for the team-member's own future reference.

This stops the skill from sycophantically producing low-value PRs just to feel productive.

### 3.7 PR description shape

The PR body is a one-line summary of the elicited change plus the proposer's email address (for direct reviewer follow-up without leaving the PR thread). **No editorialisation of the rationale** — the Why/How/What in the diff itself carries the reasoning. This avoids two parallel rationales drifting out of sync between PR description and committed text.

The reviewer reads the PR body for one-line orientation + the contact email, then reads the diff for the actual reasoning. Fast review loop, and if a clarification is needed the responder address is one click away.

### 3.8 Self-check on session start

Before the Curator does anything else in a session, it runs a quick five-step self-check:

1. **Config loaded?** Is `config.json` present and parseable, with `project`, `agent`, `prompts_repo_url`, `working_subpath`, `swoop_web_repo_url` all populated?
2. **PAT 1 present?** Is a read-only PAT for the configured `swoop_web_repo_url` available in the local secret store?
3. **PAT 2 present?** Is a read+write PAT for the configured `prompts_repo_url` available in the local secret store?
4. **PATs functional?** Can each successfully `git fetch` against its repo?
5. **Proposer-email configured?** Has the team-member set their `proposer_email` for attribution?

If all five pass, the Curator proceeds to elicitation (§3.2). If any fail, it **stops** the elicitation flow, reads `setup-guide.md`, and walks the user through the missing setup steps — explicitly named, in plain language, no assumption of git background.

The Curator never silently tries to elicit a change it can't actually commit. A user halfway through articulating a guidance change only to discover the PAT isn't set up is a bad experience; the self-check upfront is cheap.

**One-time setup capture**: `proposer_email` is captured during first-run setup and persisted locally (Cowork secret store). On subsequent sessions the self-check just confirms it's present; it's not re-asked. If the team-member changes their email they re-run setup.

**Admin-onboarding pivot**: if the user identifies as a Swoop admin setting up a different team-member's machine (e.g. *"I'm Julie, helping Tom get set up — how do I do this?"*), the Curator reads `admin-onboarding-guide.md` instead of `setup-guide.md`. This is explicit-request-only — the Curator doesn't auto-detect an admin context; the user names it.

---

## 4. Distribution

**M5 deliverable**: `.skill` zip file, hand-delivered to Luke (and any sales-team-members he nominates) at the M5 demo. Walked through install and first-use in the same session.

**Why hand-delivered, not marketplace**:
- M5 scope is small + tight; marketplace publication has its own setup overhead.
- First-touch with sales-team is the moment to do real onboarding, not silently ship them an installable.
- The marketplace is the right answer once the workflow has earned its place.

**Future migration**: a *Swoop plugin* that bundles the Curator and any other future claude-skills (sales briefing, post-conversation analysis prompts, whatever earns its place over time). Plugins also carry an update mechanism, which solves the *"how does Luke get v2 of the Curator"* question elegantly. Captured as a future migration path, not in M5 scope.

---

## 5. Post-M5 commercial threads

Two threads need to surface in the M5 demo conversation, not later:

**Reviewer time during the transition.** The project lead sits in the reviewer seat for an initial period (length tbd with Luke at demo — probably 2-4 weeks) while the Swoop dev team gets familiar with the principles. That time is billable. If it falls inside the M5 contingency window, it draws from contingency; if past, it's a small ad-hoc engagement on the WhaleyBear day rate (£950 + VAT).

**Post-handover SLA.** By default, there is none — the mechanism is documented, the Swoop dev team owns it, and the project lead is out of the loop. If Luke wants ongoing turnaround-time commitments or wants the project lead available as a backstop reviewer beyond the transition, that's a **retainer conversation**, not a continuation of project scope. Worth raising as an option at the M5 demo so Luke can think about it — not pushed.

Both threads live in `product/cms/handover/sales-prompt-curation.md` as a "commercial notes" section so the conversation can happen anchored to a written reference.

---

## 6. Verification

**M5 demo path (the live verification):**

1. Luke (with the Curator installed) opens his Claude and starts a conversation about a real change he wants. The project lead watches.
2. Curator elicits Why/How/What. Luke either lands on a coherent change or talks himself out of it.
3. Curator drafts the change, opens a PR against `agent_prompts` (scoped to `projects/swoop_web/agents/web_discovery/`).
4. GitHub Action fires; email lands at the reviewer address. The project lead shows Luke the email.
5. The reviewer reviews the PR, either merges (with a comment about why this one was clean) or comments-and-requests-edit (and walks through the why on screen).
6. Once merged, the deploy trigger fires (per [prompts-repo-split §5.2](03-exec-crosscut-prompts-repo-split.md)); next deploy picks the change up. Show Luke that an existing transcript replay now responds differently (if the change is one the validator scenarios can demonstrate).

If the elicitation produced "no PR", that's also a valid demo outcome — show Luke that the system *doesn't* spam changes.

**Pre-demo verification (engineering-side, not for Luke):**

- The Curator authoring itself: dry-run a session against a tester-as-team-member, land a fake PR, confirm the Action fires, confirm the email arrives, confirm the merge works, confirm the agent's behaviour changes on next deploy. Repeat across each allowed edit type (system augmentation, skill override, skill new, tool augmentation, handoff template override).
- The end-user setup flow (self-check fails → reads `setup-guide.md` → walks user through both PAT installs + email config) works from a fresh machine.
- The admin-onboarding flow works when explicitly invoked — `admin-onboarding-guide.md` reads cleanly, the steps are followable, the resulting setup passes the self-check.
- Off-limits surfaces are politely routed, not bluntly refused — test by asking the Curator to change `00_why.md` (system override not allowed) and to change a tool description wholesale (tool override not allowed).
- Cross-project scope refusal — test by asking the Curator to write to a hypothetical other-project path; it should refuse and explain why.
- Attribution lands correctly — `Proposed by:` line appears in both the fragment entry and the PR description; PR author shows the team-member's GitHub identity not a service account.

---

## 7. Decisions to log

To be assigned numeric IDs at merge per [decisions.md](decisions.md) convention. Provisional `sptc-` (sales-prompt-team-curation) prefix to avoid collision with parallel work.

- **sptc-1** — Sales-team edits flow through git PRs, not Box / Google Docs / email. Reasons: provenance, review ergonomics (decided 2026-05-21).
- **sptc-2** — Each sales-team-member uses two per-person fine-grained PATs (one read-only on swoop_web, one read+write on agent_prompts), not a shared service token. Reason: PR author trail (cleaner audit, sharper handover) + grounding read access to code without write exposure.
- **sptc-3** — Allowed edit shapes per the per-folder semantics in [03-exec-crosscut-prompts-repo-split.md §2.6](03-exec-crosscut-prompts-repo-split.md): system augmentation (new files only), skill override or new (no augmentation in v1), tool augmentation (via `description.augment.md`), handoff template override. All off-limits surfaces are routed by the Curator to dev-team conversation rather than refused.
- **sptc-4** — GitHub Action (owned by [prompts-repo-split](03-exec-crosscut-prompts-repo-split.md)) fires on every PR, no author-exclusion filter. Reason: total provenance (decided 2026-05-21).
- **sptc-5** — Curator's success-mode is conditional — sometimes a PR, sometimes "talked-themselves-out-of-it". The skill carries a reflections-library to support the second path.
- **sptc-6** — PR descriptions hold a one-line summary + the proposer's email for reviewer follow-up; the Why/How/What rationale lives in the diff itself. No parallel rationale.
- **sptc-7** — Distribution: `.skill` zip hand-delivered at M5 demo, with `config.json` baked in at build time for the swoop_web / web_discovery project/agent slug. Future migration to a Swoop plugin is documented but out of M5 scope.
- **sptc-8** — Append direction in `30_sales-team-guidance.md` is newest-last (oldest first). Reason: runtime Claude has recency bias; the most current guidance should sit closest to the agent's next turn.
- **sptc-9** — Curator runs a self-check on session start (config loaded, both PATs present + functional, proposer-email configured). On failure, reads `setup-guide.md` and walks the user through; on admin-context explicit request, reads `admin-onboarding-guide.md` instead. Reason: don't elicit a change the Curator can't commit; don't bloat ordinary sessions with admin material.
- **sptc-10** — Every fragment entry carries a `Proposed by:` line including the team-member's email address. Mirrored in PR description body. Reason: easy reviewer follow-up without leaving the PR thread; durable attribution in the runtime artefact itself, not just in git metadata.
- **sptc-11** — Curator skill is parameterised on per-project config (project, agent, working_subpath, repo URLs) at `.skill` build time. The skill body is generic; the same source compiles into per-project distributions. Reason: anticipates future agents and clients without re-authoring effort.

---

## 8. Out of scope

Explicit fence so this doesn't accrete:

- **No claude-side authentication beyond PAT.** Cowork is the auth surface; the Curator doesn't reimplement it.
- **No webhook / Slack / email-to-PR ingestion.** PRs only come from the Curator-mediated path. Other ingestion mechanisms can come later if real-world signal asks for them.
- **No skill-augmentation in v1.** Skill edits are override-or-new only. Augmentation deferred to v2 per [03-exec-crosscut-prompts-repo-split.md §10](03-exec-crosscut-prompts-repo-split.md).
- **No tool override in v1.** Tools support augmentation only; wholesale tool description replacement stays dev-team only.
- **No editable surface widening into `prompt-defaults/`.** Sales-team writes go to `prompt-overrides/` only. Edits to canonical content require a dev-team PR against swoop_web.
- **No retention / TTL for fragment entries.** Append-only audit. Pruning is a future judgment call.
- **No multi-language.** English entries only — matches the broader agent-runtime scope.
- **No quality-gate automation on PRs.** The reviewer (human) is the quality gate. Lint / typecheck / test on PR could be added if churn justifies it; not in M5 scope.
- **No retainer commitment.** Post-M5 SLA is a separate commercial conversation per §5.

---

## 9. Sizing

Estimated 2.25-3.25 days from the contingency window (the GitHub Actions and the runtime loader changes have moved to the [prompts-repo-split](03-exec-crosscut-prompts-repo-split.md) plan):

- 0.5 day — fragment frame authoring (the canonical empty frame for `30_sales-team-guidance.md`) + smoke test that the loader picks it up from `prompt-overrides/system/`
- 1.25 day — Curator claude skill authoring (SKILL.md + methodology + git-operations + reflections-library + setup-guide + admin-onboarding-guide + `config.json` template), including a dry-run session as a tester-team-member and a separate dry-run of the self-check / setup-guide path from a fresh-machine state with both PATs
- 0.25 day — handover doc at `planning/handover/sales-prompt-curation.md`
- 0.25 day — `.skill` build process: build script that injects the per-project `config.json` and zips the result
- 0.5 day — M5 demo dry-run + small polish from the dry-run feedback

Edge factor: PAT scope finalisation at the GitHub end (fine-grained PATs occasionally have permission gotchas; verify both PATs early). Pad another 0.25 day if it bites.

---

## 10. Open questions before execution

Two things flagged but not yet decided. Both can settle during execution rather than before:

1. **Who else on the sales team gets PAT access at M5 demo time?** Luke first, definitely. Beyond Luke depends on whether Julie / others want to be hands-on during the transition window. Worth a 5-min conversation with Luke pre-demo.
2. **Curator skill self-update mechanism.** Currently every change to the Curator requires repackaging the `.skill` and hand-delivering the new version. This is fine for M5. Once a Swoop plugin exists (future migration path) it solves itself. Worth deciding whether to ship a stub "update check" in v1 that simply tells the user *"this is v1 of the Curator, hand-delivered on YYYY-MM-DD; check with the dev team if it's been a while"* — small, low-effort, prevents stale-Curator confusion later.

---

## Provenance

Captured from the 2026-05-21 planning session. The original demo (Phase 1 ChatGPT prototype) surfaced strong sales-team demand to provide feedback into the agent's prompts. Architecture lands in M5 to satisfy that demand while keeping the original [01-top-level.md JTBD 2.2 "post-Puma" item](01-top-level.md) safely inside Puma. Specific shape — git not Box, system fragment authored via the override repo's `prompt-overrides/system/`, GitHub Action for notification (owned by the prompts-repo-split plan), per-person two-PAT model, every PR through the loop, conditional success mode, Why/How/What golden-circle structure, multi-project `agent_prompts` repo with per-project config baked into each `.skill` build — all decided in that conversation.
