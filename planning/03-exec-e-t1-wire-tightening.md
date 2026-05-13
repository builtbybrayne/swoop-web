## 03 — Execution: E.t1 wire-tightening (VERDICT-E.t1)

**Task code**: `VERDICT-E.t1` (custom `verdict-aware wire schema` prefix — chosen to avoid numeric-id collision with parallel Tier-3 plan authors per 2026-05-13 dispatch session).

**Task**: complete the E.t1 schema work by tightening the two upstream schemas where `reasonCode` is still freeform `z.string()`. The durable-record contract `HandoffPayloadSchema` is already a discriminated union with per-verdict reason enums (closed by inline patches per the 2026-04-30 review); the gap is at the upstream boundaries:

| Schema | File:line | Current | Target |
|---|---|---|---|
| `HandoffInputSchema` (agent tool-call args) | [product/ts-common/src/tools.ts:76-87](../product/ts-common/src/tools.ts) | `verdict: z.enum(...)` + `reasonCode: z.string()` (freeform) | `z.discriminatedUnion('verdict', […])` with per-verdict reason-code enums |
| `HandoffSubmitRequestSchema` (widget → orchestrator wire) | [product/ts-common/src/handoff.ts:331-349](../product/ts-common/src/handoff.ts) | `verdict: HandoffVerdictSchema` + `reasonCode: z.string().min(1)` (freeform) | `z.discriminatedUnion('verdict', […])` mirroring `HandoffPayloadSchema`'s reason structure |

**Chunk**: E (handoff & compliance). Originally Tier-3 plan: [planning/03-exec-handoff-t1.md](03-exec-handoff-t1.md). That plan landed `HandoffPayloadSchema` as discriminated; this plan completes the upstream tightening it intentionally deferred (the wire shapes were left loose pending HITL clarity on agent-side classifier behaviour).

**Implements**: 2026-05-13 user instruction "do the wire-tightening" — proceed with the discriminated-union extension of HandoffInputSchema + HandoffSubmitRequestSchema so invalid `(verdict, reasonCode)` combinations are caught at the agent boundary and the widget boundary, not late at the server-side enrichment + `HandoffPayloadSchema` parse.

**Depends on**:
- E.t1 original landing — the per-verdict reason-code enums already exist in [handoff.ts:51-96](../product/ts-common/src/handoff.ts) (`QualifiedReasonCodeSchema`, `ReferredOutReasonCodeSchema`, `DisqualifiedReasonCodeSchema`, `InconclusiveReasonCodeSchema`).
- BF-FO-v3 merged (no overlap; cleanup only).

**Produces**:
- `product/ts-common/src/tools.ts` — **edit** — `HandoffInputSchema` becomes a discriminated union over `verdict`, with per-variant `reasonCode` typed against the existing per-verdict enums from `handoff.ts`.
- `product/ts-common/src/handoff.ts` — **edit** — `HandoffSubmitRequestSchema` becomes a discriminated union with the same per-variant `reasonCode` enums; `contact` made required-on-qualified/referred_out + absent-on-disqualified/inconclusive via `.strict()` per-variant. Mirrors `HandoffPayloadSchema`'s structure.
- `product/ts-common/src/__tests__/fixtures.test.ts` — **edit** — round-trip + reject-path cases for the new discriminated unions.
- `product/connector/src/tools/handoff.ts` — **no behavioural change required** — the handler is a thin token-issuer; the schema change propagates via the import. But the input type changes shape (discriminated union with optional `contact` on variants), so verify it compiles + handler tests still pass.
- `product/ui/src/widgets/lead-capture.tsx` — **edit** — `safeParse(HandoffInputSchema, props.args)` continues to work; downstream consumers of the typed `args` get narrower types for free via the discriminator. Confirm no explicit `args.reasonCode` cast bypasses the narrowing.
- `product/orchestrator/src/server/handoff-submit.ts` (or wherever the route handler lives) — **edit if needed** — the `HandoffSubmitRequestSchema` parse already happens at the route boundary; the schema shape change is wire-compatible at the parse-or-reject level.
- `product/cms/prompts/tools/handoff/description.md` — **edit** — list the 21 per-verdict reason codes so Sonnet's tool-call output learns the valid combinations. This is the prose Sonnet reads to pick a code; the schema enforces compliance.
- `planning/decisions.md` — append entries `E.verdict-1..N` (numbered with the `verdict-` prefix to avoid collision).
- `progress.md`, `next-steps.md` — orientation updates.

