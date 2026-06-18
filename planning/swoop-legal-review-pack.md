# Swoop Web Discovery Agent: Legal review pack

**Version**: 0.8
**Date**: 2026-06-18
**Audience**: Swoop (internal sense-check), then Swoop legal counsel
**Prepared by**: Alastair Brayne, WhaleyBear Ltd trading as Lope (al@lope.works)

---

## What changed in v0.8 (since v0.7, 2026-06-16)

- **A fourth processor is disclosed.** Google's Gemini API embeds the visitor's search text at runtime, so visitor-derived text reaches Google on the conversation path — a model-provider role, separate from Google Cloud hosting. New decision **D-3.1.10**; processor count is now four.
- **Infrastructure corrected.** The committed shape is a single Google Cloud VM, not Cloud Run + Cloud SQL. Retention, logging and backup claims updated (**D-3.1.3**, **D-3.3.5**).
- **Session-retention enforcement corrected.** Sessions are durable in Postgres with a wired deletion sweep. The prior "in-memory, cleared on restart" description was out of date (**D-3.1.3**).
- **Marketing opt-in fully removed.** Dropped from the form on 2026-06-16; this version finishes the cleanup in the data inventory and the email templates.

---

## How to use, return, and what happens next

This pack puts the outstanding **decisions** (§3) and visitor-facing **copy** (§4) in one place. Decisions carry the *why*, *how*, and *what's required* inline. Every visitor-facing string has an **ID** and a draft.

1. Open in Microsoft Word, enable **Track Changes**.
2. Edit copy in the **Draft** column; leave the **ID** column untouched. Comment against any decision heading or copy ID.
3. Save as `…_legal-review-<date>` and return to Alastair (al@lope.works) or the nominated Swoop contact.

Lope then extracts edits by ID and applies them to the live surface, bumps consent-copy versions where consent-bearing copy changed (audit trail per record), answers any §3 questions in writing, and re-issues at the next version. Once §3 is resolved and §4 approved, counsel signs the final document and launch can proceed.

---

## Contents

