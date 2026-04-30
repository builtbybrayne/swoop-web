# 03 — Execution: B.t7 — Vertical-slice integration

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: B (agent runtime).
**Task**: t7 — wire B.t1–t6 + a minimal functional internal agent to prove the two-layer model.
**Implements**: `planning/02-impl-agent-runtime.md` §2.1 (two-layer) + §1 outcomes + top-level M1 milestone.
**Depends on**: B.t1–t6 all landed.
**Produces**: A working orchestrator that completes a full round-trip from chunk D's browser → agent → stubbed connector tool → response → SSE → browser. One functional internal agent behind one tool exists, running on a different model from the orchestrator.
**Unblocks**: M1 (hello-world end-to-end).
**Estimate**: 2–3 hours.

---

## Purpose

B.t7 is the integration hop. Each preceding task landed a piece in isolation; this task connects them and proves the story. Specifically: show the two-layer agent model actually works — the orchestrator calls a tool; that tool internally runs a functional ADK agent with a different model; returns a result; conversation continues.

---

## Deliverables

### Functional agent behind a tool

Choose one existing tool and give it a layer-2 agent. Candidate: `search` where a classifier decides which filter dimensions to apply based on the user's natural-language query. Or: a "user-type classifier" that runs before `search` and tags the session with `triage` state. B.t7 picks the simpler of the two at implementation time.

Implementation path:
- Layer-2 agent lives in `product/orchestrator/src/functional-agents/<role>.ts` (or in `product/connector/` if the functional agent belongs to the connector's domain — depends on which tool it's behind).
- It uses ADK's runner with a cheaper model (`getModelFor(<role>)`).
- Returns a structured output (Zod-validated) that the orchestrator tool uses to drive its response.

### Integration wiring

- Agent factory (B.t1) consumes connector tools (B.t3).
- Translator (B.t4) receives agent events.
- SSE endpoint (B.t5) drives the turn.
- Session (B.t2) accumulates history.
- Config (B.t6) drives model + connector URL.

### End-to-end test

`product/orchestrator/src/__tests__/integration/hello-world.test.ts`:
- Spin up the full orchestrator in-process (no HTTP — test the application object directly).
- Stub the connector to return fixture responses for the one real tool in play.
- Send a synthetic user message.
- Verify: response streams, at least one tool call happens, functional internal agent runs with the expected model, session state accumulates correctly.

### Local smoke-test runbook

`product/orchestrator/README.md` section: "Running the hello-world smoke test". Commands:
```
cd product
npm run dev -w @swoop/orchestrator      # terminal 1
# terminal 2:
curl -X POST http://localhost:8080/session | jq .
# use the sessionId:
curl -X PATCH http://localhost:8080/session/<id>/consent -d '{...}' -H 'content-type: application/json'
curl -N -X POST http://localhost:8080/chat -d '{"sessionId":"<id>","message":"Tell me about Patagonia"}' -H 'content-type: application/json'
```

Expected output: SSE stream with text parts, a tool-call part, more text parts, stream end.

---

## Key implementation notes

### 1. Pick the simpler functional agent to start

If the search-side classifier is hard to wire cleanly against a stubbed connector, pick the pre-turn triage classifier instead — that one sits purely inside the orchestrator and is easier to test. Either proves the two-layer shape.

### 2. Stub the connector

B.t7 doesn't wait for real chunk C. Stub the connector as a minimal Express server registering the Puma tool names and returning fixtures from `@swoop/common/fixtures`. Live in `product/orchestrator/test-fixtures/stub-connector.ts` so it's obviously not production code.

### 3. Real agent, real ADK runner

The layer-1 and layer-2 agents must both actually run via ADK — this is the proof. Don't fake it.

### 4. Real Claude API

This task makes real Claude API calls. Use a dev API key. Log the cost of the hello-world test to sanity-check Puma's running costs match the 30 Mar proposal's estimate (~£0.05–£0.25 per conversation).

### 5. Content-as-data smoke

Verify the placeholder system prompt from B.t1 actually gets into the Claude request — grep the request payload for a substring of the prompt. Don't trust inspection alone; assert in the test.

