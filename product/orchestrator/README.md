# @swoop/orchestrator

Puma's conversational agent runtime. Wraps Google ADK's `LlmAgent` around an
Anthropic Claude backend with file-backed prompts, MCP-over-HTTP tool access,
session state, SSE streaming to chunk D's browser surface, and a layer-2
functional triage classifier that runs on a different (cheaper) model.

See the Tier 2 plan `planning/02-impl-agent-runtime.md` for the architecture
and `planning/03-exec-agent-runtime-*.md` (t1–t7) for per-task execution
briefs.

## Scripts

```bash
npm run dev                   -w @swoop/orchestrator   # tsx watch src/index.ts
npm run dev:stub-connector    -w @swoop/orchestrator   # tsx watch fixture connector
npm run build                 -w @swoop/orchestrator   # tsc → ./dist
npm run start                 -w @swoop/orchestrator   # node dist/index.js
npm run typecheck             -w @swoop/orchestrator   # tsc --noEmit
npm run test                  -w @swoop/orchestrator   # vitest run
```

## Running the hello-world smoke test

The M1 smoke test proves the end-to-end vertical slice: browser → orchestrator
(Sonnet) → tool call (stubbed connector) → layer-2 classifier (Haiku) →
SSE stream back to the caller. Run it manually with a real Anthropic key to
sanity-check behaviour before wiring chunk D's UI.

**Prerequisites**:

1. Create `product/orchestrator/.env` with at minimum:
   ```
   ANTHROPIC_API_KEY=sk-ant-…
   ```
   Optional: override `ORCHESTRATOR_MODEL`, `FUNCTIONAL_CLASSIFIER_MODEL`,
   `CONNECTOR_URL`. See `src/config/schema.ts` for the full surface.
2. `cd product && nvm use && npm install`.

**Runbook** (three terminals, all under `product/`):

```bash
# Terminal 1 — stub connector (MCP-over-HTTP) on :3001.
npm run dev:stub-connector -w @swoop/orchestrator

# Terminal 2 — orchestrator on :8080.
npm run dev -w @swoop/orchestrator

# Terminal 3 — drive a hello-world conversation.
SESSION_ID=$(curl -s -X POST http://localhost:8080/session | jq -r .sessionId)

curl -s -X PATCH "http://localhost:8080/session/$SESSION_ID/consent" \
  -H 'content-type: application/json' \
  -d '{"granted": true, "copyVersion": "v1"}' | jq .

curl -N -X POST http://localhost:8080/chat \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\",\"message\":\"Tell me about Patagonia\"}"
```

**Expected output**:

- Terminal 1 logs tool calls from the stub connector.
- Terminal 2 logs:
  - orchestrator model (e.g. `claude-sonnet-4-5-20250929`),
  - triage classifier model (e.g. `claude-haiku-4-5-20250929`),
  - per-turn `puma_triage_classifier classified turn (model=…)` — the
    two-layer agent model proof.
- Terminal 3 shows an SSE stream with:
  - one or more `data: {"type":"text", …}` frames,
  - at least one `data: {"type":"tool-call", …}` frame,
  - more text frames after the tool result,
  - a terminating `event: done` line.

**Teardown**: `Ctrl-C` each terminal; sessions are in-memory and evaporate
with the orchestrator process.

**Cost note**: A single hello-world turn costs roughly £0.01–£0.05 depending
on how much the orchestrator says. Do not loop this test; the integration
test under `src/__tests__/integration/hello-world.test.ts` is the
no-API-cost automated counterpart.

## Layout

```
src/
  config/               # env → frozen Config, per-agent model registry.
  agent/                # ADK LlmAgent factory + ClaudeLlm shim.
  connector/            # MCP-over-HTTP client + ADK FunctionTool adapters.
  functional-agents/    # Layer-2 agents (B.t7: triage-classifier.ts).
  session/              # SessionStore interface + in-memory / ADK-native /
                        # Vertex AI / Firestore adapters.
  translator/           # ADK event stream → @swoop/common MessagePart parts.
  server/               # Express handlers: /session, /consent, /chat (SSE).
  index.ts              # Startup wiring.
  __tests__/
    integration/        # Vertical-slice integration (B.t7 hello-world).
test-fixtures/
  stub-connector.ts     # MCP-over-HTTP fixture connector (not shipped).
```

## Two-layer agent model

The orchestrator is a single conversational `LlmAgent` running on Claude
Sonnet. Narrow, structured sub-tasks run in separate ADK agents on cheaper
models:

- **Layer 1 — orchestrator** (`src/agent/factory.ts`): Sonnet, long
  conversational context, full tool access, prompt from `cms/prompts/why.md`.
- **Layer 2 — triage classifier** (`src/functional-agents/triage-classifier.ts`):
  Haiku by default, one-shot, no tools. Runs before every `/chat` turn and
  writes an advisory verdict into `session.triage`. Replaced by the real
  triage flow when G.t0 (HITL flow-mapping) lands.

Models are resolved through `getModelFor(config, role)` from
`src/config/models.ts`. Roles today: `'orchestrator'`, `'classifier'`.
Adding more is a two-line registry change.
