# Website Discovery Tool: Quoting Notes

**Date:** 23 March 2026
**Status:** Working through options. Nothing finalised. Lots of open questions.

---

## The Emails

### Luke:
> We concluded that we want to develop a discovery focussed conversational interface for the websites (that would help us test and learn for any applications within AI engines in the future). Julie and I think your expertise could be really valuable in helping us work out the smartest way to build that, and our CFO has urged us to get others to quote as well. Julie will be in touch.

### Julie (reply to the ChatGPT production email):
> Thanks you so much for sending this over. We are weighing up options at the moment, would it also be possible to get a similar quote should we wish to put this on the Swoop Antarctica website? Please let me know if you have any questions.

### What these tell us:
- Julie thinks this is comparable scope to the ChatGPT production launch (4+2 days, £3,800). "Similar quote" and "put this on the website" suggest she's imagining redeployment, not a new build.
- Luke's framing is different: "help us work out the smartest way to build that." More open-ended. Inviting input on approach.
- CFO wants competitive quotes for the website piece (not for the ChatGPT production work).
- They may have already trialled a simple chatbot. Unknown what happened with it. Worth asking.
- Mark Reed is in the background with good conceptual ideas. Appreciated.

### The miscalibration:
The ChatGPT version works because ChatGPT provides the conversation engine, the UI, the session management, and the model. A website version means building those layers. Julie's "similar quote" assumption is understandable but wrong.

Our own reporting probably contributed to this. The exec summary said "moderate complexity, low uncertainty because the patterns are well understood" and emphasised what carries across. A non-technical reader could easily land on "similar effort." Need to gently correct without contradicting the reporting or being patronising.

---

## Alastair's Position and Goals

### What Alastair wants (still working this out):
- Position as architect and conversation design lead, not just a dev for hire
- Introduce the Prompt Loom concept subtly (prompt management layer) without overselling
- Ideally partner with Platform48 (Joe) for dev work, but this depends on Joe's response
- Not be shuffled out if Joe or another bidder undercuts on price
- Win this work on terms that play to his strengths

### Where he's vulnerable:
- Joe's team can build a website chatbot. They have dev capacity, GCP knowledge, existing Swoop relationship.
- If Swoop frames this as "build us a chatbot," Alastair loses on capacity and price.
- Any competent dev shop can wire up a RAG chatbot.

### Where he's not vulnerable:
- Nobody else designed the conversational architecture, sales methodology encoding, enrichment model, guidance payload, or tool descriptions.
- The demo quality came from the conversation design, not the TypeScript.
- Luke already positions Alastair as the expert who shapes the approach.
- The codebase was architecturally designed for multi-platform reuse.

### Two distinct areas of value:
1. **Core agentic implementation.** Orchestration layer, state management, memory, tool calling. Practical experience with Google ADK and the gotchas. This is dev work, but specialist dev work.
2. **Conversation design and prompt engineering.** The psychology of discovery conversations. What the agent asks, when, how it reads signals, how it handles concerns. This is what made the demo work. Nobody else can do this for Swoop.

### The honest position:
If they just want a chatbot that RAGs their Library, Joe's team can handle it and Alastair would say so. The added value is in the conversation architecture, memory/learning design, and prompt engineering. That's psychology + prompt engineering + stakeholder advocacy, not just software.

But: proving this value is hard without evidence. The demo is the closest thing to evidence. Luke saw it and was enthusiastic. Whether that enthusiasm translates into paying for the expertise layer (vs. just getting a cheaper chatbot) is the open question.

---

## The Prompt Loom Connection

The Prompt Loom is Alastair's product concept under the LOPE brand. MCP-native prompt management tool. Multi-stakeholder governance, runtime assembly, version control.

The reporting docs identified exactly this problem for Swoop: sales team needs to own agent behaviour without developer tickets. The Prompt Loom solves it.

### Current thinking on how to handle this:
- Don't name "Prompt Loom" to Swoop. Describe the capabilities as Swoop requirements (which they are).
- Keep the Prompt Loom product conversation with Joe separate from the Swoop engagement.
- Charge full rate for Swoop work. Don't reduce rate for IP. Don't entangle commercial arrangements. (Considered the reduced-rate-for-IP angle and decided against it. Signals "I need this more than you need me.")
- If something emerges from the Joe/Prompt Loom conversation that benefits Swoop, great. But keep it separate.

