# Puma — Compliance Bundle

The technical-side compliance package for Swoop's legal counsel review of **Puma**, the Patagonia conversational discovery tool. Puma launches via M5; legal sign-off is the M5 gate.

This bundle is **not** legal drafting. It documents what Puma does, what data flows where, what processors are involved, and how the existing GDPR + EU AI Act surfaces are wired. Counsel uses it to assess whether Swoop's existing privacy posture covers Puma, what amendments are needed, and what residual risks remain.

The visitor-facing legal copy (privacy info, disclosures, consent labels) is authored separately under `product/cms/legal/*.md` (top-level files in this directory). Counsel reviews that copy in parallel.

---

## Audience

- **Swoop's legal counsel** — primary reviewer. Receives this bundle, the visitor-facing copy, and signs off (or returns comments) before M5.
- **Julie Isaacs** — engagement owner. Routes external questions, owns the relationship with counsel, decides commercial / scope responses to anything counsel raises.
- **Alastair Brayne (WhaleyBear Ltd)** — author of this bundle and the visitor-facing copy. On hand to clarify any technical question.

---

## What's in the bundle

| File | Purpose |
|---|---|
| `README.md` | This document. |
| `processor-list.md` | Every third-party processor Puma uses, with purpose, data categories, retention, DPA reference. |
| `data-flow.md` | Architecture diagram + prose: visitor → orchestrator → Anthropic / connector / Postgres / SMTP. Identifies trust boundaries. |
| `retention-policy.md` | Retention TTLs for sessions, handoffs, logs. Deletion mechanism (sweeper). Cross-references the visitor-facing `retention.md`. |
| `consent-flow.md` | Two-tier consent model + marketing opt-in. What's collected, what visitors see, what's stored, audit fields. |
| `disclosure-art50.md` | EU AI Act Article 50 specifically: how Puma's chrome badge + opening screen satisfy the "users informed they are interacting with AI" requirement. |
| `gdpr-art-summary.md` | GDPR articles relevant to Puma + how Puma addresses each. |
| `open-questions.md` | Questions counsel needs to answer before sign-off. |
| `screenshots/` | Reserved for screenshots of the disclosure / consent surfaces. To be added before submission. |

---

## What counsel reviews

| Surface | Where | Reviewer | Status |
|---|---|---|---|
| Visitor-facing privacy info | `product/cms/legal/privacy-info.md` | Counsel + Swoop privacy-policy owner | Drafted by Al; awaiting review |
| Visitor-facing disclosure (opening) | `product/cms/legal/disclosure-opening.md` | Counsel | Drafted by Al; awaiting review |
| Persistent chrome disclosure | `product/cms/legal/disclosure-chrome.md` | Counsel | Drafted by Al; awaiting review |
| Tier-2 consent label (handoff) | `product/cms/legal/consent-handoff.md` | Counsel | Drafted by Al; awaiting review |
| Marketing opt-in label | `product/cms/legal/consent-marketing.md` | Counsel | Drafted by Al; awaiting review |
| Retention policy (visitor-facing) | `product/cms/legal/retention.md` | Counsel | Drafted by Al; awaiting review |
| **This bundle** | `product/cms/legal/compliance-bundle/` | Counsel | Drafted; awaiting review |
| Swoop privacy policy amendment | Swoop's website / privacy page | Swoop legal + comms | Open question (see `open-questions.md`) |
| Data Processing Agreements | Swoop ↔ Anthropic, Swoop ↔ GCP, Swoop ↔ SMTP provider | Swoop legal | Procurement loop, Swoop-driven |

---

## M5 sign-off gate

M5 ("Legal sign-off + ready for embed") cannot ship until counsel has:

1. Reviewed and approved (or returned amendments to) the visitor-facing copy.
2. Reviewed and approved this bundle.
3. Confirmed Swoop's existing privacy policy is amended (or not required to be amended) to cover Puma.
4. Confirmed cross-border data flows (Anthropic US, GCP region) are covered by Swoop's existing DPAs.
5. Decided whether a DPIA is required (default position: argued not required in `gdpr-art-summary.md`; counsel has final call).

Sign-off route: counsel returns the bundle marked up, with a written confirmation that M5 can proceed. Open items in `open-questions.md` get answers; new items raised by counsel get filed against Swoop's privacy policy amendment workstream or against Puma's Tier 3 backlog as appropriate.

---

## Coordination

- **Authoring**: Al (this bundle + visitor-facing copy).
- **Implementation**: separate Tier 3 tasks own retention enforcement (E.t6), data-deletion runbook (E.t7), and consent-flow code (E.t4). Cross-references in each document point to the implementing artefact.
- **Sending to counsel**: Julie owns the send + iteration loop. SLA unknown (tracked in `open-questions.md`).

---

## Living document

Puma is the first shipped release. Subsequent releases (Antarctica candidate; group-tour expansions) will require re-review of any surface that changes — new processors, new retention scope, new data categories. This bundle is the template; future releases edit it rather than start fresh.
