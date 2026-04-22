# 02 — Implementation: H. Validation

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4H.
**Depends on**: B (orchestrator endpoint to run evals against), G (conversational flow mapping → eval scenarios; content → behaviour under test), F (events as assertion sources), E (handoff verdicts as assertion target).
**Coordinates with**: all chunks — evals are the cross-cutting check that the whole thing behaves.

---

## Purpose

H owns behavioural eval. A lightweight harness that runs scenario-based tests against Puma's agent (and the stack behind it), with assertions on tool-call correctness, triage decisions, handoff timing, disclosure compliance, and refusals. Intentionally minimal. No vendor tooling. Small starter evalset. The purpose is **catching regressions** and **measuring whether Puma actually behaves like Swoop wants**, not competing with Braintrust.

This chunk also produces the signal we use post-launch to tune the system prompt and the skills library. Without H, prompt changes fly blind.

---

## 1. Outcomes

When this chunk is done:

- A harness exists that runs a scenario through Puma's orchestrator (as a black box — real HTTP, real SSE) and produces structured results.
- A starter evalset of ~10–15 scenarios covers the load-bearing cases: a qualified-lead happy path, a backpacker triage-to-disqualified, a tailor-made prospect, a group-tour-for-solo flow, a handful of refusals (itinerary build, pricing commit, off-piste queries), a handoff-too-early case, a handoff-never case.
- Each scenario asserts on: tool-call correctness (did the agent call the right tools in a plausible order), triage verdict, handoff timing, refusal behaviour, and (where relevant) response-format compliance.
- Claude is used as the judge model for subjective assertions (e.g. "is this on-brand?"); deterministic assertions (tool name called, verdict code, event emitted) run without a judge.
- Harness runs locally (`npm run eval` from `product/` or a Python equivalent) and in CI on every PR touching the orchestrator or content.
- A report format makes pass/fail + delta-from-baseline scannable.
- Evals evolve: real conversation logs feed new evalset entries post-launch.

**Not outcomes**:
- Vendor eval tooling (Braintrust / LangSmith / Arize AX / Langfuse).
- Large evalset (100+ cases). Puma ships with 10–15; growth is continuous.
- Adversarial / jailbreak testing at scale. A couple of refusal cases, not a red-team suite.
- Automated prompt-tuning loops.
- Safety / bias audits — addressed via content + refusals in G, not instrumented here.
- Cost measurement — emitted as events (chunk F), analysed later in BigQuery if wanted.
- Load testing — not a behavioural concern.

---

## 2. Target functionalities

### 2.1 Harness language — TypeScript vs Python

Two candidates:

**TypeScript**: matches the rest of Puma, no extra runtime. Uses `ts-common` schemas directly; reuses the Zod validation already in play. Deploys / runs anywhere Node does.

**Python sidecar**: aligns with Google ADK's Python-first evaluation primitives (`AgentEvaluator`, `adk eval`, etc. — per `planning/archive/research/eval-harness-research.md`). Access to the wider eval ecosystem (Inspect AI, pytest-based frameworks). Adds a second-language ops surface to the repo.

**Recommendation: TypeScript.** Puma's ADK runtime is TypeScript; running the harness out-of-process in Python adds ops complexity for marginal ecosystem gain. The ADK Python eval primitives are nice-to-have, not load-bearing. Use them if the harness plateaus; start simpler.

### 2.2 Scenario format

Each scenario is a structured test case:
- **Name** and short description.
- **Seed turns**: a list of user messages that walk the conversation to the state under test (may be one message, may be five).
- **Expected trajectory**: a set of assertions applied at the end (or at each turn).

Assertions types:
- **Tool-call**: "the agent called `search` with filter `activity=hiking` on turn 2" (or similar — exact matching via tool-call logs from chunk F).
- **Triage verdict**: "by conversation end, triage state is `qualified`" (or `referred_out` / `disqualified`).
- **Handoff**: "a `handoff_submitted` event exists with verdict `qualified`" / "no handoff event exists" / "handoff arrived on turn N or later".
- **Refusal**: "the agent refused to construct an itinerary" — judge model confirms from the `<utter>` content.
- **Response format**: "the response contains at least one `<utter>` and at least one `<reasoning>`" — deterministic parse.
- **Disclosure**: "the disclosure event was emitted on conversation start" — event check.
- **On-brand voice** (judge-based): "the response reads like a knowledgeable friend, not an FAQ bot" — Claude Opus evaluates.

Scenarios live under `product/evals/scenarios/` as JSON or YAML. Assertions as typed objects (TS types in `ts-common`). Content-as-data applies — adding a scenario is editing content, not code.

### 2.3 Execution flow

For each scenario:
1. Start a fresh Puma session via the orchestrator's HTTP endpoint.
2. Feed the seed turns sequentially, collecting responses.
3. Pull events for the session from Cloud Logging (or stdout in dev).
4. Run each assertion against the collected responses + events.
5. Record pass / fail per assertion; aggregate per scenario; aggregate per suite.

Judge-based assertions call Claude Opus with a rubric. Calibration on a held-out set before adoption — aim for judge-human agreement Cohen's κ ≥ 0.6 on on-brand / refusal rubrics.

