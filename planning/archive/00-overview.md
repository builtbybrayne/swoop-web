# 00 — Swoop Website Discovery: Planning Overview

**Status**: Living doc. Canonical snapshot of state of play.
**Last updated**: 2026-04-21 (rewritten as prototype-plus-changes, anchored to the ChatGPT Apps SDK PoC and the 20/21 Apr meetings)

---

## What this doc is

The map for *where we are* on the Swoop Website Discovery build. This is Phase 2 of the engagement — a redeploy/adaptation of the ChatGPT Apps SDK prototype that Phase 1 produced, not a from-scratch architecture.

When a decision lands it goes here first; the sub-docs (`01-architecture.md`, `02-data-access.md`, etc.) go deeper. When a decision gets overturned, this doc reflects that within the same session.

The shape of this doc deliberately mirrors the **PoC + augmentations** framing from the 30 Mar proposal: what we already have, what we're changing, what's new.

---

## Project frame

- **Phase 1 (done)**: ChatGPT Apps SDK prototype. Antarctica. Lives in `/sessions/lucid-awesome-clarke/mnt/swoop_web/chatgpt_poc/product/` and is now the substrate for Phase 2.
- **Phase 2 (now)**: self-hosted conversational discovery tool for the Swoop website. Read-only, inspiration-led, sales-funnel-shaped. **Not** an itinerary builder.
- **Destination: Patagonia first.** This flipped between the 30 Mar proposal (which was Antarctica-facing) and the 20 Apr kickoff. Rationale (Luke + Alastair, 21 Apr): Patagonia is the superset of data/behaviour complexity, so Antarctica becomes a trivial follow-on.
- **Triage is Patagonia-specific.** Antarctica PoC framing: "everyone is qualified — all leads welcome." Patagonia: the AI must identify qualified vs referred-out vs disqualified. <$1k-profit bookings should be referred out (Luke, 20 Apr).
- **Strategic bias toward group tours.** Swoop's stated future relies on group tours reaching ~50% of bookings. Driving group-tour demand is (Luke's words) "a huge favour to the project." Solo travellers are explicitly group-tour leads.
- **Embedding**: iframe on the Swoop site, triggered from a nav button. Swoop's team owns integration + styling.

---

## People

| Name | Role | Notes |
|---|---|---|
| Luke Errington | CEO, Swoop | Primary decision-maker. ADHD — prefers punchy comms. |
| Julie Isaacs | Product Lead, Swoop | Day-to-day counterpart. |
| Thomas Forster | Senior developer, Swoop | New to engagement on 21 Apr. Setting up GCP ("AI Pat Chat") and IAM. Asked for React UI. |
| Richard Connett | Tech lead, Swoop (3 years) | New to engagement on 21 Apr. DB/infra access (Mongo + MySQL). |
| Martin | Developer, Swoop | Patagonia domain knowledge. Candidate for Friday data-ontology session. |
| Lane | Sales-adjacent, Swoop | Co-authoring Patagonia sales-thinking doc with Luke (1–2 week window). |
| Alastair (us) | Architect / consultant | WhaleyBear Ltd (previously Buddy Apps Imperative Ltd). |

Not mentioned in the 20/21 Apr meetings: Mark Reed (was Phase 1 technical sponsor). Status on this project: not actively engaged — TBC whether he's still in the loop at all.

---

## Customer segmentation (from 20 Apr kickoff — new for V1)

Luke's verbal segmentation, based on 16 years of experience rather than analytics. Four dimensions:

- **Independence**: Group tourers / Tailor-made / Independents
- **Region**: Torres del Paine only / TdP + one mainstream trip / off-the-beaten-track. >80% of bookings touch TdP.
- **Activities**: Softer adventure (sightseeing, short hikes) / Hikers (multi-day, shared dorms) / Trekkers (extended, self-carry)
- **Budget**: tiered. Correlates with independence. Low end = group tours / self-booked; high end = luxury lodges at thousands/day

