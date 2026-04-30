# 03 — Execution: E.t2 + E.t3 — Durable handoff store + verdict-aware email delivery

**Status**: Tier 3 execution plan, post-hoc record. Drafted 2026-04-28 after the work shipped, so future sessions can reconstruct what's wired vs what's parked.
**Chunk**: E (handoff & compliance).
**Tasks**: t2 (durable handoff store) + t3 (verdict-aware email delivery + consent flow end-to-end).
**Implements**: `planning/02-impl-handoff-and-compliance.md` §2.4 + §2.5 + §2.3 (consent backstop).
**Depends on**: E.t1 (handoff payload contracts + `HandoffSubmitConsentGate`); B.t1a (`@swoop/connector` workspace shell + workspace deps).
**Produces**: A working end-to-end submit pipeline — visitor click → enriched payload → durable record → verdict-aware email (off-by-default). Consent backstop honoured. Observability event emitted.
**Unblocks**: M3 deployability (once Julie confirms SMTP + sales inbox); E.t4–t9 follow-ups (legal copy, retention, runbook, compliance bundle, legal review).
**Estimate**: shipped over 2026-04-28; ~3 hours of focused work end to end.

---

## Purpose

E.t1 (2026-04-24) shipped the handoff payload schema as the wire contract. E.t2 + E.t3 turn that contract into a working flow: persist the record, send the verdict-aware email, surface the result to the visitor without dragging it through the chat SSE.

Two pragmatic choices shape the implementation:

1. **`FsHandoffStore` as interim** in place of the durable backend (Cloud SQL Postgres per E.10 + C.18 + C.23 — the original Firestore target was dropped project-wide). Same `HandoffStore` interface; one new class swaps in when GCP IAM lands. Decision **E.12**.
2. **Direct `POST /handoff/submit` HTTP endpoint** on the orchestrator over MCP-tool-call routing. Decision **E.13**.

Plus a side decision (**E.14**) keeping payload enrichment server-side rather than pre-bundling on the client.

---

## Deliverables — code

### Connector workspace (`@swoop/connector`)

| File | Role |
|---|---|
| `product/connector/src/handoff/template-renderer.ts` | Tiny `{{path.to.field}}` substituter, ~30 lines, no deps. Walks dotted paths. Renders missing values as empty string. |
| `product/connector/src/handoff/mailer.ts` | Verdict-aware send via nodemailer. Builds the transporter on demand from injectable `MailerDeps`; reads template files; pre-formats arrays into top-level keys via `preparePayloadForTemplate`. Returns a discriminated `SendResult { status: 'sent' \| 'skipped' \| 'failed', ... }`. |
| `product/connector/src/handoff/store.ts` | `HandoffStore` interface + `FsHandoffStore` reference impl. Atomic writes, filename-safety regex, schema-validated round trip on read, `list()` for dev. |
| `product/connector/src/handoff/submit.ts` | `submitHandoff(payload, deps)` — schema validate → consent backstop → store save → mailer call. Single point of side-effect. |
| `product/connector/src/index.ts` | Barrel export of `submitHandoff`, `sendHandoffEmail`, `FsHandoffStore`, `HANDOFF_ID_PATTERN`, plus types. |
| `product/connector/package.json` | Workspace dep on `@swoop/common`; new deps: `nodemailer`, `zod`; new dev deps: `@types/node`, `@types/nodemailer`, `vitest`; scripts `build` + `test` + `typecheck`. |
| `product/connector/tsconfig.json` | NodeNext / NodeNext + `types: ["node"]` to match orchestrator. |

### Connector tests

| File | Coverage |
|---|---|
| `product/connector/src/handoff/__tests__/template-renderer.test.ts` | 9 cases: substitution, dotted paths, missing values, whitespace, primitive coercion, multiple substitutions, array stringification. |
| `product/connector/src/handoff/__tests__/mailer.test.ts` | 13 cases: skip behaviours (disabled / disqualified), qualified happy path, referred_out routing + recipient fallback, failure modes (template read, smtp send), payload preparation (arrays, wishlist, marketing label). |
| `product/connector/src/handoff/__tests__/store.test.ts` | 13 cases: save round-trip + idempotence, directory auto-create, filename safety, get failure modes (missing / malformed / schema-invalid), list filtering, `HANDOFF_ID_PATTERN` sanity. |
| `product/connector/src/handoff/__tests__/submit.test.ts` | 11 cases: per-verdict happy paths, payload_invalid, consent_missing branches (each flag), store_failed, mailer-disabled propagation. |

