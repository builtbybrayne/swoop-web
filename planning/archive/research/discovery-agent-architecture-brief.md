# Discovery Agent Architecture — Handoff Brief

**Context**: Luxury travel agency, customer-facing discovery agent on their website. Goal: inspire users (Awareness → Interest → Consideration) and hand off a structured "wishlist report" to human sales agents. Explicitly NOT building itineraries — hallucination risk too high. Output is imaginative possibilities plus a handoff brief.

**Scale**: Low thousands of records in source MongoDB (cruises, hotels, bundles, treks, interlinked, with media URLs). Additional sources: scraped website content, Sales SOPs.

**V1 goal**: validate engagement. Responses need to be "good, not perfect."

**Language**: TypeScript.

---

## The three-layer architecture (settled)

The agent's context is structured as three distinct layers. This is load-bearing for the decision.

1. **WHY** — static system prompt. Hardcoded. The agent's purpose, values, the "possibilities not certainties" guardrail. Not retrieved.
2. **HOW** — dynamic prompt fragments loaded based on user profile assessment. Skill-like. Source material: Sales SOPs and scraped web content, crunched into behavioural fragments (e.g. `budget_conscious.md`, `exploratory.md`, `skeptical.md`). Not records, not RAG. This is prompt composition.
3. **WHAT** — dynamic retrieval of content to show. FAQs (from scraped site + SOPs), catalog records (from Mongo), media URLs. Different sources have different trust levels (authoritative catalog, semi-authoritative scraped content, agent imagination). Provenance must be preserved through to the handoff.

**Handoff output**: structured schema (JSON) with fields: `expressed_interests`, `emotional_tenor`, `hard_constraints`, `soft_signals`, `shortlisted_items`, `open_questions`, `agent_imaginings` (explicitly flagged agent speculation vs. user statements).

---

## The real contenders

### 1. Claude Agent SDK (current lead)

Anthropic's agent runtime exposed as a library. `@anthropic-ai/claude-agent-sdk`. Ships a bundled Claude Code CLI subprocess — your server spawns it; the CLI calls out to Claude models over the API; tool execution happens in your container.

**Why it fits this architecture exceptionally well:**

- **HOW layer is literally Agent Skills**. Drop `SKILL.md` files in `.claude/skills/`, set `settingSources: ['project']`, Claude auto-loads them when descriptions match context. The pattern the three-layer model described is the pattern Skills implement.
- **Subagent orchestration is declarative**. Define `agents` map with `{description, prompt, tools, model}` entries, include `Task` in allowed tools, Claude decides when to spawn. No hand-written routing.
- **Automatic context compaction** — long conversations don't require custom management.
- **Structured outputs for handoff** — first-class schema support.
- **Per-subagent model override** — Haiku for the conversational loop, Sonnet/Opus for the terminal wishlist summariser.
- **Runs on Vertex AI** (`CLAUDE_CODE_USE_VERTEX=1`) — GCP billing, IAM, regionality preserved. "Hosted on Google Cloud" remains true.

**Costs / caveats:**

