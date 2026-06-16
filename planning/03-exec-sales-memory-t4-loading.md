# 03-exec — Sales-Memory T3-4: loading memories into every conversation

**Status**: DRAFT, 2026-06-16. Pending ratification. Part of [02-impl-sales-memory.md](02-impl-sales-memory.md) (T2). Implements decision **sm-6**.
**Workspaces**: `orchestrator` (read + inject), `cms` (the framing header — coordinated with T3-5).
**Sequences**: after T3-1 (needs the read-active-set query). Independent of T3-2/T3-3 — loading happens for *every* session regardless of staff status.

> **Altitude note**: the executing agent owns where exactly the block sits in the assembled instruction and the precise SQL; this brief fixes the load semantics and the cache/staleness constraints, which are the load-bearing parts.

---

## Purpose (and where it sits)

This is the half that makes authored memory *do* anything: the agent must actually hold the knowledge on every turn. It closes the loop that serves the WHY — sales knowledge authored once (T3-1/3) reaches every visitor conversation here. It is also the half that earns Luke's specific feedback: the seasonal facts become something the agent *states*, and (with the timestamp) reasons about for staleness.

## Context to respect (read before building)

- **The system prompt is assembled per turn.** `factory.ts:120` wires `instruction` as an `InstructionProvider` (`() => promptLoader.load() + skills-injection`), re-resolved each invocation. The memory block is read + spliced in here. (The dateline, by contrast, rides the *user* message per B.t12 — that's per-turn dynamic data; memories are stable knowledge and belong in the cached system instruction.)
- **Prompt caching is real** — the system block carries `cache_control: ephemeral` (`claude-llm.ts`, Perf-1). So: read the active set each turn and assemble a **byte-identical** block between writes → the cache still hits; a write changes the text → one cache-bust, then steady again. Keep the order **stable** (the T3-1 query's deterministic ordering) or you'll bust the cache for nothing.
- **No app-level cache** (sm-6). Read from Postgres each turn (one indexed query, T3-1). It's shared by construction, so every Cloud Run instance folds in a change on its next turn with zero invalidation logic — this is the cross-instance correctness Alastair required; the earlier in-process-cache idea is explicitly dropped. (A shared version-marker row to *skip* the read is a future optimisation only — YAGNI now.)
- **Authoritative framing vs the "source-from-tools" discipline** — `00_why.md` deliberately tags its illustrative examples *"shape-guidance, not source-content; source specifics from your tools."* The memory block must carry the **opposite** signal: a header marking these as current, authoritative team knowledge the agent **MAY state as fact**. Without it, the agent's existing illustrative-only reflex makes it hedge on the very facts we inject. (Header copy is authored in T3-5.)
- **Timestamps in-prompt** (sm-6) — each memory carries its `updated_at` (+ author) in the block, so the agent can weigh age against the dateline. This mirrors the §5 pricing-contemporaneity pattern already in `00_why.md`; a dated "this season" note is read relative to *today*.

## What to build

1. **Read the active set each turn** (T3-1's query) inside the instruction-assembly path.
2. **Assemble the block**: the authoritative header (T3-5) + each active memory rendered with its timestamp + author, in stable order.
3. **Splice into the instruction** for **every** session (visitor + staff alike — visitors only read; staff additionally write via T3-3). Placement relative to the brief + skills injection is the executing agent's call; keep it cache-stable.

## Verification intent

- A memory written in one session is reflected in the **next turn** of a *different* session (simulate two orchestrator instances against one DB → cross-instance propagation, no restart).
- Each memory's timestamp + author appears in the assembled instruction.
- Between writes the assembled block is byte-identical (cache holds); a write busts it once.
- A dated seasonal memory is reasoned about relative to the dateline (behavioural — overlaps T3-5 verification).

## Scope guards (YAGNI)

No app cache; no version-marker optimisation yet. No per-visitor filtering — the whole active set loads into every conversation (it's small, curated; the escalation ladder in T2 §10 is for later if it ever isn't).
