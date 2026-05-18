/**
 * Scenario schema + YAML loader.
 *
 * A scenario is an authored YAML file under `harness/scenarios/*.yaml` that
 * describes a conversational test case against Puma's orchestrator.
 *
 * H.t1 shipped two assertion kinds (`contains` / `not_contains`) on the final
 * utterance. **H.t3** extends the discriminated union with:
 *
 *   - `tool_call`         — the agent invoked a named tool (optionally on a
 *                            specific turn, optionally with partial-match args).
 *   - `triage_verdict`    — the session's final triage state matches.
 *   - `handoff_event`     — a `handoff.submitted` event was (or wasn't) emitted.
 *   - `disclosure_event`  — a `consent.granted` (tier=conversation) event was
 *                            (or wasn't) emitted on conversation start.
 *   - `response_format`   — structural-block presence in the final response.
 *   - `judge_rubric`      — judge-based subjective rubric (stub today; H.t5).
 *
 * Adding a new kind is one variant in the discriminated union below + one
 * handler clause in `assertions.ts`. The Zod-strict posture (every member is
 * `.strict()`) means scenarios fail loudly when they drift from the spec.
 *
 * One scenario per file (decision H.10). Files are sorted alphabetically so
 * the numeric name prefix (`000-`, `001-`, etc.) controls report ordering.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { messageOf } from '@swoop/common';

// ---------------------------------------------------------------------------
// Verdict + tier enums.
//
// We deliberately re-declare narrow string-enums here rather than reach into
// `@swoop/common` for two reasons:
//   (i)  H.12 — the harness scaffold avoided runtime imports of the event
//        schema; that posture still applies to authored scenarios because the
//        scenario format is content-as-data and shouldn't churn whenever F's
//        wire schema versions bump.
//   (ii) The values themselves are stable wire-level identifiers shared with
//        chunk E (verdict) + chunk F (consent tier). If they ever drift, this
//        module is the canonical surface for scenario authors.
// ---------------------------------------------------------------------------

const VerdictSchema = z.enum(['qualified', 'referred_out', 'disqualified']);

// ---------------------------------------------------------------------------
// Turn schema (unchanged from H.t1).
// ---------------------------------------------------------------------------

const TurnSchema = z
  .object({
    user: z.string().min(1).max(4000),
  })
  .strict();

// ---------------------------------------------------------------------------
// Assertion variants — one zod object per `kind`. Every member is `.strict()`
// so unknown keys fail to load (catches typos in YAML).
// ---------------------------------------------------------------------------

const ContainsAssertionSchema = z
  .object({
    kind: z.literal('contains'),
    text: z.string().min(1),
  })
  .strict();

const NotContainsAssertionSchema = z
  .object({
    kind: z.literal('not_contains'),
    text: z.string().min(1),
  })
  .strict();

/**
 * `tool_call` — the agent must have called `toolName` during the run.
 *
 *   - `atTurn` (optional, 1-indexed): if set, the call must have happened on
 *     that specific turn. Omitting means "any turn".
 *   - `argsContains` (optional): a partial-match record. Every key in the
 *     record must be present in the captured tool-call's `input` object with
 *     a deeply-equal value. Missing keys on the tool call cause failure;
 *     extra keys are fine. Useful for "the agent called `find_options` with
 *     at least `{ activity: 'hiking' }` somewhere in args".
 */
