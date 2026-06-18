# Handoff retention sweep

Operator-facing runbook for the durable handoff store's retention enforcement. Open this when you're verifying that expired handoffs are getting deleted on schedule, or when something looks off.

---

## Why this exists

Puma stores every submitted handoff as a durable record (`<orchestrator-package-root>/var/handoffs/<handoffId>.json` today; a Cloud SQL `handoff` table post-IAM). GDPR Art. 5(1)(e) "storage limitation" and the EU AI Act's documentation expectations both require those records to be deleted on a published schedule.

The schedule comes from the compliance bundle:

| Verdict | Retention window | Decision ref |
|---|---|---|
| `qualified` | 360 days (12-month outer bound) | E.6 |
| `referred_out` | 360 days | E.6 |
| `disqualified` | 90 days | E.7 |
| `inconclusive` | 90 days | E.7 pattern (HITL Q5) |

Authoritative source: `product/cms/legal/compliance-bundle/05-retention-policy.md`.

The **handoff retention sweep** is the enforcement mechanism. It scans the store on a cadence (default daily), hard-deletes any record whose `session.handoffSubmittedAt` is older than the per-verdict window, and emits structured events so the cadence + delete counts are observable without granting access to PII.

---

## What you'll do every time

Usually nothing — the sweeper runs on its own. The steps below cover:

1. Confirming it's running.
2. Triggering a manual sweep on demand.
3. Disabling it temporarily.
4. Inspecting the deletions.
5. Recovering when something goes wrong.

Time-box: 1–2 minutes for confirmation, ~10s for a manual trigger against the FS store.

---

## Cadence + ownership