Explicit exclusions: backpackers (use the site but don't book high-value services). <$1k-profit bookings → referred out.

Motivations (the "why" the AI needs to anchor to): W trail, glaciers, puma photography, bragging-rights/status lodges, bucket lists, post-retirement trips-of-a-lifetime.

---

## What Phase 1 gives us (the PoC carry-forward)

Everything under `chatgpt_poc/product/` is real, working code. Pointers:

**MCP server (`mcp-ts/`)** — 7 tools already built:
- `get-conversation-guidance` — bootstraps with the big guidance payload
- `get-library-data` — component library lookup
- `show-component-list` — list widget with search-by-query
- `show-component-detail` — detail widget
- `illustrate` — image search/carousel
- `handoff` / `handoff-submit` — lead capture → email to sales

**Shared types (`ts-common/`)** — Zod schemas for: domain (`ComponentType`, ship/accommodation facilities), tool I/O (`tools.ts`), MCP wire shapes (`mcp.ts`), widget schemas (`widgets.ts`), enrichment state (`enrichment.ts`).

**UI widgets (`ui-react/`)** — 4 widget families: `component-detail`, `component-list`, `inspiration`, `lead-capture`. React + Tailwind, shadcn-friendly. Packaged per ChatGPT's `structuredContent` model — the rendering code is reusable, the integration layer is the bit that needs replacing.

**Lib scaffolding (`mcp-ts/src/lib/`)** — `component-search.ts`, `image-search.ts`, `embeddings.ts`, `data-loader.ts`, `mailer.ts` (nodemailer, Gmail SMTP, sends leads to sales inbox).

**CMS content (`cms/`)** — `guidance-payload.json` (aboutSwoop / salesMethodology / toneOfVoice / brandPillars / howToUseThisGuidance / dimensionsFramework — the BROWSE/EXCITE/CONVINCE/CONVERT 2x2 with archetypes), `image-catalogue.json`, `image-annotations.json`, `library-data.json`, `PROMPT_ENGINEERING.md`.

**Ingestion scripts (`scripts/`)** — `build-library.ts`, `build-image-catalogue.ts`, `annotate-images.ts`.

**Test suite** — `test-prompts/test-suite.json`, scenario-based manual test harness.

**Asset delivery** — imgix CDN already in use.

**Knowledge corpus** — `wiki docs/extracted/` (Swoop data framework: customer, destination, partner, product big/small bricks, swooper) and `sales docs/extracted/` (sales process, tone of voice, brand platform, elevator pitch, why-Swoop emails).

**Real sample data** — `raw_data/swoop.components.json`, `swoop.templates.json`, `images_urls.json`.

---

## What changes for V1 (Patagonia)

### Destination and data scope
- Antarctica dataset → Patagonia dataset. Structurally similar ("common patterns" per Luke) but: new group-tours product launching, likely new record types, bigger volume.
- Volume too big for markdown files — **markdown-backed data loader → search-backed retrieval**. See data strategy below.

### Conversation shape
- **Add triage** to the conversation model. Outputs: `qualified` (handoff), `referred_out` (low-value/wrong-fit), `disqualified` (backpacker, out-of-scope). Open question for `03-handoff-schema.md`: does the Phase 1 BROWSE/EXCITE/CONVINCE/CONVERT state model carry through unchanged, or does triage-first need a different shape?
- **Guidance payload**: rewrite Antarctica-specific content (salesMethodology, brandPillars where Antarctica-voiced, howToUseThisGuidance examples) into Patagonia tone. Structure stays.

### Runtime
- **ChatGPT Apps SDK → Google ADK (TypeScript).** Alastair driving this — TS ADK is new (late 2025/early 2026), pre-1.0-era; architect for swap-out. Framed as "first bet."
- **Platform-provided conversation engine / chat UI / session management → built ourselves.** This is the bulk of the 16-day proposal; ChatGPT gave all this for free.
- **Hosting: persistent (Cloud Run), not serverless.** Latency matters for conversational UX.
- **Two-service topology (leaning)**: agent orchestrator Cloud Run + MCP-connector Cloud Run. Favoured for scalability + clean handover to Swoop's team.

### UI
- PoC widgets → same widgets, new integration layer. React + Tailwind retained.
- **Thomas (21 Apr) asked for React** to align with Swoop's existing frameworks — explicitly agreed.
- Phase 1's `structuredContent`/`useApp` plumbing (ChatGPT Apps SDK-specific) → replaced with a host-app runtime (see "Open threads: UI runtime").

### Handoff
- nodemailer pipeline carries forward in principle. Target unchanged: email to sales inbox.
- Payload schema expands to carry triage verdict + reason. `03-handoff-schema.md`.

---

## What's new (not in the PoC at all)

- **Chat UI + streaming + session management** — the three big new effort areas per the proposal.
- **Website scraping ETL** for Patagonia data (disposable by design — see below).
- **Vector/semantic search layer** — PoC used keyword scoring + small embeddings over markdown; V1 needs real retrieval at scale.
- **Triage logic + prompt engineering** for Patagonia-specific filtering.
- **Legal/compliance UX** — EU AI Act Article 50 disclosure + GDPR consent.
- **Patagonia sales-thinking doc** — Luke + Lane producing. 1–2 week window. Equivalent of Emma's Antarctica doc.
- **Multi-source content strategy**: scraped website + scraped blog (hundreds of articles, 5 years of voice) + Patagonia sales doc. How each maps to the WHY/HOW/WHAT prompt layering is a design question for `01-architecture.md`.

---

## Architecture (status as of 21 Apr)

### Settled (21 Apr technical meeting)
- **TypeScript** throughout, no Python.
- **Google ADK** as the agent framework.
- **Two Cloud Run services** (leaning strongly): agent orchestrator + MCP connector.
- **React** for the UI (Thomas's request).
- **GCP project**: "AI Pat Chat" (Julie named it). Thomas setting up + granting Al IAM.
- **Session management** via ADK-provided primitives — keep moving parts minimal.
- **Streaming**: Google-ecosystem — leaning pub/sub or Firebase Realtime DB (Al's recommendation accepted by group since Swoop isn't using anything currently). Note: the earlier draft of this doc said "SSE, not pub/sub" — that contradicts the 21 Apr meeting record; going with what the meeting actually said.

### Leaning (not yet locked)
- **Data search platform**: Vertex AI Search via custom function tools wrapping Discovery Engine API (avoiding ADK's built-in `VertexAiSearchTool` which has known bugs). **Fallback**: Weaviate Cloud Serverless. Vertex first because it's cheaper if the ADK-native path works.
- **UI library**: React is settled, but the specific library is *not*. Earlier thinking (per `ui-deep-research.md`) recommended assistant-ui + AI SDK; 21 Apr meeting just said "React". Treat assistant-ui as a candidate, not a decision. Integration with Google-ecosystem streaming needs to be evaluated before locking.
- **Three-layer prompt model** (WHY static brand/voice; HOW dynamic state-driven fragments; WHAT dynamic tool calls). Carried from Phase 1's `howToUseThisGuidance` + `dimensionsFramework` thinking. Concrete mapping for Patagonia TBD in `01-architecture.md`.
- **Translator layer** (ADK events → AI-SDK-shaped `message.parts`) if we go the AI SDK route. Open.

### Open
- **UI runtime** — assistant-ui vs custom React vs something else. Decision follows UI library above.
- **A2A** — ADK and candidate UI libs both support it, but it's cross-agent protocol, not primarily a UI transport. Reserve for future multi-agent composition (Patagonia agent + Antarctica agent + triage router).
- **Observability / logging** — TBD.
- **Staging vs production** — just local dev for now (Al, 23 Mar).
- **Model / budget ceiling per conversation** — TBD.
- **Fallback UX for errors / rate limits** — TBD.

---

## Data strategy (settled 21 Apr)

The 21 Apr meeting reshaped Al's data thinking. Pre-meeting framing was "wild-west: scraping or ad-hoc SQL, both a nightmare." Post-meeting, there's a concrete plan:

- **Source of truth = the current Swoop website.** Not Mongo, not MySQL directly.
  - Mongo has the product library but is missing prices and other critical info.
  - MySQL has website content (prices live only here).
  - Site migrates to Mongo in October 2026. Until then, the site is canonical.
- **Strategy = AI scrape.** Use Claude (via Swoop's extended Claude services — see "Claude costs" below) with prompt engineering to extract structured data from the website.
- **Disposability is the point.** Scraper is throwaway — October migration will need rewriting anyway. No engineering sunk cost.
- **Scraping is viable**: Thomas confirmed ~90% of page data is PHP-rendered into HTML (not client-loaded), so a straight HTML scrape works.
- **Possible alt path**: Thomas to consider exposing a simple JSON endpoint; would bypass scraping entirely. Not committed.
- **Meta tag with internal ID** proposed for associating scraped items back to Swoop's record IDs (internal IDs aren't publicly exposed).
- **Content inputs at V1** (three streams):
  1. Scraped website product pages — trips, prices, descriptions.
  2. Scraped blog — hundreds of articles, 5 years of accumulated voice/expertise. Al: "have AI crawl and index" (no CMS API needed).
  3. Patagonia sales-thinking doc — arriving 1–2 weeks, Luke + Lane.
- **Scale is too big for markdown files** (PoC approach). V1 uses RAG/search: Vertex AI Search primary, Weaviate fallback.
- **Friday 24 Apr** — targeting a full-day working session with Thomas or Martin to map the data ontology. Al's reframing: this is hackathoning the **API endpoints Swoop can maintain**, not just a one-off data pull. Julie reviewing with Luke.

### Claude costs
Al raised the rising per-conversation API cost on 20 Apr. Agreement: Swoop's recently-extended Claude services will be used for "pure data munching" — keeps heavy ETL API costs off Al's personal/WhaleyBear account. Julie checking with Tom whether the Claude account is Enterprise-tier.

---

## Compliance / legal

- **EU AI Act Article 50** — enforceable **2 Aug 2026**. In scope. Limited-risk classification (customer-facing chatbot). Self-assessed; no pre-market assessment required.
- **GDPR** — in scope.
- Disclosure ("you're talking to an AI, not a human") + consent flow live in the UI.
- Al's framing to Swoop (30 Mar proposal): "I'll handle this simply; available to work with your legal team if you want more."
- Code of Practice: draft Dec 2025, final expected June 2026. Voluntary, worth tracking. ~0.5 day review when it lands.
- Detail in `04-legal-compliance.md`.

---

## Open threads

- **Triage logic** — how to filter backpackers / low-value inquiries without being rude. Needs Patagonia sales input + prompt design. Gated on Luke + Lane's sales doc.
- **Sales handoff schema** — needs `qualified` / `referred_out` / `disqualified` paths, not just the Phase 1 `handoff` shape. `03-handoff-schema.md`.
- **UI library** — React is locked, specific library is not. assistant-ui is the leaning candidate; needs a decision once streaming approach is firmed up.
- **Conversation state model for triage-first PAT** — does BROWSE/EXCITE/CONVINCE/CONVERT carry over unchanged, or does the triage gate need to sit upstream?
- **Phase 2 tool inventory** — Phase 1 had 7 MCP tools. Does V1 need the same count? Does triage merit a dedicated tool, or is it a conversational/state-layer concern? Open.
- **Image annotation pipeline for V1** — parallelisable. Likely another Vertex search index. URL list falls out of the data hackathon.
- **Claude services access** — Julie confirming Enterprise status with Tom; access mechanics TBC.
- **Data ontology** — resolved by Friday session if it happens.
- **Validation harness** — Al is spawning a separate research agent on Karpathy-current tooling. Candidates to evaluate: Anthropic evals, Inspect AI, Braintrust, W&B agent tooling. `07-validation-harness.md`.
- **Observability** — no decision yet.
- **Worktree/branch strategy** — for running parallel Claude Code agents. Needs resolving before heavy parallelisation.
- **Mark Reed status** — not in recent meetings; unclear whether he's still engaged.

---

## Immediate next actions (from 21 Apr meeting)

Owner → action:

- **Thomas** → Set up GCP project "AI Pat Chat"; grant Al IAM.
- **Julie** → Confirm + schedule Friday (24 Apr) working session (Thomas or Martin, full day). Checking with Luke.
- **Julie** → Check with Tom whether the recently-extended Claude account is Enterprise.
- **Swoop group** → Grant access to MongoDB; gather + share input-variable info for existing public API endpoints.
- **Al** → Implement search (Vertex AI or Weaviate).
- **Al** → Build AI scraper utility (Claude deep research + prompt engineering).
- **Al** → Hand off data ingestion ETL script to Swoop team, runnable at cadence.
- **Al** → Forward Emma's Antarctica sales-thinking doc structure to Luke; brief Luke on written detail needed from him + Lane.
- **Luke + Lane** → Produce Patagonia sales-thinking doc (1–2 weeks).
- **Julie** → Clean raw customer age/enquiry data, send to Al.
- **Luke** → Share the Patagonia strategy doc (group-tours future, customer types) with Al.

---

## Sub-docs queued

- [x] **00-overview.md** — this doc
- [ ] **01-architecture.md** — WHY/HOW/WHAT, ADK, Cloud Run, two-service topology, streaming path, UI runtime decision
- [ ] **02-data-access.md** — scraping strategy, target schema, Vertex AI ingestion, Friday session prep
- [ ] **03-handoff-schema.md** — triage-aware wishlist/lead report format (qualified / referred_out / disqualified)
- [ ] **04-legal-compliance.md** — EU AI Act Art. 50 + GDPR
- [ ] **05-workstreams.md** — parallelisable work breakdown (for Claude Code handoff)
- [ ] **06-repo-structure.md** — single-repo layout following PoC's `product/` pattern
- [ ] **07-validation-harness.md** — eval tooling after Al's research pass

(Checkbox state is current reality — 00 exists; the rest are to be written or rewritten.)

---

## Provenance

This is a rewrite (2026-04-21) of an earlier draft that had drifted into from-scratch architecture and carried some hallucinated specifics. Re-anchored to:

- The ChatGPT Apps SDK prototype at `chatgpt_poc/product/` (source code, schemas, guidance payload, widgets, CMS, scripts, test-suite)
- 30 Mar proposal (`project_proposal.md`) and reasoning notes (`project_proposal_notes.md`)
- 20 Apr kickoff (Luke / Julie / Alastair)
- 21 Apr technical requirements (Julie / Thomas / Richard / Alastair)

Where the earlier draft and the meeting records disagreed (notably on streaming transport), this doc goes with the meeting record and flags the prior claim.
