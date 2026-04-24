# 03 — Execution: H.t1 Validation harness scaffold

**Status**: Tier 3 execution plan. Draft, 2026-04-24.
**Chunk**: H (validation).
**Implements**: [`02-impl-validation.md`](02-impl-validation.md) §10 — the **H.t1** (harness skeleton) task, consolidating enough of §2.1 (language), §2.2 (scenario format), §2.3 (execution flow), §2.4 (10–15 placeholder scenarios), and §2.6 (CI integration) to stand the harness up. H.t2 (ts-common types), H.t3 (assertion implementations), H.t4 (real evalset from G.t0), H.t5 (judge calibration), H.t7 (living-evalset runbook) all stay as future tasks — see §"Out of scope" below.
**Depends on**: A.t1–A.t5 (workspaces, tsconfig base, run-workspaces wrapper, CI skeleton — shipped), B.t5 (orchestrator `/session` + `/chat` endpoints — shipped).
**Produces**:
- `product/harness/` — new npm-workspaces package. Owns: runner CLI, scenario loader, orchestrator HTTP client, stub judge, markdown + JSON reporter, placeholder `scenarios/` directory.
- One-line addition to `product/package.json` `workspaces` array.
- One-line addition to `product/scripts/run-workspaces.sh` package counter.
- `.github/workflows/harness.yml` — non-gating CI job that boots the orchestrator + runs the harness on every PR touching orchestrator / cms / harness.
- Scenario format spec + three illustrative scenarios (greeting, search tool use, pricing refusal).
**Estimate**: ~0.5–1 day focused work.

---

## Purpose

Stand the harness up as a callable package so H.t3–H.t6 have somewhere to land. Today there is no harness, no scenarios, no CI coverage of behavioural regressions. The scaffold gives:

1. A TypeScript CLI (`npm --workspace @swoop/harness run eval`) that boots nothing itself but assumes an already-running orchestrator at `:8080`, reads every scenario in `scenarios/*.yaml`, runs each one as a black-box HTTP/SSE conversation, evaluates trivial pass/fail assertions, and writes a markdown report to stdout + a JSON report to a run folder.
2. A scenario file format (YAML, one-file-per-scenario) simple enough that the eventual 10–15 starter scenarios from H.t4 slot in by authoring files, not touching code.
3. A stub "judge" interface — the single abstraction point where H.t5's Claude Opus wiring lands later. Trivial assertions don't go through it.
4. A CI workflow that boots the orchestrator against a recorded Anthropic fixture (stub mode — see §"Model cost in CI"), runs the harness, attaches the markdown report as a PR comment via `actions/github-script`, never fails the PR on assertion fail. Exit code is always 0 during Puma pre-launch.

That is the complete scaffold. The real scenario set and the real judge rubric are out of scope for this task — they each have their own Tier 3 plan.

---

## Out of scope

Name it so agents don't drift:

- **Claude Opus judge wiring** — `judge.ts` exposes the interface + a `StubJudge` that returns `{ passed: true, reasoning: "stub — judge not wired" }`. H.t5 replaces it.
- **Real scenario set** — H.t4 is HITL with Al, informed by G.t0 flow mapping. Scaffold ships three illustrative scenarios + ~10 stub scenarios that assert only basic shape (so the runner exercises its full code path).
- **Assertion type catalogue** — H.t3 adds tool-call, triage-verdict, handoff-event, disclosure, refusal. Scaffold covers only two assertion kinds: `contains` and `not_contains` on the final assistant utterance text.
- **Orchestrator in-process import** — noted in §"Orchestrator invocation" as a later optimisation if CI wall-time becomes painful. Not built here.
- **Event-log assertions** — chunk F's `emitEvent` helper is being authored in parallel by `planner-e1f`; the harness ignores events for now, asserts only on final response text.
- **Judge calibration** — Cohen's κ work is H.t5; the scaffold doesn't pretend to calibrate anything.
- **Real-conversation ingestion into evalset** — H.t7 runbook task. Scaffold creates the `scenarios/` directory but doesn't populate the living-evalset ops doc.
- **Handoff / triage / mail inspection** — chunk E isn't shipped; nothing to inspect yet.

---

## Decisions closed in this task

