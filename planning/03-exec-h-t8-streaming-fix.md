# 03-exec-h-t8-streaming-fix.md — Per-event streaming observability for harness runs

**Status**: DRAFT v2 — for HITL review (2026-05-18). Not yet executable.
**Supersedes**: v1 of this plan (per-scenario-completion streaming) — Alastair flagged that's still too coarse. *"Literally, on each submit and each response. Stream to disk IMMEDIATELY the data is available."*
**Implements**: per-event harness observability — every observable signal (user turn submit, every SSE frame from orchestrator, every tool call + result, every widget payload, every Anthropic call to user-agent/stop-judge/judge, timeouts, errors) is appended to a per-scenario JSONL log the instant it's available.
**Pairs with**: [03-exec-h-t8.md — H.t8 conversational validator harness](03-exec-h-t8.md).

---

## ★ Read this first — what's broken

Today's harness has two layers of write-deferral:

1. **CLI layer**: `cli.ts` writes `results.md` + `results.json` only AFTER the for-loop completes. Kill mid-run → everything in memory is lost.
2. **Runner layer**: `runScenario()` accumulates the full conversation into a `ScenarioResult` object and returns it only after the scenario terminates. Even per-scenario-completion writes would still lose the in-flight transcript of a scenario that crashes/times out partway through.

A 37-scenario run today was killed at scenario 28; 28 scenarios' worth of transcripts unrecoverable. Among those 28 were ERRORs (turn timeouts) — exactly the scenarios where the IN-FLIGHT transcript would have been most diagnostically valuable, because the error happened AT the long turn that timed out. We have nothing to look at.

Alastair: *"This needs fixing before we waste any more tokens on re-runs."* Agreed.

---

## Goal

For every harness run, produce a **per-scenario JSONL log** under `runs/<report-dir>/scenarios/<name>.jsonl` that contains every observable event — appended synchronously the instant the event happens. A scenario killed mid-turn leaves a fully-readable log of everything that happened up to the kill point.

Plus an incrementally-updated `results.md` + `results.json` rollup at the top level, as v1 planned.

---

## Architecture

### Event model

A `HarnessEvent` discriminated union covering every observable signal:

| Kind | When emitted | Payload |
|---|---|---|
| `scenario.started` | runScenario entry | `{name, file, scenarioShape: 'scripted' \| 'agent', userAgentSpec?}` |
| `session.created` | after orchestrator POST /session returns | `{sessionId, disclosureCopyVersion}` |
| `consent.granted` | after orchestrator PATCH /session/:id/consent returns | `{sessionId, copyVersion}` |
| `user_agent.invoked` | before Anthropic call to generate user turn | `{turn, persona, goal, transcriptSoFar, model}` |
| `user_agent.responded` | after Anthropic call to generate user turn | `{turn, message, durationMs, anthropicRaw}` |
| `user.message.sent` | just before orchestrator POST /chat | `{turn, sessionId, message}` |
| `agent.sse.frame` | EACH SSE frame parsed from /chat stream | `{turn, frameEvent, frameData, partType?, text?, toolName?, toolInput?, fyiData?}` |
| `agent.response.aggregated` | after SSE stream ends or aborts | `{turn, utterText, toolCalls, structure, rawParts, durationMs, abortReason?}` |
| `stop_judge.invoked` | before Haiku call | `{turn, model, transcriptSoFar, latestAgentResponse}` |
| `stop_judge.responded` | after Haiku call | `{turn, shouldStop, anthropicRaw, durationMs}` |
| `assertion.evaluated` | per assertion handler | `{kind, passed, reason}` |
| `judge.invoked` | before SonnetJudge call (for judge_rubric assertions) | `{rubric, finalUtterance, model}` |
| `judge.responded` | after SonnetJudge call | `{passed, reasoning, anthropicRaw, durationMs}` |
| `error` | any thrown error caught in runScenario | `{message, stack, phase}` |
| `timeout` | any awaited operation that hits its timeout | `{phase, timeoutMs}` |
| `scenario.completed` | runScenario exit (success or failure) | `{status, durationMs, summary}` |

