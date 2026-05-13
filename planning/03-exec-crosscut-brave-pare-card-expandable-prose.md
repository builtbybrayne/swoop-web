# 03 — Crosscut: expandable prose on proposal cards (brave-pare worktree, 2026-05-13)

**Status**: Tier 3 execution plan. Draft, 2026-05-13.
**Chunk**: Crosscut — UI affordance + minor connector cleanup.
**Filename suffix `-brave-pare-`**: worktree-slug-stamped per the 2026-05-13 collision-avoidance discipline.
**Depends on**: nothing.
**Produces**: Cards stop silently truncating prose. Where content overflows a clamp, an inline expander affords reading the full content.
**Estimate**: ~1 hour.

---

## ★ Read this first — the WHY

Live smoke against the 2026-05-13 region_id backfill + HTML-render fix surfaced a Patagonia region_base card with the visible text `<p>Chile's cosmopolitan capital is a great place to explore, from its rich heritage and views of the Andes to its easy access to fantastic w…</p>` — the connector's `vibeLineFromSource` truncator clipped at 140 chars and added `…`. Once we render the HTML properly (commit `c2a91c5`), the truncation pattern becomes more visibly disrespectful: the visitor sees Swoop's editor team has authored useful prose, watches the system arbitrarily cut it off, and has no way to read the rest.

Al's framing (2026-05-13): *"Cards should not just truncate their data without providing an option to expand the details."* That's the principle. The fix isn't to widen the truncation cap — it's to drop the silent truncation entirely and let the visitor opt into the full content.

---

## Audit — where does prose appear on cards?

Live measurements 2026-05-13 against `puma_dev`:

| Card | Field | Source | Server-side truncation? | Live data | Visibly truncated? |
|---|---|---|---|---|---|
| `RegionBaseCard` | `vibeLine` | `query-region-bases.ts` → `vibeLineFromSource(page.summary \|\| page.intro_text)` — 140 char cap | Yes — slice + `…` | Most pages exceed 140 chars (92% of pages carry HTML/prose) | **Yes, visible today** |
| `RegionBaseCard` | `baseFraming` | Reserved in schema; not populated by today's data primitive | Would inherit pattern if populated | None | n/a |
| `HotelCard` | `vibeLine` | `query-hotels.ts` → `vibeLineFromSource(hotel.description)` — same 140 char cap, same function shape | Yes — slice + `…` | 0 of 44 hotels in `puma_dev` have `description` populated | No truncation visible today |
| `TripCard` | `vibeLine` | `query-trips.ts` → pass-through of `trip_card.vibe_line` (Haiku-composed via C.t3a) | **No** server truncation | 11 of 649 rows >140 chars; max 201 | No truncation, just long lines |
| Other cards / widgets | none | Haiku-composed at ETL — already content-appropriate length | — | — | — |

**Only `RegionBaseCard.vibeLine` is actively truncating visible content today.** Hotel + trip get the same affordance for consistency + so that the pattern is in place when their content lands or grows.

---

## Deliverables

### New: shared `<ExpandableProse>` component

`product/ui/src/shared/ExpandableProse.tsx`. Props:

```ts
interface ExpandableProseProps {
  content: string;
  /** Whether `content` is trusted CMS-authored HTML to render
   *  via dangerouslySetInnerHTML, or plain text. */
  html?: boolean;
  /** CSS `line-clamp-N` value when collapsed. Default 3. */
  maxLines?: number;
  /** Tailwind className for the rendered prose body. */
  className?: string;
  /** Optional test-id for the wrapper. */
  testId?: string;
}
```

Behaviour:

- Renders content as HTML when `html: true`, else as text.
- On mount, measures the rendered block; if overflowing the clamp, shows a "Read more" button; otherwise no button.
- "Read more" toggles to "Show less"; expanded state is local React state per instance.
- Button is a real `<button type="button">` styled as a quiet text-weight affordance underneath the prose. Keyboard-accessible, no JS jank.
- Wrapper element is `<div>` (never `<p>`) so it can safely host nested `<p>` from CMS HTML.

Implementation notes:

- Overflow detection: compare `scrollHeight` vs `clientHeight` after layout. Use `useLayoutEffect` so the button visibility is set in the same paint as the prose. Re-measure on `content` change (rare in practice; cards re-mount per turn). Window resize re-measurement is overkill for the Puma surface.
- Tailwind classes: `line-clamp-3` (or whatever `maxLines` resolves to) on the prose body when collapsed; no clamp when expanded. The collapse class is `overflow-hidden` + `display: -webkit-box` + `-webkit-line-clamp: N` + `-webkit-box-orient: vertical`. All present in `@tailwindcss/line-clamp` (now built in to Tailwind 3.3+).
- HTML content keeps the `[&_p]:m-0 [&_p+p]:mt-2` paragraph-margin reset from the RegionBaseCard work.

### Connector — stop server-side truncation

