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

## Inbox & questions

Two append-only capture files live at the repo root. Both get periodically triaged.

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

---

## Planning structure

Four tiers at different altitudes. See `planning/01-top-level.md` for full detail.

| Tier | Where | What |
|---|---|---|
| 1 — Top-level | `planning/01-top-level.md` | Intent, JTBDs, themes, roadmap, parallelisation candidates. Principle-led, no component names. |
| 2 — Implementation (per chunk) | `planning/02-impl-<chunk>.md` | Per roadmap chunk: outcomes, target functionalities, architectural principles, PoC reuse pointers. No code. |
| 3 — Execution (per task) | `planning/03-exec-<chunk>-<task>.md` | Real components, file paths, interface signatures, verification steps. The brief a single Claude Code agent runs against. |
| 4 — Swarm | Not a doc | The parallel/serial Claude Code agent sessions that build from Tier 3 plans. |

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
| 30 Mar quote (the commercial fence) | `planning/archive/project_proposal.md` |
| Meeting capture (20/21 Apr) | `planning/archive/meetings/` |
| Research pack (UI, eval harness, agent architecture) | `planning/archive/research/` |

---

## Working patterns

**Always:**
- Load the `swoop` skill at the start of any substantive conversation — it covers engagement context, people, day rate, voice.
- Prefer evolving PoC artefacts over greenfield authoring. Reuse is margin.
- Treat content (prompts, sales material, library data) as data, not code. Load at runtime; never inline.
- Match Al's voice in client-facing work (Luke: punchy, no fluff. Julie: product-detailed, honest about risk).

**Never:**
- Don't re-raise parked threads (Prompt Loom for Swoop, Platform48 joint pitch, original ChatGPT production launch workstream) unless Al explicitly opens them.
- Don't inline sales/brand content in TypeScript.
- Don't treat the PoC as "released" — it's demo-complete, never shipped.
- Don't pre-specify file paths, env vars, or component layouts at Tier 1 or Tier 2. That belongs in Tier 3 execution plans.

**Be careful about:**
- The `commercials/` Obsidian files occasionally deadlock when Box is syncing. If a `Read` fails with EDEADLK, fall back to the Box MCP.
- The `swoop` skill's PoC path references use `~/studio/projects/swoop/` lowercase; the actual repo is at `~/Studio/projects/swoop/` (capital S). Same location, case-insensitive on macOS. The symlink `chatgpt_poc` -> `../swoop` in this repo normalises the access path.

---

## Current state

- Planning reset performed 2026-04-22. New Tier 1 top-level plan at `planning/01-top-level.md`. Prior docs archived.
- Next step: produce Tier 2 implementation plans per roadmap chunk (A–H in the Tier 1 plan). Start with A (foundations) because it roots the dependency graph. Content chunk G can run in parallel.
- Friday 24 Apr: data-access hackathon with Swoop engineering — testing whether API access replaces the scraping strategy. Outcome reshapes Tier 2 chunk C.
- Awaiting from Swoop: GCP "AI Pat Chat" IAM, Patagonia sales-thinking doc from Luke + Lane, Claude account clarification, sales inbox + SMTP, legal review.
