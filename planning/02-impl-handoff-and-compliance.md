# 02 — Implementation: E. Handoff & Compliance

**Status**: Tier 2 implementation plan. Draft, 2026-04-22.
**Implements**: Puma top-level plan §4E + themes 8 (observable handoff) + 9 (legal compliance built-in) + 10 (triage-aware).
**Depends on**: A (foundations — `ts-common` handoff payload shape), B (session state holds triage verdict + wishlist), C (`handoff` and `handoff_submit` tools, mailer, Postgres connector for the durable store), D (lead-capture widget + consent UI), G (handoff email template + legal disclosure copy).
**Blocks**: M3 (triage + handoff end-to-end) and M5 (legal sign-off).

---

## Purpose

E owns the moment the conversation converts — or doesn't. It's the chunk that makes Puma *useful to Swoop's sales team*, not just *conversationally nice to visitors*. The surface is narrow: a triage-aware handoff schema, a durable record of every handoff, an email delivery path to the sales inbox, a consent flow, retention policy, disclosure copy, and the legal-counsel-review workflow.

Handoff + compliance live in the same chunk because they are tightly coupled: handoff is where personal data enters the system, and compliance is what governs that entry. Separating them would create seams where things slip.

---

## 1. Outcomes

When this chunk is done:

- A Puma conversation can complete with one of three verdicts — **qualified**, **referred_out**, **disqualified** — each with a structured reason.
- Qualified handoffs deliver an email to Swoop's sales inbox with enough conversational substance that the specialist picks up the thread warm, not cold.
- Every handoff (all three verdicts) writes a durable record to the handoff store (a `handoff` table in our Cloud SQL Postgres — same instance as the retrieval store, single operational surface) with consent flags, verdict, reason, and payload. Retrievable for sales follow-up and later evaluation.
- Consent capture lives inside the `lead-capture` widget; no personal data flows to `handoff_submit` without an explicit consent flag set.
- Disclosure UX (EU AI Act Art. 50) is wired through chunk D as opening state + persistent chrome. Chunk E authors the copy, chunk D renders it.
- Retention TTLs exist for in-progress sessions, submitted handoffs, and logs. Documented runbook covers data-deletion requests.
- Legal-counsel review loop exists: Swoop's counsel receives the compliance surfaces (disclosure copy, consent flow, retention policy, processor disclosures) and signs off. M5 gate.
- Swoop's privacy-policy and related surfaces updated to reference the chat tool (Swoop-owned but coordinated from here).

**Not outcomes**:
- CRM integration (deferred — top-level out-of-scope).
- Full DPIA (data-protection impact assessment) unless Swoop's legal counsel asks for one.
- Multi-jurisdiction compliance beyond EU + UK GDPR (EU AI Act applies extraterritorially; GDPR likewise).
- Automated data-deletion tooling (runbook-driven manual process in Puma).
- Sales-team CRM handoff UI — they get email + durable record, nothing fancier.

---

## 2. Target functionalities

### 2.1 Triage-aware handoff schema

Handoff payload (contract in `ts-common` from chunk A):

- **Verdict**: `qualified` | `referred_out` | `disqualified`
- **Reason**: structured short code + freeform agent rationale
- **Visitor profile**: persona sketch (independence level, budget band, activity inclination, region interest — mapped to the 20 Apr segmentation)
- **Wishlist**: what the visitor gravitated to (trips / tours / regions named, motivations surfaced)
- **Motivation anchor**: the "why" — bucket list, trip of a lifetime, photography, W trail, bragging-rights lodges, etc.
- **Contact** (qualified + referred_out only): name, email, preferred contact method, time zone hint if offered
- **Consent flags**: GDPR consent given (boolean, timestamped), marketing opt-in (boolean, separate), AI-interaction acknowledged (boolean, implicit from disclosure)
- **Session metadata**: session id, conversation start, turn count, entry URL if known
- **Raw conversation reference**: id pointing to the stored conversation — the email summarises, the record preserves

