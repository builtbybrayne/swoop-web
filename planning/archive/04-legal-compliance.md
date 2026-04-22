# 04 — Legal & Compliance

**Status**: Draft, v1. Non-lawyer document. Needs review by Swoop's legal counsel before launch.
**Purpose**: Map the regulatory surface this build touches, identify implementation tasks, and provide candidate disclosure copy for legal sign-off.
**Depends on**: `01-architecture.md` (data flow), `03-handoff-schema.md` (personal data captured in the handoff).

---

## 1. What this doc does and doesn't do

**Does**:
- Map the regulations that likely apply to this build
- Name the shift in responsibility vs. the ChatGPT PoC
- Inventory the personal data the system actually handles
- Identify implementation tasks (copy-level and technical) that flow from the above
- Draft candidate disclosure copy for legal to adjust

**Does not**:
- Give legal advice
- Replace a lawyer's sign-off — that remains Swoop's responsibility
- Guarantee compliance

Al is happy to work with Swoop's legal counsel on any of the below, but the final legal position is Swoop's call.

Each item below is tagged:
- **[Al's proposal]** — something Al is suggesting based on project shape
- **[Swoop legal]** — needs confirmation or drafting by Swoop's lawyers
- **[TBC]** — dependency on a Swoop decision or infrastructure detail not yet known

**Principle**: get the legal position established early. It may be a no-op. But if it isn't, we want to know now.

---

## 2. The big shift: ChatGPT PoC → Swoop's own web surface

The PoC ran inside ChatGPT. That mattered legally:

- **OpenAI was the surface**. OpenAI's own flows covered AI-interaction disclosure, user T&Cs, session identity, cookies/trackers, and the baseline transparency obligation for "this is an AI".
- **Swoop received a lead email** (via the `submit_handoff` → mailer path) but didn't operate the chat surface. The user-facing consent story was OpenAI's.

The website version changes all of that. **Swoop is the data controller**, on Swoop's own domain. The disclosure, consent, cookie, retention and data-subject-rights stories now sit with Swoop.

The PoC is useful as a reference for *what personal data we collect and how it moves* (see §4). It is **not** a template for the consent story.

---

## 3. Regulations in scope

### 3.1 EU AI Act — Article 50 transparency obligation

**Status**: Article 50 transparency provisions become enforceable **2 August 2026**.

The relevant obligation is that **users interacting with an AI system must be told they're interacting with AI** (unless it's obvious from context — a narrow exception; embedding a chat widget on a travel website does not obviously qualify). V1 must ship with disclosure.

This applies to Swoop as the deployer of the AI system. UK basing doesn't exempt us — the Act has extraterritorial reach when serving EU users, same pattern as GDPR.

