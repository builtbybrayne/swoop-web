# 03-exec — Sales-Memory T3-3: two-agent routing + the Opus memory agent

**Status**: DRAFT, 2026-06-16. Pending ratification. Part of [02-impl-sales-memory.md](02-impl-sales-memory.md) (T2). Implements decisions **sm-1** (separate Opus agent, Sonnet conversational unchanged), **sm-2** (orchestrator routing, not ADK transfer), **sm-3** (explicit trigger + handback).
**Workspace**: `orchestrator`.
**Sequences**: **the spike (below) runs FIRST — before T3-1/T3-2 are banked**, because it can shift the agent shape. The rest of this task follows once T3-2's staff flag exists.

> **Altitude note**: this is the riskiest task and the one place the framing has to be rock-solid; the executing agent owns the wiring. The spike is mandatory.

---

## The spike (do this first, ~½ day)

The one "does the framework allow this" unknown: **how the Opus memory agent gets the conversation history and runs.** Two candidate shapes — (a) two runners/agents sharing one ADK session (the B.t13 Postgres-backed session already holds the event history), or (b) read the stored transcript and run a separate Opus loop seeded with it. Build the smallest thing that proves one works end-to-end (a staff turn reaches Opus, Opus sees the prior Sonnet turns, can call a tool, hands back). **Report which shape, then proceed.** This is the standing real-Anthropic-smoke discipline (discoveries.md: boot-logs aren't enough when you touch the agent graph) — and it's Puma's *first* functional sub-agent, so it earns the live check.

> **Resolved 2026-06-16 (investigation + Alastair) → transcript-seeded separate session (option b).** Reading the run path ([index.ts](../product/orchestrator/src/index.ts), [chat.ts](../product/orchestrator/src/server/chat.ts)) showed the shared-session option (two runners, one `sessionService`) is *feasible* — the `Runner` takes an injectable `sessionService` (B.t13's `PgAdkSessionService`) and a second-agent-on-a-different-model is already proven (the Haiku triage classifier). But sharing the session means the memory-management dialogue lands in the **same event log the Sonnet agent reads**, polluting the staff member's *test* conversation on switch-back — a breach of faithful testing (sm-1). So the memory agent runs in its **own** session, seeded with a read of the conversation-so-far (already in `SessionState.conversationHistory`, maintained by `chat.ts`). Logged as **sm-9**. **Confirmed by a live Anthropic smoke (2026-06-16):** a fresh `InMemoryRunner` session, seeded with the conversation-so-far *via the first message* (no ADK event-seeding needed), ran an agent that confirmed-first (turn 1 → 0 saves) then called the stub `save_memory` on the explicit follow-up (turn 2 → 1 save — multi-turn in the seeded session), capturing a succinct, seed-grounded memory. Ran on the configured Sonnet — the mechanism is model-agnostic, so Opus is a config-string swap (already proven viable in-tree by the Haiku triage classifier); the only Opus-specific build step is confirming the exact model id. Throwaway spike not committed.

## Purpose (and where it sits)

This is the mechanism that lets a sales member *author memory inline without ever degrading the agent they're testing*. The conversational agent stays exactly the production agent (so testing is faithful); memory work happens on a smarter model, reached only when the staff member explicitly asks.

## Context to respect (read before building)

- **`factory.ts` already takes a `tools` array and wires `instruction` as a per-turn `InstructionProvider`.** The conversational (Sonnet) agent is built as today; the memory (Opus) agent is a second build — same base prompt, **+** the memory-mode wrapper (T3-5) **+** the memory CRUD tools (T3-1), **−** nothing removed from what makes the conversational agent faithful.
- **Model-per-agent is a config concern** (decision B.5) — Opus for the memory agent is a config value, not a code fork.
- **Theme 6 (single conversational agent) is preserved**: the memory agent is admin-only, staff-session-only, and never in a visitor's loop — exactly the functional-agent-behind-a-boundary B.4 permits. We are **not** reopening multi-agent for the conversational layer, and we are **not** using ADK inter-agent transfer (sm-2).
- **The orchestrator already routes per request** (the chat handler). Routing between two agents by a per-session `mode` flag (in the B.t13 session store, shared across instances — sm-2) is an extension of what it does, not a new paradigm.
- **`finish_memory` handback** (sm-3): an explicit signal Opus emits → the orchestrator flips `mode` back to `conversation`. Rule lives in the wrapper (T3-5): hand back the moment the turn stops being a memory instruction; confirm-on-doubt; user-exit backstop. Low-stakes + recoverable (re-entering is just another instruction).

## What to build (after the spike)

1. **Per-session `mode` flag** (`conversation` | `memory`) in session state; default `conversation`.
2. **The router** in the chat handler: dispatch the turn to the Sonnet agent or the Opus memory agent on the flag. Entry to `memory` is **only** an explicit, confirmed memory instruction in an authed staff session (sm-3) — never inferred, never in a visitor session.
3. **The Opus memory agent build** (model + memory-mode wrapper + CRUD tools + access to conversation history per the spike outcome).
4. **`finish_memory` → flip mode back.** Plus the explicit user-exit path.
5. **Conditional wiring**: the memory agent / mode handling exists only when T3-2's staff flag is set. Visitor sessions are byte-identical to today.

## Verification intent

- In a staff session: ordinary turns run **Sonnet** (faithful testing — provably same model/tools/prompt as production); an explicit "remember…" routes to **Opus**; `finish_memory` returns to Sonnet.
- A visitor session never routes to Opus and never exposes memory tools.
- A *test* utterance that merely resembles a memory instruction does not enter memory mode (the confirm step in T3-5 is the net).
- Real-Anthropic live smoke of the full round-trip (the agent-graph gate).

## Scope guards (YAGNI)

Orchestrator routing only — no ADK transfer. Admin-only sub-agent — no visitor-facing multi-agent. No proactive/inferred memory entry (sm-3). Staff sessions skip the warm pool (B.t10) — build the memory agent on demand.
