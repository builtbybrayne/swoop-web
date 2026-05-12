// -----------------------------------------------------------------------------
// @swoop/connector — public surface.
//
// As of C.t1: runtime substrate (Postgres pool + MCP server skeleton + config
// schema) plus the existing handoff side-effects (mailer + FsHandoffStore +
// submitHandoff for chunk E). Data tools (the eight intent-named tools) land
// with C.t4; data primitives land with C.t3a + C.t4.
//
// Consumers import from the package name:
//   import { submitHandoff, type SubmitResult } from "@swoop/connector";
//   import { loadConfig, getPool, withPgClient } from "@swoop/connector";
// -----------------------------------------------------------------------------

// --- Handoff side-effects (chunk E) ---------------------------------------
export {
  sendHandoffEmail,
  preparePayloadForTemplate,
  type MailerConfig,
  type MailerDeps,
  type SendResult,
} from './handoff/mailer.js';

export {
  renderTemplate,
} from './handoff/template-renderer.js';

export {
  FsHandoffStore,
  HANDOFF_ID_PATTERN,
  type HandoffStore,
  type SaveResult,
  type DeleteResult,
  type SkipReason,
  type SweepResult,
  type RetentionPolicy,
} from './handoff/store.js';

export {
  submitHandoff,
  type SubmitDeps,
  type SubmitResult,
} from './handoff/submit.js';

// --- E.t6 — retention sweeper ----------------------------------------------
export {
  sweepHandoffs,
  DEFAULT_RETENTION_POLICY,
  type SweeperDeps,
} from './handoff/sweeper.js';

// --- Runtime substrate (C.t1) ---------------------------------------------
//
// Re-exported so future C.t* tasks (and the eventual ETL CLI in C.t3) can
// import the pool factory + config loader without reaching into internals.
// The MCP server is intentionally NOT re-exported — it's owned by the
// service entrypoint at src/server/index.ts and shouldn't be embedded in
// other processes.
export {
  loadConfig,
  configSchema,
  PACKAGE_ROOT,
  type Config,
  type RawConfig,
} from './config/index.js';

export {
  getPool,
  withPgClient,
  closePool,
  buildPoolConfig,
} from './data/pool.js';

// --- Tool description loader (C.t4) ---------------------------------------
//
// Re-exported so the orchestrator's connector adapter (B.t3a) can load the
// authoritative `cms/prompts/tools/<tool>/description.md` content into the
// MCP tool registrations on the orchestrator side too — same fail-fast
// contract as the connector boot path. Both sides share one description
// loader so any future addition to the eight-tool surface lives in one
// place. The MCP server itself remains owned by `src/server/`.
export {
  loadAllToolDescriptions,
  ALL_TOOL_NAMES,
  ToolDescriptionLoadError,
  type ToolDescriptions,
  type RegisteredToolName,
} from './tools/index.js';