This is still being thought through. The Joe conversation may change the picture.

---

## The Joe Humphries Play

Email sent proposing a 30-minute call. Key points in the email:
- Swoop discussing next steps, asking Alastair to quote
- Acknowledged Joe may be asked too
- Pitched joint approach as stronger than solo
- Referenced previous conversation about prompt management idea
- Flagged timing sensitivity

### Why this matters:
- Joint Buddy Apps + Platform48 proposition is hard for competitors to match
- Joe has infrastructure context and dev capacity
- If Joe goes direct to Swoop without Alastair, that's a real risk
- Plan B if Joe doesn't engage: the scoping/architecture work stands on its own

### Status: RESOLVED. Joe not interested in website build work — Platform48 is a web apps agency, not websites. No threat, no resource. Quote stands alone.

### The Joe email (sent):
```
Hi Joe,
Swoop and I are discussing possible next steps after the ChatGPT integration experiment. They want to prioritise a discovery-focused conversational interface for their website, and are asking me to quote. I imagine they might also be asking you the same. Julie's also asking about taking the ChatGPT prototype to production.

I think there's a really interesting opportunity with the website bit. There's a likely benefit to a well-thought-out orchestration and prompt management layer that goes beyond what I did in the demo. I mentioned this in our previous chat, and have been developing this idea further since we last spoke. I think there's something here with legs beyond just Swoop.

Your dev capacity and infrastructure knowledge could make a joint pitch much stronger than either of us going alone. Are you up for 30 minutes in the next couple of days to talk it through? They're actively looking at this now, so there are likely some timing sensitivities.

Let me know your thoughts. And if you want to just book a time straight off the bat, I've got a bookable diary at https://savvycal.com/albrayne/meet.
All the best Alastair
```

---

## Technical Analysis: What Does the Simplest Website Prototype Actually Need?

### Key reframe:
The complexity here isn't "hard problems nobody has solved." Alastair has built all of this before. It's more that there are a lot of moving parts to step through and put together. Complexity is medium-to-high because of the breadth of things to address. Implementation time is the real variable, not intellectual difficulty.

### What carries across from the ChatGPT build:
- The search functions, data access logic, embedding/vector search
- The guidance payload content (needs restructuring, not rewriting)
- The product data (ships, cruises, activities)
- The image catalogue and imgix CDN serving
- The React widget rendering code (carousels, ship cards, detail views, handoff form). These are UI components that can be triggered whenever we want. The rendering logic exists. What needs replacing is the integration layer (useApp hooks, structuredContent) that's specific to ChatGPT's Apps SDK runtime.

### What's new:

**1. Agent runtime (Google ADK + Claude)**
- ADK agent definition and configuration
- Claude API integration as the orchestrator model
- Tool registration: wrap existing search/data/guidance functions as ADK tools
- Session and state management (ADK provides this, but needs wiring up)
- Basic memory configuration
- Context window management for long conversations (summarisation/truncation)

**2. Guidance and prompt engineering**
- Adapt guidance payload from ChatGPT tool metadata format to system prompt / ADK agent instructions
- Conversation-level orchestration prompts. On ChatGPT, the platform's own model handled the overarching conversation flow. Now we need explicit prompt engineering to guide the conversation end-to-end: when to ask what, how to read signals, when to trigger tools, when to hand off.
- Safety guardrails. Prompts to keep the agent on-topic. Prevent it being used as a free proxy to Claude for unrelated queries.

**3. Chat UI**
- Message list with streaming display
- Text input
- Typing indicators
- Image display (inline in conversation)
- Widget rendering: carousels, ship cards, detail views, handoff form. The React components exist but need a new triggering/integration layer to replace ChatGPT's structuredContent mechanism.
- Mobile responsive
- Error states (API failures, timeouts)