const ToolCallAssertionSchema = z
  .object({
    kind: z.literal('tool_call'),
    toolName: z.string().min(1),
    atTurn: z.number().int().positive().optional(),
    argsContains: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * `triage_verdict` — the session's final triage state matches `verdict`.
 *
 *   - `reasonCode` (optional): if set, the per-verdict reason code must match
 *     too. Per `@swoop/common/handoff` the codes are per-verdict enums; we
 *     accept any non-empty string here so scenarios can be authored against
 *     codes the harness doesn't yet know about (forward-compatibility).
 */
const TriageVerdictAssertionSchema = z
  .object({
    kind: z.literal('triage_verdict'),
    verdict: VerdictSchema,
    reasonCode: z.string().min(1).optional(),
  })
  .strict();

/**
 * `handoff_event` — a `handoff.submitted` event with the given `verdict` was
 * emitted (or, when `present: false`, was NOT).
 *
 *   - `present` (default true): the polarity. `false` asserts no such event
 *     fired. Useful for "handoff-never" scenarios.
 *   - `atTurnOrLater` (optional): if set, the event must have happened at-or-
 *     after that turn (1-indexed). The turn index comes from the captured
 *     event's `turnIndex` envelope field.
 */
const HandoffEventAssertionSchema = z
  .object({
    kind: z.literal('handoff_event'),
    verdict: VerdictSchema,
    present: z.boolean().default(true),
    atTurnOrLater: z.number().int().positive().optional(),
  })
  .strict();

/**
 * `disclosure_event` — a `consent.granted` event with `tier=conversation` was
 * (or wasn't) emitted. The handler matches by event type + tier; turn index
 * doesn't matter — disclosure happens at session start.
 */
const DisclosureEventAssertionSchema = z
  .object({
    kind: z.literal('disclosure_event'),
    present: z.boolean().default(true),
  })
  .strict();

/**
 * `response_format` — structural-block presence in the final response.
 *
 *   - `hasUtter` (optional): if set, asserts whether at least one `<utter>`
 *     part was present in the final turn.
 *   - `hasReasoning` (optional): if set, asserts whether reasoning parts
 *     reached the harness. **Always set this to `false`** — reasoning is
 *     stripped server-side (B.t4 invariant) and must never reach the SSE
 *     consumer. The assertion is a sanity check that the strip-out still
 *     works.
 *   - `fyiCount` (optional): bounds on the number of `<fyi>` parts seen in
 *     the final turn. Either bound may be omitted.
 */
const FyiCountBoundsSchema = z
  .object({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  })
  .strict();

const ResponseFormatAssertionSchema = z
  .object({
    kind: z.literal('response_format'),
    hasUtter: z.boolean().optional(),
    hasReasoning: z.boolean().optional(),
    fyiCount: FyiCountBoundsSchema.optional(),
  })
  .strict();

// "At least one of hasUtter / hasReasoning / fyiCount must be set" is enforced
// at the parent-array level via `.superRefine` on `AssertionSchema` below — we
// can't `.refine` the per-variant schema inline because Zod's
// `discriminatedUnion` rejects `ZodEffects` members.

/**
 * `judge_rubric` — a subjective Claude-based rubric. Calls the `Judge` interface;
 * returns whatever the judge returned (currently `StubJudge`; H.t5 swaps in real
 * Opus).
 */
const JudgeRubricAssertionSchema = z
  .object({
    kind: z.literal('judge_rubric'),
    rubric: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();

const AssertionUnionSchema = z.discriminatedUnion('kind', [
  ContainsAssertionSchema,
  NotContainsAssertionSchema,
  ToolCallAssertionSchema,
  TriageVerdictAssertionSchema,
  HandoffEventAssertionSchema,
  DisclosureEventAssertionSchema,
  ResponseFormatAssertionSchema,
  JudgeRubricAssertionSchema,
]);

/**
 * Wrap the discriminated union with cross-variant validations:
 *   - `response_format` must have at least one field set (hasUtter /
 *     hasReasoning / fyiCount). An empty `response_format` would silently
 *     pass — not a useful assertion.
 *   - `fyiCount` bounds must include at least one of min / max.
 */
const AssertionSchema = AssertionUnionSchema.superRefine((a, ctx) => {
  if (a.kind === 'response_format') {
    if (
      a.hasUtter === undefined &&
      a.hasReasoning === undefined &&
      a.fyiCount === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'response_format needs at least one of hasUtter / hasReasoning / fyiCount',
      });
    }
    if (
      a.fyiCount !== undefined &&
      a.fyiCount.min === undefined &&
      a.fyiCount.max === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fyiCount needs at least one of `min` / `max`',
      });
    }
  }
});

