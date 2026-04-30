# 01 — Overview

> **Status: ✅ FILLED** — production-ready for counsel review.

---

## What Puma is

Puma is the codename for Swoop Adventures' website discovery tool — a conversational AI assistant embedded in the Swoop Patagonia website. It helps visitors explore Swoop's trip and tour offerings through natural-language conversation, qualifies their interest, and either:

- **Hands off a warm lead** to Swoop's sales specialists by emailing a summary of the conversation + the visitor's contact details, or
- **Refers the visitor out** if they're outside Swoop's direct service scope, or
- **Politely closes** the conversation if the visitor is clearly not a candidate.

Launch scope is **Patagonia-only**. Antarctica + Arctic destinations follow in later releases.

The chat is implemented as an embeddable widget on Swoop's existing website. It runs alongside Swoop's other surfaces (browse, blog, existing contact forms) — it does not replace them.

---

## Personal data Puma touches

Categorised by when in the visitor's journey the data enters the system.

### From conversation start (tier-1 consent applies)

- **Visitor messages**: free-form text. May contain personal data at the visitor's discretion (names, locations, family details, financial information, health information if travel-relevant). Stored in session state for the duration of the conversation. Visible to Anthropic's API in the model-call payloads.
- **Session metadata**: session id (UUID), conversation start timestamp, turn count, entry URL. Not personal data in itself but linked to the visitor's data.
- **Tier-1 consent record**: timestamp + version id of the disclosure copy the visitor accepted.

### From handoff submission (tier-2 consent applies)

- **Visitor name** (free-form, as typed).
- **Email address**.
- **Preferred contact method** (if offered by the form).
- **Tier-2 consent record**: timestamp + version id of the consent copy.
- **Optional marketing opt-in record**: explicit opt-in only; unticked by default.

### Derived

- **Triage verdict**: `qualified` / `referred_out` / `disqualified` / `inconclusive` + structured reason code (per the verdict/reason taxonomy in [planning/03-exec-handoff-t1.md](../../../../planning/03-exec-handoff-t1.md)). The `inconclusive` verdict (HITL Q5) covers visitors where the agent never reached confidence to qualify, refer-out, or disqualify — same downstream consequences as `disqualified` (no email, 90-day retention, no contact field on the durable record).
- **Visitor profile sketch**: independence level, budget band, activity inclination, region interest — derived from the conversation by the agent.
- **Wishlist**: trips/tours/regions the visitor gravitated to.
- **Motivation anchor**: the "why" — bucket list, photography, etc.

### Not collected

- **No third-party analytics in the chat surface**. No GA, no FB pixel, no fingerprinting.
- **No IP address persistence** beyond what Cloud Run logs by default (30-day Cloud Logging retention).
- **No demographic profiling** beyond what the visitor volunteers in conversation.
- **No payment data**. Booking happens off-Puma (sales specialists handle commercials).

---

## Lawful basis

**GDPR Art. 6(1)(a) — Explicit consent.** Two-tier:

- **Tier 1**: presented before any visitor message can be sent. Pairs the EU AI Act Art. 50 AI-disclosure with the GDPR conversation-data consent. Without tier 1, no session state is written. The chat closes cleanly if the visitor declines.
- **Tier 2**: presented inside the lead-capture widget at handoff. Required tickbox for "I consent to Swoop contacting me about this enquiry and storing my contact details for that purpose." A separate, optional, unticked-by-default tickbox covers marketing opt-in.

**Legitimate interest considered and rejected.** A chatbot freely receives PII in user messages; legitimate-interest processing requires a balancing assessment that becomes thin when the basis can be explicit consent instead. We chose explicit-consent-up-front for cleanliness and audit posture.

See decision **E.4** in [planning/decisions.md](../../../../planning/decisions.md) for the full rationale.

---

## Jurisdictional posture

Puma's primary visitor base is Anglophone (UK / US / Australia / Canada), with EU residents present. The compliance posture covers:

- **EU AI Act** (Regulation (EU) 2024/1689). Art. 50 obligations apply: visitors must be informed they're interacting with an AI system. Satisfied by tier-1 disclosure + persistent chrome tag.
- **EU GDPR** (Regulation (EU) 2016/679). Applies extraterritorially because Swoop offers services to EU residents.
- **UK GDPR** (Data Protection Act 2018 + UK GDPR). Applies because Swoop is UK-established.

**Out of scope at launch**:

- US-specific frameworks (CCPA / CPRA, state privacy acts). Visitor mix not currently US-heavy enough to justify pre-emptive compliance work; flag for counsel review if visitor analytics show otherwise.
- Other jurisdictions (Brazil LGPD, etc.). Same posture — flag if visitor mix shifts.

---

## Scope of this bundle

**This bundle covers**: Puma's compliance surfaces. Disclosure copy, consent flow, data flow, retention, processors, DPAs, data-subject rights.

**This bundle does NOT cover**:

- Swoop's CRM and downstream lead lifecycle (separate compliance surface; Swoop's existing posture).
- Swoop's website beyond the chat widget (existing privacy policy applies).
- Swoop's general data protection posture, vendor relationships outside Puma, or DPO-level governance.
- Swoop's email marketing (Puma's optional tier-2 marketing opt-in feeds Swoop's existing marketing infrastructure; that infrastructure has its own compliance posture).

Counsel reviewing this bundle is reviewing Puma. Other surfaces stay with Swoop's existing review processes.

---

## Architecture summary (high-level, for context)

- **Frontend**: React + Vite chat widget, embedded as iframe on Swoop's marketing site. Open-source `assistant-ui` for the chat primitive.
- **Backend**: Node.js orchestrator running on Google Cloud Run; in-process connector for retrieval + handoff side-effects.
- **Model**: Anthropic Claude (Sonnet for the conversational agent, Haiku for fast triage classification).
- **Storage**: Cloud SQL Postgres (planned, post-IAM) for retrieval data + handoff records + sessions. Today's interim is file-backed JSON for handoff records (see [05-retention-policy.md](05-retention-policy.md)).
- **Email**: nodemailer + SMTP provider (TBC pending Julie).
- **Telemetry**: Cloud Logging (Google Cloud), 30-day default retention.
- **Hosting region**: planned `europe-west2` (London) — confirm with Thomas (Swoop ops).

See [02-data-flow.md](02-data-flow.md) for the full diagram.
