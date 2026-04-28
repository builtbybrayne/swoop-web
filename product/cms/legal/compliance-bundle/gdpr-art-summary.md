# GDPR — articles addressed

How Puma addresses each GDPR article relevant to its scope. Counsel uses this to confirm the technical posture matches Swoop's interpretation of each obligation.

UK GDPR is treated as equivalent to EU GDPR for the purposes of this document; differences are flagged where they affect Puma materially (none expected at M5).

---

## Art. 6 — Lawful basis for processing

**Basis chosen**: Art. 6(1)(a) — explicit consent of the data subject.

**Why not legitimate interest (Art. 6(1)(f))?** Legitimate interest could plausibly cover *some* of Puma's processing — particularly the storage of non-PII conversational text for service-provision purposes. But:

- Puma freely receives PII inside visitor messages (visitors offer name, destination, budget signals, sometimes email mid-conversation before the formal handoff). Treating any of that as legitimate-interest-only would require a per-field assessment that's expensive to maintain and easy to get wrong.
- Explicit consent is the cleanest defence under regulator scrutiny.
- The cost of explicit consent is one screen at the start. Visitors who don't want to engage close the iframe; visitors who do click Continue. There is no measurable conversion harm versus the alternative.

**How realised**: tier-1 consent at conversation start, tier-2 consent at handoff submission. See `consent-flow.md`.

---

## Art. 7 — Conditions for consent

The four GDPR consent conditions:

| Art. 7 condition | How Puma meets it |
|---|---|
| **Demonstrable** | Each consent grant is recorded in session state and snapshot onto the durable handoff record at submission, with `copyVersion` (hash of the consent copy at the time) and timestamp. Recoverable for any historical record. See `consent-flow.md` "Audit / `copyVersion`". |
| **Distinguishable from other matters, intelligible, plain language** | Disclosure-opening.md and consent-handoff.md are written in plain English. Marketing opt-in is granular and visually separate from the handoff consent (different paragraph, different default state). |
| **Withdrawable** (and "as easy to withdraw as to give") | Visitor can close the iframe at any time (no further data accumulates beyond the TTL). Right-to-erasure runbook handles requests for full deletion (`runbooks/data-deletion.md`). Marketing communications carry their own unsubscribe (Swoop marketing platform's responsibility). |
| **Freely given, specific, informed** | Tier-1 consent is required to chat — but visitors are not coerced; declining is a clean exit with no service penalty (because there is no other Swoop service being held back). Tier-2 consent is specific to the handoff act; marketing opt-in is a separate, optional grant. |

A note on "freely given" for tier-1: regulator guidance is sceptical of consent gates that block service access. Puma's defence is that the alternative (browsing Swoop's website without the chat tool) remains fully available — declining tier-1 leaves the visitor on the underlying Patagonia pages exactly as before. The chat is an optional discovery surface, not a gate to substantive Swoop content.

Counsel should confirm this characterisation holds.

---

## Art. 13 — Information to be provided at collection

The privacy-info content (`product/cms/legal/privacy-info.md`, authored by E.t5) covers the Art. 13 disclosures:

- Identity of the controller (Swoop) — pointing to Swoop's existing privacy policy for the formal contact + DPO route.
- Purposes of the processing (conversational discovery + handoff to sales).
- Lawful basis (consent, with a link back to the consent surfaces).
- Recipients of the personal data (Swoop sales team; processors per `processor-list.md`).
- Cross-border transfers (Anthropic US — see `open-questions.md` for the SCC / adequacy discussion).
- Retention periods (linking to `retention.md` visitor-facing).
- Rights of the data subject (access, erasure, rectification, portability, objection, withdrawal of consent).
- Right to lodge a complaint with the supervisory authority (UK ICO for UK; relevant EU DPA for EU visitors).

Linked from the disclosure-opening screen and the chrome badge — the visitor can reach it before consenting and at any point during the conversation.

---

## Art. 15 — Right of access

The data-deletion runbook (`runbooks/data-deletion.md`, E.t7) covers the technical mechanism for retrieving a visitor's record by email address. Art. 15 access requests follow the same retrieval path; the runbook will be extended (or a sibling runbook added) to cover the access-only case where the visitor wants a copy of their data without deletion.

For Puma launch (M5), access requests are handled out-of-band by Swoop's privacy contact, who runs the same retrieval query but returns the record contents to the visitor instead of deleting.

Counsel should confirm whether a separate runbook is needed for Art. 15 specifically, or whether the data-deletion runbook is the right home for both flows.

---

## Art. 17 — Right to erasure