### CMS templates

| File | Role |
|---|---|
| `product/cms/templates/handoff/qualified.md` | Plain-text body for verdict=qualified; `{{path.to.field}}` placeholders. |
| `product/cms/templates/handoff/referred-out.md` | Plain-text body for verdict=referred_out; lighter framing. |

(`disqualified` produces no email per E.3.)

### Shared types (`@swoop/common`)

| File | Change |
|---|---|
| `product/ts-common/src/handoff.ts` | Added `HandoffSubmitRequestSchema` (HTTP wire shape between widget and orchestrator) and `HandoffSubmitResponseSchema` (typed success/failure shape). Both `.strict()`-validated. |

### Orchestrator wiring

| File | Change |
|---|---|
| `product/orchestrator/src/server/handoff-submit.ts` | New route handler. Validates body against `HandoffSubmitRequestSchema`, looks up session, verifies tier-1 consent, enriches into a full `HandoffPayload`, delegates to `submitHandoff()` from `@swoop/connector`, emits `handoff.submitted`, returns typed `HandoffSubmitResponse`. |
| `product/orchestrator/src/server/index.ts` | `BuildServerDeps` accepts optional `handoffStore` + `mailerConfig`. When both supplied, registers `POST /handoff/submit`. Otherwise the route is silently absent — keeps server-only tests focused. |
| `product/orchestrator/src/index.ts` | Boot wiring: instantiate `FsHandoffStore` at `<packageRoot>/var/handoffs/`; build `MailerConfig` from env; pass both to `buildServer`. New boot-log lines naming the store path + mailer enabled-state. |
| `product/orchestrator/src/config/schema.ts` | New env vars: `HANDOFF_EMAIL_ENABLED` (boolean, default false), `HANDOFF_EMAIL_FROM`, `HANDOFF_EMAIL_TO_QUALIFIED`, `HANDOFF_EMAIL_TO_REFERRED_OUT`, `HANDOFF_TEMPLATES_DIR` (default `../cms/templates/handoff`), `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (465), `SMTP_SECURE` (true), `SMTP_USER`, `SMTP_PASS`. Cross-field refine: when `ENABLED=true`, `FROM` + `TO_QUALIFIED` + `SMTP_USER` + `SMTP_PASS` are all required at startup. Derived field `handoffTemplatesDirAbsolutePath`. |
| `product/orchestrator/.env.example` | Documents the new env vars + the cross-field refine. |
| `product/orchestrator/package.json` | Added `@swoop/connector` workspace dep. Removed `nodemailer` + `@types/nodemailer` (now connector's concern). |

### Orchestrator route test

`product/orchestrator/src/server/__tests__/handoff-submit.test.ts` — 9 cases: happy paths per verdict (qualified / referred_out / disqualified), 400 invalid_request, 404 session_not_found, 403 consent_required, 400 invalid_request (verdict=qualified missing contact), 500 store_failed, event-emission assertion.

### UI side

| File | Change |
|---|---|
| `product/ui/src/runtime/handoff-client.ts` | New helper. `postHandoffSubmit(body)` reads sessionId from sessionStorage, POSTs to the orchestrator's `/handoff/submit`, normalises network errors / non-JSON responses into `{ ok: false, reason: 'internal_error', ... }` so callers see one shape. |
| `product/ui/src/widgets/lead-capture.tsx` | Form submit is now `async`. Builds a `HandoffSubmitRequest` (minus sessionId) from the agent's args + form state + tier-2 consent. POSTs via `postHandoffSubmit`. On success: `addResult({ status: 'accepted', handoffId })`, set `submitted=true` so the confirmation card renders. On failure: inline `lead-capture-error` element, form remains usable for retry. Submitting state disables the button + shows "Sending…" label. |
| `product/ui/src/widgets/__tests__/lead-capture.test.tsx` | Mocks `postHandoffSubmit` via `vi.mock`. New cases: POST happens with the right body shape, success flow calls `addResult` with `HandoffSubmitOutput`, failure surfaces `lead-capture-error` and does NOT resolve the tool call. Existing cases (validation, consent gate, marketing opt-in, malformed args) preserved. |

### Repo-level

| File | Change |
|---|---|
| `.gitignore` | New rules: `product/orchestrator/var/`, `product/connector/var/`. Visitor PII never enters git. |

---

## Key implementation notes

### 1. `FsHandoffStore` is intentionally tiny

The whole class is ~80 lines. No locking, no transactions, no compaction. Atomic write (write `<id>.json.tmp`, rename to `<id>.json`) is the only durability concern. POSIX rename is atomic on the same filesystem; that's the property the implementation relies on.

### 2. Filename safety is non-negotiable

`HANDOFF_ID_PATTERN = /^[a-zA-Z0-9_-]+$/` is checked before any fs op in `save()` and `get()`. A handoffId with `..` or `/` bounces with `handoff_id_invalid` and never touches the filesystem. The orchestrator generates ids via `crypto.randomUUID().replaceAll('-', '_')` so legitimate ids always pass; the guard is purely defence in depth.

### 3. Consent backstop runs **before** the store save

`submitHandoff()` ordering: schema-validate → consent backstop → store save → email. Rejected attempts produce no durable record. The audit trail for them lives in chunk F's event log; the store stays an honest "successful handoffs" surface.

### 4. Mailer enabled-state is the only "is the mailer wired up?" signal

Boot logs reflect it explicitly: `handoff mailer: disabled (set HANDOFF_EMAIL_ENABLED=true to flip)` or `…: enabled, sending to …@swoop-adventures.com`. There is no separate "mailer healthy?" probe — the cross-field config refine guarantees that if `ENABLED=true`, the four required values are present, so a misconfigured-but-enabled state is impossible past boot.

### 5. Server-side enrichment, never client-side bundling

`enrichPayload()` in `handoff-submit.ts` is the canonical assembler. Inputs: the request body + the session snapshot. Outputs: a fully-formed `HandoffPayload` ready for `submitHandoff`. Enrichment includes:
- `handoffId` generation (uuid-style).
- Tier-1 consent timestamp pulled from `session.consent.conversation.timestamp` (the lawful-basis source of truth).
- `session.{conversationStartedAt, handoffSubmittedAt, turnCount, entryUrl, rawConversationRef}` derived from session + request entry time.
- Wishlist mapped from `session.wishlist.items` (note: `noted` → `note` field rename across the boundary).
- Visitor profile defaulted to empty arrays + `budgetBand: 'unknown'` until a future agent populates it.

### 6. The widget keeps `addResult` firing

After a successful POST, the widget calls `props.addResult({ status: 'accepted', handoffId })`. This resolves the assistant-ui tool call so the agent's lifecycle finishes cleanly and the next agent turn (if any) sees a sensible result. The shape matches `HandoffSubmitOutputSchema` from `@swoop/common/tools`. On failure, `addResult` is NOT called — the form stays open, the visitor retries, and the assistant-ui tool call remains pending (acceptable; it'll resolve when the visitor either submits successfully or refreshes).

### 7. What this task did NOT do

- **Visitor profile / wishlist enrichment** — defaults until a triage classifier or psych agent populates session state.
- **`handoff_submit` MCP tool** — the agent doesn't call it as a tool; the side-effect is HTTP-driven. If a future MCP client wants to drive handoffs, expose `submitHandoff()` as a tool then.
- **Cloud SQL Postgres swap (E.t2 proper)** — interim FsHandoffStore is intentional; swap when GCP IAM lands. Per E.10 + C.18 + C.23 (Firestore was the original target, dropped project-wide).
- **Visitor-facing copy** — opening-screen, privacy-modal, lead-capture, in-conversation handoff phrasing all still placeholder. Belongs to chunk G + E.t5 (legal copy).
- **Retention enforcement (E.t6)** — no cron, no sweeper. The `var/handoffs/` dir grows forever today.
- **Data-deletion runbook (E.t7)** — not authored.
- **Legal-counsel compliance bundle (E.t8/E.t9)** — not assembled.

---

## Verification

The task is done when:

1. ✅ `npm run typecheck` clean across all five workspaces (`@swoop/common`, `@swoop/orchestrator`, `@swoop/connector`, `@swoop/ui`, `@swoop/harness`).
2. ✅ `npm test` clean: 311+ tests passing — 43 common + 132+ orchestrator + 46 connector + 71 ui + 19 harness.
3. ✅ A POST to `/handoff/submit` with a valid body + tier-1-consented session produces a JSON file under `product/orchestrator/var/handoffs/` and returns `{ ok: true, handoffId, emailStatus: 'skipped', emailReason: 'mailer_disabled' }`.
4. ✅ Same POST with `HANDOFF_EMAIL_ENABLED=true` (and SMTP creds set) sends an email + returns `emailStatus: 'sent'`. (Verified contract via mailer tests; live verification pending Julie's SMTP confirmation.)
5. ✅ `handoff.submitted` event is emitted with the correct payload shape (event-emission test asserts).
6. ✅ Tier-1-missing → 403 `consent_required`. Tier-2-missing in body → schema validation 400. Both consent flags missing at backstop → 422 `consent_missing`. Store failure → 500 `store_failed`. All asserted in route tests.
7. ✅ `var/handoffs/` is gitignored (`.gitignore` lines for both `product/orchestrator/var/` and `product/connector/var/`).
8. ✅ Orchestrator boot logs name the store path + mailer state.

What's still required for E.t3 to be **production**-done:
- Julie confirms sales-inbox + SMTP provider + creds.
- Operator flips `HANDOFF_EMAIL_ENABLED=true` in deploy config.
- Smoke-test in staging produces a real email to a real inbox.

What's required for E.t2 to be **production**-done:
- GCP IAM ("AI Pat Chat") lands.
- Author `PostgresHandoffStore implements HandoffStore` against the Cloud SQL `handoff` table per E.10 + C.18 (the original Firestore target was dropped project-wide in C.23).
- Switch the boot wiring to instantiate it conditionally.

---

## References

- `planning/decisions.md` — entries **E.11** (connector home), **E.12** (FsHandoffStore interim), **E.13** (HTTP endpoint over MCP), **E.14** (server-side enrichment), **E.15** (client-side consent timestamp).
- `planning/02-impl-handoff-and-compliance.md` — Tier 2 chunk-E §2.3–§2.5.
- `product/connector/src/handoff/` — the canonical module.
- `product/orchestrator/src/server/handoff-submit.ts` — the route handler.
- `product/ui/src/runtime/handoff-client.ts` — the UI client helper.
- `chatgpt_poc/product/mcp-ts/src/lib/mailer.ts` — the PoC original (reference only — moved on from the email-body shape).

---

## 2026-04-30 code-review fixes

Source: [planning/reviews/2026-04-30-code-level.md](reviews/2026-04-30-code-level.md). Status legend: 🔲 not started · 🟡 in flight · ✅ landed.

### Sec-1 — File-permission discipline on `FsHandoffStore` — ✅

**Problem**: `connector/src/handoff/store.ts:87` `mkdir(this.dirAbsolutePath, { recursive: true })` uses default umask. `writeFile(tmpPath, JSON.stringify(payload, null, 2))` at `:88` no `mode` — default 0o666 & umask. The directory contains visitor name, email, phone, motivationAnchor and full conversation summary text in cleartext JSON, world-readable on a shared host. GDPR Art. 32 ("appropriate technical measures") would frown.

**Fix shape**: `mkdir(..., { mode: 0o700, recursive: true })` + `writeFile(..., 'utf8')` followed by `fs.chmod(tmpPath, 0o600)` before the rename, OR `writeFile(..., { mode: 0o600 })`. Verify the rename preserves mode bits on the target FS.

**Verification**: store-test asserts `(stat.mode & 0o777) === 0o600` for written files and `0o700` for the dir.

**Commits**: landed 2026-04-30 — `mkdir({ mode: 0o700, recursive: true })` + `writeFile({ mode: 0o600 })` + belt-and-braces `chmod(tmpPath, 0o600)` before rename. New file-mode test in `store.test.ts` asserts both bits via `fs.statSync`.

### Test-2 — Mailer `inconclusive` skip-reason untested — 🔲

**Problem**: `connector/src/handoff/mailer.ts:141-143` returns `{status:'skipped', reason:'verdict_inconclusive'}` for the new 4th verdict. `connector/src/handoff/__tests__/mailer.test.ts` has zero `inconclusive` references. A regression that re-routes inconclusive payloads to the qualified inbox — exactly the GDPR-sensitive bug E.t3 was created to prevent — would not be caught.

**Fix shape**: add a mailer test case feeding `SampleHandoffInconclusive` and asserting `result.status === 'skipped' && result.reason === 'verdict_inconclusive'`. Also add a route-handler integration assertion that the wire response carries `emailReason: 'verdict_inconclusive'` for an inconclusive submit.

**Verification**: `npm test -w @swoop/connector` and `npm test -w @swoop/orchestrator` both gain at least one inconclusive-verdict assertion each.

**Commits**: _(landed: filled when done)_