Log these in `planning/decisions.md` at the end. Flagged inline here so reviewers can find the rationale without climbing the log.

| # | Decision | Pick |
|---|---|---|
| H.9 | Test runner | **Bespoke Node CLI** (`src/cli.ts`), **NOT vitest**. Rationale in §"Test runner choice". |
| H.10 | Scenario file format | **YAML, one scenario per file, under `product/harness/scenarios/`.** Rationale in §"Scenario format choice". |
| H.11 | Orchestrator invocation | **Local HTTP against a running `:8080` orchestrator.** In-process import deferred. Rationale in §"Orchestrator invocation". |
| H.12 | Shared event-schema import | **Don't import `@swoop/common/events` in the scaffold.** Stay loosely typed on scenario assertions; tighten in H.t3 when F's schema is stable. Rationale in §"Coordination with planner-e1f". |
| H.13 | CI gating | **Non-gating (`continue-on-error: true`).** Already committed at Tier 2 H.4; this task realises it. |

---

## Package shape

### `product/harness/package.json`

Shape (no code — file plan only):

- `name`: `@swoop/harness`
- `version`: `0.0.0`
- `private`: `true`
- `type`: `"module"` (matches orchestrator + ts-common convention)
- `main`: `./src/cli.ts`
- `description`: one-liner pointing at `planning/02-impl-validation.md`.
- `scripts`:
  - `eval`: `tsx src/cli.ts` — the main CLI entrypoint.
  - `typecheck`: `tsc --noEmit`.
  - `test`: `vitest run` — runs the harness's OWN unit tests (scenario-loader tests, not behavioural scenarios). The scaffold lands with zero vitest tests; H.t3 adds tests for assertion helpers as it goes.
- `dependencies`:
  - `@swoop/common`: `"*"` — for eventual shared types (not imported in scaffold; see H.12).
  - `yaml`: `^2.x` — YAML parser. The `yaml` package is the de facto standard; no reason to diverge from it.
  - `zod`: `^3.x` — scenario file validation at load time. Already a transitive dep; explicit here for clarity.
- `devDependencies`:
  - `@types/node`: `^20.x`.
  - `tsx`: `^4.x` — runtime for the CLI during `npm run eval`.
  - `typescript`: `^5.x`.
  - `vitest`: `^2.x` — for the harness's own unit tests.

