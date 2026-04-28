# Data-deletion runbook

## Purpose

This runbook is the manual procedure for honouring a GDPR Article 17 (right-to-erasure) request from someone who used the Swoop chat tool. Use it when a request lands at `privacy@swoop-adventures.com` (or whichever inbox Swoop has nominated for privacy correspondence) asking that their data be removed.

The procedure deletes the visitor's durable handoff record(s) from the Puma handoff store. Conversation logs are retained separately — see "Edge cases" below.

The tool stores two kinds of data tied to an identifiable visitor:

1. **Handoff records** — JSON files (interim) or Postgres rows (post-IAM) containing name, email, contact preference, conversation context, and consent flags. One record per submitted handoff.
2. **Conversation events** — structured events emitted to Cloud Logging (turn counts, tool calls, triage verdicts, error surfaces). Visitor PII may appear in free-text fields.

This runbook covers (1) in full and points at (2).

## Before you begin

You need:

- The visitor's email address as supplied in the request.
- The request reference (your ticket id, email message-id, or whatever your privacy ledger uses).
- Verification that the requester is the data subject. Confirm via reply-from-the-known-address, or any documented identity-check process Swoop uses for privacy requests. Do not act on an unverified request.
- SSH (or `gcloud compute ssh`) access to the orchestrator host. While the interim file-backed store is in use, this is the VM or pod running the `@swoop/orchestrator` service.
- Once the Postgres swap lands: `psql` access to the Cloud SQL instance and credentials for the application database role with `DELETE` on the `handoff` table.

## Procedure — interim (`FsHandoffStore` filesystem backend)

The current store writes one JSON file per handoff under the orchestrator package's `var/handoffs/` directory. Each file is named `<handoffId>.json` and contains the full `HandoffPayload`.

### 1. Locate the store directory

The path is logged at orchestrator boot — look for the line `handoff store: file-backed at <path>`. On a standard deploy this is:

```
<orchestrator-package-root>/var/handoffs/
```

Change into that directory:

```
cd <orchestrator-package-root>/var/handoffs
```

### 2. Find records by email

```
grep -l '"email": "visitor@example.com"' *.json
```

Replace `visitor@example.com` with the email from the request. The pattern matches the `contact.email` field as written by `JSON.stringify(payload, null, 2)` (two-space indent, space after the colon).

`grep -l` prints filenames only. Expect zero, one, or several results — see "Edge cases" if multiple.

If you get nothing back, also try a case-insensitive variant:

```
grep -li '"email": "visitor@example.com"' *.json
```

Email comparison under GDPR is case-insensitive on the local part in practice; the visitor may have typed it differently from how the request was filed.

### 3. Verify each match

Before deleting, open each matched file and confirm it is the right record:

```
cat <handoffId>.json
```

Check `contact.email`, the conversation timestamps under `session`, and `verdict`. If anything looks off (wrong domain, payload corrupted, email appears only inside conversation context rather than the contact block), stop and escalate — see "Compliance contacts".

### 4. Delete

```
rm <handoffId>.json
```

The store is filesystem-only with no replicas; once the file is gone, the record is gone. There is no soft-delete tier and no in-band undo.

If multiple files matched, repeat for each.

### 5. Record the deletion

See "Audit log" for the schema. Log it before you close the ticket.

## Procedure — post-IAM (`PostgresHandoffStore` backend)

Once the Cloud SQL Postgres swap lands (deferred from E.t2; tracked in `next-steps.md`), this section gets the real procedure. Outline:

```sql
-- Find candidates first.
SELECT handoff_id, contact_email, created_at, verdict
FROM handoff
WHERE contact_email = $1;

-- Verify each row before deleting.

-- Delete.
DELETE FROM handoff WHERE contact_email = $1;
```

