/**
 * Handoff retention sweeper (E.t6).
 *
 * Wraps `HandoffStore.sweep()` with three observability events
 * (`handoff.retention.sweep.{started,completed,failed}`) and an injectable
 * clock so unit tests can pin time without sleeping.
 *
 * Both call paths share this function:
 *   1. In-process interval inside the orchestrator (dev / FS interim) —
 *      `setInterval` in `orchestrator/src/index.ts` calls `sweepHandoffs`
 *      every `HANDOFF_RETENTION_SWEEP_INTERVAL_MS`.
 *   2. External-trigger CLI (`bin/sweep.ts` invoked via
 *      `npm run sweep:handoffs --workspace @swoop/connector`) — emulates the
 *      future Cloud Scheduler → Cloud Run Job posture in prod.
 *
 * Both paths are tested in lockstep (§"Verification" in
 * planning/03-exec-handoff-t6.md). The CLI is a side-product wrapping the
 * same function; if anything breaks here, both paths break the same way.
 *
 * The `HandoffStore.sweep()` method is where the actual deletion loop lives.
 * Today's `FsHandoffStore` iterates JSON files; tomorrow's
 * `PostgresHandoffStore` runs one `DELETE … WHERE scheduled_deletion_at <
 * NOW()` against the indexed column. Caller code (this module, the boot
 * wiring, the CLI, the operator runbook) does not change at swap time.
 *
 * Decision refs:
 *   - E.6  — qualified / referred_out → 12-month outer bound (360 days; see
 *            DEFAULT_RETENTION_POLICY note below for the calendar-aware
 *            arithmetic deferral).
 *   - E.7  — disqualified / inconclusive → 90 days.
 *   - E.10 — Cloud SQL Postgres as the target durable backend.
 *   - E.11 — handoff side-effects live in `@swoop/connector`, not the
 *            orchestrator.
 *   - E.12 — `FsHandoffStore` is the interim; same interface survives the
 *            Postgres swap.
 *
 * Authoritative retention values live in
 * `product/cms/legal/compliance-bundle/05-retention-policy.md` — the
 * `DEFAULT_RETENTION_POLICY` constant below is the runtime mirror.
 */

import { createHash, randomUUID } from 'node:crypto';

import { emitEvent, type HandoffVerdict } from '@swoop/common';

import type { HandoffStore, RetentionPolicy, SweepResult } from './store.js';

// ---------------------------------------------------------------------------
// Retention policy — sourced from the compliance bundle.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Authoritative retention windows, in milliseconds since
 * `session.handoffSubmittedAt`.
 *
 * Source of truth:
 *   product/cms/legal/compliance-bundle/05-retention-policy.md
 *
 * Decision refs:
 *   - E.6 — qualified / referred_out → 12-month outer bound.
 *   - E.7 — disqualified / inconclusive → 90 days.
 *
 * Why 360 days, not 365 / actual calendar months:
 *   "12 months" is the counsel-facing language; "360 days" is the
 *   implementation. Calendar-aware month arithmetic introduces leap-year
 *   / DST edge cases the sweeper does not need — the storage-limitation
 *   principle (Art. 5(1)(e)) is satisfied by erring on the side of earlier
 *   deletion, so 360 < 365 is conservative. Compliance bundle §05 carries a
 *   footnote naming this.
 *
 * Why the "or until CRM ingestion, whichever sooner" branch from E.6 is NOT
 * enforced here:
 *   The CRM-ingestion signal is a manual operator action that lives in the
 *   E.t7 right-to-erasure runbook. The sweeper enforces the outer bound; the
 *   CRM path is invoked explicitly by an operator via `HandoffStore.delete`.
 *
 * `Object.freeze`-d so the default is immutable at runtime. A caller can
 * supply an override via `SweeperDeps.policy`.
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = Object.freeze({
  qualified: 360 * DAY_MS,
  referred_out: 360 * DAY_MS,
  disqualified: 90 * DAY_MS,
  inconclusive: 90 * DAY_MS,
});

/**
 * Re-export the type from `store.ts` so callers can `import { RetentionPolicy
 * } from './sweeper.js'` next to `DEFAULT_RETENTION_POLICY`. The interface
 * lives in `store.ts` because `HandoffStore.sweep()` consumes it; this is a
 * convenience re-export.
 */
export type { RetentionPolicy } from './store.js';

// ---------------------------------------------------------------------------
// Sweeper dependencies + entry point.
// ---------------------------------------------------------------------------

export interface SweeperDeps {
  /** The store to sweep. Today's `FsHandoffStore` / tomorrow's
   *  `PostgresHandoffStore` — `sweepHandoffs` is interface-typed. */
  readonly store: HandoffStore;
  /** Retention windows per verdict; defaults to `DEFAULT_RETENTION_POLICY`. */
  readonly policy?: RetentionPolicy;
  /** Test-injectable clock; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Test-injectable event emitter; defaults to the module-level
   *  `emitEvent` from `@swoop/common`. */
  readonly emitEvent?: typeof emitEvent;
}