### 6. Observability is out of scope

Chunk F hasn't landed yet. B.t7 uses `console.log` temporarily where diagnostics are useful; once F's `emitEvent` helper exists, B.t7's code switches over.

---

## References

- `planning/02-impl-agent-runtime.md` §2.1 (two-layer) + §9 verification 6 (per-agent model selection).
- Top-level M1 definition.

---

## Verification

1. Hello-world smoke test passes end-to-end (runbook above).
2. Integration test passes.
3. Test logs show: orchestrator loaded system prompt; orchestrator called one tool; that tool's functional agent ran with a different model from the orchestrator (assert on model name).
4. Session state after the turn has: tier-1 consent granted, one turn's conversation history (user + agent), any triage state the classifier set.
5. Running the curl sequence shows a plausible Claude-generated response about Patagonia, not gibberish. Subjective check; doesn't need to be brilliant.
6. `npm run typecheck` + `npm run lint` + `npm run test -w @swoop/orchestrator` all green.

---

## Handoff notes

- This is the M1 gate from B's side. When this task passes, B is ready to fan out with C / D / E in Phase 2.
- Do not add the response-format parser here if B.t4's spike said "not needed" — the agent outputs raw text + tool calls.
- Real Claude API calls cost money — be mindful; don't leave integration tests on a loop.
- `<reasoning>` behaviour isn't tested here (the placeholder prompt doesn't exercise it). Add reasoning-specific tests when G.t1's real prompt lands.

---

## 2026-04-30 code-review fixes

Source: [planning/reviews/2026-04-30-code-level.md](reviews/2026-04-30-code-level.md). Status legend: 🔲 not started · 🟡 in flight · ✅ landed.

### Perf-2 — Triage classifier blocks SSE turn serially — 🔲 [DEFERRED-STRATEGIC]

**Problem**: `chat.ts:137-180` awaits `triageClassifier.classify(...)` BEFORE `res.flushHeaders()` at `:189` and the heartbeat starts at `:191`. User's first SSE byte cannot arrive until Haiku has fully responded. The classifier verdict is *advisory only* (`triage-classifier.ts:14-17`, `chat.ts:131-135`), so it could run concurrently with the orchestrator turn (verdict landing on `session.triage` for the *next* turn) or fired-and-forgotten. Single biggest p50 latency cliff in the loop per the agent-loop trace.

**Fix shape (deferred — design decision required)**: two viable directions:
- (a) **Concurrent**: `Promise.all([triageClassifier.classify(...), runner.runAsync(...)])`. Verdict lands on `session.triage` between turns, available for the NEXT turn's tool-decision logic. Requires confirming nothing in the current orchestrator turn reads the just-computed verdict.
- (b) **Fire-and-forget**: detach the classify call entirely; persist verdict on completion via `store.update`. Same semantic as (a) but with explicit non-blocking framing; pairs with R2's per-session mutex to avoid lost-update.

Either change is bigger than a quick win and embeds a design call about whether the orchestrator's current turn ever reads `session.triage` (it doesn't today, but G.t0 may want it). **Defer until G.t0 lands the real classifier prompt** — at which point the design question is concrete.

**Verification**: when actioned, latency benchmark on a 5-turn conversation showing TTFB drops by Haiku-call latency.

**Commits**: _(deferred — revisit after G.t0)_

### Perf-3 — Skip triage on turn 1 (cheap interim win) — 🔲

**Problem**: `chat.ts:137` `if (deps.triageClassifier) { ... }` has no gate on `userTurnIndex` or message length. `triage-classifier.ts:215-218` always slices `priorUserTurns.slice(-2)` even when the array is empty. Today's classifier is a placeholder pending G.t0; running it on turn 1 (typically a one-line greeting) produces no behaviour change but pays Haiku TTFB on every first impression.

**Fix shape**: gate on `userTurnIndex > 0` OR `message.length > N` in `chat.ts`. ~3 lines. Independent of Perf-2 (and serves as the half-measure if Perf-2 stays deferred).

**Verification**: route test asserts no Haiku call on turn 1 (`triageClassifier.classify` not invoked).

**Commits**: _(landed: filled when done)_
