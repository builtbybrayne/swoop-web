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
 * Default model id for the Opus memory agent (sm-1 / T3-3).
 *
 * Memory authoring is a deliberate, low-frequency staff-only task —
 * quality beats speed, so Opus is the right tier. Override via
 * MEMORY_AGENT_MODEL in .env without a code change (decision B.5).
 */
export const DEFAULT_MEMORY_AGENT_MODEL = 'claude-opus-4-8';

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
 * Session backend selector. `in-memory` is the default; `postgres` is B.t13.
 * Unknown values fail validation cleanly.
 */
export const SessionBackend = z.enum(['in-memory', 'adk-native', 'postgres', 'vertex-ai', 'firestore']);
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

    // --- Memory agent model (sm-1 / T3-3) --------------------------------
    // Opus by default — memory authoring is a deliberate staff-only task
    // where quality beats latency. Swappable via .env (decision B.5).
    MEMORY_AGENT_MODEL: z.string().trim().min(1).default(DEFAULT_MEMORY_AGENT_MODEL),
    MEMORY_AGENT_MAX_TOKENS: z.coerce.number().int().positive().default(2048),

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

    // Demo / tactical override: when true, the full body of every loaded
    // skill is appended to the system prompt as an appendix. Bypasses the
    // ADK list_skills / load_skill dance entirely — Sonnet sees every
    // pattern in context regardless of whether it would have called the
    // load tool. Costs ~20K extra system-prompt tokens (cache-friendly,
    // ~one-tenth-of-a-cent per conversation with prompt caching).
    //
    // The XML skills-index (`<available_skills>...</available_skills>`)
    // is injected unconditionally to fix the ADK toolset.processLlmRequest
    // bug — see agent/skills-prompt-injection.ts + gotchas.md. This flag
    // only controls whether the bodies are also appended.
    PRELOAD_SKILL_BODIES: z
      .string()
      .default('false')
      .transform((s) => s.toLowerCase() === 'true' || s === '1'),

    // --- Session ---------------------------------------------------------
    SESSION_BACKEND: SessionBackend.default('in-memory'),
    SESSION_TTL_IDLE_HOURS: z.coerce.number().int().positive().default(24),
    SESSION_TTL_ARCHIVE_DAYS: z.coerce.number().int().positive().default(7),
    // Connection URL for postgres session backend (B.t13). Required when
    // SESSION_BACKEND=postgres. Falls back to DATABASE_URL if absent so
    // operators can share the connector's DB URL without duplication.
    // Empty string = not set; the cross-field refine below enforces presence
    // when postgres is selected.
    ORCHESTRATOR_DATABASE_URL: z.string().trim().default(''),

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

    // --- Staff authentication (staff-auth task) -------------------------
    //
    // A single shared password lets sales staff authenticate so they can
    // author agent memories. The v2 per-user path (Google OIDC) is behind
    // the same StaffAuthenticator interface and needs only a constructor
    // swap, not a caller change.
    //
    // Both vars are REQUIRED if STAFF_AUTH_ENABLED is true. Fail-fast at
    // boot — a password endpoint that silently accepts any token because the
    // secret is blank would be a critical security hole. The cross-field
    // refine below enforces presence when the feature is enabled.
    STAFF_AUTH_ENABLED: z
      .string()
      .default('false')
      .transform((s) => s.toLowerCase() === 'true' || s === '1'),
    /**
     * Shared staff password. Min 12 chars enforced only when the feature is
     * enabled (the refine below) so existing .env files without the var
     * still parse cleanly when STAFF_AUTH_ENABLED=false.
     */
    STAFF_AUTH_PASSWORD: z.string().trim().default(''),
    /**
     * JWT signing secret. HMAC-SHA256. Treat with the same care as
     * ANTHROPIC_API_KEY — never log it.
     */
    STAFF_JWT_SECRET: z.string().trim().default(''),
    /**
     * JWT TTL in days. Default 30 — long enough that staff are not nagged,
     * short enough that a compromised token expires before causing lasting
     * damage. Override in .env if policy requires shorter.
     */
    STAFF_JWT_TTL_DAYS: z.coerce.number().int().positive().default(30),

    // --- Handoff retention sweeper (E.t6) -------------------------------
    //
    // Off by default. When enabled, the orchestrator registers an
    // `setInterval` that calls `sweepHandoffs` from `@swoop/connector` on
    // a fixed cadence (default daily). A first sweep fires
    // `HANDOFF_RETENTION_SWEEP_INITIAL_DELAY_MS` after boot so the boot
    // logs stay clean.
    //
    // The CLI external-trigger path (`npm run sweep:handoffs --workspace
    // @swoop/connector`) is independent of these flags — it always runs
    // exactly one sweep against the configured store regardless of the
    // env var. That's the prod-ready path (Cloud Scheduler → Cloud Run
    // Job will call the CLI); the in-process timer is the dev-comfort
    // path for the FS interim.
    //
    // Retention windows themselves are not env-tunable — they live in
    // `product/cms/legal/compliance-bundle/05-retention-policy.md` and are
    // mirrored in `DEFAULT_RETENTION_POLICY` (sweeper.ts). A change to the
    // window is a planning-doc decision + a code edit, not a runtime tweak.
    HANDOFF_RETENTION_SWEEP_ENABLED: z
      .string()
      .default('false')
      .transform((s) => s.toLowerCase() === 'true' || s === '1'),
    /** Cadence of the in-process sweep interval. Default 24h. */
    HANDOFF_RETENTION_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 60 * 60 * 1000),
    /**
     * Delay after orchestrator boot before the first sweep fires. Default
     * 60s — keeps the boot log clean and avoids fighting other startup
     * work for the first interval tick. Ratified per HITL Q3 (2026-05-12).
     */
    HANDOFF_RETENTION_SWEEP_INITIAL_DELAY_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60_000),
  })
  // Postgres session backend requires a database URL. Fail-fast so a
  // misconfigured SESSION_BACKEND=postgres deploy doesn't reach a user turn
  // before the error surfaces.
  .refine(
    (cfg) =>
      cfg.SESSION_BACKEND !== 'postgres' ||
      cfg.ORCHESTRATOR_DATABASE_URL.length > 0,
    {
      path: ['ORCHESTRATOR_DATABASE_URL'],
      message:
        'SESSION_BACKEND=postgres requires ORCHESTRATOR_DATABASE_URL. ' +
        'Set it in .env (e.g. postgresql://al:pick-a-password@localhost:5432/puma_dev).',
    },
  )
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
  // Staff auth requires both a password and a JWT secret when enabled.
  // Fail-fast so a misconfigured deploy never runs a password endpoint with
  // a blank secret (would accept any token).
  .refine(
    (cfg) =>
      !cfg.STAFF_AUTH_ENABLED ||
      (cfg.STAFF_AUTH_PASSWORD.length >= 12 && cfg.STAFF_JWT_SECRET.length >= 32),
    {
      path: ['STAFF_AUTH_ENABLED'],
      message:
        'STAFF_AUTH_ENABLED=true requires STAFF_AUTH_PASSWORD (≥12 chars) and ' +
        'STAFF_JWT_SECRET (≥32 chars). Set them in .env or set STAFF_AUTH_ENABLED=false.',
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
