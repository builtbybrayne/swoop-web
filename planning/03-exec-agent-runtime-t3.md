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

---

## B.t3a — connector adapter sunset (2026-05-02 execution log)

**Status**: ✅ done. Triggered by C.t4 landing the eight intent-named tools on the real `@swoop/connector` (`:3002`). Pre-this, the orchestrator's adapter still registered `search` + `get_detail` + `illustrate` + `handoff` + `handoff_submit` against the in-tree stub at `:3001`. B.t3a folded the librarian-shaped pair, swapped the wire to the real connector, and retired the stub.

### Six atomic commits

| Commit | Scope |
|---|---|
| `d697007` | `refactor(common)`: retire deprecated `Search*` / `GetDetail*` Zod schemas + types + `TOOL_NAMES.{Search,GetDetail}` + `TOOL_DESCRIPTIONS.{search,get_detail}`. |
| `f9e81f9` | `feat(orchestrator)`: register the 8 intent-named tools on the connector adapter. `TOOL_SPECS` becomes 8 rows; `createConnectorTools` accepts a `descriptions: ToolDescriptions` map; orchestrator entrypoint loads from CMS via `loadAllToolDescriptions` (re-exported from `@swoop/connector`). New config field `TOOLS_PROMPT_DIR` + derived `toolsPromptDirAbsolutePath`. |
| `d75df3f` | `feat(orchestrator)`: `CONNECTOR_URL` default `http://localhost:3001/mcp` → `http://localhost:3002/mcp`. Test fixtures pick up the new field. |
| `33ccd42` | `refactor(orchestrator)`: retire stub-connector test fixture (option a). Deletes `product/orchestrator/test-fixtures/stub-connector.ts` (~270 lines), drops the `dev:stub-connector` npm script, rewrites the README runbook around `npm run dev -w @swoop/connector`. |
| `30de639` | `chore(orchestrator,ui,common,harness)`: cross-cut sweep. UI workspace retires `SearchResultsWidget` + `ItemDetailWidget` + their tests + the brand-extension surface assertions for them; `widgets/index.ts` map drops the two entries; `parts/index.ts` docblock updated. Harness assertions / scenario test renames `searchCall` helper → `lookupCall` and `'search'` toolName fixtures → `'lookup'`. `@swoop/common` event sample fixtures (`SampleEventToolFailed` / `SampleEventUiWidgetRendered`) move off `search` to `lookup` / `illustrate`. Operator runbook `MCP_CONNECTOR_URL` typo → `CONNECTOR_URL`. |
| (this commit) | `docs(planning)`: B.t3a execution log + `progress.md` / `next-steps.md` / `discoveries.md` / `decisions.md` updates. |

### Decisions logged

- **B.t3a — Option (a) Retire** the stub at `product/orchestrator/test-fixtures/stub-connector.ts`, don't rewrite for the eight-tool surface.
  - **Rationale**: nothing in the test suite consumes the stub (the hello-world integration test stubs the ADK runner directly). Rewriting for 8 new tools would mean authoring fresh fixtures for 5 new derived schemas (passages / stories / proofs / chunks / cards) we'd never use. Carrying ~270 lines of dead code for a hypothetical future need is the wrong default.
  - **Reversibility**: low cost. Adding back a stub for a future test surface (e.g. for harness scenarios that need a fixture-backed connector without a live DB) is a one-file addition.

### Notable findings during execution

1. **The `@swoop/connector` description loader is the right place to own `loadAllToolDescriptions`.** B.t3a needs the same fail-fast contract on both sides of the wire (orchestrator + connector both load the same eight `cms/prompts/tools/<tool>/description.md` files at boot). Re-exporting the connector's loader keeps it as a single source of truth — the orchestrator already depends on `@swoop/connector` for `FsHandoffStore`, so the dep is paid for. Duplicating the loader inside the orchestrator would have invited drift.
2. **`as Config` casts in test fixtures had been masking config-shape drift.** Both `hello-world.test.ts` and `triage-classifier.test.ts` cast their fixture object to `Config` to bypass missing fields. Adding `TOOLS_PROMPT_DIR` / `toolsPromptDirAbsolutePath` could have silently been missing — typecheck wouldn't have flagged it. Fixed by populating both fields explicitly. Pattern to remember: when extending the `Config` type, grep for `as Config` and update every fixture in lockstep.
3. **The `claude-llm.test.ts` `'search'` placeholders are NOT a B.t3a concern.** That test exercises the Anthropic SDK shim's tool-schema serialisation; the tool name is opaque framework-level data. Distinguishing "tool surface concern" from "SDK shim concern" was the right discipline — leaving those references alone kept the diff minimal.

### Downstream what's now possible

- **D.t9** (UI widget rewrite for the five intent-named conversational tools) can begin. Boundary cleanly drawn:
  - The two retired widgets (`search-results.tsx`, `item-detail.tsx`) are gone.
  - `AttributeTable` survives in `product/ui/src/shared/` as a generic primitive D.t9's per-tool widgets will likely consume (e.g. trip cards in `find_options`).
  - Until D.t9 lands, Sonnet weaves the five tools' structured outputs directly into prose. Only `illustrate` and `handoff` carry visible widget renderers.
- **Live smoke testing post-B.t3a**: the orchestrator + connector now talk over real MCP-over-HTTP. The hello-world manual runbook in `product/orchestrator/README.md` is updated; running it requires a populated `puma_dev` (per C.t3 ETL CLI) plus a working `VOYAGE_API_KEY` in `product/connector/.env` for tools that compose embeddings.

### What B.t3a did NOT touch

- The 8 tool handlers in `@swoop/connector` (chunk-C territory).
- C.t6 vision pipeline / C.t3a enrichment / C.t3 ETL.
- D.t9 (UI widget rewrite for the five new conversational tools).
- The harness assertion-framework shape — only fixture tool-name strings updated, not the `tool_call` assertion semantics.

### Verification (fresh-install)

- All 6 workspaces green on fresh `npm install` + `npm test --workspaces --if-present`. **Total: 767 + 3 DB-gated skipped = 770/770.**
- Per-workspace deltas vs. pre-B.t3a baseline:
  - `@swoop/common`: 141/141 (unchanged).
  - `@swoop/orchestrator`: **160/160** (was 158; +2 from new TOOL_SPECS surface assertions).
  - `@swoop/connector`: 97/100 (3 DB-gated skips, unchanged — re-export added; no internal consumer).
  - `@swoop/ui`: **62/62** (was 71; **−9** from retired SearchResults + ItemDetail widget tests + 2 brand-extension cases — expected).
  - `@swoop/ingestion`: 233/233 (unchanged).
  - `@swoop/harness`: 74/74 (unchanged shape; renamed `searchCall` → `lookupCall`).
- Typecheck clean across all 5 buildable workspaces.
- `grep -rn 'SearchInput\|SearchOutput\|GetDetailInput\|GetDetailOutput' product/` returns 0 hits.
- Tool-list verification deferred to live smoke (requires populated `puma_dev`); the spec table in `connector/tools.ts` is the source of truth for what the orchestrator advertises.