Implemented via the data-deletion runbook (`runbooks/data-deletion.md`, E.t7). Manual / Swoop-operated; not a self-service UI in Puma (decision E.9 — the traffic volume doesn't justify a self-service surface yet).

The runbook covers:
- Receiving the request at Swoop's documented privacy contact.
- Locating the handoff record by email.
- Hard-deleting the record + any session state still alive for that visitor.
- Confirming back to the visitor (with a minimal audit log entry — confirmation, not content).

Right-to-erasure overrides the standard retention TTLs (`retention-policy.md`).

---

## Art. 25 — Data protection by design and by default

Puma's privacy-by-design choices:

- **Content-as-data**: legal copy is loaded at runtime from `product/cms/legal/`, not inlined in TypeScript. Counsel can review without engineering.
- **No PII in event logs**: the structured event schema (`product/ts-common/src/events.ts` — F-a / F-b) carries verdicts, reason codes, latencies, error codes — never message bodies, never contact details. Even Swoop engineers debugging production cannot accidentally see what visitors typed.
- **No cross-session memory**: two visits from the same browser produce two unlinked sessions. There is no user account, no cookie, no server-side cross-session linkage.
- **Reasoning is not exposed**: the agent's private reasoning blocks are never streamed to the visitor's browser (translator filters; UI has a `reasoning-guard` that throws in dev if one slips through).
- **Consent versioning**: the `copyVersion` hash on every consent record means we always know what text the visitor saw.
- **Strict schemas**: `HandoffPayloadDisqualifiedSchema.strict()` rejects any payload that leaks `contact` onto a disqualified record — schema-level guarantee that we never inadvertently retain contact details for a disqualified visitor.
- **Single-tenant by design**: no multi-tenant data model, no cross-customer linkage.

---

## Art. 32 — Security of processing

Technical + organisational measures:

- **Transport**: all visitor ↔ orchestrator and service ↔ service traffic over HTTPS / TLS. SMTP delivery uses STARTTLS or TLS-only depending on provider.
- **Authentication**:
  - Anthropic API key + SMTP credentials live in GCP Secret Manager (post-M4). Pre-M4 they live in `.env` files locally and are not present on any deployed surface.
  - Service-account IAM scoping per Cloud Run service (orchestrator and connector each have a least-privilege service account).
- **Data at rest**: Cloud SQL encrypts at rest by default (Google-managed keys; CMEK available if Swoop wants).
- **Logging**: structured events are PII-free by schema; raw request bodies are not logged.
- **Backups**: Cloud SQL automated backups; retention configurable per Swoop preference.
- **Vulnerability management**: dependency-scanning is part of the CI pipeline (`A.t5`-era posture; tightened pre-M5).
- **Access control to production**: post-M5 ownership transfers to Swoop's in-house team; the master engagement contract governs WhaleyBear's residual access.

---

## Art. 35 — Data Protection Impact Assessment (DPIA)

**Position**: a DPIA is **arguably not required** for Puma, but counsel has the final call.

**Argument against DPIA being required**:
- Puma is not "high risk" under Art. 35(1) criteria. It does not involve:
  - Systematic and extensive evaluation of personal aspects (no profiling that produces legal effects).
  - Processing of special-category data on a large scale (no health, genetic, biometric, etc.).
  - Systematic monitoring of a publicly accessible area.
- The processing scale is modest (visitor traffic to Swoop's Patagonia pages, a fraction of which engage with the chat).
- Decision-making is transparent and disclosed (Art. 50 + the conversational nature of the surface).
- The processor list is bounded and uses tier-1 cloud providers (Anthropic, GCP) with mature DPAs.

**Argument for DPIA being prudent regardless**:
- AI systems engaging with consumers attract scrutiny; a documented DPIA is cheaper than a regulator inquiry without one.
- The EU AI Act's recitals encourage DPIA-style impact assessment for AI systems generally, even where Art. 35 GDPR doesn't strictly require one.
- Future Puma evolutions (Antarctica, group-tour expansions, CRM integration) might cross the threshold; building the DPIA artefact now is reusable.

**Recommendation**: counsel decides. If DPIA is required, this bundle is most of the input — `data-flow.md`, `processor-list.md`, `retention-policy.md`, `consent-flow.md`, and this document together cover the bulk of a DPIA's content.

See `open-questions.md` for the open item.

---

## Art. 28 — Processor obligations

Each processor in `processor-list.md` is engaged under a DPA (or, for the SMTP provider, will be at selection). Counsel's role:

- Confirm Swoop holds Anthropic's standard DPA (or that Anthropic's commercial terms include sufficient processor obligations).
- Confirm Swoop's existing GCP Customer DPA covers Cloud Run, Cloud Logging, Cloud SQL, Secret Manager (single addendum typically covers all).
- Establish DPA at SMTP-provider selection.
- Confirm Imgix terms cover the existing usage (likely already in place via Swoop's website infra).

WhaleyBear Ltd's status (sub-processor or master-contract-covered) is `open-questions.md`.

---

## Cross-border data flows

Puma transfers personal data outside the EU/UK in two places:

1. **Anthropic API (US)** — visitor messages + conversation history per turn. Standard Contractual Clauses (SCCs) apply via Anthropic's DPA. Counsel should confirm the SCC version Anthropic uses is current and covers Swoop's transfer.
2. **GCP region (TBC)** — if the AI Pat Chat project is provisioned in an EU region, no transfer occurs. If a non-EU region is selected for any reason, SCCs apply via the GCP Customer DPA.

Schrems II / transfer-impact-assessment work for the Anthropic flow is the open question for counsel — see `open-questions.md`.

---

## What is *not* in scope

For clarity:

- **Children's data (Art. 8)**: Swoop's adventure travel offering is not directed at under-16s. Visitors self-identify as adults via the act of seeking adventure travel. No child-specific consent flow is implemented. Counsel may want to confirm Swoop's existing privacy policy aligns.
- **Special-category data (Art. 9)**: Puma neither requests nor processes special-category data. Visitors might volunteer it (e.g. mentioning a health condition while discussing a trek). The system has no mechanism to recognise or specially handle such data; it lives in the session-state-and-handoff record under the general regime. Counsel may want to advise on a flag for accidental disclosure.
- **Automated individual decision-making (Art. 22)**: Puma's triage verdict (qualified / referred_out / disqualified) does not produce a legal effect or significantly affect the visitor. The verdict gates whether Swoop sales receives a warm-hand-off email; declining to be a Swoop customer is not a legal effect. Art. 22 likely does not apply, but counsel may confirm.
