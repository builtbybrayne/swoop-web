# 03 — Execution: E.t6 — Handoff retention sweeper

**Status**: Tier 3 execution plan. Draft, 2026-05-12.
**Chunk**: E (handoff & compliance).
**Tasks**: t6 (retention enforcement for the durable handoff store).
**Implements**: [`02-impl-handoff-and-compliance.md`](02-impl-handoff-and-compliance.md) §2.7 (retention policy) + §10 order-of-execution item E.t6.
**Depends on**:
- E.t1 (✅ shipped 2026-04-24) — finalised `HandoffPayload` discriminated-union schema. Sweeper reads `verdict` to pick retention window and `session.handoffSubmittedAt` as the age anchor.
- E.t2 + E.t3 (✅ shipped 2026-04-28) — `HandoffStore` interface + `FsHandoffStore` interim. Sweeper extends that interface; it does not create a new one.
- E.t8 (✅ skeleton landed 2026-04-29) — retention values authoritative in `product/cms/legal/compliance-bundle/05-retention-policy.md`. Sweeper reads windows from there (or rather, the values it encodes are sourced from there; runtime values live in code as named constants alongside the decision refs E.6/E.7).
- Connector workspace (`@swoop/connector`) — owns the sweeper module (decision **E.11**: handoff side-effects live here, not in the orchestrator).
**Blocks**: Production launch posture on retention (M5 readiness — counsel will flag "no automatic enforcement" in `05-retention-policy.md` §"Gap counsel should know about" until this lands). Does **not** block the Postgres swap (E.t2 proper) — sweeper survives the swap; see §"Architectural principles" below.
**Produces**:
- `product/connector/src/handoff/sweeper.ts` — new module. The `sweepHandoffs` function + `RetentionPolicy` config type + injectable `Clock` abstraction.
- `product/connector/src/handoff/store.ts` — **edit in place** — add `delete(handoffId)` and `sweep(now)` methods on the `HandoffStore` interface; implement on `FsHandoffStore`.
- `product/connector/src/index.ts` — re-export `sweepHandoffs`, `RetentionPolicy`, `DEFAULT_RETENTION_POLICY`.
- `product/connector/src/handoff/__tests__/sweeper.test.ts` — unit tests with injected clock.
- `product/connector/src/handoff/__tests__/store.test.ts` — **edit** — add tests for the new `delete` + `sweep` methods.
- `product/orchestrator/src/server/index.ts` — **edit** — boot wiring: register the sweeper as an in-process interval if `HANDOFF_RETENTION_SWEEP_ENABLED=true`. (See §"Interim shape" for the option tradeoff.)
- `product/orchestrator/src/config/schema.ts` — **edit** — three new env vars + cross-field refine (mirroring the `HANDOFF_EMAIL_*` pattern).
- `product/orchestrator/.env.example` — **edit** — document the new env vars.
- `product/ts-common/src/events.ts` — **edit** — three new event kinds: `handoff.retention.sweep.started`, `.completed`, `.failed`.
- `product/cms/ops/handoff-retention-sweep.md` — new operator runbook (matches the shape of `etl-rerun.md` / `embedding-rerun.md`).
- `product/cms/legal/compliance-bundle/05-retention-policy.md` — **edit** — flip the "Gap counsel should know about" section to reflect interim sweeper landed; revise "Enforcement?" column from "(planned)" to "in-process sweeper (FS interim) / Cloud Run Job (post-Postgres)".

**Estimate**: ~3 h focused work — sweeper module + tests + boot wiring + runbook + bundle update. Postgres swap (the `PostgresHandoffStore.sweep` implementation + the migration column) is a separate later task scoped here but landed alongside E.t2 proper.

---

## ★ Read this first — the principle that holds across the FS-to-Postgres swap

This plan does two pieces of work that look separate but are one design:

1. **Today (interim, FS)** — a runtime sweeper that iterates the file-backed store, computes per-record deletion times in code, and hard-deletes expired records.
2. **Tomorrow (Postgres swap)** — the same `HandoffStore.sweep()` method satisfied by `PostgresHandoffStore` via `DELETE … WHERE scheduled_deletion_at < NOW()`, run from a Cloud Run Job on a daily cron.

Both implementations satisfy the same interface signature. Caller code (boot wiring, the operator runbook, the event taxonomy, the test contract) is unchanged at swap time. The runtime carrier flips from "in-process interval inside the orchestrator process" to "out-of-process Cloud Run Job triggering against Cloud SQL" — that is a wiring concern, not an interface concern.

**The reason this matters**: a sweeper that lived inside `FsHandoffStore` (as a private method, or as a static `sweepFsHandoffsDir` function) would not survive the swap. The interface change is the whole point of doing this work at the interface level today — when `PostgresHandoffStore` lands as part of E.t2 proper, its author writes `sweep()` against `pg.Pool` and the rest of the stack continues to work.

---

## 1. Outcome

When this task is done:

- The handoff store has a documented retention enforcement path that runs today against `FsHandoffStore` with no Postgres dependency.
- Expired handoffs are hard-deleted from disk on a configurable interval (default: daily, off by default).
- Each sweep emits `handoff.retention.sweep.started` → `…completed` (or `…failed`) events with per-verdict deletion counts.
- The compliance bundle's retention-policy section can flip its "no automatic enforcement" caveat to "interim sweeper enforces FS-side; Cloud Run Job enforces post-Postgres".
- The sweeper interface (`HandoffStore.sweep(now)`) survives the Cloud SQL Postgres swap unchanged. The `PostgresHandoffStore` author drops in a SQL `DELETE` implementation against the migration-added `scheduled_deletion_at` column.
- An operator runbook at `product/cms/ops/handoff-retention-sweep.md` documents enable/disable, expected event shape, and "when things go wrong" steps.

Not outcomes:
- The Cloud Run Job scheduling itself (post-IAM, lands with E.t2 proper).
- The `scheduled_deletion_at` column being populated in `PostgresHandoffStore.save()` (lands with E.t2 proper, but this plan specifies the migration shape so the contract is settled).
- Soft-delete-to-`.expired/` recovery flow (see "Open HITL questions" — design choice locked to hard-delete here).
- Right-to-erasure (Art. 17) sweeping. That is the E.t7 manual runbook's domain; this sweeper handles only auto-expiry per E.6/E.7/E.8.

---

## 2. Target functionalities

### 2.1 Extend the `HandoffStore` interface

Add two methods to the interface defined in `product/connector/src/handoff/store.ts`:

```ts
export interface HandoffStore {
  save(payload: HandoffPayload): Promise<SaveResult>;
  get(handoffId: string): Promise<HandoffPayload | null>;
  list(): Promise<readonly string[]>;
  /** Hard-delete a single record by id. Idempotent — deleting a missing
   *  record resolves to `{ ok: true, deleted: false }`. */
  delete(handoffId: string): Promise<DeleteResult>;
  /** Sweep the store: iterate all records, compute per-record deletion
   *  predicate against `now` + `policy`, hard-delete the matches.
   *  Returns a tally per verdict + total. */
  sweep(now: Date, policy: RetentionPolicy): Promise<SweepResult>;
}

export type DeleteResult =
  | { readonly ok: true; readonly deleted: boolean }
  | { readonly ok: false; readonly reason: 'handoff_id_invalid' | 'delete_failed'; readonly detail?: string };

export type SweepResult = {
  readonly ok: true;
  readonly scanned: number;
  readonly deleted: number;
  readonly perVerdict: Readonly<Record<HandoffVerdict, number>>;
  readonly skipped: ReadonlyArray<{ readonly handoffId: string; readonly reason: SkipReason }>;
} | {
  readonly ok: false;
  readonly reason: 'sweep_failed';
  readonly detail: string;
  readonly partial?: { scanned: number; deleted: number };
};

export type SkipReason =
  | 'parse_failed'        // record on disk is corrupt or fails Zod parse — left in place for operator inspection
  | 'unknown_verdict'     // shouldn't happen if Zod parse succeeded, but defensive
  | 'not_expired'         // age below retention threshold
  | 'delete_failed';      // fs op failed for this individual record; other records continue
```

Rationale for `delete` being its own method even though `sweep` consumes it:
- The forthcoming E.t7 right-to-erasure runbook needs single-record deletion. A sweeper-only method buries that capability inside a loop.
- `PostgresHandoffStore.delete(id)` will be one-line SQL; same with `sweep()`. Splitting keeps both honest.

### 2.2 Retention policy as a typed config

`RetentionPolicy` is a per-verdict map of milliseconds-since-`session.handoffSubmittedAt`. The values are sourced from the compliance bundle's authoritative retention policy (`product/cms/legal/compliance-bundle/05-retention-policy.md`, currently ✅ FILLED — these are decisions E.6/E.7, not placeholders).

```ts
export type RetentionPolicy = Readonly<Record<HandoffVerdict, number /* ms */>>;

/** Source of truth: product/cms/legal/compliance-bundle/05-retention-policy.md
 *  Decision refs: E.6 (qualified/referred_out), E.7 (disqualified/inconclusive). */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = Object.freeze({
  qualified:      12 * 30 * DAY_MS,  // 12 months outer bound (E.6 "or until CRM ingestion, whichever sooner")
  referred_out:   12 * 30 * DAY_MS,  // same as qualified (E.6)
  disqualified:   90 * DAY_MS,       // 90 days (E.7)
  inconclusive:   90 * DAY_MS,       // 90 days (E.7 pattern per HITL Q5)
});

const DAY_MS = 24 * 60 * 60 * 1000;
```

Important constraints:
- **The 12-month value uses 30-day months on purpose.** This is the outer bound, not a calendar-aligned deletion. Calendar-aware month arithmetic introduces leap-year / DST edge cases that the sweeper does not need. Counsel-facing language in the compliance bundle says "12 months"; the implementation says "360 days"; that is acceptable under the storage-limitation principle (Art. 5(1)(e)) because erring on the side of earlier deletion is conservative. Flagged in `05-retention-policy.md` update.
- **The 12-month "OR until CRM ingestion, whichever sooner" branch from E.6 is NOT auto-enforced.** That conditional requires a CRM-ingestion signal Puma doesn't have. The sweeper enforces the outer bound; the CRM-ingestion path is the manual data-deletion runbook (E.t7). Counsel-facing explanation already lives in `05-retention-policy.md` and is unchanged.
- **`DEFAULT_RETENTION_POLICY` is `Object.freeze`-d.** Caller can supply an override but the default is immutable at runtime.

