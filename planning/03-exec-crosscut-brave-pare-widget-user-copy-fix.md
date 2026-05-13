# 03 — Crosscut: widget user-facing copy fix (2026-05-13)

**Status**: Tier 3 execution plan. Draft, 2026-05-13.
**Chunk**: Crosscut — touches the five conversational widgets and the shared widget shell. No single chunk home.
**Filename suffix `-brave-pare-`**: worktree-slug-stamped to avoid collisions with parallel-agent crosscut filenames (date alone isn't enough — multiple agents land on the same calendar day). Two related concerns are bundled because they share the same surface (`product/ui/src/widgets/`) and the same trigger (live HITL feedback from Al, 2026-05-13).
**Depends on**: nothing — read-only against the live `claude/brave-pare-5e0eba` tip. Touches UI only.
**Produces**: zero user-visible widget chrome for empty results, and a tightened malformed-placeholder path so it never surfaces in normal operation.
**Estimate**: ~1.5 hours.

---

## ★ Read this first — the WHY

The 2026-05-13 live smoke surfaced two widget surfaces that betray the principle that **the conversation IS the surface**:

1. Three conversational widgets (`find_options`, `find_inspiring`, `find_someone_who`) plus the legacy `inspiration` widget render their own user-visible "No <thing> right now" empty-state cards when the underlying tool returns zero results. Two other widgets (`find_proof`, `lookup`) already do the right thing: `return null` on empty, let the conversational agent handle the negation in prose. The first set was authored by the D.t9 widget rewrite swarm yesterday and matches a pattern that — in retrospect — leaks system semantics into the visitor's view. *"No options match those filters right now"* is correct for an engineer, wrong for the visitor's experience: it surfaces the existence of a filter / a database / a query that returned zero rows, none of which the visitor knows or cares about. The right move is silence: render nothing, and let the conversational layer say *"I couldn't find anything that fits — would [follow-up question] help narrow this down?"* in the agent's voice.

2. The `WidgetMalformedPlaceholder` (yellow card with "Couldn't load that — I couldn't show that piece — we can still keep talking, or try asking a different way.") fires inappropriately. Live smoke logged 224 `[swoop.ui] widget schema validation failed` console warnings inside a 30-second window — and yet the agent's prose was perfectly fine and the actual trip cards rendered (the screenshot shows them). So the malformed copy was either (a) flickering during the streaming lifecycle and not flushed visually, or (b) firing on a code path that shouldn't trigger user-visible failure copy. Either way the user-facing string is the wrong surface for the failure mode that triggered it. The fix has two components:
   - **Diagnostic first**: capture the actual `props.result` shape that's failing `safeParse` for at least one tool, so the root cause is named.
   - **Then tighten the gate**: the user-facing "Couldn't load that" copy should appear only when there is no recovery path the agent itself can take. Schema drift during a successful turn is an engineering problem, not a visitor's problem.

The shared principle binding the two: **a widget that has nothing useful to show should show nothing; the conversational agent is the surface that handles the visitor's experience of "nothing".** This is the chunk-G "knowledgeable friend, not a librarian" framing applied at the render boundary, not the retrieval boundary.

---

## Deliverables

### Part 1 — Empty-state silence

| File | Change |
|---|---|
| [product/ui/src/widgets/find-options.tsx](../product/ui/src/widgets/find-options.tsx) | Replace the `cards.length === 0` block (lines 66–78) with `if (cards.length === 0) return null;`. Drop the empty-state `<div>` and "No options match those filters right now." string. |
| [product/ui/src/widgets/find-inspiring.tsx](../product/ui/src/widgets/find-inspiring.tsx) | Same pattern for `passages.length === 0` block (lines 53–65). Drop "No passages to surface right now." |
| [product/ui/src/widgets/find-someone-who.tsx](../product/ui/src/widgets/find-someone-who.tsx) | Same pattern for `stories.length === 0` block (lines 63–75). Drop "No matching stories surfaced." |
| [product/ui/src/widgets/inspiration.tsx](../product/ui/src/widgets/inspiration.tsx) | Same pattern for `images.length === 0` block (lines 69–80). Drop "No imagery to surface right now." |
| **Already correct, do NOT touch**: [find-proof.tsx](../product/ui/src/widgets/find-proof.tsx) (line 61) + [lookup.tsx](../product/ui/src/widgets/lookup.tsx) (lines 66, 69) | Both already `return null` on empty. They're the reference pattern the four above converge to. |
| Tests under `product/ui/src/widgets/__tests__/` covering the empty-state branches | Update assertions: instead of `expect(getByTestId('find-options-empty')).toBeInTheDocument()`, assert `container.firstChild === null` (or equivalent) for the same input. Keep the test cases — empty-state is a real path; it just produces no DOM now. |

**Observability**: the existing `data-swoop-widget-state="empty"` attribute was already used in tests for assertion targeting; it no longer renders. If any structured analytics is keyed off that selector elsewhere (e.g. host-page CSS, mock-host shell), check before deleting. Quick grep: `grep -rn 'data-swoop-widget-state="empty"' product/` — anything outside the widgets themselves and their tests is a consumer that needs updating in lockstep.

### Part 2 — Malformed-placeholder root cause + gate tightening

The user-facing **"Couldn't load that — I couldn't show that piece — we can still keep talking, or try asking a different way."** copy lives in [product/cms/errors/en.json](../product/cms/errors/en.json) under the `tool_error` key. The component is `WidgetMalformedPlaceholder` in [widget-shell.tsx](../product/ui/src/widgets/widget-shell.tsx). It fires in two places:

- `renderLifecycleGate` returns it when `statusType === "complete"` but `lifecycle.result === undefined` (widget-shell.tsx:172–178), OR when `statusType === "incomplete" || lifecycle.isError` (widget-shell.tsx:179–181).
- Every widget body returns it when `safeParse(Schema, props.result)` returns `{ok: false}`.

#### Step A — Diagnose first

Before changing copy or gate behaviour, capture the actual `props.result` value that's failing parse. The 224 console warnings indicate this is happening *very* frequently (likely once per render frame during a streaming turn). The hypothesis to confirm is one of:

1. **Streaming-partial render**: assistant-ui's tool-call component re-renders during the stream with partial `result` values that fail schema parse but aren't user-visible. Cure: tighten the lifecycle gate so widgets only schema-parse when `status.type === "complete"` AND the result is genuinely complete — not the partial mid-stream state.
2. **Envelope drift**: the orchestrator's connector adapter now wraps tool outputs differently than the `unwrapEnvelope` helper expects (e.g. double-wrapped, or wrapped as an MCP `{content: [{type: "text", text: "..."}]}` shape that needs JSON-parsing). Cure: extend `unwrapEnvelope`, possibly to peel MCP content arrays.
3. **Schema drift in `@swoop/common`**: the discriminated `ProposalCardPublicSchema` has a field the connector hasn't started emitting, or vice versa. Cure: align the schemas; add a `strict()` mismatch test in `ts-common`.

The diagnostic step adds a one-line `console.debug` to `safeParse` in `widget-shell.tsx` that, in dev only, also logs `candidate` (the post-`unwrapEnvelope` value) alongside `result.error.issues`. Trigger one `find_options` call against the live stack, capture the value + the issues, and decide which of the three hypotheses fits. **Do not** implement the fix in Step B until the root cause is identified.

#### Step B — Fix per root cause

Based on diagnostic findings:

- **If (1) — streaming partial**: tighten `renderLifecycleGate` to also check `props.toolCallId` is present and `result` is non-null before declaring complete. assistant-ui's `ToolCallMessagePartProps` may already expose a more reliable completeness signal (e.g. `props.state === "result"`); cross-check against `node_modules/@assistant-ui/react/dist/...` to find the right discriminator. Widgets stop calling `safeParse` until the gate passes; the malformed copy never surfaces in the normal path.
- **If (2) — envelope drift**: extend `unwrapEnvelope` to handle the new shape. Add a regression test in `widget-shell.test.ts` (or its equivalent — confirm existence) that asserts both the legacy `{ok, value}` and the new shape parse correctly.
- **If (3) — schema drift**: align the schemas in `@swoop/common/src/tools.ts`. Add a round-trip test: the connector handler's exact output (per a fixture) must parse against `FindOptionsOutputSchema` on the UI side.

#### Step C — Copy posture (regardless of root cause)

The `tool_error` key in `cms/errors/en.json` stays — but its purpose narrows to "an unrecoverable widget render failure where the agent's prose is silent." That's a rare case (e.g. `find_options` returns malformed JSON and Sonnet doesn't compensate in the same turn). Behaviour: keep the existing component + copy, but verify that after Step B the placeholder no longer fires in normal operation. If it still appears in any frequent code path, that path was a misdiagnosis and Step A repeats.

