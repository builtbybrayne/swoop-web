# 08 — Data Subject Rights

> **Status: ✅ FILLED** — production-ready for counsel review (policy form). Forward-references the runbook in E.t7 for the operational mechanics of erasure / access requests.

---

## Posture

Puma processes personal data under **explicit consent** (GDPR Art. 6(1)(a), two-tier per decision E.4). All Articles 12-22 rights apply. The data scope is narrow (handoff record + transient session) so the operational shape per right is small.

**Per-request manual process** (decision **E.9**) — no self-service data-subject-rights portal in Puma. Visitors contact Swoop's privacy contact via Swoop's existing privacy infrastructure; Swoop's recipient runs the appropriate runbook.

---

## Per-right policy + operational answer

### Right to be informed (Arts. 12-14)

**Policy**: visitors are informed at the start (tier-1 disclosure + paired primary consent) and on demand (privacy-info page link from both consent screens + persistent chrome tag).

**Operational**: copy reviewed by counsel as part of [03-disclosure-copy.md](03-disclosure-copy.md). Privacy-info page (`product/cms/legal/privacy-info.md`) covers controller identity, contact, purposes, lawful basis, recipients, retention, data-subject rights, complaint routes, withdrawal.

**Status**: structure ✅; copy 🔴 blocked on E.t5.

### Right of access (Art. 15)

**Policy**: visitors entitled to a copy of their handoff record + any associated session state still held.

