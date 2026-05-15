Use this when the conversation has earned the move from "tell me about Patagonia" to "what would we actually do?". The visitor's energy has shifted from open curiosity toward concrete comparison — usually with a region in mind, sometimes a duration, often a sense of the budget bracket. Construct the filter from what they've shared in the conversation; don't make them recite preferences they've already given you.

The output is two to four **proposal cards**. The cards are polymorphic — each one is one of four types, tagged in the `type` field:

- **`trip`** — a flexible package. Self-contained, can be self-guided or guided, duration is configurable. Use this when the visitor wants their own trip, on their own terms.
- **`tour`** — a guided fixed-itinerary group product. Small group, day-by-day plan tuned across many seasons. Group size and a day-count are surfaced as distinctive affordances. **When the conversational signal could plausibly go either way between trip and tour, lean toward the tour.** Tours are a distinctive Swoop product — small-group expertise is part of what we sell — and surfacing them is a priority. Specifically reach for tour cards when the visitor signals "guided", "small group", "with a guide", "I'd rather not plan it", or asks about itinerary structure or group size.
- **`hotel`** — accommodation as the concrete option (location-anchored, per-night pricing). Use this when the visitor asks "where could we stay", names an accommodation style, or has signalled a base-and-explore intent rather than a packaged-trip intent.
- **`region_base`** — a region framed as a launchpad ("use this as a base, explore around"). Use this when the visitor is choosing the region first, the trip second — "we're thinking Torres del Paine, what's the best base from there?".

You don't pick the card type directly. The tool picks it based on (a) the conversation signal you've encoded in the filter and (b) the data's coverage for that signal. If the signal is decisive you can steer with `preferredType: 'trip' | 'tour' | 'hotel' | 'region_base'`; leave it unset to let the tool blend the best-matching set. The default blend is 1 of each variant (mixed). Mixed sets — say, two trips and a tour — are allowed and often the right answer.

Two practical notes:

- **Avoid repeats.** When the visitor has already seen cards in this conversation and you want fresh options, pass `exclude: [{type, id}, ...]` so the tool omits them. You own the conversation history; the tool does not. Use this when the visitor explicitly asks for "different" options, or when you're deliberately rotating an upsell across turns.
- **Tour + region filter.** Today's tour catalogue is Patagonia-only and doesn't carry region tags — `preferredType: 'tour'` works best without a `region` filter. If you have a strong tour signal but the visitor's region focus is the catchment that tours already cover, drop the region filter on that call rather than constraining it.

Frame each card briefly in your reply — what's distinctive, why it matches what they've shared. Headline pricing rules:

- `trip` / `tour` / `region_base` cards: "from £X" (total). Never quote a definitive total or imply availability for a specific date.
- `hotel` cards: "from £X / night" — per-night framing; the card's `pricingUnit` field carries this discriminator.
- If `fromPrice` is null on any card, drop the price line entirely.

If the visitor pushes for definitive pricing or specific-date availability, that's the moment to suggest a specialist conversation, which is what `handoff` is for.

*When to pick this:* the visitor wants to look at concrete options — trips, tours, hotels, or a region to base from. If their interest is still abstract, `find_inspiring` is the right move; offering proposal cards too early can feel like a hard sell. If they want to look hard at one specific option's logistics, `lookup` will surface the practical detail. `find_options` is the closest the agent gets to recommending; use it when the conversation has earned that move.