This schema is what chunk G's handoff email template renders against. It's what chunk E's durable store persists. It's what chunk H's evals assert on.

### 2.2 Triage verdict flow

- **`qualified`**: agent has signalled via its `<reasoning>` + structured analysis that this visitor is a handoff-worthy lead. `handoff` tool triggers lead-capture widget; visitor confirms + consents; `handoff_submit` fires; email sent to sales; durable record written.
- **`referred_out`**: visitor is outside Swoop's direct service scope (e.g. <$1k-profit booking per Luke's 20 Apr note) but still deserves a helpful next step. Agent explains and points to partner / self-service resource. `handoff_submit` may still fire with a different email template (or no email) — decided below.
- **`disqualified`**: visitor is clearly out of scope (backpacker-tier with no budget; intentionally off-brand queries; someone using the tool as a proxy to Claude). Agent closes politely. No email to sales. Durable record with verdict for analytics.

Verdict transitions happen inside the agent's reasoning — surfaced via the triage-stance skill (chunk G §2.6) and the session state `triage` field (chunk B §2.6). Chunk E doesn't *decide* the verdict; it enacts the consequences of the decision once made.

### 2.3 Consent capture — two tiers

GDPR requires a lawful basis for processing personal data. Puma stores conversation data (user messages, agent responses) in session state the moment a visitor starts typing. **Storage begins before handoff**, so consent must too — otherwise we have no lawful basis for the conversation layer itself. Puma takes the conservative-and-simple stance: **consent up front to chat, then a second, more specific consent at handoff for contact-detail submission.**

