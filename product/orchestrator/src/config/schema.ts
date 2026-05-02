/**
 * Zod schema for the Puma orchestrator's full config surface.
 *
 * Ownership: B.t6 — see planning/03-exec-agent-runtime-t6.md for the canonical
 * surface list and defaults. The schema is the single source of truth for what
 * env vars this service accepts. Adding a new tunable means:
 *   1. Add a field here with a sensible default.
 *   2. Mirror it in .env.example (commented).
 *   3. Re-export from ./index.ts if it's part of the public surface.
 *
 * Callers never see this schema directly — they consume the frozen `Config`
 * object produced by `loadConfig()` in ./load.ts.
 *
 * B.t1 backward-compatibility note:
 *   B.t1 exposed `PRIMARY_MODEL` as the orchestrator's model id. B.t6 renames
 *   this to `ORCHESTRATOR_MODEL` but keeps `PRIMARY_MODEL` as a deprecated
 *   alias so existing callers (src/index.ts, src/agent/factory.ts) keep
 *   working. Precedence: `ORCHESTRATOR_MODEL` wins if both are set.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

/**
 * Default Claude Sonnet model id for the orchestrator.
 *
 * Pinned to the Sonnet that was current when B.t1 was implemented
 * (2026-04-22). Override via `ORCHESTRATOR_MODEL` (or legacy `PRIMARY_MODEL`)
 * to test other tiers without a code change.
 */
export const DEFAULT_ORCHESTRATOR_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Default model id for the functional classifier agent (B.t7).
 *
 * A cheap+fast Haiku tier — classification is a short, narrow task where
 * we trade capability for latency and per-call cost. B.t7 may revisit.
 */
export const DEFAULT_CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';

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
 * Session backend selector. `in-memory` is the only backend wired in B; the
 * rest are reserved names for later chunks so we can flip without a schema
 * change. Unknown values fail validation cleanly.
 */
export const SessionBackend = z.enum(['in-memory', 'adk-native', 'vertex-ai', 'firestore']);
export type SessionBackend = z.infer<typeof SessionBackend>;

/**
 * Parse a comma-separated origins list into a trimmed, de-duplicated array.
 * Empty strings (including "") produce an empty array, not [""].
 */
const csvOrigins = z
  .string()
  .default('http://localhost:5173')
  .transform((raw) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // De-dupe while preserving order.
    return Array.from(new Set(parts));
  });

/**
 * The raw schema — what we parse out of `process.env`. Everything here uses
 * Zod coercion where the env var arrives as a string. Defaults live here so
 * the Tier 3 §"Full config surface" list is machine-checkable.
 */
