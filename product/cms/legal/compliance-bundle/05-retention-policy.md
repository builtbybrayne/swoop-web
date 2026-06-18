# 05 — Retention Policy

> **Status: ✅ FILLED** — updated 2026-06-18 (v0.8): session enforcement is now wired (durable Postgres + `startPostgresSessionSweep`); infrastructure references updated to single-VM shape; Cloud Logging references made shape-agnostic.

---

## Retention windows by data category

| Data | Retention | Lawful basis | Decision ref | Enforced? |
|---|---|---|---|---|
| In-progress session (idle) | 24h | Art. 5(1)(c) data minimisation + Art. 5(1)(e) storage limitation | E.8 | **Yes** — sessions are durable in Postgres; `startPostgresSessionSweep` enforces the idle/archive TTL. |
| In-progress session (archived) | +7 days then deleted | as above | E.8 | **Yes** — same sweep. |
| Submitted handoff — qualified / referred_out | 360 days outer bound OR until CRM ingestion (whichever sooner)¹ | Art. 6(1)(a) consent + sales lifecycle necessity | E.6 | **Yes** — in-process sweeper (interim FS) / scheduled sweep on the VM (post-Postgres). |
| Submitted handoff — disqualified | 90 days | Art. 6(1)(f) legitimate interest in product analytics, post-purpose-served | E.7 | **Yes** — same sweep. |
| Submitted handoff — inconclusive | 90 days | Art. 6(1)(f) legitimate interest in product analytics, agent-never-reached-confidence | E.7 pattern (per HITL Q5) | **Yes** — same sweep. |
| Tier-1 / Tier-2 consent records | Lifetime of underlying handoff record | Bundled with handoff record (audit trail) | implicit in E.6/E.7 | as above |
| Server / event logs | Per deployment log policy | Art. 6(1)(f) legitimate interest in observability | F-a / F-b | Per deployment configuration (see note below) |

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

### Server / event log retention (F-a / F-b)

- **Per deployment policy**: Puma's event stream holds no PII (IDs, verdicts, timestamps, status codes only). Retention of the event stream depends on the sink: today's sink is Postgres on the VM (governed by whatever backup/rotation policy ops sets); if the managed-services path is adopted, Google Cloud Logging would apply its own configurable retention (30-day default). The specific retention window is therefore **shape-dependent** and not asserted here.
- **Event payloads**: minimised. No message bodies, no email content, no contact details.
- **Host/ingress logs**: server request logs (IPs, user-agents) are captured by the VM's host/ingress layer per its own log policy — not controlled by Puma directly.

---

## Enforcement — current state vs target state

### Today (2026-06-18)

- **In-progress sessions**: sessions are durable in Postgres (`SESSION_BACKEND=postgres`). The deletion sweep (`startPostgresSessionSweep`) is **wired** — it enforces the 24h-idle TTL and the +7d archive TTL automatically.
- **Submitted handoffs**: enforced. The `FsHandoffStore` (interim) is swept by an in-process interval inside the orchestrator process via `sweepHandoffs` from `@swoop/connector`. Default cadence is **daily** (`HANDOFF_RETENTION_SWEEP_INTERVAL_MS=86_400_000`), governed by `HANDOFF_RETENTION_SWEEP_ENABLED` at boot. Each sweep emits `handoff.retention.sweep.{started,completed,failed}` events with per-verdict deletion counts. Operator runbook: [`handover/ops/handoff-retention-sweep.md`](../../../../handover/ops/handoff-retention-sweep.md). `var/handoffs/` remains gitignored so PII never enters the repo.²
- **Event / server logs**: per deployment log policy (see retention table note above).

**Current posture**: both session and handoff retention are enforced in code. Pre-launch the orchestrator runs on a dev / staging machine with controlled access.

### Target state (post-IAM + post-Postgres-swap)

- **In-progress sessions**: same `startPostgresSessionSweep` logic continues against the production Postgres instance on the VM.
- **Submitted handoffs**: a scheduled sweep (cron/timer on the VM; a managed scheduled job only if the managed-services path is adopted) invokes `npm run sweep:handoffs --workspace @swoop/connector` daily. The CLI calls the **same** `sweepHandoffs()` function the in-process timer uses today; the `PostgresHandoffStore.sweep` implementation runs one `DELETE … WHERE scheduled_deletion_at < NOW()` SQL statement against the indexed column. The `scheduled_deletion_at` column is computed at insert time from verdict (qualified/referred_out → +360 days; disqualified/inconclusive → +90 days).
- **Event / server logs**: unchanged — per deployment log policy.

The carrier flips from "in-process interval" to "scheduled sweep on the VM" at the Postgres swap; the operator runbook + observability events + `HandoffStore` interface all stay the same.

### Remaining gap counsel should know about

Session and handoff enforcement are both wired. The one remaining open item:

1. **Post-Postgres-swap carrier flip**: the in-process interval is the carrier today for handoffs. When the Postgres swap completes (E.t2 proper), the carrier flips to a scheduled sweep on the VM. The intervening period needs operator attention to ensure neither carrier is missing.

² **Counsel-review note (added 2026-05-12 per HITL Q1 ratification of E.t6):** Puma's interim handoff retention enforcement implements **hard-deletion** of expired records on schedule. Per GDPR Art. 17 right-to-erasure, hard-deletion aligns with the data-subject's expectation that expired records are removed. Auto-expiry signals are emitted via the observability event stream (counts only, no PII; see the F-a / F-b event schema in the connector package for the event taxonomy). Accident-recovery is provided by deployment-level backup retention. If counsel prefers a soft-delete posture with secondary retention (e.g. quarantine to `var/handoffs/.expired/` with a separate retention window), the change is a single-implementation tweak: `FsHandoffStore.delete()` renames-to-quarantine instead of `unlink()`. The sweeper interface, scheduling, observability events, and operator runbook are all unchanged. No re-architecture required. Surface this design choice at E.t9 counsel review.

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

- **Single-VM Postgres**: backup retention is **shape-dependent**. On the committed single-VM shape, backup cadence and retention are set by whoever operates the VM (ops-configured snapshot; no default imposed by Google). On a managed Postgres service, a ~7-day point-in-time recovery window would typically apply. The specific window is not asserted here — confirm with Thomas (D-3.3.5) once the deployment shape is finalised.
- **Backup retention conflicts with Art. 17 erasure**: an erased record may persist in backups for whatever window ops has configured. Standard practice; counsel should confirm acceptability given the shape-dependent window above.
- **`FsHandoffStore` interim**: no backups (sits on a single dev/staging machine). Pre-launch acceptable.

---

## Counsel review questions for this section

- Are the retention windows (360 days / 90d / 7d / deployment-policy for logs) defensible under Art. 5(1)(e) data minimisation?
- Is the disqualified-records 90-day analytics retention acceptable under legitimate-interest balancing?
- Is the backup-window posture (shape-dependent; ops-configured on the VM, ~7-day PITR on managed Postgres) acceptable under Art. 17? What backup-then-erase window is acceptable?
- Does Swoop have a documented retention policy elsewhere this should align with?
