# Evalset growth — weekly ritual

Operator-facing runbook for converting real Puma conversations into new harness scenarios. Follow this every Friday afternoon, post-launch.

---

## Why this exists

Puma launches with ~13 starter scenarios in the harness — enough to catch obvious regressions, not enough to cover the long tail of real visitor behaviour. Decision **H.8** (in `planning/02-impl-validation.md`) commits the project to growing the evalset weekly from real conversations. Without a written ritual that growth dries up inside a month, and the harness becomes decorative.

This runbook makes the ritual boring and repeatable. Read it cold once, then keep it open in a tab during your weekly slot.

---

## What you'll do every week

1. Pull a small sample of last week's conversations.
2. Triage which ones surface behaviour the existing suite doesn't already cover.
3. Convert each interesting conversation into a YAML scenario, sanitised of visitor PII.
4. Re-run the harness on `main` and open a PR with the new scenarios.

Time-box: 30–45 minutes. If it's taking longer, you're either being too thorough on triage or your sample is too big. Drop scenarios, not the time-box.

---

## Cadence + ownership

- **When**: Fridays, late afternoon. The slot is movable — pick whatever works for the harness owner. The point is regularity, not Friday specifically.
- **Who**: the harness owner. At handover this is **Thomas / Richard** at Swoop; until handover lands, **Al**. Update this paragraph when ownership changes.
- **How long**: 30–45 min weekly. If the suite grows past ~50 scenarios this may need 60 min plus a quarterly audit pass — see "When the suite gets long" below.

---

## Step 1 — Sample N conversations

Pull 5–10 candidate sessions from last week. Two sources:

### 1a. Handoff records (the rich source)

Every conversation that ended in a handoff (`qualified`, `referred_out`, `disqualified`, or `inconclusive`) writes a JSON record. Today these live on the orchestrator filesystem; post-Postgres swap (E.t2 proper, per E.10 + C.23 — Firestore was the original target but is dropped) the location moves but the schema is identical.

```bash
# From the orchestrator host (or a recent local dev run):
ls -lt product/orchestrator/var/handoffs/ | head -20

# Pick a handoff id and read it:
cat product/orchestrator/var/handoffs/handoff_<id>.json | jq '.'
```

Each record carries the verdict, the visitor's wishlist, the consent snapshot, the contact details (on `qualified` / `referred_out`), and the freeform `reason.text` from the agent's triage. The full conversation transcript is not in the record — see 1b for that — but the record tells you what kind of behaviour the conversation produced.

Sample evenly across verdicts when possible: 2–3 `qualified`, 2–3 `referred_out`, 1–2 `disqualified`, 1–2 `inconclusive`. If a verdict band has nothing interesting, sample lighter — don't pad.

### 1b. Cloud Logging (events by session id)

For non-handoff sessions, or to get the event sequence of a handoff session you've already flagged:

```bash
# In Cloud Logging, filter by session id:
jsonPayload.sessionId="<session-id>"
```

