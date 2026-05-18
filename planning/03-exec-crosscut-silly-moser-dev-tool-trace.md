# 03 — Crosscut: DevToolCallTrace + universal wrapWithDevTrace HOC (silly-moser worktree)

**Status**: **POST-HOC BACKFILL** authored 2026-05-18, same session as the
execution. The work landed without a Tier-3 plan having been written first —
this file is provenance, not a pre-execution spec. Same convention gap as
the nice-knuth wave + the silent-placeholder companion; this backfill closes
the documentation hole so a future agent picking up dev observability or
the analytics chunk-F follow-on has a coherent record.

**Filename suffix `-silly-moser-`**: worktree-slug-stamped per the 2026-05-13
collision-avoidance discipline.

**Chunk**: Crosscut — UI registry (`parts/index.ts`) + render-boundary
plumbing (`widget-shell.tsx`); zero wire surface.
**Commit**: `90a78bf` (bundled with the silent-placeholder work — see
[`03-exec-crosscut-silly-moser-silent-placeholder.md`](03-exec-crosscut-silly-moser-silent-placeholder.md)).
**Merged to main**: `df08078`.

---

## What was asked for

Al's framing, immediately after the silent-placeholder work landed:

> "Are there any tool calls that don't have a widget component at all atm?
> I'd still like to know when they've been called somehow (within the chat
> view). In fact, I'd ideally like to see _every_ tool call have a special
> widget shown only in dev. It should allow me to see, the tool call, how
> long it took, the raw response, any errors, etc. Essentially as a
> transparent diagnostic for all tool calls while we're testing."

The ask is **universal coverage** — every tool call, irrespective of
whether the widget rendered real content, a silent placeholder, a malformed
card, or the loading state. A diagnostic surface that sits *below* (not
*instead of*) the widget's own render so the visitor-facing experience
remains observable alongside the diagnostic.

## What landed