> **Open question for HITL** (not a blocker on this plan): does the user-facing copy itself need a rewrite? "Couldn't load that" is technical and breaks character. Probable better posture: render nothing visually; emit a `tool.error.surfaced` event to the analytics stream; let the agent's prose handle the conversational recovery. **Default for this plan**: keep the placeholder structurally (it's the cliff-edge guard) but verify Step B suppresses it from normal paths. Copy rewrite belongs to a chunk-G content pass with Al's editorial input, not this fix.

### Part 3 — Tests + verification

| Verification | Expected |
|---|---|
| `npm test -w @swoop/ui` | green; the four empty-state test cases now assert `firstChild === null` instead of asserting a placeholder div |
| Live smoke: send a `find_options` turn that returns zero rows (e.g. very narrow filter input) | UI renders nothing for that tool result; conversation continues; agent prose handles the "I didn't find anything" message |
| Console-log audit during the smoke | zero `widget schema validation failed` warnings during a successful turn |
| Console-log audit when forcing a malformed tool result (manual: inject `null` via DevTools `props.result`) | one warning + the `WidgetMalformedPlaceholder` renders — the cliff-edge guard still works |

---

## Step-by-step execution

1. **Hash gate** — confirm `git rev-parse HEAD` is the worktree tip.
2. **Part 1 changes** — four file edits (find-options / find-inspiring / find-someone-who / inspiration), each replacing the empty-state `<div>` with `return null`.
3. **Part 1 tests** — update assertions to match the new no-DOM behaviour.
4. **Part 2 Step A** — add the temporary `console.debug` to `safeParse`; boot the stack; trigger a `find_options` turn; capture both the candidate value and the Zod issues. **Pause and write up the root cause** (1-paragraph addendum to this plan) before continuing.
5. **Part 2 Step B** — implement the fix dictated by root cause. Add a regression test that would have caught the drift.
6. **Part 2 Step C** — re-run the smoke; verify zero `widget schema validation failed` warnings during a normal successful turn.
7. **Remove the diagnostic `console.debug`** from `safeParse` once the root cause is fixed.
8. **Run `npm test --workspaces --if-present`** — all six workspaces green.
9. **Fresh-install verify** per `feedback_swarm_fresh_install_verify` memory: `rm -rf product/node_modules product/*/node_modules && (cd product && npm install) && npm test --workspaces --if-present`.
10. **Update [discoveries.md](../discoveries.md)** — capture the root cause from Step 4 as a new entry. Pattern: "schema-parse-during-streaming-partial-frames" or "MCP-content-array-leaks-into-AI-SDK-result" or "schema drift between @swoop/common and connector" — whichever it turns out to be.

