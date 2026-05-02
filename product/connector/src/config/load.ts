/**
 * Config loader — the ONLY module allowed to touch `process.env` in
 * @swoop/connector.
 *
 * See planning/03-exec-c-t1.md. Mirrors the orchestrator's pattern at
 * product/orchestrator/src/config/load.ts: parse process.env via Zod,
 * print a human-readable error and exit(1) on failure, return a frozen
 * `Config` to callers.
 *
 * `grep -r "process.env" product/connector/src/ --exclude-dir=node_modules`
 * should return matches only inside this directory (config/) plus the
 * dotenv side-effect import in src/server/index.ts and src/migrate.ts.
 */

import path from 'node:path';
import { configSchema, PACKAGE_ROOT, type Config } from './schema.js';

/**
 * Parse and validate process.env into a strongly-typed, frozen Config object.
 *
 * On validation error, prints each Zod issue prefixed with the field path,
 * points the operator at .env.example, and calls process.exit(1). We do not
 * throw — a throw would let callers accidentally start a half-configured
 * service; a clean exit fail-fast is the contract from C.t1's HITL Q5
 * (stricter validation, reject malformed at boot).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(
      '[connector] Invalid configuration:\n' +
        issues +
        '\n[connector] See product/connector/.env.example for the expected shape.',
    );
    process.exit(1);
  }

  const data = parsed.data;

  const migrationsDirAbsolutePath = path.resolve(PACKAGE_ROOT, 'migrations');
  const toolsPromptDirAbsolutePath = path.resolve(PACKAGE_ROOT, data.TOOLS_PROMPT_DIR);

  const config: Config = Object.freeze({
    ...data,
    packageRoot: PACKAGE_ROOT,
    migrationsDirAbsolutePath,
    toolsPromptDirAbsolutePath,
    isProduction: data.NODE_ENV === 'production',
  });

  return config;
}
