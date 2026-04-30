# 03 — Cross-cut: lift SSE frame parser into `@swoop/common/streaming` (review-driven fix)

**Status**: Tier 3 review-driven fix plan. Drafted 2026-04-30.
**Origin**: [planning/reviews/2026-04-30-code-level.md](reviews/2026-04-30-code-level.md) — duplication theme #2.
**Touches**: `@swoop/common/src/streaming.ts` (primary), `@swoop/harness/src/orchestrator-client.ts` (caller), `@swoop/ui/src/runtime/orchestrator-adapter.ts` (caller).
**Blocks**: nothing; closes a single duplication concern that's already gone subtly out of sync.
**Estimate**: ~60 minutes.

---

## Why this is a cross-cut

Two SSE consumer/parsers exist today, both implementing the same wire format defined by `orchestrator/server/chat.ts` (data:/event: lines, `\n\n` boundaries, `event: done|error`). They've already drifted in subtle ways:
- Harness `parseSseFrame` (`harness/orchestrator-client.ts:183-300`) calls `.trim()` on `data:` content (line 296)
- UI `parseSseStream` (`ui/runtime/orchestrator-adapter.ts:244-295`) uses `.trimStart()` (line 268)
- Multi-line `data:` content concatenated without delimiter in harness vs `\n`-joined in UI (`adapter.ts:273`)

Not currently a bug because the orchestrator emits one-line `data:` only, but a divergence-in-waiting. Both will need to evolve in lockstep when chunk D's persistence work introduces cross-page rehydration; today that's a maintenance-by-coincidence trap.

This cross-cut lifts a single canonical parser into `@swoop/common/streaming` (which already houses the streaming part-type schemas — the parser belongs there too).

Status legend: 🔲 not started · 🟡 in flight · ✅ landed.

---

## Fix shape

### Step 1 — author `parseSseFrames` in `@swoop/common`

Add to `product/ts-common/src/streaming.ts` (or a sibling `sse-parser.ts` re-exported from the streaming module):

```ts
export interface SseFrame {
  readonly event: string | null;     // null = default 'message' event
  readonly data: string;             // joined with '\n' for multi-line data
  readonly id?: string;              // SSE 'id:' field (rare in our wire shape)
}

export async function* parseSseFrames(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<SseFrame, void, unknown> {
  // Spec-correct buffering: read chunks, split on '\n\n' boundary.
  // Inside each frame, split on '\n', parse 'field: value' lines.
  // Multi-line 'data:' lines join with '\n' (per SSE spec).
  // Comments (lines starting with ':') are ignored.
  // Emits one SseFrame per double-newline boundary.
}
```

**Decisions to lock in** (currently divergent across the two existing impls):
- Multi-line `data:` joining: **`\n`** (matches SSE spec; matches current UI behaviour). Harness's no-delimiter form is non-standard.
- Whitespace handling: **no trim**. The orchestrator's `writeSsePart` at `chat.ts:383-390` writes `data: <json-string>` with a single space. The parser strips the leading space if and only if the field starts with `field: ` (one space — per spec). No further trimming.
- `event:` line absent → `event === null` (caller decides default — typically `'message'`).
- `event: done` and `event: error` are NOT special-cased in the parser; consumers handle them.

### Step 2 — replace harness consumer

`harness/orchestrator-client.ts:183-300` — replace `consumeSseStream` and `parseSseFrame` with calls into `@swoop/common`'s `parseSseFrames`. The "is this a `done`/`error` frame?" decision moves into the harness's loop body.

### Step 3 — replace UI consumer

`ui/runtime/orchestrator-adapter.ts:244-295` — replace `parseSseStream` with `parseSseFrames`. Stream-to-async-iterable plumbing remains the adapter's responsibility (it's bound to `fetch().body`).

**Caveat**: the UI `parseSseStream` is currently 50 LOC; lifting it shaves ~50 LOC from the 660-LOC adapter file (a noted size flag from the boundary lens) without changing behaviour. Pure win.

### Step 4 — verify both consumers behave identically against the orchestrator

A new vitest case in `ts-common/__tests__/sse-parser.test.ts` covers:
- Single-frame happy path with `data:` only
- Multi-frame delimited by `\n\n`
- Multi-line `data:` joined with `\n`
- `event:` field present and absent
- `event: done` and `event: error` (parser doesn't treat them specially)
- Mid-frame chunk boundary (the buffering edge case both consumers historically had bugs in)
- Empty frames (skip)
- Comment lines (`: heartbeat\n\n`) silently dropped
- UTF-8 multi-byte character split across chunk boundaries

---

## H5 — Authoritative SSE-frame parser in `@swoop/common` — ✅

**Problem**: see "Why this is a cross-cut" above. Two parsers diverge.

**Fix shape**: see Steps 1–4.

**Verification**:
- `npm test -w @swoop/common` adds the new sse-parser cases.
- `npm test -w @swoop/orchestrator` (harness consumer) and `npm test -w @swoop/ui` stay green.
- `grep -n "parseSseFrame\|parseSseStream" product/ -R --include='*.ts'` returns hits only inside `@swoop/common` and the call sites that wrap it.

**Commits**:
- `63ac862` — `fix(common): close H5 — shared SSE parser (2026-04-30 review)` — canonical parser + 13 vitest cases
- `20705ce` — `fix(harness): close H5 — shared SSE parser (2026-04-30 review)` — replace `parseSseFrame` + buffering loop in `consumeSseStream`
- `52c3485` — `fix(ui): close H5 — shared SSE parser (2026-04-30 review)` — replace local `parseSseStream` in the orchestrator adapter

LOC delta (per spec target ±~50 LOC saved per consumer, +~80 LOC parser):
- `+188` in `product/ts-common/src/sse-parser.ts` (new canonical, mostly comments + a small async-iterable bridge)
- `+174` in `product/ts-common/src/__tests__/sse-parser.test.ts` (13 cases)
- `−25` net in `product/harness/src/orchestrator-client.ts` (parser shed; aggregation kept)
- `−62` net in `product/ui/src/runtime/orchestrator-adapter.ts` (parser shed; translator + lifecycle code untouched)

Verification (run 2026-04-30 close-out):
- `npm test --workspaces --if-present` → 429 tests passing across the six workspaces (up from 412; +17 = 13 sse-parser + 4 emit-event tests previously deferred? — actually +13 sse-parser; the +17 is `@swoop/common` 58 → 75 tests).
- `npm run typecheck --workspaces --if-present` → all six workspaces green.
- `grep -n "parseSseFrame\|parseSseStream" product/ -R --include='*.ts'` (excluding `node_modules`) → hits limited to `@swoop/common` (canonical + tests) + the two consumer wrapper sites + two unrelated test-fixture helpers in `orchestrator/.../*.test.ts` that take a static string (different signature, out of scope).

---

## Out of scope

- Refactoring `orchestrator-adapter.ts` further (e.g. splitting `translatePart` into its own module). Tracked in the boundary-lens findings; better landed under a B-stream Tier 3 plan.
- Server-side SSE writing (`writeSsePart` in `chat.ts:383-390`) — already a one-line helper; doesn't need extracting.

---

## Order of execution

1. Author `parseSseFrames` + tests in `@swoop/common`.
2. Replace harness consumer first (least visible — internal CLI).
3. Replace UI consumer.
4. Run full test suite end-to-end.

Single commit per step; commit message `fix(common): close H5 — shared SSE parser (2026-04-30 review)`.