- **Subprocess model**. Every agent session spawns a Node-based CLI subprocess inside your container. Adds ~100MB RAM per process, hundreds of ms cold-start. Fine on Cloud Run, weightier than a plain Node service. Bundled CLI adds tens of MB to the container image.
- **Anthropic-only for now**. No easy swap to Gemini if strategic priorities change. Bedrock and Vertex both available as backends.
- **Known streaming stall issue** (TS SDK GitHub #44): intermittent multi-minute pauses with no error events. Production mitigation: client-side timeout + `resumeSession`, bound `maxTurns`.
- **Token costs can spike**. Agentic patterns chew tokens. Set `max_budget_usd` and `maxTurns` from day one. Typical agent session $0.05–$0.50 depending on model.
- **Branding rules**. Can't use `claude.ai` login for end users (API key auth required). Can't make product look like Claude Code. Irrelevant for white-labelled travel site.
- **Perception for client**: "building on Anthropic's SDK running on Google Cloud" is a slightly harder sell than "building on Google's agent framework." Not technical, but real.

**Estimated setup time to v1**: ~1–1.5 weeks.

### 2. Google ADK (TypeScript) + Google data layer

Official `@google/adk` released December 2025 (repo `github.com/google/adk-js`). Full first-class TypeScript support. Ignore earlier references to community ports (`@iqai/adk`, `adk-typescript`, `@waldzellai/adk-typescript`) — those predated the official release.

**Orchestration primitives available:**

- `LlmAgent`, `SequentialAgent`, `ParallelAgent`, `LoopAgent`.
- `InstructionProvider` callable pattern — async function receives `ReadonlyContext`, reads session state, returns dynamically composed system prompt. **This is the mechanism for the HOW layer.**
- `AgentTool` — wrap a sub-agent as a callable tool for another agent. Closest analog to Claude's `Task`.
- LLM-driven delegation via `sub_agents` on a parent — parent's LLM uses `description` fields to route.
- Shared session state; before/after model callbacks; `outputKey`.
- MCP support first-class; MCP Toolbox for Databases has native TS integration.

**What it lacks vs Claude Agent SDK:**

- **No equivalent to filesystem Skills**. HOW layer has to be hand-built: classifier step (small Gemini Flash call with structured output to assess user profile) → write to session state → `InstructionProvider` reads state → looks up fragments in a map → concatenates. Works, but you're writing the machinery, testing the cartesian product of combinations, managing fragment collision.
- **No automatic context compaction** — you manage long-conversation state.
- **Orchestration is more declarative than emergent**. You define workflow shapes; model navigates them. Claude's "model decides and spawns what it needs" is closer to what a fluid discovery conversation wants.

**ADK-specific gotchas (Python-verified; TS likely similar since the constraint is at the Gemini API level):**

- **Built-in tools can't coexist with custom function tools on the same agent** without a bypass flag. The error: `"Multiple tools are supported only when they are all search tools"`.
- **Built-in tools can't be used within sub-agents** except `GoogleSearchTool` and `VertexAiSearchTool` with `bypass_multi_tools_limit=True` (v1.16+).
- **The bypass has its own bugs**: structured datastores error on `SearchResultMode` (issue #3406); `PUBLIC_WEBSITE` datastores fail outright (issue #4157).
- **Workaround (recommended regardless)**: don't use `VertexAiSearchTool` as a built-in. Wrap Vertex AI Search calls in plain custom function tools via the Discovery Engine client directly. Loses auto-grounding metadata but gains consistent orchestration and portability. Many production ADK builds do exactly this.

**Why it stays in the running:**

- **Model portability**. ADK is model-agnostic. If future strategy is "validate with good models, scale with cheap Gemini Flash," ADK is the right bet.
- **Cleaner GCP governance narrative**. "Google's framework on Google's cloud."
- **Lower per-session runtime cost** — no bundled subprocess, plain Node service.
- **Better fit if you'd ever want to offer the agent to a Google-first enterprise client.**

**Estimated setup time to v1**: ~2–3 weeks.

### 3. Weaviate (data layer decision, separate from framework)

Weaviate sits in the WHAT layer regardless of which agent framework you pick. It's a data layer choice, not a competitor to ADK or Claude Agent SDK.

**Why it's compelling for this use case:**

- **Named vectors per property** — fine-grained hybrid control.
- **Three collections** cleanly map to your WHAT sub-sources: `Itineraries`, `FAQs`, `SalesSOP`. Provenance falls out naturally.
- **Personalization Agent**. Persona + weighted interaction history (`like=1.0`, `view=0.5`, `dislike=-0.5`) for reranking catalog items. Built for exactly this kind of "discovery with accumulated signal" use case. No equivalent in Vertex AI Search.
- **Query Agent** does multi-collection routing and decomposition via natural language — but latencies ~10s, too slow for live conversation. Use it for back-office analytics, not the customer path.
- **MCP server available** — plugs into both Claude Agent SDK and ADK-TS with low code.

**Versus Google-native for this layer:**

- **Vertex AI Search blended search**: 50 datastores per app, decent document parsing, grounding metadata. But ADK built-in tool bugs push you to wrap it in custom function tools anyway, at which point you've given up the main convenience.
- **AlloyDB AI (ScaNN + pgvector)**: cleanest long-term architecture — operational data + embeddings colocated, hybrid RRF, inline filtering. Requires migrating off Mongo, which is v2 work.
- **Firestore vector search**: exact KNN only, 1000-doc return cap, no native hybrid, composite-index-per-filter-combo pain. Skip.
- **BigQuery vector search**: wrong latency profile for conversational interactive. Analytics-side only.

**Recommendation**: Weaviate Cloud Serverless for WHAT, accessed via custom function tools from the agent (not via Query Agent — too slow). Seed Personalization Agent plumbing in v1; activate in v2 once interaction data exists.

---

## Also-rans (briefly)

- **Vertex AI RAG Engine** — optimized for document corpora, loses relational signal. Skip unless catalog becomes PDF-heavy.
- **Spanner Graph** — genuinely good for multi-model graph + vector, but floor price non-trivial for low-thousands scale.
- **Neo4j / GraphRAG** — your interlinks are structured FK-shaped relations, not entity-extraction territory. LLM can traverse via a `get_related(id, relation)` tool. Revisit if you add large unstructured editorial content.
- **Pinecone** — Assistant product over-indexed on scale you don't have. Billing math doesn't work at low thousands.
- **Qdrant** — most flexible self-host option; ops complexity disproportionate to v1 needs.
- **Elastic** — reasonable if the org already runs Elastic; otherwise too much operational weight.
- **Vespa, LanceDB, Turbopuffer** — don't change the calculus at this scale.
- **ColPali / ColQwen** — late-interaction visual retrieval. Irrelevant; media is asset URLs, not retrieval target.

---

## Key technical facts (easy to lose)

### On Claude Agent SDK runtime

- Model runs on Anthropic/Vertex/Bedrock servers (not on your server).
- Claude Code CLI runs on your server as a subprocess (bundled with the SDK package).
- Your app code talks to the subprocess via stdin/stdout JSON-lines.
- No Claude Code subscription needed — authenticates with API key or Vertex/Bedrock credentials.
- First-token latency: model latency (300–800ms Sonnet/Haiku) + tens of ms IPC overhead. Indistinguishable from direct API call for the user.
- Streaming: set `includePartialMessages: true`, listen for `content_block_delta` events with `delta.type: "text_delta"`.
- Per-user subprocess lifecycle: either keep-warm pool or use session resumption to revive idle sessions.

### On Google ADK gotchas

- Built-in `VertexAiSearchTool` has multiple known bugs at multi-instance/multi-tool scope. Custom function tools wrapping Discovery Engine API sidestep all of them. Recommendation: commit to custom function tools regardless of framework choice.
- `InstructionProvider` is the mechanism for dynamic system prompt composition — works, but you write classifier, fragment composition, and testing yourself.
- `AgentTool` vs `sub_agents` — different semantics. `AgentTool` is explicit invocation (agent as function). `sub_agents` is LLM-driven delegation (parent's LLM picks child by description). Don't mix without understanding which you want.

### On provenance (matters for handoff)

The wishlist handoff is the product deliverable. Design its schema *before* the agent, not after. The `agent_imaginings` field that explicitly separates speculation from factual claims is load-bearing for the "possibilities not certainties" constraint — human sales agent reading the handoff needs to see the boundary.

Preserve source tags on every retrieval result (`source: "catalog" | "scraped_web" | "sales_sop"`). The agent's system prompt tells it how to cite: "only quote policies from SOP; treat scraped content as indicative; catalog facts are authoritative."

---

## The decision surface (reduced)

**Framework choice hinges on one question: model portability.**

- **If model portability is strategic** (want option to swap to Gemini Flash for cost, or GCP-first client contracts make Anthropic awkward): **ADK**. Accept the extra ~week of HOW-layer and orchestration work as the price.
- **If it isn't**: **Claude Agent SDK**. Skills map 1:1 to the HOW layer; subagent orchestration is declarative; context compaction is automatic; setup is ~1 week faster. Deploy on Cloud Run with Vertex backend, GCP governance intact.

**Data layer choice is independent:**

- **Weaviate Cloud** for WHAT layer. Three collections (`Itineraries`, `FAQs`, `SalesSOP`). Custom function tools call it directly, not Query Agent. Seed Personalization Agent plumbing for v2.
- **Keep MongoDB as system of record**. Nightly ETL to Weaviate.

**v1 explicitly excludes**: GraphRAG, rerankers, ColPali, AlloyDB migration, Weaviate Query Agent for live conversation, Personalization Agent activation. Ship without them; add in v2 based on evaluation evidence.

---

## Open questions for Cowork

1. Is model portability strategic? (This is the crux.)
2. Which TS framework has the client's governance comfort — Google's official ADK or Anthropic's SDK running on Vertex?
3. Is there appetite for a 2–3 day spike building the same minimal discovery flow in both, to compare concretely before committing?
4. What's the budget/latency ceiling per customer session? Determines model selection (Haiku vs Sonnet vs Opus) and whether subprocess pooling is v1 concern.
5. How is the wishlist handoff consumed? Email to sales agent? CRM record? Slack? Shapes the schema and delivery mechanism.

---

## What NOT to re-litigate

These are settled; Cowork should take them as given:

- Low-thousands scale means no vector DB's performance characteristics differentiate them. Decision is about ergonomics and architecture fit.
- GraphRAG is not a v1 concern. Interlinks are FK-shaped; agent can traverse via tool calls.
- Multiple retrieval surfaces beats one blended surface. Provenance falls out naturally; agent can reason about source authority.
- Custom function tools beat `VertexAiSearchTool` as a built-in, regardless of framework. Sidesteps ADK bugs and gives portable retrieval layer.
- HOW layer is not a vector search problem. It's classifier + fragment composition. Determinism matters more than similarity.
- MongoDB stays as system of record for v1. Migration is v2+ work.
