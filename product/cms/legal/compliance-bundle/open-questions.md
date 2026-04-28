# Open questions for legal counsel

Questions Swoop's legal counsel needs to answer before M5 sign-off. Each carries enough context to act on. Routing notes (Julie / counsel / Swoop ops) at the end of each item.

The list also surfaces in the project-level `questions.md` under "Compliance".

---

## 1. SMTP provider choice + DPA

**Question**: which transactional email provider should Puma use, and does Swoop hold (or need to obtain) a DPA with that provider?

**Context**: handoff emails are delivered to Swoop's sales inbox via SMTP whenever a conversation produces a `qualified` or (variant treatment, lightweight) `referred_out` verdict. The provider is currently TBC — env vars `HANDOFF_EMAIL_*` are stubbed pending selection.

Candidates: Postmark, Amazon SES, Mailgun, Swoop's own SMTP, Gmail (PoC pattern, not production).

**Decision needed by**: M3 (handoff end-to-end working) — this gates the email delivery path.

**Routing**: Julie selects (with Swoop ops input on existing infra); counsel confirms DPA position once selected.

---

## 2. Swoop privacy policy amendment

**Question**: does Swoop's existing privacy policy require amendment to mention the Puma chat tool, and if so what is the minimum change?

**Context**: Puma adds a new processing surface (conversational AI with retention, two new processors — Anthropic and the SMTP provider — beyond Swoop's current processor list). The Art. 13 information-at-collection obligations are met inside Puma via `privacy-info.md`, but Swoop's *site-wide* privacy policy is a separate surface and may need to acknowledge the chat tool's existence.

**Decision needed by**: M5 (legal sign-off + ready for embed).

**Routing**: counsel + Swoop's privacy-policy owner (Julie can route).

---

## 3. DPIA requirement

**Question**: is a Data Protection Impact Assessment required for Puma under Art. 35 GDPR?

**Context**: see `gdpr-art-summary.md` Art. 35 section. Puma does not appear to meet the Art. 35(1) high-risk thresholds, but counsel has the final call. If required, this bundle is most of the input.

**Decision needed by**: M5.

**Routing**: counsel decides. If yes, Al supports counsel in producing the DPIA from the bundle.

---

## 4. Cookie banner ↔ iframe interaction

**Question**: does the parent page's cookie banner need to cover the iframe's `sessionStorage` use, or is the iframe's own disclosure-opening screen sufficient?

**Context**: Puma's iframe stores a session id in `sessionStorage` (browser-side, scoped to the iframe origin). No cookies. No `localStorage`. The iframe is served from a Swoop-controlled origin; it does not interact with the parent page's storage.

PECR / ePrivacy guidance treats `sessionStorage` similarly to cookies for consent purposes — but it's typically considered "strictly necessary" for service operation (the session id is what connects a visitor's messages to their server-side session). Whether Swoop's existing cookie banner needs to mention it is a position counsel can settle.

**Decision needed by**: M5.

**Routing**: counsel.

---

## 5. Cross-border data flows — Anthropic + GCP

**Question**: are the cross-border transfers to Anthropic (US) and (potentially) the chosen GCP region adequately covered by Swoop's existing DPAs and SCCs?

**Context**: see `gdpr-art-summary.md` "Cross-border data flows" + `processor-list.md` Anthropic + GCP entries.

- **Anthropic**: standard SCCs apply via Anthropic's DPA. Schrems II transfer-impact-assessment may be relevant.
- **GCP region**: TBC at provisioning. If the AI Pat Chat project is in an EU region (e.g. `europe-west2`), no transfer occurs. If for any reason it's provisioned outside the EU/UK, SCCs apply via the GCP Customer DPA.

**Decision needed by**: M4 (deployment) for the GCP region; M5 for the Anthropic SCC confirmation.

**Routing**: counsel reviews the Anthropic DPA + SCC posture; Swoop ops (Thomas) confirms the GCP region at provisioning and reports back.

---

## 6. WhaleyBear Ltd — sub-processor status

**Question**: does the master engagement contract between Swoop and WhaleyBear Ltd already treat WhaleyBear as a GDPR sub-processor, or is a separate sub-processor agreement required?

**Context**: WhaleyBear Ltd (Alastair Brayne's limited company) authors and operates Puma during the engagement. Default expectation post-M5: Swoop's in-house team operates the system; WhaleyBear's residual access is governed by the master contract.

**Decision needed by**: M5.

**Routing**: counsel reviews the existing engagement contract; Julie owns any addendum if required.

---

## 7. Right-of-access runbook

**Question**: should Art. 15 (right of access) requests be handled via the existing data-deletion runbook with an extension, or via a separate runbook?

**Context**: see `gdpr-art-summary.md` Art. 15. The retrieval mechanism is the same (find handoff record by email); the action differs (return contents vs. delete). Currently planned as out-of-band-handled until counsel decides.

**Decision needed by**: M5.

**Routing**: counsel guidance; E.t7 (data-deletion runbook) author implements.

---

## 8. Raw transcript retention on handoff records

**Question**: should the durable handoff record retain the raw conversation transcript alongside the structured summary, or is summary-only the right call?

**Context**: see `retention-policy.md` "What is *not* retained". Currently Puma keeps only the structured payload (motivation anchor, wishlist, agent's freeform reason text). The raw conversation lives in session state and is deleted under the 7-day archived TTL.

Counsel may have views on whether a longer-lived raw transcript is useful for sales follow-up, useful for regulator compliance evidence, or risky for data-minimisation.

**Decision needed by**: M5 (the implementation can be flipped post-M5 but the policy posture should be set).

**Routing**: counsel + Julie.

---

## 9. Special-category data — accidental disclosure handling

**Question**: should Puma flag and specially handle accidental disclosure of special-category data (e.g. a visitor mentioning a health condition while discussing a trek)?

**Context**: see `gdpr-art-summary.md` "What is *not* in scope". Puma neither requests nor processes special-category data, but visitors might volunteer it. The system has no mechanism to recognise such data; it lives in the session and handoff record under the general regime.

Options range from "nothing — visitor's choice to share" to "redaction at log-write time" to "block-and-warn on detection". All have tradeoffs. Counsel can advise on what's proportionate.

**Decision needed by**: M5 (or post-M5 if minor).

**Routing**: counsel.

---

## 10. Legal review SLA + iteration loop

**Question**: what is the expected turnaround for counsel's review of this bundle, and who at Swoop owns chase-ups?

**Context**: M5 is gated on counsel sign-off. Without an SLA the gate has unbounded latency. The 30 Mar engagement quote treats counsel as Swoop-owned ("I handle this simply; available to work with your legal team if they want to go further") — Swoop's counsel relationship is the source of truth here.

**Decision needed by**: at the moment the bundle is sent to counsel.

**Routing**: Julie.

---

## Summary table

| # | Question | Decision needed by | Routing |
|---|---|---|---|
| 1 | SMTP provider + DPA | M3 | Julie + counsel |
| 2 | Swoop privacy policy amendment | M5 | Counsel + Julie |
| 3 | DPIA required? | M5 | Counsel |
| 4 | Cookie banner ↔ iframe `sessionStorage` | M5 | Counsel |
| 5 | Cross-border (Anthropic SCC, GCP region) | M4 / M5 | Counsel + Thomas |
| 6 | WhaleyBear sub-processor status | M5 | Counsel + Julie |
| 7 | Right-of-access runbook scope | M5 | Counsel |
| 8 | Raw transcript retention on handoff records | M5 | Counsel + Julie |
| 9 | Special-category data handling | M5 (or later if minor) | Counsel |
| 10 | Legal review SLA | At bundle send | Julie |
