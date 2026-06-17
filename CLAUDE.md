# Swoop Web Discovery

Cowork-level project management context for the Swoop Website Discovery Tool engagement (Phase 2 of Al's Swoop engagement, following the ChatGPT Apps SDK prototype).

For Swoop-wide background (people, commercial fence, positioning) load the `swoop` skill.

---

## Releases

Releases are named after Patagonian / Antarctic animals. No version numbers — when we talk about "V1" we'll always discover a year later that the real V1 was the ChatGPT PoC and we're actually on V3. Names don't have that problem.

| Release | Name | Status | Scope |
|---|---|---|---|
| First shipped | **Puma** | In planning | Patagonia-only conversational discovery, qualified-lead handoff, EU AI Act Art. 50 + GDPR compliant. The 30 Mar quoted 16-day engagement. |
| Next | TBD (candidate: Condor / Guanaco) | Not scoped | Antarctica follow-on + whatever Puma's real-world signal points to. |

**Active release = Puma.** Anywhere the codebase or planning docs talk about "the current release", they mean Puma until stated otherwise.

---

## Session-start orientation

New session? Read these four files before touching anything — they're the durable memory across sessions:

- **[progress.md](progress.md)** — state of M1, planning tiers, implementation per chunk.
- **[discoveries.md](discoveries.md)** — non-obvious architectural truths (two-layer agent, AI SDK transport, genai-to-Anthropic schema translation, etc.).
- **[gotchas.md](gotchas.md)** — environmental / tooling traps that cost real time (dotenv override, model IDs, stuck Vite modules, etc.).
- **[next-steps.md](next-steps.md)** — prioritised resume guide with specific files.

Then check the most recent review under **[planning/reviews/](planning/reviews/)** — its checklist names what's in flight from the last sanity check. And `ls planning/03-exec-crosscut-*-fix.md` for any cross-cutting work that may collide with chunk-scoped tasks.

These live at the project root. Keep them current — add entries as new discoveries / gotchas / progress land. Future sessions depend on them.

## Inbox & questions

Three append-only capture files live at the repo root. All get periodically triaged.

### `inbox.md` — ad-hoc captures for us

Ideas, side-notes, observations, nudges that don't obviously belong in a planning doc yet. **When Al says "add to inbox" or "capture that"**, append a dated entry with a short title and a two-to-five line body. Don't expand it into a full planning artefact — the inbox is deliberately shallow. Triage into long-term homes (planning docs, archive, deletion) happens on its own schedule.

Entry format:
```
## YYYY-MM-DD — short title

One- to several-line body. Note where this might eventually land ("Handle in Tier 2 chunk X" / "For commercials triage" / "Personal note only").
```

### `questions.md` — open questions for Swoop

Things Al needs Swoop-side input on before they can be closed. Organised by topic, each entry names who to ask (Luke / Julie / Thomas / Richard / Martin / Lane / legal) and why it matters. Answered questions move to the "Closed" section at the bottom during triage.

**When Al surfaces a question that needs Swoop input** (not a decision he can close alone), add it to `questions.md` under "Open" rather than just noting it inline in a planning doc. Keeps the ask-list coherent and prevents questions dying in Tier 2/3 footnotes.

### `luke-briefing.md` — business implications for Luke

Things Luke (or Julie, where marked) needs to be *aware of* — business implications surfaced by build/research work, written in business language with **no technical detail**. Distinct from `questions.md` (those are asks); these are awareness items that graduate into Al's emails/calls. **When research or implementation surfaces a business-level implication** (a data gap that limits a business priority, a source-of-truth contradiction, an operational dependency on Swoop), append a dated entry here rather than burying it in a Tier-3 plan. Entries carry a status: NEW → RAISED → CLOSED. Convention started 2026-06-11; seed example: tours carry no prices anywhere in the website data, despite tours being the business priority.

---

## Planning structure

Four tiers at different altitudes plus two side-channels (cross-cuts and reviews). See `planning/01-top-level.md` for full detail on the tier system.

| Tier / kind | Where | What |
|---|---|---|
| 1 — Top-level | `planning/01-top-level.md` | Intent, JTBDs, themes, roadmap, parallelisation candidates. Principle-led, no component names. |
| 2 — Implementation (per chunk) | `planning/02-impl-<chunk>.md` | Per roadmap chunk: outcomes, target functionalities, architectural principles, PoC reuse pointers. No code. |
| 3 — Execution (per task) | `planning/03-exec-<chunk>-<task>.md` | Real components, file paths, interface signatures, verification steps. The brief a single Claude Code agent runs against. |
| 3 — Cross-cut fix | `planning/03-exec-crosscut-<topic>-fix.md` | Tier 3 plan for review-driven work that genuinely spans chunks (e.g. extending `@swoop/common` with a shared helper used by 4 workspaces). Same shape as a regular Tier 3 plan; named `crosscut` because it has no chunk owner. **Always check these when starting work** — they describe shared-surface changes that may collide with chunk-scoped work. |
| 4 — Swarm | Not a doc | The parallel/serial Claude Code agent sessions that build from Tier 3 plans. |
| Review | `planning/reviews/<YYYY-MM-DD>-<topic>.md` | Periodic council-of-experts reviews (planning, code, etc.). Each review's "Recommended next moves" section is the master ledger linking to fix-tracking entries. **Always check the most recent review** before starting work — its checklist tells you what's currently in flight from the last sanity check. |

**Review-driven fixes follow a strict convention** so future agents discover them naturally:
- Items with a clear chunk home land as a `## YYYY-MM-DD <review-name> fixes` addendum at the bottom of the relevant `03-exec-<chunk>-<task>.md`.
- Genuinely cross-cut items get their own `03-exec-crosscut-<topic>-fix.md`.
- The review file's checklist forward-links to every addendum and cross-cut; each addendum/cross-cut back-links to the review.

To find every open review-driven item: `grep "code-review fixes" planning/03-exec-*.md` for addenda + `ls planning/03-exec-crosscut-*-fix.md` for cross-cuts. Both are obvious from filename or grep.

**Archive**: `planning/archive/` holds the pre-reset planning docs from the 20/21 Apr meetings onwards. They're valuable source material but no longer canonical. See `planning/archive/README.md`.

**Separation of concerns**: this root `CLAUDE.md` is for Cowork planning sessions. A separate `product/CLAUDE.md` will appear when Puma's product code gets scaffolded — that one is for Claude Code execution agents, not for planning sessions. Don't conflate them.

---

## Key references

| Thing | Where |
|---|---|
| PoC substrate (reference only, do not modify) | `chatgpt_poc/` (symlink to `../swoop/`) |
| PoC product code | `chatgpt_poc/product/` — `mcp-ts/`, `ts-common/`, `ui-react/`, `cms/`, `scripts/` |
| PoC sales material | `chatgpt_poc/sales docs/extracted/` — tone of voice, brand platform, sales process |
| Commercials (engagement + quote) | Obsidian vault: `Projects/Clients/Swoop/commercials/` |
| 30 Mar quote (the commercial fence) | [planning/00-project-proposal.md](planning/00-project-proposal.md) |
| Quoting notes (scope deferrals, time calibration, Julie's production bar) | [planning/00-project-proposal-notes.md](planning/00-project-proposal-notes.md) |
| Meeting capture (20/21 Apr) | `planning/archive/meetings/` |
| Research pack (UI, eval harness, agent architecture) | `planning/archive/research/` |
| Swoop data ontology (first-pass, transient) | `data-ontology.md` + `planning/02-impl-retrieval-and-data-source-exploration.md`. Retires when Monday 2026-04-27 SQL dump is modelled. |

---

## Working patterns

**Always:**
- Load the `swoop` skill at the start of any substantive conversation — it covers engagement context, people, day rate, voice.
- Prefer evolving PoC artefacts over greenfield authoring. Reuse is margin.
- Treat content (prompts, sales material, library data) as data, not code. Load at runtime; never inline.
- Match Al's voice in client-facing work (Luke: punchy, no fluff. Julie: product-detailed, honest about risk).
- **Inline comprehension for references.** When mentioning a commit sha, decision ID (`C.46`), Tier-3 task code (`D.t9`), plan filename, branch, or worktree, **always include the title or one-line context inline** — never the bare ID. Markdown links with descriptive titles are best (`[03-exec-c-t9.md — Gemini embeddings swap](planning/03-exec-c-t9.md)`). Tables of commits/decisions need a description column. If you don't know what an ID refers to, read it before parroting the reference. Al reviews dozens of in-flight items; bare IDs force a context-switch every time. Rationale + worked examples in [memory feedback_inline_comprehension_for_refs.md](../../.claude/projects/-Users-al-Studio-projects-swoop-web/memory/feedback_inline_comprehension_for_refs.md).

**Never:**
- Don't re-raise parked threads (Prompt Loom for Swoop, Platform48 joint pitch, original ChatGPT production launch workstream) unless Al explicitly opens them.
- Don't inline sales/brand content in TypeScript.
- Don't treat the PoC as "released" — it's demo-complete, never shipped.
- Don't pre-specify file paths, env vars, or component layouts at Tier 1 or Tier 2. That belongs in Tier 3 execution plans.

**Be careful about:**
- The `commercials/` Obsidian files occasionally deadlock when Box is syncing. If a `Read` fails with EDEADLK, fall back to the Box MCP.
- The `swoop` skill's PoC path references use `~/studio/projects/swoop/` lowercase; the actual repo is at `~/Studio/projects/swoop/` (capital S). Same location, case-insensitive on macOS. The symlink `chatgpt_poc` -> `../swoop` in this repo normalises the access path.
- The **understand-anything** plugin (`/understand` builds a code knowledge graph of `product/`; `/understand-dashboard` browses it — a codebase-comprehension aid for planning) serves its dashboard on **port 8173, not Vite's default 5173**: `product/ui/` owns 5173 with `strictPort`, so a dashboard there hard-fails the UI dev server. The plugin-cache `vite.config.ts` is patched to default to 8173; if a plugin update resets it, launch with `--port 8173`. Graph output lives under gitignored `product/.understand-anything/`.

---

## Current state

- Planning reset performed 2026-04-22. New Tier 1 top-level plan at `planning/01-top-level.md`. Prior docs archived.
- Next step: produce Tier 2 implementation plans per roadmap chunk (A–H in the Tier 1 plan). Start with A (foundations) because it roots the dependency graph. Content chunk G can run in parallel.
- Friday 24 Apr data-access hackathon superseded: Swoop engineering committed to a full SQL dump on Monday 2026-04-27. That reshapes Tier 2 chunk C §2.1 — ingest the dump, map against the first-pass ontology, then decide steady-state extraction. See `data-ontology.md` and `planning/02-impl-retrieval-and-data-source-exploration.md`.
- Awaiting from Swoop: GCP "AI Pat Chat" IAM, Patagonia sales-thinking doc from Luke + Lane, Claude account clarification, sales inbox + SMTP, legal review.
