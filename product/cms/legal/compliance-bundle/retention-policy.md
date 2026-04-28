# Retention policy

Retention rules for visitor data inside Puma. This document expresses the policy for legal counsel; the visitor-facing version lives at `product/cms/legal/retention.md` (E.t5) and is shorter and plainer.

Source rules: `planning/02-impl-handoff-and-compliance.md` §2.7 + decisions E.6 / E.7 / E.8 in that document's §5 table.

Enforcement code: `planning/03-exec-handoff-t6.md` (E.t6) — scheduled sweeper. Implementation owned by a separate Tier 3 task; this document specifies *what* is enforced, not *how*.

---

## Categories + TTLs

| Category | TTL | Rationale | Trigger |
|---|---|---|---|
| **In-progress session — active** | 24 hours idle | Conversation continuity; matches typical user attention window. Beyond 24h, visitors return to a fresh chat. | Last message timestamp + 24h elapsed → archive. |
| **In-progress session — archived** | 7 days from archive | Buffer for visitor returning later who wants to resume; rare but supported. | Archive timestamp + 7d elapsed → delete. |
| **Submitted handoff — `qualified`** | 12 months OR until ingested into Swoop's CRM, whichever sooner | Sales follow-up window; aligns with GDPR data-minimisation. Swoop's CRM lifecycle is the longer-term governor. | Submission timestamp + 12 months elapsed → delete (unless CRM-ingestion timestamp exists, in which case delete then). |
| **Submitted handoff — `referred_out`** | 12 months OR until ingested into Swoop's CRM, whichever sooner | Same as qualified. Even though the lead isn't Swoop-direct, it's still a captured contact. | As above. |
| **Submitted handoff — `disqualified`** | 90 days | Analytics window only. No contact details on these records by schema (`HandoffPayloadDisqualifiedSchema.strict()` rejects `contact`). | Submission timestamp + 90 days elapsed → delete. |
| **Cloud Logging events** | 30 days (Cloud Logging default) | Operational debugging window. Events are PII-free by schema. | GCP-side retention; no application-level deletion needed. |
| **Cloud Logging → BigQuery export (if Swoop opts in)** | TBC by Swoop | Long-term analytics. Event schema is still PII-free. | Per Swoop's BigQuery retention. |

---

## Deletion mechanism

Implemented as a sweeper inside the orchestrator service. See E.t6 plan for technical detail.

- **Cadence**: scheduled job (Cloud Scheduler hitting an orchestrator endpoint, or a Cloud Run Job on cron). Default cadence: every 6 hours.
- **Scope**: scans Cloud SQL for records whose retention threshold has passed.
- **Action**: hard delete (DELETE row), not soft-delete. Per E.9, manual self-service deletion isn't in Puma's scope, so soft-delete adds no value and creates ambiguity.
- **Audit**: each sweeper run emits a `retention.swept` event with counts (records-deleted by category). No record contents are logged. The event itself is subject to the 30-day Cloud Logging retention.
- **Idempotency**: re-running the sweeper produces no additional deletions. Records below threshold are skipped.

For the right-to-erasure flow (which is request-driven, not time-driven), see `runbooks/data-deletion.md` (authored by E.t7 — separate Tier 3 task).

---

## Exceptions

### CRM-ingested handoffs

Once a handoff is ingested into Swoop's CRM, the CRM becomes the source of truth for the visitor's contact relationship with Swoop. Puma's local copy can be deleted at that point regardless of the 12-month upper bound.

CRM-ingestion is a Swoop-side workflow that surfaces back to Puma via a `crm_ingested_at` timestamp on the handoff record (post-Puma; not in M5 scope). Until CRM integration ships, the upper bound (12 months) is the only trigger.

### Right-to-erasure requests

GDPR Art. 17 requests are handled out-of-band via the data-deletion runbook (`product/cms/legal/runbooks/data-deletion.md`, owned by E.t7). The runbook covers:
- Receiving a request at Swoop's documented privacy contact.
- Locating the handoff by email address.
- Hard-deleting the handoff record + any session state still alive for that visitor.
- Logging a minimal confirmation (deletion timestamp, record id; no payload contents).

Right-to-erasure overrides the standard retention TTLs. A visitor can request earlier deletion at any time.

### Legal hold

If Swoop becomes subject to a legal hold (litigation, regulator request), the sweeper must be pausable for affected records. Mechanism: a `legalHoldUntil` timestamp on the record (post-Puma; out of M5 scope but trivially extensible).

For Puma launch, no legal hold facility is implemented. If a hold is required before that, the sweeper can be paused entirely via configuration. Counsel should flag if this is insufficient.

---

## What is *not* retained

- **Visitor IP addresses** beyond Cloud Logging's standard request-log retention (which is GCP-managed and PII-free for our application logs).
- **Browser fingerprints, device identifiers** — not collected.
- **Cross-session linkage** — Puma intentionally has no cross-session memory. Two visits from the same browser produce two unlinked sessions. (Architecture theme — see top-level §7 "Out of scope".)
- **Conversation transcripts after session deletion** — when the session is deleted under the 7-day archived TTL, the transcript is gone. Any persistence of substance lives in the handoff record (which is retained per the table above), and the handoff record contains a *summary*, not the raw transcript.
  - Rationale: handoff payload's `motivationAnchor`, `wishlist`, and `reason.text` carry the sales-relevant narrative. The full transcript is not preserved post-session because it doesn't add value beyond what the summary captures.
  - **Counsel should confirm**: whether Swoop's privacy posture allows the orchestrator to retain the *raw* transcript on the handoff record alongside the summary, or whether summary-only is preferred. Currently summary-only.

---

## Cross-reference

- Visitor-facing summary: `product/cms/legal/retention.md` (E.t5).
- Right-to-erasure runbook: `product/cms/legal/runbooks/data-deletion.md` (E.t7).
- Implementation: `planning/03-exec-handoff-t6.md` (E.t6).
- Decisions: `planning/02-impl-handoff-and-compliance.md` §5 (E.6, E.7, E.8).
