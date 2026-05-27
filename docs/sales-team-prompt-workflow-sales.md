# Shaping how the agent behaves — a guide for the Swoop sales team

A short workflow doc for Luke, Julie, and the rest of the team. Read it once. Keep the link to hand for when you want to feed something back.

---

## Why prompting agents isn't like instructing humans

When you brief a colleague — *"be a bit warmer with families"* — they automatically associate the instruction with everything they know about families, about Swoop, about the conversation in front of them. Humans do this without noticing. It's how briefings work.

Agents can't. An agent only knows what its instructions tell it, plus what the visitor has said in the current conversation. It can't see the customer's body language. It hasn't sat next to you on a sales call. It doesn't know which lodges are kid-friendly unless that fact has been deliberately fed into the system.

So **prompt-feedback requires a degree of meta-cognition that ordinary briefing doesn't**. The work isn't just "say what you want changed" — it's also "name the trigger the agent should read, and name the context the agent needs to act on it". The rubric below is there to help with that translation.

> **Important.** If you're unsure about the implications of a change, that's fine — it just means we'll need a quick conversation with the assigned prompt engineer to assess the impact. Agents can't infer context reliably without well-layered instructions, so the "is this expensive or cheap?" question is genuinely hard to answer from outside. Asking is the right move. Don't sit on a suggestion because you can't size it yourself.

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

The assigned prompt engineer triages the doc periodically, batches changes, and ships them.

---

## What makes a request expensive — the one big asymmetry

The single most useful framing, and the one most people get wrong on first instinct:

- **Conversational-flow changes are usually cheap.** How the agent talks, when it surfaces something, what tone it uses, when it asks a follow-up vs. when it doesn't — these are edits to the agent's instructions. A few hours to a day or two depending on scope.
- **Data and outcome changes are usually expensive.** When a change requires the agent to **KNOW NEW THINGS** (a new axis of data — whether a lodge has wheelchair access, whether an operator runs gluten-free kitchens, what the weather did last week) or **DO NEW THINGS** (a new outcome — a new tool, a new structured export like a booking checklist, a new kind of visual surface) — that's a meaningfully bigger lift. Days to weeks, often gated by Swoop's data side delivering the underlying information.

If your suggestion implies the agent should **treat people differently based on something we don't already track** (e.g. dietary needs, accessibility, "are they an anniversary couple"), or that it should **produce a NEW kind of output** (e.g. a downloadable comparison table, a "compare these two trips side-by-side" widget) — that's a data/outcomes change. Worth flagging in the request.

If your suggestion is about how the agent talks, when it surfaces what it already knows, or what tone it uses with someone whose intent it can already read — that's conversational-flow. Usually cheap.

Two follow-on rules of thumb:

- **Tone changes touch many conversations.** A "stop being so eager" tweak sounds small. It is small to write. But because the agent picks up tone everywhere, a tone change ripples through every conversation — worth being sure before pulling the trigger.
- **"Just have the agent say X" is suspicious.** If the change is "the agent should mention our 24-hour emergency cover more often", that sounds tiny. But the underlying question is *when* — and "when" usually means a pattern with a trigger. Try to articulate the trigger when you write the request.

---

## A complexity rubric — sizing your own request

Three tiers. The same change can land in any of them depending on what it asks the agent to do differently.

Get it wrong by a tier and nothing breaks — the assigned prompt engineer will rebase. The point is to feel less like you're throwing requests into a void, and to let the team plan around it.

| Tier | What it covers | Rough time | Shape |
|---|---|---|---|
| **Smaller** | Word swaps, tone adjustments inside an existing sentence, banned-phrase additions, paragraph rewrites in the agent's instruction files, sharpening an example. | An hour to half a day. | Conversational-flow only. No new triggers, no new data, no new outcomes. |
| **Moderate** | A new conversational pattern — *when the visitor mentions X, the agent should do Y*. Adds a new "skill" or substantially extends an existing one. Reads signals already present in the conversation. | One to two days. | Conversational-flow with a new trigger. Still no new data, no new outcomes. |
| **Higher** | A change that requires the agent to KNOW NEW THINGS (a new axis of data) or DO NEW THINGS (a new outcome — new tool, new structured output, new flow). Often spawns ingestion or schema work. Sometimes touches the brand/voice dial and needs a conversation first. | Days to weeks, often contingent on Swoop's data side. | Data and/or outcomes. The expensive end. |

### Worked examples

Drawn from real and realistic requests of the kinds the doc has been collecting. Tier sizing is honest, not generous.

#### Smaller

> *"The agent uses 'absolutely' a lot. It feels like an LLM tell. Cut it."*

A single word added to the anti-pattern list. Hour of work.

> *"When the agent says 'our specialists', it sometimes still says 'our sales team' instead. Stamp that out."*

Word-level discipline. Add to the anti-pattern list with the right replacement. Hour.

> *"The way the agent introduces the handoff feels too 'salesy'. I want it to sound like the agent genuinely thinks the visitor will get more out of talking to a person — because they will."*

A paragraph rewrite inside the agent's main instruction file. Half a day including a few sample conversation tests.

> *"When a visitor mentions Antarctica (we're Patagonia-only for now), the agent should acknowledge it warmly and redirect, not just refuse."*

A small new instruction inside the system prompt's "what you must not do" section. Half a day. Still conversational-flow — the trigger (the word "Antarctica") is something the agent reads from the conversation.

#### Moderate

> *"When a visitor signals they're researching for someone else — parents, friends, a partner — the agent should adapt. Surface gift-shape framings. Ask about the recipient rather than the visitor."*