### 2.3 The sweeper function (interim FS)

Lives at `product/connector/src/handoff/sweeper.ts`:

```ts
export interface SweeperDeps {
  readonly store: HandoffStore;
  readonly policy?: RetentionPolicy;       // default: DEFAULT_RETENTION_POLICY
  readonly now?: () => Date;               // default: () => new Date()
  readonly emitEvent?: typeof emitEvent;   // default: import from @swoop/common
}

/**
 * Run one sweep pass. Idempotent + safe to invoke concurrently against
 * different stores; concurrent invocations against the same store may
 * double-attempt deletes (the second resolves to `{ ok: true, deleted: false }`).
 */
export async function sweepHandoffs(deps: SweeperDeps): Promise<SweepResult>;
```

Inside, the sweeper:
1. Emits `handoff.retention.sweep.started` with the run's `runId` (uuid), `now`, and `policyDigest` (sha256 of the policy values, so a config change is visible in the event stream).
2. Calls `store.sweep(now, policy)` — the actual deletion loop lives in the store implementation (because `PostgresHandoffStore` does it in one SQL statement, not a loop in JS).
3. Emits `handoff.retention.sweep.completed` with the `SweepResult` summary, OR `handoff.retention.sweep.failed` with the error detail.
4. Returns the `SweepResult` to the caller (the boot interval + the manual-trigger runbook command both consume it).

### 2.4 `FsHandoffStore.sweep()` implementation