- **When**: daily by default, in-process inside the orchestrator. Configurable via `HANDOFF_RETENTION_SWEEP_INTERVAL_MS`.
- **Who**: the **ETL operator** owns this post-handover. Until handover, Al.
- **Phase 1 posture**: in-process `setInterval` inside the orchestrator (today's `FsHandoffStore` interim). When E.t2 proper lands — `PostgresHandoffStore` against Cloud SQL — the carrier flips to a scheduled **Cloud Run Job** invoking `npm run sweep:handoffs --workspace @swoop/connector`. Same function, same `HandoffStore.sweep` interface, same operator runbook.

---

## Step 1 — Confirm it's running

The orchestrator logs the sweeper's state at boot:

```bash
grep "handoff retention sweeper" orchestrator.log
# Expected when enabled:
# [orchestrator] handoff retention sweeper: enabled, interval=86400s, initialDelay=60s, policy={qualified:360d, referred_out:360d, disqualified:90d, inconclusive:90d}
# Expected when disabled (default):
# [orchestrator] handoff retention sweeper: disabled (set HANDOFF_RETENTION_SWEEP_ENABLED=true to flip)
```

Post-deploy, query Cloud Logging for the most recent `handoff.retention.sweep.completed` event:

```
jsonPayload.eventType = "handoff.retention.sweep.completed"
ORDER BY timestamp DESC LIMIT 1
```

You'll know it's healthy when:
- A `handoff.retention.sweep.completed` event appears at the expected cadence (within `HANDOFF_RETENTION_SWEEP_INTERVAL_MS` of the previous one).
- The event's `payload.scanned` is non-zero (or zero plus a known-empty store).
- No `handoff.retention.sweep.failed` events in the trailing 24h.

---

## Step 2 — Manual trigger

When you want to run one sweep immediately — ad-hoc inspection, post-config-change verification, or the §5b CLI smoke test — invoke the CLI:

```bash
npm run sweep:handoffs --workspace @swoop/connector
```

The CLI:
- Loads `.env` (the connector's `dotenv({ override: true })` matches the orchestrator's posture).
- Reads `HANDOFF_STORE_DIR` (defaults to `product/orchestrator/var/handoffs/`).
- Reads per-verdict window overrides from env (see below) if you're forcing a short-TTL smoke run; otherwise uses the authoritative `DEFAULT_RETENTION_POLICY`.
- Prints the `SweepResult` JSON to stdout on a single line.
- Exits 0 on success, 1 on failure.

Example:

```bash
npm run sweep:handoffs --workspace @swoop/connector
# stderr:
#   [sweep] store dir: /…/product/orchestrator/var/handoffs
#   [sweep] policy (ms): {"qualified":31104000000,…}
#   [sweep] done: scanned=42 deleted=3 skipped=0
# stdout:
#   {"ok":true,"scanned":42,"deleted":3,"perVerdict":{"qualified":2,"referred_out":1,…},"skipped":[]}
```

Short-TTL smoke test (forces everything to expire — used for the §5b verification step in `planning/03-exec-handoff-t6.md`):

```bash
HANDOFF_RETENTION_QUALIFIED_WINDOW_SECONDS=1 \
HANDOFF_RETENTION_REFERRED_OUT_WINDOW_SECONDS=1 \
HANDOFF_RETENTION_DISQUALIFIED_WINDOW_SECONDS=1 \
HANDOFF_RETENTION_INCONCLUSIVE_WINDOW_SECONDS=1 \
  npm run sweep:handoffs --workspace @swoop/connector
```

Same code path as the in-process timer — anything that breaks here breaks the prod (Cloud Run Job) path the same way.

---

## Step 3 — Disable temporarily

For a one-off ops window (e.g. a manual recovery operation that needs to inspect expired records before they're swept):

```bash
HANDOFF_RETENTION_SWEEP_ENABLED=false  # flip in .env, restart orchestrator
```

Re-enable after the window. The CLI in Step 2 continues to work regardless — `HANDOFF_RETENTION_SWEEP_ENABLED` only governs the in-process interval.

For **permanent** disable in a deployed environment: omit `HANDOFF_RETENTION_SWEEP_ENABLED` from the deploy config (default is `false`).

---

## Step 4 — Inspect deletions

FS interim — list what's currently in the store:

```bash
ls -1 product/orchestrator/var/handoffs/ | wc -l
# Expected: a small integer; growing on submit, shrinking on sweep.
```

Post-Postgres swap:

```sql
SELECT verdict, COUNT(*)
FROM handoff
GROUP BY verdict
ORDER BY verdict;
```

Per-verdict deletion tallies from the most recent sweep are in the `handoff.retention.sweep.completed` event's `payload.perVerdict`.

---

## Step 5 — Right-to-erasure (Art. 17) is separate

The retention sweep enforces Art. 5(1)(e) storage limitation — automatic expiry of records past their per-verdict window. Visitor-initiated deletion (GDPR Art. 17 right to erasure) is a **separate** operator path covered by the data-deletion runbook (E.t7, currently parked). For an Art. 17 request:

1. Locate the record by email (FS interim) or by `WHERE email = $1` (Postgres).
2. Call `HandoffStore.delete(handoffId)` — same idempotent contract the sweep uses.
3. Log the operator action (id + timestamp; no content).

E.t7 will productise this step into an operator script.

---

## When things go wrong

### Symptom: `handoff.retention.sweep.failed` event with `errorCategory: "sweep_failed"`

The store's `sweep()` returned `{ ok: false, ... }`. For `FsHandoffStore`, this is usually a directory-permission issue or a missing directory. Check:

```bash
ls -ld product/orchestrator/var/handoffs/
# Expected: drwx------ (0o700), owner matches the orchestrator process.
```

Re-create with the right mode if missing:

```bash
mkdir -m 0o700 -p product/orchestrator/var/handoffs/
```

Restart the orchestrator; the next sweep should complete cleanly.

### Symptom: `skipped` entries with `reason: "parse_failed"`

One or more records on disk are malformed (corrupt JSON, schema-invalid, partial write). Per HITL Q5 ratification (2026-05-12), the sweep **leaves these in place** rather than auto-deleting — corrupt records need operator investigation.

To inspect:

```bash
cat product/orchestrator/var/handoffs/<handoffId>.json | jq .
```

If the JSON is malformed beyond use, manually delete the file (it carries PII that's already not retrievable):

```bash
rm product/orchestrator/var/handoffs/<handoffId>.json
```

Tally the deletions for the audit log. If parse_failed entries are accumulating, escalate to the orchestrator owner — atomic-rename writes should make this near-impossible.

### Symptom: `skipped` entries with `reason: "delete_failed"`

Fs operation failed for one specific record. Other records continue to sweep. Causes:
- The file mode is wrong (write-only directory, read-only file). `stat` the file; fix the mode.
- The disk is full. `df -h` the partition.
- The directory is on a read-only mount. Re-mount writable.

Re-run the sweep manually (Step 2) once the underlying issue is fixed.

### Symptom: `handoff.retention.sweep.completed` events stop appearing

The in-process interval got stopped. Causes:
- Orchestrator process crashed (check Cloud Run logs / `journalctl`).
- `HANDOFF_RETENTION_SWEEP_ENABLED` was flipped off.
- The `setInterval` timer was somehow cleared (shouldn't happen — only the shutdown handler does this).

Restart the orchestrator. The boot log will show the sweeper state. The CLI in Step 2 remains available for ad-hoc enforcement until the in-process path is restored.

---

## Where the rules came from

- Decisions **E.6** (qualified / referred_out retention), **E.7** (disqualified / inconclusive retention), **E.10** (Cloud SQL Postgres target), **E.11** (connector workspace home), **E.12** (FsHandoffStore interim).
- HITL ratification record in `planning/03-exec-handoff-t6.md` §5 (2026-05-12).
- Compliance bundle source of truth: `product/cms/legal/compliance-bundle/05-retention-policy.md`.
- Code: `product/connector/src/handoff/sweeper.ts`, `product/connector/src/handoff/store.ts`, `product/connector/bin/sweep.ts`.

---

## Open items

These stay visible until resolved.

1. **Cloud Run Job swap (E.t2 proper)** — when GCP IAM lands and `PostgresHandoffStore` ships, the in-process interval is supplanted by a Cloud Scheduler-triggered Cloud Run Job invoking this same CLI. The runbook stays the same; only the carrier flips.
2. **`scheduled_deletion_at` migration** — the Postgres swap will add this column + a `WHERE scheduled_deletion_at < NOW()` index. Not in scope for this runbook; flagged here so future-Postgres-author knows the contract.
3. **Counsel review (E.t9)** — the hard-delete posture and the 360-day approximation of "12 months" should be confirmed by Swoop's counsel. Both choices are documented in `05-retention-policy.md`.
