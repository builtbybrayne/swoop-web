# 03 — Cross-cut: common helpers extraction (review-driven fix)

**Status**: Tier 3 review-driven fix plan. Drafted 2026-04-30.
**Origin**: [planning/reviews/2026-04-30-code-level.md](reviews/2026-04-30-code-level.md) — duplication + observability themes.
**Touches**: `@swoop/common` (primary), `@swoop/orchestrator` + `@swoop/connector` + `@swoop/ui` + `@swoop/harness` (callers).
**Blocks**: nothing critical; closes 4 small consolidation opportunities surfaced by the duplication, error-handling, and contract-integrity lenses.
**Estimate**: ~90 minutes.

---

## Why this is a cross-cut

Each of the four items below replaces a repeated pattern that appears in 3+ workspaces. None has a single chunk-owner — they're contracts that belong in `@swoop/common`. Folding them into any one of `03-exec-handoff-t*`, `03-exec-agent-runtime-t*`, etc. would misrepresent the scope. They live here as a single fix-plan; commits target individual sites.

Status legend: 🔲 not started · 🟡 in flight · ✅ landed.

---

## H1 — `messageOf(err: unknown): string` helper — 🔲

**Problem**: `err instanceof Error ? err.message : String(err)` repeats at 16+ sites across `connector/handoff/mailer.ts:155,181`, `connector/handoff/store.ts:92`, `harness/cli.ts:111`, `harness/scenario.ts:302`, `harness/assertions.ts:456`, `harness/runner.ts:160`, `harness/orchestrator-client.ts:157`, `orchestrator/index.ts:207`, `orchestrator/server/chat.ts:176,331`, `orchestrator/server/session-bootstrap.ts:114`, `orchestrator/server/handoff-submit.ts:107`, `orchestrator/agent/claude-llm.ts:496`, `orchestrator/agent/prompt-loader.ts:97,124`, `orchestrator/connector/tools.ts:219`, `orchestrator/session/warm-pool.ts:290`, `functional-agents/triage-classifier.ts`. Plus a richer variant in `ui/errors/classify.ts:39-53` (the `messageOf` shape that handles `{message: …}` objects + `JSON.stringify` fallback).

**Fix shape**: lift the UI's `messageOf` (most defensive form — handles Error, plain objects with `.message`, primitives, JSON-stringifiable objects, and a typeof-fallback) into a new file `product/ts-common/src/errors.ts`. Export from the package barrel. Replace all 16 sites with `messageOf(err)`.

**Verification**: vitest cases in `ts-common/__tests__/errors.test.ts` covering: Error instance, plain object with message, primitive, circular object (JSON.stringify throws), null/undefined. All other workspace tests stay green.

**Commits**: _(landed: filled when done)_

---

## H2 — `emitErrorRaised(...)` helper — 🔲

**Problem**: `error.raised` event emission is duplicated at 9+ sites with subtly inconsistent payloads. Specifically: `chat.ts:176` and `index.ts:230` slice `sanitisedContext` to 500 chars; `connector/tools.ts:219` doesn't. Every site repeats `{eventVersion: 1, timestamp: now().toISOString(), actor: ..., payload: { errorType, chunk, sanitisedContext: <maybe sliced> }}`.

**Fix shape**: add a new helper next to `emitEvent` in `product/ts-common/src/emit-event.ts`:

```ts
export function emitErrorRaised(args: {
  sessionId: string;
  turnIndex?: number | null;
  actor: EventActor;
  errorType: string;
  chunk: 'B' | 'C' | 'D' | 'E' | 'F' | 'system';
  err: unknown;
  sanitisedContextLimit?: number;  // default 500
}): void
```

Internally calls `emitEvent({ eventType: 'error.raised', ... })` with `sanitisedContext: messageOf(args.err).slice(0, args.sanitisedContextLimit ?? 500)`. Replace all 9 sites.

**Verification**: vitest case asserts the helper produces an event matching `ErrorRaisedEventSchema`; existing tests at the call sites stay green.

