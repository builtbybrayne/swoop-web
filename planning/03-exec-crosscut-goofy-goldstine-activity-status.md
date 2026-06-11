# 03 — Execution: Crosscut — Activity status line (human-friendly "what the agent is doing" beside the thinking dots)

> **Status**: RATIFIED for execution (Alastair, 2026-06-11 HITL session, worktree `goofy-goldstine-2ed1c1`) — authored and dispatched in the same wave as the [pricing-data](03-exec-crosscut-goofy-goldstine-pricing-data.md) and [find-options-reshape](03-exec-crosscut-goofy-goldstine-find-options-reshape.md) plans. Decision IDs proposed `D.goofy-goldstine-{10..}`.
>
> **The ask (Alastair, verbatim-in-spirit)**: tool calls can be a bit long; where we have the three loading dots, show a human-friendly message about what the agent is doing. Not richly informative — just enough to indicate stuff is happening and progress is being made. **Ephemeral**: any new update replaces the old one; there is only ever ONE statement alongside the dots.
>
> **Workspaces touched**: `@swoop/ui` (one part component + channel extension), `cms/` (copy as data). **No orchestrator change, no wire change, no schema change.**
>
> **Collision note**: runs in parallel with the reshape plan (which moves widget *registrations*) and lands after the 2026-06-11 widget-beautification merge (`0342b75`). This plan touches `parts/`, not `widgets/` — disjoint files. A parallel styling agent is active: keep the diff tight and the visual treatment minimal (slate, small, quiet — match the existing dots); restyling is theirs.

---

## ★ Read this first — the machinery that already exists (verified 2026-06-11)

1. **The three dots** are [text-thinking-indicator.tsx](../product/ui/src/parts/text-thinking-indicator.tsx): shown iff assistant message `status.type === 'running'`, no non-empty text part yet, **and no tool-call part still in flight** — that fourth condition deliberately suppressed the dots during tool calls because widget loaders used to cover that gap. Since the visual-sidebar relocation, widgets (and their loaders) live in the sidebar, so during a long tool call the **chat column shows nothing** — exactly the dead air this plan fills.
2. **Tool-call starts are already on the wire.** assistant-ui `tool-call` parts stream with `state: 'input-available'` (carrying `toolName`, `toolCallId`, `input`) before `output-available` ([chat.ts:302-321](../product/orchestrator/src/server/chat.ts) instruments exactly this lifecycle server-side). The UI can derive "what's happening right now" entirely client-side from the in-flight message's parts. **No new SSE frames.**
3. **An ephemeral status-line affordance already exists — extend it, don't duplicate it.** Decision D.10 + `planning/02-impl-chat-surface.md` §2.3: the agent can emit `<fyi>` blocks → `data-fyi` parts → [fyi-renderer.tsx](../product/ui/src/parts/fyi-renderer.tsx) renders an ephemeral status line, coordinated through the module-scoped pub/sub in [fyi-channel.ts](../product/ui/src/parts/fyi-channel.ts); [fyi-signaling-text.tsx](../product/ui/src/parts/fyi-signaling-text.tsx) emits `text-arrived` on first real text, which fades the status line. This was Alastair's original "agent narrates what it's thinking about" idea, landed as an *agent-authored, probabilistic* channel. This plan adds the *deterministic* complement (tool-derived), sharing the same display discipline. **Read fyi-renderer.tsx + §2.3 before writing any code.**
4. **Copy is content, not code** (G.11 / product/CLAUDE.md): the friendly per-tool strings live in `cms/`, mirroring the [errors copy pattern](../product/cms/errors/en.json) and its loader. Never inline the strings in TSX.

## 1. Outcome

While the agent is working and no reply text has started, the chat column shows the dots **plus one quiet line** about the current activity ("Browsing trip ideas…", "Checking prices…"). Each new signal replaces the previous (one slot, ever). The line clears the instant reply text starts streaming (existing `text-arrived` signal) or the run completes. Agent-authored `<fyi>` updates and tool-derived updates share the same single slot — most recent signal wins. No layout shift beyond the line itself; accessible (`role="status"`, `aria-live="polite"`); brand-skinnable via `data-swoop-part`.

## 2. Target functionalities

### 2.1 Copy as data — `cms/ui/tool-status.en.json`

