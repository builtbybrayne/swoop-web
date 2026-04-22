# 03 — Execution: B.t1 — Orchestrator skeleton + prompt loader

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: B (agent runtime).
**Task**: t1 — orchestrator skeleton + prompt loader.
**Implements**: `planning/02-impl-agent-runtime.md` §2.1 + §2.2 + §2.7 (config).
**Depends on**: A.t1–A.t4 (workspace + empty `@swoop/orchestrator` package).
**Produces**: `product/orchestrator/` — ADK `LlmAgent` scaffold, Claude Sonnet provider config, file-backed system-prompt loader, readiness probe. No tools yet (B.t3). No session (B.t2). No SSE (B.t5).
**Unblocks**: B.t3 onward (each step hangs off a live agent skeleton).
**Estimate**: 2–3 hours.

---

## Purpose

Stand up a minimum-viable ADK orchestrator: an `LlmAgent` wired to a Claude Sonnet provider via ADK's provider abstraction, loading the WHY system prompt from `product/cms/prompts/why.md` at startup. No tools, no session persistence, no streaming endpoint yet — those land in subsequent task slices. The goal is a service that starts, loads its prompt, and can be introspected via a readiness probe.

---

## Deliverables

### `product/orchestrator/` files

| File | Role |
|---|---|
| `product/orchestrator/package.json` | Add runtime deps: `@google/adk` (version TBC — verify current stable), `@anthropic-ai/sdk` (if ADK's Claude provider requires it as a peer), `express`, `dotenv`. Dev deps: `tsx`, `vitest`, `@types/express`. Scripts: `dev` (tsx watch src/index.ts), `build` (tsc), `start` (node dist/index.js), `typecheck`. |
| `product/orchestrator/src/index.ts` | Entry point. Loads config, initialises the agent factory, starts Express with just a `/healthz` route for now. |
| `product/orchestrator/src/agent/factory.ts` | Builds the ADK `LlmAgent`: model config, system-prompt injection, empty tools array (populated by B.t3). Returns the agent. |
| `product/orchestrator/src/agent/prompt-loader.ts` | Reads `product/cms/prompts/why.md` from disk, returns its string content. Caches in memory. Hot-reload for dev — recompute on each request when `NODE_ENV !== 'production'`. Config drives the file path. |
| `product/orchestrator/src/config/index.ts` | Central config module. Reads env vars; validates shape against a Zod schema; exports a typed `config` object. See B.t6 for the full surface; B.t1 covers only: `ANTHROPIC_API_KEY` (required), `PRIMARY_MODEL` (default `"claude-sonnet-4-5"` or current), `SYSTEM_PROMPT_PATH` (default `"../cms/prompts/why.md"` relative to package root), `PORT` (default `8080`). |
| `product/orchestrator/.env.example` | Committed template. No real keys. |
| `product/orchestrator/Dockerfile` | Minimal Cloud Run-ready Node 20 image. Build stage: `npm ci` + `npm run build`. Runtime stage: copy `dist/` + `node_modules/` + start. Non-root user. Skip if it adds complexity; revisit at M4. Leaving this out initially is fine. |
| `product/orchestrator/STREAM.md` | Updated from A.t4 placeholder: `Status: active`, `Current task: B.t1 orchestrator skeleton`, `Blockers: none`, `Last updated: <date>`. |

### Placeholder system prompt

If `product/cms/prompts/why.md` doesn't exist yet (chunk G.t1 authors the real version), create a placeholder: a 4–6 line minimal prompt — "You are Puma, a Swoop Adventures conversational guide for Patagonia travel. Warm, adventurous, knowledgeable. Do not build itineraries or quote authoritative prices." — marked clearly as a placeholder. Chunk G.t1 overwrites this.

Placeholder lives at `product/cms/prompts/why.md`. Chunk G.t1 agent is expected to replace it.

---

## Key implementation notes

### 1. ADK provider abstraction

Use ADK's provider abstraction to configure Claude Sonnet. The exact API shape (`LlmAgent` constructor args, provider field naming) depends on the current ADK release — **verify at implementation time**. Don't rely on pre-session research docs that may be stale.

### 2. System prompt as a single file

`why.md` is read as a flat string. No templating at this stage. Modular guidance ("skills") is separate — loaded via ADK-native primitive in B.t9, not inlined into the WHY prompt.

### 3. No system prompt content here

B.t1 creates a placeholder prompt file to unblock agent instantiation. **Do not draft the real system prompt** — that's chunk G.t1's job.

### 4. No tools

The agent's tool array is empty. The agent will reject any tool-requiring behaviour at runtime, but B.t1 doesn't test that — B.t3 adds tools.

### 5. Config validation at startup

Zod schema validates `config` — missing `ANTHROPIC_API_KEY` → clean fatal exit with a readable error, not an opaque crash mid-request. Fail fast at startup.

### 6. Healthz endpoint

`GET /healthz` returns `{"status":"ok","service":"orchestrator","version":"..."}` with the package version from `package.json`. Minimal, non-auth'd. Cloud Run uses this for readiness probes post-M4.

### 7. `/chat` endpoint — NOT in this task

The SSE chat endpoint is B.t5. Don't add it here.

---

## References

- ADK (`@google/adk`) docs — verify current `LlmAgent` API.
- `chatgpt_poc/product/mcp-ts/src/index.ts` — Express-bootstrap pattern reference.
- `planning/02-impl-agent-runtime.md` §2.1 for two-layer model context; B.t1 is layer 1 (orchestrator) only.

---

## Verification

1. `cd product && npm install` resolves the new deps cleanly.
2. `cd product && npm run dev -w @swoop/orchestrator` starts the service on port 8080.
3. `curl http://localhost:8080/healthz` returns `{"status":"ok",...}`.
4. Startup logs include: "orchestrator ready", "system prompt loaded from <path>", "model: <primary model name>".
5. Remove `ANTHROPIC_API_KEY` from `.env` → service exits with a readable error on startup, not an opaque crash.
6. Replace `why.md` contents while the service is running (dev mode) → next request sees the new contents (hot reload works in dev, caching works in prod).
7. Zero warnings about unknown ADK APIs during TS compile — if ADK's types don't match what B.t1 expects, that's a signal the provider API has evolved; surface it immediately.

---

## Handoff notes

- **Do not add tools** — that's B.t3.
- **Do not add session state** — that's B.t2.
- **Do not add SSE** — that's B.t5.
- **Do not write the real system prompt** — placeholder only; G.t1 owns real content.
- If ADK's current API materially diverges from what Tier 2 B assumed, flag it immediately and raise a PR against `planning/02-impl-agent-runtime.md` before implementing a workaround.