A new "skill" — a self-contained instruction the agent loads when a specific situation comes up. The signal (researching for someone else) is something the agent can read from what the visitor says, so it's a pattern not a new data axis. One to two days including written examples and test conversations.

> *"For premium-tier visitors (anniversary trips, luxury lodges, no obvious budget ceiling), the agent should lean into the bespoke side and not lead with group departures."*

A new skill or an extension of the existing tailor-made one. The signal (premium tier) is something the agent can read from what the visitor says. Pattern, not new data axis. Moderate.

> *"When a visitor mentions they're solo and over 60, the agent should soften the 'epic adventure' framing and lean into the comfort side."*

A new pattern. The signals are conversational. Moderate.

#### Higher

> *"The agent should be able to surface trips that suit specific dietary requirements — coeliac, vegan, severe nut allergy."*

This needs Swoop to capture dietary info per trip / per operator (currently not in the system), then surface that data through the agent, then teach the agent when to read for it. **New data axis.** Higher — probably a week of focused work, contingent on Swoop's data side delivering the info.

> *"When a visitor mentions a recent significant event in Patagonia — wildfires, glacier collapse, a route closure — the agent should know what they're talking about."*

Real-time current-events awareness is structurally outside the current system. Either needs a news-ingest pipeline or a daily-updated current-conditions file the agent reads. **New data axis.** Higher.

> *"The agent should produce a downloadable comparison sheet — two or three trips side-by-side, with the trade-offs spelled out — that visitors can take away and read offline."*

A new outcome (a new structured export, a new UI surface). **New outcome.** Higher.

> *"Can the agent recommend specific trips by name? It feels weird that it dances around them."*

This touches the **Discover/Propose boundary** — the load-bearing reason the agent doesn't construct itineraries or quote prices. Moving the boundary affects brand, legal posture, and what visitors expect from the specialist conversation. Worth a 30-minute call with the assigned prompt engineer before anyone writes anything. Higher — and worth a conversation first.

> *"Should the agent be funnier?"*

The agent's voice is "playful and enthusiastic" but the line between that and AI-cute is narrow. A change here moves a brand dial. Worth a conversation first. Could end up Smaller or Moderate, but the conversation is the gate.

---

## What to expect after submitting

The assigned prompt engineer triages the Google Doc on a rough cadence (currently weekly-ish, may settle to fortnightly once volume normalises). For each entry one of four things happens:

1. **Ships it the same batch.** Smaller changes get bundled and shipped together in the next prompt-iteration drop.
2. **Schedules it.** Moderate and most Higher changes get planned into a sprint — usually with a note in the doc saying *"scheduled for week of X"*.
3. **Parks it pending a conversation.** Anything touching a brand dial, the Discover/Propose boundary, or where the trigger isn't clear enough to action. The doc gets a note back asking the specific thing needed to unpark.
4. **Closes with a note.** Sometimes a change has already shipped under a different framing, or has been superseded, or talked-out in another conversation. The doc gets a note explaining.

Honest about the loop: small things often land within a week. Moderate things land within a fortnight if they're clearly scoped. Higher things land on a real-engineering timetable — measured in weeks, sometimes contingent on Swoop's data side.

**You can chase.** The doc is the canonical channel, not the only one — if something feels stuck or urgent, send the prompt engineer a one-liner and they'll re-triage.

### Future: a Claude skill to help write good feedback

On the cards (TBD timing): a Claude skill aimed at sales-team contributors that will help shape feedback **before** it lands in the Google Doc. It'll ask the questions the prompt engineer would ask — what triggered this, what's the visitor signal, is this conversational-flow or data — and surface the right level of detail. Once it lands, contributors will be able to open Claude, talk through a change, and emerge with a well-shaped Google Doc entry.

This workflow doc is the v0 of that — it explains the framing in prose. The skill is the v1 — it walks you through it interactively. Either way, the loop ends in the same Google Doc.

---

## A note on writing good requests

The single highest-leverage thing you can do when writing an entry: **give a concrete visitor prompt that triggered (or could trigger) the change you want**.

> *"The agent feels too formal with bucket-listers."*

is harder to action than

> *"Visitor said 'I've always wanted to do Patagonia, it just looks magical', and the agent replied with a list of three regions and a paragraph about climate zones. It should have stayed in the dream with them — said something about the place feeling otherworldly first, then maybe asked what drew them in."*

The second form gives the prompt engineer the exact pattern to teach the agent. The first form needs back-and-forth before it can be sized at all.

If you can also name what you think the trigger is — *"when the visitor opens with bucket-list framing, before any specific question"* — even better. But honestly, the visitor-prompt example is the most important thing. Trigger and tier sizing can be inferred from a good example; they're much harder to invent from a vague feeling.

---

## Where this lives in the system

For curious readers — the structure underneath:

- The agent's "brain" lives in [product/cms/prompts/system/ — concatenated into the system prompt at runtime](../product/cms/README.md). Two files: `00_why.md` (the core instructions, ~5,700 words) and `10_style-avoid.md` (the don't-say-this list).
- The agent's situational "skills" live in [product/cms/prompts/skills/ — fourteen named skills](../product/cms/prompts/skills/). The agent loads them on demand when a conversation matches the skill's description.
- Each of the agent's tools (find_inspiring, find_proof, find_options, lookup, find_someone_who, illustrate, handoff) has its own description file under [product/cms/prompts/tools/](../product/cms/prompts/tools/).

You don't need to know the structure to file a good request. But if your request mentions a specific skill ("the dreamer one needs to ease off the wonder") it speeds up scoping.
