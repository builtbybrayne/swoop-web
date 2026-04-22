# 02 — Implementation: B. Agent runtime

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4B + theme 3 (prompt architecture empirical) + theme 6 (single agent).
**Depends on**: A (foundations — `ts-common` stubs + workspace scaffolded + runtime targets decided).
**Coordinates with**: C (retrieval, which serves tools), D (chat surface, which consumes streaming events), E (handoff, which is one tool + a downstream writer), G (content, which authors the system prompt), F (observability, which emits events), H (validation, which black-boxes this service).

---

## Purpose

B owns the agent loop — the thing that was "free from ChatGPT" in Phase 1 and now we build. It loads a static system prompt, invokes tools via the connector (chunk C), streams events to the chat surface (chunk D), and maintains per-session state. No clever multi-agent composition, no dynamic prompt assembly by default. The simplest thing that could conceivably work in production, shaped so that complexity can be added later without rewriting.

The pinned pieces at this chunk's altitude:
- **Google ADK (TypeScript)** — the agent framework. Settled 21 Apr.
- **Two layers of agent**: conversational orchestrator (single `LlmAgent`, calls tools) + functional internal agents (behind tool boundaries, typically cheaper/faster models). Theme 6 commits to orchestrator-layer simplicity, not "no agents anywhere".
- **Model strategy is per-agent, not blanket-pinned.** Conversational orchestrator leans Claude Sonnet; functional agents pick per task (Haiku / Gemini Flash candidates). Provider abstraction keeps this a config concern.
- **Streaming out via SSE directly** — no internal message bus by default.
- **Structured agent response format** (`<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>`) or the ADK / assistant-ui native equivalent if one exists — see §2.5a.
- **Session state via ADK's native `SessionService`** (in-memory for Phase 1; production backend picked post-M4 from Vertex AI Session Service vs DB-backed).
- **Warm session pool** maintained post-M1 for latency (small, ~2–3, TTL-bounded).

---

## 1. Outcomes

When this chunk is done:

- An agent service runs locally. A conversation against it produces Claude-quality streaming text, with tool calls, against stubbed or real tools.
- The system prompt is loaded from content (a file in `product/cms/`), not inlined. Changes to the prompt don't require a code change — just a file edit + restart.
- Tool invocation round-trips cleanly to chunk C's connector (or a stub), with inputs/outputs validated by Zod schemas from `ts-common`.
- ADK's native event stream is translated into the shared streaming event shape (from `ts-common`) and emitted over SSE in a form assistant-ui can consume.
- Session state (conversation history + triage state + wishlist-in-progress) is accumulated, queryable, and persisted behind an interface that has in-memory and (stubbed) Firestore implementations.
- Model, temperature, and token-budget config externalised to env or config file — no magic numbers in code.

**Not outcomes of this chunk**: dynamic prompt fragment assembly, multi-agent routing, production session backend wiring, observability dashboards, vendor eval tooling.

---

## 2. Target functionalities

### 2.1 Agent graph — two layers

**Layer 1 — Conversational orchestrator.** One ADK `LlmAgent`. Receives each user turn, loads the system prompt at startup, holds conversation history + session state, produces a structured streaming response (§2.5a), and calls tools. From the orchestrator's point of view, **everything downstream is a tool** — it has no awareness of functional agents behind the tool layer.