export const configSchema = z
  .object({
    // --- Required secret -------------------------------------------------
    ANTHROPIC_API_KEY: z
      .string()
      .trim()
      .min(
        1,
        'ANTHROPIC_API_KEY is required; set it in product/orchestrator/.env or the environment.',
      ),

    // --- Orchestrator agent model ---------------------------------------
    ORCHESTRATOR_MODEL: z.string().trim().min(1).default(DEFAULT_ORCHESTRATOR_MODEL),
    ORCHESTRATOR_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
    ORCHESTRATOR_MAX_TOKENS: z.coerce.number().int().positive().default(2048),

    // --- Functional classifier model (B.t7 consumes) --------------------
    FUNCTIONAL_CLASSIFIER_MODEL: z.string().trim().min(1).default(DEFAULT_CLASSIFIER_MODEL),
    FUNCTIONAL_CLASSIFIER_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),

    // --- B.t1 legacy alias ----------------------------------------------
    // Optional. If set and ORCHESTRATOR_MODEL is not explicitly set,
    // load.ts copies this into ORCHESTRATOR_MODEL so B.t1 callers keep
    // working. We accept it here (rather than in load.ts) so schema parse
    // still owns the single source of truth.
    PRIMARY_MODEL: z.string().trim().min(1).optional(),

    // --- Content paths ---------------------------------------------------
    // Per G.11: system prompt is the concatenation of files matching
    // `^\d{2}_[a-z0-9-]+\.md$` inside SYSTEM_PROMPT_DIR. SKILLS_DIR is the
    // base path passed to ADK's `loadAllSkillsInDir`. TOOLS_PROMPT_DIR holds
    // one folder per tool with a `description.md` inside, loaded at boot by
    // both the connector (per C.t4) and the orchestrator's connector
    // adapter (per B.t3a) via `loadAllToolDescriptions` from
    // `@swoop/connector`. Fail-fast on any missing/empty file.
    SYSTEM_PROMPT_DIR: z.string().trim().min(1).default('../cms/prompts/system'),
    SKILLS_DIR: z.string().trim().min(1).default('../cms/prompts/skills'),
    TOOLS_PROMPT_DIR: z.string().trim().min(1).default('../cms/prompts/tools'),

    // --- Session ---------------------------------------------------------
    SESSION_BACKEND: SessionBackend.default('in-memory'),
    SESSION_TTL_IDLE_HOURS: z.coerce.number().int().positive().default(24),
    SESSION_TTL_ARCHIVE_DAYS: z.coerce.number().int().positive().default(7),

    // --- Connector -------------------------------------------------------
    // Default points at the real @swoop/connector service on :3002 (per
    // C.t1 + C.t4 boot path). Pre-B.t3a (2026-05-02) this defaulted to
    // :3001 — the in-tree stub-connector test fixture — because the real
    // connector hadn't yet registered the eight intent-named tools. B.t3a
    // retires the stub; the orchestrator now talks to the real connector
    // by default in dev. Override via .env if you're pointing at a remote
    // connector or a non-default port.
    CONNECTOR_URL: z
      .string()
      .trim()
      .url('CONNECTOR_URL must be an absolute URL (e.g. http://localhost:3002/mcp).')
      .default('http://localhost:3002/mcp'),
    CONNECTOR_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    // --- Server ----------------------------------------------------------
    PORT: z.coerce.number().int().positive().default(8080),
    NODE_ENV: z.string().trim().min(1).default('development'),
    CORS_ALLOWED_ORIGINS: csvOrigins,

    // --- Warm pool (B.t10) ----------------------------------------------
    // Default 0 = disabled. Plan is explicit: ship the pool disabled so the
    // code path exists for post-M4 when a network-backed session backend
    // makes pre-warming load-bearing. With the in-memory store the pool is
    // latent architectural prep, not a perf win.
    WARM_POOL_SIZE: z.coerce.number().int().nonnegative().default(0),
    WARM_POOL_TTL_MINUTES: z.coerce.number().int().positive().default(30),

    // --- Handoff mailer (E.t3) ------------------------------------------
    // Off by default. Flip HANDOFF_EMAIL_ENABLED to true once the
    // sales-inbox address + SMTP creds are confirmed (Julie — tracked in
    // questions.md). When enabled, the cross-field refine below requires
    // HANDOFF_EMAIL_FROM, HANDOFF_EMAIL_TO_QUALIFIED, SMTP_USER, SMTP_PASS.
    HANDOFF_EMAIL_ENABLED: z
      .string()
      .default('false')
      .transform((s) => s.toLowerCase() === 'true' || s === '1'),
    HANDOFF_EMAIL_FROM: z.string().trim().default(''),
    HANDOFF_EMAIL_TO_QUALIFIED: z.string().trim().default(''),
    /** Falls back to HANDOFF_EMAIL_TO_QUALIFIED at send time if blank. */
    HANDOFF_EMAIL_TO_REFERRED_OUT: z.string().trim().default(''),
    /** Directory holding qualified.md / referred-out.md template files. */
    HANDOFF_TEMPLATES_DIR: z.string().trim().min(1).default('../cms/templates/handoff'),

    // --- SMTP transport (consumed by the handoff mailer) ----------------
    SMTP_HOST: z.string().trim().min(1).default('smtp.gmail.com'),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_SECURE: z
      .string()
      .default('true')
      .transform((s) => s.toLowerCase() !== 'false' && s !== '0'),
    SMTP_USER: z.string().trim().default(''),
    SMTP_PASS: z.string().trim().default(''),
  })
  // Warm-pool TTL must be strictly shorter than the idle-session TTL.
  // A warm entry outliving the session sweeper is a footgun: the pool could
  // hand out an id the sweeper archived between ticks. Fail-fast at config
  // parse so the operator sees the bug before the first request lands.
  .refine(
    (cfg) => cfg.WARM_POOL_TTL_MINUTES * 60 < cfg.SESSION_TTL_IDLE_HOURS * 3600,
    {
      path: ['WARM_POOL_TTL_MINUTES'],
      message:
        'WARM_POOL_TTL_MINUTES (in seconds) must be strictly less than SESSION_TTL_IDLE_HOURS (in seconds) so warm entries do not outlive the session sweeper window.',
    },
  )
  // When the handoff mailer is enabled, the credentials + recipient + from
  // address must all be present. Fail-fast at config parse so a misconfigured
  // production deploy never silently swallows handoffs.
  .refine(
    (cfg) =>
      !cfg.HANDOFF_EMAIL_ENABLED ||
      (cfg.HANDOFF_EMAIL_FROM.length > 0 &&
        cfg.HANDOFF_EMAIL_TO_QUALIFIED.length > 0 &&
        cfg.SMTP_USER.length > 0 &&
        cfg.SMTP_PASS.length > 0),
    {
      path: ['HANDOFF_EMAIL_ENABLED'],
      message:
        'HANDOFF_EMAIL_ENABLED=true requires HANDOFF_EMAIL_FROM, HANDOFF_EMAIL_TO_QUALIFIED, SMTP_USER, and SMTP_PASS. Set them in .env or set HANDOFF_EMAIL_ENABLED=false to disable the mailer.',
    },
  );
