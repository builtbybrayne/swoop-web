# Shaping how the agent behaves — a guide for the Swoop sales team

A short workflow doc for Luke, Julie, and the rest of the team. Read it once. Keep the link to hand for when you want to feed something back.

---

## What the agent is doing on Swoop's website

The discovery agent is a conversational guide that sits inside Swoop's website. It meets visitors who are curious about Patagonia and helps them get to the point where they actively want to talk to a specialist. It runs **inside Discover** in Swoop's three-stage sales process — it does not Propose and does not Close.

Across any one conversation it can do five things. They aren't a script; the agent reads the visitor and reaches for whichever fits the moment.

| Job | What it looks like |
|---|---|
| **Inspire** | Bring Patagonia alive — sensory anchors, specific places, stories from named specialists. The lever for a visitor who's only half-imagining themselves there. |
| **Mirror** | Reflect what the visitor has shared back at them, so they feel heard. *"You mentioned your husband isn't into hiking — let's keep that in view."* |
| **Reassure** | Acknowledge the real weight of a £5–30k trip without flattering. Honest about pros and cons. Sound like the most knowledgeable guide you've ever met, not a brochure. |
| **Inform** | Surface facts and structured options when the visitor wants substance — regions, seasons, trip shapes, what a W trek actually involves. |
| **Propose options** | Show a small set of real trips or shapes when the visitor is ready to look at concrete possibilities. Never as a sales pitch — as a discovery. |

A visitor moves through four loose states as the conversation deepens — Awareness ("I've seen videos") → Interest ("tell me more about Torres del Paine") → Strong Consideration ("could we do this in October?") → Handoff ("yes, put me through to a specialist"). The agent doesn't track which state a visitor is in mechanically; it reads the room and adjusts.

The agent **won't** build day-by-day itineraries, name specific ships unprompted, quote specific prices, or initiate bookings. Those are specialist work, by design.

---

## Where to send a prompt-change request

