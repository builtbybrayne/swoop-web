# 03 — Crosscut: dev/prod-gate WidgetMalformedPlaceholder + type-debt cascade (nice-knuth worktree)

**Status**: **POST-HOC BACKFILL** authored 2026-05-18. The work landed without
a Tier-3 plan having been written first — this file is provenance, not a
pre-execution spec. The convention (Tier-3-first, including for review-driven /
live-smoke fixes — see the 2026-05-13 brave-pare wave) was not honoured for
the nice-knuth wave; this backfill closes the documentation gap so a future
agent picking up the analytics-followup (chunk F) or any further widget-shell
work has a coherent record to read against.

**Filename suffix `-nice-knuth-`**: worktree-slug-stamped per the 2026-05-13
collision-avoidance discipline.

**Chunk**: Crosscut — UI surface + adjacent type debt; no wire schema change.
**Commit**: `de108bb` (bundled with the visitor-bubble work — see
[`03-exec-crosscut-nice-knuth-visitor-bubble.md`](03-exec-crosscut-nice-knuth-visitor-bubble.md)).
**Merged to main**: `ed5cb01`.

---

## What was asked for

Al's framing in the session that triggered this:

> "The 'Couldn't load that. I couldn't show that piece — we can still keep
> talking, or try asking a different way.' is helpful in development, but
> should not appear in production. Also, in development, I need to know
> what couldn't be loaded and why. Otherwise it's hard to debug."

Constraint set by Al before code touched: "two other live worktrees are in
flight, some affecting content/structure between server and UI. Focus on
value-add UI/UX tweaks more likely independent of the content/structural
work." → keep clear of `@swoop/common` event/schema changes.

Pre-work HITL (via AskUserQuestion) settled the design:

1. **Prod behaviour**: render nothing + emit telemetry. (vs silent /
   tiny inline `…` placeholder.)
2. **Dev surface contents** (all four selected):
   - Tool name + widget type
   - Zod issues, formatted (`path → message`)
   - Raw `props.result` preview (truncated)
   - Copy-to-clipboard button
3. **Bonus scope**: fix the pre-existing `ZodType` import regression flagged
   in `inbox.md` 2026-05-13 in the same wave.

## What landed

