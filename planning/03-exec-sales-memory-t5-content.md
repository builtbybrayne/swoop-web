# 03-exec — Sales-Memory T3-5: the prompt/content surfaces

**Status**: DRAFT, 2026-06-16. Pending ratification. Part of [02-impl-sales-memory.md](02-impl-sales-memory.md) (T2). Implements decisions **sm-3** (explicit-trigger + confirm + no-inference), **sm-6** (authoritative + dated framing), **sm-8** (content-hygiene / no-customer-PII).
**Workspace**: `cms` (content-as-data, theme 2). **Authorship is Alastair's** (G.7 — Claude drafts, Al edits; this is taste-driven voice work). Runs in parallel with the code T3s.

> **Altitude note**: this brief names the surfaces and the behavioural contract each must encode. The drafting is prose; the final voice pass is Alastair's.

---

## Purpose (and where it sits)

Three small authored surfaces carry the behavioural contract the code can't enforce on its own. They're where the golden-circle framing lands in words: the memory agent must capture knowledge *deliberately and succinctly*; the conversational agent must stay the faithful public agent except for recognising an explicit memory instruction; and the loaded memories must read as *authoritative-but-dated*. All three are content, so they live in `cms/` and load at runtime — never inlined in TypeScript.

## Context to respect (read before drafting)

- **`00_why.md`'s conventions** — the MoSCoW tagging, the three-voice convention (Prompt Engineer / We / You), and especially the *"engage, don't perform alignment"* / *"shape-guidance, not source-content"* NB discipline. The memory framing must consciously **invert** the last one for the memory block (these *are* source content) while staying in the same voice.
- **The §5 staleness pattern** — `00_why.md` already teaches the agent to weigh pricing figures against the dateline (B.t12). The memory framing reuses that exact instinct for time-sensitive memories (seasonal, pricing): read a dated note relative to today.
- **The no-inference + faithful-testing invariants** (sm-1, sm-3) — the conversational addendum must *only* add "recognise an explicit memory instruction and enter memory mode"; it must not change anything a staff member is testing, and it is **absent from visitor sessions**.

## What to author

1. **The memory-mode wrapper** (the Opus agent's instructions, T3-3): explicit-trigger recognition; the **confirm-before-write** step (*"Capturing this as a memory: '…' — right?"*); dedup / conflict-check against the current store; succinct phrasing; **no-inference** (persist only what's instructed; may *suggest*, writes on explicit yes); the **content-hygiene guard** (sm-8 — a memory must not describe a specific customer, because its text loads into public conversations); and the **`finish_memory` handback rule** (hand back when the turn stops being a memory instruction; confirm-on-doubt).
2. **The conversational-agent staff addendum** (loaded *only* in staff sessions, T3-2/T3-3): "if the staff member explicitly instructs you to remember/update/forget something, that's a memory instruction — signal the mode flip rather than answering it as a visitor would." Nothing else; production behaviour is otherwise untouched.
3. **The authoritative-knowledge framing header** for the loaded memory block (T3-4): marks the block as current, authoritative Swoop team knowledge the agent **MAY state as fact** (distinct from the illustrative examples elsewhere), and tells it **how to read the per-memory timestamps** for staleness against the dateline.

## Sibling deliverable — the static seasonal stopgap (independent, ship-now)

The **same framing header** (#3) is what the near-term static `product/cms/prompts/system/20_field-notes.md` needs (T2 §9): an always-on fragment seeded with the seasonal facts currently trapped in conditionally-loaded skills (`arrived-with-ai-itinerary`, `engaging-a-planner`, `group-tour-surfacing-for-solos`, `pattern-budget-solo-traveller`) + the Southern-Hemisphere season-inversion anchor drafted in [inbox.md](../inbox.md) 2026-05-18. It closes Luke's seasonality feedback this week with zero code (the loader already concatenates `system/NN_*.md`); the Postgres store later supersedes it without changing how the agent loads it. **Authoring is Alastair's, on his go.**

## Verification intent (behavioural)

- The memory agent never writes without an explicit confirmed instruction; it surfaces redundancy/conflict; it refuses customer-specific content.
- A staff member testing as a visitor gets byte-identical public behaviour; only an explicit memory instruction flips the mode.
- The loaded block reads as authoritative + dated; the agent states a current seasonal fact confidently and ages a stale one against the dateline.
- These are exercised through the `luke-` harness family (the project's acceptance gate) — add a seasonality / date-relative scenario.

## Scope guards (YAGNI)

English only. No behaviour/voice authoring here (that stays the Google-Doc → prompt-engineer loop, per the workflow docs) — this is the *knowledge* slice's framing only.
