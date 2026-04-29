# 09 — Counsel Review Checklist

> **Status: ✅ FILLED** — tickable artefact for Swoop's legal counsel. M5 sign-off depends on completion.

---

## How to use this

Counsel ticks each item as reviewed-and-approved. Items that fail review get amended in the appropriate bundle section + the checklist re-walked.

The checklist is preserved with counsel's name + sign-off date at the end as the M5 audit artefact.

---

## A. Visitor-facing copy

- [ ] **Tier-1 disclosure copy** (§03 — `disclosure-opening.md`): EU AI Act Art. 50 satisfied?
- [ ] **Tier-1 disclosure copy**: GDPR Art. 7 conditions for primary consent met (freely given, specific, informed, unambiguous)?
- [ ] **Persistent chrome tag** (§03 — `disclosure-chrome.md`): satisfies the "throughout the interaction" leg of Art. 50?
- [ ] **Tier-2 handoff consent copy** (§03 — `consent-handoff.md`): meets Art. 7 conditions for the handoff-specific purpose?
- [ ] **Marketing opt-in copy** (§03 — `consent-marketing.md`): genuinely separate, unticked-by-default, unambiguously distinguishable from service-consent?
- [ ] **Privacy-info page** (§03 — `privacy-info.md`): covers Art. 13/14 information requirements (controller, contact, purposes, lawful basis, recipients, retention, rights, complaint route, withdrawal)?

## B. Consent flow mechanics

- [ ] **Tier-1 declined path**: visitor can decline cleanly with no penalty? (Step 1 → No thanks closes chat without state.)
- [ ] **Tier-2 declined path**: visitor can refuse handoff submission without losing prior conversation context?
- [ ] **Withdrawal pathway**: tier-1 withdrawal control sufficiently prominent in the chat UI?
- [ ] **Marketing opt-in default**: confirmed unticked by default?
- [ ] **Backstops**: dual layer (orchestrator route + connector consent gate) acceptable?
- [ ] **Consent timestamp client-side capture** (E.15): acceptable as the GDPR audit "moment of consent"?
- [ ] **Copy versioning** (content-hash per record): sufficient for audit, or is semver-style preferred?

## C. Retention

- [ ] **In-progress sessions** (24h idle / 7d archive): defensible under Art. 5(1)(e)?
- [ ] **Qualified / referred_out handoffs** (12mo or CRM-ingestion): defensible?
- [ ] **Disqualified handoffs** (90 days, Art. 6(1)(f) legitimate-interest framing): defensible?
- [ ] **Cloud Logging events** (30d default): adequate?
- [ ] **Interim "no automatic enforcement" posture**: acceptable pre-launch with no real traffic, or do you want a manual sweep cadence documented?
- [ ] **Backup window for erasure** (up to 7 days in Cloud SQL automated backups): acceptable under Art. 17?

## D. Processors

- [ ] **Anthropic** as processor: terms reviewed?
- [ ] **Anthropic DPA** on file? (See §07.)
- [ ] **Anthropic API region**: EU routing required, or is default acceptable?
- [ ] **Google Cloud** as processor: terms reviewed?
- [ ] **Google Cloud DPA** on file? (See §07.)
- [ ] **Google Cloud region** (`europe-west2` planned): confirmed acceptable?
- [ ] **SMTP provider** (TBC): once selected, terms reviewed?
- [ ] **SMTP provider DPA** on file? (See §07.)
- [ ] **Sub-processor lists**: Anthropic + Google Cloud current vintage acceptable?
- [ ] **Privacy-info page lists all three processors** with region + retention summaries?

## E. DPAs

- [ ] All three DPAs (Anthropic, Google Cloud, SMTP) attached or hosted-link referenced? (See §07.)
- [ ] **Buddy-Apps-as-processor agreement**: needed for the pre-handover period? (Counsel determination.)

## F. Data flow

- [ ] **Mermaid diagram** (§02): represents reality?
- [ ] **Boundary statement** (§02 — three exit points): accurate + complete?
- [ ] **No third-party analytics in chat surface**: confirmed acceptable framing?

## G. Data-subject rights

- [ ] **Per-right policy** (§08): operational answer per right is defensible?
- [ ] **Manual per-request process** (decision E.9): acceptable, or do you want a self-service portal?
- [ ] **Data-deletion runbook** (referenced; landing in E.t7): structure acceptable in advance, or wait for runbook to land?
- [ ] **Data-access runbook**: triage HITL flag — separate task or merged into E.t7? (See §08 HITL flag.)
- [ ] **Art. 22 framing** (Puma is not solely automated decision-making): counsel confirms?

## H. DPIA

- [ ] **DPIA needed?** Counsel determination: ☐ yes / ☐ no.
- [ ] If yes, DPIA scope agreed?

## I. EU AI Act

- [ ] **Art. 50 disclosure** (tier-1 + chrome tag): satisfied?
- [ ] **Art. 50 chatbot-specific provisions**: any Puma-specific flag counsel wants to raise?
- [ ] **GPAI / high-risk system classification**: Puma's framing is "limited-risk AI system" (chatbot disclosure obligation only) — counsel confirms?

## J. Cross-references

- [ ] **Swoop's existing privacy policy**: aligned with Puma's posture? Any updates required to Swoop's policy to incorporate Puma?
- [ ] **Swoop's existing complaints channel**: adequate for visitors who want to lodge complaints about Puma?
- [ ] **Swoop's existing marketing-unsubscribe**: handles tier-2 marketing opt-in withdrawal?

---

## Outstanding queries / amendments

(Free-text section for counsel to record items that don't fit the tickbox form.)

```
[Counsel to fill in]
```

---

## Sign-off

- **Counsel name**: __________________________
- **Firm / role**: __________________________
- **Date of review**: __________________________
- **Bundle version reviewed**: __________________________
- **Outstanding amendments**: ☐ none / ☐ tracked above
- **Sign-off status**: ☐ approved / ☐ approved with amendments / ☐ revisions required

**Signature**: __________________________

---

## Post-sign-off

- Sign-off captured here closes E.t9 and unblocks M5.
- Any post-sign-off amendments (e.g. SMTP provider lands later) re-trigger a delta-review.
