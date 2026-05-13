# Swoop Website Discovery Tool: Proposal

**Date:** 30 March 2026
**To:** Luke Errington, Julie Isaacs, Mark Reed
**From:** Alastair Brayne, WhaleyBear Ltd

---

## What this is

A conversational discovery tool for the Swoop Antarctica website. Visitors get a guided conversation that helps them explore options and build enough confidence to speak with a specialist. Discovery and sales handoff only. No itinerary building or booking.

Delivered as a React + Tailwind app in an iframe, with clean base styling for your in-house team to brand.

---

## Time and cost calibration

The ChatGPT integration gets a lot for free: conversation engine, chat UI, session management, streaming. A self-hosted version means building all of those layers. The existing code and architecture carry across. The integration layer needs rebuilding for a standalone agent runtime.

Three areas absorb the most time: chat interface (stateful messaging, streaming, error handling), session/state management, and conversational guidance prompts. All three came free with ChatGPT. All three need to work well for production.

I've built apps with this feature-set before. This proposal doesn't require any novel agentic development. 

---

## What carries across from the ChatGPT build

The original sprint was designed for reuse:

- Search functions and data access logic
- Guidance payload content (restructured, not rewritten)
- Product data (ships, cruises, activities)
- Image catalogue and imgix CDN
- React UI widgets (carousels, ship cards, detail views, specialist handoff form)

---

## What's new

| Area | Details |
|------|---------|
| **Agent runtime** | Google ADK, Claude as orchestrator, tool registration, session management |
| **Conversation orchestration** | Prompt engineering for end-to-end discovery flow, signal reading, tool triggering, specialist handoff timing |
| **Chat interface** | Stateful messaging, streaming display, typing indicators, image rendering, widget integration, mobile responsive, error states |
| **Deployment** | Iframe embed via nav button, Vercel hosting |
| **Legal compliance** | EU AI Act (Article 50, enforceable 2 Aug 2026) and GDPR. Simple disclosure and consent built into the UI. Compliance documentation provided. Available to work with your legal team if you want to go further. |
| **Logging** | Conversation starts, tool calls, handoff rates |

---

## What's deferred

- Cross-session memory and learning layers (separate from captured analytics)
- CRM integration
- Rate limiting and abuse prevention (add reactively if needed)
- Image annotation pipeline and live data lookup
- Prompt management tooling for the sales team (manual updates for now)
- Complex agent orchestration (not necessary for this conversational scope; choice of libraries allows this to be added as needed)
- Advanced analytics
- Prompt caching/optimisation

---

## Architecture

Built as a foundation for iterative development: clean separation of concerns, well-structured TypeScript, documented interfaces. Single agent with tool calls and system-level guidance. The target is a codebase your developers can pick up, extend, and maintain independently.

---

## Scope and cost

| | Days | Cost (+ VAT) |
|---|------|-------------|
| **Best estimate** | 16 | £15,200 |
| **Best case** (everything goes smoothly) | 12 | £11,400 |
| **Contingency** (moving parts don't mesh; mutual agreement only) | +4-6 | +£3,800-£5,700 |

Day rate: £950. Same structure as the original engagement. Contingency only by mutual agreement.

---

## How I'd structure the work

| Theme | Includes e.g. | Est. days |
|-------|--------------|-----------|
| **Runtime + data layer** | ADK setup, tool repackaging, session/state management | 3-4 |
| **Conversation engine** | Prompt orchestration, guidance adaptation, signal reading, specialist handoff | 2-3 |
| **Chat UI + streaming** | Chat interface, stateful messaging, streaming (SSE), error handling, widget rendering | 4-5 |
| **Compliance + ops** | EU AI Act disclosure, GDPR consent, logging, Vercel deployment | 2 |
| **Reporting + handover** | Sprint review, codebase handover, developer onboarding docs | 1-1.5 |

Initial 2-week sprint, then a review. That gives a working conversational engine and enough of the interface to assess progress before committing the rest.

---

## Running costs

The ChatGPT version has no per-conversation cost (OpenAI absorbs it). The website version uses Claude via paid API. At current rates, expect ~£0.05–£0.25 per conversation depending on length. Negligible at modest traffic. Worth monitoring before scaling. Vercel hosting is low-cost.

---

## What your team handles after delivery

None of this blocks getting started:

- **Brand styling.** Apply your visual identity to the React components. Documentation provided.
- **Iframe integration.** Add the embed and trigger button to the site. Embed code and placement recommendations provided.
- **Hosting migration (optional).** Deployed to Vercel initially. Codebase is portable.

---

## Expectations

The guidance and sales methodology from the demo carry across, and Claude is a strong model. The chat interface will be functional, responsive, and clean, minimally styled so your team can augment with Swoop's visual identity.

The launch version establishes the baseline conversation flow and starts accruing analytics data. Real user conversations are the fastest way to find what needs adjusting. Budget for a prompt iteration phase after launch.

---

## Timeline

Four to five weeks from go-ahead. First 2-week sprint delivers a working engine and interface for review. Second sprint targets deployment and handover.

---

Happy to talk through any of this. I can start with one week's notice.