Every event includes: `{ts: ISO-8601 string, scenarioName, turnIndex?}` envelope.

**JSONL**: one event per line, newline-delimited, JSON-encoded. Append-only safe (no closing bracket; any tail of the file is valid until the last partial line). Standard format; any text editor + `jq` reads it.

### Event sink

Define `EventSink` interface:
```typescript
interface EventSink {
  emit(event: HarnessEvent): void;  // sync; no Promise return
}
```

Two implementations:
- `NullEventSink` — for tests and as a default. Drops events. (Keeps the harness runnable without a file path.)
- `FileEventSink(path: string)` — appends each event to the given path via `appendFileSync(path, JSON.stringify(event) + '\n', 'utf8')`. Sync write; OS-page-cache-durable; ~50µs per call. No fsync needed (process-crash-safe; only loses on OS panic / power failure, fine for our use case).

`appendFileSync` per event — not a held write stream — because: zero state, no flushing concerns, no stale handles, idempotent if file is rotated/deleted out from under us.

### Plumbing points

Each existing component gets a `sink: EventSink` injected via deps:

| File | Emits |
|---|---|
| `runner.ts` (`runScenario`) | `scenario.started`, `session.created`, `consent.granted`, `user.message.sent` (per turn), `scenario.completed`, `error`, `timeout` |
| `orchestrator-client.ts` (`OrchestratorClient.sendMessage` / `consumeSseStream`) | `agent.sse.frame` (per frame), `agent.response.aggregated`, `timeout` |
| `user-agent.ts` (`UserAgent.generate`) | `user_agent.invoked`, `user_agent.responded` |
| `stop-judge.ts` (`shouldStop`) | `stop_judge.invoked`, `stop_judge.responded` |
| `sonnet-judge.ts` (`SonnetJudge.evaluate`) | `judge.invoked`, `judge.responded` |
| `assertions.ts` (`evaluateAll`) | `assertion.evaluated` (per assertion) |

Each component gets the sink via its constructor / deps argument. The CLI wires a `FileEventSink` per scenario.

### Per-scenario lifecycle

```
1. CLI for-loop entry → construct FileEventSink(path: runs/<dir>/scenarios/<name>.jsonl).
2. Pass sink to runScenario(loaded, {client, judge, events, agentRuntime, sink}).
3. Every component emits events as they happen → appended to file synchronously.
4. On runScenario completion (success or kill), write scenarios/<name>.json (the structured summary, same as today's per-scenario ScenarioResult).
5. Rewrite runs/<dir>/results.md + results.json (rollup of results-so-far).
```

If the process is killed at any point inside step 3, the JSONL file already contains every event up to the kill point. Inspect with `cat runs/<dir>/scenarios/<name>.jsonl | jq .` to see exactly what happened.

### Directory shape after a run

```
runs/<report-dir>/
├── results.md                       ← rollup; updated after each scenario completes
├── results.json                     ← same
└── scenarios/
    ├── dreamer-pure-curiosity.jsonl ← APPENDED per event; every signal in chronological order
    ├── dreamer-pure-curiosity.json  ← structured summary; written on scenario completion
    ├── dreamer-post-life-event.jsonl
    ├── dreamer-post-life-event.json
    └── …
```

A killed run leaves: every `.jsonl` for everything that started, full event detail. The `.json` summary only exists for scenarios that fully completed. The rollup files reflect the last completed scenario.

---

## Tasks

Bite-sized per the [superpowers:writing-plans skill](../../.claude/skills/writing-plans). Estimated total: **1.5-2.5 hours**. Bigger than v1; this is a real observability pass through the harness.

### Task 1 — Define HarnessEvent + EventSink

