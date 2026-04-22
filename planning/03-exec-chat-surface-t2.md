# 03 — Execution: D.t2 — Streaming consumption + response-format rendering

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: D (chat surface).
**Task**: t2 — consume orchestrator SSE stream, render the four response-format block types correctly.
**Implements**: `planning/02-impl-chat-surface.md` §2.3 + decisions D.9 (no reasoning rendered) + D.10 (ephemeral `<fyi>`).
**Depends on**: D.t1 (scaffold), B.t4 (translator), B.t5 (SSE endpoint).
**Produces**: Rendering logic for `text` / `tool-call` / `reasoning` / `data-fyi` message parts. Verifies `reasoning` parts never reach the UI.
**Unblocks**: D.t3 (widgets hook into tool-call parts).
**Estimate**: 2–3 hours.

---

## Purpose

Close the loop on the response format. `<utter>` → text parts → visible chat (done by assistant-ui defaults in D.t1). `<adjunct>` → tool-call parts → widget registry (D.t3). `<reasoning>` → stripped before reaching D (chunk B's translator handles this; D asserts on it). `<fyi>` → ephemeral side-channel affordance (custom render).

Most of the work here is the `<fyi>` ephemeral renderer + the assertion that reasoning never arrives.

---

## Deliverables

### `product/ui/src/parts/`

| File | Role |
|---|---|
| `parts/fyi-renderer.tsx` | Renders `data-fyi` custom parts as ephemeral side-channel affordances. Default treatment: narrow status line beneath the active assistant message, auto-fades on `text` part arrival or after a configurable timeout. Uses CSS transitions for fade. |
| `parts/index.ts` | Registers custom part renderers with assistant-ui. Registers the `data-fyi` renderer. No other custom parts yet. |
| `parts/reasoning-guard.ts` | Dev-mode assertion: if a `reasoning` part arrives at the UI, throw a visible error with a pointer to the chunk B translator. Production-mode: silently drop. This is a safety net against translator bugs. |

### Integration

- `App.tsx` (from D.t1) imports `parts/index.ts` to register the renderers.
- No changes to `runtime/orchestrator-adapter.ts` needed — the adapter already streams parts; this task just renders them.

### Tests

`product/ui/src/parts/__tests__/fyi-renderer.test.tsx` — Vitest + React Testing Library:
- Renders a single `<fyi>` status line.
- Auto-fades after timeout.
- Fades on subsequent `text` part arrival.
- Stacks correctly when multiple `<fyi>` parts arrive in sequence (latest replaces / overlays).

`product/ui/src/parts/__tests__/reasoning-guard.test.tsx`:
- In dev-mode, a reasoning part triggers the guard.
- In production-mode, no error surface.

### Network inspection check (manual or automated)

Run a live session against the orchestrator and confirm via browser DevTools Network tab that no SSE event contains `type: "reasoning"`. Capture as a screenshot in the PR.

---

## Key implementation notes

### 1. `data-fyi` custom part type

AI SDK v5 supports typed custom parts. Define the `data-fyi` type in `@swoop/common/src/streaming.ts` (authored by A.t2; confirm it's there or add). Shape: `{ type: "data-fyi", data: { message: string, timestamp: string } }`.

### 2. Ephemeral rendering

The `<fyi>` affordance is visually lightweight — small text, subtle colour, below the active agent response. No chat-bubble styling. It's a status signal, not a message.

### 3. Reasoning must never arrive

If the dev-mode guard fires, it's a bug in chunk B's translator. The guard's error message should say that.

### 4. Accessibility

`<fyi>` status line uses `role="status"` + `aria-live="polite"` so screen readers announce it without being disruptive.

### 5. `<adjunct>` rendering — NOT here

D.t3 wires widget renderers to tool-call parts. D.t2 leaves tool-call parts to assistant-ui's default rendering (probably nothing visible, or a generic placeholder — that's fine at this stage).

---

## References

- `planning/02-impl-chat-surface.md` §2.3 (mapping table).
- `planning/02-impl-agent-runtime.md` §2.4 (reasoning-strip contract).
- AI SDK v5 custom data parts docs.

---

## Verification

1. A live session streams `<fyi>` messages — they appear as ephemeral status lines, then fade.
2. `<text>` arrival visually cues `<fyi>` to fade.
3. Multiple rapid `<fyi>` parts update the same line (don't stack into a growing list).
4. No `reasoning` parts appear in the SSE network panel.
5. Dev-mode reasoning-guard test triggers correctly if one is injected artificially.
6. Accessibility: a screen reader announces `<fyi>` messages as status updates, not as new chat turns.

---

## Handoff notes

- `<fyi>` visual treatment is open (§2.3 of Tier 2 D says "Tier 3 UX call"). The default above (status line, auto-fade) is fine; Al may want to iterate post-M1.
- Don't render tool-call widgets here — D.t3.
- Don't handle error states here — D.t5.
- If chunk B's translator turns out not to strip reasoning correctly, **fix it in B**, not by filtering reasoning out here. The guard is a safety net, not a filter.