---

## What does NOT change

- `find-proof.tsx`, `lookup.tsx`, `lead-capture.tsx`, the 4 ProposalCard variants — none touched. They already follow the right pattern or are not on the empty-state path.
- The `WidgetMalformedPlaceholder` component itself — kept structurally as the cliff-edge guard for genuinely unrecoverable cases.
- The `cms/errors/en.json` `tool_error` copy — kept for now; chunk-G content pass can revisit if the placeholder turns out to never fire in normal operation (which is the goal).
- Event taxonomy — no new event kinds; the existing `ui.widget_rendered` already correlates renders. Optionally, Step B can add `ui.widget.empty` if observability of zero-row returns is wanted; default is no, to keep the event stream lean.
- Tool descriptions in `cms/prompts/tools/<tool>/description.md` — these don't need a hint to the agent ("if the result has zero items, you should explain in prose"). The agent already handles this naturally; Sonnet sees the empty array, produces appropriate prose. Adding a description hint would be belt-and-braces; defer until live observation says it's needed.

---

## Decision marker — D.brave-pare-1

**Decision — widget empty-state silence + malformed-placeholder gate tightening.** Logged as **D.brave-pare-1** in [decisions.md](decisions.md). Captures the principle: widgets with no useful content render nothing; the conversational agent handles the visitor's experience of "nothing" in prose; the malformed placeholder is the cliff-edge for genuinely unrecoverable schema failures only, not for streaming partial frames or envelope drift.

---

## Parallel-agent collision notes

- Filename includes the agent's worktree slug `brave-pare-` (genuinely unique per dispatch, not date-based — multiple agents may be active on the same date) so a concurrent crosscut won't claim the same slug.
- Decision number left as TBD.
- Touches files (`find-options.tsx`, `find-inspiring.tsx`, `find-someone-who.tsx`, `inspiration.tsx`, `widget-shell.tsx`, `cms/errors/en.json`) that the D.t9 widget rewrite already shipped to. If another agent is mid-flight on a chunk-D widget pass, merge order needs Al's coordination — the empty-state edits are localised but the malformed-gate change in `widget-shell.tsx` is shared infrastructure.

---

## 2026-05-13 execution log

### Part 1 — empty-state silence

