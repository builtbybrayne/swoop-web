# Discoveries — Swoop Web Discovery (Puma)

Non-obvious architectural truths we learned during the build. Add entries when you learn something that future-you (or a future agent) would have wanted to know up front.

**Format**: `## YYYY-MM-DD — one-line topic` then body. Latest at top.

---

## 2026-04-24 — Clearing assistant-ui thread state without library internals: re-key the provider + churn the transport

Problem encountered in D.t5: the "New conversation" button (and the error-banner's "Start over" path) needed to tear down the visible chat history AND rebootstrap the server session without bouncing the visitor back to the OpeningScreen. The naive route — call `consent.reset()`, flip status to `pending`, let React re-render — leaves stale assistant-ui state because the `useChatRuntime({ transport })` call in `App.tsx` lives above the re-rendered subtree; the runtime instance and its thread-state survive the re-render and the old messages come back as soon as `hasConsented` flips true again.

Two-part pattern that works:
1. Maintain a `resetKey` integer in `App.tsx`, bumped on every restart.
2. Use `resetKey` as a dep of `useMemo(() => createOrchestratorTransport(), [resetKey])` so a new transport is constructed per restart. Because `useChatRuntime` is passed a new transport reference each time, it initialises a fresh runtime.
3. Pass `key={resetKey}` on `<AssistantRuntimeProvider>` so React fully remounts the subtree — belt-and-braces for any runtime state that might otherwise leak across instances.

This is the simplest honest way to clear assistant-ui thread state at 0.12.25 without reaching for `useThreadRuntime` internals (most of which are deprecated in favour of the forthcoming `aui.*` API). When that new API lands it may expose a first-class "clear thread" affordance, at which point the resetKey pattern can retire. Documented as decision D.14 in `planning/decisions.md`.

Do NOT try to detect "errored message in thread state" as the restart trigger: pre-stream failures (session missing, fetch rejects before any message exists) have no thread-state entry to look at. Adapter-side module emitter (D.12) sidesteps that hole.

---

## 2026-04-24 — Swoop data ontology first pass captured — not canonical

Before Swoop engineering agreed to ship a full SQL dump (Monday 2026-04-27), we did a first-pass inspection of their public Trip Finder JSON feed + one detail page. That produced two durable reference artefacts:

- [data-ontology.md](data-ontology.md) — entity-by-entity inventory: which records are observed vs. implied, which fields are declared-but-empty, controlled tag vocabularies fully enumerated, a prioritised "what to ask Swoop for" table.
- [planning/02-impl-retrieval-and-data-source-exploration.md](planning/02-impl-retrieval-and-data-source-exploration.md) — wrapper context: sources inspected, call confirmations (activities = tags only, Accommodation + Location ARE records, "Pages" is a new entity), Monday pickup checklist.

**Treat both as first-pass references, not canonical.** The SQL dump supersedes them. Once the dump is modelled, the ontology file gets updated with a new `S-SQLDUMP-2026-04-27` source tag and the exploration doc retires to `planning/archive/` (or folds into the parent chunk C doc). Outstanding questions parked under "Data pipeline" in [questions.md](questions.md).

---

## 2026-04-24 — Connector returns `{ok, value}` envelopes — widgets must unwrap

The MCP connector adapter (`product/orchestrator/src/connector/tools.ts`) returns `invokeTool` results as `{ok: true, value: <validated data>}` so structured errors can flow alongside successful payloads through the same channel.

That envelope passes through ADK's `functionResponse.response` and the translator's `tool-call` part `output` field unchanged. Widgets receive `props.result === {ok, value}` and parsing it against `SearchOutputSchema` etc. fails — the schema expects `{hits, totalMatches}`, not the wrapper.

Fix lives in `product/ui/src/widgets/widget-shell.tsx`: the shared `safeParse()` helper auto-detects and unwraps the `{ok: true, value}` envelope before passing to the Zod parser. Backwards-compatible — non-enveloped values pass through.

If you ever change the connector's envelope shape, update `unwrapEnvelope` in `widget-shell.tsx` to match. Or migrate widgets to use the AI SDK envelope conventions if they emerge.

---

## 2026-04-23 — Anthropic tool schemas need JSON Schema draft 2020-12, genai emits draft-04-style

When the orchestrator (`claude-llm.ts`) translates ADK `FunctionDeclaration`s into Anthropic's `tools` array, three divergences must be normalised:
1. **Type enum strings** — genai uses `"OBJECT"` / `"STRING"` / `"INTEGER"` / `"ARRAY"` uppercase. JSON Schema 2020-12 wants lowercase.
2. **Numeric constraints as strings** — genai serialises `minLength: "1"`, `minItems: "1"` etc. as strings (protobuf Long). JSON Schema requires numbers.
3. **Draft-04 exclusiveMinimum booleans** — genai emits `exclusiveMinimum: true` + `minimum: 0`. Draft 2020-12 wants `exclusiveMinimum: 0` directly, with no bare `minimum`.

The normaliser in `claude-llm.ts` handles all three. If you ever build tool declarations some other way, re-apply these rules — Anthropic rejects non-compliant schemas with `"JSON schema is invalid. It must match JSON Schema draft 2020-12"`.

---

## 2026-04-23 — AI SDK v6 `DefaultChatTransport` can't talk to Puma's orchestrator

`DefaultChatTransport` from the `ai` package expects an OpenAI-compatible endpoint accepting `{messages: UIMessage[]}` and returning AI-SDK-formatted stream chunks. Puma's `/chat` takes `{sessionId, message: string}` and returns raw `data: <MessagePart-json>\n\n` SSE events.

The bridge is a **custom `ChatTransport` implementation** in `product/ui/src/runtime/orchestrator-adapter.ts`. It extracts the latest user message text from the `UIMessage[]` array, posts the Puma shape, reads the SSE, and converts each `MessagePart` to the `UIMessageStreamPart` events assistant-ui expects.

If you ever upgrade AI SDK or assistant-ui, re-test this bridge — both libraries are pre-1.0 and their part-type taxonomies churn.

---

## 2026-04-23 — Google ADK 1.0 ships no Claude provider — custom `BaseLlm` shim required

ADK 1.0 (`@google/adk`) has `LlmAgent` + `BaseLlm` + `SessionService` primitives, but the only built-in providers are `Gemini` and `ApigeeLlm`. Claude needs a hand-written `BaseLlm` subclass that translates ADK `LlmRequest`s into Anthropic Messages API calls and yields `LlmResponse` objects from the streaming response.

The shim lives at `product/orchestrator/src/agent/claude-llm.ts`. Translation pieces that matter:
- `content_block_delta` text → `Part.text`
- `thinking_delta` → `Part.text` with `thought: true` — **load-bearing** because the translator keys on `Part.thought` to filter reasoning from the outbound SSE.
- `input_json_delta` → accumulate into per-block buffer; emit `functionCall` only on `content_block_stop`.
- `stop_reason` mapping: `end_turn|stop_sequence|tool_use|pause_turn` → `STOP`; `max_tokens` → `MAX_TOKENS`; `refusal` → `SAFETY`.

---

## 2026-04-23 — assistant-ui is a renderer, not an agent orchestrator

Despite "state management" and "tool calling" language on assistant-ui's site, those refer to **client-side UI state** (thread rendering, tool-call UI registry, widget hydration) — NOT agent orchestration. The agent loop runs server-side.

Reasons to keep the agent server-side:
- API keys can't sit in a browser.
- MCP-exposure future — Puma's orchestrator can eventually double as an MCP server third-party clients consume.
- Per-agent model selection (orchestrator Sonnet + functional Haiku classifier + future specialised agents).
- Warm pool, session persistence, structured observability all require server state.

Recorded formally as decision **D.11** in `planning/decisions.md`.

---

## 2026-04-23 — Two-layer agent model works cleanly in ADK

The **orchestrator** is one ADK `LlmAgent` running Claude Sonnet. **Functional internal agents** (e.g. the triage classifier) run inside tool execution / pre-turn side-effects using their own `BaseLlm.generateContentAsync` call with a different model (Haiku 4.5) — invisible to the orchestrator, which sees a tool result.

This is proven live in `product/orchestrator/src/__tests__/integration/hello-world.test.ts` and verified in the browser (the classifier's Haiku invocation is logged alongside the orchestrator's Sonnet turn).

Scaling the pattern: every new layer-2 agent adds itself to `getModelFor(role)` in `src/config/models.ts` and picks its own model via config (`FUNCTIONAL_CLASSIFIER_MODEL` etc.). No orchestrator-graph complexity needed.

---

## 2026-04-23 — GDPR tier-1 consent must pair with disclosure at conversation start

Session state accumulates conversation data the moment a visitor types. GDPR requires a lawful basis **before** processing. Deferring consent to the handoff (as the original Tier 2 draft had it) would mean processing personal data without a basis.

Puma's posture: **one paired opening screen** — AI disclosure (EU AI Act Art. 50) + tier-1 consent (GDPR basis for conversation storage), with Continue / No thanks. Tier-2 consent at handoff submission covers the more specific contact-detail + outreach step.

Encoded in chunk E Tier 2 (§2.3) and implemented via D.t4. Decision **E.4** in the log.

---

## 2026-04-23 — `<reasoning>` parts must be filtered out of the outbound SSE

Keeping the agent's own reasoning private to the session (but persisted!) is a hard invariant:
- Session history stores the full response across all four block types (`<fyi>`, `<reasoning>`, `<adjunct>`, `<utter>`) so the agent has continuity across turns.
- The outbound SSE to the UI **never** carries reasoning parts.
- UI has a `reasoning-guard` (D.t2) that throws in dev if one sneaks through — catches translator bugs.

Orchestrator translator (B.t4) strips them unconditionally. If you're ever rewriting the translator, preserve this invariant.

---

## 2026-04-23 — `<fyi>` as a tool call is cleaner than a custom part type

User's observation mid-build (captured in `inbox.md`). The current implementation is a state-machine parser + custom `data-fyi` AI SDK part. A cleaner long-term design: register a thin `announce_status` tool; model emits `tool-call` parts which assistant-ui's registry renders as ephemeral status affordances.

Pros: native across ADK + AI SDK + assistant-ui; no custom parser; no custom part type; models are reliable at structured tool-call output.

Swap cost post-M1 is small — retire `block-parser.ts` + `data-fyi` part type, add a tool + one assistant-ui renderer registration.

Captured in `inbox.md` as a post-M1 candidate.

---

## 2026-04-22 — ADK-native skill primitive replaces custom `load_skill` tool

Initial Tier 2 draft had a `load_skill` custom MCP tool. Google ADK 1.0 supports "agent skills" natively — no custom tool needed. Chunk B.t9 wires the native primitive; chunk G authors skill content files. Decision **C.11** in the log.

Verify the native API when you implement B.t9 — the ADK surface is young and may have shifted.

---

## 2026-04-22 — PoC widgets carry layout, not styling or hydration

The ChatGPT PoC's widgets live at `chatgpt_poc/product/ui-react/src/widgets/`. Tempting to copy-paste, but they're **styled for ChatGPT** and **hydrated via ChatGPT's `useApp` / `structuredContent` mechanism**. Neither carries to Puma:
- Styling: Puma wants vanilla Tailwind so Swoop's team can apply brand identity on top.
- Hydration: Puma uses assistant-ui's tool-call registry, not ChatGPT's iframe runtime.

Treat PoC widgets as **wireframes / information-architecture specs**. Extract "what fields" + "what order" and rebuild. Documented in D.t3 plan.

---

## 2026-04-22 — "Derived datasource" terminology is load-bearing

ETL artefacts (Cloud Storage + Vertex AI Search index + annotations) are **derived data** from an authoritative source (Swoop's website / API). This labelling in code + docs prevents future devs / agents from treating the derived store as a write target.

October 2026 Swoop data consolidation will rewrite the ingestion utility — the derived store shape doesn't need to change because it's already derived.

Chunk C Tier 2 §2.2 makes this explicit. Decision **C.12**.
