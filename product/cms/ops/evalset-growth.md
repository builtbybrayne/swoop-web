# Evalset growth runbook

Audience: a Swoop in-house engineer maintaining Puma's behavioural evalset post-handover.

Prerequisites: technical competence, ability to read YAML and a transcript, access to the Puma Cloud Logging project, ability to open a PR against this repo. No detailed Puma planning context needed; this runbook is self-contained.

---

## 1. Purpose

Real conversations are the most valuable source of regression scenarios. Synthetic scenarios are useful, but they encode what we *thought* the agent should handle; real conversations encode what visitors *actually* throw at it. Without a ritual to extract that signal, the evalset rots: it stays at launch-day shape while production drifts.

This runbook is the ritual. It runs weekly. It samples real conversations, triages them into regression material, sanitises the keepers, and grows the suite under `product/harness/scenarios/`.

There is a second reason. Conversation logs sit under a retention TTL (set per the GDPR disclosure copy). If learning isn't extracted before the TTL expires, it's gone. The weekly cadence is a hedge against that.

---

## 2. Cadence

Weekly default. Tuesday or Wednesday morning recommended: Monday traffic has settled, the week's PRs haven't piled up, you're not starting at end-of-week energy.

Block 60 to 90 minutes in the calendar. Not less; sanitisation and good assertion-writing take time and feel rushed under 60.

Adjust the cadence to traffic:

- **Low-traffic months** (off-season): every fortnight is fine. The signal is too thin to fill a weekly ritual usefully.
- **Launch periods, marketing pushes, traffic spikes**: twice a week. The first month after a content change is when most regressions surface.

If you skip a week, log it (see Step 7). A skipped week isn't a problem; an unlogged skipped week is, because nobody notices the ritual has stopped.

---

## 3. Procedure

### Step 1: Sample N conversations

Pull 10 to 20 sessions from the prior 7 days. Cloud Logging filter: events with `eventKind = "conversation.started"` against the Puma project's log bucket. Each match gives you a `sessionId` you can use to follow the rest of the conversation's events.

Stratify the sample. Do not just take the first 15 hits, you'll over-represent whatever was most common that week. Aim for roughly:

- 4 to 6 sessions ending in `qualified` handoff
- 2 to 4 ending in `referred_out`
- 2 to 4 ending in `disqualified`
- 2 to 4 that errored or were abandoned mid-conversation (no terminal verdict event)

If a category has zero candidates that week, note it in the log; it's a signal in itself.

### Step 2: Triage

For each sampled conversation, walk the transcript end to end. (See `product/cms/ops/spot-check-conversation.md` for the spot-check runbook from F.t4 covering how to assemble a transcript from logs. **TODO: that runbook lands with F.t4; reference it here once it exists.**)

Categorise each conversation into one of four buckets:

- **Worked as intended.** Move on. Note the count in the log; nothing else to do.
- **Surfaced a failure mode worth regression-testing.** Flag for scenario authoring (Step 3).
- **Surfaced a content gap.** The agent's behaviour was technically defensible but the response was thin, off-voice, or missed an obvious follow-up. Flag for prompt or skills iteration (chunk G owns the fix). File it as a content-iteration ticket; do not author a scenario for this category alone.
- **Surfaced a UX or technical issue.** The agent did the right thing, but something else broke (widget didn't render, latency spike, consent modal misfired). File a bug. Don't author a scenario; the harness covers behaviour, not infra.

A single conversation can fall into more than one bucket. Flag it for both.

### Step 3: Sanitise and author scenarios

For each conversation flagged as scenario-worthy:

1. **Strip PII.** See §4 for the sanitisation guide. This is non-negotiable; PII in `product/harness/scenarios/` is a compliance breach.
2. **Reduce to seed turns plus assertions.** The full transcript is not the scenario. The scenario is the smallest sequence of user turns that reproduces the divergence point, plus the assertions that capture what the agent *should* have done. Most scenarios collapse to one or two seed turns.
3. **Pick a category tag** (see §5).
4. **Author the YAML.** File path: `product/harness/scenarios/NNN-<short-name>.yaml`. Pick the next free `NNN` past the highest existing prefix; gaps in numbering are fine. Schema is in `product/harness/scenarios/README.md`. Keep `name` kebab-case, `description` under 400 chars, assertions specific.
5. **Reference the source.** Include a YAML comment at the top with the date and the categorisation tag. Example:

   ```yaml
   # Authored 2026-05-12 from a real conversation. Category: regression.
   # Agent committed to a hard price ("£3,200 exactly") on turn 3 despite the
   # WHY prompt's pricing-refusal rule. The fix landed in cms/prompts/system/
   # 00_why.md @ commit abc1234.
   ```

   Don't include any visitor-identifying detail in the comment.

### Step 4: Run the suite

From `product/`:

```bash
npm --workspace @swoop/harness run eval
```

A newly authored regression scenario should *fail* on `main`. That's the test of the test: if the assertion doesn't fire against the regression case the scenario is reproducing, the assertion is wrong. Tighten it until it does.

If the scenario was authored from a `coverage` case (no live regression, just a category we lacked) it may pass on `main`. That's fine. The point is to lock in the behaviour.

### Step 5: Iterate the WHY prompt or skills if needed

If Step 4 surfaced a real failing assertion, the fix lands in chunk G content: `product/cms/prompts/system/`, `product/cms/prompts/skills/`, or `product/cms/prompts/tools/`. Open a PR through the standard flow. The PR's CI run will pick up the new scenario and surface the report as a comment.

If the failure is structural (tool wiring, triage classifier, runtime), it's a code change in `product/orchestrator/`, not content. Open a separate PR; don't bundle content and code fixes.

### Step 6: Re-run the suite

After fixes land:

```bash
npm --workspace @swoop/harness run eval
```

Verify:
- The new scenario passes.
- All existing scenarios still pass.

If an existing scenario regressed, you've over-fitted the fix. Roll back, narrow the change, try again.

### Step 7: Log the ritual

Append a single line to `product/cms/ops/evalset-log.md`. Format is documented in that file's header. One ritual session, one line.

---

## 4. Sanitisation guide

PII never enters `product/harness/scenarios/`. Strip the following before authoring:

| Original | Replace with |
|---|---|
| Visitor name | "the visitor" |
| Email address | Remove entirely. Assertions must not depend on email content. |
| Phone numbers | Remove entirely. |
| Specific date or year | Generalise to relative form ("next March", not "March 2027"). |
| Geographic specifics that identify | Generalise ("UK-based", not "I live in Mile End, London"). |
| Employer or job title plus region | Drop one of the two; the combination identifies. |
| Unusual personal context (illness, family events) | Strip or generalise heavily. If the scenario depends on the specifics, drop it; that's not a scenario, that's a one-off. |

The combinatorial rule: **anything that, combined with one or two other fields, would identify a real person, is PII.** Date of birth + occupation + region is identifying even if no name is present. Be conservative.

If sanitisation hollows the scenario out (you stripped so much there's no behaviour left to test), the conversation isn't scenario material. Drop it.

---

## 5. Categorisation taxonomy

Tag each authored scenario in its top comment. Tags are not enforced; they exist so a future maintainer can spot patterns ("we keep adding `voice` scenarios; the WHY prompt needs a deeper revision").

| Tag | Meaning |
|---|---|
| `regression` | Caught a failure that shipped to production. The most common tag. |
| `coverage` | Fills a category we didn't have. Example: first real triage-disqualified conversation we'd seen. |
| `voice` | Agent regressed into AI-slop (em-dash flourishes, "delve", hedging language, empty affirmations). |
| `tool_misuse` | Agent called the wrong tool, or called the right tool with wrong arguments. |
| `triage_drift` | The handoff verdict didn't match what the conversation warranted. |
| `handoff_timing` | Handoff fired too early, too late, or never when it should have. |

A scenario can carry more than one tag if it covers more than one failure mode. Don't stack tags for emphasis; one is the default.

---

## 6. Anti-patterns

Things that look like scenarios but aren't.

- **Scenarios that depend on PII surviving.** If your assertion is "the agent confirms the email address `j.smith@example.com`", sanitisation breaks the test. Rewrite or drop.
- **Scenarios with very long seed-turn sequences.** More than 5 turns is brittle and expensive (every turn is a real Sonnet call). Anything above 5 needs a deliberate justification in the file's top comment. Most failures reproduce in one or two turns; aim for that.
- **Scenarios with no assertions.** The placeholder stubs at `010-` through `019-` exist for layout reasons and are tagged with `assertions: []`. New scenarios authored from real conversations *must* assert something. A scenario without an assertion runs the orchestrator and discards the result; it's pure cost.
- **Judge-rubric assertions for things deterministic assertions can catch.** If you can express the behaviour as `contains` / `not_contains` / `tool_call` / `event_match`, do that. Judge rubrics are slower, costlier, and require κ calibration to be trustworthy. Reach for them only when the behaviour is subjective (voice, on-brand-ness, empathy).
- **Adding scenarios past ~50 without revisiting CI cost.** Per Tier 2 §5 H.6, the suite was sized for ~10 to 15 at launch and is comfortable up to ~50. Past that, cost-per-PR becomes meaningful and the harness's CI policy needs reopening. Don't blow past the threshold quietly.

---

## 7. When to NOT add a scenario

Judgement calls that come up regularly. The defensive default is "skip". The evalset is not a museum of every weird conversation Puma has seen.

- **One-off adversarial visitors.** Someone trying to jailbreak the bot ("ignore previous instructions", "pretend you are a Patagonian guide named Dave"). Skip. The agent's existing refusals cover the category; one-off probing isn't a regression.
- **External API blips.** The agent failed because Anthropic returned a 5xx. Not Puma's behaviour, not a scenario. File a note for ops if it recurs.
- **Off-brand visitor intent the agent reasonably can't handle.** Visitor wants to book a Caribbean cruise. The agent declines and redirects, which is correct. Not a scenario; the existing refusal coverage holds.
- **Visitor confusion when the agent's response was correct.** Visitor read the response wrong, asked a follow-up that didn't match, conversation drifted. That's a UX issue (response was unclear) or a content issue (response could have been phrased differently). File a bug or a content ticket. Don't author a scenario; the agent did its job.

When in doubt, write the scenario name and description on a scratchpad. If you can't articulate what assertion would catch the failure in one sentence, skip.

---

## 8. Escalation

The ritual is local fixes by default: a scenario, a content tweak, a PR, done.

But the ritual is also pattern-detection. If across two or three weekly sessions you see the same failure mode resurfacing in different scenarios, that's signal beyond a one-off fix. Examples:

- Three different `voice` scenarios in two weeks, all about the same hedging tic.
- Recurring `handoff_timing` failures specifically when the visitor mentions a budget below £2k.
- `triage_drift` clustered around solo travellers asking about group tours.

When you see the pattern: open an entry in the project root's `inbox.md` with the pattern description and the scenarios that demonstrate it. If the pattern looks structural (the prompt needs rewriting, not patching; the triage classifier needs retraining), raise it directly to the Puma maintainer (Al, post-handover, then whoever inherits).

Pattern detection is more valuable than scenario count. A suite of 80 unconnected scenarios tells you less than a suite of 30 plus one observation that 6 of them share a root cause.

---

## 9. Tooling stretch goals

Not built. Listed so a future engineer with time can pick one up.

- **Auto-sample script.** A small CLI that runs the Cloud Logging query, stratifies the sample, and writes a triage-template file (markdown, one section per session, prefilled with sessionId + timestamps + a placeholder triage bucket). Would cut Step 1 from 20 minutes to 2.
- **Sanitisation linter / pre-commit hook.** Regex pass over `product/harness/scenarios/*.yaml` that flags likely PII (email patterns, UK postcodes, common name patterns). Catches accidents before they're committed.
- **Scenario-coverage heatmap.** Tally tags + verdict-target across the suite; surface under-represented categories. Useful for sanity-checking the suite isn't accidentally over-fitted to qualified-lead happy paths.

None of these are blockers; the manual ritual works. Build them when the manual ritual stops working, not before.

---

## 10. Where this fits

- **Evalset itself**: `product/harness/scenarios/`
- **Schema reference**: `product/harness/scenarios/README.md`
- **CI workflow**: `.github/workflows/harness.yml`
- **Ritual log**: `product/cms/ops/evalset-log.md`
- **Spot-check runbook (transcript assembly)**: `product/cms/ops/spot-check-conversation.md` (TODO: future runbook from F.t4; not yet authored)
- **CI gating policy**: `planning/02-impl-validation.md` §5 H.4 (non-gating at launch; review post-launch)
- **Cost ceiling**: `planning/02-impl-validation.md` §5 H.6 (~50-scenario soft cap)
