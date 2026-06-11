# Luke briefing — business implications surfaced by the build

Running list of things Luke (or Julie, where marked) should be aware of. **Business implications only — no technical detail.** Each entry: what it means for the business, and what (if anything) Swoop can do about it. Sibling file to [questions.md](questions.md) (asks needing Swoop input) and [inbox.md](inbox.md) (our ad-hoc captures); entries here graduate into Alastair's emails/calls with Luke and get marked RAISED, then CLOSED when acknowledged or resolved.

Append new entries at the top. Format: `## YYYY-MM-DD — title (STATUS)`.

---

## 2026-06-11 — Tours have no prices anywhere in the website data (NEW)

Tours are the stated business priority, and price-conscious visitors are exactly who the tool is meant to steer toward them — but the website's own data carries no tour prices (the website calculates them on the fly from the trips inside each tour). So the agent can recommend a Group Tour and explain *why* it manages cost well, but cannot say what one costs, even approximately. The cheapest fix is also the most reliable one: the four Swoop Group Tours' headline prices, supplied alongside the page link Luke already offered (the open four-tours item in [questions.md](questions.md)). Four numbers close the gap.

## 2026-06-11 — A third of the catalogue has no price at all in the CMS (NEW)

About 30% of trips and 18 of the 44 hotels carry no price in the website's own database. For those items the agent can't reason about budget fit, and budget-aware shortlisting quietly skips them or includes them blind. This is a content gap on Swoop's side, not a tooling gap — anything priced on the website flows into the tool automatically. Worth knowing when judging the agent's cost conversations: where it goes vague, the source is often empty.

## 2026-06-11 — Cost-content quality on the website needs a pass (NEW)

Two findings from tracing the agent's cost answers to their sources. First: the top-ranked FAQ for "what does it cost" questions carries figures Luke himself dates to ~2011 — the correction at source is already asked (see [questions.md](questions.md) "Stale cost figures in FAQ content"); until it's edited, guardrails stop the agent *citing* it, but the right answer can't exist without a current source. Second: the canonical "Patagonia travel costs explained" page has a section of literal placeholder text ("Lorem ipsum…") live in the CMS. The agent now filters it out, but it's presumably visible on the website too. A half-day content pass over the cost pages would lift both the website and the agent.

## 2026-06-11 — Where do prices actually live: Product Library or website? (NEW)

Luke's June feedback framed the Product Library as the right pricing source. In the April technical call, Thomas and Richard said the opposite: prices live only on the website, not in the Product Library. Both can't be current. This needs a five-minute reconciliation with Thomas/Richard **before** any decision to invest in Product Library ingestion — if the Library still has no pricing, the website data we already use is the pricing source, and the Library project buys less than assumed.

## 2026-06-11 — Price freshness is an operational dependency on Swoop (NEW)

Every price the tool knows is a snapshot from the late-April data export; we currently can't get a fresh one. The agent is built to be honest about this ("prices are dynamic — your Planning Specialist confirms the current number"), but honesty is a mitigation, not a fix: the longer the gap between exports, the more often the agent has to hedge. Resuming the weekly export the team agreed in April is the cheapest accuracy improvement available — one file, once a week, and every price in the tool refreshes.

## 2026-06-11 — A few dozen trips are priced in Chilean pesos (NEW)

38 trips carry prices authored in CLP, so a card can read "from CLP 4,108,100" — accurate, but jarring for the mostly UK/US audience. We deliberately don't convert currencies (converted numbers drift from what the website shows). If those trips matter to the funnel, the clean fix is authoring their headline prices in USD/GBP in the CMS, same as the rest of the catalogue. Presentation-policy call for Swoop, not urgent.
