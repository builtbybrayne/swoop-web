# 03 — Crosscut: visitor-turn bubble styling (nice-knuth worktree)

**Status**: **POST-HOC BACKFILL** authored 2026-05-18. The work landed without a
Tier-3 plan having been written first — this file is provenance, not a
pre-execution spec. The convention (Tier-3-first, including for review-driven /
live-smoke fixes — see the 2026-05-13 brave-pare wave) was not honoured for
the nice-knuth wave; this backfill closes the documentation gap so a future
agent picking up adjacent UI work has a coherent record to read against.

**Filename suffix `-nice-knuth-`**: worktree-slug-stamped per the 2026-05-13
collision-avoidance discipline (parallel agents are in flight; date alone
isn't unique).

**Chunk**: Crosscut — UI surface only.
**Commit**: `de108bb` (bundled with the malformed-prod-gate work — see
[`03-exec-crosscut-nice-knuth-malformed-prod-gate.md`](03-exec-crosscut-nice-knuth-malformed-prod-gate.md)).
**Merged to main**: `ed5cb01`.

---

## What was asked for

Al's framing in the session that triggered this:

> "the user submitted conversational turn is the same styling as the agent's.
> We probably want it to be visually distinct. I assume that the assistant-ui
> package has some support for that."

Pre-work HITL (via AskUserQuestion) settled the visual:

- **Right-aligned bubble** (vs alternatives: left-aligned with role label /
  left-aligned different background only / avatar marker no background).
- Subtle slate background, rounded corners with a tucked bottom-right,
  capped at ~75% width.
- `data-swoop-role` + `data-swoop-part="message-bubble"` brand-extension hooks.
- Agent turns unchanged (full-width prose layout).

## What landed

| File | Change |
|---|---|
| [product/ui/src/App.tsx](../product/ui/src/App.tsx) §`MessageView` | Split per-message render into two `MessagePrimitive.If` branches (`user` + `assistant`). Visitor branch wraps `MessagePrimitive.Parts` in a `<div data-swoop-part="message-bubble">` with `max-w-[85%]`, `bg-slate-200`, `rounded-2xl rounded-br-md`, `text-slate-900`, `sm:max-w-[75%]`. Assistant branch carries the existing full-width prose layout. Both branches `data-swoop-role` tagged for brand re-skinning. |

No new files. No new shared primitives. No CSS-module surface. No
`@swoop/common` change.

### Decisions (informal — no decisions.md entries authored)

- `MessagePrimitive.If` is the role-branching primitive. assistant-ui 0.12.25
  marks it deprecated in favour of an `<AuiIf condition={(s) => s.message...} />`
  shape that's still settling. Used the deprecated primitive for now — the
  rest of the codebase consumes the `MessagePrimitive.*` namespace
  consistently and the proper replacement isn't stable yet. Swap cost when
  `<AuiIf>` lands: one file, ~6 lines.
- One synthetic `<div>` per branch carries the bubble styling; we deliberately
  did NOT introduce a shared `<MessageBubble>` primitive. Two render branches
  is below the threshold for extraction, and brand re-skinning hooks live at
  the `data-swoop-part` attribute layer, not the component layer.

## Verification done

- `npm run typecheck -w @swoop/ui` — green.
- `npm test -w @swoop/ui` — 19 files / 118 tests passed (no message-rendering
  tests were authored; existing assistant-ui-driven message rendering covered
  by lower-level component tests).
- Live preview on `:5183` (with stubbed orchestrator endpoints): user message
  rendered right-aligned with bg `rgb(226, 232, 240)`, border-radius
  `16px 16px 6px`, max-width 85%, `justify-content: flex-end` on the root.

## What was skipped vs. convention

- **No Tier-3 plan authored before code touched.** Should have been written
  per the brave-pare-wave precedent. Light HITL via `AskUserQuestion` happened
  but didn't produce a planning document.
- **No decisions.md entries.** Two informal decisions (above) would normally
  warrant numbered entries (e.g. `D.31`, `D.32`); they're captured inline here
  instead and can be promoted on triage.
- **No unit test for the role-branching render.** Add a small test that asserts
  `data-swoop-role="user"` produces the bubble + right-align, and `assistant`
  doesn't, if the styling is revisited.

## Follow-ups / open items

- A `<MessagePrimitive.If>` → `<AuiIf>` migration once assistant-ui settles
  the replacement (one-file change).
- Mobile-specific bubble sizing tuning if visitor-side testing finds the 85%
  cap too tight on narrow viewports (deferred to chunk D's mobile-reflow pass
  / D.t7 if not already covered).
- Brand-team CSS hooks (`data-swoop-role`, `data-swoop-part="message-bubble"`)
  should be documented in the D.t8 brand-extension surface README when that
  doc lands.

## Cross-references

- Lives in conversation context only; no other Tier-3 doc references this work.
- The malformed-prod-gate work shipped in the same commit
  (`de108bb` / merge `ed5cb01`): [`03-exec-crosscut-nice-knuth-malformed-prod-gate.md`](03-exec-crosscut-nice-knuth-malformed-prod-gate.md).
- Bug-fix follow-on (composer unresponsive after restart, also nice-knuth):
  [`03-exec-crosscut-nice-knuth-composer-restart-fix.md`](03-exec-crosscut-nice-knuth-composer-restart-fix.md).