### 2.4 Starter evalset (10–15 scenarios)

Candidates (finalise with Al during Tier 3, informed by G.t0 flow mapping):

1. Qualified happy path — high-budget tailor-made prospect, heads into the W-trail + luxury lodges path, handoff converts.
2. Group-tour-for-solo — solo traveller, low-end budget, surfaces group tours, handoff converts to group-tour-tagged.
3. Triage-to-disqualified — backpacker budget + shoestring messaging, polite redirect, no handoff.
4. Triage-to-referred-out — low-profit enquiry, redirected to partner, lightweight handoff.
5. Refusal: itinerary build — visitor asks "plan me a 10-day trip with dates", agent deflects to handoff.
6. Refusal: authoritative pricing — visitor asks "exactly how much is the W trail in January 2027", agent quotes range + handoff.
7. Refusal: off-piste — visitor asks something unrelated (general Argentina politics, random coding question), agent declines and redirects.
8. Handoff-too-early — visitor barely mentioned Patagonia, agent shouldn't try to hand off yet.
9. Handoff-never — visitor only wanted information, no buy signal, agent ends politely without pushing handoff.
10. Disclosure compliance — verify disclosure event on conversation start; verify persistent disclosure remains.
11. Response format compliance — verify every turn has at least one `<utter>` and one `<reasoning>`.
12. Skill loaded at the right moment — visitor signals tailor-made high-budget, agent calls `load_skill` with the tailor-made-prospect skill before producing its reply.
13. Image-rich inspiration turn — visitor asks "show me Patagonia scenery", agent calls `illustrate`, widget renders.
14. Deep-link affordance (if scrape path landed) — agent surfaces a trip, response includes a deep-link URL, D can render it as a link.
15. Error-recovery — simulate a connector failure, agent produces a graceful fallback message.

Scenarios are living documents — add new ones when real conversations surface a case that should've been caught.

### 2.5 Reporting

Per-run report:
- Total scenarios / passed / failed.
- Per-scenario: assertion-level detail.
- Diff vs baseline (last run on main branch).
- Judge-model disagreement warnings (if κ drifts).
- Latency and cost per scenario (informational, not gating).

Human-readable markdown + machine-readable JSON. Posted as a PR comment in CI.

### 2.6 CI integration

On every PR touching `product/orchestrator/`, `product/cms/prompts/`, `product/cms/skills/`, or `product/evals/scenarios/`:
- Harness runs against the branch's orchestrator (spun up locally in CI).
- Report attached to PR.
- **No automatic gate on fail** during Puma's pre-launch — we don't want a single flaky judge call blocking a merge. Post-launch we revisit gating policy.

### 2.7 Living evalset discipline

Post-launch, a weekly ritual:
1. Sample N conversations from Cloud Logging.
2. Triage: which should become scenarios? Which surface new failure modes?
3. Convert interesting ones into scenarios (with a sanitised seed — strip PII).
4. Re-run the full suite on main.

Ritual tracked in `product/cms/ops/evalset-growth.md` post-launch.

---

## 3. Architectural principles applied here

- **PoC-first**: evolve the PoC's `test-prompts/test-suite.json` pattern (scenario-driven manual prompts) into a programmatic harness.
- **Content-as-data**: scenarios live as JSON/YAML, not TS. Adding a scenario doesn't touch code.
- **Production quality on minimum surface** (theme 7): the harness is real, runs in CI, produces real reports. It's not gold-plated — no vendor integration, no elaborate dashboard.
- **Swap-out surfaces named**: judge model (config), harness language (recommended TS; a Python sidecar is a medium-cost swap if we ever need ADK eval primitives), report consumer (PR comment default; Slack / dashboard if Swoop wants).

---

## 4. PoC carry-forward pointers

- `chatgpt_poc/product/test-prompts/test-suite.json` — scenario-based prompts from the PoC. Starting material for H's scenarios. Content adapts; structure evolves.
- `planning/archive/research/eval-harness-research.md` — 2026 research pass on eval tooling. Read for context on what Puma deliberately *isn't* using (Braintrust, Langfuse, Phoenix, Inspect AI — all deferred).
- `planning/archive/07-validation-harness.md` — previous (over-specified) take. Reference only.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| H.1 | Harness language | **TypeScript.** | Matches the rest of Puma. Avoids a second-language ops surface. Python sidecar available as a future option if ADK's Python eval primitives become critical. |
| H.2 | Judge model | **Claude Opus 4.x** for subjective assertions; deterministic assertions need no judge. | Strong judging baseline. Calibrate κ ≥ 0.6 on on-brand / refusal rubrics before trusting. |
| H.3 | Eval storage + versioning | **Scenarios in `product/evals/scenarios/` (JSON/YAML). Runs in `product/evals/runs/` (gitignored). Assertions-as-types in `ts-common`.** | Content-as-data; git history covers scenario version. |
| H.4 | CI integration | **Runs on PRs touching orchestrator / content; non-gating at launch.** | Feedback without the flakiness-kills-velocity problem. Revisit post-launch. |
| H.5 | Starter evalset size | **10–15 scenarios at launch.** Grow continuously via weekly ritual post-launch. | Focused enough to run fast; broad enough to catch regressions on load-bearing behaviours. |
| H.6 | Vendor tooling | **None in Puma.** Revisit at 100+ scenarios or when judge calibration becomes a bottleneck. | Premature platformisation. |
| H.7 | Adversarial / red-team testing | **Not in Puma.** A couple of refusal scenarios, no dedicated suite. | Out of scope for a discovery chatbot with a narrow surface. |
| H.8 | Real-conversation ingestion into evalset | **Weekly ritual post-launch.** Sanitise for PII; curate to useful scenarios. | The best evalset grows from real user behaviour. Ritualising it prevents drift into dormancy. |

