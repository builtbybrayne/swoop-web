# 01 — Swoop Website Discovery: Top-Level Plan

**Status**: Canonical top-level intent + roadmap for the **Puma** release.
**Supersedes**: everything in `planning/archive/` (moved 2026-04-22). Archived docs remain useful as source material.
**Scope**: Puma = the first shipped release, Patagonia-only, corresponding to the 30 Mar quoted 16-day engagement. Release naming convention: Patagonian / Antarctic animals. See `../CLAUDE.md` for rationale.

---

## 1. Vision & intent

Swoop has 16 years of expert human-guided adventure travel sales, plus a website that acts as a leaky funnel. Specialist visitors bounce because the site is browsable but not conversational; casual visitors enquire who shouldn't; qualified visitors wait for a call instead of self-serving curiosity until warm.

Puma replaces that gap with a conversational discovery surface for the Swoop Patagonia website. A visitor opens the tool via a nav-button trigger and has a short, warmth-led conversation that either builds their confidence to speak with a specialist, or politely redirects them if they're not a fit. It does not build itineraries, quote prices authoritatively, or book anything. It delivers qualified leads with context into the sales team's inbox.

Patagonia is the Puma target because it is the structural superset of adventure-travel complexity at Swoop. Solving Patagonia first makes Antarctica a template application, not a new build — the natural territory for the next release.

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
- **(Post-Puma, not in this release)** — shape AI behaviour without developer tickets. Architecture must leave this door open; the CMS-as-data pattern is how.

### 2.3 Swoop as a business
- **Establish AI-discovery positioning** in adventure travel while the market is embryonic. Shipping beats theorising.
- **Drive group-tour demand** toward the 50% strategic target. The tool proactively surfaces group options; solo travellers are strong group candidates.
- **Filter low-profit enquiries efficiently** — triage is a cost saving, not just a quality improvement.
- **Accrue conversation data** to learn customer motivation patterns that analytics can't see (the "why" behind the booking).
- **Prove a reusable pattern** for the next release (likely Antarctica) and beyond. Puma must be a template, not a one-off.
- **Stay clean on EU AI Act Art. 50** (enforceable 2 Aug 2026) and GDPR — simple, correct, documented.

### 2.4 Build team (Al + Claude Code agents)
- **Ship the quoted 16-day scope** at Julie's production bar ("simplest good thing for real users, not a PoC") inside a 4–5 week window.
- **Maximise reuse from the Phase 1 PoC** — reuse is margin. The 7 MCP tools, 4 widget families, `ts-common` schemas, guidance-payload structure, mailer, image catalogue, sales-docs source material all carry forward.
- **Keep options open** where decisions are genuinely in flight (UI chat library specifics, content-retrieval shape, message-passing topology). Don't pin what doesn't need pinning; make swap-out cost visible when we do pin.
- **Parallelise honestly** — parallel where chunks genuinely separate, serial where state is shared. Don't theatre-parallel.
- **Hand over cleanly** — the codebase must be something Swoop's in-house team can pick up and extend. Thomas + Richard are the receiving engineers.

---

## 3. Themes (architectural principles)

Ten commitments that shape every subordinate decision. These are the invariants Tier 2 plans inherit.

1. **PoC-first, greenfield only where necessary.** Reuse is margin. If something in `chatgpt_poc/product/` does the job, we evolve it rather than rewrite.
2. **Content-as-data.** Prompts, fragments, sales material, library data, email templates, legal disclosures all live outside code as markdown/JSON. Authorable by non-engineers. Loaded at runtime.
3. **Prompt architecture is an empirical question.** Start simple: a well-authored system prompt plus tool descriptions. Introduce dynamic per-turn prompt fragments, stance classifiers, or conversation-state composition **only if real conversations show they're needed**. The loose "WHY / HOW / WHAT" framing (static voice / dynamic state-driven / dynamic retrieval) is a useful mental shorthand, not architectural dogma — it hasn't been validated and shouldn't drive build-time commitments in Puma.
4. **Swap-out surfaces are named.** Every framework/library/service choice is annotated with the cost of swapping it later. No silent lock-in.
5. **Disposable ETL.** Whatever we use to land data for Puma (scraper, API adapter) is throwaway — Swoop's late-2026 data consolidation retires it. No engineering sunk-cost.
6. **Single-agent Puma, multi-agent deferred.** ADK's A2A path is effectively free to add later; we take zero Puma complexity for it.
7. **Production quality on minimum surface.** Julie's bar applied to what ships: streaming, error states, disclosure UX, clean React + Tailwind. Not applied to: polished design system, CRM, memory, analytics dashboards.
8. **Observable handoff.** Outputs are three-state (`qualified` / `referred_out` / `disqualified`) with reasons, not binary lead/no-lead. Enables sales feedback + future prompt iteration.
9. **Legal compliance built-in.** EU AI Act Art. 50 disclosure + GDPR consent are day-one chrome, not a bolted-on afterthought.
10. **Triage-aware discovery.** Patagonia is not Antarctica. Triage sits inside the conversational flow as polite redirection, never as rejection.

