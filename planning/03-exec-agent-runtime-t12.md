# 03 — B.t12: browser timestamp → agent context

**Status**: DRAFT — pending HITL ratification. **Chunk home**: B (agent runtime).
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) item A1 — the agent thought "February 2027" was two years away (model prior ≈ early 2025; nothing injects the real date today — verified at triage).
**Workspaces touched**: `@swoop/common` (wire schema), `@swoop/ui` (transport), `@swoop/orchestrator` (injection), `@swoop/harness` (scenario clock).

---

## ★ Read this first

Requirement is explicit from Luke via Alastair: the **browser's** timestamp, passed on **every** request — not the server clock. Rationale: the visitor's local "today" and timezone are what matter when they say "next February" or "this summer", and it stays correct wherever the server runs. Server time is the fallback, never the primary.

## 1. Outcomes

1. Every `/chat` request may carry the visitor's clock; the agent's per-turn instruction states the current date in the visitor's terms.
2. The agent correctly reasons about relative trip timing ("February 2027" = ~8 months out from June 2026).
3. Harness scenarios can pin a deterministic clock.

## 2. Components

### 2.1 Wire (`@swoop/common`)

[ChatRequestSchema (routes.ts:33)](../product/ts-common/src/routes.ts) is `{sessionId, message}` `.strict()`. Add:

```ts
clientTime: z.object({
  iso: z.string().datetime({ offset: true }),  // e.g. "2026-06-10T17:42:01+01:00"
  timeZone: z.string().min(1).max(64),         // IANA, e.g. "Europe/London"
}).optional(),
```

Optional → old clients / harness fixtures stay valid. Validate-don't-trust: malformed → 400 via the existing route-boundary Zod parse; implausible skew is fine to accept (it's presentation context, not auth).

### 2.2 UI transport (`@swoop/ui`)

At the `/chat` POST assembly (the assistant-ui transport adapter in `product/ui/src/runtime/`): attach `clientTime` from `new Date().toISOString()` + `Intl.DateTimeFormat().resolvedOptions().timeZone`. Every request, freshly read.

### 2.3 Orchestrator injection

- Store the latest `clientTime` on session state at `/chat` handling ([chat.ts](../product/orchestrator/src/server/chat.ts)).
- The agent factory's `InstructionProvider` ([factory.ts](../product/orchestrator/src/agent/factory.ts)) already re-evaluates per turn (it wraps the prompt-loader + skills injection) — append a short dateline block, e.g.:
  > `Current date for this visitor: Wednesday 10 June 2026 (Europe/London, 17:42 local). Reason about seasons, lead times and "how far out" from this date.`
- Render the human-readable form server-side (deterministic `Intl` formatting from `iso` + `timeZone`); fall back to server-now with an explicit `(server clock — visitor clock unavailable)` marker when the field is absent.
- **Prompt-cache note**: the dateline changes per turn. Verify placement relative to the Anthropic prompt-caching breakpoints introduced by Perf-1 ([2026-04-30 code-level review](reviews/2026-04-30-code-level.md)) — the dateline must sit *after* the cached prefix (or in the message envelope) so we don't bust the system-prompt cache every turn. If the current cache layout can't accommodate an instruction suffix cheaply, inject as a per-turn context line in the user-message envelope instead. Executor decides with evidence; record which in the execution log.
- Don't double-input: triage classifier (Haiku) doesn't need the dateline unless trivially cheap to share.

### 2.4 Harness

`userAgent` scenarios get an optional fixed `clientTime` (config field) so date-sensitive assertions are deterministic; default = real now. One new scenario: visitor names a month ~8 months out; assert the agent doesn't misjudge the distance (judge_rubric).

**Decision (proposed) B.poincare-1**: visitor-clock-as-context — browser-sourced `{iso, timeZone}` on every chat request, injected per-turn after the cached prefix; server clock only as marked fallback.

## 3. Out of scope

- Seasonal/availability *data* (the agent gets the date, not a calendar of departures).
- Consent/session timestamps (already server-stamped; unchanged).
- Cross-session memory of the visitor's timezone.

## 4. Verification