Use the shared Google Doc (the one we've been adding to all along). One entry per change. A good entry is:

- **Concrete.** A specific behaviour you want changed, not a general feeling.
- **Grounded in a real conversation.** Either a visitor prompt you saw, or one you can imagine clearly. *"When a visitor says X, the agent should do Y instead of Z."*
- **Honest about what triggered it.** A single off conversation, a recurring pattern, a hunch about a customer type Swoop wants more of — all valid, but worth naming.

Alastair triages the doc periodically, batches changes, and ships them.

---

## A complexity rubric — sizing your own request

The same change can be cheap or expensive depending on what it asks the agent to *do differently*. This table lets you size a request before submitting it. Get it wrong by a tier or two and nothing breaks — Alastair will rebase. The point is to feel less like you're throwing requests into a void.

| Tier | What it covers | Rough time | Examples |
|---|---|---|---|
| **Tweak** | A word swap, a tone adjustment inside an existing sentence, adding or removing a banned phrase. | An hour or two. | *"Stop using the word 'journey' as a verb."* |
| **Small change** | Rewriting a paragraph in one of the agent's instruction files, sharpening an example, adding a new specific don't-say item. | Half a day. | *"The 'specialist handoff' explanation feels too transactional — rewrite it so it sounds more like a warm introduction."* |
| **Medium** | A new conversational pattern — *when the visitor mentions X, the agent should do Y*. Adds a new "skill" or substantially extends an existing one. | One to two days. | *"When a visitor mentions they're researching for someone else, treat them as a Companion who's also a Confidante for the absent person."* |
| **Big** | A structural change. A new conversational move, a new data type the agent needs to surface (e.g. "show photos of the food at refugios"), a new tool. Often spawns work in several places. | Days to weeks. | *"The agent should know which trips have solo-traveller-friendly room arrangements, and surface them for solo visitors."* |
| **Design decision needed** | Involves a trade-off that needs a conversation before it can be scoped. Often touches brand voice or commercial posture. | Variable — schedule a call. | *"The agent should be more willing to recommend specific trips by name."* (changes the Discover/Propose boundary) |

### What makes a request expensive — without the dev jargon

The single most useful framing:

- **If your suggestion asks the agent to BEHAVE DIFFERENTLY based on something we already capture** (what the visitor has said, what state they're in, whether they're a solo traveller, etc.) — that's a *pattern*. Patterns are usually cheap (Tweak / Small / Medium).
- **If your suggestion asks the agent to KNOW SOMETHING NEW about a visitor or a trip** (whether they have kids, whether a lodge has wheelchair access, whether a region had wildfires last month) — that's a *new axis of data*. New axes are expensive (Big), because the data has to get into the system before the agent can use it.

Two follow-on rules of thumb:

- **Tone changes touch many conversations.** A "stop being so eager" tweak sounds small. It is small to write. But because the agent picks up tone everywhere, a tone change ripples through every conversation — worth being sure before pulling the trigger.
- **"Just have the agent say X" is suspicious.** If the change is "the agent should mention our 24-hour emergency cover more often", that sounds like a Tweak. But the underlying question is *when* — and "when" usually means a pattern with a trigger, which makes it Medium. Try to articulate the trigger when you write the request.

---

## Worked examples — sized by tier

Drawn from real and realistic requests of the kinds the doc has been collecting. Tier sizing is honest, not generous.

### Tweak

> *"The agent uses 'absolutely' a lot. It feels like an LLM tell. Cut it."*

A single word added to the anti-pattern list. Hour of work. The agent's [10_style-avoid.md — patterns to avoid](../product/cms/prompts/system/10_style-avoid.md) already bans "absolutely" under intensifier padding, so this one's actually already shipped — but it's the right shape of request.

### Tweak

> *"When the agent says 'our specialists', it sometimes still says 'our sales team' instead. Stamp that out."*

Word-level discipline. Add to the anti-pattern list with the right replacement. Hour.

### Small change

> *"The way the agent introduces the handoff feels too 'salesy'. I want it to sound like the agent genuinely thinks the visitor will get more out of talking to a person — because they will."*

A paragraph rewrite inside the agent's main instruction file ([00_why.md — system prompt brain](../product/cms/prompts/system/00_why.md)), specifically the section that frames the handoff. Half a day including a few sample conversation tests.

### Small change

> *"When a visitor mentions Antarctica (we're Patagonia-only for now), the agent should acknowledge it warmly and redirect, not just refuse."*

A small new instruction inside the system prompt's "what you must not do" section. Half a day.

### Medium

> *"When a visitor signals they're researching for someone else — parents, friends, a partner — the agent should adapt. Surface gift-shape framings. Ask about the recipient rather than the visitor."*

A new "skill" — a self-contained instruction the agent loads when a specific situation comes up. The agent already has skills like [engaging-a-dreamer — posture for a visitor whose warmth runs ahead of readiness](../product/cms/prompts/skills/engaging-a-dreamer/SKILL.md) and [group-tour-surfacing-for-solos — recognising solos who'd benefit from a group departure](../product/cms/prompts/skills/group-tour-surfacing-for-solos/SKILL.md). This would be `researching-for-someone-else`. One to two days including written examples and a couple of test conversations.

### Medium

> *"For premium-tier visitors (anniversary trips, luxury lodges, no obvious budget ceiling), the agent should lean into the bespoke side and not lead with group departures."*

A new skill or an extension of the existing tailor-made one. The signal (premium tier) is something the agent can read from what the visitor says, so it's a pattern not a new data axis. Medium.

### Big

> *"The agent should be able to surface trips that suit specific dietary requirements — coeliac, vegan, severe nut allergy."*

This needs Swoop to capture dietary info per trip / per operator (currently not in the system), then surface that data through the agent, then teach the agent when to read for it. New data axis. Big — probably a week of focused work, contingent on Swoop's data side delivering the info.

### Big

> *"When a visitor mentions a recent significant event in Patagonia — wildfires, glacier collapse, a route closure — the agent should know what they're talking about."*

Real-time current-events awareness is structurally outside the current system. Either needs a news-ingest pipeline or a daily-updated current-conditions file the agent reads. Big — and arguably *Design decision needed*, because there are several ways to solve it and they have different cost profiles.

### Design decision needed

> *"Can the agent recommend specific trips by name? It feels weird that it dances around them."*

This touches the **Discover/Propose boundary** — the load-bearing reason the agent doesn't construct itineraries or quote prices. Moving the boundary affects brand, legal posture, and what visitors expect from the specialist conversation. Worth a 30-minute call with Alastair before anyone writes anything. Variable.

### Design decision needed

> *"Should the agent be funnier?"*

The agent's voice is "playful and enthusiastic" but the line between that and AI-cute is narrow. A change here moves a brand dial. Worth a conversation.

---

## What to expect after submitting

Alastair triages the Google Doc on a rough cadence (currently weekly-ish, may settle to fortnightly once volume normalises). For each entry he does one of four things:

1. **Ships it the same batch.** Tweaks and most Small changes get bundled and shipped together in the next prompt-iteration drop.
2. **Schedules it.** Medium and most Big changes get planned into a sprint — usually with a note in the doc saying *"scheduled for week of X"*.
3. **Parks it pending a conversation.** Design-decision items, things that look small but spawn consequences, and requests where the trigger isn't clear enough to action. The doc gets a note back asking the specific thing needed to unpark.
4. **Closes with a note.** Sometimes a change has already shipped under a different framing, or has been superseded, or talked-out in another conversation. The doc gets a note explaining.

Honest about the loop: small things often land within a week. Medium things land within a fortnight if they're clearly scoped. Big things land on a real-engineering timetable — measured in weeks, sometimes contingent on Swoop's data side. Design-decision items don't move until a conversation has happened.

**You can chase.** The doc is the canonical channel, not the only one — if something feels stuck or urgent, send Alastair a one-liner and he'll re-triage.

---

## A note on writing good requests

The single highest-leverage thing you can do when writing an entry: **give a concrete visitor prompt that triggered (or could trigger) the change you want**.

> *"The agent feels too formal with bucket-listers."*

is harder to action than

> *"Visitor said 'I've always wanted to do Patagonia, it just looks magical', and the agent replied with a list of three regions and a paragraph about climate zones. It should have stayed in the dream with them — said something about the place feeling otherworldly first, then maybe asked what drew them in."*

The second form gives Alastair (or whoever inherits this loop) the exact pattern to teach the agent. The first form needs back-and-forth before it can be sized at all.

---

## Where this lives in the system

For curious readers — the structure underneath:

- The agent's "brain" lives in [product/cms/prompts/system/ — concatenated into the system prompt at runtime](../product/cms/README.md). Two files: [00_why.md](../product/cms/prompts/system/00_why.md) (the core instructions, ~5,700 words) and [10_style-avoid.md](../product/cms/prompts/system/10_style-avoid.md) (the don't-say-this list).
- The agent's situational "skills" live in [product/cms/prompts/skills/ — fourteen named skills](../product/cms/prompts/skills/). The agent loads them on demand when a conversation matches the skill's description.
- Each of the agent's tools (find_inspiring, find_proof, find_options, lookup, find_someone_who, illustrate, handoff) has its own description file under [product/cms/prompts/tools/](../product/cms/prompts/tools/).

You don't need to know the structure to file a good request. But if your request mentions a specific skill ("the dreamer one needs to ease off the wonder") it speeds up scoping.
