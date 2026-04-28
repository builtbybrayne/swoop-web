---
copyVersion: v1
lastReviewed: 2026-04-28
purpose: Retention policy summary referenced from privacy-info.md and the legal compliance bundle. Per Tier 2 chunk E §2.7.
heading: Retention policy
---

How long Puma keeps each kind of record, and what triggers deletion.

## In-progress conversations

A conversation is "in progress" from the moment the visitor sends their first message until the session ends.

- **Idle timeout**: 24 hours with no activity, after which the conversation is moved to read-only archive.
- **Archive deletion**: 7 days in archive, then deleted.

A visitor closing the tab or navigating away does not trigger immediate deletion — it just stops the activity clock. The 24h / 7d windows still apply.

## Submitted handoffs — qualified or referred-out

A handoff with verdict `qualified` (the visitor is a fit for Swoop) or `referred_out` (the visitor is better served by a partner) carries contact details that Swoop's specialists need for follow-up.

- **Retention**: 12 months from the moment the handoff was submitted, **or** until the record is ingested into Swoop's CRM, whichever is sooner.
- **Reason for the limit**: gives the sales team a long-enough window for follow-up rounds without keeping personal data longer than the original purpose justifies.

After ingestion, the CRM's own retention rules govern. Once the CRM holds the record, the Puma copy is deleted.

## Submitted handoffs — disqualified

A handoff with verdict `disqualified` does not carry contact details and is not sent to the sales inbox. The record exists only for service-quality analytics — to help us understand which conversations didn't fit so we can tune the assistant.

- **Retention**: 90 days, then deleted.

## Operational logs

The assistant emits structured event logs (conversation opened, tool called, handoff submitted, etc.) into Google Cloud Logging. These are operational, not content-bearing — they don't include message text, and they don't include personal data beyond a session id.

- **Retention**: 30 days in Cloud Logging by default. A subset is mirrored into BigQuery for longer-term analytics, with personal data stripped at the export step.

## Deletion on request

A visitor can ask Swoop to delete their conversation or handoff record at any time, ahead of the windows above. The data-deletion runbook covers the operator-side process. Email **privacy@swoopadventures.co**.
