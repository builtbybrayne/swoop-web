/**
 * Scenario schema + YAML loader (H.t1).
 *
 * A scenario is an authored YAML file under `harness/scenarios/*.yaml` that
 * describes a conversational test case against Puma's orchestrator. The schema
 * stays deliberately narrow here: only the two v1 assertion kinds
 * (`contains` / `not_contains`) are supported. H.t3 extends the discriminated
 * union without touching callers.
 *
 * One scenario per file (decision H.10). Files are sorted alphabetically so
 * the numeric name prefix (`000-`, `001-`, etc.) controls report ordering.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — strict so scenarios fail loudly when they drift from the spec.
// ---------------------------------------------------------------------------

const TurnSchema = z
  .object({
    user: z.string().min(1).max(4000),
  })
  .strict();

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

const AssertionSchema = z.discriminatedUnion('kind', [
  ContainsAssertionSchema,
  NotContainsAssertionSchema,
]);

const JudgeSchema = z
  .object({
    rubric: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(400),
    turns: z.array(TurnSchema).min(1).max(10),
    assertions: z.array(AssertionSchema).default([]),
    judge: JudgeSchema.nullable().default(null),
  })
  .strict();

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Assertion = z.infer<typeof AssertionSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type JudgeSpec = z.infer<typeof JudgeSchema>;

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
      const reason = err instanceof Error ? err.message : String(err);
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
