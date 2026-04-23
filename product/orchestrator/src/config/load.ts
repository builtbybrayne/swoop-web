/**
 * Config loader — the ONLY module allowed to touch `process.env`.
 *
 * See planning/03-exec-agent-runtime-t6.md §"Single source of truth".
 * `grep -r "process.env" product/orchestrator/src/ --exclude-dir=node_modules`
 * should return matches only inside this directory (config/).
 *
 * Contract:
 *   - `loadConfig()` is called exactly once at startup (from src/index.ts).
 *   - On validation failure, prints a human-readable Zod error and exits(1).
 *     Callers receive a frozen `Config`, never an error.
 *   - The returned object is Object.frozen so accidental mutation is loud.
 */

import path from 'node:path';
import { configSchema, PACKAGE_ROOT, type Config } from './schema.js';

/**
 * Parse and validate process.env into a strongly-typed, frozen Config object.
 *
 * On validation error, prints each Zod issue prefixed with the field path,
 * points the operator at .env.example, and calls process.exit(1). We do not
 * throw — a throw would let callers accidentally start a half-configured
 * server; a clean exit is the contract from Tier 3 verification step 3/4.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // B.t1 legacy alias handling. If the operator sets PRIMARY_MODEL but not
  // ORCHESTRATOR_MODEL, promote it BEFORE schema.parse so the default
  // doesn't win over the operator's explicit override.
  //
  // Note: we can't write to the passed-in `env` (it might be process.env or a
  // frozen fixture in tests), so we copy to a local dict for the parse.
  const envForParse: Record<string, string | undefined> = { ...env };
  if (
    (envForParse.ORCHESTRATOR_MODEL === undefined || envForParse.ORCHESTRATOR_MODEL === '') &&
    envForParse.PRIMARY_MODEL !== undefined &&
    envForParse.PRIMARY_MODEL !== ''
  ) {
    envForParse.ORCHESTRATOR_MODEL = envForParse.PRIMARY_MODEL;
  }

  const parsed = configSchema.safeParse(envForParse);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Two lines: the actual issues, then a pointer to the example file.
    console.error('[orchestrator] Invalid configuration:\n' + issues);
    console.error(
      '[orchestrator] See product/orchestrator/.env.example for the expected shape.',
    );
    process.exit(1);
  }

  const data = parsed.data;

  // Derived fields. Absolute paths so file I/O elsewhere doesn't have to
  // know about the orchestrator's working directory.
  const systemPromptAbsolutePath = path.resolve(PACKAGE_ROOT, data.SYSTEM_PROMPT_PATH);
  const skillsDirAbsolutePath = path.resolve(PACKAGE_ROOT, data.SKILLS_DIR);

  // Strip PRIMARY_MODEL from the raw surface and replace it with a
  // non-optional alias that mirrors ORCHESTRATOR_MODEL. This is the B.t1
  // backward-compat bridge — see schema.ts docblock for details.
  const { PRIMARY_MODEL: _legacy, ...rest } = data;

  const config: Config = Object.freeze({
    ...rest,
    PRIMARY_MODEL: data.ORCHESTRATOR_MODEL,
    packageRoot: PACKAGE_ROOT,
    systemPromptAbsolutePath,
    skillsDirAbsolutePath,
    isProduction: data.NODE_ENV === 'production',
  });

  return config;
}