1. [What the agent does](#1-what-the-agent-does)
2. [The visitor journey](#2-the-visitor-journey)
3. [Decisions needed from Swoop and counsel](#3-decisions-needed-from-swoop-and-counsel) — §3.1 counsel-only (10), §3.2 confirm-or-amend (6), §3.3 Swoop operational (7)
4. [Copy table](#4-copy-table) — opening screen, chrome badge, privacy modal, lead-capture form, error states, handoff emails
5. [Glossary and related artefacts](#5-glossary-and-related-artefacts)

---

# 1. What the agent does

The agent is an iframe embedded in the Patagonia website. A visitor opens the chat from a nav button and has a short, warmth-led conversation. The outcome is one of: a warm specialist handoff (with conversation context), a referral out (outside service scope), or a polite close.

The agent does **not** build itineraries, quote prices authoritatively, or book trips. Patagonia is the launch scope; later releases extend to other destinations.

### Personal data the agent touches

- **From conversation start** (tier-1 consent): free-form visitor messages (may contain PII at the visitor's discretion); session metadata (id, timestamps, turn count, entry URL); and the browser's IANA **timezone**, sent each turn. The agent **infers coarse region/hemisphere** from the timezone to frame seasonal advice — reasoning over data already held, held as a hint, no new collection and no assertion of the visitor's location back to them.
- **From handoff submission** (tier-2 consent): visitor name, email, optional phone, preferred contact method.
- **Derived**: a structured triage verdict (`qualified` / `referred_out` / `disqualified` / `inconclusive`), reason code, the agent's free-text summary, and a wishlist of trips and regions.
- **Not collected**: no third-party analytics in the chat surface, no fingerprinting, no payment data. Puma persists no visitor IP addresses; host/ingress request logs may capture IPs transiently for security, retained per the deployment's log policy (D-3.1.3). Puma's own event stream stores ids, verdicts and timestamps only — no message text, no contact details.

### Where it runs (data residency)

Puma runs as **one Google Cloud VM (Compute Engine) in Swoop's GCP project** at launch — the orchestrator, connector, and a Postgres database on a single machine. Region to be confirmed; London (`europe-west2`) is the working default (D-3.3.5). The pre-public staging/demo runs the same single-machine shape on a self-hosted Mac in the UK, reached over an encrypted tunnel. The earlier "Cloud Run + Cloud SQL" split is **not** the committed shape — managed services are a scale-up option, not a launch assumption. Where a retention, logging or backup behaviour below depends on the final shape, it is flagged.

### Processors (four)

| Processor | Role | Visitor data it sees |
|---|---|---|
| **Anthropic** | Conversational AI model (Claude) | Full conversation history every turn |
| **Google — Gemini API** | Embeds the visitor's search text for retrieval (**D-3.1.10**) | Visitor-derived query text, at runtime |
| **Google Cloud** | Hosting, storage, logging (the VM + Postgres + logs) | Everything persisted server-side |
| **SMTP provider** | Handoff-email transport (TBC, **D-3.3.1**) | Name, email, conversation summary, on `qualified` / `referred_out` only |

### Lawful basis

**GDPR Article 6(1)(a), explicit consent**, two-tier:

- **Tier 1** at conversation start, paired with EU AI Act Art. 50 AI disclosure. Without it, no session state is written.
- **Tier 2** at handoff: submission-as-consent — clicking *Send* after a clear inline notice is the affirmative act (no tickbox).

Legitimate-interest framing was considered and rejected: a chatbot that freely receives PII in messages reads cleaner under explicit consent.

### Jurisdictional posture

Swoop is UK-established, so **UK GDPR** applies. **EU GDPR** and the **EU AI Act** (Art. 50, enforceable 2 August 2026) are also covered, because UK law generally tracks EU privacy law and Swoop offers services to EU residents. Other jurisdictions where Swoop sells or attracts visitors (US, Brazil, Canada, Australia) need equivalent treatment — see **D-3.1.5**.

---

# 2. The visitor journey

Six surfaces, each mapping to a section in §4.

1. **Opening screen (tier-1)** — first visit, before any chat. Full-screen modal pairing AI disclosure with consent. *Continue* proceeds; *No thanks* closes and records nothing. The server refuses chat requests without tier-1 consent. Copy: §4.1.
2. **Persistent chrome badge** — an "AI assistant · info" tag visible throughout; *info* opens the privacy modal. Cannot be dismissed. Copy: §4.2.
3. **Privacy info modal** — the longer "what happens with your data" copy, opened from the opening screen or the badge. Copy: §4.3.
4. **Conversation** — standard chat; tool-call widgets (trip/hotel/region cards, customer stories) render inline. No new consent prompts. What the agent says is generated per visitor and isn't in the copy table; the system prompt that shapes its voice lives outside this pack (see §5).
5. **Lead-capture form (tier-2)** — renders inline at handoff: name + email (required), phone + preferred method (optional), a free-text note, a collapsible disclosure of what will be shared, and an inline tier-2 consent notice by *Send* (no tickbox). On submit the server validates, enriches from session state, writes the durable record, and (if email is enabled) sends a verdict-aware email. **Dual backstop**: both the route and the handoff side-effect refuse to write without both consent flags. Copy: §4.4.
6. **Sales-facing handoff email** — sent for `qualified` and `referred_out` only. **No email** for `disqualified` or `inconclusive` (those keep a 90-day analytics record; sales isn't notified). Templates: §4.6.

![Opening screen. Tier-1 disclosure plus consent. Layout shown for context; the copy in §4.1 is what counsel reviews.](screenshots/01-opening-screen.png){width=4in}

![Persistent chrome badge, visible throughout a conversation. Copy in §4.2 is what counsel reviews.](screenshots/02-chrome-badge.png){width=4in}

![Privacy info modal. Copy in §4.3 is what counsel reviews. `privacy@example.com` is a literal placeholder pending D-3.3.3.](screenshots/03-privacy-modal.png){width=4in}

![Lead-capture form, captured during a real qualified-handoff flow. Copy in §4.4 is what counsel reviews.](screenshots/04-lead-capture-form.png){width=4in}

---

# 3. Decisions needed from Swoop and counsel

**Already resolved — no action:**

- **D-3.2.2 — Marketing opt-in: removed** end-to-end 2026-06-16 (form, schema, durable record, email). No marketing consent is collected.
- **D-3.1.9 (part) — Conversation retention disclosed**: tier-1 and the privacy modal now tell visitors conversations are kept and *"any saved data is always anonymised before we do any internal analyses"*. Open sub-points remain below.

## 3.1 Counsel-only calls

### D-3.1.10. Google Gemini API as a processor of visitor query text — disclosure and terms *(new in v0.8)*

**Why**: on most retrieval steps the agent embeds the visitor's own search text via Google's `gemini-embedding-001` model, calling the public Generative Language API (`generativelanguage.googleapis.com`). Visitor-derived text therefore reaches Google at runtime, on the conversation path — a **model-provider** role, distinct from Google Cloud hosting.

**Two consequences**:

- The public Gemini API has **no EU region pinning** by default. **Vertex AI** is the region-pinnable alternative and is covered by the Google Cloud DPA; the public API is governed by the Gemini API terms instead.
- The "not used to train third-party AI models" promise to visitors (§4.1, §4.3) holds on the **paid** Gemini API tier, not the free tier. Launch must use a paid key.

**Required**: confirm whether to (a) stay on the public Gemini API or move to Vertex AI for region/DPA alignment; (b) which terms/DPA cover this call (see D-3.1.7); (c) that the visitor-facing no-training promise is acceptable on the paid-tier basis. Region routing is folded into D-3.1.6.

---

### D-3.1.1. DPIA needed?

**Why**: Art. 35 requires a DPIA where processing is *"likely to result in a high risk"*.
**Our reading**: narrow scope, explicit-consent basis, no Art. 22 automated decision-making — none of the typical high-risk indicators apply.
**Required**: confirm or override. If required, it's a sibling deliverable to this pack.

---

### D-3.1.2. Article 22 framing

**Why**: Art. 22 protects against *solely automated decisions* with legal or similarly significant effects.
**Our reading**: the triage classifier categorises visitors but this is a routing signal, not a binding decision. Follow-up is human-led; disqualified visitors aren't denied service (they can still browse and use existing forms); a specialist can revise the verdict.
**Required**: confirm Art. 22 doesn't apply, or instruct us to add a "human-review-before-consequence" surface.

---

### D-3.1.3. Retention windows and enforcement

**Why**: Art. 5(1)(e) requires data kept no longer than necessary.

| Data | Retention | Lawful basis | Enforced in code? |
|---|---|---|---|
| In-progress session (idle) | 24 hours | Art. 5(1)(c)+(e) | **Yes** — sessions are durable in Postgres; a wired deletion sweep enforces the idle/archive TTL. |
| In-progress session (archived) | +7 days | as above | **Yes** — same sweep. |
| Handoff, qualified / referred-out | **360 days** outer bound (or until CRM ingestion, whichever sooner) | Art. 6(1)(a) consent + sales lifecycle | **Yes** — hard-delete sweep in code; disabled by default in staging, flips on at launch. |
| Handoff, disqualified / inconclusive | **90 days** | Art. 6(1)(f) legitimate interest (product analytics) | **Yes** — same sweep. No `contact` field stored on these records. |
| Tier-1 / tier-2 consent records | Lifetime of handoff | bundled with the record (audit trail) | Yes. |
| Server request / event logs | Per deployment policy | Art. 6(1)(f) observability | Host/ingress logs per their config; Puma's event stream holds no PII. |

**Notes**: the "or until CRM ingestion" branch is operator-initiated, not auto-enforced; the 360-day bound (rather than "12 months") is the conservative failsafe, avoiding calendar/leap-year edges. The **shape-dependent items** flagged for the deployment decision (single-VM vs managed services): server log retention (a managed log sink with a 30-day default vs the VM's own configured policy) and database backups (see below).

**Required**:

- Is 90-day analytics retention for `disqualified` / `inconclusive` defensible under legitimate-interest balancing? (No contact stored.)
- Is the 360-day outer bound right for `qualified` / `referred_out`? Swoop's sales-lead lifecycle is the ground truth.
- Database backups depend on the final shape: a self-managed VM Postgres has whatever snapshot cadence ops sets; managed Postgres would bring a ~7-day point-in-time window. What backup-then-erase window is acceptable for Art. 17? (See D-3.1.4.)

---

### D-3.1.4. Hard-delete posture

**Why**: when records expire, the sweep hard-deletes them.
**Our reading**: hard-delete is the cleanest mechanic for Art. 5(1)(e) and matches visitor expectation. Deletions are auditable via the event stream (counts only, no PII).
**Alternative**: soft-delete to a quarantine with a secondary window — a one-line change; interface and runbook unchanged.
**Required**: confirm hard-delete, or instruct soft-delete and name the secondary window.

---

### D-3.1.5. Coverage of jurisdictions beyond UK

**Why**: visitor jurisdiction determines which frameworks apply.
**Current state**: UK and EU coverage is in flight (§1). Other jurisdictions aren't addressed; we lack visitor-analytics data and don't know in detail where Swoop actively sells.
**Required**: from Swoop — any visitor-analytics breakdown (UK/EU/US/RoW) and where Swoop actively sells (extraterritorial obligations follow from selling, regardless of visitor mix). From counsel — which non-UK regimes apply (likely candidates: US state laws, LGPD, PIPEDA, Australian Privacy Principles). A data-and-judgement question needing both inputs.

---

### D-3.1.6. Model-provider API region routing (Anthropic + Google Gemini)

**Why**: visitor data is sent to two model providers — Anthropic (conversation) and Google Gemini (query embeddings, D-3.1.10). EU-region endpoints may exist; defaults may route US-side.
**Current state**: standard Anthropic API routing; the Gemini call uses the public Generative Language API (no EU pinning). Neither EU-routing position is confirmed under Swoop's commercial relationships.
**Required**: does counsel require EU routing where available? If yes, this becomes actions with Swoop's Anthropic and Google contacts (and may push the Gemini call to Vertex AI per D-3.1.10).

---

### D-3.1.7. Sufficiency of third-party terms / DPAs

**Why**: four processors, each with its own terms.

- **Anthropic**: standard commercial-terms DPA.
- **Google Cloud** (hosting): standard Google Cloud DPA.
- **Google — Gemini API** (embeddings): governed by the **Gemini API terms**, *not* the Google Cloud DPA, unless the call moves to Vertex AI (D-3.1.10). A distinct relationship even though the vendor is the same.
- **SMTP provider**: TBC (D-3.3.1; likely Google).

**Required**: are the standard published terms sufficient, or are commercial-tier addenda needed? Should current sub-processor lists be attached? Confirm which Google instrument covers the embeddings call.

---

### D-3.1.8. Tier-1 withdrawal control prominence

**Why**: Art. 7(3) requires withdrawal to be as easy as giving consent.
**Current state**: a visitor can end the conversation any time via the chat's "New conversation" / "End" control, which clears session state immediately.
**Required**: is the control prominent enough, or should we elevate it (always-visible "End" alongside the badge)?

---

### D-3.1.9. Conversation retention for agent improvement (open sub-points)

> **Resolved 2026-06-16**: conversations ARE retained for analysis, disclosed in tier-1 (`opening.body`, §4.1) and the privacy modal (`privacy.paragraph-1`, §4.3), with the commitment *"any saved data is always anonymised before we do any internal analyses"*. Raw is stored; an anonymisation sweep runs before any analytic use.

**Still open**:

- **Retention window** — Swoop to name a concrete window (30 days / 6 months / 12 months) so counsel can reason about defensibility. The live tier-1 copy now says data is kept *"for a brief period of time"*, a qualitative hint rather than a concrete window; the window still needs naming.
- **Term** — is *"anonymised"* the right word, or *"pseudonymised"*? The visitor-facing term is "anonymised" (more widely understood); the mechanism is realistically pseudonymisation. Counsel confirms.

---

## 3.2 Confirm or amend

### D-3.2.1. Two-tier consent model

Tier 1 (paired with AI disclosure) at conversation start; tier 2 at handoff. Tier-2 is **submission-as-consent** — clicking *Send* after a clear inline notice is the affirmative act (no tickbox). Chosen over legitimate-interest because a chatbot freely receives PII in messages. Copy in §4.1 and §4.4.

### D-3.2.3. Tier-2 consent timestamp captured client-side

The browser stamps `new Date().toISOString()` at the moment of *Send*; the server records it verbatim. Encodes the visitor's *intent* moment, not server processing time. A separate server-side timestamp records when the handoff was processed.

### D-3.2.4. Copy versioning

Every handoff record persists the version id of the copy the visitor saw at consent time. Today these are manual semver-style labels (e.g. `consent-handoff/v2`) bumped by hand when copy changes — no automated enforcement. **Intended before launch**: content-hash versioning, so any edit to consent-bearing copy changes the version id automatically.
**Required**: confirm content-hash versioning, or instruct continued manual labels (with documented author discipline).

### D-3.2.5. Manual per-request data-subject-rights process

For Art. 15 / 16 / 17: visitors email Swoop's privacy contact; the recipient runs a documented runbook (a SQL query against the handoff store by email); record returned, updated, or deleted; confirmation logged (no record content) and sent. GDPR's 1-month SLA applies.
**Required**: acceptable, or is a self-service surface needed?

### D-3.2.6. Dual backstop on handoff write

Both the server route and the handoff side-effect refuse to write unless **both** consent flags are present and true. Either layer alone would prevent unauthorised processing; the duplication protects against future refactors. Implementation detail; no copy implication.

### D-3.2.7. No third-party analytics or tracking in the chat surface

The chat iframe ships no third-party scripts, no fingerprinting, no session-replay. Session state is held tab-scoped in `sessionStorage`. (A staff-only admin login uses a first-party `localStorage` token; it is never present for visitors and is excluded from analytics.)
**Required**: acceptable as-is, or state more prominently in the privacy modal (§4.3)?

---

## 3.3 Swoop operational

| ID | Decision | What's required |
|---|---|---|
| D-3.3.1 | **SMTP provider** | Working assumption: Google Workspace / Gmail SMTP (existing Google footprint); fall-backs Postmark / SES / Mailgun. Swoop confirms. If Google, the DPA is the same Google Cloud DPA (D-3.1.7). |
| D-3.3.2 | **Sales inbox address(es)** | `qualified` and `referred_out` trigger email. Swoop confirms address(es) and whether one inbox with subject prefixes or two. |
| D-3.3.3 | **Visitor-facing privacy contact** | The privacy modal (§4.3) uses `privacy@example.com` as a placeholder. Swoop's named privacy contact or redirect. Used for Art. 15/16/17 and withdrawal. |
| D-3.3.4 | **DPA sourcing** | Anthropic (commercial agreement or published terms); Google Cloud (existing GCP contract); Gemini API terms (D-3.1.10); SMTP (once D-3.3.1 confirmed). |
| D-3.3.5 | **Google Cloud region** | Working default `europe-west2` (London) for the VM, Postgres, and logs. Thomas (Swoop ops) confirms the region for the GCP project. |
| D-3.3.6 | **Counsel review contact + chase-up** | A named counsel contact, an agreed turnaround for this pack, and a path for follow-up questions. Launch blocks on sign-off. |
| D-3.3.7 | **Swoop privacy-policy integration** | The privacy modal links to Swoop's existing policy. Swoop confirms whether it already covers the agent's processing or needs a diff. |

---

# 4. Copy table

Each row carries an **ID** (machine-readable; used to apply counsel's edits), the **Surface**, **When it shows**, and the **Draft** as it stands. The **Counsel notes** column is for track-changes and comments. Keep the ID; amend the draft.

---

## 4.1 Opening screen (first visit)

The full-screen modal pairing AI disclosure with tier-1 consent. Visible once, before any chat.

| ID | When | Draft | Counsel notes |
|---|---|---|---|
| `opening.heading` | Heading | Before we start | |
| `opening.intro` | AI disclosure | This is an AI assistant. It helps you explore trip ideas by chatting with you and suggesting options from our library. | |
| `opening.body` | Data processing + consent | To answer your questions, we process the messages you send. If you continue, we'll keep a record of this chat for a brief period of time. Any saved data is always anonymised before we do any internal analyses to check the assistant is working well. Nothing you type is used to train third-party AI models. | |
| `opening.body-continued` | Decline option | If you'd prefer not to start the conversation, you can decline and no data will be recorded. | |
| `opening.privacy-link-label` | Privacy-modal link | Read how we handle your data | |
| `opening.continue-label` | Primary button (accepts + begins) | Continue | |
| `opening.decline-label` | Secondary button (declines) | No thanks | |
| `opening.granting-label` | Continue button while recording consent (~1s) | One moment… | |
| `opening.error-prefix` | Prefix when the consent handshake fails | Couldn't start the conversation: | |
| `opening.declined-heading` | Heading after Decline | No problem | |
| `opening.declined-body` | Body after Decline | Nothing has been recorded. You can close this window. Or reload the page if you change your mind. | |

---

## 4.2 Persistent chrome badge

Small persistent tag at the top of the chat surface. Clicking opens the privacy modal (§4.3).

| ID | When | Draft | Counsel notes |
|---|---|---|---|
| `chrome.label` | Label, left of the divider | AI assistant | |
| `chrome.info` | Link text, right of the divider | info | |
| `chrome.aria-label` | Screen-reader label (not visible) | Open privacy information for this AI assistant | |

---

## 4.3 Privacy info modal

Opened from the privacy link on the opening screen, or from the chrome badge.

| ID | When | Draft | Counsel notes |
|---|---|---|---|
| `privacy.heading` | Modal heading | How your conversation is handled | |
| `privacy.paragraph-1` | What processing happens | This is an AI-powered assistant. When you send a message, your text is processed by an AI model so the assistant can respond. We keep a record of your conversation for a while — any saved data is always anonymised before we do any internal analyses to check the assistant is working well. | |
| `privacy.paragraph-2` | Data use, processors, contact. `privacy@example.com` is a placeholder (D-3.3.3). | We do not sell your data, and your conversation is not used to train third-party AI models. Suppliers involved in processing may include our hosting provider and the AI model provider. If you'd like a copy of your conversation, or to have it deleted on request, contact us at privacy@example.com. | |
| `privacy.close-label` | Close button | Close | |
| `privacy.aria-close-label` | Screen-reader label for X (not visible) | Close privacy information | |

> **Note for counsel** (D-3.1.10): `privacy.paragraph-2` currently reads "the AI model provider" (singular, as live), but there are now two model providers (Anthropic + Google's Gemini API). Confirm whether the generic "suppliers… may include" framing satisfies the Art. 13(1)(e) recipients duty, or whether it should be pluralised / name the processors.

---

## 4.4 Lead-capture form

Shown at handoff. Verdict-aware intro, contact fields, a disclosure of what will be shared, and an inline consent notice — clicking *Send* is the tier-2 consent (no tickbox).

**Note**: only `qualified` and `referred_out` regularly surface the form. `disqualified` and `inconclusive` intros are included for type-safety but rarely shown.

| ID | When | Draft | Counsel notes |
|---|---|---|---|
| `lead-capture.intro.qualified` | verdict = `qualified` | A Swoop specialist is the right next step. Share a contact detail and they'll pick up where we left off. | |
| `lead-capture.intro.referred-out` | verdict = `referred_out` | Your plans are a better fit for a partner we know well. Share a contact detail and we'll introduce you. | |
| `lead-capture.intro.disqualified` | verdict = `disqualified` (rare) | This particular trip isn't the right match today, but we'd still love to hear from you if anything changes. | |
| `lead-capture.intro.inconclusive` | verdict = `inconclusive` (rare) | We weren't quite able to find the right match in this conversation, but the door's open whenever you'd like to come back. | |
| `lead-capture.label.name` | Required field | Name | |
| `lead-capture.label.email` | Required field | Email | |
| `lead-capture.label.phone` | Optional field | Phone (optional) | |
| `lead-capture.label.additional-notes` | Free-text field | Anything else the specialist should know? (optional) | |
| `lead-capture.precis-disclosure-label` | Collapsible disclosure, opens the conversation summary | Review what you've told us so far | |
| `lead-capture.precis-fallback` | Substituted if the agent supplied no summary | A summary of what you've told us will be shared with the specialist. | |
| `lead-capture.consent-notice` | Inline notice by Send — **submission is the tier-2 consent** | Clicking 'Send my details' shares your conversation summary with a Swoop Planning Specialist so they can make better recommendations and follow up. | |
| `lead-capture.submit` | Submit button | Send my details | |
| `lead-capture.submit.sending` | Submit button in flight | Sending… | |
| `lead-capture.submit.aria` | Screen-reader label for submit | Submit handoff details | |
| `lead-capture.confirmation.heading` | After successful submit | Thanks — we've got your details. | |
| `lead-capture.confirmation.body` | After successful submit | A Swoop specialist will be in touch. | |
| `lead-capture.pending` | Between submit and confirmation | Sending your details… | |

### Form validation messages

| ID | When | Draft | Counsel notes |
|---|---|---|---|
| `lead-capture.error.name-required` | Name empty on submit | Name is required | |
| `lead-capture.error.email-required` | Email empty on submit | Email is required | |
| `lead-capture.error.email-invalid` | Email fails regex | Please enter a valid email | |
| `lead-capture.error.submit-fail` | Server-side failure; `{detail}` is a short technical reason | We couldn't send your details just now ({detail}). Please try again. | |

---

## 4.5 Error states

Inline banners shown if something goes wrong during the conversation.

| ID | Draft | Counsel notes |
|---|---|---|
| `error.unreachable.title` | Having trouble connecting | |
| `error.unreachable.body` | We couldn't reach our systems just now. Please try again in a moment. | |
| `error.unreachable.primary` / `.secondary` | Try again / Start over | |
| `error.stream_drop.title` | Connection dropped | |
| `error.stream_drop.body` | Your reply was interrupted mid-stream. We can try that again. | |
| `error.stream_drop.primary` / `.secondary` | Try again / Start over | |
| `error.session_expired.title` | This conversation has expired | |
| `error.session_expired.body` | We'll need to start a fresh one — your previous answers won't carry over. | |
| `error.session_expired.primary` | Start a new conversation | |
| `error.rate_limited.title` | Busy right now | |
| `error.rate_limited.body` | We're getting a lot of requests. Please try again in a moment. | |
| `error.rate_limited.secondary` | Start over | |
| `error.unknown.title` | Something went wrong | |
| `error.unknown.body` | An unexpected error came up on our side. Please try again, or start a fresh conversation. | |
| `error.unknown.primary` / `.secondary` | Try again / Start over | |
| `error.tool_error.title` | Couldn't load that | |
| `error.tool_error.body` | I couldn't show that piece — we can still keep talking, or try asking a different way. | |

---

## 4.6 Sales-facing handoff emails

Sent to Swoop's sales inbox at handoff. **Not visitor-facing**, but they carry processed visitor data over an external SMTP processor, so counsel may want a look. `{{...}}` placeholders are filled at send-time. Subject lines: `Swoop lead — {{contact.name}} ({{verdict}}, {{reason.code}})` (qualified); `Swoop referral — {{contact.name}} ({{reason.code}})` (referred-out).

### `email.qualified.body` (verdict = `qualified`)

```
## New lead — {{contact.name}} ({{reason.code}})

This visitor has been talking to the Patagonia discovery agent and is ready for a specialist follow-up.

### Conversation summary
{{reason.text}}

### Why this trip, why now
{{motivationAnchor}}

### What they shared
- Independence: {{visitorIndependence}}
- Budget band: {{visitorBudgetBand}}
- Activities: {{visitorActivities}}
- Regions: {{visitorRegions}}

### Wishlist
{{wishlistFormatted}}

### Anything else they wanted you to know
{{additionalNotesOrNone}}

### Contact
- Name: {{contact.name}}
- Email: {{contact.email}}
- Phone: {{contactPhoneOrDash}}
- Prefers: {{contactPreferredMethod}}
- Time-zone hint: {{contactTimeZoneOrDash}}

### References
- Handoff ID: {{handoffId}}
- Session ID: {{session.sessionId}}
- Turn count: {{session.turnCount}}
- Started: {{session.conversationStartedAt}}
- Submitted: {{session.handoffSubmittedAt}}
- Conversation ref: {{session.rawConversationRef}}
- Entry URL: {{sessionEntryUrlOrDash}}

### Consent
- Conversation: granted at {{consent.conversationTimestamp}} (copy v{{consentCopyVersionOrDash}})
- Handoff: granted at {{consent.handoffTimestamp}}

---
Sent automatically by the Swoop Patagonia discovery agent. The visitor has explicitly consented to this contact (tier-2 consent at handoff time).
```

### `email.referred-out.body` (verdict = `referred_out`)

Same structure as `qualified`, with these differences:

- Heading: `## Referral — {{contact.name}} ({{reason.code}})`.
- Opening line explains the visitor is outside Swoop's direct service scope and the agent has shared their details so sales can pass them to a partner or close politely.
- The summary section is titled **"Why the agent referred out"** (not "Conversation summary").
- **Contact** omits the time-zone hint; **References** omit *Started* and *Entry URL*; **Consent** omits the copy-version note.
- Footer: as qualified, plus *"…but the agent has flagged them as outside Swoop's direct fit — see 'Why the agent referred out' above."*

**Counsel notes on the email templates**:

```
[ counsel comments here ]
```

---

# 5. Glossary and related artefacts

### Terms

- **Tier-1 consent**: conversation-opening consent paired with EU AI Act Art. 50 disclosure. Without it, no session state is written.
- **Tier-2 consent**: submission-as-consent at handoff (clicking *Send* after the inline notice). Without it, contact details aren't submitted.
- **Verdict**: `qualified`, `referred_out`, `disqualified`, `inconclusive`. Drives whether an email is sent and which retention window applies.
- **Reason code**: structured taxonomy (21 codes) saying *why* the verdict landed. Used by sales for triage and by analytics for prompt iteration.
- **Handoff record**: the structured payload written to durable storage at submit — agent summary, contact (qualified/referred-out only), both consent records, session metadata.
- **Processor**: a third party that processes personal data on Swoop's behalf. Four: Anthropic (conversation model), Google Gemini API (query embeddings, D-3.1.10), Google Cloud (hosting/storage/logging), SMTP provider (likely Google; D-3.3.1).
- **Durable store**: the Postgres database holding handoff records, on the same single VM as the retrieval store and sessions at launch. Interim staging uses file-backed JSON for handoff records.
- **Sweep**: scheduled process that hard-deletes expired records (handoff and session) once their retention window passes. Runs daily.

### Related artefacts (on request)

A fuller technical compliance bundle lives in the codebase (`product/cms/legal/compliance-bundle/`): data-flow diagram, processor sub-relationships, retention enforcement detail, and data-subject-rights runbooks. Counsel can request specific files if a §3 decision needs deeper substantiation.

---

**End of document.**
