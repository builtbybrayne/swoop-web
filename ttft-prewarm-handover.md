# Handover — first-turn TTFT reduction via a consent-triggered greeting pre-warm

> **For the next agent (fresh context):** this is a *design-agreed, not-yet-built* workstream. Read this, then write a Tier-3 plan (`planning/03-exec-crosscut-consent-greeting-prewarm.md`) and execute it in a fresh worktree. The design below was ratified with Alastair on 2026-06-17; honour the decisions marked **DECIDED**.

## Goal

Cut the **time-to-first-token (TTFT)** of the visitor's *first* turn in the Puma discovery chat. Today the first turn takes ~20–29s (at `effort=high`) before the first visible answer token. Alastair's bar: "even 11s is too slow."

## Why this exists (background)

The reasoning-leak workstream (RL.1–8, **now merged to main** — see [planning/decisions.md](planning/decisions.md) RL.1–8 + [planning/03-exec-crosscut-reasoning-leak-native-thinking.md](planning/03-exec-crosscut-reasoning-leak-native-thinking.md)) wired native Anthropic thinking. That fixed the reasoning leak but made first-turn latency visible. We then measured TTFT thoroughly and established **where the time actually goes** — which rules out some "obvious" fixes:

### TTFT curve (msg "Tell me about Patagonia", sonnet-4-6, 2 runs each)

| config | TTFT (first answer token) | avg | first tool | total |
|---|---|---|---|---|
| `effort=high` (current default) | 20.1s · 29.4s | ~24s | ~3.8s | 25–34s |
| `effort=medium` | 11.0s · 15.5s | ~13s | ~3.4s | 15–19s |
| `effort=low` | 9.0s · 12.2s | ~11s | ~5.5s | 16–19s |
| **thinking OFF** (belt only) | 9.8s · 6.6s | **~8s** | ~2.5s | 12–19s |

### The key finding — the wall is the tool loop, not thinking

Thinking fully OFF (zero reasoning) **still floors at ~8s**. So:
- **`<reasoning>`/`<utter>` tags would NOT help** (Alastair asked). Tags are strictly slower than thinking-off (they still generate stripped reasoning tokens) and don't touch the tool loop — and they'd reintroduce the mid-stream tag-parsing brittleness B.13 deliberately escaped. The thinking-off **belt** (RL.3, already built) is the robust version of that instinct, and it held 0 narration-leak at ~8s.
- The ~8s floor = **~2–3s setup** (system-prompt processing — already prompt-cached, Perf-1 — + first-tool decision) **+ ~5s content loop** (`find_inspiring` vector search on the visitor's words + `illustrate` + a model continuation per hop). The content loop is query-dependent: it can't be pre-paid generically.

Decompose any TTFT measurement into setup-vs-content with the probe (below): watch `first tool-call frame` (≈ setup) vs `TTFT` (first text).

## The decided design — consent-triggered greeting pre-warm

When the visitor consents (the dead time before they type their first message), fire an internal turn that warms the session and **emits a user-facing hello**. This overlaps the warm-up with the user's read+compose time (free latency) and gives *presence* ("an AI is here, ready").

**DECIDED (Alastair, 2026-06-17):**
- **Trigger:** on consent grant (the consent button) **and** on page-reload-that-finds-prior-consent. **BUT** only greet on a *fresh* session with **no prior user turns**. If reload picks up a chat that's already visible + active, **do not** pre-warm/greet (don't hello into an existing thread).
- **v1 scope:** `setup session` + `load skills` + a **hello** text reply. **No image in v1.** (`illustrate` deferred — add later only if it reliably completes before the user finishes typing; measure its latency first.) Keep the greeting to the **minimum tool calls**.
- **Let the skill-load happen — do not try to optimise it away.** `list_skills`/`load_skill` fire in nearly every conversation despite the skills index already being in the system prompt; the agent clearly wants the trigger. So have the greeting do it and be done.
- **No race protection in v1.** Alastair will trial it; the greeting almost always wins (typing a sentence > greeting time). The likely permanent fix is a *general* "block send while a turn is in flight" (users double-input during normal chat anyway) — design that later, not now.

**Expected impact:** ~25% raw TTFT on turn 1 (pre-pays setup + cache + skills; the ~5s content loop stays), plus a larger *perceived* win from the hello. Pre-warming **pre-pays setup, not the query.**

## Mechanics & cautions (from reading the code)

