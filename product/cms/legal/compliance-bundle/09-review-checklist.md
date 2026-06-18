# 09 — Counsel Review Checklist

> **Status: ✅ FILLED** — tickable artefact for Swoop's legal counsel. M5 sign-off depends on completion.

---

## How to use this

Counsel ticks each item as reviewed-and-approved. Items that fail review get amended in the appropriate bundle section + the checklist re-walked.

The checklist is preserved with counsel's name + sign-off date at the end as the M5 audit artefact.

---

## A. Visitor-facing copy

- [ ] **Tier-1 disclosure copy** (pack §4.1 / `disclosure-opening.md`): EU AI Act Art. 50 satisfied?
- [ ] **Tier-1 disclosure copy**: GDPR Art. 7 conditions for primary consent met (freely given, specific, informed, unambiguous)?
- [ ] **Persistent chrome badge** (pack §4.2 / `disclosure-chrome.md`): satisfies the "throughout the interaction" leg of Art. 50?
- [ ] **Tier-2 handoff consent copy** (pack §4.4 / `consent-handoff.md`): meets Art. 7 conditions for the handoff-specific purpose (submission-as-consent, no tickbox)?
- [ ] **Privacy-info page** (pack §4.3 / `privacy-info.md`): covers Art. 13/14 information requirements (controller, contact, purposes, lawful basis, recipients, retention, rights, complaint route, withdrawal)?

## B. Consent flow mechanics

- [ ] **Tier-1 declined path**: visitor can decline cleanly with no penalty? (Step 1 → No thanks closes chat without state.)
- [ ] **Tier-2 declined path**: visitor can refuse handoff submission without losing prior conversation context?
- [ ] **Withdrawal pathway**: tier-1 withdrawal control sufficiently prominent in the chat UI?
- [ ] **Backstops**: dual layer (orchestrator route + connector consent gate) acceptable?
- [ ] **Consent timestamp client-side capture** (E.15): acceptable as the GDPR audit "moment of consent"?
- [ ] **Copy versioning** (content-hash per record): sufficient for audit, or is semver-style preferred?

## C. Retention

- [ ] **In-progress sessions** (24h idle / 7d archive, wired enforcement): defensible under Art. 5(1)(e)?
- [ ] **Qualified / referred_out handoffs** (360-day outer bound or CRM-ingestion): defensible?
- [ ] **Disqualified handoffs** (90 days, Art. 6(1)(f) legitimate-interest framing): defensible?
- [ ] **Event / server logs** (retention per deployment log policy — shape-dependent): adequate?
- [ ] **Backup window for erasure** (shape-dependent: ops-configured on single-VM; ~7-day PITR on managed Postgres): acceptable under Art. 17?

## D. Processors

- [ ] **Anthropic** as processor: terms reviewed?
- [ ] **Anthropic DPA** on file? (See §07.)
- [ ] **Anthropic API region**: EU routing required, or is default acceptable?
- [ ] **Google — Gemini API** as processor (model-provider for query embeddings): terms reviewed?
- [ ] **Gemini API terms** on file or decision made to move to Vertex AI? (See §07 instrument 2.)
- [ ] **Gemini API region**: no EU pinning on public API — acceptable, or move to Vertex AI?
- [ ] **Gemini paid tier**: confirmed launch uses paid key (required for "not used to train" promise)?
- [ ] **Google Cloud** as processor: terms reviewed?
- [ ] **Google Cloud DPA** on file? (See §07.)
- [ ] **Google Cloud region** (`europe-west2` working default): confirmed acceptable?
- [ ] **SMTP provider** (TBC): once selected, terms reviewed?
- [ ] **SMTP provider DPA** on file? (See §07.)
- [ ] **Sub-processor lists**: Anthropic + Google Cloud current vintage acceptable?
- [ ] **Privacy-info page lists all four processors** with region + retention summaries?

## E. DPAs

- [ ] All four instruments (Anthropic DPA, Gemini API terms, Google Cloud DPA, SMTP DPA) attached or hosted-link referenced? (See §07.)
- [ ] **Buddy-Apps-as-processor agreement**: needed for the pre-handover period? (Counsel determination.)

## F. Data flow

- [ ] **Mermaid diagram** (§02): represents reality?
- [ ] **Boundary statement** (§02 — four exit points: Anthropic, Google Gemini API, Google Cloud, SMTP): accurate + complete?
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
