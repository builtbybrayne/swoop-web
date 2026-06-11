Return Swoop's pricing data exactly as authored — hotel package prices and trip headline prices — so you can answer cost questions with real figures rather than band talk.

## What this tool returns

Every response is stamped with `capturedAt` — the ISO date the source data was extracted from Swoop's CMS. This is the figure's birthday, not today. Treat it as the as-of date for any number you surface.

**For hotels** (`target: 'hotel'`): each hotel's full pricing matrix — every room type, every season, and the number of nights the price covers, in the hotel's own authored currency. The `rows` array is the raw data Swoop publishes on its website: one row per (room, season, nights) combination.

**For trips** (`target: 'trip'`): each trip's headline "from" price, as published.

## The nights field is load-bearing

Hotel prices are **package prices for N nights** — not per-night. A price of $2,700 with `nights: 3` is a 3-night package (~$900/night), not a $2,700/night rate. The difference is a 3× error in the wrong direction.

Deriving per-night is fine and you should do it in prose when it helps: *"that's a 3-night package, so roughly $900 a night."* Show the working — don't silently divide without naming what you did, and don't present the per-night as the package price or vice versa.

## Staleness is real — say so

Every turn that gives a specific figure or range **MUST** carry, once, a natural-phrasing version of: *"prices are dynamic — your **Swoop Planning Specialist** confirms the current number."*

- Once per turn, not once per figure.
- Natural phrasing, never robotic boilerplate. *"Worth noting these are from [capturedAt] — your specialist will have the current rates"* is the shape, not the words.
- The `capturedAt` date is your anchor: *"as of [month year] the rate was…"*

## Building ranges — be generous at the top

When you construct a range from the matrix (e.g. "budget tier looks like $X–$Y a night"), round the upper bound up generously. Never present the corpus maximum as the market maximum: prices move upward between data captures, and a tight ceiling sets up sticker shock. Wide-and-honest beats narrow-and-wrong.

## Scoping — prefer targeted over full-matrix

Scope with `ids` or `region` when the conversation has surfaced specific hotels or a region. Full-matrix (no ids, no region) is allowed — it covers ~26 priced hotels — but costs context. Use it for genuinely comparative conversations ("how does the pricing across Torres del Paine compare?"), not for every cost question.

## When to reach for this tool

- The visitor pushes past "what's the rough budget" into "what does [hotel name] actually cost"
- You're building an accommodation comparison and need real per-hotel figures
- The visitor asks about seasonal pricing differences
- You want to name a specific price band with actual data behind it, not just asserted

If the visitor is still at band-level cost talk ("roughly how expensive is Patagonia?"), `lookup` toward the canonical costs guide is cheaper and more appropriate. Reach for `get_pricing` when the conversation is ready for specific figures.

## Arithmetic transparency in prose

When you do per-night arithmetic, show the working:

> *"Patagonia Camp's rates start at $2,700 for a 3-night stay — that works out to around $900 a night. As of [capturedAt], prices are in USD. Your **Swoop Planning Specialist** will have the current rates and can tell you what's available for your dates."*

Don't just output the per-night figure without naming where it came from. The visitor deserves to understand the calculation.