Implementation tasks flow into §5 and §6. **[Al's proposal — needs Swoop legal sign-off]**.

Worth flagging: the EU's draft Code of Practice is expected to finalise mid-2026. Following it gives a "presumption of conformity"; not following it means independently demonstrating compliance. Worth a review checkpoint around June 2026. **[Swoop legal to decide whether to opt in]**.

### 3.2 GDPR / UK GDPR / UK DPA 2018

Swoop is UK-based, so UK GDPR + UK DPA 2018 are the primary framework. EU GDPR applies where Swoop is processing EU residents' data (very likely — Patagonia customers are heavily US / Canadian / EU, and EU visitors to the site trigger it regardless of where they book).

Key obligations for this build:
- **Lawful basis** for each category of processing (see §4). Likely legitimate interest for the chat itself, explicit consent for handoff to sales.
- **Data minimisation** — don't collect more than the conversation genuinely needs.
- **Purpose limitation** — disclose why data is collected; use it only for that.
- **Data subject rights** — access, erasure, rectification. A deletion path must exist (§6).
- **Processor agreements (DPAs)** — with every sub-processor that touches personal data (§7).
- **Breach notification** — 72 hours to authority if personal data is compromised. Swoop likely has an existing incident-response process; this chat plugs into it.

Swoop will have an existing privacy notice covering the broader business. **[Swoop legal]** — confirm whether it already covers an AI chat tool processing conversational data, or needs extending. Al can draft processor-disclosure language.

### 3.3 Cookies / PECR

If the chat stores anything persistent on the user's device that isn't strictly necessary for the service, UK PECR / EU ePrivacy rules apply.

**What the chat may set**:
- A session token (to keep a live conversation coherent on refresh). Arguably "strictly necessary" — no consent needed.
- Analytics identifiers (if any). Consent needed.
- Anything else third-party processors drop (Firebase, etc. — see §7). Requires review.

**Dependency**: Swoop has an existing cookie / consent system for the rest of the site. The chat should plug into that rather than spawning its own banner. **[TBC — needs confirmation of Swoop's existing cookie/consent infrastructure]**.

### 3.4 Out of scope for V1

- **CCPA / California privacy** — revisit if US customer volume materially grows. Good GDPR hygiene covers most of it.
- **Accessibility (EN 301 549 / WCAG)** — UI-layer responsibility, not a data-protection issue. Addressed in design, not here.
- **Content moderation regimes (DSA etc.)** — not UGC.
- **Sector-specific regulations** — this is not healthcare, finance, or a hiring tool. No high-risk AI classification applies.

---

## 4. Personal data inventory

Derived from the PoC handoff code (`chatgpt_poc/.../handoff.ts`, `handoff-submit.ts`, `mailer.ts`, the lead-capture widget) and the kickoff meetings. Categories are **Al's best read** of what V1 will collect — Swoop legal to confirm lawful basis and retention for each.

| Item | Source | Where it lives | Category | Lawful basis (proposed) | Retention (proposed) |
|---|---|---|---|---|---|
| Name | User-entered at handoff step | Handoff store + sales inbox | Identifying | Consent (at submit) | Align with Swoop CRM |
| Email | User-entered at handoff step | Handoff store + sales inbox | Contact | Consent (at submit) | Align with Swoop CRM |
| Phone (optional) | User-entered at handoff step | Handoff store + sales inbox | Contact | Consent (at submit) | Align with Swoop CRM |
| Conversation transcript | Generated during chat | Session store + logs | Free text — may contain anything | Legitimate interest (service quality) + consent at handoff | Draft: 30 days (see §8) |
| Discovered preferences / wishlist | Agent's summary of conversation | Handoff store + sales inbox | Derived personal data | As transcript | As CRM record |
| Motivation / emotional context | Agent's summary | Handoff store + sales inbox | Derived personal data — potentially sensitive in tone | As transcript | As CRM record |
| Party composition, prior experience, accessibility needs, languages (from `03-handoff-schema.md`) | User-volunteered | Handoff store | Potentially includes special-category data (accessibility / dietary if disclosed) | Consent | As CRM record |
| Session ID | Generated | Session store, browser | Technical identifier | Strictly necessary (service functionality) | Short TTL |
| IP address | Network layer | Cloud Run / GCP logs | Identifier | Legitimate interest (security / ops) | Log retention default (~30 days) |
| Approximate geolocation inferred from IP | Derived from IP | Not stored in V1 | Identifier | — | — (Julie flagged on 20 Apr as a **future** input for personalisation — **not in V1**; any future use needs its own consent / transparency review) |

**Not collected / not planned for V1**:
- No account creation, no persistent user ID across sessions
- No third-party marketing trackers
- No biometric data
- Special-category data is not deliberately collected, but users *can* volunteer it in free-form chat (medical, dietary, religious considerations tied to trip advice). The system must not persist this beyond what the handoff genuinely needs — see §9.

**[Al's proposal]** — full inventory above.
**[Swoop legal]** — confirm lawful basis per row, confirm CRM retention alignment, confirm whether "motivation / emotional context" needs tighter handling.

---

## 5. Data processors

From the 21 April technical alignment meeting, the likely production architecture touches:

| Processor | Role | Data that reaches them | DPA status |
|---|---|---|---|
| Anthropic (Claude, served via Google Vertex) | Model inference — the orchestrator LLM | Every turn: user input, agent context, tool outputs | **[Swoop legal]** — confirm route (direct Anthropic vs. Vertex-intermediated) affects DPA chain |
| Google Cloud (Vertex AI Search, Cloud Run, Cloud Logging) | Search / RAG, compute, logging | Conversation snippets for retrieval; full request logs | Standard GCP DPA — **[Swoop legal]** to confirm Swoop has one in place |
| Weaviate Cloud *(if used as fallback search)* | Vector search | Embedded document content (Swoop's public site content) + possibly query text | **[TBC — only if Weaviate is used]** |
| Firebase Realtime Database *(if used for streaming)* | Streaming queue / pub-sub for chat tokens | Assistant output tokens in transit | Google DPA (covers Firebase) — **[Swoop legal]** to confirm |
| Swoop's SMTP / mail provider | Lead email delivery | Full handoff record (name, email, phone, summary) | **[Swoop legal]** — confirm current provider DPA |

**Principles**:
- Prefer EU-region GCP deployment. **[Al's proposal — Swoop to confirm region preference]**
- Each processor above should appear in Swoop's privacy notice under processor / sub-processor disclosure. **[Swoop legal]**
- Al produces the current list; Swoop's legal team confirms DPAs exist.

Data residency for Claude via Vertex, and data residency for Anthropic direct, have different answers. The architecture decision (Vertex-routed vs. direct Anthropic) has downstream legal implications. **[Al's proposal — default to Vertex-routed to keep the DPA chain inside GCP where possible; Swoop legal to confirm]**.

---

## 6. Implementation tasks (legal → technical)

Concrete, crossable tasks for V1.

### 6.1 AI-interaction disclosure (EU AI Act)

- [ ] **Widget opening state**: first view includes explicit "you're talking to an AI" disclosure before the user sends any message. **[Al's proposal]**
- [ ] **Persistent affordance**: a small, always-visible marker in the widget header (e.g. "AI assistant — what's this?"). **[Al's proposal]**
- [ ] **Expandable "what is this?"** in-widget: explains the tool honestly — discovery only, no bookings, specialist handoff. **[Al's proposal]**
- [ ] **Hallucination framing**: one-liner that the AI can get details (especially prices, dates) wrong and a specialist will confirm before booking. **[Al's proposal]**

### 6.2 GDPR / data handling

- [ ] **Privacy notice link** visible in widget, pointing to Swoop's main privacy notice. **[Al's proposal]**
- [ ] **Explicit consent at handoff submit** — not buried: the submit button reads consent-positive copy, and the form makes clear what's being shared. **[Al's proposal]**
- [ ] **Deletion request path** — surface a reference (session ID or similar) the user can quote, and a route (email or link) to request deletion. **[Al's proposal]**
- [ ] **Data-subject access path** — inherited from Swoop's main privacy contact. **[Swoop legal]**
- [ ] **Processor disclosure in privacy notice** — update to list Anthropic / GCP / others. **[Swoop legal]**
- [ ] **Retention TTL enforced in code** — session, transcript, handoff record each get an explicit TTL aligned with §8. **[Al's proposal]**
- [ ] **Encryption in transit + at rest** — GCP defaults cover this; confirm in deployment doc. **[Al's proposal]**

### 6.3 Consent at handoff (explicit)

- [ ] Before the handoff submit widget appears, the agent asks in-conversation for consent to pass the conversation to a human specialist (already designed in `03-handoff-schema.md`). **[Al's proposal]**
- [ ] The handoff widget itself acts as explicit consent: user sees what's being shared (summary preview), enters their contact details, and clicks submit. That click = consent. **[Al's proposal]**
- [ ] Log the consent moment — agent's ask, user's response, timestamp of submit. **[Al's proposal]**
- [ ] Hard backstop in `submit_handoff` tool: reject submission if the orchestrator didn't surface a consent moment. **[Al's proposal]**

### 6.4 Records / audit

- [ ] Record which model (and version) was used per turn. **[Al's proposal]**
- [ ] Version system prompts and guidance payloads; attach version tag to each conversation. **[Al's proposal]**
- [ ] Enable "what was the system doing on date X" auditability — useful for any future legal enquiry. **[Al's proposal]**

### 6.5 Sales-inbox data handling

- [ ] Lead emails contain full handoff record (name, email, phone, conversation summary). These sit in Swoop's inbox and are subject to Swoop's normal mail retention / data-handling policies. **[Swoop legal]** to confirm inbox handling is covered by existing policy.
- [ ] Consider whether transcripts should attach to the email at all, or only be stored in the handoff store and referenced by link. **[Swoop + legal decision]**

### 6.6 Dependencies on Swoop's infrastructure

- [ ] Cookie / consent banner integration — **[TBC — depends on Swoop's existing setup]**
- [ ] Privacy notice update — **[Swoop legal]**
- [ ] Incident response plugin — **[Swoop ops + legal]**
- [ ] DPA confirmations for every §5 processor — **[Swoop legal]**

---

## 7. Candidate disclosure copy

Draft copy for legal review. Tone: Swoop's voice — warm, honest, boundaried. Not apologetic. Swoop legal to adjust wording / add any required terms.

### 7.1 Widget opening

```
Hi — I'm Swoop's AI travel guide. I'll help you explore Patagonia and imagine
your adventure, then connect you with one of our specialists when you're ready.

A few things worth knowing:
- I'm an AI. I can be wrong, especially on prices and dates — our specialists
  will confirm everything before you book.
- I don't take bookings or payments. I help you narrow down what you want;
  a human picks it up from there.
- Your conversation stays private. See our [privacy notice] for the detail.

What draws you to Patagonia?
```

### 7.2 Persistent in-widget affordance

Small badge in the widget header, always visible:

> **AI assistant · [what's this?]**

Click expands the opening disclosure inline.

### 7.3 Handoff consent — in-conversation ask

Already designed in `03-handoff-schema.md` §9 — agent reflects the state of the conversation and asks:

> "Would it help if I passed this to one of our Patagonia specialists? They can reach out to talk through the options — no commitment. I'd share what we've discussed so you wouldn't have to repeat yourself."

Submission only proceeds on explicit positive response. Ambiguous replies ("maybe later") don't count.

### 7.4 Handoff submit widget — consent framing

At the handoff form:

> "Connect with a Swoop specialist. They'll already know your story — here's what we'll share: [view summary]. We'll use your contact details to get in touch about your Patagonia trip. More in our [privacy notice]."

Submit button: **"Connect me with a specialist"** (positive, consent-explicit).

### 7.5 Deletion request path

Visible via the privacy section of the widget:

> "Want us to delete this conversation? Email privacy@swoop-adventures.com quoting reference `{sessionId}`. We'll action it within 30 days."

Implementation: `sessionId` visible on request (can be collapsed behind a "your reference" toggle). Deletion handled manually by Swoop's team — Al provides a runbook.

---

## 8. Retention policy (draft)

**All rows below are starting points — [Swoop legal] confirms actuals.**

| Data | Proposed retention | Rationale |
|---|---|---|
| Active session state (session ID, in-progress conversation) | 24 hours idle | Return-within-day continuity |
| Full conversation transcript | **30 days** | Debugging + quality review. PII-dense, so short. |
| Handoff record (persona + wishlist + summary) | **Aligned with Swoop's CRM retention** | This is a sales lead. Same policy as any other inbound lead. |
| Lead email in sales inbox | **Swoop's existing mail retention** | Not separately governed — part of normal sales comms |
| GCP / Cloud Run request logs (IP, request metadata) | 30 days | Security / ops minimum |
| Aggregate anonymous metrics (conversation counts, handoff rates, no PII) | Indefinite | Product improvement |

**Triggers for earlier deletion**:
- User deletion request → full deletion within 30 days of receipt
- Sales closure (lead won / lost / archived) → follows CRM rules

**[Swoop legal]** — confirm.

---

## 9. High-risk / sensitive edge cases

Worth flagging to counsel even if unlikely. The agent's WHY-layer prompts handle these in-conversation; the principle is that the *handoff record* shouldn't persist sensitive info beyond what the sales conversation genuinely needs.

- **Minors** interacting with the agent — not Swoop's target market but possible. No age gate in V1. If material minor traffic appears, revisit. **[Swoop legal]** — confirm risk tolerance.
- **Medical / dietary / accessibility disclosures** — users may volunteer these to get relevant trip advice ("my partner has a heart condition and we want a soft-adventure trip"). The agent must not give medical advice; should defer to specialists + safety pages. The handoff record can note accessibility needs (already in the schema) but should not persist granular medical detail. **[Al's proposal]**.
- **Crisis / self-harm content** — WHY-layer prompts route these away from sales flow, surface relevant resources, don't submit a handoff. **[Al's proposal]**.
- **Abusive / trolling users** — handled by the `disqualified` triage path (`03-handoff-schema.md` §2.3). Logged, not emailed.
- **Competitor or pricing disputes** — deflected to a specialist, not negotiated by the agent.
- **Free-text prompts that reveal sensitive info incidentally** — e.g. religion, sexuality, political views surfaced as part of trip preferences. The transcript retention window (§8) limits exposure; the handoff summary should only carry what's relevant to the sales conversation.

---

## 10. Action items

### Before build starts

- [ ] **[Swoop]** Confirm scope of this doc with Swoop legal; agree a review window.
- [ ] **[Swoop legal]** Confirm whether the existing privacy notice covers an AI chat tool or needs extending.
- [ ] **[Swoop]** Confirm existing cookie / consent banner — Al's chat plugs into it rather than adding its own.
- [ ] **[Swoop legal]** Confirm DPA status with Anthropic (direct or via Vertex), GCP, and any mail provider.
- [ ] **[Swoop]** Confirm preferred GCP region for data residency.

### Before V1 launch

- [ ] **[Swoop legal]** Sign off disclosure copy (§7).
- [ ] **[Swoop legal]** Sign off retention policy (§8).
- [ ] **[Swoop]** Privacy notice updated on site.
- [ ] **[Swoop legal]** DPAs in place for every processor in §5.
- [ ] **[Al]** Deletion runbook delivered to Swoop's team.
- [ ] **[Swoop]** Incident-response plug-in point confirmed.

### Post-launch

- [ ] **[Swoop legal]** Quarterly review of retention against real conversion patterns.
- [ ] **[Al + Swoop]** Review checkpoint ~June 2026 when EU Code of Practice finalises (~0.5 day review).

---

## 11. Open questions for Swoop

| # | Question | Who answers |
|---|---|---|
| 1 | Does your existing privacy notice cover AI chat / automated conversational processing, or needs extension? | Swoop legal |
| 2 | What's the shape of your existing cookie / consent banner, and how does the chat plug into it? | Swoop engineering + legal |
| 3 | Are you already an Anthropic customer with a DPA (direct or via Vertex)? | Swoop |
| 4 | Preferred GCP region for Cloud Run + Vertex data residency? | Swoop |
| 5 | What's your current CRM retention policy — what should the handoff record's lifetime align to? | Swoop sales + legal |
| 6 | Do you want conversation transcripts stored with the handoff record, or referenced by link only? | Swoop sales + legal |
| 7 | Existing incident-response runbook — where does this chat plug in? | Swoop ops |
| 8 | Legal counsel: who, and what's an achievable review SLA for §7 + §8 sign-off? | Swoop |
| 9 | Any jurisdiction-specific obligations for source markets (US / CA / EU) we should flag? | Swoop legal |
| 10 | Geolocation-from-IP as a future personalisation input (Julie, 20 Apr) — is that a V2 conversation, and how is consent handled when it lands? | Swoop + Al |