**4. Deployment**
- Standalone page or iframe embed on Swoop's site
- Iframe is simplest for v1 (sidesteps their build cycle entirely)
- Backend hosting (GCP via Joe's team, or lightweight host like Railway)
- Streaming infrastructure (SSE or websocket from backend to frontend)

**5. Safety and cost control**
- Rate limiting per IP or per session (every conversation costs money via Claude API)
- Basic abuse prevention
- Error handling for API failures, timeouts, garbage responses, mid-stream interruptions

**6. Compliance and ops**
- GDPR consent mechanism (may be simpler than ChatGPT since we control the full flow)
- Basic analytics/logging (tool calls, conversation starts, handoff rates)
- Imgix image serving carries over; display components need the new integration layer

### What's explicitly deferred in this simplest version:
- Cross-session memory / learning layers
- Integration with Swoop's website build cycle (iframe sidesteps this)
- CRM integration
- Full image annotation pipeline on new assets
- Prompt management tooling for sales team (manual updates for now, same as ChatGPT version)
- Advanced analytics

### Expectation calibration:
The website chat experience won't match ChatGPT or Claude's native polish. Those platforms have years of product development behind their interfaces. A v1 will be functional and the conversation quality will be high (Claude is a strong model), but the UI will be simpler. This needs setting clearly so Swoop aren't comparing it to ChatGPT's interface and feeling disappointed.

---

## Scope Estimate: Detailed Breakdown

### Item-by-item estimates (Alastair's assessments):

| # | Item | Optimistic | If risks hit | Risk |
|---|------|-----------|-------------|------|
| 1 | Project setup, dependencies, yak-shaving | 1 | 1.5 | Small |
| 2 | Repackage tools (1.5) + split UI widgets from payload (1) | 2 | 2.5 | Small |
| 3 | Prompt guidance + orchestration prompts | 1.5 | 4 | **Med-high** |
| 4 | Chat UI + state management + req-res debugging | 2.5 | 3.5 | Medium |
| 5 | Widget triggering/rendering (new integration layer) | 1.5 | 2 | Medium |
| 6 | Streaming + error handling (port from old codebase) | 2 | 2.5 | Medium |
| 7 | Session management (ADK primitives) | 0.5 | 0.5 | Small |
| 8 | Safety guardrails (prompt engineering) | 1 | 1.5 | Medium |
| 9 | Deployment + repeated deploy faff | 1 | 1.5 | Small-med |
| 10 | Crashlytics integration | 0.5 | 0.5 | Small |
| 11 | GDPR consent | 0.5 | 0.5 | Small |
| 12 | Logging (Firebase/GCP or their system) | 1 | 1 | Small |
| | **Totals** | **~14** | **~21** | |

### Deferrals to make 12 days work:
- **GDPR ephemeral-to-persistent flow** (the nice version where conversation is ephemeral until user provides personal info, then agent asks for consent before persisting). Adds ~2 days + med-high risk. Deferred to v2. Ship with simple consent banner instead.
- **Prompt iteration beyond "good enough."** Launch with 1.5 days of prompt work. Accept first conversations won't be perfectly tuned. Iterate post-launch. Consistent with "trial prototype" framing.

### Proposed pitch: 12+5

**12 days base at £950/day = £11,400 + VAT.**
**Up to 5 contingency days (£4,750 + VAT) by mutual agreement.**
**Total ceiling: £16,150 + VAT.**
**Delivery target: one calendar month.**

Comparable to the original sprint (£9,500 + £1,900). Slightly bigger, which makes sense. Not scary money.

### Risk profile at 12+5:
If all medium/medium-high risk items hit their bad case simultaneously, that's roughly 5 extra days. Which is exactly the contingency. Covers a "most things go a bit wrong" scenario. Does NOT cover a catastrophic surprise (e.g. ADK has a fundamental limitation, or Claude tool-calling behaves differently in ADK context). That risk is low but worth Alastair being aware of.

### Framing:
Pitched as the simplest trial prototype for the website. Same philosophy as the ChatGPT demo: get something working, learn from it, iterate. Not production-grade. A proof of concept that validates having a discovery conversation on the website.

Still needs input from Swoop on: where does it live on the site, what's the ambition level, and what's happening with Joe's team.

---

## The Value Proposition (for the call, not the email)

### Owning the conversation:
On the website, Swoop owns everything. Full conversation data. Full analytics. The ability to build memory and state layers that capture what users reveal and improve future conversations. Over time, an evidence-based picture of customer motivations, concerns, and decision patterns. Move from gut feel to data.

### The questions this could answer:
- Which concerns stall a booking?
- What emotional triggers move someone from browsing to serious?
- Do couples and solo travellers respond differently?
- What seasonal patterns exist in customer interests?
- What information is missing from the website that users keep asking about?

### Supporting evidence:
- **Luxury Escapes** (global travel brand): conversational AI, 3x conversion rate increase vs website, $300k in direct sales within 3 months
- **Broader stats:** 2.8x more likely to convert when engaging with well-designed chatbot; 74% of travellers prioritise personalised AI experiences over cost alone
- **Caveat:** General/mass-market travel stats. No direct evidence for specialist adventure travel at £5k-£30k. Principle still holds: higher ticket = more value in getting discovery right.

Sources:
- Luxury Escapes: https://masterofcode.com/blog/generative-ai-in-travel
- 74% personalisation: https://arobs.com/blog/luxury-travel-supercharged-scaling-personalization-with-ai/

### Honest framing:
This is the stuff to discuss on a call, not to pitch in an email. The email just needs to get the call booked. The value proposition is best delivered in conversation where Alastair can read what resonates and adapt.

---

## UPDATE: Julie Call 26 March 2026

Julie call has answered most of the open scoping questions. See `julie_call_notes_26mar2026.md` for full notes. Key changes to the picture:

### What's now confirmed:
1. **Ambition level:** Production, not prototype. "User-facing, in production, and beautiful." UX design matters.
2. **Where it lives:** Iframe, initiated by a nav button. Swoop's team integrates and styles.
3. **Budget posture:** "Do the simplest GOOD thing we can give to users." Not cheapest. We can be upfront about this in the quote.
4. **Scope boundary:** Discovery only. Get people to start a call with a specialist. No itinerary creation.
5. **Delivery model:** React + Tailwind standalone app. Swoop's in-house team takes over styling.
6. **Code quality:** Luke wants this as foundations for iterative build. Future-proofing and extensibility explicit requirements.
7. **Timeline:** ASAP, not at expense of quality.

### What's new:
- **A/B testing on button placement.** Candidates: next to Search, or first item in main nav. NOT alongside "Speak to a Specialist" / "Let's chat" (good separation between AI and human channels).
- **EU AI Act compliance.** New governance requirements before 2 August 2026. See compliance research below.

### How this changes the quote:

The March 23rd quote was framed as a "trial prototype" at 12+5 days. Julie's input reframes this as a production tool. The core technical work is the same, but:

1. **UX design: not an uplift.** "Beautiful" initially seemed to imply design work on our side. Clarified in follow-up: Alastair delivers a CSS-reset base (clean, functional React + Tailwind). Swoop's in-house team applies brand styling. So no UX design days added — the "beautiful" bar is met by delivering clean components their team can style, not by doing the design ourselves.
2. **Code quality bar rises.** Future-proofing means proper architecture, documented interfaces, clean extensibility. Already partly accounted for in the original estimate, but worth noting explicitly in the architecture section of the proposal. Not a separate line item — it's how the work is done.
3. **EU AI compliance adds ~1 day.** Simple approach: disclosure UX in the chat interface, compliance documentation. Happy to work with Swoop's legal team if they want more. See research below.
4. **A/B testing infrastructure is minimal.** Button placement A/B testing is Swoop's side. The iframe loads cleanly from wherever it's triggered. May need a small config layer for tracking which variant triggered the conversation, but that's marginal.
5. **Budget is more flexible.** "Not necessarily cheap" gives room to quote the real number rather than squeezing to minimum.
6. **Reporting and handover.** Not in the original estimate. Needed now that this is production: sprint review documentation, codebase handover, developer onboarding notes for Swoop's team. ~1.5 days.
7. **Sprint structure.** Initial sprint of ~8 days, then a review. Gives Swoop a decision point. If things look off or priorities have shifted, we adjust. If tracking well, carry on. Aligns with Swoop's 2-week sprint cadence.

### Detailed line items (internal reference — NOT sent to client):

| # | Item | Days | Notes |
|---|------|------|-------|
| 1 | Project setup and dependencies | 1 | New runtime (ADK), project scaffolding, Vercel configuration |
| 2 | Repackage tools + split UI widgets from ChatGPT integration layer | 2 | Existing logic, new wiring. Code is NOT transparently portable — needs re-wiring and modification for self-hosted agent runtime. Includes restructuring for clean extensibility. |
| 3 | Prompt guidance + conversation orchestration | 2 | Adapt guidance payload, build orchestration prompts. Single agent with tool calls (NOT multi-agent). Biggest variable — getting a conversation that feels right takes iteration. |
| 4 | Chat UI + state management | 2.5 | Chat interface, stateful messaging, streaming display, error states. Clean base styling. **Major time-soak: we got this for free with ChatGPT but it's non-trivial and must work well for production UX.** |
| 5 | Widget rendering (new integration layer) | 1.5 | Carousels, ship cards, detail views, specialist handoff form |
| 6 | Streaming + error handling | 2 | SSE from backend to frontend |
| 7 | Session/state management | 1 | ADK session primitives, conversation state. **Another major time-soak: ChatGPT handled this; now we build it.** |
| 8 | Legal compliance (EU AI Act + GDPR) | 1 | Disclosure UX, consent, compliance documentation. Simple approach that ticks boxes. Available to work with Swoop legal if more needed. |
| 9 | Deployment + configuration | 1 | Iframe embed, Vercel hosting, repeated deploy iterations |
| 10 | Logging | 0.5 | Basic event logging (conversation starts, tool calls, handoff rates) |
| 11 | Reporting + handover | 1.5 | Sprint review documentation, codebase handover, developer onboarding notes |

**Internal total: 16 days (detailed estimate).**

### Deferred from this version (internal note):
- Rate limiting and abuse prevention. Add reactively if needed.
- Cross-session memory (notwithstanding captured analytics)
- CRM integration
- Advanced analytics
- Prompt management tooling for sales team
- Image annotation pipeline and live data lookup
- Complex agent orchestration (not necessary for this conversational scope; choice of libraries allows it to be added later)

### Key framing point for the proposal:
**Section title: "Time and Cost Calibration"** (NOT "Why a website version is more work" — bad optics).

There are significantly more moving parts here than the ChatGPT integration. ChatGPT provided the conversation engine, chat UI, session management, and streaming for free. A self-hosted version means building all of those layers. The existing codebase carries across in substance and needs re-wiring and modification to work in a standalone agent runtime. The two biggest effort areas are chat UI/state management and session handling, both of which were zero-effort on ChatGPT.

**End the calibration section with a confidence statement:** "I've built apps with this feature-set before. This proposal doesn't require any novel agentic development. It's just a case of careful and correct implementation." (Keep this subtle — not "I'm amazing", more "this is familiar territory, and it's a known quantity.")

### Architecture decision (confirmed 30 March):
Single agent with tool calls and system-level guidance. NOT a multi-agent system. One main orchestrating agent that calls tools as needed.

### Client-facing numbers (revised 30 March):

- **16 days:** Best estimate. The realistic baseline.
- **12 days:** Fastest possible if everything goes super smoothly. Not the baseline — a best-case scenario Alastair can hope for via parallel agent work.
- **+4-6 contingency days:** If moving parts don't mesh smoothly (e.g. ADK limitations, streaming gotchas, prompt iteration needs). Only by mutual agreement.

**At £950/day:**
- Best estimate: 16 days = £15,200 + VAT
- Best case: 12 days = £11,400 + VAT
- Contingency: 4-6 days = £3,800-£5,700 + VAT
- Ceiling (worst case): ~£20,900 + VAT

**Contingency most likely triggered by:** prompt iteration, streaming infrastructure, session/state handling, or unexpected ADK behaviour.

### Timeline (revised 30 March):
Assume 4-day working weeks. 16 days = 4 weeks baseline. 12 days = 3 weeks best case. Sprint review at ~day 8 (end of week 2). Total delivery window: 4-5 weeks including contingency.

### Proposal format decisions (30 March):

1. **NOT an itemised breakdown.** Luke doesn't want a line-by-line cost table. Present as thematic summary table with "e.g." detail lists alongside each theme.
2. **"What's new" as a table.** Short descriptions with buzzword details in a column.
3. **Cut all fluff.** Follow writing style rules strictly. Every word does work. No filler value statements ("this is not the cheapest way to build a chatbot" — WANKY FLUFF. REMOVED.)
4. **Bullet points acceptable** where they improve readability.
5. **Legal compliance = EU AI Act + GDPR.** Position as: "I'll handle this simply so you don't have to. Available to work with your legal team if you want more." Do NOT mention ephemeral GDPR flow.
6. **No rate limiting or abuse prevention in this version.** Deferred. Mention in deferrals.
7. **Audience is Luke** (ADHD, prefers short punchy comms). Julie and Mark cc'd. No language that sounds like it's addressed to Luke personally ("Luke mentioned...", "I just need..."). Write as if addressing the Swoop team.
8. **Tone:** Professional, direct, confident. No hedging, no lectures about complexity.
9. **"Clean base styling" not "CSS-reset".** Client-facing language for the unstyled delivery model.
10. **Call out the ChatGPT vs self-hosted complexity gap.** Section titled "Time and Cost Calibration". More moving parts. Code carries across and needs re-wiring. UI and session management are the big new effort areas. End with subtle confidence statement about prior experience.
11. **Don't mention A/B test button placement in the quote.** That's a Julie/Alastair discussion, not a quoting issue.
12. **Don't mention "4-day working weeks".** Just state the timeline.
13. **Deferrals include:** image annotation pipeline, live data lookup, complex agent orchestration (not needed for this scope; library choice allows adding later).

### What Swoop's team handles (after delivery):
None of this blocks getting started. These are the productionisation and deployment steps on their side:
- **Brand styling.** In-house developers apply Swoop's visual identity to the React components. Alastair provides documentation on component structure and how to style.
- **Iframe integration.** Their team adds the iframe embed and trigger button to the site. Alastair provides embed code and placement recommendations.
- **Hosting migration (optional).** Alastair deploys to Vercel initially. Codebase is portable if they want it on their own infrastructure later.

### Proposal framing decisions:
- **Complexity framing (section: "Time and Cost Calibration"):** The website version has significantly more moving parts than the ChatGPT integration. ChatGPT provided conversation engine, chat UI, session management, streaming for free. Self-hosted means building those layers. Existing code carries across and needs re-wiring. The two biggest effort areas are chat UI/state management and session handling. End with confidence note about prior experience.
- **Architecture:** Single agent with tool calls and system-level guidance. Not multi-agent.
- Sprint structure with review at ~day 8. Four weeks baseline, three weeks best case.
- Timeline: four weeks from go-ahead. First sprint (~8 days) delivers working engine and interface for review. Second sprint completes remaining items, handover, deployment.
- **Expectations framing (for the proposal):** Conversation quality will be high — Claude is a strong model, guidance and sales methodology carry across. Chat interface will be functional, responsive, clean, but unstyled. Swoop's team handles visual identity. Recommend budgeting for a prompt iteration phase after launch — real user conversations are the fastest way to tune.
- **Running costs framing (for the proposal):** ChatGPT version has no per-conversation cost (OpenAI absorbs it). Website version uses Claude via paid API. Small cost per conversation, negligible at modest traffic. Worth monitoring before scaling. Vercel hosting is low-cost.
- **A/B testing button placement:** discussed with Julie, NOT included in the quote. Internal detail only.
- **"Clean base styling"** is the client-facing language for the unstyled delivery model. Not "CSS-reset".

### Hosting decision (confirmed 30 March):
Vercel. Joe will help with hosting coordination. Not Railway. Codebase is portable if Swoop wants to migrate to their own infrastructure later.

---

## EU AI Act: Compliance Research (26 March 2026)

### Classification
A customer-facing chatbot on Swoop's website is **limited-risk** under Article 50 of the EU AI Act. Not high-risk.

### Applicability
Yes, applies to UK companies serving EU customers. Extraterritorial scope, same principle as GDPR. Both Buddy Apps (provider) and Swoop (deployer) have obligations.

### Key requirements (Article 50, enforceable from 2 August 2026):

1. **Disclosure:** Users must be told they're interacting with AI, not a human. Unless "obvious from the circumstances" — which is a narrow exception. A chatbot embedded in a travel website should have explicit disclosure.
2. **AI-generated content labelling:** If the system generates itinerary suggestions, descriptions, etc., these should be marked as AI-generated in a machine-readable way.
3. **No pre-market assessment required.** Self-assessed compliance against Article 50.
4. **No post-market monitoring or incident reporting** at this classification level.

### Code of Practice
EU published a draft Code of Practice in December 2025; final version expected June 2026. Voluntary but provides "presumption of conformity" — not following it means proving compliance independently (higher burden). Worth tracking.

### Scope impact (practical):
- **Quoted at 1 day.** Simple approach: disclosure UX in the chat interface, compliance documentation for Swoop's records. Willing to engage with Swoop's legal team if they want to go further.
- Code of Practice review: ~0.5 day when final version drops (June 2026). May trigger minor adjustments. Not included in the quote — flag as a future checkpoint.

### Sources:
- Article 50: https://artificialintelligenceact.eu/article/50/
- UK applicability: Farrer & Co guidance on EU AI Act for UK organisations
- Travel sector: Fox Williams guidance on AI Act for travel companies

---

## Approach to the Proposal (Updated 30 March)

All major scoping questions are now resolved. Joe is out (not quoting, not a resource). Hosting is Vercel. Julie confirmed iframe, production quality, discovery-only scope, CSS-reset delivery model.

This is a standalone proposal, not a scoping request. No open questions block it.

### Draft status:
`web_discovery_quote.md` rewritten as v2 (30 March). Reflects all decisions captured in this notes doc. Previous draft email at `Email_to_Luke_Website_Discovery_Mar2026.md` is superseded.

---

## Joe Humphries Update (30 March)

Spoke to Joe. He's not keen to allocate his developers to building "websites" — Platform48 is more of a web apps agency. This means:
- **Not a competitive threat.** Joe won't be quoting against Alastair for this work.
- **Not a dev resource either.** No joint pitch, no shared dev capacity.
- The quote is entirely self-contained. No dependencies on Platform48.
- The Prompt Loom conversation with Joe remains separate and unaffected.

This simplifies the proposal. No need to hedge around "what's Joe's team doing" — Alastair is the sole bidder from this direction. The competitive quoting pressure (from the CFO) will come from other agencies, not Joe.

---

## Open Items (Updated 30 March)

- **Previous chatbot trial.** Ask Julie or Luke when opportunity arises.
- **Mark Reed.** Keep close. His architectural input is valuable.
- **Code of Practice (EU).** Track final version expected June 2026. May need a review checkpoint.
- **Training angle.** Separate email to Luke about Claude training. Draft in progress (paused while quote is prioritised).
- **Competitive quoting.** CFO wants other quotes. Joe is out. Unknown who else they're talking to. Compete on value and unique context, not price.

---

## Copy Refinements (30 March, pre-send review)

Applied the following changes to the proposal before sending:

1. **"carries across in substance"** → "code and architecture carry across. The integration layer needs rebuilding." Clearer cause and effect for a non-technical reader.
2. **"The three areas that absorb..."** long sentence → broken into shorter punches. "Three areas absorb the most time: [x], [y], [z]. All three came free with ChatGPT. All three need to work well for production."
3. **"notwithstanding captured analytics"** → "separate from captured analytics." Less lawyerly.
4. **Running costs:** added concrete estimate. "At current rates, expect ~£0.05–£0.25 per conversation depending on length." Based on Claude Sonnet API pricing ($3/$15 per million input/output tokens), 10-turn conversation estimate with prompt caching. Range covers short conversations (5 turns, caching) to long ones (15+ turns, multiple tool calls).
5. **Added CTA at the end:** "Happy to talk through any of this. I can start with one week's notice." Document needs to stand alone if forwarded to CFO without the covering email.
6. **Added "Prompt caching/optimisation" to deferrals.** This is an optimisation step that reduces API costs but isn't in scope for v1.
7. **Delivering company changed from Buddy Apps Imperative Ltd to WhaleyBear Ltd.** Email address al@whaleybear.com. Reason explained in covering email to Swoop.
