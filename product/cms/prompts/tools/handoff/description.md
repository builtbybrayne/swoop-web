Use this when the conversation has reached the moment where a real Swoop specialist would help more than another agent turn. Usually that's the visitor saying something like "how do I book this?" or "I want to talk to someone" or — equally important — when the agent has reached confidence that this person isn't ready to book and that referring them out (or noting them as not-yet) is the honest move. The verdict you pass tells the back-end which mailbox to route to, or whether to route anywhere at all.

The four verdicts are `qualified` (this person is real, motivated, ready for a sales conversation), `referred_out` (genuine traveller but better served by a partner — different region, different shape of trip), `disqualified` (clearly not a fit — vendor, journalist, ambiguous wandering question), and `inconclusive` (we never reached confidence — this is the agent's "I don't know" verdict, used after enough turns that further probing isn't going to change anything). Pair the verdict with a short reason code, a one-paragraph conversation summary, and a phrase that captures what motivates them — what made them open the conversation. The widget opens with that context; the visitor enters their contact details if they want to.

*When to pick this:* you've reached a verdict and the next move is either a specialist conversation or a graceful close. Don't reach for this just because the conversation is long — the right moment is when continuing the agent turn would dilute what the visitor needs. Tier-2 (handoff) consent gets captured inside the widget, not before. Submission of contact details flows through `handoff_submit` (which the widget calls directly, not the model).

**Verdict + reasonCode catalogue.** Pick exactly one reasonCode per verdict from this list — the schema enforces verdict-specific codes (an invalid `(verdict, reasonCode)` combination is rejected at the tool-call boundary, not late at the durable-record write).

`qualified` — warm lead ready for a specialist:
- `ready_booking_named_trip` — visitor named a specific trip/tour + asked a booking-adjacent question.
- `ready_comparing_shortlist` — visitor narrowed to 2–3 options; wants help choosing.
- `budget_and_timeline_confirmed` — both budget band AND travel window are explicit and in-scope.
- `group_tour_intent` — strong small-group / "with a guide" signal. **Luke's stated upsell priority** — lean toward this when the signal could go either way between qualified flavours.
- `bespoke_request` — visitor asked about something explicitly customisable (private guide, unusual combination, non-standard duration).
- `qualified_other` — catch-all.

`referred_out` — outside Swoop's direct service scope but still deserves a helpful next step:
- `below_profit_floor` — budget explicitly places the booking under the <$1k-profit threshold.
- `out_of_region` — visitor wants a destination Swoop doesn't serve in Puma (e.g. Africa, Himalayas).
- `timing_outside_window` — departure window falls outside what Swoop programs (off-season / too-soon).
- `referred_other` — catch-all for "right person, wrong moment".

`disqualified` — clearly not a lead:
- `backpacker_no_budget` — visitor self-identifies as backpacker / no budget / explicitly looking for free info only.
- `off_brand_query` — visitor is asking about something outside Swoop's territory + clearly not a candidate.
- `proxy_to_claude` — visitor using the chat as a proxy to Claude (coding help, unrelated research).
- `disqualified_other` — catch-all.

`inconclusive` — agent never reached confidence to qualify, refer-out, or disqualify:
- `low_engagement` — visitor sent very few turns; no signal to act on.
- `mixed_signals` — visitor sent contradictory cues (high budget + backpacker register; bespoke ask + browser-tier urgency).
- `extended_no_convergence` — long conversation that never narrowed to a region/style/budget the agent could act on.
- `comparison_shopping` — visitor admitted they're comparing other operators / using Puma to research before booking elsewhere.
- `off_offer_in_region` — visitor wants Patagonia but in a way Puma can't help (specific obscure trek not in catalogue).
- `drive_by` — visitor curious / clicked speculatively; never engaged with the experience.
- `inconclusive_other` — catch-all.

For `qualified` and `referred_out` the lead-capture widget will collect contact details (name + email + optional preferences); for `disqualified` and `inconclusive` the widget renders a graceful close without asking for contact — the durable record is for analytics only.

**Two summaries — who sees what.** Every `qualified` / `referred_out` call produces both:

- **`specialistSummary`** is for the Swoop specialist who will pick up the conversation. Rich, sectioned-friendly prose — include archetype read, relational-mode read, the motivation arc, signal-pattern observations, direct quotes from the visitor, and the texture of what moved them. Favour richness; the specialist wants enough texture to hit the ground running. The visitor never sees this; it lands as the *Conversation summary* section in the specialist email.

- **`visitorPrecis`** is shown to the visitor (default-collapsed) inside the form as reassurance their choices have been captured. **MUST** contain only logistical / practical content: destinations, travel windows, duration, budget band if shared, activity preferences, accommodation style, party composition. **MUST NOT** carry archetype reads, relational-mode reads, motivation interpretations, R×W reads, psychological framing, or any "profile" of the visitor. Use the visitor's own phrasings where you can. Keep it short — one or two sentences, under ~300 chars. This text is **never** sent to the specialist; persisting it in the durable record is for audit only.

On `disqualified` / `inconclusive` the widget doesn't render, so `visitorPrecis` is optional and the specialist still gets `specialistSummary` via the durable record.

The form also has an optional "Anything else the specialist should know?" textarea the visitor can fill in directly. That free text is sent to the specialist alongside your summary (under its own section in the email), but you don't produce it — the visitor does. Don't try to anticipate or pre-fill it.
