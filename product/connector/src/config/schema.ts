/**
 * Zod schema for the @swoop/connector runtime config surface.
 *
 * Owned by C.t1 — see planning/03-exec-c-t1.md. The connector previously
 * shipped handoff side-effects only (mailer + FsHandoffStore), which the
 * orchestrator wires up through its own config. This schema is the *new*
 * surface the connector owns now that it boots as a service in its own right
 * (Express + MCP-over-HTTP + Postgres pool).
 *
 * Single source of truth for env vars consumed by the connector service.
 * Mirrors the pattern in product/orchestrator/src/config/schema.ts. Adding a
 * new tunable means:
 *   1. Add a field here with a sensible default.
 *   2. Mirror it in .env.example (commented).
 *   3. Re-export from ./index.ts if it's part of the public surface.
 *
 * Callers never see this schema directly — they consume the frozen `Config`
 * object produced by `loadConfig()` in ./load.ts.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

/**
 * Package root: the directory containing this package's package.json.
 *
 * With `tsx` in dev we run from src/ directly; with `node` from dist/ after a
 * build. In both cases, going two levels up from this file lands at the
 * package root (src/config/schema.ts → src/ → package root;
 * dist/config/schema.js → dist/ → package root).
 */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The raw schema — what we parse out of `process.env`.
 *
 * Defaults live here so the Tier 3 §"Full config surface" list is
 * machine-checkable. Pool tunables come with conservative defaults; ETL paths
 * (C.t3 / C.t3a) may override per-connection if they need a wider statement
 * timeout. Future tuning is a known-known surfaced in C.t1's HITL Q1.
 */
