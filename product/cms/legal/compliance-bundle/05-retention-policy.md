# 05 — Retention Policy

> **Status: ✅ FILLED** — production-ready for counsel review.
>
> Retention values are decisions E.6 / E.7 / E.8 (closed 2026-04-22). FS-side enforcement landed via E.t6 (2026-05-12): an in-process sweeper inside the orchestrator hard-deletes expired records on a daily cadence. Cloud Run Job replaces the in-process interval when the Postgres swap (E.t2 proper) lands post-IAM. Session-side enforcement (B.t2 sweeper) remains the open gap.

---

## Retention windows by data category

| Data | Retention | Lawful basis | Decision ref | Enforced? |
|---|---|---|---|---|
| In-progress session (idle) | 24h | Art. 5(1)(c) data minimisation + Art. 5(1)(e) storage limitation | E.8 | Idle TTL via session sweeper (planned) |
| In-progress session (archived) | +7 days then deleted | as above | E.8 | Archive TTL via session sweeper (planned) |
| Submitted handoff — qualified / referred_out | 12 months OR until CRM ingestion (whichever sooner)¹ | Art. 6(1)(a) consent + sales lifecycle necessity | E.6 | In-process sweeper (interim FS) / scheduled Cloud Run Job (post-Postgres) |
| Submitted handoff — disqualified | 90 days | Art. 6(1)(f) legitimate interest in product analytics, post-purpose-served | E.7 | In-process sweeper (interim FS) / scheduled Cloud Run Job (post-Postgres) |
| Submitted handoff — inconclusive | 90 days | Art. 6(1)(f) legitimate interest in product analytics, agent-never-reached-confidence | E.7 pattern (per HITL Q5) | In-process sweeper (interim FS) / scheduled Cloud Run Job (post-Postgres) |
| Tier-1 / Tier-2 consent records | Lifetime of underlying handoff record | Bundled with handoff record (audit trail) | implicit in E.6/E.7 | as above |
| Cloud Logging events (handoff.submitted etc.) | 30 days | Art. 6(1)(f) legitimate interest in observability | F-a / F-b | Cloud Logging default |

¹ **Implementation note**: the sweeper uses **360 days** (12 × 30) as the outer bound rather than calendar-aware month arithmetic. Calendar-aware month arithmetic introduces leap-year / DST edge cases that the sweeper does not need; erring on the side of earlier deletion is conservative under Art. 5(1)(e) storage limitation. The "OR until CRM ingestion" branch is **not** automatic — it requires an operator-initiated deletion via the Art. 17 erasure runbook (E.t7). The 360-day outer bound is the failsafe.

---

## Detailed rationale per category

### In-progress sessions (E.8)

- **24h idle → archive**: visitor's typical chat session lasts minutes. After 24h of silence, the conversation is functionally abandoned. Archiving (read-only state, not active session) preserves the data briefly for potential return-visits while flagging it for purge.
- **7d archive → delete**: a returning visitor after a week of silence is effectively a new visitor; their old context is stale. Hard delete after 7 days.
- **Storage limitation**: this satisfies GDPR Art. 5(1)(e) — data is kept no longer than necessary for the original purpose (an in-progress conversation).

### Submitted handoffs — qualified / referred_out (E.6)

- **12-month outer bound**: a sales lead's lifecycle (initial conversation → quote → booking → trip → post-trip) typically completes within 12 months. After that, the handoff record's purpose has been served by the CRM; Puma's copy is redundant.
- **OR until CRM ingestion**: in practice, sales staff ingest the lead into Swoop's CRM within days. The handoff record can be safely deleted once that ingestion is confirmed (manual trigger via the data-deletion runbook, E.t7).
- **Whichever sooner**: belt-and-braces — if CRM ingestion is missed for some reason, the 12-month outer bound catches it.
- **Tier-2 consent persists with the record**: the audit trail — version of consent copy, timestamp — stays inside the handoff JSONB column until the record is deleted.

### Submitted handoffs — disqualified (E.7)

- **90 days**: enough time for product analytics — checking the agent's disqualification accuracy, identifying patterns of misclassification, calibrating the triage classifier. After 90 days the analytics value plateaus.
- **No email sent**: the record exists for analytics, not sales. Hard delete at 90 days satisfies storage minimisation.
- **Lawful basis Art. 6(1)(f)**: legitimate interest in product analytics. Balancing test: the data has minimal reidentification risk (no contact persisted past disqualification — visitor never submitted contact for disqualified outcomes) and the analytics purpose is necessary for product quality. Counsel should confirm this framing.

### Submitted handoffs — inconclusive (E.7 pattern, per HITL Q5)

- **90 days** — same as disqualified. The agent never reached confidence to qualify, refer-out, or disqualify; the durable record exists for analytics (understanding which visitor patterns produce inconclusive outcomes) and post-launch prompt iteration.
- **No email sent**: same as disqualified. The record exists for analytics, not sales.
- **Lawful basis Art. 6(1)(f)**: legitimate interest in product analytics. Same balancing test as disqualified: no contact field is ever persisted on an inconclusive record (the agent never surfaced the lead-capture widget). Counsel should confirm this framing applies equally.

### Cloud Logging events (F-a / F-b)

- **30-day default**: Cloud Logging default retention. Adequate for observability + incident response.
- **Event payloads**: minimised. No message bodies, no email content, no contact details — only IDs, verdicts, timestamps, status codes.
- **Longer retention via BigQuery export**: if Swoop wants longer retention for analytics, events export to BigQuery. Out of scope for this bundle pre-handover.

---

