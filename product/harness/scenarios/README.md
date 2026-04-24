# Swoop harness scenarios

This folder holds the behavioural scenarios the harness drives through Puma's
orchestrator. Each file is a single YAML scenario, validated at load time
against the Zod schema in `../src/scenario.ts` (strict — unknown keys reject).

Scenarios are **content**, not code. Authoring a scenario means editing a
YAML file, not touching TypeScript. That's a load-bearing invariant across
chunks G (content) and H (validation).

## File layout

One scenario per file. Filename prefix is numeric to control report ordering
(`000-`, `001-`, …). Illustrative scenarios live under `000`–`009`;
placeholder stubs for the real evalset live under `010`+ and get rewritten
by H.t4 (HITL scenario authorship session with Al, informed by G.t0).

## Schema

```yaml
name: "search-on-request"
description: >
  When a visitor asks for options, the agent should invoke the search tool
  (not answer from its own knowledge).

# Seed turns — sent sequentially; the agent responds after each one. Up to 10.
turns:
  - user: "I'm thinking about Patagonia in March, can you show me some options?"

# Assertions against the final assistant utterance. v1 kinds only; H.t3 adds
# tool-call, triage, event, disclosure, and judge-rubric kinds.
assertions:
  - kind: contains          # case-insensitive substring on the final utter text
    text: "option"
  - kind: not_contains
    text: "£"               # agent shouldn't quote prices directly

# Optional judge block. Scaffold ignores it (StubJudge); H.t5 wires Claude Opus.
judge: null
```

### Fields

| Key | Type | Notes |
|---|---|---|
| `name` | string (1–80) | Kebab-case recommended. |
| `description` | string (1–400) | Shown in the report; explains the behaviour under test. |
| `turns` | array of `{ user: string }` (1–10) | Sent sequentially. Assistant seed turns not yet supported. |
| `assertions` | array of `Assertion` | Optional; defaults to `[]`. |
| `judge` | `{ rubric: string; model?: string }` or `null` | Scaffold ignores non-null. |

### Assertion kinds (v1)

- `contains` — case-insensitive substring must appear in the final utterance.
- `not_contains` — case-insensitive substring must NOT appear.

H.t3 extends this discriminated union with `tool_call`, `triage_verdict`,
`event_match`, `disclosure`, and `judge_rubric` kinds. Authored scenarios keep
working because the schema is additive.

## Running the harness locally

From `product/`:

```bash
# In one terminal: orchestrator on :8080.
npm --workspace @swoop/orchestrator run dev

# In another: the harness.
npm --workspace @swoop/harness run eval

# Filter to one scenario by name substring.
npm --workspace @swoop/harness run eval -- --filter greeting

# Cap scenario count (useful for CI cost control).
npm --workspace @swoop/harness run eval -- --max-scenarios 5

# Point at a different orchestrator URL.
npm --workspace @swoop/harness run eval -- --base-url http://localhost:9090
```

The harness writes a timestamped run folder under `../runs/` containing both
`results.md` (PR-comment-friendly) and `results.json` (archive).

The harness does NOT spawn the orchestrator itself. If orchestrator isn't up
at `:8080` every scenario will `errored` with an ECONNREFUSED message — the
CLI still exits 0 (non-gating posture, Tier 3 H.13).

## Cost

Every scenario today triggers real Claude Sonnet + Haiku calls (`~£0.05–£0.25`
per turn per the 30 Mar proposal). A full 13-scenario suite costs on the
order of £1–£3. CI uses `--max-scenarios` + a PR-label gate to keep spend
predictable — see `.github/workflows/harness.yml`.