const JudgeSchema = z
  .object({
    rubric: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// H.t8 — userAgent variant.
//
// A scenario is either:
//   - Shape A: `turns: [{user: ...}]` — scripted (pre-H.t8).
//   - Shape B: `userAgent: {persona, goal, terminationCriteria, modelOverride?}`
//             — agent-as-user (H.t8).
//
// We model this as a Zod union over two strict object schemas + a refinement
// catching the "both" and "neither" edge cases with clearer error messages.
// Authoring lesson from H.t1: keep schemas strict so YAML typos fail loudly.
//
// Length bounds for `persona` / `goal` are deliberately permissive — see the
// Tier 3 plan §"Task 1" + the matrix design (200–400 word personas typical).
// The 4000-char ceiling on persona matches `TurnSchema.user` for symmetry.
// ---------------------------------------------------------------------------

const TerminationCriteriaSchema = z
  .object({
    maxTurns: z.number().int().min(1).max(20).default(8),
    stopWhen: z.array(z.string().min(1)).max(5).optional(),
  })
  .strict();

const UserAgentSpecSchema = z
  .object({
    persona: z.string().min(50).max(4000),
    goal: z.string().min(20).max(800),
    terminationCriteria: TerminationCriteriaSchema,
    modelOverride: z.string().min(1).optional(),
  })
  .strict();

// Shared envelope fields — both scripted + agent variants carry them.
const SharedScenarioFields = {
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  assertions: z.array(AssertionSchema).default([]),
  judge: JudgeSchema.nullable().default(null),
};

const ScriptedScenarioSchema = z
  .object({
    ...SharedScenarioFields,
    turns: z.array(TurnSchema).min(1).max(10),
  })
  .strict();

const AgentScenarioSchema = z
  .object({
    ...SharedScenarioFields,
    userAgent: UserAgentSpecSchema,
  })
  .strict();

/**
 * The discriminated parse is done by trying both shapes. Zod's `union` picks
 * the first member that parses cleanly, which means:
 *   - {turns, !userAgent} -> matches `ScriptedScenarioSchema` only.
 *   - {!turns, userAgent} -> matches `AgentScenarioSchema` only.
 *   - {turns, userAgent}  -> matches neither (both schemas are `.strict()`,
 *                            so the extra key on each side fails).
 *   - {!turns, !userAgent} -> matches neither.
 *
 * Zod's default union error is a heap of per-member issues that's hard to
 * read. We do a pre-check first and emit a clearer message; the union is the
 * canonical shape validator behind it.
 */
export const ScenarioSchema = z.preprocess(
  (raw, ctx) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const hasTurns = 'turns' in raw;
    const hasUserAgent = 'userAgent' in raw;
    if (hasTurns && hasUserAgent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Scenario must have either `turns` (scripted) or `userAgent` (agent-as-user), not both.',
      });
      return z.NEVER;
    }
    if (!hasTurns && !hasUserAgent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Scenario must have either `turns` (scripted) or `userAgent` (agent-as-user).',
      });
      return z.NEVER;
    }
    return raw;
  },
  z.union([ScriptedScenarioSchema, AgentScenarioSchema]),
);

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScriptedScenario = z.infer<typeof ScriptedScenarioSchema>;
export type AgentScenario = z.infer<typeof AgentScenarioSchema>;
export type Assertion = z.infer<typeof AssertionSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type JudgeSpec = z.infer<typeof JudgeSchema>;
export type UserAgentSpec = z.infer<typeof UserAgentSpecSchema>;
export type TerminationCriteria = z.infer<typeof TerminationCriteriaSchema>;

/**
 * Type-guard: true when the loaded scenario is agent-as-user.
 *
 * Discriminate downstream via this guard rather than re-checking `'userAgent'
 * in scenario` so the union narrowing is centralised.
 */
export function isAgentScenario(s: Scenario): s is AgentScenario {
  return 'userAgent' in s;
}

// Per-variant inferred types — useful for handler signatures in `assertions.ts`.
export type ContainsAssertion = z.infer<typeof ContainsAssertionSchema>;
export type NotContainsAssertion = z.infer<typeof NotContainsAssertionSchema>;
export type ToolCallAssertion = z.infer<typeof ToolCallAssertionSchema>;
export type TriageVerdictAssertion = z.infer<typeof TriageVerdictAssertionSchema>;
export type HandoffEventAssertion = z.infer<typeof HandoffEventAssertionSchema>;
export type DisclosureEventAssertion = z.infer<typeof DisclosureEventAssertionSchema>;
export type ResponseFormatAssertion = z.infer<typeof ResponseFormatAssertionSchema>;
export type JudgeRubricAssertion = z.infer<typeof JudgeRubricAssertionSchema>;

/**
 * A scenario that has been loaded from disk. The `file` property is the
 * absolute path — reporters surface it so authors can find the file quickly.
 */
export interface LoadedScenario {
  readonly file: string;
  readonly scenario: Scenario;
}

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Load every `*.yaml` / `*.yml` file from `dir`, parse against the schema,
 * return them sorted by filename. Throws on the first invalid file so CI
 * catches schema drift early.
 */
export function loadScenarios(dir: string): LoadedScenario[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter(
      (e) =>
        e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')),
    )
    .map((e) => e.name)
    .sort();

  return files.map((name) => {
    const file = path.resolve(dir, name);
    const raw = readFileSync(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      const reason = messageOf(err);
      throw new Error(`[harness] YAML parse error in ${file}: ${reason}`);
    }
    const result = ScenarioSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `[harness] scenario schema error in ${file}: ${result.error.message}`,
      );
    }
    return { file, scenario: result.data };
  });
}
