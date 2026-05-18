# 03 — Crosscut: WidgetSilentPlaceholder + unregistered-tool fallback (silly-moser worktree)

**Status**: **POST-HOC BACKFILL** authored 2026-05-18, same session as the
execution. The work landed without a Tier-3 plan having been written first —
this file is provenance, not a pre-execution spec. The convention
(Tier-3-first, including for review-driven / live-smoke fixes — see the
2026-05-13 brave-pare wave) was not honoured for this work either; this
backfill closes the documentation gap so future agents picking up
analytics / observability follow-ons have a coherent record to read.

**Filename suffix `-silly-moser-`**: worktree-slug-stamped per the 2026-05-13
collision-avoidance discipline.

**Chunk**: Crosscut — UI render boundary; no wire schema change.
**Commit**: `90a78bf` (bundled with the dev-tool-trace work — see
[`03-exec-crosscut-silly-moser-dev-tool-trace.md`](03-exec-crosscut-silly-moser-dev-tool-trace.md)).
**Merged to main**: `df08078`.

---

## What was asked for

Al's framing in the session that triggered this (responding to the
2026-05-18 screenshot showing an unexplained "pause then continue" in the
agent's reply):

> "I suspect it _tried_ to show something but failed. But, there's no
> visual indicator. In dev mode, I'd like silent failures to be visible.
> We already do this for some tool calls. (e.g. find_options). Let's make
> sure that ALL tool calls get a visual widget in dev mode, even if they
> are silent, whether by design or by failure or by any other reason."

Pre-work AskUserQuestion settled the scope: a sibling component to the
existing `WidgetMalformedPlaceholder` (from the nice-knuth wave) covering
*by-design* silent renders rather than failures. Same prod/dev gate; new
visual register (quiet slate, not amber).

Constraint inherited from the nice-knuth wave: stay clear of
`@swoop/common` event/schema changes. Telemetry uses the same
suffix-on-existing-`ui.widget_rendered` pattern (`<widget>:silent:<reason-slug>`).

## What landed

| File | Change |
|---|---|
| [product/ui/src/widgets/widget-shell.tsx](../product/ui/src/widgets/widget-shell.tsx) | New exports: `WidgetSilentPlaceholder({widgetType, toolName, reason, hint?})`, `UnregisteredToolFallback({toolName, args?, result?})`, plus internal helpers `useEmitSilentTelemetry`, `slugifyReason`, `DevSilentIndicator`. Prod (`!import.meta.env.DEV`) returns `null` after firing the telemetry emit. Dev/test renders a muted slate dotted card with DEV badge, `<widget> (<tool>) rendered silently — <reason>`, and an optional JSON `hint` preview using the existing `truncateForPreview`. `data-testid="widget-silent"` for assertion targeting. |
| [product/ui/src/parts/index.ts](../product/ui/src/parts/index.ts) | Added `RawToolFallback` bridge (createElement → `UnregisteredToolFallback`) and wired it into `tools.Fallback`. assistant-ui's `ToolsConfig.Fallback` slot now catches every tool call whose `toolName` isn't in `toolWidgetComponents`. The bridge keeps `parts/index.ts` as a `.ts` file (no JSX) by using `createElement`. |
| [product/ui/src/widgets/find-inspiring.tsx](../product/ui/src/widgets/find-inspiring.tsx) | `return null` on `passages.length === 0` → `<WidgetSilentPlaceholder {...SHELL_CTX} reason="empty result" hint={{passages: 0}} />`. |
| [product/ui/src/widgets/find-someone-who.tsx](../product/ui/src/widgets/find-someone-who.tsx) | Same pattern (`reason="empty result"`, `hint={{stories: 0}}`). |
| [product/ui/src/widgets/find-proof.tsx](../product/ui/src/widgets/find-proof.tsx) | Same pattern (`reason="empty result"`, `hint={{proofs: 0}}`). |
| [product/ui/src/widgets/find-options.tsx](../product/ui/src/widgets/find-options.tsx) | Same pattern (`reason="empty result"`, `hint={{cards: 0}}`). |
| [product/ui/src/widgets/lookup.tsx](../product/ui/src/widgets/lookup.tsx) | **Two** silent paths: `chunks.length === 0` → `reason="empty result"`, `affordances.length === 0` → `reason="no canonical URLs"` with hint distinguishing the count of chunks that came back vs the URL count that survived. |
| [product/ui/src/widgets/inspiration.tsx](../product/ui/src/widgets/inspiration.tsx) | `images.length === 0` branches on `rawImages.length`: if `0`, reason is `"empty result"`; otherwise `"all images failed inner parse"`. The hint carries both counts (`{rawImages, parsed}`) so the developer can tell connector-zero from inner-parse-rejected. |
| 6 widget test files | Empty-state assertions flipped from `container.firstChild === null` / `queryByTestId("widget-x") === null` to **also** assert `getByTestId("widget-silent")` is present with the right `data-swoop-widget` attribute and reason text. The visitor-facing chrome absence (`queryByTestId("<widget>")` still null) is preserved as a separate assertion. |