## Enforcement — current state vs target state

### Today (2026-05-12, post-E.t6)

- **In-progress sessions**: ADK in-built session store; sweeper not yet wired (B.t2 deferred). **No automatic deletion.** Sessions persist in memory until orchestrator restart, which deletes all in-memory state.
- **Submitted handoffs**: enforced. The `FsHandoffStore` (interim) is swept by an in-process interval inside the orchestrator process via `sweepHandoffs` from `@swoop/connector`. Default cadence is **daily** (`HANDOFF_RETENTION_SWEEP_INTERVAL_MS=86_400_000`), governed by `HANDOFF_RETENTION_SWEEP_ENABLED` at boot. Each sweep emits `handoff.retention.sweep.{started,completed,failed}` events with per-verdict deletion counts. Operator runbook: [`handover/ops/handoff-retention-sweep.md`](../../../handover/ops/handoff-retention-sweep.md). `var/handoffs/` remains gitignored so PII never enters the repo.²
- **Cloud Logging events**: standard 30-day Cloud Logging default applies.

**Interim acceptability**: the FS-side gap is closed. Pre-launch the orchestrator runs on a dev / staging machine with controlled access; the sweeper enforces retention on the same cadence the production Cloud Run Job will use post-IAM. The interim posture continues to be acceptable.

### Target state (post-IAM + post-Postgres-swap)

- **In-progress sessions**: B's session sweeper runs `DELETE … WHERE last_active < NOW() - INTERVAL '24 hours' AND state = 'active'`-style logic. Plus archive sweep at 7 days post-archive.
- **Submitted handoffs**: scheduled Cloud Run Job invokes `npm run sweep:handoffs --workspace @swoop/connector` daily. The CLI calls the **same** `sweepHandoffs()` function the in-process timer uses today; the `PostgresHandoffStore.sweep` implementation runs one `DELETE … WHERE scheduled_deletion_at < NOW()` SQL statement against the indexed column. The `scheduled_deletion_at` column is computed at insert time from verdict (qualified/referred_out → +360 days; disqualified/inconclusive → +90 days).
- **Cloud Logging events**: unchanged — Cloud Logging native TTL.

The carrier flips from "in-process interval" to "Cloud Run Job" at swap time; the operator runbook + observability events + `HandoffStore` interface all stay the same.

### Gap counsel should know about

The handoff-side gap is closed by the interim sweeper (E.t6, landed 2026-05-12). **Two enforcement gaps remain:**

1. **Session-side** (in-progress chat sessions): B.t2 session sweeper not yet wired. Sessions persist in the orchestrator's in-memory store until process restart (which clears all state). With pre-launch traffic this is acceptable; pre-public-launch this must close — same pattern as the handoff sweeper, scoped to B.
2. **Post-Postgres-swap carrier flip**: the in-process interval is the carrier today. When GCP IAM lands and the Cloud SQL Postgres swap happens (E.t2 proper), the carrier flips to a Cloud Run Job. The intervening period (Postgres swap in flight) needs operator attention to ensure neither carrier is missing.

² **Counsel-review note (added 2026-05-12 per HITL Q1 ratification of E.t6):** Puma's interim handoff retention enforcement implements **hard-deletion** of expired records on schedule. Per GDPR Art. 17 right-to-erasure, hard-deletion aligns with the data-subject's expectation that expired records are removed. Auto-expiry signals are emitted via the observability event stream (counts only, no PII; see [`07-observability.md`](07-observability.md) for the event taxonomy). Accident-recovery is provided by deployment-level backup retention. If counsel prefers a soft-delete posture with secondary retention (e.g. quarantine to `var/handoffs/.expired/` with a separate retention window), the change is a single-implementation tweak: `FsHandoffStore.delete()` renames-to-quarantine instead of `unlink()`. The sweeper interface, scheduling, observability events, and operator runbook are all unchanged. No re-architecture required. Surface this design choice at E.t9 counsel review.

---

## Right to erasure (Art. 17) — separate from auto-expiry

Auto-expiry is the policy enforcement of Art. 5(1)(e) storage limitation. Visitor-initiated deletion under Art. 17 is a separate operational pathway:

- **Process**: per-request, manual (decision **E.9**). No self-service UI.
- **Mechanism**: visitor emails Swoop's privacy contact → recipient runs the data-deletion runbook → record deleted from store.
- **Runbook**: `product/cms/legal/runbooks/data-deletion.md` — owned by E.t7 (currently parked).
- **Logged**: deletion confirmation logged with minimal metadata (record id + deletion timestamp), no record content.

See [08-data-subject-rights.md](08-data-subject-rights.md) for the full data-subject-rights posture.

---

## Backups + replication

- **Cloud SQL Postgres** (post-IAM): Google Cloud's automated backups apply. Default 7-day backup retention.
- **Backup retention conflicts with Art. 17 erasure**: an erased record may persist in backups for up to 7 days. Standard practice; counsel should confirm acceptability.
- **`FsHandoffStore` interim**: no backups (sits on a single dev/staging machine). Pre-launch acceptable.

---

## Counsel review questions for this section

- Are the retention windows (12mo / 90d / 7d / 30d) defensible under Art. 5(1)(e) data minimisation?
- Is the disqualified-records 90-day analytics retention acceptable under legitimate-interest balancing?
- Is the interim "no automatic enforcement" posture acceptable pre-launch with no real traffic, or do you want a documented manual sweep?
- Is the 7-day backup window for erasure-then-restore acceptable, or does Swoop's posture require shorter / different?
- Does Swoop have a documented retention policy elsewhere this should align with?
