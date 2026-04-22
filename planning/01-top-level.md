# 01 — Swoop Website Discovery: Top-Level Plan

**Status**: Canonical top-level intent + roadmap for V1 Patagonia.
**Supersedes**: everything in `planning/archive/` (moved 2026-04-22). Individual archive docs remain useful as source material.
**Scope**: V1 Patagonia only — the 30 Mar quoted 16-day engagement. Antarctica and further horizons are acknowledged where V1 architecture must leave doors open, but not planned here.

---

## 1. Vision & intent

Swoop has 16 years of expert human-guided adventure travel sales, plus a website that acts as a leaky funnel. Specialist visitors bounce because the site is browsable but not conversational; casual visitors enquire who shouldn't; qualified visitors wait for a call instead of self-serving curiosity until warm.

V1 replaces that gap with a conversational discovery surface for the Swoop Patagonia website. A visitor opens the tool via a nav-button trigger and has a short, warmth-led conversation that either builds their confidence to speak with a specialist, or politely redirects them if they're not a fit. It does not build itineraries, quote prices authoritatively, or book anything. It delivers qualified leads with context into the sales team's inbox.

Patagonia is the V1 target because it is the structural superset of adventure-travel complexity at Swoop. Solving Patagonia first makes Antarctica a template application, not a new build.

The tool is positioned against a strategic bias toward group tours — Swoop's future relies on group tours growing to ~50% of bookings — and an explicit triage posture that distinguishes qualified from referred-out from disqualified enquiries. This differs from the Phase 1 Antarctica PoC, where every lead was welcome.

---

## 2. Jobs-to-be-Done

The four audiences whose jobs this tool is hired to do. Every architectural and content decision in Tiers 2/3 traces back to one or more of these.

### 2.1 End user (website visitor)
- **Get excited about Patagonia** without having to commit to a sales call. The tool's job is imagination-stoking, not transaction.
- **Understand what's possible** given their rough shape — when, how long, with whom, rough budget band — without needing expert vocabulary up front.
- **Compare options** without cognitive overload. Three curated shortlists beat seventeen browsable cards.
- **Build enough confidence** to speak with a specialist — know what they're walking into, feel prepared, feel warm.
- **Not feel sold to or patronised.** The tool behaves like a knowledgeable friend, not an FAQ bot and not a conversion funnel.
- **Be told clearly it's an AI**, and given an obvious route to a human when it's the right move.

### 2.2 Swoop sales team
- **Receive qualified leads with context** — who the visitor is, what they want, what motivated them, which regions/activities they gravitated to, what they asked about that surprised.
- **Not waste time on low-fit enquiries** — the tool politely filters backpacker-tier and <$1k-profit cases before handoff.
- **Carry warmth into the first call** — the handoff includes enough conversational substance that the specialist picks up mid-relationship, not cold.
- **Trust the AI's promises** — no commitments it can't deliver on (no authoritative pricing, no availability guarantees, no itineraries).
- **(Future, not V1)** — shape AI behaviour without developer tickets. V1 architecture must leave this door open; the CMS-as-data pattern is how.

### 2.3 Swoop as a business
- **Establish AI-discovery positioning** in adventure travel while the market is embryonic. Shipping beats theorising.
- **Drive group-tour demand** toward the 50% strategic target. The tool proactively surfaces group options; solo travellers are strong group candidates.
- **Filter low-profit enquiries efficiently** — triage is a cost saving, not just a quality improvement.
- **Accrue conversation data** to learn customer motivation patterns that analytics can't see (the "why" behind the booking).
- **Prove a reusable pattern** for Antarctica next, Arctic after. Patagonia must be a template, not a one-off.
- **Stay clean on EU AI Act Art. 50** (enforceable 2 Aug 2026) and GDPR — simple, correct, documented.

### 2.4 Build team (Al + Claude Code agents)
- **Ship the quoted 16-day scope** at Julie's production bar ("simplest good thing for real users, not a PoC") inside a 4–5 week window.
- **Maximise reuse from the Phase 1 PoC** — reuse is margin. The 7 MCP tools, 4 widget families, ts-common schemas, guidance-payload structure, mailer, image catalogue, sales-docs source material all carry forward.
- **Keep options open** where decisions are genuinely in flight (UI component library specifics, search backend pricing, message bus choice). Don't pin what doesn't need pinning; make swap-out cost visible when we do pin.
- **Parallelise honestly** — parallel where chunks genuinely separate, serial where state is shared. Don't theatre-parallel.
- **Hand over cleanly** — the codebase must be something Swoop's in-house team can pick up and extend. Thomas + Richard are the receiving engineers.

---

## 3. Themes (architectural principles)

Ten commitments that shape every subordinate decision. These are the invariants Tier 2 plans inherit.

