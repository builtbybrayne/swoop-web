# 05 — Retention Policy

> **Status: ✅ FILLED** — production-ready for counsel review.
>
> Retention values are decisions E.6 / E.7 / E.8 (closed 2026-04-22). Enforcement mechanism is part of E.t6 (open, post-IAM); this section flags that gap explicitly so counsel can decide whether interim posture is acceptable.

---

## Retention windows by data category

| Data | Retention | Lawful basis | Decision ref | Enforced? |
|---|---|---|---|---|
| In-progress session (idle) | 24h | Art. 5(1)(c) data minimisation + Art. 5(1)(e) storage limitation | E.8 | Idle TTL via session sweeper (planned) |
| In-progress session (archived) | +7 days then deleted | as above | E.8 | Archive TTL via session sweeper (planned) |
| Submitted handoff — qualified / referred_out | 12 months OR until CRM ingestion (whichever sooner) | Art. 6(1)(a) consent + sales lifecycle necessity | E.6 | Scheduled job (planned, post-Postgres swap) |
| Submitted handoff — disqualified | 90 days | Art. 6(1)(f) legitimate interest in product analytics, post-purpose-served | E.7 | Scheduled job (planned, post-Postgres swap) |
| Submitted handoff — inconclusive | 90 days | Art. 6(1)(f) legitimate interest in product analytics, agent-never-reached-confidence | E.7 pattern (per HITL Q5) | Scheduled job (planned, post-Postgres swap) |
| Tier-1 / Tier-2 consent records | Lifetime of underlying handoff record | Bundled with handoff record (audit trail) | implicit in E.6/E.7 | as above |
| Cloud Logging events (handoff.submitted etc.) | 30 days | Art. 6(1)(f) legitimate interest in observability | F-a / F-b | Cloud Logging default |

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

### Today (2026-04-28)

- **In-progress sessions**: ADK in-built session store; sweeper not yet wired (B.t2 deferred). **No automatic deletion.** Sessions persist in memory until orchestrator restart, which deletes all in-memory state.
- **Submitted handoffs**: `FsHandoffStore` writes JSON files under `<connector-package-root>/var/handoffs/`. **No automatic deletion.** Files persist until manually purged. `var/handoffs/` is gitignored so PII never enters the repo.
- **Cloud Logging events**: standard 30-day Cloud Logging default applies.

**Interim acceptability**: pre-launch, no real visitor traffic; the file-backed store sits on dev/staging machines with controlled access. Post-launch, this changes — the Cloud SQL Postgres swap (E.10) + the scheduled Cloud Run Job (E.t6) must be in place before real visitors reach Puma.

### Target state (post-E.t6 + post-IAM)

- **In-progress sessions**: B's session sweeper runs `DELETE … WHERE last_active < NOW() - INTERVAL '24 hours' AND state = 'active'`-style logic. Plus archive sweep at 7 days post-archive.
- **Submitted handoffs**: scheduled Cloud Run Job runs daily, executing parameterised SQL `DELETE FROM handoff WHERE scheduled_deletion_at < NOW()`. The `scheduled_deletion_at` column is computed at insert time from verdict (qualified/referred_out → +12 months; disqualified → +90 days).
- **Cloud Logging events**: unchanged — Cloud Logging native TTL.

### Gap counsel should know about

The bundle's other sections describe Puma's compliance posture as if enforcement were automatic. **It is not yet.** Until E.t6 lands (which depends on the Cloud SQL Postgres swap, which depends on GCP IAM landing — blocked on Thomas), retention is **policy-only** with manual enforcement.

This is acceptable pre-launch but **must be closed before public launch**. Flag for counsel: do you want a documented manual sweep cadence for the interim, or is "no real traffic" a sufficient framing?

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
