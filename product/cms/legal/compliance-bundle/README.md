# Puma — Compliance Bundle

**Bundle version**: 0.1 (skeleton)
**Last updated**: 2026-04-29
**Owner pre-handover**: Al Brayne (al@buddyapps.co)
**Owner post-handover**: TBC (Swoop)
**Audience**: Swoop's legal counsel (M5 sign-off review)
**Tracking task**: [planning/03-exec-e-t8.md](../../../../planning/03-exec-e-t8.md)

---

## What this is

This bundle packages the compliance-relevant surfaces of **Puma**, Swoop's website discovery tool — the conversational AI lead-qualification chat live on Swoop's Patagonia pages.

Counsel review of this bundle is the **M5 release gate**. Nothing ships to real visitors without a sign-off on the §09 checklist.

The bundle is intentionally a directory of small markdown files rather than a single document — each surface (disclosure copy, consent flow, retention policy, processor list, DPAs, data flow diagram, data-subject rights) is small enough to review in isolation, and counsel may delegate sections to specialists. If a single PDF is preferred, Pandoc this directory or ask Al.

---

## Status legend

Each file's frontmatter / top-of-file note shows its current status:

| Marker | Meaning |
|---|---|
| ✅ **FILLED** | Production-ready content. Counsel can review. |
| 🟡 **PARTIAL** | Some content present, named gaps remain. Counsel can read but cannot finalise sign-off until gaps close. |
| 🔴 **BLOCKED / PLACEHOLDER** | Structure only; content lands when the named upstream blocker resolves. |

---

## Document map

| # | File | Status | Description |
|---|---|---|---|
| 1 | [01-overview.md](01-overview.md) | ✅ FILLED | What Puma is, what personal data it touches, lawful basis, jurisdictional posture. |
| 2 | [02-data-flow.md](02-data-flow.md) | ✅ FILLED | Mermaid diagram + narrative walkthrough of every edge that personal data crosses. |
| 3 | [03-disclosure-copy.md](03-disclosure-copy.md) | 🔴 BLOCKED | Visitor-facing AI disclosure + consent copy. **Blocked on E.t5** (legal copy authoring). |
| 4 | [04-consent-flow.md](04-consent-flow.md) | 🔴 BLOCKED | Step-by-step consent journey + screenshots. **Blocked on E.t5** (real copy required for non-misleading screenshots). |
| 5 | [05-retention-policy.md](05-retention-policy.md) | ✅ FILLED | Retention TTLs + lawful basis per data type. Enforcement note flags E.t6 dependency. |
| 6 | [06-processors.md](06-processors.md) | 🟡 PARTIAL | Anthropic + Google Cloud known. SMTP provider TBC pending Julie. |
| 7 | [07-dpas.md](07-dpas.md) | 🔴 BLOCKED | Pointer-only. **Blocked on Swoop legal sourcing DPAs** from existing vendor agreements. |
| 8 | [08-data-subject-rights.md](08-data-subject-rights.md) | ✅ FILLED | Per-right policy + operational answer. Forward-references E.t7 runbook. |
| 9 | [09-review-checklist.md](09-review-checklist.md) | ✅ FILLED | Tickable counsel sign-off artefact. |
| – | [screenshots/](screenshots/) | 🔴 EMPTY | Consent-flow capture dir. Populated post-E.t5. |

**Bundle current state**: ~60% filled (5 of 9 sections), ~80% structurally complete, **not yet ready for counsel review**. Reaches "ready" once E.t5 lands and Swoop sources DPAs.

---

## Handoff process to counsel

1. Bundle reaches "READY FOR REVIEW" status — README updates accordingly.
2. Al packages this directory + screenshots → sends to Swoop's nominated counsel contact (contact TBC, see [questions.md](../../../../questions.md) "Legal review SLA").
3. Counsel reviews, ticks the [09 checklist](09-review-checklist.md), returns with comments.
4. Iteration: blocker / amendment items get tracked in `questions.md` until closed.
5. Counsel signs §09 → E.t9 closes → M5 unblocks.

**Expected SLA**: TBC. Tracked in [questions.md](../../../../questions.md). Biggest schedule risk for M5.

---

## Outstanding queries (counsel-facing)

These are the questions we already know we want counsel to answer. The bundle's §09 checklist captures the tickbox version; this list keeps the prose form for context.

- Does the tier-1 disclosure copy (in §03 once E.t5 lands) satisfy EU AI Act Art. 50?
- Are Puma's retention TTLs (§05) defensible under GDPR Art. 5(1)(e) data-minimisation?
- Is a DPIA required given Puma's processing pattern? (Our framing: the data is minimal, the lawful basis is explicit consent, no Art. 22 automated decision-making — we don't think so, but counsel determines.)
- Are the standard Anthropic + Google Cloud DPAs sufficient, or does Swoop's posture require addenda?
- US visitor traffic — Puma's launch is Patagonia-themed and EU/UK-heavy, but does counsel want CCPA/CPRA disclosures pre-emptively?

---

## How to update this bundle

- Each file is markdown. Edit in place.
- Status markers in §01 file frontmatter / top-of-file notes drive the table above. Keep them in sync.
- Update the bundle version + last-updated date in this README on every meaningful change.
- Screenshots go in `screenshots/` with the naming convention from [04-consent-flow.md](04-consent-flow.md).
- DPA PDFs go directly into this directory, named `dpa-<vendor>.pdf`. Reference from [07-dpas.md](07-dpas.md).
