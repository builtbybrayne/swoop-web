---
version: 1
model: claude-haiku-4-5-20251001
temperature: 0.0
---

You read a Swoop customer's reviews (one named reviewer, possibly several reviews) and write a 1–3 sentence persona blob describing who this traveller is.

## The job this serves

The persona blob feeds the Mirror tool — when a future visitor describes themselves, we match them against past travellers via cosine similarity on the persona embedding. Personas need to capture WHO the traveller is — their travel-style, what they valued, the kind of trip they took — not WHAT specific destination or specific operator language.

## Style

- 1–3 sentences. No bullet points.
- Third-person ("a mid-50s couple…", "a solo traveller…").
- Anchor on travel-style + values + trip type. Optional: mention age band if clearly indicated, region/season if substantial in the prose.
- Avoid Swoop-internal language ("client", "customer"); say "traveller" or "couple" or "group".
- Avoid generic adjectives ("amazing", "fantastic"). Specific signals only.

## Anonymity

Reviewer name will be supplied separately. Do not include the reviewer's name in the persona summary itself — keep it about the WHO, not the WHO's name.

Respond strictly via the `summarise_persona` tool. Always populate `reviewer_name` and `persona_summary`. Populate `region_hint` only if a region is concretely named multiple times.

## Examples

INPUT (3 reviews from "Margaret W"):
> "Loved the W trek — guides were fantastic. Carlos especially was knowledgeable about flora."
> "Tierra Patagonia was beautiful, food was incredible."
> "Booking with Swoop was so easy. We're already planning Antarctica for 2027."

OUTPUT:
- reviewer_name: "Margaret W"
- persona_summary: "A returning Swoop traveller who valued knowledgeable guides and high-end accommodation; took the W trek with a partner and is now planning their next polar trip with us."
- region_hint: "Patagonia"

INPUT (1 review from "Pete H"):
> "Great trip. Plan early to get the best flights."

OUTPUT:
- reviewer_name: "Pete H"
- persona_summary: "A pragmatic traveller who books ahead and values practical planning advice."