Implementation strategy:
1. Call `this.list()` to get all handoffIds currently on disk.
2. For each id, `this.get(id)` to read + parse the record. (If parse fails, push to `skipped` with `reason: 'parse_failed'` and continue. **Do not delete a record we cannot parse** — corrupt records get left for operator inspection. The store's existing schema-round-trip behaviour on `get()` is the contract we lean on here.)
3. Compute `expiresAt = parseISO(record.session.handoffSubmittedAt) + policy[record.verdict]`.
4. If `expiresAt < now`, call `this.delete(id)`. On success, increment `perVerdict[verdict]` and `deleted`. On failure, push to `skipped` with `reason: 'delete_failed'`.
5. Aggregate and return the `SweepResult`.

Notes:
- The iteration is sequential to keep the FS interim simple. `PostgresHandoffStore.sweep()` will be a single SQL `DELETE` and won't have iteration semantics.
- The sweep does **not** lock the directory. A handoff submitted mid-sweep is either listed by `list()` (and considered for deletion, almost certainly not expired) or not (and survives this sweep to be considered next time). No race condition that matters.
- Filename-safety regex (`HANDOFF_ID_PATTERN`) is enforced by `delete()` before any fs op — same defence-in-depth posture as `save()` + `get()`.

### 2.5 `FsHandoffStore.delete()` implementation

```ts
async delete(handoffId: string): Promise<DeleteResult> {
  if (!HANDOFF_ID_PATTERN.test(handoffId)) {
    return { ok: false, reason: 'handoff_id_invalid' };
  }
  const filePath = path.join(this.dirAbsolutePath, `${handoffId}.json`);
  try {
    await unlink(filePath);
    return { ok: true, deleted: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, deleted: false };  // idempotent: missing record is fine
    }
    return { ok: false, reason: 'delete_failed', detail: messageOf(err) };
  }
}
```

### 2.6 Boot integration — in-process interval

The sweeper runs as an in-process interval inside the orchestrator process (interim).

Cross-field config refine added to `product/orchestrator/src/config/schema.ts`:

```ts
HANDOFF_RETENTION_SWEEP_ENABLED: z.boolean().default(false),
HANDOFF_RETENTION_SWEEP_INTERVAL_MS: z.number().int().positive().default(24 * 60 * 60 * 1000),  // daily
HANDOFF_RETENTION_SWEEP_INITIAL_DELAY_MS: z.number().int().nonnegative().default(60_000),  // wait 60s after boot before first sweep
```

Boot wiring (in `product/orchestrator/src/index.ts` or `src/server/index.ts`, alongside the existing `FsHandoffStore` instantiation):

```ts
if (config.HANDOFF_RETENTION_SWEEP_ENABLED) {
  const handle = setInterval(
    () => { void sweepHandoffs({ store: handoffStore }).catch(/* event already emitted */); },
    config.HANDOFF_RETENTION_SWEEP_INTERVAL_MS,
  );
  // Schedule a first sweep after the initial delay so boot logs don't get noisy.
  setTimeout(
    () => { void sweepHandoffs({ store: handoffStore }).catch(() => {}); },
    config.HANDOFF_RETENTION_SWEEP_INITIAL_DELAY_MS,
  );
  // Graceful shutdown:
  process.on('SIGTERM', () => clearInterval(handle));
}
```

Boot log line added:
```
handoff retention sweeper: enabled, interval=24h, policy={qualified:360d, referred_out:360d, disqualified:90d, inconclusive:90d}
```
or
```
handoff retention sweeper: disabled (set HANDOFF_RETENTION_SWEEP_ENABLED=true to flip)
```

**Why in-process, not OS cron / Node CLI on a schedule?**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **In-process interval inside orchestrator** | Zero external infra; same process owns the data dir; same logging stack; survives the Postgres swap unchanged because the interval is just a `setInterval` call against any `HandoffStore`. | Parent-process crash takes the sweeper with it (acceptable: orchestrator crashes restart and the next interval fires; missed sweeps converge — a 25-hour gap doesn't materially change retention compliance). Tied to orchestrator boot — if orchestrator never starts, sweeper never runs. | **Chosen.** Simplicity wins for the interim. |
| **OS cron job (`launchd` / `crontab`)** | Process-independent; can run while orchestrator is down. | Requires per-host setup that doesn't transfer between dev/staging/prod cleanly; doesn't survive the Postgres swap (Cloud Run Job replaces it); adds an out-of-band knob a Swoop operator has to maintain. | Rejected. |
| **Node CLI on a schedule (`npm run sweep:handoffs` via cron)** | Same separation as OS cron, but the CLI is portable across hosts; lives in the same repo. | Same maintenance overhead as OS cron; an extra script to register; doesn't survive the Postgres swap either. | Rejected for interim. **However**, the same `sweepHandoffs` function is callable from a small `bin/sweep.ts` CLI for operator-triggered manual sweeps — see §"Runbook" below. The CLI is a side-product, not the primary runtime. |

The in-process interval IS the carrier for "today, FS". The Cloud Run Job IS the carrier for "tomorrow, Postgres". Both call the same `sweepHandoffs(deps)` function with the same `HandoffStore` interface dependency. The wiring code in `index.ts` is the only thing that changes at swap time.

### 2.7 `PostgresHandoffStore.sweep()` — interface contract for E.t2 proper

When E.t2 proper lands (post-IAM, Cloud SQL Postgres swap), `PostgresHandoffStore` implements `sweep()` like this (specified here so the contract is settled now; the implementation is **not in scope** for this plan):

```sql
-- The migration that lands with E.t2 proper adds:
ALTER TABLE handoff
  ADD COLUMN scheduled_deletion_at TIMESTAMPTZ NOT NULL;
CREATE INDEX idx_handoff_scheduled_deletion_at
  ON handoff (scheduled_deletion_at);

-- PostgresHandoffStore.save() computes:
--   scheduled_deletion_at = handoff_submitted_at + INTERVAL '360 days'   for qualified/referred_out
--   scheduled_deletion_at = handoff_submitted_at + INTERVAL '90 days'    for disqualified/inconclusive
-- and INSERTs it alongside the rest of the row.

-- PostgresHandoffStore.sweep() runs:
WITH deleted AS (
  DELETE FROM handoff
  WHERE scheduled_deletion_at < NOW()
  RETURNING verdict
)
SELECT verdict, COUNT(*) FROM deleted GROUP BY verdict;
-- The verdict counts feed SweepResult.perVerdict; total rowcount feeds SweepResult.deleted.
```

The Postgres path treats `scheduled_deletion_at` as the authoritative deletion time, computed at insert time. The FS path computes deletion time at sweep time from `session.handoffSubmittedAt + policy[verdict]`. Both paths produce the same retention behaviour. The schema-vs-runtime split is principled: SQL wants the column for index-driven `WHERE … < NOW()`; FS doesn't need a column because iteration is cheap at our scale.

**Migration sequencing**: per C.31 the migrations directory uses zero-padded sequence prefixes. The migration that adds `scheduled_deletion_at` lands with E.t2 proper (whenever Postgres swap happens) and slots in at whatever the next available prefix is. Not this plan's concern; flagged in the bundle update so future-Postgres-author knows the contract.

### 2.8 Observability events

Three new event kinds added to `product/ts-common/src/events.ts` alongside the existing `handoff.email.*` family:

```ts
export const HandoffRetentionSweepStartedEventSchema = z.object({
  eventType: z.literal('handoff.retention.sweep.started'),
  eventVersion: z.literal(1),
  timestamp: z.string().datetime(),
  sessionId: z.literal('system'),   // sweep is not visitor-scoped
  turnIndex: z.null(),
  actor: z.literal('connector'),
  payload: z.object({
    runId: z.string().uuid(),
    policyDigest: z.string(),       // sha256 of JSON.stringify(policy) — config-change visible
    storeKind: z.enum(['fs', 'postgres']),
  }),
});

export const HandoffRetentionSweepCompletedEventSchema = z.object({
  eventType: z.literal('handoff.retention.sweep.completed'),
  /* …envelope as above… */
  payload: z.object({
    runId: z.string().uuid(),
    scanned: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    perVerdict: z.object({
      qualified: z.number().int().nonnegative(),
      referred_out: z.number().int().nonnegative(),
      disqualified: z.number().int().nonnegative(),
      inconclusive: z.number().int().nonnegative(),
    }),
    skippedCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export const HandoffRetentionSweepFailedEventSchema = z.object({
  eventType: z.literal('handoff.retention.sweep.failed'),
  /* …envelope as above… */
  payload: z.object({
    runId: z.string().uuid(),
    errorCategory: z.enum(['list_failed', 'sweep_failed', 'unknown']),
    sanitisedContext: z.string().max(500),   // no PII; visitor data never leaves the connector
    partial: z.object({
      scanned: z.number().int().nonnegative(),
      deleted: z.number().int().nonnegative(),
    }).optional(),
  }),
});
```

**No PII in event payloads.** Counts only; no handoffIds, no email addresses, no record content. Same posture as the `handoff.email.*` family (which sha256-hashes the subject to keep visitor name out of logs). Counsel-facing implication: the events surface "retention policy is running and producing these counts" without leaking which visitors got deleted. That is the right side of the GDPR observability/minimisation tradeoff.

Event kinds are exported through the existing `EventEnvelopeSchema` discriminated union; the F-chunk observability surface picks them up automatically.

### 2.9 Operator runbook

New file: `product/cms/ops/handoff-retention-sweep.md`. Matches the shape of `etl-rerun.md` / `embedding-rerun.md`:

Sections (mirroring the established runbook template):
- **Why this exists** — GDPR Art. 5(1)(e) storage limitation; EU AI Act Art. 50 retention documentation; reference to compliance bundle §05.
- **What you'll do every time** — usually nothing (it runs on its own); steps are for manual trigger / disable / inspect.
- **Cadence + ownership** — default daily interval; owned by ETL operator / Swoop ops post-handover; until handover, Al.
- **Step 1 — Confirm it's running** — `grep "handoff retention sweeper" orchestrator.log` or query Cloud Logging for the most recent `handoff.retention.sweep.completed` event.
- **Step 2 — Manual trigger** — `npm run sweep:handoffs --workspace @swoop/connector` (CLI side-product wrapping `sweepHandoffs(deps)`; same code path as the interval). Returns the `SweepResult` JSON to stdout.
- **Step 3 — Disable temporarily** — flip `HANDOFF_RETENTION_SWEEP_ENABLED=false` and restart. For permanent disable in a deployed environment, omit the env var from the deploy config (default is `false`).
- **Step 4 — Inspect deletions** — listing the `var/handoffs/` dir (FS interim) or querying `handoff` table count by verdict (post-Postgres).
- **When things go wrong** — `parse_failed` skipped records (corrupt JSON on disk — leave for operator); `delete_failed` (fs perms or readonly mount); `sweep_failed` overall (list call failed — dir missing or unreadable). Each entry references the relevant event kind so an operator can correlate.
- **Where the rules came from** — decisions E.6/E.7/E.8; compliance bundle §05; this plan.

### 2.10 Compliance bundle update

`product/cms/legal/compliance-bundle/05-retention-policy.md` gets two edits:

1. **Retention windows table — "Enforced?" column** flips for the handoff rows:
   - From: `Scheduled job (planned, post-Postgres swap)`
   - To: `In-process sweeper (interim FS) / scheduled Cloud Run Job (post-Postgres)`.

2. **Enforcement — current state vs target state** section:
   - Add a paragraph under "Today" naming the sweeper as the interim enforcement path, with `HANDOFF_RETENTION_SWEEP_ENABLED` as the activation flag and "daily interval" as the cadence.
   - Update the "Gap counsel should know about" section: keep the framing but acknowledge the sweeper closes the FS gap; remaining gap is session-side (B.t2 sweeper, separate task) and the Cloud Run Job swap.

The "12-month outer bound uses 360 days" note from §2.2 above gets a short footnote in the bundle: "Implementation uses 360 days (12 × 30) to avoid calendar-aware month arithmetic. Erring on the conservative side under Art. 5(1)(e)."

---

## 3. Architectural principles applied here

- **Postgres-swap survival** — the sweeper lives at the `HandoffStore` interface, not inside `FsHandoffStore`. Both implementations satisfy `sweep(now, policy)`. Caller code is invariant. The Cloud Run Job that eventually replaces the in-process interval calls the same function.
- **Interface-not-implementation** — `delete()` is its own method on the interface (E.t7 runbook will consume it; sweeper consumes it). `sweep()` is its own method so SQL implementations can do it in one statement without iterating in JS.
- **Hard-delete posture** — see "Open HITL questions" below. The plan locks to hard-delete; the question is whether counsel wants soft-delete-with-quarantine. GDPR Art. 17 favours hard-delete; auditability concerns favour soft-delete; default here is hard-delete because (a) the auto-expiry path has no user-action-to-audit, (b) deleted-record signal lives in the event stream (count-only, no PII), (c) backup retention covers genuine accident-recovery scenarios.
- **Content-as-data for retention windows** — the compliance bundle file is the authoritative source; the code's `DEFAULT_RETENTION_POLICY` constants reference it inline. Future changes to retention windows are a planning-doc decision-then-code-edit, not a bare runtime tweak.
- **Observability over enforcement opacity** — every sweep run emits started/completed/failed events with verdict counts. Counsel + ops can see retention is running without granting access to PII.
- **No new dependencies** — sweeper uses `setInterval` (node stdlib), `fs/promises.unlink` (already used by `FsHandoffStore`), `node:crypto.randomUUID` (already used). Zero new packages.
- **Clock injection** — `sweepHandoffs({ now })` accepts a clock so unit tests can pin time. No reliance on real-wall-clock sleeps in tests.

---

## 4. Implementation order

1. **Extend the `HandoffStore` interface** in `store.ts`. Add `delete` + `sweep`. Update the contract docstring.
2. **Implement `FsHandoffStore.delete()`** — small, defensive, idempotent.
3. **Implement `FsHandoffStore.sweep()`** — loop using `list()` + `get()` + `delete()` with skip-tally. Inject `now` and `policy` (no defaults at this layer — the sweeper module layer applies defaults).
4. **Author `sweeper.ts`** — `sweepHandoffs(deps)`, `RetentionPolicy` type, `DEFAULT_RETENTION_POLICY` constant. Event emission wraps the store call.
5. **Extend `events.ts`** in `@swoop/common` — three event kinds with Zod schemas + discriminated-union registration.
6. **Add env vars + cross-field refine** in `orchestrator/src/config/schema.ts`. Mirror the `HANDOFF_EMAIL_*` pattern.
7. **Wire the interval** in the orchestrator boot path. Use `setInterval` + `setTimeout` for initial delay + `process.on('SIGTERM')` for graceful shutdown.
8. **Write unit tests** — see §"Verification" for the test plan.
9. **Author the operator runbook** `product/cms/ops/handoff-retention-sweep.md`.
10. **Update the compliance bundle** `05-retention-policy.md` per §2.10.
11. **Re-export from `@swoop/connector`** (`sweepHandoffs`, `RetentionPolicy`, `DEFAULT_RETENTION_POLICY`).
12. **Update `.env.example`** with the three new vars.
13. **Run the fresh-install gate** — see §"Verification".

---

## 5. HITL ratification record (2026-05-12)

All six items reviewed with Al on 2026-05-12. None remain open. Verbatim decisions below.

1. **Soft-delete vs hard-delete.** ✅ **Ratified: hard-delete.** Reversible without interface change if counsel later requires quarantine — `FsHandoffStore.delete()` would rename-to-quarantine instead of unlink; sweeper code unchanged. **Counsel-review note added** (see §5a below) so that this design choice is surfaced to Swoop's legal counsel at E.t9 review.

2. **In-process interval (dev) AND CLI external-trigger (prod-ready) — BOTH first-class.** ✅ **Ratified.** Both call paths share the same `sweepHandoffs(deps)` function and are tested in lockstep. The in-process timer is the dev-comfort path (orchestrator boot wires it; restart cycles re-fire it within the orchestrator's process). The CLI binary (`bin/sweep.ts` invoked via `npm run sweep:handoffs --workspace @swoop/connector`) is the external-trigger path that Cloud Scheduler → Cloud Run Job calls in prod, and that an operator can fire ad-hoc today (already in §2.9 runbook step 2). Tests cover both: §"Verification" gains an explicit short-TTL CLI smoke test step (5a below) that emulates the Cloud Scheduler trigger.

3. **Initial delay of 60 seconds after boot.** ✅ **Ratified.** Defensible default.

4. **Runbook CLI command name.** ✅ **Ratified.** `npm run sweep:handoffs --workspace @swoop/connector` wrapping `bin/sweep.ts` via `tsx`, mirroring the ingestion CLI pattern.

5. **`parse_failed` records left in place** (not moved to `var/handoffs/.corrupt/`). ✅ **Ratified.** Re-open if FS interim runs longer than expected.

6. **Event delivery target.** ✅ **Acknowledged.** F's event sink may be log-only at land time; that's acceptable.

The retention windows themselves (12mo / 90d) are sourced from the compliance bundle's `05-retention-policy.md` ✅ FILLED entries — not HITL-open (decisions E.6/E.7/E.8 closed).

---

## 5a. Counsel-review note (added 2026-05-12 per HITL Q1)

The hard-delete posture chosen here is a design choice that will land in code without prior legal counsel sign-off. Surface for E.t9 counsel review:

> Puma's interim handoff retention enforcement (E.t6) implements hard-deletion of expired records on schedule. Per GDPR Art. 17 right-to-erasure, hard-deletion aligns with the data-subject's expectation that expired records are removed. Auto-expiry signals are emitted via the observability event stream (counts only, no PII). Accident recovery is provided by deployment-level backup retention.
>
> If counsel prefers a soft-delete posture with secondary retention (e.g. quarantine to `var/handoffs/.expired/` with separate retention window), the change is a single-implementation tweak: `FsHandoffStore.delete()` renames-to-quarantine instead of `unlink()`. The sweeper interface, scheduling, observability events, and operator runbook are all unchanged. No re-architecture required.

This note belongs in `product/cms/legal/compliance-bundle/05-retention-policy.md` as a footnote to the "Enforcement" section, and surfaced at E.t9 review.

---

## 5b. CLI smoke-test verification (added 2026-05-12 per HITL Q2)

Beyond the unit + integration test set in §6, the verification gains one explicit CLI smoke step to prove the external-trigger path works end-to-end against a real `FsHandoffStore`:

```bash
# Set up: drop a hand-crafted expired record under product/orchestrator/var/handoffs/
# with session.handoffSubmittedAt set to a year ago, verdict 'qualified'.
# Override the policy to a 1-second outer bound so all records are expired.
HANDOFF_RETENTION_QUALIFIED_WINDOW_SECONDS=1 \
HANDOFF_RETENTION_REFERRED_OUT_WINDOW_SECONDS=1 \
HANDOFF_RETENTION_DISQUALIFIED_WINDOW_SECONDS=1 \
HANDOFF_RETENTION_INCONCLUSIVE_WINDOW_SECONDS=1 \
  npm run sweep:handoffs --workspace @swoop/connector

# Expected stdout (JSON SweepResult):
# { ok: true, scanned: 1, deleted: 1, perVerdict: { qualified: 1, … }, skipped: [] }
# Expected: record file is gone from var/handoffs/
# Expected: handoff.retention.sweep.{started,completed} events in stdout/log
```

This step emulates what Cloud Scheduler will do in prod: external process invokes the CLI, returns synchronously, exits 0 on success. Anything that breaks here breaks the prod path.

---

## 6. Verification

### Unit tests — `product/connector/src/handoff/__tests__/sweeper.test.ts`

With an injected clock + an in-memory `HandoffStore` test double (or a tmp-dir `FsHandoffStore`):

- ✅ **Empty store** — `sweepHandoffs` returns `{ ok: true, scanned: 0, deleted: 0, perVerdict: {…all zeros…}, skipped: [] }`. Started + completed events emitted with `runId` matching.
- ✅ **One record per verdict, all under retention** — none deleted. `perVerdict` all zeros.
- ✅ **One record per verdict, all over retention** — all four deleted. `perVerdict` `{ qualified:1, referred_out:1, disqualified:1, inconclusive:1 }`.
- ✅ **Mixed ages** — assert exactly the expired records are deleted, fresh ones survive.
- ✅ **Verdict-specific window** — qualified at day 89 survives (window 360d); disqualified at day 89 survives (window 90d); disqualified at day 91 is deleted. Pin clock at a fixed `now`.
- ✅ **Corrupt record on disk** — write a `xyz.json` file with malformed JSON; sweep skips it with `reason: 'parse_failed'`; record stays on disk.
- ✅ **`delete_failed` propagates as skip, not abort** — inject a store double whose `delete()` returns `{ ok: false, reason: 'delete_failed' }` for one specific id; sweep continues, that id appears in `skipped`, others delete normally.
- ✅ **Started event has `policyDigest` differing across two policies** — assert two distinct digests for `DEFAULT_RETENTION_POLICY` vs a manually-shortened test policy. Catches accidental future drift where a config change wouldn't be visible in the event stream.
- ✅ **Custom policy override is honoured** — supply a 1-second window for all verdicts; submit a record 5 seconds ago; sweep deletes it.
- ✅ **Failed event emitted on `list()` failure** — store double's `list()` throws; sweep emits `handoff.retention.sweep.failed` with `errorCategory: 'list_failed'`.

### Unit tests — extend `product/connector/src/handoff/__tests__/store.test.ts`

- ✅ **`delete()` happy path** — save then delete; `get()` returns null.
- ✅ **`delete()` idempotency** — deleting a missing id returns `{ ok: true, deleted: false }`.
- ✅ **`delete()` filename safety** — `delete('../escape')` returns `{ ok: false, reason: 'handoff_id_invalid' }` without touching the filesystem.
- ✅ **`sweep()` on `FsHandoffStore`** — populate a tmp-dir store with three records of mixed ages; sweep with pinned clock; assert exactly the expired record's file is gone, others remain.

### Integration test — `product/connector/src/handoff/__tests__/sweeper.test.ts` (FS integration)

Populate a tmp-dir `FsHandoffStore` with eight records (two per verdict, one fresh + one expired). Run `sweepHandoffs({ store, now: pinnedClock })`. Assert:
- `SweepResult.deleted === 4`.
- `perVerdict === { qualified: 1, referred_out: 1, disqualified: 1, inconclusive: 1 }`.
- The four expected files survive on disk; the four expected files are gone.
- One started + one completed event emitted (no failed).

### Operator runbook walk-through (live)

After the code lands and tests pass:
1. Boot orchestrator with `HANDOFF_RETENTION_SWEEP_ENABLED=true HANDOFF_RETENTION_SWEEP_INTERVAL_MS=5000 HANDOFF_RETENTION_SWEEP_INITIAL_DELAY_MS=1000`.
2. Drop a hand-crafted record under `product/orchestrator/var/handoffs/` with `session.handoffSubmittedAt` set to a year ago, verdict `qualified`.
3. Confirm the record is gone within ~10 seconds + a `handoff.retention.sweep.completed` event appeared in the orchestrator log with `deleted: 1, perVerdict: { qualified: 1 }`.
4. Repeat with the CLI: `npm run sweep:handoffs --workspace @swoop/connector` — same outcome, JSON to stdout.
5. Set `HANDOFF_RETENTION_SWEEP_ENABLED=false`, restart. Boot log shows "disabled". CLI still runs on demand.

### Fresh-install gate

Per `feedback_swarm_fresh_install_verify.md` (load-bearing for this codebase per CLAUDE.md memory):

```bash
cd product
rm -rf node_modules
npm install
npm run typecheck    # all 6 workspaces clean
npm test             # all workspaces green; new sweeper tests included
```

All 6 workspaces must pass typecheck + test from a fresh `node_modules`. The sweeper adds ~10 new test cases between `sweeper.test.ts` and `store.test.ts` additions; new total around 530.

### Compliance bundle update verification

Open `product/cms/legal/compliance-bundle/05-retention-policy.md` in a Markdown viewer:
- Retention windows table "Enforced?" column for the four handoff rows now reads `In-process sweeper (interim FS) / scheduled Cloud Run Job (post-Postgres)`.
- "Enforcement — current state vs target state" section reflects the interim sweeper as landed.
- "Gap counsel should know about" reframed to acknowledge FS-side gap closed; session-side + Postgres-side gaps remain (out of scope for this plan).

---

## 7. PoC carry-forward pointers

None directly. The PoC ChatGPT app had no durable handoff store and no retention enforcement.

The pattern this plan applies most closely mirrors:
- `product/connector/src/handoff/submit.ts` — the existing handoff side-effect orchestration, including the `emitEvent` pattern at the connector layer.
- `product/connector/src/handoff/mailer.ts` — the existing verdict-aware behaviour switch (returns `SendResult` with status + reason).
- `etl-rerun.md` / `embedding-rerun.md` / `image-annotation-rerun.md` — the established operator runbook shape.

---

## 8. Coordination with siblings

- **E.t2 proper (Postgres swap)** — when this lands, `PostgresHandoffStore.sweep()` and `PostgresHandoffStore.delete()` must satisfy the same interface introduced here. The migration adds `scheduled_deletion_at TIMESTAMPTZ NOT NULL` + index per §2.7. The Cloud Run Job wiring (cron schedule, deploy config) is E.t2 proper's concern, not this plan's.
- **E.t7 (data-deletion runbook for Art. 17 right-to-erasure)** — will consume `HandoffStore.delete(handoffId)`. This plan delivers that method; E.t7 wraps it in operator-facing copy + a `psql DELETE … WHERE email=…` equivalent for the Postgres path.
- **B.t2 (session sweeper)** — independent task; same architectural pattern. If a future agent picks up B.t2, the shape of this plan is the template: interface-level sweeper, FS interim + future durable backend, in-process interval, observability events, operator runbook. Don't duplicate the runtime infrastructure; reuse the pattern.
- **Chunk F (observability)** — the three new event kinds add to the existing `handoff.email.*` family. No F-side schema work required beyond registration in the discriminated union.

---

## 9. References

- `planning/02-impl-handoff-and-compliance.md` §2.7 + §10 — Tier 2 retention posture + order-of-execution.
- `planning/03-exec-handoff-t2-t3.md` — interim `FsHandoffStore` + the `HandoffStore` interface this plan extends.
- `planning/03-exec-e-t8.md` §2.10 source — compliance bundle structure; this plan edits §05 of the bundle.
- `planning/decisions.md` — entries **E.6** (qualified/referred_out retention), **E.7** (disqualified/inconclusive retention), **E.8** (session retention; out of scope here), **E.10** (Postgres single-store target), **E.11** (connector workspace home for handoff side-effects), **E.12** (FsHandoffStore interim).
- `product/cms/legal/compliance-bundle/05-retention-policy.md` — authoritative retention values.
- `product/connector/src/handoff/store.ts` — the interface this plan extends.
- `product/connector/src/handoff/submit.ts` — the event emission pattern this plan follows for the new `handoff.retention.sweep.*` kinds.
- `discoveries.md` 2026-04-28 — "File-backed `FsHandoffStore` is a legitimate interim — interface is what survives"; this plan operationalises that principle for retention.
- `gotchas.md` "File-backed handoff records under `var/handoffs/` are gitignored" + "HandoffStore filename safety: handoffId must match `^[a-zA-Z0-9_-]+$`".

---

## 10. Hand-off

When this plan executes:
- Sweeper module + interface change + boot wiring + tests + runbook + bundle update land as one atomic commit (or two: code first, then docs).
- `next-steps.md` §4 E.t6 row flips from "open" to "✅ interim sweeper landed; Cloud Run Job follows with E.t2 proper".
- `progress.md` chunk-E status updates.
- `discoveries.md` gets one entry: *"Retention sweep lives at the interface, not the implementation — survives the Postgres swap unchanged"*.
- Counsel review (E.t9) can proceed with the FS-interim caveat narrowed: retention is enforced today against the FS store; full SQL enforcement lands with E.t2 proper.
