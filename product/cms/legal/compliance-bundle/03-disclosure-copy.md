# 03 — Disclosure & Consent Copy

> **Status: 🟡 DEFERS TO LEGAL REVIEW PACK**
>
> The reviewable, authored visitor-facing copy now lives in the **legal review pack** (`planning/swoop-legal-review-pack.md`, §4 — Copy table). That document is the counsel-facing front door for copy review. This file provides the structural walkthrough and authoritative file locations; for specific wording, open the pack.
>
> This file previously carried a "BLOCKED / PLACEHOLDER — do not review wording" alarm tied to E.t5. That blocker is resolved: the copy table in the pack (§4.1–§4.6) is the authored draft, open for counsel track-changes and comment.

---

## What this section covers

The visitor-facing copy that constitutes:

1. **EU AI Act Art. 50 disclosure** — visitor is informed they're interacting with an AI.
2. **GDPR tier-1 consent copy** — visitor consents to conversation-data storage.
3. **GDPR tier-2 consent copy** — visitor consents to contact-detail submission + outreach (submission-as-consent — clicking *Send* after the inline notice; no tickbox, no marketing consent collected).
4. **Privacy-info page copy** — what happens with the data, retention, processors, right-to-deletion, contact.

---

## Authoritative copy locations

| Surface | Canonical source for counsel review | Runtime file (post-E.t5) |
|---|---|---|
| Tier-1 disclosure + consent | Pack §4.1 (`opening.*` IDs) | `product/cms/legal/disclosure-opening.md` |
| Persistent chrome badge | Pack §4.2 (`chrome.*` IDs) | `product/cms/legal/disclosure-chrome.md` |
| Privacy info modal | Pack §4.3 (`privacy.*` IDs) | `product/cms/legal/privacy-info.md` |
| Tier-2 handoff consent (submission-as-consent) | Pack §4.4 (`lead-capture.*` IDs) | `product/cms/legal/consent-handoff.md` |
| Handoff emails (sales-facing) | Pack §4.6 (`email.*` IDs) | `product/cms/legal/email-templates/` |

All copy IDs in the pack are machine-readable; counsel edits the **Draft** column and leaves the ID column untouched. Lope extracts edits by ID and applies them to the live surface.

---

## What counsel will assess

1. **EU AI Act Art. 50 satisfied?** The tier-1 screen names the AI explicitly, names the operator (Swoop), and is unmissable before the first message. The persistent chrome badge satisfies the "throughout the interaction" leg.
2. **GDPR Art. 7 conditions met?** Consent is freely given (refusing closes the chat without penalty), specific (per-purpose: tier-1 at start, tier-2 at handoff), informed (privacy-info linked), and unambiguous (active acceptance — clicking Continue / clicking Send).
3. **Privacy-info page covers**: identity of controller, contact details, purposes, lawful basis, recipients (processors), retention, data-subject rights, complaint contact, right to withdraw.
4. **Withdrawal pathway clear?** Tier-1 withdrawal closes the chat; tier-2 withdrawal triggers the erasure runbook.
5. **No marketing consent**: Puma does not collect marketing opt-in. Tier-2 is submission-as-consent for the specialist handoff only.

---

## Versioning

The disclosure-copy + consent-copy files are **versioned by content hash**: every handoff record persists the version id of the copy the visitor saw. This gives counsel a clean audit trail per record. Implementation lands as part of E.t5.

Counsel should confirm whether content-hash versioning is sufficient or whether semver-style version labels are preferred for the audit log (decision **D-3.2.4** in the pack).
