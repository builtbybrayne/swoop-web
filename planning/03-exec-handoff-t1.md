# 03 — Execution: E.t1 Handoff Payload Schema + Reason Taxonomy

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: E (handoff & compliance).
**Implements**: [`02-impl-handoff-and-compliance.md`](02-impl-handoff-and-compliance.md) §2.1 (handoff payload shape) + §10 order-of-execution item E.t1. Finalises the verdict / reason / consent surfaces that E.t2 (durable store), E.t3 (verdict-aware email) and G (email template) all index on.
**Depends on**: A.t2 (landed — `@swoop/common/handoff.ts` stub already in place with qualified / referred_out / disqualified variants + fixture round-trip test).
**Blocks**: E.t2 (write path), E.t3 (email routing), G.t0 (HITL flow mapping — refines the taxonomy), H (scenario assertions on verdict + reason).
**Produces**:
- `product/ts-common/src/handoff.ts` (edit in place — evolve the A.t2 stub, don't replace).
- `product/ts-common/src/fixtures/handoff.sample.ts` (edit — add one sample per verdict).
- `product/ts-common/src/fixtures/index.ts` (edit — re-export the new samples).
- `product/ts-common/src/__tests__/fixtures.test.ts` (edit — one round-trip case per verdict + one reject-path case for the connector backstop).
- `product/ts-common/src/index.ts` — no change (barrel already re-exports `handoff.js`).
**Estimate**: ~2 h focused work.

---

## Purpose

The A.t2 stub reserves the shape; E.t1 commits to **the finite enum of verdict/reason pairs** that downstream chunks can depend on without further churn. Concretely:

- **Verdict** is already a three-state discriminator (`qualified` / `referred_out` / `disqualified`). Keep it.
- **Reason code** is currently a freeform `z.string()`. That slip is the single thing blocking E.t2 and E.t3 from treating the durable record as machine-readable. E.t1 replaces it with a **per-verdict `z.enum` of structured codes** plus the existing freeform `text` for specialist-facing context.
- **Wire the backstop type** the connector's E.t2 code will implement — a `consent.conversationGranted && consent.handoffGranted` guard. E.t1 surfaces the contract; E.t2 lands the runtime check.

The taxonomy is a **starter set**. G.t0 (HITL flow mapping with Al + Luke's sales-thinking doc) will refine. This plan names the three shapes the schema needs to support so G.t0 can rename or reweight codes without touching call sites outside `ts-common`.

Out of scope:
- Connector runtime guard (lands in E.t2's plan).
- Durable-store write (E.t2).
- Email template field bindings (G).
- Privacy-info page content (E.t5).
- Any change to `session.ts`'s triage state (it's already union-on-verdict; the code field stays freeform there because `session.triage.reasonCode` is written by the classifier placeholder per decision B.15 and lands the final taxonomy via G.t0 — decoupling session-side and handoff-side taxonomies lets the classifier evolve without breaking the wire schema).

---

## Verdict + reason taxonomy

Four columns per entry: code (kebab-case for consistency with existing `torres-del-paine` slug convention), when the agent picks it, what sales expects from it, what text the freeform `reason.text` carries alongside. Codes are **distinct per verdict** — no shared code appears on two verdicts.

### `qualified` (6 codes)

Triggered when the visitor is ready to meet a specialist warm, with enough substance that the first call starts mid-relationship.

| Code | Trigger | Sales treatment | Text expected |
|---|---|---|---|
| `ready_booking_named_trip` | Visitor named a specific trip/tour + asked a booking-adjacent question (dates, availability, price confirmation). | Priority follow-up. Specialist picks up on the named product. | Quote the named product + the booking-adjacent question. |
| `ready_comparing_shortlist` | Visitor narrowed to 2–3 options; wants help choosing. | Warm handoff — visitor is in decision mode. | Name the shortlist + the delta they're deciding on. |
| `budget_and_timeline_confirmed` | Both budget band AND travel window are explicit and within Swoop's range. | Specialist has the commercial basics — skips fact-finding. | Budget band + timeline as stated. |
| `group_tour_intent` | Strong signal the visitor wants a small-group tour specifically (per Luke's 50% strategic target). | Route to the group-tours specialist. | Quote the group-tour language the visitor used. |
| `bespoke_request` | Visitor asked about something explicitly customisable (private guide, unusual combination, non-standard duration). | Specialist consultative call. | Summarise the non-standard ask. |
| `qualified_other` | Catch-all — agent judged qualified but none of the above map cleanly. | Standard follow-up with the freeform text as context. | Narrative summary of the qualifying signals. |

### `referred_out` (4 codes)

Outside Swoop's direct service scope but still deserves a helpful next step. Per E.2 decision, may still generate a lightweight email to a distinct inbox (exact behaviour tier-3 on E.t3).

| Code | Trigger | Sales treatment | Text expected |
|---|---|---|---|
| `below_profit_floor` | Budget explicitly places the booking under Luke's <$1k-profit threshold. | No warm follow-up; visibility only. | Budget + product scope that triggered the floor. |
| `out_of_region` | Visitor wants a destination Swoop doesn't serve in Puma (e.g. Africa, Himalayas). | Optional: suggest a partner or self-service. | Destination asked for. |
| `timing_outside_window` | Departure window falls outside what Swoop programs (e.g. off-season to a region, or too-soon). | Visibility; re-engage if timing shifts. | Requested window. |
| `referred_other` | Catch-all for "right person, wrong moment". | As-is. | Narrative. |

### `disqualified` (4 codes)

Clearly not a lead. No email; durable record for analytics. Per E.3 decision.

| Code | Trigger | Sales treatment | Text expected |
|---|---|---|---|
| `backpacker_no_budget` | Visitor self-identifies as backpacker / no budget / explicitly looking for free info only. | None. | One-line summary. |
| `off_brand_query` | Visitor is asking about something outside Swoop's territory + clearly not a candidate (e.g. flight booking, hostel-booking, itinerary for a different company). | None. | What they asked for. |
| `proxy_to_claude` | Visitor using the chat as a proxy to Claude (coding help, unrelated research). | None. | Detect + close politely. |
| `disqualified_other` | Catch-all. | None. | Narrative. |

**Total: 14 codes across three verdicts.** The catch-all per verdict is deliberate — real-world agent decisions won't always fit. G.t0 either (a) grows the taxonomy with patterns that emerge from the HITL flow, or (b) weights the catch-all down by strengthening the named codes' descriptions. The wire shape survives either case.

**Rationale for "distinct per verdict"**: a shared code like `out_of_scope` applied to both `referred_out` and `disqualified` would force analytics queries to project on `(verdict, reason.code)` pairs instead of `reason.code` alone. Splitting prevents that; nothing costs us.

**Zod representation**: per-verdict `z.enum([...])` for `reason.code`; `text` stays `z.string().min(1)`. Variant blocks in `HandoffPayloadQualifiedSchema` etc. get their own `reason` field overriding the shared `HandoffPayloadCommon.reason` so the enum is variant-specific. Downstream consumers can discriminate on `verdict` and get exhaustive `reason.code` coverage for free.

---

## File plan

### `product/ts-common/src/handoff.ts` (edit)

Keep A.t2's structure — three per-verdict schemas combined via `z.discriminatedUnion("verdict", [...])`. Narrow the reason field per verdict:

```ts
export const QualifiedReasonCodeSchema = z.enum([
  "ready_booking_named_trip",
  "ready_comparing_shortlist",
  "budget_and_timeline_confirmed",
  "group_tour_intent",
  "bespoke_request",
  "qualified_other",
]);
export type QualifiedReasonCode = z.infer<typeof QualifiedReasonCodeSchema>;

export const ReferredOutReasonCodeSchema = z.enum([
  "below_profit_floor",
  "out_of_region",
  "timing_outside_window",
  "referred_other",
]);
export type ReferredOutReasonCode = z.infer<typeof ReferredOutReasonCodeSchema>;

export const DisqualifiedReasonCodeSchema = z.enum([
  "backpacker_no_budget",
  "off_brand_query",
  "proxy_to_claude",
  "disqualified_other",
]);
export type DisqualifiedReasonCode = z.infer<typeof DisqualifiedReasonCodeSchema>;
```

A per-verdict `HandoffReason<Verdict>` schema pairs the enum with the existing freeform `text: z.string().min(1)`. The three per-verdict payload schemas (`HandoffPayloadQualifiedSchema`, `...ReferredOutSchema`, `...DisqualifiedSchema`) override the shared `HandoffPayloadCommon.reason` with their variant-specific reason. Everything else in the stub survives unchanged.

Delete the current top-level `HandoffReasonSchema` (`{ code: string, text: string }`) or demote it to a deprecated re-export pointing at a union of the three narrowed variants. Decision at implementation time — simpler to delete; no external consumer yet.

Add `HandoffVerdict` as a re-export alias (`z.enum(["qualified", "referred_out", "disqualified"])`) so `ts-common` callers don't redeclare the literal union.

Add a **backstop-contract helper type** (doc-only; runtime lives in E.t2):

```ts
/**
 * Contract: E.t2's connector-side guard rejects a `handoff_submit` payload
 * unless BOTH consent flags are true. This type surfaces the shape of the
 * input to that guard. Runtime check lives in E.t2.
 */
export type HandoffSubmitConsentGate = Pick<
  HandoffPayload["consent"],
  "conversationGranted" | "handoffGranted"
>;
```

### `product/ts-common/src/fixtures/handoff.sample.ts` (edit)

Currently one `SampleHandoff` (qualified). Add two more and export all three plus a discriminated-union-friendly barrel:

```ts
export const SampleHandoffQualified: HandoffPayloadQualified = { ...existing SampleHandoff, reason: { code: "ready_booking_named_trip", text: "..." } };
export const SampleHandoffReferredOut: HandoffPayloadReferredOut = { ...minimal ReferredOut body, reason: { code: "below_profit_floor", text: "..." } };
export const SampleHandoffDisqualified: HandoffPayloadDisqualified = { ...minimal Disqualified body (no contact field), reason: { code: "proxy_to_claude", text: "..." } };
// Back-compat alias, retire when no consumers left:
export const SampleHandoff = SampleHandoffQualified;
```

Keep bodies minimal-but-real. Motivation anchors should be distinct per fixture so a `grep` in a log trace can tell them apart.

### `product/ts-common/src/fixtures/index.ts` (edit)

Add re-exports for the three new named samples. Keep `SampleHandoff` exported for the fixture-round-trip test's existing assertion (it's now an alias).

### `product/ts-common/src/__tests__/fixtures.test.ts` (edit)

Replace the single `SampleHandoff parses…` case with three:

```ts
it("SampleHandoffQualified parses against HandoffPayloadSchema", () => { ... });
it("SampleHandoffReferredOut parses against HandoffPayloadSchema", () => { ... });
it("SampleHandoffDisqualified parses against HandoffPayloadSchema", () => { ... });
```

Plus two reject-path assertions (the only negative tests in the file; kept tight):

```ts
it("rejects a qualified payload with a referred_out reason code", () => {
  const bad = { ...SampleHandoffQualified, reason: { code: "below_profit_floor", text: "x" } };
  expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
});
it("rejects a disqualified payload that carries a contact field", () => {
  const bad = { ...SampleHandoffDisqualified, contact: { name: "x", email: "x@y.z" } };
  // Disqualified schema doesn't declare contact. Per-verdict `.strict()` required on
  // HandoffPayloadDisqualifiedSchema for this assertion to bite — add if not already.
  expect(HandoffPayloadSchema.safeParse(bad).success).toBe(false);
});
```

The second test is the concrete reason to add `.strict()` on `HandoffPayloadDisqualifiedSchema` (and arguably all three). `.strict()` adds the "no extra fields" guarantee — belt-and-braces against future callers accidentally leaking `contact` into a disqualified record.

### `product/ts-common/src/index.ts`

No change — barrel re-exports `./handoff.js` already; new named exports flow through automatically.

---

## Content-as-data compliance

No prose strings added to code. The codes themselves are *identifiers*, not content; they're the machine-readable half of the `{code, text}` pair. The human-facing half (`text`) is agent-authored at runtime. The handoff **email template** (G) renders verdict + code into human copy — that's the data-as-data surface, lives in `product/cms/templates/handoff-email.md`, authored by G. E.t1 just names the codes.

The same rationale as decision D.13 (cms/errors/en.json): frozen enums that change via code-review PR, not a content-editor workflow, can live in TypeScript without violating the `cms/` charter.

---

## Shared contracts touched

- **`HandoffPayload`** — the shape written by E.t2's `handoff_submit` handler, consumed by E.t3's email renderer, asserted on by H. Narrowed per-verdict reasons mean downstream `switch(payload.verdict)` blocks exhaustively cover `payload.reason.code`.
- **`SessionState.triage.reasonCode`** — **unchanged** (stays freeform). The classifier placeholder per B.15 writes its own code (`"triage_classifier_placeholder"`) which isn't a `QualifiedReasonCode` member. Final session→handoff reason-code mapping is a G.t0 concern — the translator that produces the handoff `reason.code` from `session.triage.reasonCode` lands in E.t3 or earlier.
- **`HandoffSubmitInput`** (in `tools.ts`) — unchanged. The tool-input shape is the widget→connector wire format; the final `HandoffPayload` is built connector-side from the tool input + session state + the classifier's verdict. Keep the two schemas separate; E.t2 defines the builder.

---

## Coordination with siblings

- **`planner-d6` (D.t6 session handling)** — no intersection. D.t6 touches session lifecycle; E.t1 touches the terminal-state payload. If D.t6 needs a new session field (e.g. `lastPingAt`) it lands in `session.ts`, not here. Nothing to agree.
- **`planner-d7` (mobile reflow)** — no intersection.
- **`planner-h` (H harness)** — H asserts on `HandoffPayload` verdict + `reason.code`. The per-verdict enums mean H can write `expectHandoff({ verdict: "qualified", reasonCode: "group_tour_intent" })` as a typed assertion. Coordination recorded in the F-a plan.

---

## Verification

1. `npm --workspace @swoop/common run typecheck` passes — narrowed enums don't break `@swoop/common` itself.
2. `npm --workspace @swoop/common test` passes — three new round-trip cases + two reject-path cases green. The existing `SampleHandoff` alias still parses (back-compat).
3. `npm --workspace @swoop/orchestrator run typecheck` passes — the orchestrator currently imports `HandoffPayload` only from fixtures flow; narrowing the reason field doesn't surface a caller break.
4. `grep -R "HandoffReason\b" product/` shows only the handoff module itself (no external caller references the deprecated freeform shape).
5. A quick `tsc --noEmit` against a deliberately-bad fixture (qualified + disqualified code) surfaces a type error in the editor, not just at runtime. This is the "schema-as-code catches drift" win — validated by authoring the second reject-path test above.

Running locally from `product/`:

```bash
npm run typecheck
npm --workspace @swoop/common test
```

Both green → E.t1 is done.

---

## Open sub-questions returned to Tier 2 / G.t0

- Mapping from `session.triage.reasonCode` (placeholder strings today) to `HandoffPayload.reason.code` (this plan's enum) — lives in E.t3 once G.t0 has refined the taxonomy. E.t1 doesn't block on this.
- Whether the `_other` catch-all codes should carry a required non-empty text field (currently `z.string().min(1)` — already enforced; no change needed).
- Whether reason codes should be versioned (`ready_booking_named_trip@v1`) — deferred; add when we actually rename one.

---

## Handoff

E.t2 consumes this finalised schema + the `HandoffSubmitConsentGate` type-only contract. E.t3 indexes email routing on `verdict` and (for qualified) on `reason.code`. G.t0's HITL output may rename codes — path for that is a `ts-common` PR, CI catches any fixture drift, downstream consumers update their `switch` statements with exhaustive-match support from the compiler.