**Commits**: _(landed: filled when done)_

---

## H3 — Add `handoff.email.{sent,skipped,failed}` event kinds — 🔲

**Problem**: `connector/handoff/mailer.ts:43-44` documents a `handoff.email.{sent,skipped,failed}` event family in code comments. Grep of `events.ts` and `emit-event.ts` returns zero matches — the event schema doesn't carry these. SMTP outage today produces zero structured signal in observability stream; the documented event family is a phantom.

**Fix shape**: add three event payload schemas to `product/ts-common/src/events.ts`:

```ts
HandoffEmailSentEventSchema    — { handoffId, verdict, toAddress, subjectHash }
HandoffEmailSkippedEventSchema — { handoffId, verdict, reason: 'mailer_disabled' | 'verdict_disqualified' | 'verdict_inconclusive' }
HandoffEmailFailedEventSchema  — { handoffId, verdict, errorCategory: 'template_read' | 'smtp' | 'unknown', sanitisedContext (≤500ch) }
```

Wire them into `submitHandoff` (`connector/handoff/submit.ts`) immediately after the `sendHandoffEmail` call. Update the `submitHandoff` doc-block to match.

Note for the mailer.ts comment-vs-code drift: once the schema lands, the comment becomes truthful.

**Verification**: handoff-submit route test asserts the email event is emitted in addition to `handoff.submitted`, with the right payload shape. Connector test asserts `submitHandoff` calls `emitEvent` with a `handoff.email.*` envelope.

**Commits**: _(landed: filled when done)_

---

## H4 — `parseToolResult(name, schema, raw)` helper for connector adapter — ✅

**Problem**: `orchestrator/connector/tools.ts:197-254` repeats four nearly identical try/catch blocks — one per tool — each parsing a tool result with `safeParse`, then constructing `{ok: false, code: 'shape_invalid' | 'tool_error', ...}`. Will balloon to 8 sites once chunks C/E ship more tools.

**Fix shape**: a single `parseToolResult<T>(toolName: string, schema: z.ZodType<T>, raw: unknown): {ok: true, value: T} | {ok: false, code: 'shape_invalid' | 'tool_error', detail: string}` function. Each of the 4 (soon 8) wrapper functions reduces to one line.

Lives in `product/orchestrator/src/connector/tools.ts` (NOT in `@swoop/common` — this helper assumes the connector's specific result-envelope shape; lifting it would over-couple).

**Verification**: orchestrator's existing tools.test.ts (13 cases) stays green; no behavioural change.

**Commits**: `9e4bfbd` (2026-04-30) — `fix(orchestrator): close H4 — parseToolResult helper`.

---

## Order of execution

1. H1 first — pure addition, no behaviour change. Other items consume `messageOf`.
2. H3 next — adds event kinds; schemas downstream depend on them.
3. H2 — uses both `messageOf` and the new event kinds (well, only `error.raised` which is pre-existing). Sweep the 9 sites.
4. H4 — orchestrator-only refactor.

Each item commits as `fix(<scope>): close H<N> — <one-liner> (2026-04-30 review)`.

---

## Out of scope

- Lifting the SSE parser into `@swoop/common/streaming` — separate cross-cut at [03-exec-crosscut-shared-sse-parser-fix.md](03-exec-crosscut-shared-sse-parser-fix.md).
- Refactoring `orchestrator-adapter.ts` into smaller modules — too speculative to do under "review fix"; defer to a B-stream Tier 3 plan.
- Per-package `messageOf` overrides — keep it one helper, don't fork by workspace.

---

## Verification

After all four items land:
1. `grep -rn "err instanceof Error ? err.message" product/*/src --include='*.ts'` returns 0 hits.
2. `grep -rn "emitEvent.*error\.raised" product/*/src --include='*.ts'` returns ≤1 hit (only the helper itself).
3. `npm test` across all 6 workspaces: 416 + N new tests, all green.
4. Typecheck clean across all 6 workspaces.
5. Mailer-failure path now emits a `handoff.email.failed` event verifiable in test.