| File | Change |
|---|---|
| [product/connector/src/data/query-region-bases.ts](../product/connector/src/data/query-region-bases.ts) | Remove `VIBE_LINE_MAX_CHARS` + `vibeLineFromSource`. Return the raw `vibe_line_source` (cleaned of leading/trailing whitespace, empty → `undefined`). The UI now decides what fits. |
| [product/connector/src/data/query-hotels.ts](../product/connector/src/data/query-hotels.ts) | Same — drop the truncator. (Currently unused on real data, but the helper duplicates the region-bases pattern and removing it keeps the connector lean.) |
| Tests for both | Update assertions — they previously verified truncation; flip to verify full pass-through. |

### Widgets — adopt `<ExpandableProse>`

| File | Change |
|---|---|
| [product/ui/src/widgets/find-options/region-base-card.tsx](../product/ui/src/widgets/find-options/region-base-card.tsx) | Replace the inline `<div dangerouslySetInnerHTML>` for `vibeLine` with `<ExpandableProse content={card.vibeLine} html maxLines={3} />`. Same for `baseFraming` (with its existing pill styling preserved via `className`). |
| [product/ui/src/widgets/find-options/hotel-card.tsx](../product/ui/src/widgets/find-options/hotel-card.tsx) | Replace the `<p>{card.vibeLine}</p>` render with `<ExpandableProse content={card.vibeLine} maxLines={3} />`. (Pass `html: false` — hotel.description is currently text-shaped per the no-HTML query result, though if Swoop's CMS schema later switches to HTML the connector + this flag flip together.) |
| [product/ui/src/widgets/find-options/trip-card.tsx](../product/ui/src/widgets/find-options/trip-card.tsx) | Same — `<ExpandableProse content={card.vibeLine} maxLines={3} />`. Haiku-composed text-only. |

### Tests

- New: `product/ui/src/shared/__tests__/ExpandableProse.test.tsx`. Three cases:
  1. Short content (no overflow) → no expander button rendered.
  2. Long content (forced via inline style or character-count fixture) → expander button rendered with "Read more"; clicking flips to "Show less" and reveals full content.
  3. HTML mode round-trip — `dangerouslySetInnerHTML` renders the tags; clamped/unclamped both show.
- Existing region_base/hotel/trip card tests: ensure they still pass against the new component. The text-content assertions (`framing.textContent.toContain(...)`) survive untouched.

---

## What does NOT change

- The proposal-card schemas (`ProposalCardPublicSchema` and variants). `vibeLine` stays `z.string().optional()`. No new fields, no schema migration.
- Cards that don't currently render prose (image-only widgets, the `find-someone-who` vignette which already exposes the full customer story).
- The HTML trust posture from commit `c2a91c5` — `ExpandableProse` respects the `html` prop the caller passes.
- The widget-shell `safeParse` / `renderLifecycleGate` machinery.
- Mobile-vs-desktop responsive shape — clamp value stays the same across breakpoints (no over-engineering for v1).

---

## Step-by-step execution

1. Hash gate.
2. Author `ExpandableProse` + its tests.
3. Run `npm test -w @swoop/ui -- ExpandableProse` → green on the new file.
4. Update `query-region-bases.ts` + `query-hotels.ts` to drop the truncator. Update their unit tests (`product/connector/src/data/__tests__/query-region-bases.test.ts` + `query-hotels.test.ts`) to assert full-pass-through.
5. Run `npm test -w @swoop/connector` → green.
6. Update the three card components to consume `ExpandableProse`.
7. Run `npm test -w @swoop/ui` → green (existing 112 tests + new ExpandableProse tests pass).
8. Live browser smoke — re-trigger a region_base query. Expected: card shows ~3 lines of prose; "Read more" button visible underneath; click reveals full HTML-rendered content; "Show less" collapses. Repeat against a trip query whose `vibe_line` is long enough to test trip-card expansion (need to pick a trip from the 11 rows >140 chars).
9. Commit.
10. Brief discoveries.md note: pattern of "never silently truncate; offer expansion or render in full".

---

## Decision marker — D.brave-pare-3 (+ C.brave-pare-3 for the connector-side whitespace strip)

**Decision — cards never silently truncate prose; where content exceeds the visible clamp, a per-instance expander affords reading the full content.** Logged as **D.brave-pare-3** in [decisions.md](decisions.md). Captures the principle as a UI/UX rule alongside the existing "widgets with no useful content render nothing" rule (D.brave-pare-1, commit `58d65f2`).

The connector-side CMS WYSIWYG decorative-whitespace strip (`trimCmsDecorativeWhitespace` helper, commit `f9b1d1d`) lands under a companion entry **C.brave-pare-3** — same plan, separate decision because it sits on the connector boundary rather than the UI surface. Together they make truncation-with-expansion an honest contract from data layer through render.

---

## Open follow-ups deferred

- **Smooth height transition** on expand. Possible with a `useState` + `<details>` element approach or a small height-animation library. Visual polish; not blocking.
- **"Read more" copy localisation** — currently English. Belongs to the chunk-G content pass when Swoop's editorial standards lock down.
- **Auto-expand on first overflow** during agent-driven interactions (e.g. visitor clicks "tell me more about Santiago" → the agent re-renders or triggers expansion). Out of scope; opportunistic future polish.
- **Mobile-specific clamp tuning** — on narrower viewports 3 lines may be too few. Defer until UX testing on real devices.