**Layer 2 — Functional internal agents.** Where a task genuinely wants its own reasoning loop — psych-profile assessment, user-type / stance classification, content summarisation, triage-state update — we run a dedicated ADK agent **inside** the relevant tool execution or pre-turn side-effect. These layer-2 agents:
- Are invisible to the orchestrator (it sees a tool output, not an agent)
- Pick their own model per task (Claude Haiku or Gemini Flash are strong candidates — ADK's provider abstraction makes this a config concern per agent)
- Are preferred over inlining "AI logic" into handwritten code

**Theme 6, refined**: avoid elaborate multi-agent graphs *at the orchestrator layer* — no routing, no visible subagent handoffs inside the conversational loop. That's the complexity we don't want in Puma. Functional agents behind tool boundaries are fine when they pull weight; they're additive, they don't entangle the core conversational flow.

ADK's A2A decorator at the orchestrator layer remains available to add later if multi-destination routing becomes interesting. Not in Puma.

### 2.2 System prompt loader

At startup (or first request — TBD at Tier 3), read the system prompt file from `product/cms/`. This is the only prompt surface in Puma by default. No HOW-fragment composition, no stance classifier, no per-turn assembly. The "WHY/HOW/WHAT" framing is a loose mental model, not architecture (see top-level theme 3).

If real conversations show that a static prompt is insufficient — e.g. triage posture bleeds into discovery mode inappropriately, or group-tour bias is too pushy — the escape hatch is to introduce per-turn fragments as a second Tier 2 B iteration. Don't build the mechanism preemptively.

### 2.3 Tool connector adapter

The agent talks to chunk C's connector over MCP (HTTP). Tool descriptions and I/O schemas come from `ts-common`. During Phase 1 the connector can be stubbed — the interface is what matters.

Tool names: carried forward from the PoC set (`get_conversation_guidance`, `get_library_data`, `show_component_list`, `show_component_detail`, `illustrate`, `handoff`, `handoff_submit`). Exact set for Puma settles during chunk C's Tier 2. Chunk B doesn't invent tool names.

### 2.4 Streaming event translator

Stateless-per-turn. Input: async iterator of ADK-native events. Output: async iterator of shared streaming-event-shape parts (the contract defined in `ts-common` during chunk A, aligned to Vercel AI SDK v5 `message.parts` unless Phase 0 surfaces a reason otherwise). Handles text tokens, tool-call lifecycle (`input-streaming` / `input-available` / `output-available`), and custom data parts that carry `structuredContent` for widget hydration in chunk D.

**`<reasoning>` is never emitted to the browser.** Reasoning blocks (or `reasoning` parts if ADK emits them natively) are **persisted to session history** for agent memory (§2.6) but **stripped from the outbound SSE stream**. Chunk D never sees reasoning in the wire. If it does, that's a translator bug.

Testable against recorded ADK fixtures — the translator is the one place where dedicated tests earn their keep (per chunk A's §6 test philosophy).

### 2.5 SSE endpoint

`POST /chat` (exact shape TBD at Tier 3). Request: `{ sessionId, message }`. Response: SSE stream of the shared event-shape parts. No internal message bus. No WebSocket. No pub/sub. If a concrete need for durable cross-connection events emerges later (e.g. agent continues thinking while the browser reconnects), add it then — not now.

Authentication: none in Puma (demo surface). Swoop's in-house team applies whatever auth their iframe host needs post-M4. Interface-level guard: the orchestrator accepts SSE requests only for session IDs issued via a `POST /session` bootstrap (or equivalent — session handout may also come from the warm pool) — exact shape decided at Tier 3.

### 2.5a Agent response format

The conversational orchestrator produces responses in a structured multi-block format that separates user-facing output, agent-internal reasoning, side-notifications, and UI adjuncts. Four block types:

| Tag | Purpose | Streamed to user? | Kept in memory? | Count per turn |
|---|---|---|---|---|
| `<fyi>` | Side-notifications ("Checking trips…", "Aligning with your preferences…", "Loading images…"). | Yes (as side-channel events) | Yes (see §2.6) | 0 or many |
| `<reasoning>` | Agent-internal thoughts. | **No** | Yes (in conversation history) | 1 or many (at least 1) |
| `<adjunct>` | Requests to the UI to render or do something (widget, deep link, CTA). | Yes (as tool-call / custom-data parts) | Yes | 0 or many |
| `<utter>` | Actual user-facing conversational response. | **Yes (the visible text)** | Yes | 1 or many (at least 1) |

This is prompt-engineered into the system prompt (chunk G authors the instructions to the model). It's a known pattern — Al has used it before — and solves three problems:
1. The agent can "think out loud" across turns without polluting the user-visible conversation.
2. The UI gets a clean channel for side-notifications (the `<fyi>` stream).
3. "Render a widget" (`<adjunct>`) is separated from "say something" (`<utter>`), matching assistant-ui's tool-call / text separation naturally.

**Native alternatives evaluated first**: Google ADK may emit reasoning / artifact events natively; Vercel AI SDK v5 `message.parts` already distinguishes `reasoning` from `text` from tool-call parts. Before building a custom parser, Phase 1 spikes test whether native affordances cover the four block types cleanly. If yes, the prompt asks the model to respect those natives; no parser needed.

**If a custom parser is needed** (likely for `<fyi>` at minimum, possibly all four): it must be **robust as fuck**. Known failure modes the parser handles:
- A `<reasoning>` block may textually mention another tag (e.g. "…then I'll `<utter>` the result"). Parser does not terminate the reasoning block on the mention — it tracks open/close depth, not keyword presence.
- Blocks *should* start on newlines, but models don't always honour this. Parser accepts inline tags.
- Models skip block types unpredictably (zero `<reasoning>` when one is required; two `<utter>` when one was expected). Handler for each block type copes with 0/1/many, and the orchestrator rejects a turn with zero `<utter>` (forces a retry).
- Partial blocks mid-stream (tag opened, not yet closed). Parser is **state-machine-based, not regex-based**, and emits parts incrementally.

Parser location: inside the translator (§2.4). Block types map cleanly to `message.parts`: `fyi` → custom data part (side-channel), `reasoning` → reasoning part, `adjunct` → tool-call or custom data part for widget hydration, `utter` → text part.

### 2.6 Session state

Google ADK provides a `SessionService` abstraction with multiple backends — in-memory (default), database-backed, and Vertex AI Session Service (GCP-native, managed). **Puma leans on ADK's native session management rather than rolling our own persistence layer.** Phase 1 uses the in-memory service; when persistence matters (post-M4), we pick between Vertex AI Session Service and a DB-backed option (Firestore / Cloud SQL). The choice is exposed behind a thin `ts-common` interface so the orchestrator code stays agnostic.

Session holds:
- Conversation history (ADK-managed) — **the entire prior response in full**, across all four block types from §2.5a (`<fyi>`, `<reasoning>`, `<adjunct>`, `<utter>`). The agent needs the complete record of what it said, thought, signalled, and rendered on previous turns to stay coherent. User messages are stored verbatim.
- Triage state (null / qualified / referred_out / disqualified, plus reason when set)
- Wishlist-in-progress (what the handoff payload will contain if the conversation converts)
- **Consent state** (per chunk E §2.3 two-tier model): `conversation` (boolean + timestamp + copy-version id), `handoff` (boolean + timestamp), `marketing` (boolean + timestamp, optional). Tier-1 `conversation === true` is a precondition for the session accumulating any user-message history; the orchestrator refuses to process turns otherwise.
- Session metadata (entry URL, region of interest hint, any A/B variant id from Swoop's side)

TTL: 24h default. Exact values live in config (§2.7).

### 2.6a Warm session pool

Cold-starting the orchestrator + priming the system prompt + loading modular guidance on the very first user message adds latency users feel as hesitation. Puma maintains a small pool of **pre-warmed sessions** — system prompt loaded, agent initialised, ready to accept a turn.

- **Pool size**: small — 2 to 3 sessions at steady state. Tuneable via config; revisit once real traffic patterns are visible.
- **Refill policy**: when a pooled session is claimed by an arriving user, a replacement warms in the background.
- **Staleness**: warm sessions expire after a TTL (default 30 minutes, config-tuneable) so prompt / skill / model config updates don't leave stale state in the pool. Expired sessions recycle.
- **Invalidation on content change** (dev convenience): when `product/cms/` content reloads in dev, the pool flushes. Production handles this via TTL + deploy.
- **Fallback**: empty pool → first turn takes the cold-start penalty. No queueing. Degrades gracefully; it's an optimisation, not correctness.
- **Observability**: pool size, hit rate, staleness events emit to structured logs (chunk F).

Post-M1 optimisation — wire after the vertical slice proves the conversational loop. Pool logic is additive and doesn't change the session interface.

### 2.7 Configuration

Externalised via env vars + a small config file loaded at startup. Surfaces:
- Model (Claude Sonnet default; Gemini Flash or alternative behind the ADK provider abstraction)
- Temperature, max output tokens
- System prompt file path (defaults to `../cms/prompts/why.md` relative to the orchestrator package)
- Connector URL (chunk C's service)
- Session TTL
- SSE heartbeat interval

No magic numbers in code. Everything tunable from outside a deploy.

---

## 3. Architectural principles applied here

- **PoC-first**: system-prompt content draws from `chatgpt_poc/product/cms/guidance-payload.json` and `chatgpt_poc/sales docs/extracted/`. Tool descriptions evolve from `chatgpt_poc/product/ts-common/src/tools.ts`.
- **Content-as-data**: the system prompt is a file, not a string constant. Content changes don't rebuild the service.
- **Swap-out surfaces named**: ADK version (medium swap cost — framework change), orchestrator model (low — config), functional-agent models (low — per-agent config), SSE-only (medium — adding a bus means touching this chunk + D), session backend (low — the `ts-common` interface absorbs ADK's SessionService pluggability).
- **Empirical prompt architecture, with flags in the sand**: the system prompt is the default mechanism; modular guidance (chunk G §2.6) is additive from day one for known inflection points (triage, user-type, psych-profile) rather than deferred to "once real conversations prove need". Chunk B provides the *mechanism* that chunk G's skills load into.
- **Simple orchestrator, functional agents where they pull weight** (theme 6, refined): single ADK `LlmAgent` at the conversational layer; no routing, no orchestrator-visible subagents. But functional agents **behind** tool boundaries (classification, psych profiling, summarisation) are acceptable — and preferable to inlining AI logic in handwritten code.

---

## 4. PoC carry-forward pointers

Path-level only.

- `chatgpt_poc/product/ts-common/src/tools.ts` — tool description patterns. The `TOOL_DESCRIPTIONS` constant and the WHY/HOW/WHAT × User/Agent/Swoop matrix documented in `chatgpt_poc/product/cms/PROMPT_ENGINEERING.md` are the starting point for Puma tool descriptions (minus the ChatGPT-specific "× ChatGPT" column, which becomes "× Agent").
- `chatgpt_poc/product/cms/guidance-payload.json` — source material for the system prompt body (salesMethodology, toneOfVoice, brandPillars). Structure evolves; content is distilled, not copied.
- `chatgpt_poc/product/cms/PROMPT_ENGINEERING.md` — reasoning trail. Read it once when drafting the Puma system prompt; don't port it verbatim.
- `chatgpt_poc/product/mcp-ts/src/index.ts` — MCP server entry pattern (Express + `@modelcontextprotocol/sdk`). Puma's agent is the *client* of the MCP connector; the connector (chunk C) evolves this directly. B consumes the same transport pattern.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| B.1 | Message-passing topology | **No internal bus. SSE direct from agent event stream to browser.** | Simplest thing. Both ADK and assistant-ui already speak streaming HTTP. Adding Pub/Sub or Firebase Realtime DB is work that earns nothing until we have a concrete reason (e.g. durable events across reconnects) — we don't. |
| B.2 | Session backend strategy | **ADK's native `SessionService`.** In-memory for Phase 1; production backend picked between Vertex AI Session Service and DB-backed (Firestore / Cloud SQL) post-M4 when usage patterns are visible. Exposed behind a thin `ts-common` interface. | Use ADK-native to avoid reinventing persistence; defer the production-backend specifics until there's data to choose on. |
| B.3 | Prompt composition (chunk B mechanism; chunk G content) | **Static system prompt + ADK-native skill mechanism wired from day one.** Fall back to a custom loader tool only if the native primitive turns out to be a poor fit in Tier 3. | Theme 3, refined. Planting flags early rather than deferring to "real conversations". ADK supports agent skills natively as of late 2025 (chunk C C.11) — use the native primitive rather than reinventing. Chunk G authors the content; B wires the loader. |
| B.4 | Agent graph shape | **Single conversational orchestrator (ADK `LlmAgent`).** Functional internal agents allowed inside tool implementations and pre-turn side-effects where they pull their weight. | Avoids orchestrator-layer complexity; permits task-specific agents (psych profiling, classification, summarisation) behind tool boundaries. ADK runners everywhere — no framework mixing. |
| B.5 | Model strategy | **Per-agent, not blanket-pinned.** Orchestrator leans Claude Sonnet; functional agents select model per task (Claude Haiku and Gemini Flash as cheap/fast candidates). Model-per-agent is a Tier 3 config decision. | Different functions have different cost/latency/quality needs. ADK's provider abstraction makes per-agent model selection a config concern, not a code commitment. |
| B.6 | Translator location | **Inside the orchestrator, stateless-per-turn.** Includes the response-format parser (§2.5a) unless natives cover it. | Keeps the chat surface (D) ignorant of ADK. The one place in B where focused unit tests pay off — translator + parser are both deterministic mappings. |
| B.7 | Session TTL default | **24h idle → archive.** | Matches PoC baseline. Tune from config if pre-launch data suggests otherwise. |
| B.8 | Auth on SSE endpoint | **None in Puma.** Session-id gate only. | Demo surface; Swoop's iframe host handles any real auth post-embed. |
| B.9 | Agent response format | **Structured multi-block convention (`<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>`)** unless Phase 1 spike shows ADK + assistant-ui natives cover it cleanly. State-machine parser, robust to inline tag mentions and missing newlines. | Known working pattern. Separates user-facing output from agent-internal reasoning. Natives evaluated first; custom parser if needed. |
| B.10 | Warm session pool | **2–3 pre-warmed sessions maintained post-M1.** TTL ~30 min. Cold-start fallback when empty. | Avoids system-prompt-load latency on first user message for the common case. Additive; no interface change. |

Deferred — not closed here:
- Model / cost ceiling per conversation (chunk F observability surfaces the signal; tune pre-launch)
- Fallback UX on agent error / rate limit (chunk D owns)
- ADK-version pinning and upgrade cadence (Tier 3, A.t1 produces the initial pin; upgrade cadence decided reactively)

---

## 6. Shared contracts consumed (and the one contract this chunk authors)

Consumed (from `ts-common`, stubbed during chunk A):
- **Tool I/O schemas** — agent validates inputs before calling, checks outputs before appending to session.
- **Streaming event shape** — the translator is this chunk's contract-producer; it must emit exactly this shape.
- **Session state shape** — the session interface and both adapters are typed against it.
- **Handoff payload** — when the agent triggers `handoff_submit`, it's producing an instance of this.

Authored by this chunk:
- **The streaming event translator's input format** (ADK-native events). Not in `ts-common` — it's an implementation concern internal to B. But the translator's *output* (the shared streaming event shape) is a `ts-common` contract that B obeys, not defines.

---

## 7. Open sub-questions for Tier 3

- Exact SSE endpoint shape (`POST /chat` vs bootstrap + long-poll vs unified REST+SSE).
- Exact translator test fixtures: recorded from a real ADK run, or hand-authored?
- Startup-time vs first-request prompt loading (and hot-reload in dev).
- Session-id issuance: uuid at `POST /session` vs client-generated with server validation vs warm-pool handout.
- Error surface: what the agent returns when ADK throws, what the browser sees.
- Model config file format: single JSON/YAML vs env-only; shape for per-agent model selection.
- Heartbeat / keepalive cadence on the SSE stream.
- **ADK SessionService backend evaluation** for production (post-M4): Vertex AI Session Service vs Firestore vs Cloud SQL. Trade-offs on cost, lock-in, query-ability of accumulated history.
- **Native vs custom response-format plumbing**: does ADK's event model + assistant-ui's `message.parts` cover `<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>` without a custom parser? Phase 1 spike answers this.
- **Modular guidance loading mechanism**: tool call (orchestrator asks for skill content when triggers fire) vs ADK-native skill / callback primitive vs pre-turn side-effect injection into the system prompt. Chunk G's content shape and chunk B's loader decide together.
- **Warm pool invalidation on content change**: TTL-only vs explicit flush on `product/cms/` update (dev ergonomics concern mostly).
- **Per-agent ADK runner setup** for functional agents: shared runner with tenant separation vs runner-per-agent. Ops complexity trade-off.

---

## 8. Dependencies + coordination

- **Inbound (must land before B can start)**: chunk A's `ts-common` stubs (tool I/O schemas, streaming event shape, session state shape), `product/` workspace scaffolded, Cloud Run decision locked.
- **Inbound (must land before B is *real*, not just stubbed)**: chunk C's connector endpoint (even stubbed); chunk G's first system-prompt draft.
- **Outbound**: chunk D consumes B's streaming event shape over SSE; chunk H black-boxes B's endpoint; chunk F reads events from B's logs.
- **Agent coordination**: Phase 0 contract work — B is the primary producer for the streaming event shape stub. That stub must satisfy both ADK's output (B's concern) and assistant-ui's input (D's concern). Coordinate with the chunk D agent via shared `ts-common` artefact first; use `SendMessage` if interactive contract negotiation becomes necessary. See top-level §5.

---

## 9. Verification

Chunk B is done when:

1. The orchestrator starts, loads the system prompt from `product/cms/`, and logs its readiness.
2. A `POST /chat` request with a sample message produces a streaming SSE response that a simple `curl -N` can consume.
3. A tool invocation round-trips to a stubbed connector; the agent sees the response and continues the turn.
4. The streaming event translator's output passes a contract check against the `ts-common` shape (Zod validation on every part).
5. Agent responses parse cleanly into the four block types (§2.5a) — even across stream boundaries, inline tag mentions, and missing newlines. Parser fuzz-tests green.
6. At least one functional internal agent (e.g. a trivial stance-classifier in a tool) runs with a model **different from the orchestrator's** (per B.5), proving per-agent model selection works.
7. Session state accumulates across turns and survives a simulated reconnection (same `sessionId`, different HTTP request). `<reasoning>` blocks from prior turns are present in history; `<fyi>` blocks are not.
8. Swapping the ADK SessionService backend from in-memory to a stub of another backend requires zero changes outside the adapter itself — proves the interface is clean.
9. Swapping the orchestrator's model via config works without code changes; ditto for a functional agent's model.
10. Warm pool at steady state holds 2–3 pre-warmed sessions; claiming one triggers a background refill; stale sessions recycle after TTL. (Verify post-M1.)
11. A unit test suite covers the translator + parser, passes green.
12. No conversation content, brand voice, or prompt text is hardcoded anywhere in the chunk B source.

---

## 10. Order of execution (Tier 3 hand-off)

Natural split into task slices:

- **B.t1 — Orchestrator skeleton + prompt loader**: ADK `LlmAgent` wiring, Claude Sonnet provider config for the orchestrator, system prompt loaded from file at startup, readiness probe.
- **B.t2 — Session interface + ADK in-memory adapter**: thin `ts-common` interface over ADK's `SessionService`; in-memory implementation for Phase 1; stubs / signatures for the candidate production backends (Vertex AI Session Service, DB-backed).
- **B.t3 — Tool connector adapter**: MCP-over-HTTP client pointing at chunk C's service (stubbed or real), tool-schema validation against `ts-common`, basic retry policy.
- **B.t4 — Streaming event translator**: ADK event → `message.parts` mapping, test fixtures, unit tests for the happy path and tool-call lifecycle states.
- **B.t5 — SSE endpoint**: `POST /chat` (or finalised shape from §7), session-id gate, heartbeat, error surface.
- **B.t6 — Config externalisation**: env / config file shape, defaults, validation at startup. Includes per-agent model selection config.
- **B.t7 — Vertical-slice integration**: wire the above together for M1 with stubbed content, stubbed connector, and a single minimal functional agent behind one tool (to prove the two-layer model works). First end-to-end text exchange.
- **B.t8 — Response-format parser** (conditional on Phase 1 spike): state-machine parser for `<fyi>` / `<reasoning>` / `<adjunct>` / `<utter>`. Fuzz-tested. Integrates into the translator (B.t4). **Skip entirely** if the spike finds ADK + assistant-ui natives cover the functional need.
- **B.t9 — Modular-guidance loader via ADK-native skills** (coordinated with chunk G §2.6 and chunk C §C.11): confirm ADK's current skill-primitive API; wire skills from `product/cms/skills/` through it. Fall back to a custom loader tool only if the native primitive turns out to be a poor fit.
- **B.t10 — Warm session pool** (post-M1): pool manager, refill policy, TTL-based staleness recycling, content-change flush in dev.

Parallelism: B.t1, B.t2, B.t6 proceed in parallel within a single agent's session. B.t3 waits on chunk C's connector existing (stubbed is fine). B.t4 + B.t5 are adjacent — one agent does both, or two agents split cleanly. B.t7 is the integration — single-agent. B.t8 is conditional. B.t9 pairs with G.t3. B.t10 is a deliberate post-M1 task.

Estimated: 3–4 days of focused work for B.t1–B.t7 (vertical-slice scope), single agent, once chunk A's foundations land. B.t8–B.t10 add 1–1.5 days depending on Phase 1 spike outcomes.