---

## 4. Roadmap — Puma

Eight separable chunks. Each is a candidate Tier 2 implementation plan. Ordering below reflects dependency gravity; not every chunk waits for the previous — see §5 for parallelisation.

### A. Foundations
Repo bootstrap, monorepo tooling, shared types package (evolution of `ts-common`), dev workflow, CI skeleton. Root of the dependency graph — every other chunk consumes it.

### B. Agent runtime
The agent loop itself. **Google ADK (TypeScript)** — pinned. System prompt loaded from content. Session state. Tool invocation via the connector (chunk C). Streaming events out to the chat surface (chunk D). The thing that was "free from ChatGPT" in Phase 1 and now we own.

### C. Retrieval & data
**Data access strategy pending Friday 24 Apr hackathon**: API-direct vs scrape-the-site. Outcome reshapes this chunk. Constants regardless of outcome:
- Search / retrieval backend: **Vertex AI Search** (settled). Weaviate is out.
- MCP-style data connector service exposing the evolved tool set from the PoC.
- Image resolution via Swoop's existing media library (location TBC, part of the hackathon scope).

Scrape path's side-benefit: real page URLs per product/region/story — enables "go see this page" deep links in the chat. If API-direct wins the hackathon, check whether we can reconstruct URLs from type+id. See inbox entry 2026-04-22.

Mongo is **not** in scope — confirmed no longer used.

### D. Chat surface
React chat UI. **assistant-ui** — pinned. Tool-call widget rendering. Streaming consumption. Disclosure UX baseline. Widget reuse from the PoC (`ui-react/` four families) is the core efficiency here.