export const configSchema = z
  .object({
    // --- Postgres connection -------------------------------------------------
    //
    // Stricter validation per C.t1 HITL Q5: a malformed DATABASE_URL fails at
    // boot rather than on first query. The shape mirrors the Sec-3 fix at
    // be9ca95 for `entryUrl` — Zod's `.url()` accepts non-http(s) schemes
    // (the URL constructor doesn't reject by scheme), so we layer a `.refine()`
    // on top to enforce `postgres://` or `postgresql://` AND a non-empty
    // database name in the path component.
    DATABASE_URL: z
      .string()
      .trim()
      .min(
        1,
        'DATABASE_URL is required; set it in product/connector/.env or the environment.',
      )
      .url('DATABASE_URL must parse as a valid URL.')
      .refine(
        (raw) => {
          let url: URL;
          try {
            url = new URL(raw);
          } catch {
            return false;
          }
          // Scheme allowlist. `URL` preserves the trailing colon.
          if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
            return false;
          }
          // Database name lives in the pathname (e.g. `/puma_dev`). Strip the
          // leading `/` and require something non-empty. Multi-segment paths
          // (e.g. `/db/extra`) are rejected — pg's connection-string parser
          // would tolerate them but they're ambiguous.
          const dbName = url.pathname.replace(/^\//, '');
          if (dbName.length === 0 || dbName.includes('/')) {
            return false;
          }
          return true;
        },
        {
          message:
            'DATABASE_URL must use scheme postgres:// or postgresql:// and include a database name in the path (e.g. postgresql://user:pass@host:5432/dbname).',
        },
      ),

    // --- HTTP server ---------------------------------------------------------
    //
    // :3002 by default so the new connector coexists with the orchestrator's
    // stub at :3001 during the C.t1 → C.t4 transition (HITL Q6). The stub
    // retires in B.t3a once C.t4 lands the real tools.
    CONNECTOR_PORT: z.coerce.number().int().positive().default(3002),

    // --- Postgres pool tunables (HITL Q1) -----------------------------------
    //
    // Defaults are conservative starting calibration. Per HITL ratification:
    // surface as tunable, no specific load profile yet, ETL paths may want
    // larger `max` or different timeouts (override per-connection or via
    // env at execution time). Revisit at C.t8 runbook authoring + first
    // M4 load test.
    PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    PG_POOL_IDLE_MS: z.coerce.number().int().nonnegative().default(30_000),
    PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),

    // --- Tool description loader (C.t4 / C.34) -----------------------------
    //
    // Tool descriptions live as markdown under `cms/prompts/tools/<tool>/
    // description.md`. The MCP server loads each tool's description at boot
    // (cached process-lifetime) and registers it as the tool's MCP-facing
    // description string. Per HITL Q3 ratification: fail-fast on ALL 8 tools
    // if any `description.md` is missing.
    //
    // Default mirrors the orchestrator's SYSTEM_PROMPT_DIR pattern: relative
    // path resolved against the package root at config-load time.
    TOOLS_PROMPT_DIR: z.string().trim().min(1).default('../cms/prompts/tools'),

    // --- Memory tool description loader (T3-3 relocation) -----------------
    //
    // Memory tool descriptions live as markdown under
    // `cms/prompts/memory/tools/<tool>.md`. The connector loads them at boot
    // and registers them with the MCP server. Mirrors the TOOLS_PROMPT_DIR
    // pattern. Default points at the same cms/ tree next to this package.
    MEMORY_PROMPT_DIR: z.string().trim().min(1).default('../cms/prompts/memory'),

    // --- Gemini embeddings (visitor queries) -------------------------------
    //
    // gemini-embedding-001 / halfvec(3072), matching corpus storage shape
    // (decision C.46 + the C.t9 2026-05-13 visitor-query Voyage-holdover
    // addendum). The connector's vector retrieval primitives call Gemini to
    // embed visitor utterances into a search vector. Optional at config-load
    // time so connector boot doesn't fail when Gemini is unavailable;
    // primitives that need an embedding throw a typed error if
    // GEMINI_API_KEY is missing at call time. Tests inject their own
    // embedQuery function and never touch this.
    GEMINI_API_KEY: z.string().trim().min(1).optional(),

    // --- Pricing data capture date (C.goofy-goldstine-4) -------------------
    //
    // ISO date when the source pricing data was captured from the Swoop CMS.
    // Stamped on every `get_pricing` response so the agent and visitor know
    // how fresh the figures are. Default 2026-04-27 (the SQL dump date).
    // When a fresh dump arrives, a single env change updates the stamp.
    PRICES_CAPTURED_AT: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'PRICES_CAPTURED_AT must be ISO date YYYY-MM-DD')
      .default('2026-04-27'),

    // --- Environment selector ----------------------------------------------
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    // --- Observability sink (F-c) ------------------------------------------
    //
    // Where emitted events land (registered via setEventSink at boot):
    //   stdout         — one JSON line per event (default; dev).
    //   postgres       — durable INSERT into event_log (migration 020; single
    //                    store per C.18 — uses the connector's own DATABASE_URL
    //                    pool). SQL-queryable today; works on the demo Mini.
    //   cloud-logging  — severity-tagged structured stdout for Cloud Logging +
    //                    Error Reporting (Swoop GCP, via Cloud Run / Ops Agent).
    // See planning/03-exec-observability-c.md.
    EVENT_SINK: z.enum(['stdout', 'postgres', 'cloud-logging']).default('stdout'),
  })
  // No cross-field refinements at C.t1. The connector's surface is small
  // enough that single-field validation covers the failure modes that matter
  // (URL malformed, pool max out of range). Future tunables that interact
  // (e.g. statement-timeout vs request-timeout once a request layer lands)
  // belong in `.refine()`s here.
  ;

/**
 * The raw parsed shape — before load.ts adds derived fields.
 */
export type RawConfig = z.infer<typeof configSchema>;

/**
 * The frozen, public Config object. Callers consume this, not `RawConfig`.
 *
 * Derived fields (computed in load.ts):
 *   - packageRoot: absolute fs path to this package's root.
 *   - migrationsDirAbsolutePath: absolute path to the migrations/ directory.
 *   - isProduction: NODE_ENV === 'production'.
 */
export type Config = Readonly<
  RawConfig & {
    /** Absolute path to this package's root directory. */
    readonly packageRoot: string;
    /** Absolute path to the migrations directory consumed by migrate.ts. */
    readonly migrationsDirAbsolutePath: string;
    /** Absolute path to the tools-prompt directory (cms/prompts/tools). */
    readonly toolsPromptDirAbsolutePath: string;
    /** Absolute path to the memory-prompt directory (cms/prompts/memory). */
    readonly memoryPromptDirAbsolutePath: string;
    /** True iff NODE_ENV === 'production'. */
    readonly isProduction: boolean;
  }
>;