// Note: Zod's default `.strip()` mode silently drops extra keys from the
// output (PATH, HOME, etc). That's what we want — we never want to widen the
// typed Config with arbitrary env vars. Don't switch to `.passthrough()`:
// it re-types every field as `unknown` on the inferred type.

/**
 * The raw parsed shape — before load.ts adds derived fields.
 */
export type RawConfig = z.infer<typeof configSchema>;

/**
 * The frozen, public Config object. Callers consume this, not `RawConfig`.
 *
 * Derived fields (computed in load.ts):
 *   - packageRoot: absolute fs path to this package's root.
 *   - systemPromptDirAbsolutePath: SYSTEM_PROMPT_DIR resolved against packageRoot.
 *   - skillsDirAbsolutePath: SKILLS_DIR resolved against packageRoot.
 *   - toolsPromptDirAbsolutePath: TOOLS_PROMPT_DIR resolved against packageRoot.
 *   - handoffTemplatesDirAbsolutePath: HANDOFF_TEMPLATES_DIR resolved against packageRoot.
 *   - isProduction: NODE_ENV === 'production'.
 *
 * Backward-compatibility with B.t1:
 *   - `PRIMARY_MODEL` is mirrored to equal `ORCHESTRATOR_MODEL`. B.t1 callers
 *     reading `config.PRIMARY_MODEL` keep working; new callers should read
 *     `config.ORCHESTRATOR_MODEL` or use `getModelFor('orchestrator')`.
 */
export type Config = Readonly<
  Omit<RawConfig, 'PRIMARY_MODEL'> & {
    /** Mirrors ORCHESTRATOR_MODEL. Kept as a non-optional string for B.t1 callers. */
    readonly PRIMARY_MODEL: string;
    /** Absolute path to this package's root directory. */
    readonly packageRoot: string;
    /** Absolute path to the system-prompt directory (the concatenation source per G.11). */
    readonly systemPromptDirAbsolutePath: string;
    /** Absolute path to the skills directory (ADK loadAllSkillsInDir base path). */
    readonly skillsDirAbsolutePath: string;
    /**
     * Absolute path to the tools-prompt directory (`cms/prompts/tools/`).
     * Holds one folder per tool with a `description.md`. Loaded at boot by
     * the orchestrator's connector adapter (B.t3a) via
     * `loadAllToolDescriptions` from `@swoop/connector`.
     */
    readonly toolsPromptDirAbsolutePath: string;
    /** Absolute path to the handoff email-template directory (E.t3 mailer reads from here). */
    readonly handoffTemplatesDirAbsolutePath: string;
    /** True iff NODE_ENV === 'production'. Controls prompt-loader caching, CORS strictness, etc. */
    readonly isProduction: boolean;
  }
>;