No new shared primitives. No changes to `@swoop/common`. No changes to
`cms/`.

## Decisions taken (informal — no decisions.md entries authored)

- **Prod gate uses `import.meta.env.DEV`** (same Vite-aware flag as the
  malformed placeholder). Vitest inherits DEV=true so empty-state tests
  see the silent placeholder rendered.
- **Telemetry suffix `:silent:<slug>` on existing `ui.widget_rendered` event**.
  `slugifyReason()` lower-cases + kebab-cases the human-readable reason
  (e.g. `"no canonical URLs"` → `"no-canonical-urls"`) so downstream
  filtering is stable. Pairs with the nice-knuth `:malformed:{schema|lifecycle}`
  convention — one downstream filter pattern covers both.
- **Single component, two consumption sites**. `WidgetSilentPlaceholder` is
  consumed both directly from widgets (with explicit `reason`) and via
  `UnregisteredToolFallback` (with `reason: "no widget registered"`).
  Avoids a sibling component for what's essentially the same surface.
- **`hint` is `unknown`-typed**. Callers pass arbitrary structured context
  (counts, raw value previews). `truncateForPreview` (already in
  widget-shell from the malformed work) JSON-pretty-prints and caps at
  ~300 chars. Tests assert reason text, not hint content — hints are
  diagnostic-only.
- **`createElement` in `parts/index.ts`** (rather than renaming the file to
  `.tsx`). Localises the JSX cost to one bridge function; the rest of the
  file remains JSX-free. Reasonable tradeoff against the file rename.

## Verification done

- `npm run typecheck -w @swoop/ui` — green.
- `npm test -w @swoop/ui` — 19 files / 118 tests passed (the previous tally
  before the dev-tool-trace work added six more). Each updated empty-state
  test asserts both the visitor-chrome-absent and the
  `data-testid="widget-silent"` shape.
- Live preview on `:5193`: rendered three silent placeholder variants via
  dev-mode dynamic import — `find-options` empty result, `lookup`
  no-canonical-URLs, `(unregistered) mystery_tool` — all visible with
  correct widget+tool labels, reasons, and JSON hint previews.

## What was skipped vs. convention

- **No Tier-3 plan authored before code touched.** Same gap as the
  nice-knuth wave.
- **No decisions.md entries.** Four decisions above (prod-gate flag,
  telemetry suffix, single-component reuse, hint shape) would normally
  warrant numbered entries.
- **No CHUNK_D execution log update.** Chunk D (chat surface) doesn't
  currently track a "dev observability" lineage; this work materially
  extends the dev surface alongside the nice-knuth malformed-gate work.

## Follow-ups / open items (already captured)

- [inbox.md](../inbox.md) 2026-05-18 "Analytics on now-hidden
  widget-malformed failures" — the silent-render signal (`ui.widget_rendered`
  with `:silent:<slug>` suffix) lands in the same analytics surface
  whenever chunk F builds it. Counts by widget × tool × reason, with
  alert thresholds, plus the inbox's recommendation to promote both
  `:malformed:` and `:silent:` suffix-hacks to discrete event kinds
  once `@swoop/common` is settled.
- `WidgetSilentPlaceholder` and `UnregisteredToolFallback` share the
  `widget-silent` testid; widget tests already assert the
  `data-swoop-widget` attribute to disambiguate. If a future test needs
  to assert "fallback fired" vs "in-widget silent", a separate testid
  may earn its keep — defer until that surface exists.

## Cross-references

- Companion in same commit:
  [`03-exec-crosscut-silly-moser-dev-tool-trace.md`](03-exec-crosscut-silly-moser-dev-tool-trace.md).
- Predecessor (same prod/dev pattern): [`03-exec-crosscut-nice-knuth-malformed-prod-gate.md`](03-exec-crosscut-nice-knuth-malformed-prod-gate.md).
- Predecessor (live-smoke pattern this should have followed):
  [`03-exec-crosscut-brave-pare-widget-user-copy-fix.md`](03-exec-crosscut-brave-pare-widget-user-copy-fix.md).
- The 2026-05-18 inbox entry referenced above:
  [inbox.md](../inbox.md) "Analytics on now-hidden widget-malformed failures".