| File | Change |
|---|---|
| [product/ui/src/widgets/widget-shell.tsx](../product/ui/src/widgets/widget-shell.tsx) | Rewrite. `safeParse<S extends ZodTypeAny>` returns `{ok:true, data:zInfer<S>}` or `{ok:false, debug}` where debug carries `issues` + `rawCandidate`. `renderLifecycleGate(lifecycle, context, label?)` takes a widget context. `WidgetMalformedPlaceholder({widgetType, toolName, debug?, lifecycleFailure?})` gates on `import.meta.env.DEV`: prod returns `null`; dev/test renders `<DevMalformedDebug>` (rich amber-dashed card with DEV badge + headline + formatted Zod issues + raw-value preview + Copy-debug button). Telemetry: structured `console.warn` in `safeParse` + a `ui.widget_rendered` event with `widgetType` suffix `<name>:malformed:{schema|lifecycle}` (re-uses existing event kind — no `@swoop/common/events.ts` change). `data-testid="widget-malformed"` preserved in the dev surface so existing widget tests pass. |
| [product/ui/src/widgets/find-inspiring.tsx](../product/ui/src/widgets/find-inspiring.tsx) | Pass `SHELL_CTX = { widgetType: "find-inspiring", toolName: "find_inspiring" }` to `safeParse` / `renderLifecycleGate`; pipe `debug` into the placeholder. Local `ParsedPassage = z.infer<typeof FindInspiringOutputSchema>["passages"][number]` absorbs schema-vs-public-type-alias drift on optional `image.{subjectTags,moodTags,regionTags}` arrays. Same pattern for `<PassageCard>` prop. |
| [product/ui/src/widgets/find-someone-who.tsx](../product/ui/src/widgets/find-someone-who.tsx) | Same shape (`SHELL_CTX` + `ParsedStory` local type). |
| [product/ui/src/widgets/lookup.tsx](../product/ui/src/widgets/lookup.tsx) | Same shape (`SHELL_CTX` + `ParsedChunk` local type for `pickAffordances`). |
| [product/ui/src/widgets/find-proof.tsx](../product/ui/src/widgets/find-proof.tsx) | `SHELL_CTX` + debug pipe-through. No local type needed (proof schema didn't surface drift). |
| [product/ui/src/widgets/find-options.tsx](../product/ui/src/widgets/find-options.tsx) | `SHELL_CTX` + debug pipe-through. Cast on `ProposalCardRenderer` boundary (`card as ProposalCardPublic`) for the discriminated-union drift — adjacent to the same `@swoop/common` reconciliation in flight elsewhere. Exhaustiveness-default branch also renders the placeholder. |
| [product/ui/src/widgets/inspiration.tsx](../product/ui/src/widgets/inspiration.tsx) | `SHELL_CTX = { widgetType: "inspiration", toolName: "illustrate" }` + debug pipe-through. |
| [product/ui/src/widgets/lead-capture.tsx](../product/ui/src/widgets/lead-capture.tsx) | Two `safeParse` call sites (args + result) both carry `SHELL_CTX`. Two `<WidgetMalformedPlaceholder>` call sites; rejected-server-result variant uses `lifecycleFailure` (no schema-issues payload). Cast on `postHandoffSubmit(reqBody)` call site for the `verdict` union → satisfies the new distributive-Omit param shape (see below). |
| [product/ui/src/runtime/handoff-client.ts](../product/ui/src/runtime/handoff-client.ts) | Added `DistributiveOmit<T, K>` helper. `postHandoffSubmit` parameter type changed from `Omit<HandoffSubmitRequest, "sessionId">` to `DistributiveOmit<HandoffSubmitRequest, "sessionId">` so the discriminated union survives the omit. Tests narrowing on `body.verdict` then accessing `body.contact` now type-check. |

No new files. No new shared primitives.

## Decisions taken (informal — no decisions.md entries authored)

- **Prod gate uses `import.meta.env.DEV`** (Vite). Test environments inherit
  DEV=true so widget tests asserting `getByTestId("widget-malformed")` keep
  passing without `data-testid` divergence.
- **Telemetry by string-suffix on existing event kind**, not a new
  `ui.widget_malformed` event. Suffix shape: `<widget>:malformed:{schema|lifecycle}`.
  Rationale: avoids touching `@swoop/common/events.ts` while parallel worktrees
  are evolving wire schemas. Once those settle, promoting to a discrete event
  kind is the right shape — see `inbox.md` 2026-05-18 entry on follow-up
  analytics.
- **Local `z.infer<typeof Schema>` types** in find-inspiring / find-someone-who /
  lookup widgets to absorb optional-vs-required tag-array drift between the
  parsed schema output and the `*Public` type aliases declared in
  `@swoop/common`. NOT a `@swoop/common` change — that reconciliation lives
  with the schema authors in parallel worktrees.
- **`<S extends ZodTypeAny>` + `z.infer<S>`** rather than the originally-broken
  `<T> ... schema: ZodType<T>` signature. The latter has input/output
  unification quirks under `.default()` that cascaded into widget-side `unknown`
  failures (the inbox 2026-05-13 entry — closed by this work).

## Verification done

- `npm run typecheck -w @swoop/ui` — green (closes the inbox 2026-05-13
  `@swoop/ui` typecheck regression).
- `npm test -w @swoop/ui` — 19 files / 118 tests passed. The malformed-render
  test cases (`find-options.test.tsx` and others) keep passing because the
  dev surface preserves `data-testid="widget-malformed"`.
- Live preview on `:5183`: dev card rendered with all four debug sections
  (DEV badge, "find-options (find_options) failed to render — schema parse",
  Zod issues as `cards.0.headline → Required`, raw-value JSON, Copy-debug
  button). Card mounted via Vite dev-mode dynamic import for the visual check
  (production gate `!import.meta.env.DEV` confirmed by inspection).

## What was skipped vs. convention

- **No Tier-3 plan authored before code touched.** Same gap as the
  visitor-bubble work — both shipped in the same commit `de108bb`.
- **No decisions.md entries.** Four decisions above (prod-gate flag, telemetry
  suffix, local z.infer types, generic-pattern) would normally warrant
  numbered entries.
- **No `@swoop/common` change despite real drift.** The optional vs required
  tag-arrays on `DerivedImageSchema` (output side has `.default([])`,
  type alias declares required) is a real reconciliation, deliberately
  punted to whoever owns the schema work in the parallel worktrees.

## Follow-ups / open items (already captured)

- [inbox.md](../inbox.md) 2026-05-18 "Analytics on now-hidden widget-malformed
  failures" — chunk F should land proper counts + alerts + rolling-debug
  capture, and probably promote the suffix-on-existing-event hack to a
  discrete `ui.widget_malformed` event kind.
- `WidgetMalformedPlaceholder` copy in `cms/errors/en.json` (`tool_error` key)
  remains but no longer renders in prod. Chunk-G copy pass can decide whether
  to keep / rewrite / retire once real-conversation observation says how
  often the prod-gate fires.

## Cross-references

- Visitor-bubble work (same commit): [`03-exec-crosscut-nice-knuth-visitor-bubble.md`](03-exec-crosscut-nice-knuth-visitor-bubble.md).
- Composer-restart fix (separate commit `4817a2d`, also nice-knuth):
  [`03-exec-crosscut-nice-knuth-composer-restart-fix.md`](03-exec-crosscut-nice-knuth-composer-restart-fix.md).
- Predecessor: [`inbox.md` 2026-05-13 `@swoop/ui` typecheck regression](../inbox.md)
  — closed by this work.
- Predecessor (live-smoke pattern this should have followed):
  [`03-exec-crosscut-brave-pare-widget-user-copy-fix.md`](03-exec-crosscut-brave-pare-widget-user-copy-fix.md).