**Pairs with**: nothing in-flight. Parallel: BATCH-C.t6 runs in the same session against a separate workspace (`@swoop/ingestion`).

**Blocks**: nothing. The durable record continues to work; this just adds an earlier validation surface.

**Out of scope**:
- Session-side reason-code taxonomy (`product/ts-common/src/session.ts:51,58,65,78`) — those four sites stay freeform per decision B.15 (session.triage.reasonCode is the classifier placeholder; G.t0 will refine).
- Event-log reason fields (`product/ts-common/src/events.ts:112`) — observability surface, freeform is the right call.
- Harness `scenario.ts` / `assertions.ts` reasonCode fields — match-any-code semantics; freeform is correct for eval assertions.
- Email-template text content (G concern).
- E.t5 (legal copy authoring).

**Estimate**: ~45–60 min TDD. Two schema rewrites, one tool-description prose update, ~6 new tests, plumbing verification.

---

## ★ Read this first — why this is hygiene, not new behaviour

The durable record `HandoffPayloadSchema` is already a discriminated union. The submit route's `enrichPayload` pulls the verdict + reasonCode + reasonText from the wire request, builds the full payload, and parses against `HandoffPayloadSchema`. So today's flow:

```
agent emits  →  HandoffInputSchema parse (loose: reasonCode = string)
            →  widget posts  →  HandoffSubmitRequestSchema parse (loose: reasonCode = string)
            →  server enriches  →  HandoffPayloadSchema parse (STRICT: per-verdict enum)
```

Invalid combinations like `verdict: 'disqualified' + reasonCode: 'group_tour_intent'` are caught only at step 3. Operationally:

