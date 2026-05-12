#!/usr/bin/env tsx
/**
 * Handoff retention sweep — CLI external-trigger binary (E.t6 §5b).
 *
 * Emulates the prod posture: an out-of-process trigger (Cloud Scheduler →
 * Cloud Run Job) invokes the CLI, the CLI runs one sweep against the
 * configured `FsHandoffStore` (interim) or `PostgresHandoffStore` (post-IAM),
 * prints the `SweepResult` JSON to stdout, exits 0 on success / 1 on failure.
 *
 * Both call paths (this CLI + the in-process interval inside the orchestrator)
 * share the same `sweepHandoffs(deps)` function and the same store interface,
 * so anything that breaks here breaks the in-process path the same way. The
 * unit + integration test suite tests them in lockstep.
 *
 * Invocation:
 *   npm run sweep:handoffs --workspace @swoop/connector
 *   tsx product/connector/bin/sweep.ts
 *
 * Env vars consumed:
 *   - HANDOFF_STORE_DIR  — absolute path to the var/handoffs/ directory.
 *                          Defaults to <orchestrator-package-root>/var/handoffs
 *                          so it matches the orchestrator's wiring out of the
 *                          box. Override for staging / tests / a sibling
 *                          handoff store path.
 *   - HANDOFF_RETENTION_QUALIFIED_WINDOW_SECONDS
 *   - HANDOFF_RETENTION_REFERRED_OUT_WINDOW_SECONDS
 *   - HANDOFF_RETENTION_DISQUALIFIED_WINDOW_SECONDS
 *   - HANDOFF_RETENTION_INCONCLUSIVE_WINDOW_SECONDS
 *       Per-verdict retention window override in seconds. If unset, the
 *       runtime mirror of the compliance bundle's authoritative windows
 *       (`DEFAULT_RETENTION_POLICY`) is used. Override is intended for the
 *       §5b smoke test (1-second windows force everything to expire) and
 *       ad-hoc operator inspection. Production never sets these.
 *
 * Exit code:
 *   0 — sweep completed (whether or not anything was deleted).
 *   1 — sweep failed (store.list() threw, sweep returned ok:false, etc.).
 *
 * Output:
 *   stdout — the SweepResult as a single JSON line.
 *   stderr — operator-facing context (paths, env, errors).
 *   structured events on stdout via emitEvent — same sink as in-process.
 *
 * No new dependencies — this binary uses only `node:path`, the connector's
 * `FsHandoffStore`, and the sweeper module.
 */

import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import path from 'node:path';

import { FsHandoffStore } from '../src/handoff/store.js';
import {
  DEFAULT_RETENTION_POLICY,
  sweepHandoffs,
} from '../src/handoff/sweeper.js';
import type { RetentionPolicy } from '../src/handoff/store.js';

const SECOND_MS = 1000;

function parsePositiveSeconds(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    process.stderr.write(
      `[sweep] ignoring ${name}="${raw}" — must be a positive number of seconds.\n`,
    );
    return undefined;
  }
  return parsed * SECOND_MS;
}

function buildPolicy(): RetentionPolicy {
  const qualified =
    parsePositiveSeconds('HANDOFF_RETENTION_QUALIFIED_WINDOW_SECONDS') ??
    DEFAULT_RETENTION_POLICY.qualified;
  const referredOut =
    parsePositiveSeconds('HANDOFF_RETENTION_REFERRED_OUT_WINDOW_SECONDS') ??
    DEFAULT_RETENTION_POLICY.referred_out;
  const disqualified =
    parsePositiveSeconds('HANDOFF_RETENTION_DISQUALIFIED_WINDOW_SECONDS') ??
    DEFAULT_RETENTION_POLICY.disqualified;
  const inconclusive =
    parsePositiveSeconds('HANDOFF_RETENTION_INCONCLUSIVE_WINDOW_SECONDS') ??
    DEFAULT_RETENTION_POLICY.inconclusive;

  return Object.freeze({
    qualified,
    referred_out: referredOut,
    disqualified,
    inconclusive,
  });
}

function resolveStoreDir(): string {
  const override = process.env.HANDOFF_STORE_DIR;
  if (override !== undefined && override !== '') {
    return path.resolve(override);
  }
  // Match the orchestrator's default: <orchestrator-package-root>/var/handoffs.
  // The connector lives at product/connector and the orchestrator at
  // product/orchestrator — they share the `product/` parent.
  // bin/sweep.ts is at product/connector/bin/sweep.ts, so:
  //   product/ = ../../ from this file
  //   default store dir = product/orchestrator/var/handoffs
  // We resolve relative to the binary's own dirname so the path is stable
  // regardless of cwd at invocation time.
  // This matches the FsHandoffStore wiring in
  // product/orchestrator/src/index.ts.
  return path.resolve(
    new URL('../..', import.meta.url).pathname,
    'orchestrator',
    'var',
    'handoffs',
  );
}

async function main(): Promise<void> {
  const storeDir = resolveStoreDir();
  const policy = buildPolicy();

  process.stderr.write(`[sweep] store dir: ${storeDir}\n`);
  process.stderr.write(
    `[sweep] policy (ms): ${JSON.stringify(policy)}\n`,
  );

  const store = new FsHandoffStore(storeDir);
  const result = await sweepHandoffs({ store, policy });

  // Single JSON line on stdout — the prod consumer (Cloud Scheduler /
  // operator parsing the log) can `jq` it without splitting on newlines.
  process.stdout.write(`${JSON.stringify(result)}\n`);

  if (!result.ok) {
    process.stderr.write(`[sweep] failed: ${result.detail}\n`);
    process.exit(1);
  }

  process.stderr.write(
    `[sweep] done: scanned=${result.scanned} deleted=${result.deleted} skipped=${result.skipped.length}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `[sweep] uncaught error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
