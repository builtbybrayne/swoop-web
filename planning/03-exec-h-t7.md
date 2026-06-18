# 03 — Execution: H.t7 Living-evalset growth runbook

**Status**: Tier 3 execution plan. Draft, 2026-04-29.
**Chunk**: H (validation).
**Implements**: [`02-impl-validation.md`](02-impl-validation.md) §2.7 (living evalset discipline) + §10 H.t7 + decision H.8 (real-conversation ingestion ritual).
**Depends on**:
- H.t1 — harness scaffold shipped (`product/harness/`, `scenarios/*.yaml`, `runs/`).
- F-a — `emitEvent` + structured stdout JSON event stream landing in Cloud Logging.
- E.t1 — handoff records persisted (the canonical place visitor PII lives today).
**Produces**:
- `handover/ops/evalset-growth.md` — operator-facing runbook for the post-launch weekly ritual.
- One-line addition to `product/CLAUDE.md`'s "where things live" pointers (so engineers stumble onto the runbook from inside `product/`).
**Estimate**: ~half a morning. Pure docs.

---

## Purpose

Tier 2 H.8 commits Puma to **growing the evalset from real conversations weekly** post-launch. Without a written ritual that ritual will dormant within a month — H.t7 makes it boring, repeatable, and PII-safe.

The runbook is **operator-facing**. Audience: Swoop's in-house team post-handover (Thomas / Richard) at first; future Al at his weekly review desk. Plain English, copy-paste-able commands, no clever tooling.

---

## Scope boundary

**In scope** (what the runbook covers):
1. The week-by-week ritual: sample → triage → convert → re-run.
2. Where conversations live and how to retrieve a transcript by session id.
3. How to triage a conversation against the existing evalset (which ones are interesting; which are duplicates).
4. How to author a new scenario file from a real conversation — file path, naming, schema pointer.
5. **PII sanitisation** — what to redact (names, emails, phones, freeform `reason.text`), how to verify, who is responsible. This is the load-bearing section.
6. How to re-run the suite on `main` after adding scenarios + how to read the diff.
7. Cadence (weekly), ownership, escalation when the ritual finds a new failure mode.