**Files (new):**
- `product/harness/src/events.ts` — discriminated union of HarnessEvent kinds + EventSink interface + NullEventSink + FileEventSink + helper builders (one per kind, for type-safety at call sites).

**Step 1.1**: Author the type. Each kind is a `z.object({...})` (or plain TS interface — Zod is overkill for internal-only types; pick TS interfaces for speed).

**Step 1.2**: Implement `NullEventSink` (no-op) + `FileEventSink` (appendFileSync + JSON.stringify + '\n').

**Step 1.3**: Author tests in `__tests__/events.test.ts`:
- NullEventSink swallows events.
- FileEventSink writes one JSON line per emit; lines are independently parseable.
- FileEventSink appends; multiple emits all show up in order.
- A non-existent parent directory throws (no auto-mkdir; that's the CLI's job).

**Step 1.4**: Commit.
```sh
git commit -m "feat(harness): event types + EventSink interface + file/null impls"
```

### Task 2 — Plumb sink through OrchestratorClient

**Files:**
- Modify: `product/harness/src/orchestrator-client.ts` — accept `sink?: EventSink` in constructor; emit `agent.sse.frame` per frame in `consumeSseStream`; emit `agent.response.aggregated` after stream ends; emit `timeout` on abort.

**Step 2.1**: Failing test — `sendMessage` against a mock fetch with a 3-frame SSE response emits 3 `agent.sse.frame` events + 1 `agent.response.aggregated`.

**Step 2.2**: Implement — pass sink through constructor; refactor `consumeSseStream` to take sink; emit per frame; emit aggregate on done; emit timeout on abort.

**Step 2.3**: Existing OrchestratorClient tests must still pass with default `NullEventSink`.

**Step 2.4**: Commit.

### Task 3 — Plumb sink through UserAgent + StopJudge + SonnetJudge

**Files:**
- Modify: `product/harness/src/user-agent.ts` — accept `sink?: EventSink`; emit `user_agent.invoked` before Anthropic call, `user_agent.responded` after (with raw Anthropic response).
- Modify: `product/harness/src/stop-judge.ts` — same pattern, emit `stop_judge.invoked` + `stop_judge.responded`.
- Modify: `product/harness/src/sonnet-judge.ts` — same pattern, emit `judge.invoked` + `judge.responded`.

**Step 3.1-3.6**: Tests + impl per component. Same pattern as Task 2.

**Step 3.7**: Commit (one per component, three commits total).

### Task 4 — Plumb sink through runScenario + assertions

**Files:**
- Modify: `product/harness/src/runner.ts` — accept `sink?: EventSink` in deps; emit lifecycle events (`scenario.started`, `session.created`, `consent.granted`, `user.message.sent`, `scenario.completed`, `error`); thread sink to dep-injected components (client/judge/userAgent/stopJudge).
- Modify: `product/harness/src/assertions.ts` — `evaluateAll` accepts `sink?: EventSink`; emit `assertion.evaluated` per assertion handler.

**Step 4.1**: Failing test — `runScenario` against mocked deps emits the full lifecycle event sequence in order.

**Step 4.2**: Implement plumbing. Sink defaults to NullEventSink so existing tests don't need to pass it.

**Step 4.3**: Existing runner + assertion tests still pass.

**Step 4.4**: Commit.

### Task 5 — Wire FileEventSink per scenario in cli.ts

**Files:**
- Modify: `product/harness/src/cli.ts` — create `outDir` + `outDir/scenarios/` BEFORE the for-loop; per iteration: construct FileEventSink at path `outDir/scenarios/<name>.jsonl`, pass to runScenario via deps; write `outDir/scenarios/<name>.json` (structured summary) on completion; rewrite `outDir/results.md` + `results.json` (rollup); remove post-loop write block.

**Step 5.1**: Refactor `main()` to extract a `runHarness({args, scenarios, deps, outDir})` for testability.