Open: whether chat state persists across visitor page navigations (enabled by deep-linking from chunk C's scrape path). Decide in Tier 2 chunk D.

### E. Handoff & compliance
Triage-aware handoff schema. Handoff persistence. Sales-inbox email delivery. Consent capture. Retention. Disclosure copy. The compliance surface and the lead delivery surface are tightly coupled, so they live in one chunk.

### F. Observability & analytics
Structured event logging for every load-bearing interaction: conversation start, tool call (name + latency + outcome), triage decision, handoff submission (with verdict), error, session duration. Logs land in GCP Cloud Logging; event schema authored so that ad-hoc analysis (BigQuery export or similar) becomes possible without rework.

**What's explicitly in Puma**: the event stream and the schema.
**What's explicitly deferred**: dashboards, cohort analysis, funnel attribution, per-conversation cost tracking, any vendor tooling (Langfuse / Braintrust / Posthog / etc.).

Trace tooling (Cloud Trace or similar) is in the "nice to have" category — add only if debugging demands it.

### G. Content
System prompt (Patagonia-voiced). Handoff email template. Placeholder CMS content until real data flows from chunk C. Depends on Luke + Lane's Patagonia sales-thinking doc (1–2 week window from 20 Apr).

Whether Puma needs dynamic per-turn prompt fragments (the "HOW" layer from the loose WHY/HOW/WHAT framing) is a Tier 2 open question; default is **no fragments** until real-conversation signal says otherwise.

### H. Validation
Lightweight behavioural eval harness. Small evalset of scenario-based tests that catches regressions on tool-call correctness, triage decisions, handoff timing, and disclosure compliance. Intentionally minimal; no vendor tooling in Puma.

### Milestones
- **M1 — Vertical slice end-to-end.** A single narrow happy-path conversation runs in a browser: one search tool, one rendered widget, one handoff. Stubbed data allowed. Proves the architecture integrates. (See §5 — this is the first real integration checkpoint; it doubles as Strategy A's entry gate.)
- **M2 — Real data flowing.** Data-access strategy from Friday hackathon implemented; retrieval returns real Patagonia content. Depends on GCP access.
- **M3 — Triage + handoff working.** Full conversation arc: discovery → triage decision → consent → handoff with email delivery. Depends on Luke + Lane's sales-thinking doc landing.
- **M4 — Deployed to Swoop GCP ("AI Pat Chat").** Cloud Run services live; session state persisted; Vertex indexes; logging. Depends on Thomas's GCP provisioning.
- **M5 — Legal sign-off + ready for embed.** Swoop's legal counsel reviews; in-house team embeds. Ships.

---

## 5. Parallelisation

User preference: vertical-slice first, then selectively parallel where clean separation exists. Content (chunk G) runs parallel from day 1.

### Recommended shape

**Phase 0 — Serial pre-work (1 agent, Al-driven).**
Define the load-bearing contracts that span multiple chunks: shared types, tool I/O schemas, the streaming event shape that must satisfy both the ADK event stream and assistant-ui's consumption. Contracts live in `ts-common`. Nothing else builds until these exist in stub form.

**Phase 1 — Vertical slice to M1 (1 agent).**
A single agent builds the narrow happy path end-to-end: system prompt + 1 tool + 1 widget + handoff form + stubbed data. All chunks touched, none deep. Proves the contracts work in reality. Content chunk G drafts in parallel (separate stream; no blocking dependency).

**Phase 2 — Fan-out after M1 (2–4 agents).**
Chunks B, C, D, E fan out into parallel agents, each deepening the narrow slice. Agents mock each other at boundaries via the Phase 0 contracts. F (observability) and H (validation) come online once B/D are non-stub.

**Serial re-synchronisation**: any change to `ts-common` contracts bottlenecks back through Al. Interface drift is the main failure mode this pattern is trying to prevent.

### Agent-to-agent coordination

Two mechanisms, both available:

1. **Shared artefacts first** — contracts in `ts-common`, decision notes in `planning/`, `STREAM.md` in each parallel stream's working directory. File-based coordination is robust and auditable. Every agent reads the same truth.
2. **Direct agent messaging** — Claude Code's `SendMessage` between named agents (addressable by the `name` passed at `Agent` launch time). Use for active negotiation when a contract change is being discussed: e.g. UI agent realises the SSE event shape needs a new field; pings the server agent; they agree; either the coordinator or one of them lands the contract change in `ts-common`.

Default to file-based coordination. Use direct messaging for genuinely interactive contract negotiation, not routine progress sharing.

### Candidate strategies (for reference; recommendation is above)

- **Interface-first fan-out (original §5 strategy 1)** — define all contracts up front, fan out all chunks immediately. Rejected as default: front-loads more contract design than Phase 0 needs, and delays proof-of-life to post-fan-out.
- **Content-parallel + build-serial (original §5 strategy 3)** — stay single-threaded on build except for content. Kept as the escape hatch if vertical slice reveals that the architecture isn't ready to parallelise.

---

## 6. In scope for Puma

- Conversational discovery for Patagonia
- Triage: qualified / referred_out / disqualified
- Specialist handoff via email + durable record
- System prompt–driven agent behaviour (dynamic fragments only if real conversations demand them — see theme 3)
- Widget-rendered content (visual cards, lists, detail, lead capture)
- Disclosure + consent UX (EU AI Act Art. 50 + GDPR, simple compliant baseline)
- Structured event logging sufficient for future ad-hoc analysis
- Minimal behavioural eval harness
- Iframe embed via Swoop nav button (integration owned by Swoop's in-house team)
- Handover documentation for Swoop's engineers

## 7. Out of scope for Puma

- Itinerary building, booking, authoritative pricing
- Antarctica dataset (architecture accommodates it; we don't populate it)
- Cross-session memory / learning
- Cross-page-navigation chat persistence (default no; revisit in Tier 2 chunk D if deep-linking is decided)
- CRM integration
- Rate limiting / abuse prevention (add reactively)
- Sales-team-owned prompt CMS tooling (manual edits by Al during Puma)
- Analytics dashboards, cohort analysis, funnel attribution, per-conversation cost tracking
- Vendor observability tooling (Langfuse / Braintrust / Posthog / etc.)
- Prompt caching / cost optimisation
- Voice / audio / image-generation
- Multi-language (English only)
- A/B testing infrastructure (button placement is Swoop's side)
- Multi-agent composition (A2A, triage-as-separate-agent)
- Persistent user accounts / auth

## 8. Key dependencies on Swoop

Named in the 20/21 Apr meetings. Puma cannot complete without them:

- **GCP "AI Pat Chat"** provisioned, Al granted IAM (Thomas)
- **Data access strategy resolved at the Friday 24 Apr hackathon** — API-direct vs scrape, and media-library access for images
- **Patagonia sales-thinking doc** (Luke + Lane, 1–2 week window from 20 Apr)
- **Claude account clarification** — whether Swoop's extended account is Enterprise-tier (Julie/Tom)
- **Sales inbox address + SMTP** for handoff email (Julie)
- **Legal counsel sign-off** before M5 (Swoop-owned)
- **Iframe embed + brand styling** after M5 (Swoop's in-house team)

## 9. Open decisions

Deliberately unresolved at the top level — pinned in Tier 2 where they bite.

| # | Decision | Default / leaning | Decided in |
|---|---|---|---|
| 1 | Data access: API-direct vs scrape | Resolved by Friday 24 Apr hackathon | Tier 2 chunk C |
| 2 | Image retrieval path | Via Swoop media library (location TBC at hackathon) | Tier 2 chunk C |
| 3 | Cross-page chat persistence | Default: no. Revisit if deep-linking wins | Tier 2 chunk D |
| 4 | Message-passing topology | Default: SSE direct from ADK event stream to assistant-ui. **No internal bus unless a concrete need emerges** (e.g. durable events across HTTP connections). Must work cleanly for both ADK's server-side and assistant-ui's consumption | Tier 2 chunk B + D jointly |
| 5 | Session backend in prod | Default: Firestore (ADK-supported) | Tier 2 chunk B |
| 6 | Handoff store backend | Default: Firestore | Tier 2 chunk E |
| 7 | Branching strategy for swarm | Default: trunk-based with per-stream `STREAM.md`; worktrees only when parallel agents genuinely conflict | Tier 2 chunk A |
| 8 | Monorepo tooling | Default: npm workspaces | Tier 2 chunk A |
| 9 | Dynamic prompt fragments (the "HOW" layer) | Default: none. Introduce only if real conversations show need | Tier 2 chunk G |
| 10 | Validation harness depth | Stay minimal; no vendor in Puma | Tier 2 chunk H |

### Settled at top level (do not revisit without evidence)

- **Agent framework**: Google ADK (TypeScript). Settled 21 Apr.
- **Search / retrieval backend**: Vertex AI Search. Weaviate is out.
- **Chat UI library**: assistant-ui.
- **Language throughout**: TypeScript. No Python in the runtime (validation harness may be Python — Tier 2 H decision).
- **Primary model**: Claude (Sonnet tier). ADK abstracts the provider so swap is config.
- **Runtime hosting**: Google Cloud Run (two services assumed — orchestrator + connector — subject to Tier 2 chunk B).
- **Deployment surface**: iframe via Swoop nav button. Swoop's in-house team owns integration + brand styling.

## 10. Provenance

This doc replaces the previous `planning/` content (now in `planning/archive/`). It draws on:
- Phase 1 ChatGPT Apps SDK prototype at `chatgpt_poc/product/` — the substrate
- 30 Mar client proposal (`archive/project_proposal.md`) — the commercial fence
- 20 Apr kickoff notes (`archive/meetings/`) — Patagonia-first flip, segmentation, group-tour bias, triage
- 21 Apr technical meeting notes (`archive/meetings/`) — TypeScript throughout, ADK, two Cloud Run services, React, Vertex Search lean
- Quoting notes (`archive/project_proposal_notes.md`) — Julie's production bar, scope deferrals, time calibration
- Research docs (`archive/research/`) — UI deep research, eval-harness research, discovery agent architecture brief

Where archived docs go deeper than this top-level plan allows, Tier 2 implementation plans cite them directly. Where archived docs got the calibration wrong (e.g. over-specified three-layer prompt architecture, Mongo as a data source, Weaviate as a fallback, detailed repo layout before the vertical slice has even proven integration), the new tiered plans are canonical.
