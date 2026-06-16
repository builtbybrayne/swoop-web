# 03 — Disclosure & Consent Copy

> **Status: 🔴 BLOCKED / PLACEHOLDER**
>
> **Blocked on**: E.t5 (legal copy authoring). Tracked in [planning/02-impl-handoff-and-compliance.md §10](../../../../planning/02-impl-handoff-and-compliance.md) order-of-execution item E.t5.
>
> **What lands here when E.t5 closes**: the literal contents of `product/cms/legal/{disclosure-opening,disclosure-chrome,consent-handoff,consent-marketing,privacy-info}.md` (transcluded or quoted in this file), with a note distinguishing each surface from the others.

---

## What this section covers

The visitor-facing copy that constitutes:

1. **EU AI Act Art. 50 disclosure** — visitor is informed they're interacting with an AI.
2. **GDPR tier-1 consent copy** — visitor consents to conversation-data storage.
3. **GDPR tier-2 consent copy** — visitor consents to contact-detail submission + outreach (submission-as-consent — no tickbox).
4. **Privacy-info page copy** — what happens with the data, retention, processors, right-to-deletion, contact.

---

## Authoritative copy locations (post-E.t5)

| Surface | File | Rendered where |
|---|---|---|
| Tier-1 disclosure + consent | `product/cms/legal/disclosure-opening.md` | Opening screen, before first message |
| Persistent chrome tag | `product/cms/legal/disclosure-chrome.md` | Top of chat surface, always visible |
| Tier-2 handoff consent (submission-as-consent) | `product/cms/legal/consent-handoff.md` | Inline notice by the Send button (no tickbox) |
| Privacy-info page | `product/cms/legal/privacy-info.md` | Linked from both consent screens |

---

## Today's UI strings (PLACEHOLDER — DO NOT TREAT AS LEGALLY REVIEWED)

The shipped components today carry **placeholder strings** authored by Al as functional fillers so the consent flow works end-to-end. These are NOT the result of legal review and MUST be replaced before any real visitor sees them.

The strings live inline in the React components today (chunk D, shipped 2026-04-28). E.t5's deliverable is the move to `cms/legal/` files + the rewrite for legal precision.

**Counsel reading this bundle pre-E.t5 should review structure and intent only — not specific wording.**

[E.t5 placeholder strings to be transcribed verbatim into this section once E.t5 starts. Excluding from this skeleton because (a) the placeholders are fluid in the source code, (b) including them risks counsel mis-reading them as final, (c) the structural review counsel can do today is captured in §04 consent flow + §01 overview without needing the strings.]

---

## What counsel will assess (post-E.t5)

When this section fills, counsel will be asked to confirm:

1. **EU AI Act Art. 50 satisfied?** The tier-1 screen names the AI explicitly, names the operator (Swoop), and is unmissable before the first message.
2. **GDPR Art. 7 conditions met?** Consent is freely given (refusing closes the chat without penalty), specific (per-purpose: tier-1 at start, tier-2 at handoff), informed (privacy-info linked), and unambiguous (active acceptance — clicking Continue / clicking Send).
3. **Privacy-info page covers**: identity of controller, contact details, purposes, lawful basis, recipients (processors), retention, data-subject rights, complaint contact, right to withdraw.
4. **Withdrawal pathway clear?** How does the visitor revoke consent? (Today: tier-1 withdrawal closes the chat; tier-2 withdrawal triggers the erasure runbook.)

---

## Versioning

The disclosure-copy + consent-copy files are **versioned by content hash**: every handoff record persists the version id of the copy the visitor saw. This gives counsel a clean audit trail per record. Implementation lands as part of E.t5.

Counsel should confirm whether content-hash versioning is sufficient or whether semver-style version labels are preferred for the audit log.

---

## When this section unblocks

- E.t5 lands.
- Real copy in `cms/legal/` is reviewed-and-approved by counsel via this bundle.
- Section status updates ✅ FILLED in [README](README.md) document map.