- **The warm pool already exists but is disabled** (`WARM_POOL_SIZE=0`). Today it pre-creates the session + ADK session object only — **no model turn, no skill load, no cache warm**. See [product/orchestrator/src/session/warm-pool-bootstrap.ts](product/orchestrator/src/session/warm-pool-bootstrap.ts) + `warm-pool.ts`. The greeting is the *model-side* extension of this. (You may not need the pool at all — consent already gives you a real session to warm.)
- **The cache win is shared, not per-session.** Anthropic's ephemeral cache is keyed on the system+tools *prefix* (`cache_control: ephemeral`, Perf-1, in [claude-llm.ts](product/orchestrator/src/agent/claude-llm.ts)). A single heartbeat request every <5 min keeps the 71k-char system prompt warm for *every* visitor — cheaper than per-session priming for the cache portion. (Or bump to the 1-hour cache TTL beta.)
- **History pollution:** the greeting turn's messages land in session history. You can't cleanly strip them without losing the loaded-skill benefit (the `load_skill` result lives in that history). Make the greeting prompt produce a clean hello that turn 1 won't reference awkwardly.
- **The instruction provider is now async** (it appends the sales-memory block per turn — merged from main) and also folds in the RL.3 thinking belt; see [factory.ts](product/orchestrator/src/agent/factory.ts). Any greeting wiring must respect that.

## Open decisions / measure-first

1. **`effort` default** — still unset (→ `high`, ~24s). `medium` (~13s) or `low` (~11s) are the candidates; it's an **env var** (`ORCHESTRATOR_EFFORT`, RL.4) so it can change per-deploy with no code change. Alastair leaned toward reducing it but didn't finalise (he pivoted to the pre-warm idea). The boot log prints the active effort.
2. **Image on the greeting** — measure `illustrate`'s real latency (DB/URL lookup = cheap/feasible; generation = too slow). Gate the v1-no-image decision on this.
3. **Default opening skill/posture** — which skill should the greeting load? Pull the **opener distribution from `puma_session_event`** (B.t13 Postgres session store — see [discoveries.md](discoveries.md) 2026-06-11 "diagnose from puma_session_event") to see whether one default posture covers most first turns, and whether a *speculative pre-fetch* of `find_inspiring("Patagonia")` for the common broad opener is worth it (the only way pre-warming touches the ~5s content cost).
4. **Race handling** — deferred; revisit as a general in-flight send-block.

## Tools & pointers

- **TTFT probe:** [product/scripts/ttft-probe.py](product/scripts/ttft-probe.py) — `python3 product/scripts/ttft-probe.py "<message>" [label]`. Streams the SSE and timestamps the first answer token vs the tool loop. Needs the stack on :8080.
- **Routes:** [product/orchestrator/src/server/index.ts](product/orchestrator/src/server/index.ts) — `POST /session`, `PATCH /session/:id/consent`, `POST /chat`. Session bootstrap: [session-bootstrap.ts](product/orchestrator/src/server/session-bootstrap.ts). Chat pipeline: [chat.ts](product/orchestrator/src/server/chat.ts).
- **UI consent + send:** consent lives under `product/ui/src/disclosure/`; the send path is `sendMessage` in [product/ui/src/runtime/orchestrator-adapter.ts](product/ui/src/runtime/orchestrator-adapter.ts) — the greeting trigger hooks the consent-granted event there.
- **Dev stack (private ports, to avoid the main stack on 3002/5173):** connector `CONNECTOR_PORT=3003`, orchestrator `PORT=8080` + `CONNECTOR_URL=http://localhost:3003/mcp` (already in this project's `.env`s). **Restart order matters** — connector first, then orchestrator (see [gotchas.md](gotchas.md) "Orchestrator can't re-attach to a connector that restarted under it"). Boot via `npm run -w @swoop/connector dev` then `npm run -w @swoop/orchestrator dev`.
- **Verify a tool-using turn end-to-end** with a real `POST /session → PATCH consent → POST /chat` smoke before trusting the stack; a bare `/healthz` 200 doesn't prove the MCP session is live.

## Status of the parent workstream

Reasoning-leak RL.1–8 is **done and merged to main** (native thinking on, default `claude-sonnet-4-6`, `effort` unset → high). Leak verified gone by deterministic smoke. This TTFT work is the follow-on Alastair opened off the latency it surfaced.