One friendly present-progressive line per tool, plus a generic fallback. Starter copy (Swoop voice: warm, plain, no jargon — editorial pass is Alastair's, post-merge):

```json
{
  "find_inspiring":   "Gathering some inspiration…",
  "find_someone_who": "Finding stories from travellers like you…",
  "find_proof":       "Pulling together traveller reviews…",
  "find_tips":        "Digging out tips from past travellers…",
  "find_options":     "Browsing trip ideas…",
  "show_options":     "Putting together a shortlist…",
  "lookup":           "Checking Swoop's guides…",
  "illustrate":       "Finding a picture worth showing you…",
  "get_pricing":      "Checking prices…",
  "handoff":          "Getting your specialist introduction ready…",
  "_default":         "Looking that up…"
}
```

Include entries for `show_options` / `get_pricing` even though those tools land in the sibling plans — an unknown tool name falls back to `_default`, so this file is forward-safe regardless of merge order. Loader mirrors the errors-copy loader (find it via the `getToolErrorCopy()` usage); add a tiny schema test (every value non-empty, `_default` present).

### 2.2 Status derivation + single-slot display

Evolve [text-thinking-indicator.tsx](../product/ui/src/parts/text-thinking-indicator.tsx) into an **activity indicator** (keep the file/export, extend behaviour — it's already mounted in the right place in App.tsx, after `MessagePrimitive.Parts` in the assistant branch):

- **Show** when `role === 'assistant'` AND `status.type === 'running'` AND no non-empty text part. **Drop the no-pending-tool-call suppression** (fact 1 — the gap it deferred to no longer has an in-column signal). Completed messages keep suppressing (unchanged).
- **Status text**: derive from the message parts on each render — the **latest** `tool-call` part with no result yet maps `toolName → copy` via the cms map (`_default` for unknown names). No pending tool → dots alone (the silent composing gap keeps its current treatment, now with the option of agent-authored fyi text below).
- **One slot**: tool-derived text and the D.10 `<fyi>` line must not stack. Reconcile through [fyi-channel.ts](../product/ui/src/parts/fyi-channel.ts): emit a `tool-status` event (extend the channel's event union) when the derived text changes; the renderer that owns the visible line shows **the most recent signal** (fyi text or tool text), and `text-arrived` clears everything (existing behaviour). The executing agent decides which component owns the visible line (indicator vs fyi-renderer) after reading both — the acceptance criterion is behavioural: **never two lines, always replaced, always cleared on text.**
- Visual: dots as today + the line in the same quiet register (`text-slate-400`, small); `data-swoop-part="activity-status"` on the text span; `role="status"` `aria-live="polite"` (pattern already on the indicator).

### 2.3 Tests

Extend the existing parts tests (`product/ui/src/parts/__tests__/`):
- pending tool-call → its copy renders; second tool-call replaces the first (one slot);
- tool completes, no text yet → dots remain, tool text drops (or persists until next signal — pick one, assert it, document why in the component header);
- first text token → line gone (reuses the `text-arrived` channel test pattern);
- unknown toolName → `_default`; completed historical messages render nothing.
- **The provider-scope lesson** ([discoveries 2026-05-13](../discoveries.md)): test through the same provider tree the app uses, or pass state in as props — do not mock `useMessage` into meaninglessness.

## 3. Decisions (proposed)

- **D.goofy-goldstine-10** — Activity status is derived client-side from streamed `tool-call` parts; no orchestrator or wire change. Deterministic tool-derived text complements (not replaces) the D.10 agent-authored `<fyi>` channel; both share one display slot, latest-wins, text-arrival clears.
- **D.goofy-goldstine-11** — Per-tool status copy is cms content (`cms/ui/tool-status.en.json`), `_default` fallback, forward-safe for tools that don't exist yet.

## 4. Out of scope

- Arg-aware messages ("Searching kayaking trips in Aysén…") — the `input` is available client-side, so this is a cheap future enhancement; v1 is static per-tool.
- Any change to the dev-mode diagnostic boxes (they are diagnostics, not UX).
- Prompt changes encouraging more `<fyi>` emission (chunk-G surface; revisit after observing the deterministic layer live).
- Styling beyond the quiet default — the parallel styling agent owns visual polish.

## 5. Verification

1. Unit tests above, green in `@swoop/ui`.
2. Live smoke against the local stack: a query that triggers a slow tool shows dots + line in the chat column; line swaps when a second tool fires; vanishes on first text. Screenshot in the execution log.
3. Fresh-install `npm install && npm test --workspaces` at the branch tip.

## 6. Estimate

~0.5 day including tests and live smoke.
