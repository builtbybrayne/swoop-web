# 03 — Execution: B.t4 — Streaming event translator (+ conditional block parser)

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: B (agent runtime).
**Task**: t4 — ADK events → AI SDK `message.parts` translator; strips `<reasoning>` from outbound; maps `<fyi>` / `<adjunct>` / `<utter>`.
**Implements**: `planning/02-impl-agent-runtime.md` §2.4 + §2.5a + decisions B.6 (translator location) + B.9 (response format).
**Depends on**: A.t2 (`streaming.ts` part types in `ts-common`), B.t1 (agent can be driven to produce events).
**Produces**: `product/orchestrator/src/translator/` — stateless-per-turn mapping ADK native events to the shared `message.parts` shape. Strips reasoning before outbound SSE.
**Unblocks**: B.t5 (SSE endpoint consumes translator output), chunk D (UI consumes the parts shape).
**Estimate**: 3–4 hours.

---

## Purpose

Turn ADK's native event stream into the `message.parts` shape chunk D consumes. Three sub-jobs:
1. Map ADK events (text tokens, tool-call lifecycle, reasoning parts if emitted) to `message.parts`.
2. **Strip `<reasoning>` from the outbound stream** while preserving it in session history (chunk B §2.6).
3. Handle the `<fyi>` / `<adjunct>` / `<utter>` convention — natively if ADK + AI SDK message parts cover them cleanly, else via a state-machine parser.

---

## Deliverables

### `product/orchestrator/src/translator/`

| File | Role |
|---|---|
| `translator/adk-to-parts.ts` | Core mapper. Async iterator over ADK events → async iterator over `message.parts`. Handles the canonical ADK event types. |
| `translator/reasoning-filter.ts` | Passes reasoning parts into the session-state accumulator but **does not yield them to the SSE consumer**. |
| `translator/block-parser.ts` | **Conditional**: state-machine parser for `<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>` XML-ish tags, for the case where the model emits free-text containing them instead of using ADK's structured events. **Skip this file entirely** if the Phase 1 spike shows native affordances cover the four concepts. If needed, the parser must be robust (see §2.5a in chunk B). |
| `translator/index.ts` | Composes the above into the stream pipeline called by B.t5's SSE endpoint. |

### Spike to decide conditional

Before writing `block-parser.ts`, run a short spike: configure the agent with a minimal prompt that asks it to emit `<fyi>` / `<utter>` / `<reasoning>` blocks in its response; observe what ADK produces on the event stream. If ADK's native `reasoning` events + AI SDK `data-fyi` custom parts + `tool-call` parts already cover the four concepts, no parser is needed — the prompt just emits structured output and ADK does the separation. If the model emits free text containing tag-ish markers, the parser is needed.

Document the spike outcome in `planning/decisions.md` as decision B.9 (response format) resolved.

### Tests

Extensive. This is the one place in B where unit tests earn their keep.

`translator/__tests__/adk-to-parts.test.ts` — happy-path mapping for every event type.
`translator/__tests__/reasoning-filter.test.ts` — reasoning parts go to session, don't reach outbound iterator.
`translator/__tests__/block-parser.test.ts` (if parser exists) — fuzz-test malformed input: inline tag mentions, missing newlines, 0/1/many block counts, partial blocks mid-stream. State machine must not regex.

Fixtures: record ADK event streams from real agent runs and commit them under `translator/__tests__/fixtures/`. Regenerate when ADK version updates.

### Chunk D alignment

Part types emitted by the translator match what chunk D's assistant-ui registry consumes. If chunk D's agent hasn't decided the exact part-type for `<fyi>`, coordinate via `ts-common` — not by independently deciding here.

---

## Key implementation notes

### 1. Stateless per turn

The translator holds no state between user turns. State lives in session (B.t2). This makes translation testable with fixture event streams.

### 2. Reasoning filtering is unconditional

Whether reasoning comes from an explicit ADK `reasoning` event, an AI SDK `reasoning` part, or a `<reasoning>` block in free text — it never reaches the outbound iterator. Always persisted to session.

### 3. Custom data parts for `<fyi>`

AI SDK v5 supports typed custom data parts (e.g. `data-fyi`). If the spike shows natives cover the concept, `<fyi>` → `data-fyi` part. Chunk D's UI renders `data-fyi` as ephemeral side-channel.

### 4. Tool-call lifecycle

Three states: `input-streaming`, `input-available`, `output-available`. Translator emits all three; chunk D's registry uses them to show widget loading / ready / result states.

### 5. Parser is fallback, not default

If the spike says natives cover it, don't build the parser "just in case". Dead code is worse than absent code.

### 6. Parser state machine, if built

Open / close tag tracking. Track depth — don't terminate a `<reasoning>` block just because it contains the string `<utter>`. Emit parts incrementally so streaming works end-to-end. Tests drive the design; if a test is hard to write, the design needs work.

---

## References

- AI SDK v5 docs — current `message.parts` shape + custom data parts.
- ADK docs — native event types and the streaming API.
- Chunk B §2.4 + §2.5a — the contract.

---

## Verification

1. Fixture-driven tests pass for all event types.
2. Reasoning never appears in the outbound iterator in any test.
3. Tool-call parts emit in the correct lifecycle order.
4. If parser exists: fuzz tests pass — inline tag mentions, missing newlines, partial blocks, 0/1/many block counts.
5. Integration check: B.t5 (next task) + B.t1 + this translator can stream a full turn to a `curl -N` consumer.
6. Spike outcome recorded in `planning/decisions.md`.

---

## Handoff notes

- Run the spike **first** before deciding whether the parser is needed.
- If you build the parser, favour clarity over cleverness — state machine with named states, one test per state transition.
- `message.parts` exact shape is a moving target in AI SDK v5; verify and pin.
- Do not implement event emission for observability here — chunk F owns events. Translator focuses on the user-facing stream.