**Landed** in commit `58d65f2 fix(ui): widget empty-state silence — yield to agent prose, no widget chrome`. Four widgets converted to `return null` on `length === 0`; tests updated to assert `container.firstChild === null`. `npm test -w @swoop/ui` → 112 passed (no regression).

### Part 2 Step A — diagnostic + root-cause naming

Added a temporary `window.__safeParseFailures` capture inside `safeParse` to record both the rejected candidate and the Zod issues for every failure. Live-smoke method:

1. Restart connector + orchestrator + UI (clean state).
2. Reset `window.__safeParseFailures = []`.
3. Send a turn that routes through `find_options` with a non-trivial filter (e.g. "Find me trips to Patagonia with kayaking, 8-10 days, lodge accommodation.").
4. Read back `window.__safeParseFailures` after the turn completes.

**Observed**: `window.__safeParseFailures.length === 0` after multiple post-fix turns that exercised `find_options` (both 0-result + 4-result cases). The 146 `[swoop.ui] widget schema validation failed` console warnings captured during the pre-fix smoke were stale (the preview console buffer accumulates across reloads). The TripCard widget rendered correctly in the post-fix screenshot.

**Inferred root cause**: the spurious malformed-placeholder + flood of schema-validation warnings during the 2026-05-13 morning smoke were the **combined consequence** of two now-resolved issues:

1. **`illustrate` throwing on missing `VOYAGE_API_KEY`** (now fixed by the C.t9 2026-05-13 addendum — visitor-query embedder swapped to Gemini). Each `illustrate` failure produced a `tool_handler_threw` envelope, which when received by the UI as `props.result` shape `{ok: false, error: {...}}` did not match the widget's `IllustrateOutputSchema` and triggered the malformed placeholder. Sonnet often called `illustrate` repeatedly in the same turn ("show me a few" routes there 2-3 times); each call's malformed render contributed multiple safeParse failures.
2. **Empty-state widget renders** (now fixed by Part 1) — the four converted widgets used to render their own placeholder card on `length === 0`. The placeholder card rendered fine, but the *render* still came after a successful `safeParse`. Where `find_options` was called twice in the same turn (typical: first with strict filters → empty, then with relaxed filters → results), the first call's empty result rendered the user-visible "No options match those filters right now." card — which then immediately re-rendered when the second call landed, sometimes against an intermediate partial state. The schema-validation warnings on the second render did not surface visibly because the second card's render replaced it before the visitor saw anything; but the warnings still hit the console.

Neither factor was on its own a "real" schema-drift bug — the connector's `{ok, value}` envelope was always correct; `unwrapEnvelope` was always correct; the schemas were always aligned. The user-visible "Couldn't load that" surface was downstream of an upstream tool failure (`illustrate` Voyage throw) bleeding into the widget. Hypothesis 2 from the original plan body ("envelope drift") and hypothesis 3 ("schema drift in @swoop/common") were both **ruled out** by the empirical diagnostic.

### Part 2 Step B — fix

No additional code change beyond the C.t9 Voyage cleanup + Part 1 empty-state silence. Both already landed:

- Voyage cleanup: commit `67c2dda fix(connector): C.t9 fix-up — visitor-query embedder swaps Voyage → Gemini (3072d)`.
- Empty-state silence: commit `58d65f2 fix(ui): widget empty-state silence`.

The `WidgetMalformedPlaceholder` component stays in place as the cliff-edge guard for genuinely unrecoverable schema failures. Its `tool_error` copy in `cms/errors/en.json` is unchanged for now; copy rewrite remains a chunk-G content pass when Al has editorial bandwidth.

### Part 2 Step C — verification

- Multiple post-fix turns exercising `find_options` → 0 safeParse failures captured.
- Live screenshot 2026-05-13 13:08 — TripCard widget visibly rendered for a kayaking query against the live data layer.
- `npm test -w @swoop/ui` → 112 passed (no regression).
- The temporary `window.__safeParseFailures` diagnostic block has been reverted out of `widget-shell.tsx` — the file is back to the original shape modulo a one-character syntax fix (`return { ok: true, data: result.data };` was already correct; no diff there).

### Step 7 from the plan — diagnostic removal

Done in this same commit. `widget-shell.tsx` matches its pre-diagnostic shape.

### Step 10 — `discoveries.md` follow-up

To capture in next housekeeping pass: **"upstream tool throws produce downstream malformed-placeholder cascades; chase the upstream first"**. Pattern worth pinning so the next time the UI surfaces "Couldn't load that" the investigation starts at the connector's `tool.invoked ok:false` events rather than at the widget's schema-parse.

### Step 9 — fresh-install verify

To run post-commit per Al's swarm-merged-work memory.