**Step 5.2**: Implement per-scenario sink construction + the per-iteration disk writes.

**Step 5.3**: Tests in `__tests__/cli-streaming.test.ts`:
- After running 2 mock scenarios via runHarness, each `<name>.jsonl` exists and contains lifecycle events.
- Mid-run kill simulation (mocked runScenario throws on scenario 2): scenario 1's `.json` + `.jsonl` exist on disk after the throw; scenario 2's `.jsonl` exists with events up to the throw point + an `error` event.
- Rollup `results.md` updated after each scenario.

**Step 5.4**: Commit.

### Task 6 — Live smoke against the running orchestrator

The validator orchestrator (`:8081`) + connector (`:3003`) are still up. Reuse.

**Step 6.1**: Run a single short scenario:
```sh
cd /Users/al/Studio/projects/swoop_web/.claude/worktrees/validator-harness/product && \
  set -a && source orchestrator/.env && set +a && \
  cd harness && \
  npm run eval -- --filter "skeptic-ai-suspicious" --base-url http://localhost:8081 \
    --report-dir 2026-05-18-streaming-smoke
```

While it runs (~30-60s), watch the JSONL file grow:
```sh
tail -f runs/2026-05-18-streaming-smoke/scenarios/skeptic-ai-suspicious.jsonl | jq .
```

Expected: events appear in real-time as they happen. Each `agent.sse.frame` lands as the frame arrives over the wire.

**Step 6.2**: Mid-run kill smoke — start a 2-scenario run, kill it during scenario 2's middle turn. Verify scenario 2's `.jsonl` contains every event up to the kill point including the latest `agent.sse.frame` events.

**Step 6.3**: Inspect the JSONL by hand — does it tell a complete, readable story of what happened?

### Task 8 — Bump per-turn timeout + make configurable

**File**: `product/harness/src/orchestrator-client.ts`

**Step 8.1**: Change the default `turnTimeoutMs` from `60_000` to `180_000` (3 minutes). Longer turns happen — Dreamer-pure-curiosity took 35s/turn baseline; a 6-turn scenario with one slow turn can easily push past 60s. 180s leaves headroom.

**Step 8.2**: Surface as a CLI flag in `cli.ts` — `--turn-timeout-ms <n>` (default 180000). Pass through to `OrchestratorClient` constructor.

**Step 8.3**: Tests — verify the constructor honours the passed-in timeout; CLI test verifies the flag parses correctly.

**Step 8.4**: Commit.
```sh
git commit -m "fix(harness): bump per-turn timeout 60s → 180s + --turn-timeout-ms flag"
```

### Task 7 — Discoveries entry

**File**: `discoveries.md` (current worktree, will merge to main eventually)

One-paragraph note: "2026-05-18 — Harness now streams every observable event to per-scenario JSONL the instant it happens. Surfaced when a 37-scenario validator run was killed at scenario 28; all completed transcripts AND all in-flight detail were unrecoverable because writes happened only at end-of-loop. Fixed in [03-exec-h-t8-streaming-fix.md](planning/03-exec-h-t8-streaming-fix.md) — per-event observability via `runs/<dir>/scenarios/<name>.jsonl` (append-only JSONL, sync writes, OS-page-cache-durable)."

**Step 7.1**: Append to discoveries.md, commit.

---

## Verification

```sh
rm -rf product/node_modules && npm install
npm test --workspace=@swoop/harness
npm run typecheck --workspace=@swoop/harness
```

**Acceptance**:
1. All existing harness tests still pass (with default NullEventSink).
2. New events / sink / streaming tests pass.
3. Live smoke: JSONL grows visibly via `tail -f` during a real scenario; mid-run kill leaves a fully-readable JSONL up to the kill point.
4. The JSONL of one scenario read end-to-end tells a complete narrative — every signal accounted for, in order, with timestamps.

---

## Open questions for HITL