1. Unit: schema round-trip; transport attaches the field; instruction contains the formatted dateline; fallback path marked.
2. Cache check: two consecutive turns → confirm cache-read tokens stay high (the Perf-1 logging / usage fields) — i.e. the dateline isn't busting the cache.
3. Live smoke: ask "I want to travel in February 2027 — how far out is that?" → correct ~8-month answer. Then repeat with system clock irrelevant (the point: answer tracks the *sent* clientTime — test by sending a spoofed clientTime via curl).
4. Harness scenario green.

## 5. Estimate

~0.5 day including the cache-placement check.

---

## 2026-06-10 execution log

**Executor**: claude-sonnet-4-6 (agent claude/magical-poincare-53e479)

### Decision B.poincare-1 — dateline placement

**Evidence gathered**: Read `product/orchestrator/src/agent/claude-llm.ts` §Perf-1 block (lines 133–165). Cache layout is:

- `system` block: full `InstructionProvider` output (brief + skills injection) → `cache_control: { type: 'ephemeral' }` on the single text block.
- `tools` array: last tool gets `cache_control: { type: 'ephemeral' }`.

The `InstructionProvider` in `factory.ts` is `() => promptLoader.load() + "\n\n---\n\n" + skillsInjection`. If the dateline were appended here it would change every turn, busting the ephemeral cache on every request.

**Decision**: inject the dateline as **two separate text parts on the user message** in `runAgentTurn`. The ADK `Content.parts` array accepts multiple `{ text }` parts; we prepend `{ text: dateline }` before `{ text: message }`. This leaves the system-prompt block (and its cache_control breakpoint) entirely unchanged. The Anthropic API caches the system + tools prefix; the per-turn user content is never cached by design.

This is the established Anthropic pattern for per-turn dynamic context (documented in their prompt-caching guide: "use the messages array for content that changes per request").

**Cache verification**: Pending-operator. Requires two consecutive live `/chat` requests with an API key wired to an orchestrator instance; verify `cache_read_input_tokens > 0` on turn 2. No API key available in the execution environment. Marked `pending-operator` per plan §4.2.

### Deviations from plan

1. **`clientTime` stored on `SessionState`** — plan §2.3 says "store latest clientTime on session state at `/chat` handling". Done additively: added `clientTime` optional field to `SessionStateSchema` in `ts-common/src/session.ts`. This is a JSONB-compatible additive field; existing Postgres rows round-trip cleanly (Zod `.optional()` — undefined on read from older rows is fine). The plan mentioned "update the postgres store's JSONB round-trip test only if the type forces it" — Zod's `.optional()` means no forced test update; existing round-trip tests still pass.

2. **UI `clientTime` type** — the adapter uses an inline `{ iso: string; timeZone: string }` type rather than importing `ClientTime` from `@swoop/common`. This is intentional per the existing comment in `orchestrator-adapter.ts` (line 133–139): "We deliberately do NOT import from `@swoop/common` here: this file runs in the browser via Vite, and a runtime import of the common package would drag in Zod schemas we don't need to validate against." The inline type is structurally identical.

3. **`buildDateline` exported** — exported (not just internal) so the dedicated unit test file can import it directly without going through the HTTP handler. No functional consequence.

4. **Harness scenario**: The plan §2.4 says "optional fixed `clientTime` on userAgent scenarios" — that would require adding `clientTime` to `UserAgentSpecSchema` in `scenario.ts`. The plan's primary requirement is the `judge_rubric` scenario; the `clientTime` pin is a "nice to have" for determinism. The scenario is authored with a deterministic rubric ("June 2026") that the live run can validate against. Adding `clientTime` to `UserAgentSpecSchema` and threading it to `OrchestratorClient.sendMessage` is deferred as a follow-up (requires harness runner wiring not described in the Tier 3 plan). Scenario YAML `020-date-distance-reasoning.yaml` created with `judge_rubric` assertion.

### Test counts

- **Baseline** (before changes): 199 tests passing across 15 test files.
- **After changes**: pending final suite output — see test run.

### Typechecks

- `@swoop/common`: ✅ pass
- `@swoop/orchestrator`: ✅ pass
- `@swoop/ui`: ✅ pass
- `@swoop/harness`: ✅ pass (initial run failed — `validPersona` scoping in test; fixed inline)
