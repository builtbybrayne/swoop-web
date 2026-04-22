# 03 — Execution: B.t3 — Tool connector adapter

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: B (agent runtime).
**Task**: t3 — MCP-over-HTTP client adapter to chunk C's connector.
**Implements**: `planning/02-impl-agent-runtime.md` §2.3 + decisions B.1 (no bus) + B.4 (orchestrator calls tools).
**Depends on**: A.t2 (`tools.ts` schemas in `ts-common`), B.t1 (orchestrator exists).
**Produces**: `product/orchestrator/src/connector/` — MCP HTTP client wrapped as ADK-compatible tool handles, with Zod validation against `ts-common`.
**Unblocks**: B.t7 (vertical slice integration), anything downstream that wants the agent to call tools.
**Estimate**: 2–3 hours.

---

## Purpose

Give the ADK `LlmAgent` access to chunk C's connector tools — `search`, `get_detail`, `illustrate`, `handoff`, `handoff_submit` — over MCP-over-HTTP. For B.t7 (vertical slice), the connector can be stubbed; the adapter only cares that something speaks the MCP tool-call protocol at a URL.

---

## Deliverables

### `product/orchestrator/src/connector/`

| File | Role |
|---|---|
| `connector/client.ts` | MCP client (`@modelcontextprotocol/sdk` HTTP transport) pointing at `config.connectorUrl`. Exposes a `listTools()` + `callTool(name, args)` API. Handles MCP session lifecycle. |
| `connector/tools.ts` | Builds an ADK-compatible tool array from the client's tool list. Each tool validates inputs against the `ts-common` schema **before** making the HTTP call, and validates outputs **after**. Invalid input → tool returns a structured error (agent sees this and can retry / apologise). |
| `connector/retry.ts` | Simple exponential backoff wrapper — 3 retries, base 250ms, jitter. Applies only to transport-level failures (ECONNREFUSED, 5xx), not to tool-level errors (4xx, validation failures). |
| `connector/index.ts` | Factory: `createConnectorTools(config): ToolArray`. Used by the agent factory (B.t1) when constructing the `LlmAgent`. |

### Integration into `product/orchestrator/src/agent/factory.ts`

Update B.t1's factory to accept the connector tool array and pass it to `LlmAgent`. The agent now has real tool-calling capability.

### Config additions

```
CONNECTOR_URL=http://localhost:3001
CONNECTOR_REQUEST_TIMEOUT_MS=10000
```

Zod schema in `src/config/index.ts` validates the URL + timeout at startup.

### Tests

`connector/__tests__/tools.test.ts` — Vitest coverage: input validation rejects malformed args, output validation rejects malformed responses, retry wrapper retries on 5xx and doesn't retry on 4xx.

Mock the MCP client — don't hit a real connector in unit tests. B.t7's integration test covers the live round-trip.

---

## Key implementation notes

### 1. Tool descriptions come from `ts-common`

Carry `TOOL_DESCRIPTIONS` (authored in A.t2) into the ADK tool registration. These descriptions steer model behaviour — do not paraphrase them at the B.t3 layer.

### 2. MCP vs REST

Per chunk C's decision: MCP-over-HTTP via `@modelcontextprotocol/sdk` streamable HTTP. If the SDK's current version has a cleaner client API than the PoC used, adopt it. Don't port PoC code wholesale.

### 3. Input validation before HTTP call

Zod validates the args the LLM produced for the tool call, **before** any network I/O. This catches hallucinated fields early and keeps the connector's error space small.

### 4. Output validation after HTTP response

Zod validates what the connector returned, **before** passing to the agent. Protects the agent's turn from schema drift on the connector side.

### 5. Retry policy is deliberate

Retries on network failures only. Do not retry on tool-level 4xx errors — those are the connector saying "your input was bad"; retrying doesn't help.

### 6. No tool discovery caching for now

Call `listTools()` on every startup; skip runtime re-discovery. Simpler. Chunk C's connector is stable at startup — if it changes tools at runtime, we revisit.

### 7. Timeout

Per-tool-call timeout of ~10s. Too long breaks conversational feel; too short causes false negatives. Tunable via config.

---

## References

- `@modelcontextprotocol/sdk` docs — verify current HTTP client API.
- `chatgpt_poc/product/ts-common/src/tools.ts` — the `TOOL_DESCRIPTIONS` pattern.
- `chatgpt_poc/product/mcp-ts/src/index.ts` — PoC MCP transport setup (connector side, not client side).

---

## Verification

1. With chunk C's connector running (or a stub that registers tool names and returns fixture responses), starting the orchestrator logs the discovered tool list.
2. An agent that's prompted to call a tool successfully calls it — the tool's response comes back, the agent consumes it.
3. Malformed tool args (e.g. missing required field) produce a structured error the agent can see, **not** an unhandled exception.
4. A simulated 500 from the connector → 3 retries, then a clean error bubbled to the agent.
5. A 400 from the connector → no retries.
6. `grep -r "console.log" product/orchestrator/src/connector/` — returns only intentional dev-mode logs; no stray debugging `console.log`.

---

## Handoff notes

- The connector may not be ready when this task runs. Stub it with a minimal Express server that registers the Puma tool names and returns fixtures from `@swoop/common/fixtures`. This keeps B.t3 unblocked.
- Do not duplicate the retry policy logic anywhere else — retries live in `connector/retry.ts` only.
- Skill loading (B.t9) is a separate mechanism — ADK-native skill primitive, **not** a connector tool call. Don't implement skill loading here.