1. **Raw Anthropic responses in events**: include the full `messages.create` response (`{id, model, content, stop_reason, usage}`) in `user_agent.responded` / `judge.responded` / `stop_judge.responded`? **Recommendation: YES — Alastair said "RAW and EVERYTHING"; that means the wire response too.** Costs ~3KB per event but disk is cheap and we want to be able to forensic-diagnose any judge or user-agent oddity.
2. **`agent.sse.frame` includes the raw frame data string**: yes (per Alastair's "raw and everything"). Also include the parsed-out fields (partType, text, etc.) for convenience. Doubles the payload size per frame; acceptable.
3. **Connector tool-call result envelope** (the `{ok, value}` shape returned by the connector and consumed by widgets): emit as part of the `agent.sse.frame` event when frame is a tool-call. Widgets render off this envelope; we already capture it in the aggregated structure. **Question**: should we ALSO emit a separate `widget.rendered` event for clarity? **Recommendation: NO** — the harness doesn't render widgets (no DOM); a `widget.rendered` event would be a lie. Tool-call args + results in the SSE frame cover what's available.
4. **JSONL vs JSON-array vs Protobuf-text**: JSONL recommended (append-safe, line-oriented, `jq`-friendly). The other two add complexity for no real benefit at our scale.
5. **Per-scenario file naming**: `scenarios/<scenario-name>.jsonl` (slug-based) — matches scenario YAML filenames. Confirmed.

---

## What this plan deliberately does NOT do

- ~~Doesn't fix the per-turn 60s timeout~~ — Alastair ratified 2026-05-18 to bundle the timeout fix as **Task 8** below. Streaming makes the timeout DEBUGGABLE, the bump makes it bite less often.
- **Doesn't add new assertion kinds or schema changes.** Pure observability addition.
- **Doesn't add a real-time tail viewer** (e.g., a web dashboard). `tail -f scenarios/<name>.jsonl | jq` is the v1 interface. Fancier later if real friction surfaces.
- **Doesn't backport observability into the legacy scripted scenario path** beyond the shared `runner.ts` lifecycle events. The user-agent / stop-judge events naturally only fire on agent-scenario paths. Scripted scenarios get scenario+session+turn-level events, just not the user-agent ones. That's correct.

---

## Estimated effort

1.5-2.5 hours sequential. Bigger than v1 (which was 15-30 min) but proportional to the scope expansion from per-scenario to per-event. Worth it — once landed, every future harness run is forensically inspectable.

Could be parallelised across 3 sub-agents:
- Agent A: Task 1 + Task 2 (events module + OrchestratorClient plumbing)
- Agent B: Task 3 + Task 4 (UserAgent/StopJudge/SonnetJudge + runner/assertions)
- Agent C: Task 5 + Task 6 + Task 7 (CLI integration + live smoke + discoveries) — depends on A+B landing

But given the per-event-streaming insight is mine + your feedback, and the codebase is small, **executing sequentially in this session** (no sub-agent dispatch) is the lower-friction choice. ~2 hours wall-clock. You can interrupt + correct mid-flight.

---

## HITL ratification appendix

**Status**: RATIFIED 2026-05-18.

**Directives**:
- v2 plan (per-event streaming) ratified.
- **Task 8 added** — bundle the per-turn timeout fix in this pass. "Longer timeouts acceptable for now" → bump default to 180s + make configurable.
- Execute sequentially in this session (~2hr). Alastair available to interrupt + correct mid-flight.
- Open question 1 (raw Anthropic responses in events): YES per "RAW and EVERYTHING".
- Open questions 2-5: recommendations accepted.

**Decision IDs**: to be assigned at merge (likely `H.28` for the streaming + `H.29` for the timeout).

**Go-ahead**: ✅

---

## 2026-05-18 Execution log

> *Executing agent (or session orchestrator) fills in: commits, test deltas, smoke results.*

(empty until execution starts)