1. **PoC-first, greenfield only where necessary.** Reuse is margin. If something in `chatgpt_poc/product/` does the job, we evolve it rather than rewrite.
2. **Content-as-data.** Prompts, fragments, sales material, library data, email templates, legal disclosures all live outside code as markdown/JSON. Authorable by non-engineers. Loaded at runtime.
3. **Three-layer prompt model.** Static WHY (system prompt: brand, voice, refusals, triage posture), dynamic HOW (stance fragments composed per-turn), dynamic WHAT (MCP tools retrieving real data). Every prompt change lives in exactly one layer.
4. **Swap-out surfaces are named.** Every framework/library/service choice is annotated with the cost of swapping it later. No silent lock-in.
5. **Disposable ETL.** The scraper is throwaway — Swoop's October 2026 Mongo migration retires it. No engineering sunk-cost; prompt-engineering-led extraction over handcrafted parsers.
6. **Single-agent V1, multi-agent deferred.** ADK's A2A path is effectively free to add later; we take zero V1 complexity for it.
7. **Production quality on minimum surface.** Julie's bar applied to what ships: streaming, error states, disclosure UX, clean React + Tailwind. Not applied to: polished design system, CRM, memory, analytics beyond baseline.
8. **Observable handoff.** Outputs are three-state (`qualified` / `referred_out` / `disqualified`) with reasons, not binary lead/no-lead. Enables sales feedback + future prompt iteration.
9. **Legal compliance built-in.** EU AI Act Art. 50 disclosure + GDPR consent are day-one chrome, not a bolted-on afterthought.
10. **Triage-aware discovery.** Patagonia is not Antarctica. Triage sits inside the conversational flow as polite redirection, never as rejection.

---

## 4. Roadmap — V1 Patagonia

Eight separable chunks. Each is a candidate Tier 2 implementation plan. Ordering below reflects dependency gravity; not every chunk waits for the previous — see §5 for parallelisation.

### A. Foundations
Repo bootstrap, monorepo tooling, shared types package (the evolution of `ts-common`), dev workflow, CI skeleton. The root of the dependency graph — every other chunk consumes it.

### B. Agent runtime
The agent loop itself. WHY system prompt loaded from content. HOW-fragment composition mechanism. Session state. Model config. Streaming out. The thing that was "free from ChatGPT" in Phase 1 and now we own.

### C. Retrieval & data
Scraper utility (disposable), landing zone, search backend, MCP-style data connector service exposing the evolved toolset. Covers the move from PoC's bundled JSON + local embeddings to real retrieval at Patagonia scale.

### D. Chat surface
React chat UI. Tool-call widget rendering. Streaming consumption. Session resumption. Disclosure UX baseline. Widget reuse from PoC is the core efficiency here.

### E. Handoff & compliance
Triage-aware handoff schema. Handoff persistence. Sales-inbox email delivery. Consent capture. Retention. Disclosure copy. The compliance surface and the lead delivery surface are tightly coupled, so they live in one chunk.

### F. Observability baseline
Structured logging, minimal metrics (conversation starts, tool calls, handoff rates, triage outcomes, error rates). V1 minimum; not full observability tooling.

### G. Content
WHY system prompt (Patagonia-voiced). HOW fragments for discovery / convergence / triage / qualification / sensitive stances. Handoff email template. Placeholder CMS content until real data flows. Depends on Luke + Lane's Patagonia sales-thinking doc (1–2 week window from 20 Apr).

### H. Validation
Lightweight behavioural eval harness. Small evalset of scenario-based tests that catches regressions on tool call correctness, triage decisions, and handoff timing. Intentionally minimal; no vendor tooling in V1.

### Milestones
- **M1 — Hello-world end-to-end.** Every chunk alive with stubs wired. Conversation happens in a browser against mock data. De-risks the integration surface.
- **M2 — Real data flowing.** Scraper + Vertex Search + real tool responses. Depends on Friday data-ontology session and GCP access.
- **M3 — Triage + handoff working.** Full conversation arc including triage decision, consent, and real email delivery. Depends on Luke + Lane's sales-thinking doc landing.
- **M4 — Deployed to Swoop GCP ("AI Pat Chat").** Cloud Run services live; Firestore session state; Vertex indexes; Cloud Logging. Depends on Thomas's GCP provisioning.
- **M5 — Legal sign-off + ready for embed.** Swoop's legal counsel reviews; in-house team embeds. Ships.

---

## 5. Parallelisation candidates

User decision already pinned: hybrid model — parallel where cleanly separable, serial elsewhere. Three candidate strategies for how to realise that; we recommend one and keep the others as fallback if it stumbles.