---

## 6. Shared contracts consumed

- `ts-common` scenario + assertion types (authored here).
- `ts-common` event schemas (chunk F) — for event-based assertions.
- `ts-common` tool I/O (chunk A) — for tool-call assertions.
- Orchestrator HTTP endpoint (chunk B) — runs scenarios as a black box.
- Handoff store (chunk E) — asserts on persisted handoff verdicts.
- Response-format convention (chunk B §2.5a) — asserts on block presence.

---

## 7. Open sub-questions for Tier 3

- Exact scenario file format (JSON vs YAML; one file per scenario vs one file for the suite).
- Judge-model rubric authoring — template vs freeform; how much prompt engineering goes into the judge.
- Calibration procedure: how to build the held-out human-labelled set (from PoC sample conversations? from first real conversations post-launch?).
- Event-query method in CI: real Cloud Logging vs local log capture vs in-memory intercept.
- Warm-pool interaction — do scenarios run against warm-pooled sessions or always cold? Cold is more reproducible; warm is closer to production.
- Parallel scenario execution vs sequential — impacts wall-clock time in CI.
- Secrets handling for judge model API calls in CI.
- Latency + cost budget per full suite run in CI (target: <5 min, <$2).
- Flaky-scenario quarantine: if a scenario fails transiently, do we auto-retry, mark flaky, or fail hard?

---

## 8. Dependencies + coordination

- **Inbound**:
  - Chunk A's `ts-common` stubs for scenario / assertion types.
  - Chunk B's orchestrator endpoint (black-box under test).
  - Chunk F's event schemas + Cloud Logging access (for event-based assertions).
  - Chunk E's handoff verdicts persisted (for handoff assertions).
  - Chunk G.t0's HITL flow mapping (major input to scenario authorship — the inflections G identifies become the trajectories H tests).
- **Outbound**:
  - Signal into Al's prompt/content iteration (the evalset is the feedback loop).
  - Post-launch: real-conversation-derived scenarios feed back in via the weekly ritual.
- **Agent coordination**:
  - Scenario authorship is HITL — Al + Claude together, informed by G.t0. Claude Code agents draft candidate scenarios; Al curates and approves.

---

## 9. Verification

Chunk H is done when:

1. `npm run eval` (or equivalent) from `product/` runs the full starter evalset against a local orchestrator and produces a report.
2. A deliberate prompt regression (e.g. remove the "no itinerary building" refusal instruction from the system prompt) causes at least one scenario to fail with a clear message.
3. A deliberate tool-call regression (e.g. force the orchestrator to call `search` without required args) causes at least one scenario to fail.
4. The judge model's κ against a held-out human-labelled subset is ≥ 0.6 on on-brand and refusal rubrics.
5. CI runs the eval on a PR touching `product/cms/prompts/why.md` and attaches a report comment.
6. The starter evalset has 10+ scenarios covering all the categories in §2.4.
7. A Tier-3-friendly document describes how to add a new scenario: steps from "I notice this failure mode" to "scenario committed".

---

## 10. Order of execution (Tier 3 hand-off)

- **H.t1 — Harness skeleton**: TS CLI, runs one hand-authored scenario end-to-end against a local orchestrator, produces a markdown report.
- **H.t2 — Scenario + assertion types in `ts-common`**: schema for scenarios, assertions, results.
- **H.t3 — Assertion implementations**: tool-call, triage-verdict, handoff, response-format, disclosure, judge-based rubrics.
- **H.t4 — Starter evalset authorship (HITL with Al)**: draft the 10–15 scenarios, informed by G.t0 flow mapping, iterated against real orchestrator runs.
- **H.t5 — Judge calibration**: build a small held-out set; measure κ; tune rubric prompts until calibrated.
- **H.t6 — CI integration**: GitHub Actions workflow, report-comment on PR.
- **H.t7 — Post-launch weekly-ritual runbook**: `product/cms/ops/evalset-growth.md`.

H.t1–H.t3 can start as soon as B's orchestrator has a stub endpoint. H.t4 is HITL; schedule alongside G.t0. H.t5 depends on having some scenarios. H.t6 is lightweight once the harness is stable. H.t7 is documentation — lands pre-launch.

Estimated: 2–3 days of focused work for H.t1–H.t6; 0.5 day for H.t4 HITL session (alongside G.t0). H.t7 is a morning.