No `build` script. The harness is a dev/CI tool — never produced as a `dist/`. `tsx` is sufficient. If that changes (e.g. we want to ship the harness as a binary to Swoop's in-house team), add `tsc` build then.

### `product/harness/tsconfig.json`

Extends `../tsconfig.base.json`. Add:
- `module`: `"NodeNext"` + `"moduleResolution": "NodeNext"` — matches orchestrator (per gotcha on `@google/adk` subpath imports; harness doesn't import ADK but the same Node-ESM posture is correct).
- `outDir`: `"./dist"` (unused without a build step but required to satisfy `noEmit: false` in the base — harmless).
- `rootDir`: `"./src"`.
- `include`: `["src/**/*", "scenarios/*.yaml"]` — YAML files listed so `resolveJsonModule`-style imports work if we ever prefer to import scenarios statically for typecheck. Not planned; covered here for future-proofing.

No `tests/` include; vitest discovers its own files.

### `product/harness/src/` layout

Seven source files, all under 150 LOC:

| File | Role |
|---|---|
| `cli.ts` | Entry point. Parses argv (just `--filter` + `--report-dir`; no fancy framework), loads scenarios, runs them, prints a markdown summary, writes JSON + markdown to `runs/<ISO-timestamp>/`. |
| `scenario.ts` | Scenario YAML schema (Zod) + `loadScenarios(dir: string): Scenario[]` loader. |
| `runner.ts` | Per-scenario execution: `runScenario(scenario, orchestrator): ScenarioResult`. Orchestrates session bootstrap + consent + turn-by-turn messages + assertion evaluation. |
| `orchestrator-client.ts` | Thin HTTP client over `fetch`. `createSession`, `grantConsent`, `sendMessage`. `sendMessage` consumes the SSE stream and returns an aggregated `{ utterText, tool_calls, reasoning_blocks, raw_parts }` record. |
| `assertions.ts` | The two v1 assertion kinds: `contains` + `not_contains`. Shape is a discriminated union so H.t3 extends the union without touching callers. |
| `judge.ts` | `Judge` interface + `StubJudge` implementation. No OpenAI / Anthropic calls in scaffold. |
| `report.ts` | `formatMarkdown(results): string` + `formatJson(results): object`. Deterministic ordering. No colour codes — CI consumes the markdown as-is. |

No `index.ts` barrel — the CLI is the only consumer; internal imports use relative paths.

### `product/harness/scenarios/`

YAML files, one per scenario. Scaffold ships:

- `scenarios/000-greeting.yaml` — illustrative.
- `scenarios/001-search-on-request.yaml` — illustrative.
- `scenarios/002-pricing-refusal.yaml` — illustrative.
- `scenarios/010-triage-qualified-placeholder.yaml` ... `scenarios/022-disclosure-event-placeholder.yaml` — ten stubs, each with a description + seed turns + a single trivial assertion (or an explicit `assertions: []` meaning "runs but asserts nothing"). Names prefixed with a numeric sort-key so report ordering is predictable.

Ten stubs + three illustrative = **13 scenarios at scaffold landing**. That's inside the 10–15 Tier 2 range. H.t4 will overwrite most of them with real scenarios post-G.t0, keeping the file layout identical.

### `product/harness/runs/`

Gitignored. `.gitkeep` inside. Produced per-run: `runs/2026-04-24T13-22-00Z/{results.json, results.md}`.

Add `harness/runs/` to the root `.gitignore` (relative to repo root). Verify no existing entry covers it.

### `product/harness/README.md`

Minimal — per `product/CLAUDE.md` "don't create README files unless asked". Skip. The Tier 3 plan + `02-impl-validation.md` cover the narrative. A `scenarios/README.md` **is** OK and useful: explains the YAML shape for the non-engineer eventually authoring scenarios. Single file, 30ish lines, no emojis, worked examples. Content lives in that file; not inlined into TS.

---

## Test runner choice

**Pick: bespoke Node CLI. Skip vitest as the scenario driver.**

Vitest is the right call for unit-testing pure functions inside the harness (the scenario loader, the assertion matchers, the report formatter). It is the **wrong** call for running behavioural scenarios against a live orchestrator over SSE. Reasons:

1. **Scenario output isn't assertions-per-scenario, it's a structured report**. Vitest's output model is test-name-and-pass/fail; we want per-scenario breakdowns with assertion detail, judge reasoning, latency, cost. Overriding vitest's reporter to do that is more work than writing the CLI directly.
2. **Scenarios are content, not code**. Treating them as test files pulls them into vitest's discovery path and couples them to a JS runtime. YAML-driven scenarios stay authorable by non-engineers — core theme 2 ("content-as-data"). A CLI that reads YAML keeps that boundary clean.
3. **CI integration wants exit code control**. The Tier 2 plan wants **non-gating** execution during Puma pre-launch (H.4 decision). Vitest's contract is "fail the run if any test fails". Overriding that per-scenario is fighting the tool. A CLI returns exit 0 by default and can add `--fail-on-error` later when we flip the switch.
4. **Report formats are markdown + JSON, not vitest's default reporters**. A PR-comment-ready markdown summary is trivial to hand-write; wiring vitest to emit it means either a custom reporter (vitest API is pre-1.0 at `^2.1`) or post-processing its JSON — more moving parts for no gain.
5. **The harness team will own this for months**. Keeping the runner bespoke keeps the surface small and learnable. Any engineer who can read 150 lines of TS can extend it; vitest-plugin-land raises the bar.

Vitest still earns its place for `assertions.ts` + `scenario.ts` unit tests. Add `vitest run` to `test` script per the package shape above; tests themselves arrive with H.t3.

Swap cost if we change our mind: low. A vitest setup would use `test.each(scenarios)(...)` inside a single file; switching to that later is one new file + config, the core runner logic stays.

---

## Scenario format choice

**Pick: YAML, one scenario per file.**

Three alternatives considered:

- **TypeScript files** — authoring scenarios = writing code. Kills the "scenarios are content" posture. Also forces everyone to re-typecheck the harness package to add a scenario. Reject.
- **JSON files** — fine, but scenarios carry multi-line prose (user messages, rubric text for the judge later, descriptions). JSON's lack of multi-line string support makes files noisy. Reject.
- **YAML** — multi-line strings via `|`, comments supported, broadly readable, one file per scenario means a diff reads cleanly in PR review. **Pick.**

One scenario per file (not one file per suite): scenarios grow organically; merging adds/edits in a suite file generates merge conflicts; per-file scales to the 50+ scenarios we'll eventually have without noise. File sort by filename is the display order.

### Scenario YAML shape (Zod-validated)

```yaml
# product/harness/scenarios/001-search-on-request.yaml
#
# Expectations about the agent's behaviour, written from the visitor's POV.
# See scenarios/README.md for the full schema.

name: "search-on-request"
description: >
  When a visitor asks for options, the agent should invoke the search tool
  (not answer from its own knowledge).

# Seed turns — sent sequentially. The agent responds after each one.
turns:
  - user: "I'm thinking about Patagonia in March, can you show me some options?"

# Assertions evaluated against the final assistant turn's aggregated response.
# v1 assertions: `contains` / `not_contains` on the utterance text.
# H.t3 adds: tool-call match, triage-verdict match, event match, judge rubric.
assertions:
  - kind: contains
    text: "option"      # case-insensitive substring on final utter text
  - kind: not_contains
    text: "£"           # agent shouldn't quote prices directly in the response

# Judge section — present but empty in scaffold. H.t5 wires the real judge.
judge: null
```

Zod schema in `scenario.ts`:

- `name`: string, 1–80 chars, kebab-case recommended (not enforced).
- `description`: string, 1–400 chars.
- `turns`: array of `{ user: string }`, 1–10 entries. Room for `{ assistant: string }` seed turns later (replay against recorded transcripts); not supported in scaffold.
- `assertions`: discriminated union keyed on `kind`. Scaffold: `"contains" | "not_contains"` both with `text: string`. H.t3 extends this union; the existing scenarios don't need changes because they use only the v1 kinds.
- `judge`: `null | { rubric: string; model?: string }`. Scaffold accepts shape; execution ignores it.

Unknown keys reject (Zod `strict`). Keeps authored scenarios from drifting silently when schema evolves.

### Illustrative scenarios (scaffold ships these three, fully fleshed)

**1. `000-greeting.yaml`** — the simplest honest scenario. One user turn ("hi"), asserts the agent's response contains a warm greeting and doesn't immediately demand the visitor's email. Trivial `contains` checks; no tool calls expected. Lets the scaffold verify its plumbing without depending on any content not yet authored.

```yaml
name: "greeting"
description: >
  On a plain opener, the agent should say hello warmly and not demand contact
  details yet. (Warmth is judge-rated later; v1 checks a keyword floor.)
turns:
  - user: "hi"
assertions:
  - kind: contains
    text: "hi"          # or "hello" / "welcome" — relax with OR in H.t3
  - kind: not_contains
    text: "email address"
judge: null
```

**2. `001-search-on-request.yaml`** — as above.

**3. `002-pricing-refusal.yaml`** — visitor asks for a definitive price; agent should hedge.

```yaml
name: "pricing-refusal"
description: >
  When asked for an exact price, the agent should quote a range or defer to a
  specialist — never commit authoritatively. (Refusal quality is judge-rated
  later; v1 checks that the response does not contain a hard-commit phrase.)
turns:
  - user: "How much does the W trail cost in January 2027? Exact price please."
assertions:
  - kind: not_contains
    text: "the exact price is"     # load-bearing — any literal commit wording
  - kind: not_contains
    text: "costs exactly"
  - kind: contains
    text: "specialist"             # expected deflection keyword
judge: null
```

The remaining ten stubs are one-liners: a `name`, `description: "TODO — replace with real scenario from G.t0"`, one `turns` entry, an empty `assertions: []`. They exercise the runner end-to-end. Names align with Tier 2 §2.4: `010-triage-qualified`, `011-group-tour-for-solo`, `012-triage-disqualified`, `013-triage-referred-out`, `014-refusal-itinerary`, `015-refusal-off-piste`, `016-handoff-too-early`, `017-handoff-never`, `018-disclosure-event`, `019-response-format`. (Skipping numbers `020–022` on the "illustrative only, ten extras" count keeps the naming airy — no gap meaning.)

Exact names adjust to G.t0 output in H.t4; the scaffold's job is to make the file layout obvious.

---

## Orchestrator invocation

**Pick: local HTTP against a running `:8080` orchestrator.**

Scenarios hit `http://localhost:${ORCHESTRATOR_PORT ?? 8080}` via fetch + SSE:

1. `POST /session` → `{ sessionId, disclosureCopyVersion }`.
2. `PATCH /session/:id/consent` with the returned `disclosureCopyVersion` + `{ consented: true }`.
3. For each turn: `POST /chat` with `{ sessionId, message }`, consume the SSE stream until the server closes it, aggregate `<utter>` text + tool-call records + raw message parts.
4. `DELETE /session/:id` to clean up (optional — the idle sweeper does it eventually).

Endpoint shapes already exist and are stable (B.t5 shipped). The harness's `orchestrator-client.ts` is a thin wrapper — ~80 LOC.

### Why HTTP, not in-process import?

In-process import would mean: harness `import { buildServer }` from `@swoop/orchestrator`, spin up the runner + session store + triage classifier in the same Node process, call the handlers directly. Pros: no port binding, no wait-for-server dance, faster iteration. Cons, all load-bearing:

1. **The orchestrator's `buildServer` expects real dependencies** — `TriageClassifier`, `MCPConnector`, a `Runner` with live Anthropic + MCP clients. Mocking these is significant work, and the mocks drift from production. The point of the harness is to catch regressions on **production-shaped behaviour** — running against a real `:8080` is closer to prod than against a half-mocked in-process graph.
2. **Extracting the agent setup is non-trivial.** The current Express app wires session creation + ADK session creation together in `onSessionCreated`; replaying that without running the full app risks subtle mismatches with prod wiring.
3. **The Express HTTP path is what production runs.** Production-shape testing > in-process speed-up, especially when Puma's scenario count is small (~15). CI wall-time isn't yet painful.

Swap cost if this bites: medium. If CI wall-time balloons post-launch (say, ≥ 30 scenarios, each turn ~5s → ~3 min end-to-end), add an in-process mode as a second backend behind the `orchestrator-client.ts` seam. Keep both modes; pick via env (`HARNESS_MODE=http|in-process`). The scenario file format doesn't change.

### Who starts the orchestrator?

- **Locally**: `npm --workspace @swoop/orchestrator run dev` in one terminal, `npm --workspace @swoop/harness run eval` in another. Plain and obvious. Document in `scenarios/README.md`.
- **CI**: the GitHub Actions workflow spins up the orchestrator in a background step, waits for `/healthz`, runs the harness, tears down. See §"CI integration".

Harness does NOT spawn the orchestrator itself — keeps the harness focused on "speak HTTP, assert results", not "manage child processes". If a future task wants `npm run eval` to bring up the full stack, that belongs in a top-level orchestration script (`product/scripts/eval.sh`), not in the harness package.

---

## Model cost in CI

**Every scenario today triggers real Sonnet + Haiku calls.** At ~£0.05–£0.25 per turn per the 30 Mar proposal, a 15-scenario suite running on every PR is £3–£15/day during active development. Not ruinous, but not free.

Options for the scaffold:

- **(a)** Use a stub `ANTHROPIC_API_KEY` in CI + swap Anthropic for a recorded-fixture client. Requires a classify/record/replay layer inside the orchestrator that doesn't exist. Rejected — out of scope.
- **(b)** Run against real Anthropic in CI but with a small suite (13 scenarios, ~£1–£3 per PR). Acceptable for Puma scale; revisit if frequency hurts.
- **(c)** Run CI only on `main` push + manually-triggered PRs (`workflow_dispatch`), not every PR. Cheaper; weaker feedback.

**Pick (b)** with a **limit** — hard cap via the Anthropic dashboard (Swoop has a spend cap already) and a `--max-scenarios` CLI flag defaulting to a safe number in CI. Revisit when the suite grows past ~30 scenarios.

CI workflow reads `ANTHROPIC_API_KEY` from a GitHub Actions secret. Name it `ANTHROPIC_API_KEY_EVAL` to distinguish from a future deploy secret — keeps billing attribution clearer in the dashboard. Value set by Al post-merge (see §"Open items for Al").

---

## CI integration

### New file: `.github/workflows/harness.yml`

Sits alongside the existing `ci.yml`. Does NOT replace it — `ci.yml` remains the gating check (typecheck + lint + build + test); `harness.yml` adds behavioural coverage that doesn't gate.

Workflow shape (content; not code):

- **Trigger**: `pull_request` on `main` with paths filter covering `product/orchestrator/**`, `product/cms/**`, `product/harness/**`, `product/ts-common/**`. Skip on pure UI-only or planning-only PRs. Match `ci.yml`'s concurrency group pattern.
- **Job `harness`**:
  - `runs-on: ubuntu-latest`, `timeout-minutes: 15` (wider than ci.yml's 10; model calls are slow).
  - `continue-on-error: true` on the job itself. **This is H.13 realised.** Harness failures never block the PR. Visibility without the flakiness-kills-velocity problem. Tier 2 H.4 decision.
  - Same Node / `npm ci` / working-directory-`product` posture as `ci.yml`.
  - Step: start orchestrator in background (`npm --workspace @swoop/orchestrator run dev &`). Pipe logs to a file for artifact upload.
  - Step: wait-for-server loop against `/healthz` (max 30s). Use `curl --retry-connrefused` — simplest honest thing.
  - Step: run harness (`npm --workspace @swoop/harness run eval -- --report-dir harness-run`). Exit code captured but not acted on (job-level `continue-on-error`).
  - Step: upload markdown + JSON + orchestrator log as artifacts (`actions/upload-artifact@v4`).
  - Step: post markdown report as PR comment. Use `actions/github-script@v7` with a minimal script reading `harness-run/results.md` and calling the comments API. Update-in-place on subsequent runs (find the existing comment by a marker like `<!-- swoop-harness-report -->` and patch it — standard pattern). If github-script's body write fails (comment API quota etc.), log and continue.

### Secrets

Requires `ANTHROPIC_API_KEY_EVAL` (see §"Model cost in CI"). Al adds after merge; the workflow no-ops cleanly if the secret is absent (check in the first step + skip with a neutral status message).

### Gating policy review point

Tier 2 H.4 decision commits to **revisiting gating post-launch**. This scaffold encodes non-gating. When H.t5 calibration lands + judge κ ≥ 0.6, the gating question reopens — likely outcome is "gate on deterministic assertions, non-gate on judge assertions". Not in scope here.

---

## Coordination with planner-e1f

**`planner-e1f` owns `@swoop/common/events.ts` — the event schema being authored in parallel.** They may propose the harness import the event types for scenario assertions.

**My posture**: not yet. Three reasons:

1. **Scaffold doesn't do event-based assertions at all.** Chunk F's `emitEvent` helper hasn't retrofitted B/C/D yet; events exist as `console.log` shapes in production. Wiring the harness to event-based assertions is premature — the events aren't emitted in a structured place yet.
2. **Loose coupling now, tighten later**. When H.t3 adds `event_match` assertions (Tier 2 §2.2), the harness will consume the event schema. At that point, import from `@swoop/common`. Today: the harness only asserts on final utterance text, so there's nothing to type against from F's work.
3. **One pass to carry forward**. If H.t3 forces a schema change (e.g. the harness needs an event-query API with filtering shape not anticipated), doing that dialogue with `planner-e1f` while their types are still pliable is cheaper than retrofitting after they harden.

**Exchange plan with planner-e1f**:

- If they ping with "import my event types?": "Not in scaffold — I'll hold until H.t3 adds event-based assertions. Ping me when your schema stabilises + I'll wire it in one pass. Your work unblocks scenario authors in H.t4 though — can you ensure event names stay stable once merged? That'd prevent churn on my side."
- Otherwise: no action. The scaffold package declares `@swoop/common` as a dep so the plumbing is ready. Zero runtime imports of `events`-module types.

One exchange, maximum. Don't sprawl.

---

## Judge stub

`judge.ts` exports:

- `Judge` interface: `evaluate(rubric: string, response: string, context?: unknown): Promise<JudgeVerdict>`.
- `JudgeVerdict`: `{ passed: boolean; reasoning: string; model?: string; rawResponse?: string }`.
- `StubJudge` class implementing `Judge` — returns `{ passed: true, reasoning: "stub — judge not wired (H.t5)" }` every call. No network.

`runner.ts` instantiates `new StubJudge()` and passes it to scenarios with `judge: { rubric: "..." }` sections. Scaffold scenarios all have `judge: null` so the stub path never actually runs — the code exists only to make H.t5's wiring a one-class-swap, not a "change four files" refactor.

H.t5 replaces `StubJudge` with `AnthropicJudge` (Claude Opus 4.x, per Tier 2 H.2). Same interface, one new dep (`@anthropic-ai/sdk` — already in orchestrator's deps tree; add a direct dep at that point to be explicit).

---

## Workspace + scripts wiring

### `product/package.json`

Add `"harness"` to the `workspaces` array. Position: last (alphabetical-ish ordering doesn't matter; append is least-diff).

No changes to root scripts — `build`, `typecheck`, `test` are driven by `run-workspaces.sh`, which iterates the package list.

### `product/scripts/run-workspaces.sh`

Add `harness` to the `for d in ts-common orchestrator connector ui ingestion; do` loop. Single-word edit: append ` harness` before the `; do`.

### `product/CLAUDE.md`

Add a row to the workspace-layout table:

| Package | Role | Chunk |
|---|---|---|
| `harness/` | Behavioural evals: TS CLI runs YAML scenarios through `:8080` orchestrator. Non-gating CI. | H |

Append-only edit; don't touch the surrounding narrative.

---

## Verification

Scaffold is done when:

1. `npm --workspace @swoop/harness run typecheck` passes.
2. `npm --workspace @swoop/harness run test` passes (zero vitest tests today — runs cleanly, exits 0).
3. With the orchestrator running at `:8080`, `npm --workspace @swoop/harness run eval` runs all 13 scenarios end-to-end against real Anthropic, writes a report to `product/harness/runs/<timestamp>/`, and returns exit 0. At least the three illustrative scenarios pass deterministically against the current M1 system prompt (placeholder as it is). The ten stubs with `assertions: []` pass by default.
4. `product/harness/runs/` exists in `.gitignore` (repo-root file) and is not committed.
5. The CI workflow `harness.yml` runs on a PR touching `product/orchestrator/src/server/chat.ts` (or equivalent) and attaches a markdown comment. The PR is not blocked if scenarios fail.
6. `scenarios/README.md` exists and documents the YAML shape + how to run the harness locally.
7. Root `planning/decisions.md` has entries H.9 – H.13.
8. No changes to `product/orchestrator/**`, `product/ui/**`, `product/ts-common/**`, or any sibling's territory.

---

## Handoff

- **H.t2 (scenario + assertion types in `ts-common`)** — the Zod schemas in `scenario.ts` are local. H.t2 lifts the types into `@swoop/common/evals.ts` once stable so scenarios-as-documents have a shared type surface with future tooling. Low-friction refactor; intentionally deferred so scaffold doesn't touch sibling-owned territory.
- **H.t3 (assertion implementations)** — extends the `assertions.ts` discriminated union with tool-call, triage, event, disclosure, and judge-rubric kinds. Depends on F's event schema being stable (coordinate with planner-e1f).
- **H.t4 (real evalset authorship)** — HITL with Al post-G.t0. Overwrites most of the ten stub YAMLs with real content. No code changes.
- **H.t5 (judge calibration)** — swaps `StubJudge` for `AnthropicJudge`. Lands the κ ≥ 0.6 calibration procedure from Tier 2 §2.3.
- **H.t6 (CI gating flip)** — removes `continue-on-error: true` once the judge is calibrated. Decision reopens at Puma launch review.

---

## Open items for Al

Not blocking scaffold, but flagged for the triage pass:

1. **`ANTHROPIC_API_KEY_EVAL` secret** — add to GitHub Actions secrets after the workflow merges. Not blocking merge; the workflow no-ops cleanly without it.
2. **Cost cap** — confirm the existing Anthropic dashboard spend cap is low enough to stay honest on eval-driven spend, or set a dedicated project key with its own cap. Log outcome to `questions.md` under "Cost control".
3. **Scenario authorship schedule** — H.t4 is sequenced against G.t0. Calendar confirmation with Luke + Lane (~May 4 per next-steps.md) tightens this date.
