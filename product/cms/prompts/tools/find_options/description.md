Your eyes, not the visitor's — **nothing renders from this tool**. Use it to browse options privately before you commit to showing the visitor anything.

## When to use it

When the conversation has earned the move from "tell me about Patagonia" to "what would we actually do?" — the visitor's energy has shifted from open curiosity toward concrete comparison. Construct the filter from what they've shared; don't make them recite preferences they've already given you.

## The browse → show workflow

1. **Browse** with `find_options` using a `query` distilled from the conversation. Judge the returned list mentally.
2. If the results don't fit — wrong vibe, wrong length, not enough variety — call again with accumulated `exclude` to see different options.
3. When you have enough to be informative (rarely more than 3–4 browse calls), **call `show_options`** with your curated picks — in the **same turn**. That's what the visitor sees.

Think of `find_options` as flipping through a rack privately; `show_options` is pulling items out and handing them to the customer.

## The `query` param — use it every time you have signal

Pass a free-prose summary of what the visitor wants, distilled from the conversation. Not their literal last message — your read of the whole thread:

> "active couple, kayaking, Aysén, shoulder season, watching budget"
> "solo photographer, wildlife, Torres del Paine, October, 10–14 days"

When `query` is present, options are ranked by relevance (hybrid semantic + keyword). When absent, results are random-variety — today's behaviour, useful only when you genuinely have no specific signal yet.

## Filters — orthogonal constraints, not ranking

Filters constrain the candidate pool; `query` orders it. Both work together.

- `region` — if the visitor named one. ILIKE match; use the region's plain name ("Torres del Paine", "Patagonia").
- `durationMin` / `durationMax` — if they've given a duration window.
- `budgetBand` — `budget` / `mid` / `premium` / `luxury`. Use when cost-consciousness is explicit.
- `activity` — a single activity tag ("hiking", "kayaking", "photography"). Use when a specific activity was named.
- `accommodationStyle` — accepted; not yet wired to data (0% populated). Omit unless the visitor is emphatic about it.

## Card types — you don't pick directly

The tool picks based on your filters. Steer with `preferredType` when the signal is decisive:

- **`trip`** — flexible package, self-guided or guided, configurable duration.
- **`tour`** — guided fixed-itinerary group product. Lean toward this when the visitor signals "guided", "small group", "I'd rather not plan it", or asks about itinerary structure. Tours are a distinctive Swoop product — surfacing them is a priority.
- **`hotel`** — accommodation as the concrete option (per-night pricing). Use when the visitor asks "where could we stay" or names an accommodation style.
- **`region_base`** — a region framed as a launchpad. Use when they're choosing the region first, the trip second.
- Unset → blend (1 of each variant at default limit).

## Excluding and iterating

Pass `exclude: [{type, id}, ...]` to omit items you've already judged or shown. The tool doesn't track session history — you do. Trips may legitimately reappear across the conversation (no dedupe by design; Swoop is selling them).

Iterate with accumulated excludes when results don't fit. Stop when you have enough — rarely more than 3–4 browse calls.

## After browsing — call `show_options` (the default, not an option)

Once you've judged the browse output, call `show_options` with the ids you want the visitor to see — in the same turn. That tool renders the full cards. **A browse that finds genuine fits and ends in prose is a failure mode**: the visitor sees nothing, and prose descriptions of cards they can't see read as the agent talking about its homework. Near-misses count too: if the browse returns close-but-not-exact options, show the nearest fits as anchors (`also_interesting`) and say what makes them near rather than exact — don't let "not a perfect match" become "the visitor sees nothing". The only good reasons to browse without showing: even the nearest fit would mislead, or the visitor has signalled they want conversation, not cards.