### Strategy 1 (recommended) — Interface-first stubs, then fan-out
1. Al defines the contracts first (shared types, tool I/O schemas, SSE event shape, handoff payload shape) in a serial pre-work pass.
2. Once contracts exist, chunks B, C, D, E can all run in parallel agents — each mocks the others at the boundary. M1 is the re-synchronisation checkpoint.
3. Content chunk G runs parallel from day 1 (taste-driven; doesn't block code).
4. Observability F and validation H run parallel after M1 (need real endpoints to observe/test).

**Pros**: maximum agent throughput; integration bugs surface at M1 while cheap; clean boundary respect via contracts.
**Cons**: front-loads serial contract work onto Al; contracts must be good enough first-time.

### Strategy 2 — Vertical slice first
1. One agent builds a narrow end-to-end path (one tool, one widget, simplest handoff) before anything parallelises.
2. Other chunks fan out after the vertical slice lands.

**Pros**: earliest proof the architecture works at all; lowest integration risk.
**Cons**: slower calendar-time to first multi-agent parallelism; content-stream G can't benefit.

### Strategy 3 — Content-parallel + build-serial
1. Content G runs in its own stream from day 1.
2. All build chunks stay serial on one agent.

**Pros**: lowest ceremony; zero coordination overhead.
**Cons**: abandons most of the parallelism gain; only makes sense if Strategy 1 repeatedly produces integration pain.

**Recommendation for Tier 2**: default to Strategy 1. Make Strategy 2 the fallback if M1 reveals contract instability. Strategy 3 is the "something is badly wrong" escape hatch.

---

## 6. In scope for V1

- Conversational discovery for Patagonia (Antarctica not included in V1)
- Triage: qualified / referred_out / disqualified
- Specialist handoff via email + durable record
- Three-layer prompt system
- Widget-rendered content (visual cards, lists, detail, lead capture)
- Disclosure + consent UX (EU AI Act Art. 50 + GDPR, simple compliant baseline)
- Structured logging
- Minimal behavioural eval harness
- Iframe embed via Swoop nav button (integration owned by Swoop's in-house team)
- Handover documentation for Swoop's engineers

## 7. Out of scope for V1

- Itinerary building, booking, authoritative pricing
- Antarctica dataset (structurally ready for, not populated)
- Cross-session memory / learning
- CRM integration
- Rate limiting / abuse prevention (add reactively)
- Sales-team-owned prompt CMS tooling (manual edits by Al during V1)
- Advanced analytics / cost-per-conversation dashboards
- Prompt caching / cost optimisation
- Voice / audio / image-generation
- Multi-language (English only)
- A/B testing infrastructure (button placement is Swoop's side)
- Multi-agent composition (A2A, triage-as-separate-agent)
- Persistent user accounts / auth

## 8. Key dependencies on Swoop

Named in the 20/21 Apr meetings. V1 cannot complete without them:

- **GCP "AI Pat Chat"** provisioned, Al granted IAM (Thomas)
- **Mongo read access** to product catalogue (Richard)
- **Patagonia sales-thinking doc** (Luke + Lane, 1–2 week window from 20 Apr)
- **Friday data-ontology session** with Thomas or Martin (Julie to confirm)
- **Claude account clarification** — whether Swoop's extended account is Enterprise-tier (Julie/Tom)
- **Sales inbox address + SMTP** for handoff email (Julie)
- **Legal counsel sign-off** before M5 (Swoop-owned)
- **Iframe embed + brand styling** after M5 (Swoop's in-house team)

## 9. Open top-level decisions

Deliberately unresolved here — pinned in Tier 2 where they bite.

| # | Decision | Decided in |
|---|---|---|
| 1 | Search backend: Vertex AI Search vs Weaviate Cloud Serverless | Tier 2 chunk C |
| 2 | UI component library: assistant-ui vs Vercel AI Elements vs mixed | Tier 2 chunk D |
| 3 | Message bus: Pub/Sub vs Firebase Realtime DB | Tier 2 chunk B |
| 4 | Session backend in prod: Firestore vs alternative | Tier 2 chunk B |
| 5 | Handoff store backend: Firestore default | Tier 2 chunk E |
| 6 | Branching strategy for swarm: trunk-based vs worktree-per-stream | Tier 2 chunk A |
| 7 | Monorepo tooling: npm workspaces default | Tier 2 chunk A |
| 8 | Validation harness depth: stay minimal or add vendor | Tier 2 chunk H |

## 10. Provenance

This doc replaces the previous `planning/` content (now in `planning/archive/`). It draws on:
- Phase 1 ChatGPT Apps SDK prototype at `chatgpt_poc/product/` — the substrate
- 30 Mar client proposal (`archive/project_proposal.md`) — the commercial fence
- 20 Apr kickoff notes (`archive/meetings/`) — Patagonia-first flip, segmentation, group-tour bias, triage
- 21 Apr technical meeting notes (`archive/meetings/`) — TS throughout, ADK, two Cloud Run services, React, Vertex Search lean, data strategy
- Quoting notes (`archive/project_proposal_notes.md`) — Julie's production bar, scope deferrals, time calibration
- Research docs (`archive/research/`) — UI deep research, eval-harness research, discovery agent architecture brief

Where the archived docs go deeper than this top-level plan allows, Tier 2 implementation plans cite them directly.