Use bound parameters (`$1`, prepared statements, or your client's parameter syntax). Do not interpolate the email into the SQL string — even in a one-shot privacy procedure, an unsanitised quote in an email address corrupts the query.

This section will be authored in full when the Postgres backend lands. Until then, treat it as a placeholder.

## Audit log

Per deletion, record:

- **Timestamp** of the deletion (UTC, ISO-8601).
- **Request reference** — the ticket id, message-id, or whatever you used in step "Before you begin".
- **Handoff id(s)** deleted. Just the ids, not the payload.
- **Operator** — your name or username.
- **Verification method** — how you confirmed the requester is the data subject (e.g. "replied from the email address on the record", "matched the booking reference they quoted").

Do **not** record the visitor's email address in the audit log. The whole point of the deletion is that we no longer hold their personal data; logging it here would defeat the purpose. The handoff id is sufficient evidence that a specific record was removed.

The ledger lives Swoop-side — pick one home and stick to it. Options: a privacy-requests sheet, a row in the GRC tool, a ticket-system field. Whichever you pick, it is the durable record of what was deleted and when.

## Edge cases

### Multiple handoffs for one email

A visitor can use the chat several times. Each successful submission writes its own record with its own handoff id. Step 2 may return more than one filename. Delete all of them in step 4 unless the visitor's request scopes the erasure (e.g. "only my enquiry from last week"). Default is delete-all, since the request is for the data subject as a whole.

### Plus-addressed and aliased emails

A visitor may have entered `visitor+swoop@example.com` and now request erasure as `visitor@example.com`, or vice versa. The strict `grep` from step 2 will miss this.

If the request gives you reason to believe the visitor used aliases:

```
grep -l '"email": "visitor.*@example.com"' *.json
```

Then verify each match in step 3 carefully — `visitor.foo@example.com` is a different person from `visitor+foo@example.com`. Only delete records the requester actually owns. If unsure, ask the visitor to confirm the exact address(es) they used.

### Visitor cannot remember when they used the chat

Not a blocker. The interim store has no per-record retention cap (E.t6 retention enforcement is not yet wired), so all historical records are still searchable by email. Skip date-bounding and follow the procedure as written.

### Email partially matches inside conversation context

The handoff payload may contain conversation snippets. If a visitor pasted someone else's email into the chat, that string can appear in a record that doesn't belong to them. Step 3 (verify) catches this — only delete records where the matched email is in the `contact.email` field, not in conversation context fields. If you find a record where the email appears only in conversation context, leave it; that record belongs to a different visitor.

### Conversation logs in Cloud Logging

The handoff store is the canonical home for visitor PII, but conversation events emitted to Cloud Logging may also contain it (see chunk F observability). Those logs have a separate retention policy (30 days default in Cloud Logging, longer if exported to BigQuery) and a separate deletion procedure:

- Filter logs by sessionId or by free-text email match in the orchestrator's log scope.
- Delete matching entries via `gcloud logging` (`gcloud logging logs delete <log-name>` is too coarse; the operational pattern is to filter, export the matched entries for evidence, then delete-by-filter).

The full procedure for log-side erasure lives with whoever operates Swoop's GCP project. It is out of scope for this runbook. If a request requires it, coordinate with Swoop's GCP operator.

## Verification

After step 4, re-run the search from step 2:

```
grep -l '"email": "visitor@example.com"' *.json
```

Expected output: nothing. If filenames still come back, repeat step 4 on the remaining matches.

If you used the case-insensitive or alias-broadened variants, re-run those too. Anything still matching either belongs to a different person (verify in step 3 again, do not delete) or was missed (delete it, log it).

## Compliance contacts

Escalate if:

- The request is unusual (third-party requester, scope unclear, identity unverified after first attempt).
- A matched record's contents look inconsistent (corrupted JSON, fields you don't recognise).
- The deletion would conflict with a legal hold you've been told about.
- The requester disputes that you have completed the deletion.

Escalate to: Swoop legal counsel. (Specific name and contact to be added before M5 sign-off.)

For technical issues with the store itself (filesystem permissions, Postgres connectivity, missing logs), escalate to whoever holds the orchestrator-operations on-call rota. For Puma's first deploy this is Swoop in-house engineering — Thomas Forster or Richard.
