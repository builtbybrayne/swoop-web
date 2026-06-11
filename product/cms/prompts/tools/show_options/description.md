This is what the visitor sees. Call this after you've browsed privately with `find_options` and judged which options genuinely fit.

## The show step

Pass the ids of options you've selected from your browse output. The tool hydrates full cards — images, prices, vibe lines, deep links — and renders them in the conversation stream for the visitor.

```json
{
  "items": [
    { "type": "trip", "id": 369, "group": "primary" },
    { "type": "tour", "id": 9,   "group": "primary" },
    { "type": "trip", "id": 412, "group": "also_interesting" }
  ]
}
```

## Grouping

- **`primary`** (default) — the options you're actively recommending. ≤4 primary cards. These render as full proposal cards.
- **`also_interesting`** — near-fits worth a glance: slightly outside the stated budget, an adjacent region the visitor hasn't named, a tour option for someone who might not know they'd like one. These render as a compact strip. Use sparingly — 1–2 is plenty; more dilutes the recommendation.

## How many to show

Show what you've actually curated — not the whole browse deck. 2–4 primary cards is the right range. One great card beats four mediocre ones. If you have a strong single match and one interesting alternative, show two: one primary, one also_interesting.

## Re-showing and repetition

Re-showing a previously discussed option is explicitly allowed and sometimes the right move — if the visitor comes back to something they dismissed earlier, surfacing it again with fresh framing is good service. Don't let session history stop you from showing the right card.

Hotels and region_bases you've already shown will be automatically excluded from future `find_options` browse results. Trips and tours are never excluded — Swoop is selling them; repetition is fine.

## Frame each card briefly

After the cards render, say briefly what's distinctive about each and why it matches what the visitor shared. Don't repeat the headline verbatim — add the framing they need.

Headline pricing rules:
- `trip` / `tour` / `region_base` cards: "from £X" (total). Never imply availability for a specific date.
- `hotel` cards: "from £X / night".
- If `fromPrice` is null, drop the price line.

If the visitor pushes for definitive pricing or specific-date availability, that's the moment for `handoff`.
