# Luke's test scenarios — 12 Jun 2026

Luke's working test set for the discovery tool, relayed by Alastair 2026-06-12: twelve themed visitor shapes, each with the exact first message Luke types. These are the client's acceptance lens — when Luke "tests the tool", this is what he sends.

**Canonical executable form**: the harness family `product/harness/scenarios/luke-01-*.yaml` … `luke-12-*.yaml` (authored same day). Each scenario pins Luke's first message verbatim in the user-agent persona and carries a theme-derived judge rubric. Run the family:

```sh
cd product && export $(grep '^ANTHROPIC_API_KEY=' orchestrator/.env | head -1) \
  && npm run -w @swoop/harness eval -- --filter luke- --judge sonnet
```

(Agent-as-user scenarios need `ANTHROPIC_API_KEY` in the harness env — it does not self-load dotenv. Stack must be running on :8080.)

**Provenance rule**: if Luke revises his set, update BOTH this capture and the YAML family; this doc is the source of truth for his exact wording.

**Baseline runs**: first judged baseline 2026-06-12 — **5/12 pass** ([results](../../product/harness/runs/luke-baseline-judged-2026-06-12/results.md)); deterministic tool assertions a clean sweep; failure taxonomy + the five open calibration items in [progress.md](../../progress.md) "2026-06-12 (later)". Two rubric defects found in that run are fixed in the YAMLs (luke-02 arithmetic, luke-09 over-disclosure) — their verdicts re-settle on the next family run.

---

| # | Theme | First message (verbatim) |
|---|---|---|
| 1 | An early-stage user trying to understand when, where, what questions | I'm considering a trip to Patagonia with my fiancee. There's so much info here. Where should I start? |
| 2 | Luxury traveller who knows they want to stay at an explora | My wife and I are interested in staying at the Explora. How many days should we stay and how much will it cost? |
| 3 | Someone who's all about the day hikes and knows when they want to travel, but wants to find out more | I want to go hiking in Patagonia. Can you give me some ideas for routes and national parks. |
| 4 | Someone trying to work out whether they can afford it | I'm interested in a trip to Patagonia. How much will a 2 week trip cost? |
| 5 | Someone who knows what they're looking for and they're trying to understand who the hell swoop are | We're looking to visit Torres del Paine and do the Australis cruise before heading up to the Atacama desert. What would you advise? How can you help? |
| 6 | Someone whose primary motivation is the wildlife, either pumas or whales | Where's the best place for us to photograph Pumas and Whales? |
| 7 | Someone who's got a pretty good idea of where they want to go and an indicative itinerary, and they're wondering how Swoop can support or add value | I'm planning a two week trip with friends. We're going to start in Santiago, stay at Patagonia Camp in Torres del Paine, then cross to El Chalten for a few days then finish in Buenos Aires. How much would this cost? |
| 8 | Someone who has looked at lots of different trips and is just a bit confused about what next | I want to go to Torres del Paine and have seen lots of different trips. How do I choose? |
| 9 | Someone with specific dates in mind because they've already booked their flights and now they want to know what's possible | I'm in Chile from 12th November to 25th. What tours do you have available? |
| 10 | Someone who wants to see the whole of Chile and Argentina in two weeks and is trying to work out what to do with three days in Patagonia | We're planning to do Chile and Argentina in January 2027. Where should we stay in Patagonia? |
| 11 | Want to check price of something / get a quote / confirm availability | I want to book the Australis cruise on 5th January then stay at Tierra Patagonia. How much would that cost? |
| 12 | Want to book today | I want to book the W Trek on 5th November. |
