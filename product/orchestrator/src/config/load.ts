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
import { emitErrorRaised } from '@swoop/common';
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

  // ORCHESTRATOR_DATABASE_URL falls back to DATABASE_URL so a single-store
  // deployment (C.18) can share the connector's URL without duplicating it.
  // Promote BEFORE parse so the cross-field refines (SESSION_BACKEND=postgres /
  // EVENT_SINK=postgres) and every downstream reader see one resolved value
  // instead of the refine rejecting boot. Mirrors the PRIMARY_MODEL promotion.
  if (
    (envForParse.ORCHESTRATOR_DATABASE_URL === undefined ||
      envForParse.ORCHESTRATOR_DATABASE_URL === '') &&
    envForParse.DATABASE_URL !== undefined &&
    envForParse.DATABASE_URL !== ''
  ) {
    envForParse.ORCHESTRATOR_DATABASE_URL = envForParse.DATABASE_URL;
  }

  const parsed = configSchema.safeParse(envForParse);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Structured signal for Cloud Logging / BigQuery so config failures at
    // boot are greppable alongside runtime events. `sessionId` is
    // deliberately `"unknown"` — boot fails before any session exists.
    emitErrorRaised({
      sessionId: 'unknown',
      actor: 'system',
      errorType: 'config_invalid',
      chunk: 'B',
      sanitisedContext: issues,
    });
    // Human-facing tail stays on stderr so the operator sees the pointer to
    // .env.example immediately without hunting through structured logs.
    console.error(
      '[orchestrator] Invalid configuration:\n' + issues +
        '\n[orchestrator] See product/orchestrator/.env.example for the expected shape.',
    );
    process.exit(1);
  }

  const data = parsed.data;

  // Derived fields. Absolute paths so file I/O elsewhere doesn't have to
  // know about the orchestrator's working directory.
  const systemPromptDirAbsolutePath = path.resolve(PACKAGE_ROOT, data.SYSTEM_PROMPT_DIR);
  const skillsDirAbsolutePath = path.resolve(PACKAGE_ROOT, data.SKILLS_DIR);
  const toolsPromptDirAbsolutePath = path.resolve(PACKAGE_ROOT, data.TOOLS_PROMPT_DIR);
  const memoryPromptDirAbsolutePath = path.resolve(PACKAGE_ROOT, data.MEMORY_PROMPT_DIR);
  const handoffTemplatesDirAbsolutePath = path.resolve(PACKAGE_ROOT, data.HANDOFF_TEMPLATES_DIR);

  // Strip PRIMARY_MODEL from the raw surface and replace it with a
  // non-optional alias that mirrors ORCHESTRATOR_MODEL. This is the B.t1
  // backward-compat bridge — see schema.ts docblock for details.
  const { PRIMARY_MODEL: _legacy, ...rest } = data;

  const config: Config = Object.freeze({
    ...rest,
    PRIMARY_MODEL: data.ORCHESTRATOR_MODEL,
    packageRoot: PACKAGE_ROOT,
    systemPromptDirAbsolutePath,
    skillsDirAbsolutePath,
    toolsPromptDirAbsolutePath,
    memoryPromptDirAbsolutePath,
    handoffTemplatesDirAbsolutePath,
    isProduction: data.NODE_ENV === 'production',
    // Dev/test model picker is live only when an allow-list is configured AND
    // we're not in production. The per-request override + GET /models endpoint
    // both gate on this (M-PICK-2/3).
    modelPickerEnabled:
      data.MODEL_PICKER_ALLOWLIST.length > 0 && data.NODE_ENV !== 'production',
    // Dev/test thinking toggle: honoured whenever not production (no allow-list —
    // thinking on/off is cheap + valid on every family). TT-3.
    thinkingPickerEnabled: data.NODE_ENV !== 'production',
  });

  return config;
}