**Operational**:
1. Visitor emails Swoop's privacy contact requesting access.
2. Recipient runs the data-access runbook (forward-reference: `product/cms/legal/runbooks/data-access.md` — **see [HITL flag](#hitl-flag) below**).
3. Recipient queries handoff store by email address: `SELECT * FROM handoff WHERE contact_email = $1` (Postgres) or `grep`-style on `var/handoffs/*.json` (interim).
4. Returns JSON record (or human-readable export) to visitor.
5. Logs the access request fulfilment.

**SLA**: GDPR-standard 1 month, extendable to 3 months for complex cases.

### Right to rectification (Art. 16)

**Policy**: visitors can correct inaccuracies in their handoff record.

**Operational**: same channel as access. Recipient updates the record's relevant field via SQL `UPDATE` (post-Postgres) or JSON edit (interim). Logged. **In practice, since Puma data is mostly visitor-volunteered, "rectification" is rare — typically a name spelling correction or contact update.**

### Right to erasure (Art. 17 — "right to be forgotten")

**Policy**: visitors can request deletion of their handoff record at any time.

**Operational**:
1. Visitor emails Swoop's privacy contact requesting erasure.
2. Recipient runs the data-deletion runbook: **`product/cms/legal/runbooks/data-deletion.md`** (forward-reference; runbook lands in E.t7, currently parked).
3. Recipient queries store by email, deletes matching record(s) (`DELETE FROM handoff WHERE contact_email = $1` or `rm var/handoffs/<id>.json`).
4. Confirmation logged with minimal metadata (record id + deletion timestamp; not record content).
5. Confirmation sent to visitor.

**SLA**: GDPR-standard 1 month.

**Backup window caveat**: erased records may persist in Cloud SQL automated backups for up to 7 days (default backup retention). Standard practice; counsel to confirm acceptability per [05-retention-policy.md](05-retention-policy.md).

### Right to restriction of processing (Art. 18)

**Policy**: visitors can request processing restriction (data held but not actively used) under specific Art. 18 conditions.

**Operational**: per-request manual. In practice, Puma's data isn't "actively used" in the standard sense — it sits in the store, gets ingested into Swoop's CRM by sales staff, then deleted. Restriction = pause CRM ingestion + not delete + flag the record. Manual process; rare. Counsel can advise if a more structured pathway is needed.

### Right to data portability (Art. 20)

**Policy**: visitors entitled to receive their data in a structured, machine-readable format.

**Operational**: handoff record's JSON form is already structured + machine-readable. Same channel as access. Recipient exports the JSON record + sends to visitor.

### Right to object (Art. 21)

**Policy**: visitors can object to processing under Art. 6(1)(f) legitimate-interest. Puma's lawful basis is consent (Art. 6(1)(a)), not legitimate-interest, so Art. 21 has limited application — the parallel right is **withdrawal of consent** under Art. 7(3).

**Exception**: disqualified-handoff retention (90 days for analytics) is framed under Art. 6(1)(f) legitimate-interest balancing. Visitors who become aware of the disqualified record (rare — they didn't submit contact in the disqualified path, so awareness is unusual) can object; recipient deletes immediately.

### Right not to be subject to solely automated decision-making (Art. 22)

**Policy**: Art. 22 protections apply when an automated decision produces "legal effects" or "similarly significant effects" on the individual.

**Puma posture**: Puma's triage classifier categorises visitors (qualified / referred_out / disqualified), but this is **not** an Art. 22 decision because:

- The classifier output is a routing signal, not a binding decision affecting the visitor's legal status or substantive rights.
- Sales follow-up is **human-led** — a qualified visitor receives a human specialist's call; a disqualified visitor receives no call but is not denied service in any binding sense (they can still browse Swoop's site, contact via existing channels, etc.).
- The classifier's verdict can be revised by the human specialist after handoff.
- No automated denial of service, contract, or commercial offer.

**Counsel review**: confirm this framing satisfies Art. 22, or flag if counsel reads the bar differently. If counsel disagrees, Puma needs to add an explicit "human review before any consequence" surface — but our framing is that no consequence is automated to begin with.

### Right to withdraw consent (Art. 7(3))

**Policy**: consent can be withdrawn as easily as it was given.

**Operational**:

- **Tier-1 withdrawal during conversation**: dedicated UI control closes the chat + deletes session state on the spot. (Confirm UI prominence with counsel — see [04-consent-flow.md](04-consent-flow.md).)
- **Tier-1 withdrawal post-conversation**: same as Art. 17 erasure — emails the privacy contact, recipient deletes session state if still held (most session state is short-TTL and already deleted by retention enforcement).
- **Tier-2 withdrawal (post-handoff)**: same as Art. 17 erasure — handoff record deleted via the deletion runbook.

**Marketing opt-in withdrawal**: separate from Art. 17. Visitors can withdraw the marketing opt-in via Swoop's existing marketing-unsubscribe pathway (which already handles GDPR Art. 21 + e-Privacy compliance for Swoop's marketing operations).

### Right to lodge a complaint (Art. 77)

**Policy**: visitors can lodge a complaint with their local supervisory authority (UK: ICO; EU: respective DPA).

**Operational**: visitors directed to Swoop's existing complaints channel + told they can contact ICO / their EU DPA directly. Privacy-info page (§03) carries this. Puma does not handle complaints directly.

---

## HITL flag

**Question for triage**: the data-access runbook is implicitly required by §08 Art. 15 ("Operational" step 2 above) but is **not currently a tracked task**. Two viable shapes:

- (a) New sibling task **E.t7a — data-access runbook**, separate from E.t7 deletion runbook.
- (b) Merge into E.t7 — both runbooks have the same operational shape (`psql … WHERE email=…`), just different SQL verb (SELECT vs DELETE). Single runbook with two sections.

Recommendation: **(b)**, since the SLAs, channels, recipients, and audit-logging are identical. Single runbook covers both rights.

Captured in the [E.t8 Tier-3 plan](../../../../planning/03-exec-e-t8.md) "Open sub-questions" section — **Al to triage when E.t7 is unparked.**

---

## DPIA — counsel determination

**Our reading**: Puma's processing is narrow (one form, one durable record per visitor, minimal derived data), the lawful basis is explicit consent, and the Art. 22 surface is empty. Per Art. 35, this isn't an obvious DPIA trigger.

**Counsel reviews**: does Puma cross any DPIA threshold under Art. 35, ICO guidance, or the EDPB's list of processing types requiring DPIA? If yes, a DPIA is a sibling task to E.t8, not part of it.

---

## Privacy contact

Visitors are directed to Swoop's existing privacy contact (per Swoop's existing privacy policy on the marketing site). Puma does not introduce a separate privacy contact.

**Confirm with counsel**: the privacy-info page (§03) cites Swoop's existing contact — counsel should verify this aligns with Swoop's current privacy policy.