Note: at Puma launch, events carry message **lengths and SHA256 hashes** — not the message text itself (see chunk F's privacy posture). So Cloud Logging gives you the shape of the conversation (turn count, tool calls, triage decision, latency) but not the words. To get the actual transcript:

- For sessions that produced a handoff: the handoff record + the event sequence is usually enough to reconstruct the behaviour worth testing.
- For "no handoff" sessions you've manually flagged in dev: the orchestrator's stdout from that dev run is where the messages went — keep a tail saved if you noticed something interesting at the time.
- For "no handoff" sessions in production with no transcript: skip them this week. There is an open item for Al to widen logging — see "Open items" at the bottom.

---

## Step 2 — Triage

For each candidate session, decide: **scenario, content gap, or skip**.

**Scenario** — the agent's behaviour was wrong, or right in a load-bearing way the suite doesn't already test. Examples:
- An unhandled refusal type (visitor asked for something Puma should decline; Puma drifted).
- A new tool-call sequence (an order or combination the suite doesn't exercise).
- A triage edge case (a verdict the agent got wrong or right by a thread).
- A handoff timing miss (too early, too late, or never when it should have).

**Content gap** — the agent behaved correctly given its content, but the content was wrong (CMS lacked the data, copy was off-brand, refusal triggered when it shouldn't have because the WHY prompt is too tight). **Don't convert these into scenarios** — log them as a content issue against chunk G instead. Different ritual; different fix path.

**Skip** — the existing suite already covers this behaviour; the conversation went uneventfully; the visitor immediately bounced. Most candidates will be skips, and that's healthy.

The rule of thumb: **convert it only if a future regression of this behaviour would matter, AND the existing suite wouldn't catch it.**

If you can't decide, skip. The next week's sample will surface another instance if it's a real pattern.

---

## Step 3 — Convert to a scenario

For each session marked "scenario":

1. Open a new file under `product/harness/scenarios/`. Filename pattern:

   ```
   product/harness/scenarios/<NNN>-<kebab-case-name>.yaml
   ```

   Pick the next free `NNN` ≥ **100**. The 000–019 range is reserved for the H.t1 illustrative + placeholder scenarios; the 100s are real-conversation-derived. Leave gaps of 5 or 10 between yours and the next so future inserts don't renumber.

2. Author the file against the schema in `product/harness/src/scenario.ts` (Zod, strict — unknown keys reject). The full authoring guide lives in `product/harness/scenarios/README.md` — open it alongside this runbook the first few times.

   Minimum shape:

   ```yaml
   name: "kebab-case-name"
   description: >
     Short description of the behaviour under test. One or two sentences.

   turns:
     - user: "first visitor message (paraphrased — see Step 4)"
     - user: "second visitor message if the test needs multi-turn"

   assertions:
     - kind: contains
       text: "expected substring"
     - kind: not_contains
       text: "should never appear"

   judge: null
   ```

3. Pick assertions that capture the failure mode:
   - `contains` / `not_contains` — always available, work on the final assistant utterance.
   - H.t3 kinds (`tool_call`, `triage_verdict`, `event_match`, `disclosure`, `judge_rubric`) — use when they fit the failure mode. The schema is additive; if a kind isn't shipped yet, fall back to `contains` against an indicative substring.
   - `judge: null` for now. When H.t5's `AnthropicJudge` ships, you can author rubric-based assertions on top.

4. Re-author the visitor messages **by hand** from the transcript. Don't copy-paste blocks. Step 4 explains why.

---

## Step 4 — Sanitise (the load-bearing step)

This is where the ritual either earns its keep or fails the visitor. Two failure modes to prevent:

1. A scenario file commits a real visitor's PII.
2. A scenario file commits operationally sensitive content — internal sales notes, partner names tied to a referral, anything the visitor said in confidence.

### Fields that carry PII

**On a handoff record (`var/handoffs/<id>.json`)**:

| Field | Action when seeding a scenario |
|---|---|
| `contact.name` | Drop entirely. Don't anonymise to "Test Visitor" — the scenario is interested in agent behaviour, not visitor identity. |
| `contact.email` | Drop entirely. If a turn references it ("my email is sarah@example.com"), omit the reference; if the test deliberately exercises email collection, replace with the literal placeholder `<email-redacted>`. |
| `contact.phone` | Drop. Same rule for in-message phone numbers. |
| `reason.text` | Freeform sales-specialist context — the **agent's** rationale, not visitor speech. Never import verbatim. |
| `motivationAnchor` | Usually persona-shaped, not identity-shaped. Apply judgement before importing. |
| `wishlist[].slug` | Safe — these are CMS identifiers, not PII. |
| `session.sessionId` | Drop / replace. UUIDs aren't PII strictly, but tying a scenario to a real session id muddies what the scenario is testing. |
| `session.entryUrl` | Drop / replace with a generic. Real URLs can correlate to a visitor. |

**In visitor messages (the scenario `turns`)**:

| Pattern | Action |
|---|---|
| First names ("Sarah", "James") | Rewrite or drop. "I'm Sarah and I want to..." → "I want to...". |
| Email addresses | Drop or replace with `<email-redacted>` if the test exercises email handling. |
| Phone numbers | Drop or replace with `<phone-redacted>`. |
| Specific employer / company references | Drop. "I work at Acme Corp on a tight schedule" → "I'm on a tight schedule". |
| Patagonia destination names ("W trail", "Torres del Paine") | **Keep** — these are persona / interest, not identity. |
| Travel windows / dates ("two weeks in March") | **Keep** — persona, not identity. |

### Procedure

1. **Open the source transcript / handoff record alongside an empty new scenario file.** Don't copy-paste blocks then redact — that's how leaks happen. Re-author the visitor messages by hand, paraphrasing where the original carried PII.

2. **Run the smoke-test greps** before staging. From `product/`:

   ```bash
   # Email-shaped strings.
   grep -nE '@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' harness/scenarios/<NNN>-*.yaml \
     || echo "ok: no email-shaped strings"

   # Phone-shaped strings.
   grep -nE '\+?[0-9][0-9 .()-]{7,}' harness/scenarios/<NNN>-*.yaml \
     || echo "ok: no phone-shaped strings"

   # Identity-disclosure phrases. Tight enough to not match YAML keys
   # (`name:` etc.) or scenery references ("I'm thinking about Patagonia").
   grep -inE '\b(my name is|my email|my phone|email address is|phone number is|call me [A-Z])' \
     harness/scenarios/<NNN>-*.yaml \
     || echo "ok: no obvious identity phrases"
   ```

   Each grep exits non-zero (no match) when clean. A match is a **manual review point** — sometimes legitimate (a scenario testing the contact-collection flow may need `<email-redacted>` literally), sometimes not. Don't auto-trust.

3. **Self-review** the file in your editor before staging. Read it as if it were a public document. Anything the visitor would object to seeing? Rewrite.

4. **PR review** is the second pair of eyes. Whoever reviews the PR runs the same checklist on the diff. Don't merge if uncertain.

### When in doubt, don't ship the scenario

A scenario you skipped costs nothing. A leak costs trust. If you're more than 90% sure, ship; if less, drop and revisit next week with fresher eyes.

### What to do if a leak ships

1. Open a PR removing or rewriting the scenario file. Scenarios live in git history — removing the file does **not** erase history. Force-rewriting history is out of scope here; if the leak is severe (a real identifying email of a known visitor), escalate to whoever owns Swoop's data-protection response.
2. Re-run the suite to confirm the redacted scenario still tests the intended behaviour (it usually does — the PII wasn't load-bearing).
3. Add an entry to `gotchas.md` at the repo root describing what tripped, so future operators learn from it.

---

## Step 5 — Re-run the suite on `main`

Before opening the PR:

1. From a clean checkout of `main`:

   ```bash
   cd product
   git pull
   nvm use
   npm install
   ```

2. Boot the orchestrator in one terminal:

   ```bash
   npm --workspace @swoop/orchestrator run dev
   ```

3. In another terminal, run the harness — first against just your new scenarios, then the full suite:

   ```bash
   # Just the new ones:
   npm --workspace @swoop/harness run eval -- --filter <NNN>

   # Full suite:
   npm --workspace @swoop/harness run eval
   ```

4. Read `product/harness/runs/<timestamp>/results.md`.

   - **New scenarios pass** on first run? Good — they're capturing behaviour that's already correct on `main`. The value is regression coverage going forward.
   - **New scenarios fail** on first run? Either the assertions are off (fix and re-run), or you've found a real regression in production behaviour. If it's a real regression, see "When the ritual finds a real regression" below.

5. Diff against the previous baseline if available. The harness ships per-run reports; baseline-diffing is informal until H.t6 wires it explicitly. Until then, eyeball the previous week's `results.md` from `product/harness/runs/`.

---

## Step 6 — Commit + open PR

One PR per week of growth. Suggested shape:

- **Title**: `evals: weekly growth <YYYY-MM-DD>`.
- **Body**: 2-line summary — which conversations seeded which scenarios; what regression each catches. Don't quote the visitor; describe the behaviour pattern.
- **Files**: only `product/harness/scenarios/<NNN>-*.yaml` (and any minor README tweak if you've added a new assertion kind worth documenting).

The CI harness job (`.github/workflows/harness.yml`) will run on the PR. It's non-gating per decision **H.13** — failures don't block merge — but the comment it leaves shows whether the new scenarios behave the same in CI as they did locally. Worth scanning.

---

## When the ritual finds a real regression in production

If a new scenario fails on `main`:

1. **Add the scenario** to your weekly PR anyway. Evidence-of-failure should land first; the fix lands separately.
2. **Open a separate issue** against the orchestrator / content owner. Tag the PR with `regression-found` so the next iteration's metrics include it.
3. Don't fix the regression in the same PR as the scenario. Keep evidence separate from fix so the eval suite can reliably show "this was failing before the fix; this passes after the fix".

---

## When the suite gets long

When the harness passes ~50 scenarios, this weekly ritual may need a quarterly audit pass:

- De-duplicate scenarios that have grown to overlap.
- Archive scenarios that are no longer load-bearing (the behaviour they tested is now covered by 5 stronger scenarios).
- Split the suite by category (refusals / triage / handoff / tool-use) if one category dominates.

Not a step today. Flag for a future Tier 3 task; revisit when the suite count crosses 50.

---

## Open items for Al

These stay visible at the bottom of the runbook so each weekly read keeps them in front of the operator until resolved.

1. **Conversation transcripts not logged at launch.** Events carry hashes; messages do not. The ritual works cleanly only for sessions with a handoff record, plus dev-time reproduction. Decision pending: schema-change to log final `<utter>` text (with PII review) vs. keeping logs hash-only. Open in `questions.md` under "Observability — message text in logs".
2. **Handoff record location moves at E.t2 proper.** Today the records are filesystem JSON under `product/orchestrator/var/handoffs/`. Once the Postgres swap lands (per E.10 + C.23 — Firestore was the original target but is dropped), Step 1a needs a one-line update.
3. **Cadence and ownership at handover.** "The harness owner — Thomas / Richard at handover; until then, Al" stays accurate only as long as that's true. Update on handover sign-off. Open in `questions.md` under "Post-handover ops ownership for evals".
4. **Sanitisation tooling threshold.** Manual + grep is honest at <50 scenarios. If the suite passes 50 or a leak slips through grep, revisit a scripted sanitiser as a Tier 3 task.

---

## Where the rules came from

- **H.8** (planning/decisions.md, eventually): real-conversation ingestion as a weekly ritual.
- **H.17 – H.20** (planning/decisions.md): cadence, sanitisation mechanism, transcript sources, ownership.
- **02-impl-validation.md §2.7**: the canonical Tier 2 description.
- **03-exec-h-t7.md**: the Tier 3 plan that produced this runbook.