| File | Change |
|---|---|
| [product/ui/src/widgets/widget-shell.tsx](../product/ui/src/widgets/widget-shell.tsx) | New exports: `DevToolCallTrace` (component), `wrapWithDevTrace(toolName, Inner)` HOC, plus internal `DevTraceField` / `DevTraceJsonField`. Re-exports `ToolCallMessagePartComponent` for caller convenience. Adds `useEffect`/`useRef` imports. `DevToolCallTrace` is a `<details>`-based collapsible card: collapsed summary shows `DEV` badge + tool name + `status.type` + `<n> ms` duration + `error` flag (when isError); expanded body shows `toolCallId`, `status.type`, `started`/`ended` ISO timestamps, `durationMs`, `isError` boolean, and `args`/`result` as pretty-printed JSON (`max-h-64 overflow-auto` so large payloads don't blow up chat). `startedAt` is captured via a lazy-init ref (stable across re-renders); `endedAt` is `useState` (not ref) so latching the end timestamp triggers a re-render and the duration display updates. `data-testid="dev-tool-trace"` + `data-swoop-tool=<name>` for assertion targeting. `wrapWithDevTrace` is a no-op pass-through when `!import.meta.env.DEV` — returns `Inner` unchanged so production builds carry zero overhead. |
| [product/ui/src/parts/index.ts](../product/ui/src/parts/index.ts) | Imported `wrapWithDevTrace`. `toolWidgetComponents` (from `widgets/index.ts`) is now passed through `Object.fromEntries(Object.entries(...).map([name, C] => [name, wrapWithDevTrace(name, C)]))` to produce `wrappedToolComponents`. The `RawToolFallback` bridge is similarly wrapped to produce the registered `ToolFallback`. The `MessagePrimitive.Parts` `tools.by_name` slot now receives `wrappedToolComponents` rather than the raw map. |
| [product/ui/src/widgets/__tests__/dev-tool-trace.test.tsx](../product/ui/src/widgets/__tests__/dev-tool-trace.test.tsx) | New test file. Six cases: HOC composes wrapped widget + trace card below; collapsed summary text content; expansion exposes args/result/toolCallId; isError flag visible; fallback `toolName` when prop missing; `running` state preserves the wrapped widget render. Uses a `StubInner` component (renders `[mock widget body for <toolName>]`) to isolate the HOC's behaviour from any real widget logic. |

No changes to `@swoop/common`, `cms/`, the orchestrator, or any other widget
file. The 7 existing widgets are wrapped at registry assembly time — their
source is untouched.

## Decisions taken (informal — no decisions.md entries authored)

- **HOC wraps at the registry boundary, not per-widget**. `parts/index.ts`
  is the single place that decides which decoration applies to which
  registered tool. Widgets themselves stay agnostic of the trace surface —
  they keep rendering their normal output, and the wrapper composes the
  trace below. This means future widgets get the trace automatically when
  registered in `toolWidgetComponents`.
- **HOC is dev-only at module-load time**. The `if (!import.meta.env.DEV) return Inner;`
  check inside `wrapWithDevTrace` ensures prod returns the original
  component verbatim — no wrapper function, no closure, no DOM overhead.
  Bundlers tree-shake the trace-rendering code as dead-on-prod when
  `import.meta.env.DEV` is statically `false`.
- **`<details>` + `<summary>` for native collapse**. No state management,
  no animation library, no keyboard-handling code. Browser-native
  semantics + accessibility. Tradeoff: jsdom's `<details>` toggle is
  flaky under synthetic click, so the test directly sets
  `traceElement.open = true` to assert expansion.
- **Client-side timing only**. `startedAt` = first mount, `endedAt` = first
  `complete` status with a non-undefined result. The orchestrator emits
  authoritative `tool.invoked` / `tool.returned` timestamps server-side;
  surfacing them here would need a wire-shape addition we're avoiding.
  Client-side timing is the visitor's perspective anyway; documented as
  approximation in the component's JSDoc.
- **`useState` not `useRef` for `endedAt`**. Initial design used `useRef`
  for both timestamps; testing surfaced that ref-set doesn't trigger
  re-render, so cached-result tool calls (complete on first render) would
  show `DURATIONMS: (pending)` forever. `useState` fires a re-render when
  the latch effect runs, so the duration display updates correctly. The
  ref pattern is preserved for `startedAt` (stable lifetime, no display
  dependency).
- **Summary line format kept compact**. `<toolName> · <status> · <ms> ms · <error?>`
  joined with `·`. The exhaustively-laid-out fields appear only on
  expansion. The hot-path collapsed summary stays scannable across many
  tool calls.
- **`ISERROR` pink badge** only when `isError === true`. Drawing visual
  attention to a real anomaly without making the universal trace itself
  feel alarmist.

## Verification done

- `npm run typecheck -w @swoop/ui` — green.
- `npm test -w @swoop/ui` — 20 files / 124 tests passed (was 118 → +6 from
  the new `dev-tool-trace.test.tsx`).
- Live preview on `:5193`: rendered four wrapped tool calls via dev-mode
  dynamic import — `find_options` (complete, real result), `lookup`
  (complete, empty result), `illustrate` (complete, isError true),
  `mystery_tool` (running, unregistered). Collapsed summaries showed the
  expected tool · status · duration shape. Expanded view exposed all
  diagnostic fields with proper JSON formatting. `ISERROR` badge visible
  on the illustrate case. Durations populated correctly after the
  useState fix (initial implementation showed `(pending)` due to the ref
  bug; fixed in the same session).

## What was skipped vs. convention

- **No Tier-3 plan authored before code touched.** Same gap as the
  silent-placeholder companion and the nice-knuth wave.
- **No decisions.md entries.** Seven decisions above would normally
  warrant numbered entries.
- **No prod-build smoke**. The HOC's prod-pass-through is verified by
  reading the source (`if (!import.meta.env.DEV) return Inner;`) and
  trusting Vite's static `import.meta.env.DEV` substitution. No build of
  the prod bundle was done to confirm tree-shaking; if dev surfaces ever
  appear in a prod build, this is the first place to check.

## Follow-ups / open items

- **Server-side authoritative timing**. Client-side mount-to-result is the
  visitor's perspective but doesn't include connector / orchestrator
  latency. If a future analytics surface wants authoritative tool-call
  durations, the orchestrator's `tool.invoked` / `tool.returned`
  timestamps are the source — would need plumbing through to the widget,
  not free.
- **Trace card visual register may compete with content** in dense chats.
  Default-collapsed mitigates this. If real-conversation testing shows
  the trace cards visually crowd the agent's prose in dev, options
  include: floating sidebar instead of inline; "trace mode" toggle gated
  by a URL flag; reduced-density variant. Defer until observed.
- **Trace card doesn't fire telemetry**. By design — the per-widget
  `useWidgetRenderedEvent` already emits `ui.widget_rendered`, and the
  silent/malformed surfaces emit the suffix-tagged variants. The trace
  card is dev-only and doesn't add to the server-bound signal. If future
  needs want a "tool call rendered with trace" event, add a discrete
  emit; current scope intentionally doesn't.
- **No filter / search across multiple trace cards**. A chat with 20+ tool
  calls would have 20+ trace cards stacked. If real-conversation
  observation says this is hard to navigate, building a single dev
  inspector (floating panel listing all tool calls with click-to-expand)
  may be worth it. Out of scope for v1.

## Cross-references

- Companion in same commit:
  [`03-exec-crosscut-silly-moser-silent-placeholder.md`](03-exec-crosscut-silly-moser-silent-placeholder.md).
- Sibling dev-only surfaces (precedents this builds on):
  - [`03-exec-crosscut-nice-knuth-malformed-prod-gate.md`](03-exec-crosscut-nice-knuth-malformed-prod-gate.md) (malformed card).
  - [`03-exec-crosscut-silly-moser-silent-placeholder.md`](03-exec-crosscut-silly-moser-silent-placeholder.md) (silent placeholder + unregistered fallback).
- Inbox follow-ups:
  - [inbox.md](../inbox.md) 2026-05-18 "Analytics on now-hidden
    widget-malformed failures" — the trace card is dev-only and doesn't
    contribute to that analytics surface, but stays consistent with the
    overall dev observability story.
