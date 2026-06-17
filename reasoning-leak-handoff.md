# Handoff — agent leaks its reasoning / tool-narration as visible text

**Status:** root-caused, no fix applied (decision on approach still open). Investigation made **no code changes**.
**Date:** 2026-06-17. **Worktree:** `/Users/al/Studio/projects/swoop_web/.claude/worktrees/luke-questioning-tone` (branch `claude/...`).

---

## TL;DR
The conversational agent prints its planning as visible text **before** the answer — e.g. *"I'll start by checking the pattern library… This opening is wide open — a Browser or early Dreamer, let me load those postures…"* — then the real answer is concatenated on. Root cause: the reasoning-isolation design was re-architected from `<reasoning>`/`<utter>` **tags** to **native Anthropic thinking blocks** (decision **B.13**), but the native *producer* side was never wired — `thinking` is never enabled on the request **and** the system prompt never got the "reason in thinking / work silently" instruction. **Not caused by the model picker** — the default Sonnet 4.5 leaks too.

## Problem (worked example, Opus 4.8 — but Sonnet 4.5 does it too)
```
"I'll start by checking the pattern library…"                     ← LEAK
[list_skills]
"This opening is wide open — a Browser or early Dreamer.
 Let me load those postures…"                                     ← LEAK
[load_skill] [find_inspiring] [illustrate]
"Patagonia is one of the planet's last great wildernesses…"       ← the actual answer
```
Secondary symptom: missing space at the join (`…alive.Patagonia`) — the UI adapter concatenates separate text MessageParts with no separator.

## Findings (root cause)
- **Design history.** B.9 ([planning/02-impl-agent-runtime.md](planning/02-impl-agent-runtime.md) §2.5a) specced a 4-block format `<reasoning>` / `<utter>` / `<adjunct>` / `<fyi>` with a state-machine parser; `<reasoning>` stripped from the wire, `<utter>` = visible text. Decision **B.13** ("Response format — B.9 resolved" in [planning/decisions.md](planning/decisions.md)) **dropped the tags** for native channels: reasoning → **thinking blocks** (stripped), adjunct → tool calls, utter → plain text; only `<fyi>` kept a parser.
- **Strip half is BUILT + tested:** [reasoning-filter.ts](product/orchestrator/src/translator/reasoning-filter.ts) strips `type:'reasoning'` unconditionally; [claude-llm.ts:249-276](product/orchestrator/src/agent/claude-llm.ts) maps Anthropic thinking blocks → `Part.thought=true` on ingest.
- **Producer half was NEVER wired** (both ends):
  1. `thinking` is **never set on the Anthropic request** — see params at [claude-llm.ts:182-192](product/orchestrator/src/agent/claude-llm.ts); the file header (`:37-41`) lists thinking under *"What is still NOT wired… future optimisation, not Puma-critical."*
  2. The **system prompt has no instruction** to reason-in-thinking, emit `<fyi>`, or avoid narrating tool use — confirmed across [00_why.md](product/cms/prompts/system/00_why.md) + [10_style-avoid.md](product/cms/prompts/system/10_style-avoid.md) (the only two prompt files). B.13 deferred this to "chunk G's prompt, authored later," but it never crossed from the runtime decision into the content track ([planning/02-impl-content.md](planning/02-impl-content.md)).
- **Consequence:** the model has no reasoning channel and no discipline, so it narrates in plain `text`. The `list_skills → load_skill` skill choreography gives it several tool hops to narrate across.
- **Why it lapsed:** cross-track handoff gap (engineering decision B.13 forward-referenced the content chunk; never transcribed) + the code half filed "not Puma-critical" and tracked nowhere (not in next-steps/progress/gotchas) + the built+tested strip half created false completeness ("built the consumer, never connected the producer"). Mild on Sonnet (what was tested); amplified by the recent tool-heavy skills flow and by Opus via the model picker.
- **Not the picker / not a filter bug:** the differential repro shows zero `reasoning`-type parts (filter works); these are genuine `text` parts. Sonnet 4.5 leaks 1 segment, Opus 4.8 leaks 2. Likely also behind Luke's 16/06 "responses got longer."