**Tier 1 — Primary consent (conversation start, paired with AI disclosure):**
- Presented on first visit, before the first user message can be sent.
- Copy (rough — chunk E's `product/cms/legal/disclosure-opening.md` authors the real version, legal counsel reviews): "You're talking to an AI assistant, not a human. We'll keep a record of this conversation to help our specialists understand what you're looking for. [Privacy info link.] [Continue] [No thanks]."
- `Continue` → `session.consent.conversation = true` with timestamp + rough version id of the consent copy. Conversation proceeds.
- `No thanks` → no session state written; the chat closes cleanly. No conversation, no storage.
- This tier covers the GDPR lawful basis for storing + processing conversation history.

**Tier 2 — Handoff consent (at handoff submission):**
- Inside the lead-capture widget (chunk D §2.4), before `handoff_submit` fires.
- **Required tick-box**: "I consent to Swoop contacting me about this enquiry and storing my contact details for that purpose." Copy in `product/cms/legal/consent-handoff.md`.
- **Optional tick-box** (separate): "I'm happy to receive occasional Swoop travel updates." Marketing opt-in, unticked by default.
- `session.consent.handoff = true` with timestamp on successful submit.
- This tier covers the specific act of contact-detail submission + outreach.

**Backstops**:
- Chunk D won't allow the chat to begin without tier 1 consent.
- Chunk C's `handoff_submit` hard-rejects any payload where `consent.conversation !== true` AND `consent.handoff !== true`. Belt and braces.

**GDPR stance rationale**: technically, legitimate-interest processing *could* cover some conversational storage without explicit consent. But for a chatbot where users freely volunteer personal info (names, destinations, email addresses, budgets) in messages, explicit consent is the cleanest lawful basis and avoids the proportionality-assessment work legitimate interest requires. For Puma, explicit-consent-upfront is the default.

### 2.4 Durable handoff store

**Status (2026-04-28)**: shipped as an interim file-backed implementation; **Cloud SQL Postgres swap** deferred to post-IAM (per decisions **E.10** and **C.23**, which together replaced the original Firestore swap target). Decision **E.12** documents the interim shape.

Interface lives at `@swoop/connector/src/handoff/store.ts`: `HandoffStore { save, get, list }`, keyed by `handoffId`. The eventual `PostgresHandoffStore` will implement the same interface; caller code (`submitHandoff`, the route, the tests) sees no change at swap time. Single-store posture per C.18: the handoff table sits in the same Cloud SQL Postgres instance as the retrieval derived store and (post-M4) the Postgres `SessionService`.

**Post-interim shape** (per E.10 + C.18): a `handoff` table in Cloud SQL Postgres. Keyed by handoff id (UUID). Columns:
- The full handoff payload (§2.1) — JSONB column for the structured fields, plus typed columns for hot-query fields (verdict, reason code, region, created-at)
- Timestamps (conversation start, handoff submission, email delivery)
- Delivery status (email sent / bounced / deferred) as an enum
- Retention metadata (created-at, scheduled-deletion-at)
- Consent flags (tier-1 + tier-2 + version of copy seen)

The `HandoffStore` interface stays for swap-out optionality, but Cloud SQL Postgres is the committed default — Firestore / Cloud Storage JSON / BigQuery alternatives are no longer in scope (per C.23).

Today's implementation is `FsHandoffStore` — file-backed JSON under `<orchestrator-package-root>/var/handoffs/<handoffId>.json`. Atomic write via tmp-file-rename. Filename safety guarded by `^[a-zA-Z0-9_-]+$` regex (path-traversal defence). Schema-validated round-trip on `get()` so a corrupted record can't bleed into runtime code. Directory ignored in `.gitignore` so visitor PII never enters the repo.

Post-interim implementation: `PostgresHandoffStore` writing to a `handoff` table in our Cloud SQL Postgres instance (per E.10 + C.23 — Firestore was the prior target but is dropped). Same interface; one new class file; one config flip at boot. Single-store with retrieval (C.18) and post-M4 sessions (B.22).

Write path: the connector's `submitHandoff()` is the writer. Triggered today via the orchestrator's `POST /handoff/submit` route (decision **E.13**). Idempotent on `handoffId` (last-write-wins), verdict-aware, consent-gated (decision **E.4** + the backstop in `submitHandoff()`).

### 2.5 Email delivery

**Status (2026-04-28)**: shipped, off by default behind `HANDOFF_EMAIL_ENABLED=false`. Mailer code, two templates, and the verdict-aware send path are in production-ready shape; the master switch flips when Julie confirms sales-inbox + SMTP creds.

Templates live at `product/cms/templates/handoff/{qualified,referred-out}.md` (one per verdict that ships email; `disqualified` produces no email per E.3). Rendered against the `HandoffPayload` via the tiny `{{path.to.field}}` substituter at `@swoop/connector/src/handoff/template-renderer.ts`. Plain-text body. Subject line generated server-side from verdict + reason code.

Sent via SMTP (nodemailer). Transport options come from env: `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (465), `SMTP_SECURE` (true), `SMTP_USER`, `SMTP_PASS`. Cross-field config refine: when `HANDOFF_EMAIL_ENABLED=true`, `HANDOFF_EMAIL_FROM` + `HANDOFF_EMAIL_TO_QUALIFIED` + `SMTP_USER` + `SMTP_PASS` are all required at startup or boot fails.

- **`qualified`**: full handoff email to `HANDOFF_EMAIL_TO_QUALIFIED`. Verbose, quotes the visitor's reason text + motivation anchor.
- **`referred_out`**: lighter email to `HANDOFF_EMAIL_TO_REFERRED_OUT` (falls back to `HANDOFF_EMAIL_TO_QUALIFIED` if blank — common-case at launch with one inbox + subject-prefix differentiation).
- **`disqualified`**: no email; durable record only.

SMTP provider TBC pending Julie. Default assumption: a transactional provider if Swoop has one (Postmark / SES / Mailgun); fallback Gmail-via-app-password for Phase 1 dev. Defaults in env-example are Gmail-shaped so dev works out of the box if `SMTP_USER` / `SMTP_PASS` are app-password-style.

### 2.6 Disclosure + consent copy

Authored here, rendered by chunk D. Lives in `product/cms/legal/`:

- `disclosure-opening.md` — one-screen message shown on first visit, **paired with primary (tier 1) consent**. AI disclosure + conversation-data consent + Continue / No thanks controls. This single screen must satisfy both EU AI Act Art. 50 disclosure and GDPR primary consent for conversation processing.
- `disclosure-chrome.md` — the persistent tag copy. Short. "AI assistant · [info link]".
- `consent-handoff.md` — the tier 2 tick-box label at the point of handoff submission (contact details + outreach).
- `consent-marketing.md` — the optional opt-in label.
- `privacy-info.md` — a more detailed "what happens with your data" page, linked from both consent screens. Covers retention, data processors (Anthropic, GCP), right-to-deletion, contact for questions.

Legal counsel reviews all of these. Al drafts under Swoop's brand voice; Swoop's counsel signs off.

### 2.7 Retention policy

- **In-progress sessions**: TTL 24h idle → archived (read-only), TTL 7 days archived → deleted. Matches chunk B §2.6.
- **Submitted handoffs (`qualified` / `referred_out`)**: retained indefinitely unless the visitor requests deletion (GDPR right-to-erasure). Swoop's CRM lifecycle is the longer-term governor — Puma keeps the handoff until it's ingested into the CRM or until 12 months, whichever is sooner.
- **Submitted handoffs (`disqualified`)**: retained 90 days for analytics, then deleted.
- **Logs** (chunk F's events): retained 30 days in Cloud Logging by default. Longer retention via BigQuery export (chunk F).

Policies documented in `product/cms/legal/retention.md`. Enforcement is Tier 3 work — a Cloud Run Job runs a parameterised SQL `DELETE … WHERE scheduled_deletion_at < NOW()` against the Postgres `handoff` table on a daily schedule.

### 2.8 Data-deletion runbook

GDPR right-to-erasure. Per-request manual process in Puma:
1. Swoop receives a deletion request at a documented contact (privacy contact in Swoop's privacy policy).
2. The recipient runs a documented script (or `psql`/console SQL query against the Cloud SQL `handoff` table) to find the handoff record by email address.
3. Record is deleted from the Postgres `handoff` table; raw conversation (if stored) purged from the same database.
4. Deletion is logged (with minimal metadata — confirmation, not content).

Runbook lives at `product/cms/legal/runbooks/data-deletion.md`. Swoop-operated post-handover.

### 2.9 Legal counsel review workflow

- Swoop's legal counsel receives a compliance bundle: disclosure copy, consent flow (with screenshots), retention policy, processor list (Anthropic, Google Cloud), DPAs (Anthropic and GCP — standard terms), data flow diagram.
- Review loop: Swoop-driven; SLA unknown (tracked in `questions.md`).
- M5 blocks on sign-off.

Al's framing from the 30 Mar proposal: "I handle this simply; available to work with your legal team if they want to go further." E provides the bundle; E doesn't replace legal counsel.

---

## 3. Architectural principles applied here

- **Observable handoff** (theme 8): three verdicts with reasons, not binary. Enables sales feedback + prompt iteration.
- **Legal compliance built-in** (theme 9): compliance surfaces are code chrome + wired data flow, not a policy document stapled on.
- **Triage-aware** (theme 10): the schema and flow make triage a first-class conversation outcome, not a failure mode.
- **Content-as-data**: all legal copy, consent text, email template lives in `product/cms/`. Legal counsel can review copy without touching code.
- **Swap-out surfaces named**: handoff store backend (**Cloud SQL Postgres default per E.10 + C.18**; low swap via the `ts-common` `HandoffStore` interface if a different backend is ever justified), SMTP provider (low swap — nodemailer abstracts).

---

## 4. PoC carry-forward pointers

- `chatgpt_poc/product/mcp-ts/src/lib/mailer.ts` — nodemailer + SMTP pattern. Evolves (new target inbox, new template, verdict-branching) but the skeleton is reused.
- `chatgpt_poc/product/ui-react/src/widgets/lead-capture/` — lead-capture widget. Carries forward with two changes: consent UI added, submission hits `handoff_submit` via the new agent flow.
- `chatgpt_poc/product/ts-common/src/tools.ts` (`handoff`, `handoff_submit` sections) — tool descriptions and I/O shapes. Evolve for triage-awareness.
- `planning/archive/03-handoff-schema.md` — exists but under-specified in the archived form. A reference, not a template.

---

## 5. Decisions closed in this chunk

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| E.1 | Handoff store backend | **Cloud SQL Postgres** (`handoff` table in the same instance as the retrieval store, per E.10 + C.18). Behind a `ts-common` `HandoffStore` interface for swap-out, but no other backend is currently in scope. Firestore dropped per C.23. | Single-store wins on operational simplicity for Swoop's team (one DB to back up, monitor, IAM-scope), enables ad-hoc SQL analytics on handoff data, and consolidates everything we own derived-side into one Postgres instance. |
| E.2 | `referred_out` email behaviour | **Default: lightweight email to a distinct inbox (or the sales inbox with a subject prefix). Tier 3 decides exact split with Julie.** | Sales still wants visibility but not the same treatment as qualified. |
| E.3 | `disqualified` email behaviour | **No email. Durable record only.** | Sales doesn't need notification; analytics and post-launch prompt tuning consume the record. |
| E.4 | Consent model | **Two tiers: primary (conversation start, paired with AI disclosure) + secondary (handoff contact details + outreach, inside lead-capture widget).** Marketing opt-in is a third separate and unticked by default. | Conversation data enters session state immediately — GDPR lawful basis required at that point, not just at handoff. Explicit consent up front is the simplest, cleanest GDPR posture for a chatbot that freely receives PII in messages. Legitimate-interest alternative avoided for Puma. |
| E.5 | SMTP provider | **Pending Julie.** Default assumption: transactional provider (Postmark / SES / Mailgun) if Swoop has one; else Swoop's own SMTP; fallback to Gmail-via-app-password for Phase 1 dev only. | Tracked in `questions.md`. Interface abstracts. |
| E.6 | Retention — `qualified` / `referred_out` handoffs | **12 months or until CRM ingestion, whichever sooner.** | Balances sales follow-up window with GDPR data-minimisation. Swoop-side CRM lifecycle is the ground truth. |
| E.7 | Retention — `disqualified` handoffs | **90 days.** | Enough for analytics, not more. |
| E.8 | Retention — in-progress sessions | **24h idle → archive; 7d archive → delete.** | Matches chunk B §2.6. |
| E.9 | Data-deletion process | **Manual runbook, Swoop-operated post-handover.** No automated self-service UI in Puma. | Traffic volume doesn't justify a self-service UI yet. |
| E.10 | Legal counsel engagement | **Swoop-driven review loop. Al provides the compliance bundle; Swoop's counsel signs off.** | 30 Mar proposal framing; SLA pending (`questions.md`). |
| E.11 | Handoff side-effects home | **`@swoop/connector` workspace.** Mailer + store + `submitHandoff()` orchestration live there. Orchestrator imports as a workspace dep. | Architecturally correct: connector owns data + side-effects, orchestrator owns the agent loop. Initial placement in orchestrator was a transient artefact of the empty-workspace state; relocated 2026-04-28. |
| E.12 | Durable store implementation | **`FsHandoffStore` interim; `PostgresHandoffStore` is the swap target** (per E.10 + C.23, which superseded the original Firestore target). Both implement the same `HandoffStore` interface in `@swoop/connector/src/handoff/store.ts`. | E.1 originally named Firestore; GCP IAM blocked on Thomas, so we shipped a tiny file-backed implementation behind the same interface to unblock E.t3+t4. Subsequent E.10 + C.23 (also 2026-04-28) flipped the swap target to Cloud SQL Postgres for single-store consolidation. Caller code is invariant either way. Decided 2026-04-28. |
| E.13 | Widget submit path | **Discrete `POST /handoff/submit` HTTP endpoint on the orchestrator.** Widget POSTs the form + agent's tool-call args; route enriches against session state and delegates to `submitHandoff()` from `@swoop/connector`. The widget then resolves the assistant-ui tool call locally with `HandoffSubmitOutput`. | Rejected: (a) "agent calls handoff_submit as another tool on the next turn" wastes an LLM call + adds latency; (b) "intercept the addResult inside the chat SSE handler" tangles two lifecycles. Direct HTTP is the cleanest separation: form submission is a discrete action, not a chat turn. Tested in isolation (`handoff-submit.test.ts`). Decided 2026-04-28. |
| E.14 | Payload assembly | **Server-side enrichment from session state, not client-side bundling.** The widget sends only what it has (agent args + form contact + tier-2 consent + sessionId); the route handler builds the full `HandoffPayload` by enriching against the session snapshot (handoffId, tier-1 timestamp, conversation start, turn count, wishlist, entry URL). | Single source of truth, no widget-tampering surface, no staleness if session state evolved post tool-trigger. Wire shape (`HandoffSubmitRequestSchema`) is `.strict()` — extra fields rejected. Decided 2026-04-28. |
| E.15 | Tier-2 consent timestamp | **Captured client-side at the moment of submit (`new Date().toISOString()` before POST).** Server takes the value into the durable record verbatim. | The timestamp encodes the visitor's *intent* (the click), not the server's processing time. GDPR audit posture is "when did the visitor consent". `session.handoffSubmittedAt` is the complementary server-time field. Decided 2026-04-28. |

Deferred:
- Cohort-level deletion (e.g. "delete all handoffs before date X") — runbook handles.
- Data-subject-access-request tooling — handled via the runbook.
- Audit log of data access — Cloud Logging covers indirectly.
- Anonymisation of retained records past the TTL — simpler to delete.

---

## 6. Shared contracts consumed and produced

Consumed:
- `ts-common` handoff payload shape (A stubs; E finalises the verdict / consent / reason fields).
- Session state shape (reads `triage` field + `wishlist` accumulator from B).
- Tool I/O for `handoff` and `handoff_submit` (from A, evolved with C).

Produced:
- Compliance bundle (markdown + screenshots) for legal counsel review. External artefact.
- Data-deletion runbook. External artefact for Swoop handover.

---

## 7. Open sub-questions for Tier 3

- `referred_out` email recipient and template variant — Julie (`questions.md`).
- SMTP provider specifics (`questions.md`).
- Consent text wording for `disclosure-opening` and `consent-handoff` — legal counsel input expected.
- Exact retention enforcement mechanism: scheduled Cloud Run Job running `DELETE … WHERE scheduled_deletion_at < NOW()` against the Postgres `handoff` table is the planned path; revisit if Postgres' built-in `pg_partman` partition rotation makes more sense at scale.
- Handoff id scheme (uuid vs sequential vs sortable time-based).
- Idempotency key on `handoff_submit` — protect against double-submit on widget retry.
- Structured reason codes for the verdict — taxonomy decided with Al / Luke during Tier 3 (fits naturally into the HITL flow mapping from chunk G.t0).
- Whether the privacy-info page is hosted inside the chat UI or links out to Swoop's existing privacy page.
- Legal review SLA and who owns chase-ups (`questions.md`).

---

## 8. Dependencies + coordination

- **Inbound**:
  - Chunk A's `ts-common` handoff payload stub + compliance event schema stub.
  - Chunk B's session state holding triage + wishlist fields.
  - Chunk C's `handoff_submit` tool implementation (writes to the handoff store; sends email).
  - Chunk D's lead-capture widget integration + consent UI.
  - Chunk G's handoff email template + legal copy.
  - Swoop's sales inbox address + SMTP credentials (`questions.md`).
  - Swoop's legal counsel review (`questions.md`).
- **Outbound**:
  - Chunk F logs handoff events for analytics.
  - Chunk H asserts on triage correctness and handoff timing.
- **Agent coordination**:
  - The handoff payload shape is the contract across A/B/C/E/G. Finalise early during Phase 0 contract work; amendments go through `ts-common` PRs with CI catching consumers.

---

## 9. Verification

Chunk E is done when:

1. A conversation that clearly qualifies produces a handoff email in the sales inbox with all payload fields, formatted via the chunk G template.
2. A conversation that qualifies writes a durable record to the Postgres `handoff` table, retrievable by handoff id.
3. A conversation that triggers `referred_out` produces the expected email (or none) per E.2 and writes a record.
4. A conversation that triggers `disqualified` writes a record and produces no email.
5. `handoff_submit` rejects a payload where either `consent.conversation !== true` OR `consent.handoff !== true` (two-tier backstop).
6. The disclosure+primary-consent opening screen is visible on every first visit; declining closes the chat cleanly with no session state written.
7. The persistent chrome disclosure tag is always visible during the conversation.
8. Secondary consent capture UI requires the handoff tick-box before submission.
8. A data-deletion runbook exists, documented enough for a Swoop engineer to execute without further guidance.
9. Retention enforcement works end-to-end for a simulated expired record.
10. Legal counsel has the compliance bundle and has started review.
11. Every piece of legal or sales-facing text is loaded from `product/cms/`; zero hardcoded strings in code.

---

## 10. Order of execution (Tier 3 hand-off)

- **E.t1 — Handoff payload + schema finalisation**: ✅ shipped 2026-04-24. Verdict codes, consent fields, reason taxonomy in `@swoop/common/handoff`. See `planning/03-exec-handoff-t1.md`.
- **E.t2 — Durable handoff store**: ✅ shipped 2026-04-28 as **interim** (`FsHandoffStore` file-backed). **Cloud SQL Postgres swap** deferred until GCP IAM lands per E.10 + C.23 (Firestore originally planned, dropped); same `HandoffStore` interface ready for the new `PostgresHandoffStore` class. See `planning/03-exec-handoff-t2-t3.md` + decisions **E.10** (Postgres target), **E.12** (interim file-backed).
- **E.t3 — Verdict-aware email delivery**: ✅ shipped 2026-04-28, **off by default** (`HANDOFF_EMAIL_ENABLED=false`). Mailer + templates + `submitHandoff()` orchestration in place. Flips on once Julie confirms SMTP + sales-inbox. See `planning/03-exec-handoff-t2-t3.md`.
- **E.t4 — Consent flow end-to-end**: ✅ functionally shipped 2026-04-28. Tier-1 disclosure already lived in D.t4 + tier-1 backstop in `/chat`; tier-2 consent now captured in lead-capture widget + persisted into the durable record + backstopped in `submitHandoff()`. The end-to-end audit trail (paper trail of which copy version the visitor saw) needs E.t5 (versioned copy files) to fully close.
- **E.t5 — Disclosure + consent copy authoring**: open. `product/cms/legal/` content authoring is Al's editorial work. Today's strings are placeholders inline in the components.
- **E.t6 — Retention enforcement**: open. No cron / sweeper for the handoff store yet. The `var/handoffs/` dir grows forever in dev; needs to swap into a scheduled Cloud Run Job running `DELETE … WHERE scheduled_deletion_at < NOW()` SQL against the Postgres `handoff` table once the Cloud SQL swap lands per E.10 + C.23.
- **E.t7 — Data-deletion runbook**: open. Documented steps for Swoop-operated manual deletion against the durable store backend.
- **E.t8 — Compliance bundle for legal**: open. Packaged disclosure copy, consent flow (screenshots), retention policy, processor list, DPAs, data flow diagram.
- **E.t9 — Legal review coordination**: open; blocks M5.

E.t1 was Phase 0 contract work. E.t2–E.t4 shipped in two waves (E.t1 in wave-1, E.t2/t3/t4 on 2026-04-28). E.t5 starts in parallel with chunk G's content drafting. E.t6–E.t9 come later — E.t9 blocks M5.

Estimated remaining: 1 day for E.t5 (copy), 0.5 day each for E.t6 (retention enforcement, post-IAM) and E.t7 + E.t8 (runbook + bundle), plus elapsed time (not Al-time) for E.t9 legal review and the Postgres swap when IAM lands.