**Out of scope** (named so the document doesn't drift):
- A bespoke sanitisation helper script. The runbook prescribes a manual checklist plus a `grep`-based smoke test against the committed scenario file. A scripted sanitiser is a future task if volume justifies it (decision logged below as deferred).
- Cloud Logging access setup / IAM. Pointer to whoever owns GCP IAM at handover; the runbook assumes the operator can already query logs.
- Judge-rubric authoring guidance — that lives in H.t5's calibration deliverable, not here.
- Quarterly evalset audit / reorg (de-duplication, archiving stale scenarios). Defer until the suite passes ~50 scenarios; flagged as a "when this gets too long" footnote in the runbook itself, not a separate doc yet.
- Conversation-analysis council-of-experts harness (chunk F §2.7). Different ritual, different artefact.
- Anything to do with running the harness locally / in CI — `product/harness/scenarios/README.md` already covers that and the runbook links to it.

---

## File path + naming

`handover/ops/evalset-growth.md`. Verbatim from Tier 2 §2.7. Don't invent variants.

The directory `handover/ops/` does not yet exist; this task creates it. F.t4's spot-check runbook (`handover/ops/spot-check-conversation.md`) will land alongside later. No `README.md` in `handover/ops/` for now — two files don't justify one, and `cms/README.md`'s authoring rules already explain the wider `cms/` posture.

The file is markdown; treated as content (not loaded by any package); reviewed by Al on edits like any other CMS content.

---

## Decisions closed in this task

Log in `planning/decisions.md` under H.t7. Flagged inline so reviewers find rationale without climbing the log.

(H.9–H.16 already in use; this task starts at H.17.)

| # | Decision | Pick |
|---|---|---|
| H.17 | Cadence | **Weekly, Friday afternoon** by default. Operator may shift; the runbook documents the slot but flags it as movable. |
| H.18 | PII sanitisation mechanism | **Manual checklist + a committed pre-merge `grep` smoke test** against the scenario file. No automated sanitiser script in Puma. Revisit if scenarios > 50 or if a leak occurs. |
| H.19 | Where transcripts come from | **Two-source**: (a) handoff records under `var/handoffs/<id>.json` for sessions that produced a handoff (qualified / referred_out / disqualified); (b) Cloud Logging event stream by session id for everything else (events carry hashes only — full message text is not in logs at launch). The runbook acknowledges (b) is partial coverage and prescribes a small workaround: when a "no-handoff" conversation is interesting, the operator either reproduces it locally to capture a transcript, or relies on the abbreviated event sequence + memory of the session if it happened in dev. **Real fix is a deliberate "log final utter text" schema change, deferred** — flagged as an open item for Al. |
| H.20 | Who owns the ritual at handover | **Documented as a role**, not a name. The runbook says "the harness owner — currently Thomas / Richard at handover; until then, Al". Avoids dating the doc with a name that will rot. |

---

## Runbook structure

The runbook is one self-contained markdown file. Section order is the order an operator will read it cold. Sections:

1. **Why this exists** (3–5 lines). The one-paragraph case for ritualising. Reader needs to believe in the ritual before reading the steps. Cite the H.8 decision.
2. **What you'll do every week** (the TL;DR). Numbered steps, no detail — a four-bullet recipe. Reader learns the shape of the work in 15 seconds.
3. **Cadence + ownership**. Weekly Friday afternoon (movable). Owner is "the harness owner" — explicit pointer to who that is at handover. Time-boxed at 30–45 min.
4. **Step 1 — Sample N conversations**. How to pull the candidate set. Two paths:
   - Handoff records (filesystem under `var/handoffs/` until E.t2's Firestore swap; query by listing files + reading verdict from JSON).
   - Cloud Logging by session id when a non-handoff conversation needs investigation.
   N defaults to **5–10** per week to keep the ritual on its time-box. Sample evenly across verdicts (qualified / referred_out / disqualified) when possible, plus 1–2 "no handoff" sessions if Al / the operator has a flagged session id from manual use.
5. **Step 2 — Triage**. For each candidate:
   - Skim the transcript. Does the agent's behaviour match what an existing scenario already covers? If yes, drop it.
   - Does it surface a new failure mode (an unhandled refusal type, a tool-call sequence the suite doesn't exercise, a triage edge case)? If yes, mark it for conversion.
   - Does it surface a content gap (a question Puma can't answer because the CMS lacks the data)? If yes, log it as a content issue, not a scenario — different ritual.
   The runbook gives a one-sentence rule: **"convert it only if a future regression of this behaviour would matter and the existing suite wouldn't catch it"**.
6. **Step 3 — Convert to a scenario**. The mechanical steps:
   - Copy the visitor's first 1–3 messages into a new scenario file.
   - Filename: `product/harness/scenarios/<NNN>-<kebab-case-name>.yaml`. Pick the next free `NNN` ≥ 100 (the 000–019 range is reserved for the H.t1 illustrative + placeholder set; the 100s are real-conversation-derived scenarios). Numeric prefix controls report ordering — leave gaps of 5 or 10 so future inserts don't renumber.
   - Schema is in `product/harness/src/scenario.ts` (Zod, strict). Authoring guidance is in `product/harness/scenarios/README.md` — the runbook links there rather than re-stating the schema.
   - Author assertions to capture the failure mode the conversation surfaced. Start with `contains` / `not_contains` (always available); H.t3 assertion kinds (`tool_call`, `triage_verdict`, `event_match`, `disclosure`, `judge_rubric`) are options when they fit.
   - Set `judge: null` unless the rubric is ready and H.t5 has shipped an `AnthropicJudge`.
7. **Step 4 — Sanitise (the load-bearing section)**. Detailed below in §"PII sanitisation".
8. **Step 5 — Re-run the suite on `main`**. Steps:
   - Pull `main`. `npm install`. Boot orchestrator (`npm --workspace @swoop/orchestrator run dev`).
   - In another terminal: `npm --workspace @swoop/harness run eval`. Optionally `--filter` to just the new scenarios first, then a full run.
   - Read `product/harness/runs/<timestamp>/results.md`. New scenarios pass on first run? Good — commit. Fail? Fix the assertions or accept this as a real regression to investigate before committing.
   - Diff the run against the previous baseline run on `main` if available (the runbook notes this is informal until H.t6 wires baseline diffing).
9. **Step 6 — Commit + open PR**. One PR per week of growth. Title: `evals: weekly growth <YYYY-MM-DD>`. Body: 2-line summary (which conversations seeded which scenarios; what regression each catches). The CI harness job will run on the PR; non-gating per H.13.
10. **What to do when the ritual finds a real regression in production**. Decision tree:
    - Add the scenario AND raise an issue against the orchestrator / content owner.
    - Tag the PR with `regression-found` so the next iteration's metrics include it.
    - Don't fix the regression in the same PR as the scenario — keep evidence-of-failure separate from fix.
11. **When the suite gets long** (forward-look, ~50+ scenarios). Flag for a future quarterly audit task: de-duplicate, archive scenarios that are no longer load-bearing, split the suite by category if needed. Not a runbook step today.
12. **Open items for Al** (3–4 bullets). Logged in the runbook itself so each weekly read surfaces unresolved questions. See §"Open items for Al" below.

---

## PII sanitisation — what to redact and how

This is the load-bearing section. Two failure modes the runbook must prevent:

1. **A scenario file commits a real visitor's PII** (name + email from a `qualified` / `referred_out` handoff, or a name dropped mid-conversation, or a freeform `reason.text` blurb that quotes the visitor verbatim).
2. **A scenario file commits operationally sensitive content** — internal sales notes, partner names tied to a referral, anything the visitor said in confidence.

### Fields to redact

The runbook prescribes redaction by source-of-data, naming each field explicitly so the operator doesn't have to remember:

**From a handoff record (`var/handoffs/<id>.json`)**:
- `contact.name` → drop entirely. Don't anonymise to "Test Visitor"; the scenario is interested in the agent's behaviour, not the visitor's identity. If the seed turn references the name (e.g. "I'm Sarah and I want to..."), rephrase to "I want to...".
- `contact.email` → drop entirely. Same rule for in-message emails: rewrite "my email is sarah@example.com" → omit, or replace with the literal placeholder `<email-redacted>` if the test specifically exercises email-handling.
- `contact.phone` → drop. Rewrite mentions in messages.
- `reason.text` → freeform sales-specialist context; **never** import verbatim. The scenario needs visitor-side messages, not the agent's triage rationale.
- `motivationAnchor` → check before importing; usually safe (it's persona-shaped, not identity-shaped) but apply judgement.
- `wishlist` slugs → safe; these are CMS identifiers, not PII.
- `session.sessionId`, `session.entryUrl` → drop / replace with generic. UUIDs aren't PII but tying a scenario to a real session id muddies what the scenario is testing.

**From event-stream snippets** (Cloud Logging by session id):
- Events at launch carry hashes + lengths only, not message text — so the event stream itself is PII-safe by construction. The risk is in the transcript the operator pulled separately to write the scenario; same redaction rules apply there.

**From visitor messages (the scenario `turns`)**:
- Names: rewrite or drop. Patagonia destination names ("W trail", "Torres del Paine") are not PII — keep.
- Emails, phone numbers: drop or replace with `<email-redacted>` / `<phone-redacted>` if the test deliberately exercises them.
- Dates / travel windows: keep — they're persona, not identity.
- Specific company / employer references: rewrite to a generic ("a tech company" → omit; "I work at Acme Corp" → drop).

### How to redact (procedure)

1. **Open the source transcript / handoff record alongside an empty new scenario file.** Don't copy-paste blocks then redact — that's how leaks happen. Re-author the visitor messages by hand, paraphrasing where the original carried PII.
2. **After authoring, run the smoke test** (committed in this runbook):

   ```bash
   # From product/. Catches the most common leaks.
   grep -nE '@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' harness/scenarios/<NNN>-*.yaml || echo "ok: no email-shaped strings"
   grep -nE '\+?[0-9][0-9 .()-]{7,}' harness/scenarios/<NNN>-*.yaml || echo "ok: no phone-shaped strings"
   grep -inE '\b(my name is|my email|my phone|email address is|phone number is|call me [A-Z])' harness/scenarios/<NNN>-*.yaml || echo "ok: no obvious identity phrases"
   ```

   Each `grep` exits non-zero (no match) when clean. Any match is a manual review point — sometimes legitimate (a scenario testing the contact-collection flow may need `<email-redacted>` literally), sometimes not.
3. **Self-review** the file in the editor before staging. Read it as if it were a public document — is there anything the visitor would object to seeing?
4. **PR review** is the second pair of eyes. Reviewer reads the diff against the same checklist. Don't merge if uncertain.

The runbook commits these `grep` patterns verbatim so the operator can copy-paste them — a scripted sanitiser is the next step up if this catches the wrong threshold of issues, but for Puma's volume the manual + grep is honest.

### What if a leak ships?

Three-step incident response, included in the runbook:
1. Open a PR removing / rewriting the scenario file. Scenarios are content; they live in git history. Removing the file does not erase history. Force-rewriting history is **out of scope** in Puma; if the leak is severe (real identifying email of a known visitor), escalate to whoever owns Swoop's data-protection response — not handled in the runbook, just pointed at.
2. Re-run the suite to confirm the redacted scenario still tests the intended behaviour.
3. Note the incident in `gotchas.md` so future ops understand what tripped.

---

## Open items for Al (logged in the runbook itself)

The runbook surfaces these as a final section so each weekly read keeps them visible until resolved:

1. **Conversation transcripts not logged at launch.** Events carry hashes; messages do not. This means the ritual works cleanly only for sessions with a handoff record, plus dev-time reproduction. **Decision pending**: schema-change to log final `<utter>` text (with PII review) vs. keeping logs hash-only. Open in `questions.md` under "Observability — message text in logs".
2. **Handoff record location moves at E.t2.** Today the records are filesystem JSON under `var/handoffs/`. Once Firestore lands the runbook needs a one-line update on Step 1. Flag for the E.t2 PR author.
3. **Cadence and ownership at handover.** "The harness owner — Thomas / Richard at handover; until then, Al" stays accurate only as long as that's true. Update on handover sign-off. (`questions.md` open item: "Post-handover ops ownership for evals".)
4. **Sanitisation tooling threshold.** Manual + `grep` smoke is honest at <50 scenarios. If the suite passes 50 or a leak slips through grep, revisit a scripted sanitiser as a Tier 3 task.

---

## Verification

H.t7 is done when:

1. `handover/ops/evalset-growth.md` exists, follows the section order in §"Runbook structure", and is operator-readable end-to-end without consulting another doc except the explicit links to `product/harness/scenarios/README.md` and `planning/02-impl-validation.md`.
2. The PII section names every field on the handoff payload that carries identity (`contact.name`, `contact.email`, `contact.phone`, `reason.text`, `session.sessionId`) and prescribes the action for each.
3. The grep smoke test in §"PII sanitisation" runs cleanly against the existing scaffold scenarios (`product/harness/scenarios/000-*.yaml` through `019-*.yaml`) — the runbook can claim "this passes today, keep it passing".
4. `product/CLAUDE.md` has a one-line pointer to the runbook so engineers landing in `product/` find it without climbing planning docs.
5. Decisions H.17 – H.20 logged in `planning/decisions.md`.
6. No code touched. Pure docs.

---

## Out of scope checks (don't do these)

- Don't write a sanitisation helper script. Manual + grep, per H.18.
- Don't touch `progress.md` or `next-steps.md` — Agent A is editing those concurrently. Surface the H.t7 row update in the final report instead.
- Don't touch `product/harness/` source. The runbook describes the harness; it doesn't extend it.
- Don't author new scenario files. The runbook describes how the operator does it; the runbook itself doesn't seed real scenarios.
- Don't add an emoji or a screenshot. Plain text + fenced commands.