- **Agent emits a bad code**: today, the connector accepts it (the tool input parses; agent is happy), the widget renders the lead-capture form (it parses successfully against the loose schema), the visitor fills it in, the widget POSTs to the server, the server enriches, the final `HandoffPayloadSchema.parse` throws, the `handoff_submit` route returns `{ok: false, reason: 'invalid_request', detail: ...}`. The visitor sees a generic error after filling the form. Bad UX, late detection.
- **After this tightening**: the connector rejects the tool input (Anthropic's tool-call validation surfaces it back to the agent, which can self-correct on next turn). The widget never renders. The visitor never sees a confused error.

This is the right place for the constraint. Schema-as-contract.

The same logic applies to the widget→server wire: if a bug in the widget ever passes an unmodified `reasonCode` that doesn't match the verdict, the server rejects at the boundary, not at the `HandoffPayloadSchema` parse downstream. Cleaner error path; easier debugging.

---

## 1. Outcome

When this task is done:

- `HandoffInputSchema` exports as a discriminated union with four variants. Each variant carries `verdict: z.literal(...)` + `reasonCode` typed against the matching per-verdict enum from `handoff.ts`.
- `HandoffSubmitRequestSchema` mirrors that shape.
- `lead-capture.tsx` continues to render correctly for all four verdicts; types narrow via the discriminator (no `as any` casts needed).
- `handoff/description.md` (CMS) lists the 21 per-verdict reason codes so Sonnet learns the legal combinations.
- All workspaces typecheck + test cleanly on fresh install.
- `decisions.md` carries `E.verdict-1..N`.

Not outcomes:
- Behavioural change to the handoff flow.
- Updates to the connector handler (the handler is verdict-agnostic).
- Touch to session.ts / events.ts / harness assertions.
- UI copy changes (E.t5 still pending).

---

## 2. Target functionalities

### 2.1 `HandoffInputSchema` discriminated union (`product/ts-common/src/tools.ts`)

Current (single object, freeform reasonCode):

```ts
export const HandoffInputSchema = z.object({
  verdict: z.enum([
    "qualified",
    "referred_out",
    "disqualified",
    "inconclusive",
  ]),
  reasonCode: z.string(),
  conversationSummary: z.string(),
  motivationAnchor: z.string(),
});
```

New (discriminated union over verdict, per-variant `reasonCode` typed against the per-verdict reason-code enums from `handoff.ts`):

```ts
import {
  QualifiedReasonCodeSchema,
  ReferredOutReasonCodeSchema,
  DisqualifiedReasonCodeSchema,
  InconclusiveReasonCodeSchema,
} from "./handoff.js";

// Shared fields across every variant.
const HandoffInputCommonFields = {
  conversationSummary: z.string(),
  motivationAnchor: z.string(),
} as const;

export const HandoffInputQualifiedSchema = z.object({
  verdict: z.literal("qualified"),
  reasonCode: QualifiedReasonCodeSchema,
  ...HandoffInputCommonFields,
}).strict();

export const HandoffInputReferredOutSchema = z.object({
  verdict: z.literal("referred_out"),
  reasonCode: ReferredOutReasonCodeSchema,
  ...HandoffInputCommonFields,
}).strict();

export const HandoffInputDisqualifiedSchema = z.object({
  verdict: z.literal("disqualified"),
  reasonCode: DisqualifiedReasonCodeSchema,
  ...HandoffInputCommonFields,
}).strict();

export const HandoffInputInconclusiveSchema = z.object({
  verdict: z.literal("inconclusive"),
  reasonCode: InconclusiveReasonCodeSchema,
  ...HandoffInputCommonFields,
}).strict();

export const HandoffInputSchema = z.discriminatedUnion("verdict", [
  HandoffInputQualifiedSchema,
  HandoffInputReferredOutSchema,
  HandoffInputDisqualifiedSchema,
  HandoffInputInconclusiveSchema,
]);
export type HandoffInput = z.infer<typeof HandoffInputSchema>;
```

**Type narrowing benefit**: a consumer that does `if (args.verdict === 'qualified') { ... }` gets `args.reasonCode: QualifiedReasonCode` (the enum) for free. The lead-capture widget's verdict-specific rendering already branches on `args.verdict` — types narrow naturally.

**`.strict()` rationale**: belt-and-braces against accidental field leakage (e.g. the agent emits a `contact` field on the input — current schema accepts it silently; new schema rejects). The handler shouldn't see anything other than the four declared fields.

### 2.2 `HandoffSubmitRequestSchema` discriminated union (`product/ts-common/src/handoff.ts`)

Current (single object, freeform reasonCode, optional contact):

```ts
export const HandoffSubmitRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    verdict: HandoffVerdictSchema,
    reasonCode: z.string().min(1),
    reasonText: z.string().min(1),
    motivationAnchor: z.string().optional(),
    contact: HandoffContactSchema.optional(),
    consent: z.object({...}),
  })
  .strict();
```

New (per-variant, mirroring `HandoffPayloadSchema`'s contact-required-or-absent shape):

```ts
const HandoffSubmitRequestCommonFields = {
  sessionId: z.string().min(1),
  reasonText: z.string().min(1).max(500),
  motivationAnchor: z.string().optional(),
  consent: z.object({
    handoffGranted: z.boolean(),
    handoffTimestamp: z.string().datetime(),
    marketingGranted: z.boolean().optional(),
    marketingTimestamp: z.string().datetime().optional(),
    consentCopyVersion: z.string().optional(),
  }),
} as const;

export const HandoffSubmitRequestQualifiedSchema = z.object({
  verdict: z.literal("qualified"),
  reasonCode: QualifiedReasonCodeSchema,
  contact: HandoffContactSchema,
  ...HandoffSubmitRequestCommonFields,
}).strict();

export const HandoffSubmitRequestReferredOutSchema = z.object({
  verdict: z.literal("referred_out"),
  reasonCode: ReferredOutReasonCodeSchema,
  contact: HandoffContactSchema,
  ...HandoffSubmitRequestCommonFields,
}).strict();

export const HandoffSubmitRequestDisqualifiedSchema = z.object({
  verdict: z.literal("disqualified"),
  reasonCode: DisqualifiedReasonCodeSchema,
  // No contact on disqualified; .strict() rejects if a buggy client supplies it.
  ...HandoffSubmitRequestCommonFields,
}).strict();

export const HandoffSubmitRequestInconclusiveSchema = z.object({
  verdict: z.literal("inconclusive"),
  reasonCode: InconclusiveReasonCodeSchema,
  // No contact on inconclusive (matches HandoffPayloadInconclusiveSchema).
  ...HandoffSubmitRequestCommonFields,
}).strict();

export const HandoffSubmitRequestSchema = z.discriminatedUnion("verdict", [
  HandoffSubmitRequestQualifiedSchema,
  HandoffSubmitRequestReferredOutSchema,
  HandoffSubmitRequestDisqualifiedSchema,
  HandoffSubmitRequestInconclusiveSchema,
]);
export type HandoffSubmitRequest = z.infer<typeof HandoffSubmitRequestSchema>;
```

**Contract enforcement at the wire**: today's `contact: HandoffContactSchema.optional()` means a buggy widget can submit a `disqualified` verdict with a contact block (visitor PII leak). After tightening, the server rejects the request with a clean `{ok: false, reason: 'invalid_request'}`.

**`reasonText` cap of 500 chars**: mirrors the cap on `HandoffPayloadSchema`'s reason.text. The wire shouldn't accept a longer string than the durable record can persist.

### 2.3 Plumbing changes

**`product/connector/src/tools/handoff.ts`** — no edits needed. The handler is verdict-agnostic (it just issues a widgetToken). Existing tests continue to pass.

**`product/ui/src/widgets/lead-capture.tsx`** — verify the existing `safeParse(HandoffInputSchema, props.args)` continues to work. The discriminated union narrows via `args.verdict`, and the file already branches on that (`args.verdict === 'disqualified'`). Confirm no explicit `args.reasonCode` cast bypasses the narrowing. **Likely consequence**: the existing UI typecheck errors flagged in inbox (`'args' is of type 'unknown'`) may resolve incidentally because the discriminator gives TypeScript stronger inference. If not, that's a separate cleanup not blocking this plan.

**`product/orchestrator/src/server/handoff-submit.ts`** (or equivalent path) — the route handler parses `HandoffSubmitRequestSchema`. After tightening, parse failures on invalid `(verdict, reasonCode)` combinations surface naturally as `{ok: false, reason: 'invalid_request'}`. The `enrichPayload` function then continues to build the durable payload from the parsed (now-discriminated) request.

**Tool description prose** (`product/cms/prompts/tools/handoff/description.md`) — append a section listing the 21 valid `(verdict, reasonCode)` combinations. Sonnet reads this at tool-selection time + understands the constraint.

### 2.4 Tests

**`product/ts-common/src/__tests__/fixtures.test.ts`** — extend with:

1. `HandoffInputSchema` round-trips a `qualified` sample with `reasonCode: 'ready_booking_named_trip'`.
2. `HandoffInputSchema` rejects `verdict: 'qualified' + reasonCode: 'low_engagement'` (wrong verdict).
3. `HandoffInputSchema` rejects `verdict: 'disqualified' + reasonCode: 'unknown_code_123'` (not in any enum).
4. `HandoffSubmitRequestSchema` round-trips a `disqualified` sample WITHOUT contact (correct).
5. `HandoffSubmitRequestSchema` rejects a `disqualified` sample WITH contact (.strict() bites).
6. `HandoffSubmitRequestSchema` rejects an `inconclusive` sample WITH contact (.strict() bites).
7. `HandoffSubmitRequestSchema` round-trips a `qualified` sample WITH contact (correct).
8. `HandoffSubmitRequestSchema` rejects a `qualified` sample WITHOUT contact (discriminator-required field).

Optionally extend fixtures (`product/ts-common/src/fixtures/handoff.sample.ts`) to add inputs covering each verdict.

### 2.5 Tool description rewrite

[product/cms/prompts/tools/handoff/description.md](../product/cms/prompts/tools/handoff/description.md) — append a section near the bottom that lists every valid combination:

```
**Verdict + reasonCode catalogue.** Pick ONE reasonCode per verdict from
this list — the schema enforces verdict-specific codes.

qualified:
  - ready_booking_named_trip       (visitor named a trip + booking-adjacent ask)
  - ready_comparing_shortlist      (visitor down to 2–3 options)
  - budget_and_timeline_confirmed  (commercial basics explicit and in-scope)
  - group_tour_intent              (strong small-group signal — Luke priority)
  - bespoke_request                (private guide / custom combination)
  - qualified_other                (catch-all)

referred_out:
  - below_profit_floor             (budget under <$1k profit threshold)
  - out_of_region                  (destination Swoop doesn't serve in Puma)
  - timing_outside_window          (off-season / too-soon)
  - referred_other                 (catch-all)

disqualified:
  - backpacker_no_budget           (no-budget / free-info-only)
  - off_brand_query                (asking about something outside Swoop)
  - proxy_to_claude                (using chat as coding/Claude proxy)
  - disqualified_other             (catch-all)

inconclusive:
  - low_engagement                 (very few turns; no signal)
  - mixed_signals                  (contradictory cues)
  - extended_no_convergence        (long chat, never narrowed)
  - comparison_shopping            (researching before booking elsewhere)
  - off_offer_in_region            (in-region but Puma can't help)
  - drive_by                       (clicked speculatively, never engaged)
  - inconclusive_other             (catch-all)
```

(Wording matches the trigger summaries in `planning/03-exec-handoff-t1.md` so Sonnet's tool-selection prose stays consistent.)

### 2.6 Decisions to log

Append to `planning/decisions.md`:

- **E.verdict-1** — `HandoffInputSchema` is a discriminated union over `verdict`; `reasonCode` is per-verdict enum. Rationale: surface invalid `(verdict, reasonCode)` combinations at the agent boundary, not late at the server-side `HandoffPayloadSchema` parse. Mirrors `HandoffPayloadSchema`'s structure.
- **E.verdict-2** — `HandoffSubmitRequestSchema` is a discriminated union with the same shape; `contact` becomes required-on-qualified/referred_out + absent-on-disqualified/inconclusive (matches `HandoffPayloadSchema`). `.strict()` rejects fields that don't belong on the variant. Rationale: same surface-validation reasoning.
- **E.verdict-3** — Session-side `reasonCode` (`session.ts:51,58,65,78`) and event-log `reasonCode` (`events.ts:112`) stay freeform `z.string()`. The session-side field is the classifier placeholder (decision B.15); the event-log field is an observability surface. Wire/handoff-side tightening is the right scope; broader tightening costs more than it buys.
- **E.verdict-4** — Tool description (`cms/prompts/tools/handoff/description.md`) lists all 21 valid `(verdict, reasonCode)` combinations so Sonnet learns the constraint via prose; the schema enforces it. Pattern: schema-as-validator + prose-as-teacher. Same shape G.11 applied for all tool descriptions.

---

## 3. Architectural principles applied here

- **Single source of truth for reason-code enums**: per-verdict enums live ONCE, in `handoff.ts`. Both `HandoffInputSchema` (agent surface) and `HandoffSubmitRequestSchema` (wire surface) import them. No drift possible.
- **Discriminator-driven narrowing**: every variant carries `verdict: z.literal(...)`. TypeScript narrows automatically; consumers don't need `as` casts.
- **`.strict()` everywhere**: variants reject unknown fields. Belt-and-braces against accidental leakage (e.g. contact on a disqualified record).
- **Schema-as-validator, prose-as-teacher**: the schema enforces; the tool description teaches Sonnet what combinations are legal. Same shape as G.11.
- **No behavioural change**: the handoff flow's runtime semantics are unchanged. This is purely about where the validation surfaces.

---

## 4. Implementation order

TDD throughout.

1. Write the 8 new fixture-test cases in `__tests__/fixtures.test.ts` against the planned schema shape (failing — schemas still freeform).
2. Refactor `HandoffInputSchema` in `tools.ts` to the discriminated union.
3. Refactor `HandoffSubmitRequestSchema` in `handoff.ts` to the discriminated union.
4. Run `@swoop/common` workspace tests; confirm green.
5. Run `@swoop/connector` typecheck + tests; address any drift (handler should still compile).
6. Run `@swoop/ui` tests; confirm `lead-capture.tsx` still typechecks.
7. Run `@swoop/orchestrator` typecheck + tests; the route handler may need a minor cast adjustment if it accessed pre-discriminated fields directly.
8. Tool-description prose update.
9. Decisions + orientation docs.
10. Fresh-install verification.

---

## 5. Verification

```bash
cd /Users/al/Studio/projects/swoop_web/.claude/worktrees/jolly-pasteur-77252a
pwd  # must end in .claude/worktrees/jolly-pasteur-77252a

cd product
rm -rf node_modules */node_modules
npm install
npm test --workspaces --if-present  # all green; +~8 tests on @swoop/common
```

Sweep checks:

```bash
grep -rn "reasonCode: z.string" product/ts-common/src
# Expected: session.ts (4 hits, deliberately freeform) only. No tools.ts or handoff.ts hits.

grep -rn "reasonCode:" product --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v dist
# Expected: typed reads at the consumer sites; no freeform z.string declarations
# outside session.ts.
```

---

## 6. HITL questions

**None expected.** The reason-code taxonomy is settled (in `handoff.ts` and the original E.t1 plan). This task is mechanical: import the existing enums into the upstream schemas.

Items that may surface during execution:
- If `lead-capture.tsx` has cast-bypassed the discriminator (e.g. `args.reasonCode as string` anywhere), the cast needs removing in favour of `args.verdict === 'qualified' ? args.reasonCode : ...`. Tests should catch.
- If the orchestrator's `handoff-submit.ts` route reads `req.reasonCode` directly without narrowing on `req.verdict`, the typecheck will error after the change. Fix with a switch on `verdict`.

---

## 7. References

- [planning/03-exec-handoff-t1.md](03-exec-handoff-t1.md) — original E.t1 plan + the 21-code taxonomy.
- [product/ts-common/src/handoff.ts](../product/ts-common/src/handoff.ts) — existing per-verdict enums + discriminated `HandoffPayloadSchema`.
- [product/ts-common/src/tools.ts](../product/ts-common/src/tools.ts) — `HandoffInputSchema` to tighten.
- [product/ui/src/widgets/lead-capture.tsx](../product/ui/src/widgets/lead-capture.tsx) — widget consumer.
- [product/cms/prompts/tools/handoff/description.md](../product/cms/prompts/tools/handoff/description.md) — tool description to extend.
- [planning/reviews/2026-04-30-state-of-play.md](reviews/2026-04-30-state-of-play.md) — confirms the per-verdict enums were "closed by inline patches" 2026-04-30; this plan closes the upstream gap left at that pass.

---

## Execution log

(To be filled in as the work progresses.)

### 2026-05-13 — Plan authored

Tier-3 plan written by primary session in worktree `jolly-pasteur-77252a` after the BF-FO-v3 merge to main (`c5a475b`). State surfaced during the session: the durable-record contract is already tight; the upstream wires are the remaining gap. Plan authored after user confirmed wire-tightening should proceed.

### 2026-05-13 — Implementation landed (same session, after BATCH-C.t6)

TDD throughout. Three change clusters:

1. **Test extension** (`product/ts-common/src/__tests__/fixtures.test.ts`): +10 new assertions on the per-verdict round-trip + reject paths. All initially failing against the freeform schemas (proves the test pins the new contract).
2. **Schema refactor** (`product/ts-common/src/tools.ts` + `handoff.ts`): `HandoffInputSchema` becomes a `z.discriminatedUnion('verdict', […])` with per-variant `reasonCode` typed against the existing per-verdict enums imported from `handoff.ts`. `HandoffSubmitRequestSchema` mirrors the same shape; `contact` required-on-qualified/referred_out + absent-on-disqualified/inconclusive via `.strict()`. `reasonText` cap of 500 chars added to mirror the durable record.
3. **Consumer drift fixes**: 4 sites needed adjustment.
   - `product/orchestrator/src/server/__tests__/handoff-submit.test.ts:123`: `validRequestBody` helper's `Partial<HandoffSubmitRequest>` widened the discriminator through spread; refactored to `Record<string, unknown>` overrides + `as HandoffSubmitRequest` return cast.
   - Same file line 333: assertion `expect(detail).toContain('contact is required')` → loosened to `toMatch(/contact/i)` + `toMatch(/required/i)` (Zod's discriminated-union error path emits `'contact: Required'` not the custom string).
   - `product/connector/src/server/__tests__/mcp.test.ts:106`: test payload `reasonCode: 'ready_to_book'` (freeform placeholder) → `reasonCode: 'ready_booking_named_trip'` (valid qualified enum value).
   - `product/connector/src/tools/index.ts`: `registerOne` previously read `.shape` off the input schema; for a discriminated union `.shape` is undefined. Added `extractDiscriminatedUnionShape` helper that pulls the first variant's shape + widens the discriminator field to `z.enum([…all-literals])`. Permissive at the MCP advertising layer; strict runtime narrowing via `runHandler.safeParse` against the full union.

**Test totals after this landing**: `@swoop/common` 160 → 170 (+10), `@swoop/orchestrator` 170 (2 tests updated for the new wire shape), `@swoop/connector` 152 (1 test fixture updated). Total: 948 → 958 (+10, all 6 workspaces green).

**Deviations from the plan**:
1. **No `lead-capture.tsx` widget edits needed**. The widget's existing `safeParse(HandoffInputSchema, props.args)` continues to work — TypeScript narrows for free via the discriminator. Pre-existing typecheck errors (`'args' is of type 'unknown'`) are unchanged in scope; updated inbox note.
2. **No `handoff_submit` route edits needed**. The route handler's `HandoffSubmitRequestSchema.safeParse` continues to surface variant-specific failures cleanly as `{ok: false, reason: 'invalid_request'}`. The detail string is what changed (Zod's path-prefixed error), not the route logic.
3. **`extractDiscriminatedUnionShape` is new** (decision E.verdict-5, unplanned). The plan §6 anticipated runtime parse failures might surface but didn't predict the MCP-side registration shape mismatch. Added as a discrete helper rather than special-casing the handoff spec — applies to any future discriminated-union input schema (e.g. if `handoff_submit`'s input is ever exposed via MCP, or if a future tool surfaces a polymorphic input).
4. **Plan §2.6 originally listed 4 decisions; landed 5** (added E.verdict-5 for the MCP shape extraction).

**Items surfaced for downstream**:
- Pre-existing `@swoop/ui` typecheck errors (24 across 7 widget files) widened scope from "lead-capture only" to "all D.t9 widgets". Inbox note updated. Not caused by VERDICT-E.t1; revisit as a discrete cleanup.

**Hand-off**:
- `progress.md` updated with the 2026-05-13 entry.
- `next-steps.md` E.t1 item flipped to ✅ closed.
- `decisions.md` carries E.verdict-1..5.
- `cms/prompts/tools/handoff/description.md` lists all 21 valid `(verdict, reasonCode)` combinations.
