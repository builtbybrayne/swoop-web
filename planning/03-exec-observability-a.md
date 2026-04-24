# 03 — Execution: F-a `emitEvent` Helper + Event Schema

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: F (observability & analytics).
**Implements**: [`02-impl-observability.md`](02-impl-observability.md) §2.1 (envelope), §2.2 (minimum event set), §2.3 (emission helper). Covers F.t1 + F.t2 from the Tier 2 order-of-execution. Explicitly excludes F.t3 (producer retrofit) — that becomes F-b in a later wave.
**Depends on**: A.t2 (landed — `@swoop/common/events.ts` stub already in place with envelope + nine event kinds + fixture round-trip test).
**Blocks**: F-b (retrofit of B/C/D/E call sites), H validation harness (imports live types from this module per the coordination below).
**Produces**:
- `product/ts-common/src/events.ts` (edit in place — extend the A.t2 stub; don't replace).
- `product/ts-common/src/emit-event.ts` (new — tiny helper + pluggable sink).
- `product/ts-common/src/fixtures/event.sample.ts` (edit — one fixture per new event kind, compact).
- `product/ts-common/src/fixtures/index.ts` (edit — re-export the new samples).
- `product/ts-common/src/__tests__/fixtures.test.ts` (edit — round-trip coverage for the new kinds).
- `product/ts-common/src/__tests__/emit-event.test.ts` (new — sink-swap + validation-failure coverage).
- `product/ts-common/src/index.ts` (edit — re-export `./emit-event.js`).
**Estimate**: ~2 h focused work.

---

## Purpose

The A.t2 stub authors the envelope + nine event kinds. F-a extends to **the full Puma minimum set from §2.2** and adds the **runtime helper** every producer will eventually call. Doing both in one plan lets H and F-b treat `@swoop/common/events` as a stable contract:

- H's validation harness asserts against `Event` (and per-type inferreds) as the wire shape — no `emitEvent` needed on the H side, just the types.
- F-b later runs as a **mechanical find-and-replace** of `console.log`→`emitEvent` across B/C/D/E, with producer-specific payload assembly the only per-site work.

No producer wiring happens in F-a. No retrofit. The helper is standalone and unit-tested.

Out of scope:
- Any change to B/C/D/E to actually call `emitEvent` — that's F-b.
- Cloud Logging / BigQuery integration — post-M4 per §2.4 and §5 F.6.
- Sampling, rate-limiting, or cost-event capture — §7 open questions, deferred.
- PII redaction beyond what the schema already enforces (length + sha256 only, no content fields).
- Trace correlation across the two Cloud Run services — §7 open, deferred.

---

## Event kinds — what F-a adds to the A.t2 stub

The existing stub covers nine kinds. §2.2 prescribes more. Add the missing ones + a handful the observability plan didn't pre-enumerate but the brief calls out:

### Already in the A.t2 stub (keep unchanged)

`conversation.started`, `turn.received`, `turn.completed`, `tool.called`, `tool.returned`, `triage.decided`, `handoff.submitted`, `session.ended`, `error.raised`.

### Add in F-a

| Kind | Payload summary | Emitter (F-b will wire) |
|---|---|---|
| `consent.granted` | `{ tier: "conversation" \| "handoff" \| "marketing", copyVersion?: string }` | B (PATCH consent) |
| `consent.declined` | `{ tier: "conversation" \| "handoff" \| "marketing", copyVersion?: string }` | B |
| `user_message.submitted` | `{ length, sha256 }` — the existing `turn.received` already covers this. **Skip** unless reconsidered at F-b time — adding it now would duplicate the signal. *Flagged here rather than added, so future readers know it was considered.* | — |
| `tool.failed` | `{ toolName, toolCallId, errorCategory: "validation" \| "upstream" \| "timeout" \| "unknown", latencyMs }` | C. Distinct from `tool.returned{outcome: "error"}`: richer category surface for spot-checks without having to grep text. Keep both — `tool.returned` is the cardinal signal, `tool.failed` is the opt-in richer one for failing calls. |
| `handoff.triggered` | `{ verdict, widgetToken }` | B (the `handoff` tool firing, pre-widget-confirmation) |
| `skill.loaded` | `{ skillName, triggerContext: string }` — fired by the ADK skill primitive when G's skill content loads. B.t9 territory (deferred), but the schema slot lands now. | B (post-B.t9) |
| `ui.widget_rendered` | `{ widgetType, toolName, turnIndex }` | D |
| `ui.conversation_opened` | `{ source: string, uaCategory?: "desktop" \| "mobile" \| "tablet" \| "unknown" }` | D |
| `ui.conversation_closed` | `{ closeReason: "explicit_close" \| "tab_close" \| "navigation" \| "restart", finalState?: string }` | D |
| `session.expired` | `{ cause: "idle_timeout" \| "archive_to_delete" }` | B (sweeper — B.t2 lifecycle) |
| `warm_pool.hit` | `{ poolSizeAtClaim: number, waitTimeMs: number }` | B (post-B.t10) |
| `warm_pool.miss` | `{ poolSizeAtClaim: number }` | B (post-B.t10) |

Total post-F-a: 18 event kinds (9 already + 9 added; `user_message.submitted` intentionally skipped). Anything past this list is F-b territory — if a retrofit agent finds a gap they land a PR with F-a as the reviewer.

**Omission rationale:**
- `conversation.ended` in the brief is already covered by `session.ended` (the existing stub) — they're the same event, different naming. Keep `session.ended`.
- `user_message.submitted` is a relabelling of `turn.received`. Drop the duplicate to avoid consumer confusion.

### Schema decisions (carried from §2.1)

- Discriminated union on `eventType`. Consumers get exhaustive-match via TypeScript.
- Envelope flat — no deep nesting. BigQuery unnests cleanly (§2.4).
- `eventVersion: z.number().int().positive()` starts at 1. Schema changes per kind bump that kind's version; do NOT renumber the whole set.
- Optional envelope additions F-a **does not** introduce (deferred to F-b or later per §7 open questions):
  - Cross-service correlation id.
  - Sampling flag.
  - Cost-event token counts.

### Discriminator stability

Existing payloads must not change shape in F-a — only new kinds get added. Rationale: A.t2's fixture round-trip test already commits to the stub. Breaking the existing nine would be an unforced version bump; there's no signal yet to justify it.

---

## `emitEvent` helper

### File: `product/ts-common/src/emit-event.ts` (new)

```ts
// -----------------------------------------------------------------------------
// emitEvent — the single audit-grade log point for Puma.
//
// Every runtime package (orchestrator, connector, ui, ingestion) calls this
// instead of console.log for anything auditable. The default sink writes a
// structured JSON line to stdout (which Cloud Run ships to Cloud Logging
// untouched). A pluggable sink is available for:
//   - Dev / tests (capture in a ring buffer).
//   - Post-M4 wiring to Cloud Logging via @google-cloud/logging (or whatever
//     Swoop settles on).
// -----------------------------------------------------------------------------

import { EventSchema, type Event } from "./events.js";

export type EventSink = (event: Event) => void;

const defaultSink: EventSink = (event) => {
  // Structured JSON on a single line. Cloud Run → Cloud Logging parses it
  // as a structured entry; local dev just sees the JSON.
  //
  // eslint-disable-next-line no-console -- this is the one sanctioned console use.
  console.log(JSON.stringify(event));
};

let currentSink: EventSink = defaultSink;

/**
 * Swap the sink. Returns the previous sink so callers can restore it (e.g.
 * tests, post-M4 init code registering a Cloud Logging writer).
 *
 * Module-level mutable state is deliberate. We do NOT want dependency
 * injection wiring threading through B/C/D/E — the whole point of F-a is
 * that every call site is `emitEvent(event)` and nothing else. Sink
 * configuration is a process-lifecycle concern, handled once at startup.
 */
export function setEventSink(sink: EventSink): EventSink {
  const previous = currentSink;
  currentSink = sink;
  return previous;
}

/** Reset to the default stdout-JSON sink. Primarily for test hygiene. */
export function resetEventSink(): void {
  currentSink = defaultSink;
}

/**
 * Emit one event. Validates against the discriminated-union schema; on
 * validation failure, emits an `error.raised` event describing the drift
 * instead of the original (the broken event is discarded so consumers
 * never see malformed lines). Never throws — observability must never
 * take down the code it observes.
 */
export function emitEvent(event: Event): void {
  const result = EventSchema.safeParse(event);
  if (!result.success) {
    const fallback: Event = {
      eventType: "error.raised",
      eventVersion: 1,
      timestamp: new Date().toISOString(),
      sessionId: (event as { sessionId?: string }).sessionId ?? "unknown",
      turnIndex: null,
      actor: "system",
      payload: {
        errorType: "event_schema_validation_failed",
        chunk: "F",
        sanitisedContext: result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.code}`)
          .join(", ")
          .slice(0, 500),
      },
    };
    try {
      currentSink(fallback);
    } catch {
      // Sink itself is broken; we've done everything we can.
    }
    return;
  }
  try {
    currentSink(result.data);
  } catch {
    // Sink throw must never propagate.
  }
}
```

### Design notes

**Module-level mutable sink, not DI.** Rationale in comments above. This is the same pattern the UI adapter error emitter uses (decision D.12) — one module, one emitter, one subscriber. Future-F.t5 (or whoever wires Cloud Logging) calls `setEventSink(cloudLoggingSink)` once at `src/index.ts` startup; every `emitEvent` call in the tree picks that up automatically.

**Validation-failure-emits-error.raised pattern.** If a producer constructs a bad event, we don't want to crash the producer; we want a visible fingerprint in the logs so the drift gets fixed. Mirroring the orchestrator's error-envelope posture (`server/errors.ts`'s `sendError` / `writeSseError`): structured, never throws.

**Automatic session-id correlation: not in F-a.** §2.3 says "applies session-level correlation automatically (pulls `session_id` from whatever session context is in play)". In Puma with two processes (orchestrator + connector) there is no global session context — the caller knows the session id because it's handling a request for that session. Expecting the helper to find it magically would require either AsyncLocalStorage plumbing or a global mutable, both with real cost. F-a keeps it simple: the caller passes `sessionId` in the event. F-b (the retrofit pass) can add an `emitEventWithContext(context, partial)` sugar if real retrofit pain shows up. Noted here so future readers don't wonder why the §2.3 line isn't implemented.

**Cloud Logging vs stdout.** Default is `console.log(JSON.stringify(event))` — Cloud Run captures stdout as structured log entries as long as the line is valid JSON. No Cloud Logging client dep in Puma-M1. When Swoop wires BigQuery export post-M4 the schema is already export-ready; if they want a richer Cloud Logging client (severity routing, resource labels) that becomes a `setEventSink(cloudLoggingSink)` one-liner without touching call sites.

---

## File plan

### `product/ts-common/src/events.ts` (edit)

Add the nine new payload schemas listed above. Each payload is its own `z.object` extending `EventEnvelopeBase` plus an `eventType: z.literal(...)` discriminator, exactly mirroring the existing nine. Append them all to `EventSchema`'s `z.discriminatedUnion` array. Export per-kind type aliases (`ConsentGrantedEvent`, `UiWidgetRenderedEvent`, etc.) for consumers.

Keep `EventActor` as-is — no new actors needed. `ui` already covers D's events.

One small envelope cleanup: `actor: z.enum([...])` remains `EventActorSchema`. No new values.

### `product/ts-common/src/emit-event.ts` (new)

Per spec above. Roughly 50 LOC including comments.

### `product/ts-common/src/fixtures/event.sample.ts` (edit)

Current stub has one `SampleEvent` (handoff.submitted). F-a adds **one fixture per new event kind** so the round-trip test catches any shape drift per kind:

```ts
export const SampleEventHandoffSubmitted: Event = { ...existing }; // rename + keep
export const SampleEventConsentGranted: Event = { ... };
export const SampleEventConsentDeclined: Event = { ... };
export const SampleEventToolFailed: Event = { ... };
export const SampleEventHandoffTriggered: Event = { ... };
export const SampleEventSkillLoaded: Event = { ... };
export const SampleEventUiWidgetRendered: Event = { ... };
export const SampleEventUiConversationOpened: Event = { ... };
export const SampleEventUiConversationClosed: Event = { ... };
export const SampleEventSessionExpired: Event = { ... };
export const SampleEventWarmPoolHit: Event = { ... };
export const SampleEventWarmPoolMiss: Event = { ... };
// Back-compat alias:
export const SampleEvent = SampleEventHandoffSubmitted;
```

Keep each body minimal. Session ids + timestamps can repeat; what matters is per-kind discriminator coverage.

### `product/ts-common/src/fixtures/index.ts` (edit)

Re-export all new named samples. `SampleEvent` alias keeps the existing test passing.

### `product/ts-common/src/__tests__/fixtures.test.ts` (edit)

Replace the single `SampleEvent parses…` case with a `describe.each` / table-driven check for every event fixture. Keeps the test file compact and the new coverage mechanical:

```ts
const EVENT_FIXTURES: Array<[string, Event]> = [
  ["handoff.submitted", SampleEventHandoffSubmitted],
  ["consent.granted", SampleEventConsentGranted],
  // ...one row per new kind
];
it.each(EVENT_FIXTURES)("%s parses against EventSchema", (_label, fixture) => {
  expect(EventSchema.parse(fixture)).toEqual(fixture);
});
```

### `product/ts-common/src/__tests__/emit-event.test.ts` (new)

Three tests. Kept tight — helper is ~50 LOC.

1. **Default sink writes JSON to stdout.** Spy on `console.log`, call `emitEvent(SampleEvent)`, assert spy called once with a string that round-trips `JSON.parse` back to the event. Clean up with `resetEventSink()`.
2. **`setEventSink` swaps the sink.** Register a capture sink, emit an event, assert the captured value equals the event. Restore the previous sink via the returned handle. Important: don't leak the custom sink across tests — `resetEventSink()` in `afterEach`.
3. **Validation failure emits an `error.raised` fallback.** Emit a malformed event (`as unknown as Event` cast), assert the capture sink receives an `error.raised` event whose payload carries `errorType: "event_schema_validation_failed"`. The original malformed event must NOT be passed to the sink.

No Cloud Logging tests in F-a. No sink-throws-must-not-propagate test — ambition creep; deferred to F-b if real failures show up.

### `product/ts-common/src/index.ts` (edit)

Add one line: `export * from "./emit-event.js";`.

---

## Content-as-data compliance

No prose added. Event kind identifiers and enum values are machine-facing labels, not authored content — same rationale as handoff reason codes (see `03-exec-handoff-t1.md`). If later analytics queries need human-friendly labels (e.g. a Looker dashboard calling `handoff.submitted` "handoff delivered"), those labels live in the analytics layer, not in `ts-common`.

---

## Shared contracts touched

- **`Event` discriminated union** — consumers (B/C/D/E emitters once F-b retrofits, H assertions now) type-match on `eventType`. Adding kinds is additive; existing switch consumers keep parsing old events per §2.7 verification rule 7.
- **`emitEvent` helper** — one function call, one argument. Wide adoption surface; intentionally minimal.
- **`EventSink` + `setEventSink`** — lifecycle-only surface. B.t1 / C / D-runtime entry points may call `setEventSink` once at startup post-M4; no per-request use.

---

## Coordination with siblings

### `planner-h` (H validation harness)

**Proactively messaged.** Offer: H imports live types from `@swoop/common/events` (`Event`, `EventSchema`, per-kind inferreds). Rationale: the schema is already contract-code in `ts-common` — copying a frozen subset into harness-land at this stage would fragment the truth while both F and H are still firming up. A wrapper in H for assertion ergonomics is fine if H wants one.

Specific ask to H: reserve an `eval.scenario_completed` (or similarly-named) event kind **now** if the harness wants to emit its own events into the same stream. If so, I'll slot a stub payload into the discriminator in F-a so H can start emitting immediately; if not, H's reply closes the loop with "import live, no reservations". One exchange, done.

If H asks for reservations, the slot name + payload shape is a H-owned choice and lands as a last-minute addition before I close this plan out. If H hasn't replied by the time F-a implements, default assumption is "import live, no reservations" — H can PR the event kind itself later.

### `planner-d6` (D.t6 session handling)

Would-be intersect: if D.t6 wants to emit a `session.expired` event from D's proactive ping, the kind is already in F-a's set. No coordination needed unless D.t6 wants a different payload.

**Reserved type-slot** (pre-emptive, low-cost): if D.t6 wants a `session.ping_check` event (visitor-client-side "am I still alive" probe), name it and I'll add a stub payload. Otherwise nothing to do.

### `planner-d7` (D.t7 mobile reflow)

No intersection.

---

## Verification

1. `npm --workspace @swoop/common run typecheck` passes — new kinds + helper typecheck cleanly.
2. `npm --workspace @swoop/common test` passes — every event fixture round-trips through `EventSchema`; the three `emit-event.test.ts` cases green.
3. `grep -R "emitEvent" product/` shows the export + test only — no producer wiring in F-a.
4. `grep -R "import .* from \"@swoop/common/events\"" product/` (or wherever the @swoop/common entry resolves) is empty post-F-a — consumers land via F-b.
5. `EventSchema.parse(SampleEventHandoffSubmitted)` from the existing fixture still succeeds — back-compat preserved.

Running locally:

```bash
cd product
npm run typecheck
npm --workspace @swoop/common test
```

Both green → F-a is done.

---

## Open sub-questions returned to Tier 2 / F-b

- Automatic session-id correlation via AsyncLocalStorage or similar — evaluated here, deferred. Reopen if F-b producer retrofit is painful without it.
- Cost-event capture (token counts per model call) — §7 open; defer until Swoop signals analytics appetite.
- Trace-correlation id across orchestrator + connector — §7 open; adding it is an envelope change (breaking-ish), best batched with other envelope work.
- Sampling policy — §7 open; defer until real traffic shows a high-volume kind.
- Whether `tool.failed` duplicates `tool.returned{outcome:"error"}` enough to delete one — revisit after F-b lands and real grep patterns show which is more useful.

---

## Handoff

F-b (later wave) picks up the retrofit: a single pass across B/C/D/E replacing `console.log` with `emitEvent` at the prescribed emission points (Tier 2 §2.2 table). Every call site is mechanical: construct the payload, call `emitEvent`, done. H consumes the schema in parallel; no ordering constraint between F-b and H.