/**
 * Run one sweep pass. Idempotent + safe to invoke concurrently against
 * different stores; concurrent invocations against the same store may
 * double-attempt deletes (the second resolves to `{ ok: true, deleted:
 * false }` — `FsHandoffStore.delete` is idempotent).
 *
 * Returns the `SweepResult` for the caller (the boot interval discards it;
 * the CLI prints it as JSON to stdout). Observability events are emitted
 * regardless — the return value is for convenience, not delivery.
 *
 * Errors never throw out of this function: a `list()` failure becomes
 * `{ ok: false, reason: 'sweep_failed', … }` plus a `handoff.retention.
 * sweep.failed` event.
 */
export async function sweepHandoffs(deps: SweeperDeps): Promise<SweepResult> {
  const policy = deps.policy ?? DEFAULT_RETENTION_POLICY;
  const clock = deps.now ?? (() => new Date());
  const emit = deps.emitEvent ?? emitEvent;

  const runId = randomUUID();
  const start = clock();
  const policyDigest = digestPolicy(policy);
  const storeKind = inferStoreKind(deps.store);

  emit({
    eventType: 'handoff.retention.sweep.started',
    eventVersion: 1,
    timestamp: start.toISOString(),
    sessionId: 'system',
    turnIndex: null,
    actor: 'connector',
    payload: {
      runId,
      policyDigest,
      storeKind,
    },
  });

  let result: SweepResult;
  try {
    result = await deps.store.sweep(start, policy);
  } catch (err) {
    // `HandoffStore.sweep` contract is "never throws — returns
    // { ok: false } on failure". This catch is defence-in-depth for any
    // future implementation (or a buggy mock in tests) that breaks the
    // contract. Emit `failed` regardless so the operator sees the drift.
    const detail = err instanceof Error ? err.message : String(err);
    emit({
      eventType: 'handoff.retention.sweep.failed',
      eventVersion: 1,
      timestamp: clock().toISOString(),
      sessionId: 'system',
      turnIndex: null,
      actor: 'connector',
      payload: {
        runId,
        errorCategory: 'unknown',
        sanitisedContext: detail.slice(0, 500),
      },
    });
    return {
      ok: false,
      reason: 'sweep_failed',
      detail,
    };
  }

  if (!result.ok) {
    emit({
      eventType: 'handoff.retention.sweep.failed',
      eventVersion: 1,
      timestamp: clock().toISOString(),
      sessionId: 'system',
      turnIndex: null,
      actor: 'connector',
      payload: {
        runId,
        errorCategory: 'sweep_failed',
        sanitisedContext: result.detail.slice(0, 500),
        ...(result.partial !== undefined ? { partial: result.partial } : {}),
      },
    });
    return result;
  }

  const end = clock();
  emit({
    eventType: 'handoff.retention.sweep.completed',
    eventVersion: 1,
    timestamp: end.toISOString(),
    sessionId: 'system',
    turnIndex: null,
    actor: 'connector',
    payload: {
      runId,
      scanned: result.scanned,
      deleted: result.deleted,
      perVerdict: {
        qualified: result.perVerdict.qualified ?? 0,
        referred_out: result.perVerdict.referred_out ?? 0,
        disqualified: result.perVerdict.disqualified ?? 0,
        inconclusive: result.perVerdict.inconclusive ?? 0,
      },
      skippedCount: result.skipped.length,
      durationMs: end.getTime() - start.getTime(),
    },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * sha256 of the policy values, hex-encoded. A config change is visible in
 * the event stream — operators can correlate "the deletion count changed at
 * this digest boundary" with a deploy / env-var flip.
 *
 * Verdict keys are emitted in a deterministic order so the digest is stable
 * across V8 / Node versions.
 */
function digestPolicy(policy: RetentionPolicy): string {
  const orderedKeys: HandoffVerdict[] = [
    'qualified',
    'referred_out',
    'disqualified',
    'inconclusive',
  ];
  const orderedValues = orderedKeys.map((k) => `${k}:${policy[k]}`).join(',');
  return createHash('sha256').update(orderedValues, 'utf8').digest('hex');
}

/**
 * Best-effort store-kind guess for the event payload.
 *
 * Today: matches `FsHandoffStore` via constructor name; the future
 * `PostgresHandoffStore` will tag itself the same way. Anything else (test
 * doubles, in-memory implementations) reports `'fs'` as a defensible
 * default — the field is observability-only, not behaviourally load-bearing.
 *
 * The event schema (`events.ts`) enforces the enum `['fs', 'postgres']` so a
 * test double that wants explicit attribution can extend the enum first.
 */
function inferStoreKind(store: HandoffStore): 'fs' | 'postgres' {
  const ctor = (store as { constructor?: { name?: string } }).constructor?.name;
  if (typeof ctor === 'string' && ctor.toLowerCase().includes('postgres')) {
    return 'postgres';
  }
  return 'fs';
}