## How to reproduce
- `.env` files were copied from the main repo into this worktree (gitignored); `MODEL_PICKER_ALLOWLIST=claude-opus-4-8,claude-sonnet-4-6,claude-fable-5` was appended to `product/orchestrator/.env` to enable the dev model picker.
- **Stack standup** (from `product/`): `npm run dev -w connector` (:3002) → `npm run dev -w orchestrator` (:8080, needs connector up + the session Postgres reachable via the copied `.env`, `SESSION_BACKEND=postgres`) → optional `npm run dev -w ui` (:5173). At handoff: connector + UI were up, **orchestrator was stopped — restart it**.
- **Differential repro (curl):** `POST /session` → `PATCH /session/:id/consent {"granted":true,"copyVersion":"v1"}` → `POST /chat {"sessionId":…,"message":"Tell me about Patagonia","model":"<id>"}`. Parse the SSE `data:` MessageParts in order; any `text` segment emitted **before/between** tool-calls is the leak. Omit `model` for the default Sonnet 4.5; set `claude-opus-4-8` / `claude-fable-5` to compare.

## Recommendations (approach NOT yet chosen — Alastair's call)
| Option | Cost | Reliability | Notes |
|---|---|---|---|
| **Prompt-only** — add "work silently; the visitor never sees your working / tool use" to the system prompt | ~zero, no latency, no rebaseline | moderate (model drift) | fastest bleed-stop |
| **Structural** — UI adapter surfaces only the text after the last tool-call | zero latency/token; deterministic | high, but hides cause | small risk of dropping legit interstitial prose; fits this agent's "answer-after-tools" shape |
| **Enable native `thinking` (completes B.13)** | latency +secs/turn; **harness re-baseline**; per-family config | high + likely quality uplift | the architecturally-correct end-state |

**Native-thinking gotchas (if chosen):**
- Default model is **Sonnet 4.5**, which only supports old-style `{type:'enabled', budget_tokens:N}` (adaptive is 4.6+); budget must sit under `max_tokens`, and `ORCHESTRATOR_MAX_TOKENS` is currently **2048** → bump it, **or move the default to Sonnet 4.6** (same price tier, clean adaptive thinking — the picker makes this trivial to trial).
- Per-family branching needed (Sonnet 4.5 = enabled+budget; Sonnet 4.6 / Opus 4.6+ / Fable = adaptive). Sampling-param stripping for Opus 4.7+/Fable already exists — see `modelAcceptsSamplingParams` in [claude-llm.ts](product/orchestrator/src/agent/claude-llm.ts).
- Thinking changes outputs → **re-run the judged Luke harness baseline**.
- Even with thinking, keep a prompt belt; the whitespace-concat is a separate small adapter fix in [orchestrator-adapter.ts](product/ui/src/runtime/orchestrator-adapter.ts) (`translatePart` text handling).

**Suggested path:** cheap mitigation now (prompt ± structural) to stop the leak today; schedule native thinking as the proper completion, paired with moving the default to Sonnet 4.6 + a harness re-baseline.

## Key files
- [product/orchestrator/src/agent/claude-llm.ts](product/orchestrator/src/agent/claude-llm.ts) — request params (`:182-192`), thinking ingest (`:249-276`), deferral note (`:37-41`)
- [product/orchestrator/src/translator/reasoning-filter.ts](product/orchestrator/src/translator/reasoning-filter.ts) — the (working) strip half
- [product/orchestrator/src/translator/block-parser.ts](product/orchestrator/src/translator/block-parser.ts) — the surviving `<fyi>` parser
- [product/ui/src/runtime/orchestrator-adapter.ts](product/ui/src/runtime/orchestrator-adapter.ts) — text-part concatenation (whitespace symptom)
- [product/cms/prompts/system/00_why.md](product/cms/prompts/system/00_why.md), [10_style-avoid.md](product/cms/prompts/system/10_style-avoid.md) — system prompt (no output-format instruction)
- [planning/decisions.md](planning/decisions.md) — decision **B.13** ("Response format — B.9 resolved")
- [planning/02-impl-agent-runtime.md](planning/02-impl-agent-runtime.md) §2.5a — the original 4-block design

## Worktree state at handoff
- Model picker committed: UI `308d557`, backend `e29fda2`, T3 plan `32fd433`. Only uncommitted change: an unrelated unstaged "friendly" edit to `product/cms/prompts/system/00_why.md`.
- This investigation made no code changes. Once a fix lands, this finding is worth a [discoveries.md](discoveries.md) entry ("reasoning-strip pipeline built but `thinking` never enabled → model narrates in visible text").
