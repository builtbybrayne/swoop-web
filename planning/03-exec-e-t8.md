# 03 — Execution: E.t8 Compliance Bundle for Legal Counsel

**Status**: Tier 3 execution plan. Draft, 2026-04-29.
**Chunk**: E (handoff & compliance).
**Implements**: [`02-impl-handoff-and-compliance.md`](02-impl-handoff-and-compliance.md) §2.9 (legal counsel review workflow) + §10 order-of-execution item E.t8.
**Depends on**:
- E.t1 (✅ shipped 2026-04-24) — verdict / reason taxonomy + payload shape; informs the data flow diagram.
- E.t2 / E.t3 / E.t4 (✅ shipped 2026-04-28) — the actual data flow the bundle documents (consent → orchestrator → connector → store → mailer).
- E.t5 (⏸ open, blocks legal copy section) — `product/cms/legal/{disclosure-opening,disclosure-chrome,consent-handoff,consent-marketing,privacy-info}.md`. The bundle's "disclosure copy" + "consent flow" sections cannot be filled in until E.t5 lands.
- E.t6 (⏸ open, post-IAM) — retention enforcement mechanism. Doesn't block the bundle's *policy* section (values are decided in E.6/E.7/E.8); the *enforcement* paragraph lands once the Cloud Run Job exists.
- E.t7 (⏸ open, parked) — data-deletion runbook. Bundle references it but doesn't author it.
- D.t4 (✅ shipped) — disclosure UI components. Source of the consent-flow screenshots once E.t5 swaps placeholder strings for real copy.
- C.18 / E.10 / C.23 — Postgres single-store posture; informs the processor list + data flow diagram.

**Blocks**: E.t9 (legal counsel review). E.t9 cannot start without the bundle in their hands. M5 release gate.

**Produces** (this task):
- `planning/03-exec-e-t8.md` (this file).
- `product/cms/legal/compliance-bundle/README.md` — table of contents + status legend + handoff process to legal counsel.
- `product/cms/legal/compliance-bundle/01-overview.md` — what Puma is, who's processing what data, jurisdictional posture (EU AI Act + UK/EU GDPR).
- `product/cms/legal/compliance-bundle/02-data-flow.md` — mermaid diagram + narrative; **fillable now**, references real components from shipped code.
- `product/cms/legal/compliance-bundle/03-disclosure-copy.md` — placeholder; **blocked on E.t5**.
- `product/cms/legal/compliance-bundle/04-consent-flow.md` — placeholder + screenshot slots; **blocked on E.t5** (real copy required for non-misleading screenshots).
- `product/cms/legal/compliance-bundle/05-retention-policy.md` — **fillable now**; pulls values from decisions E.6/E.7/E.8.
- `product/cms/legal/compliance-bundle/06-processors.md` — **partially fillable now**; Anthropic + Google Cloud known, SMTP provider TBC, DPAs sourced from Swoop's vendor agreements.
- `product/cms/legal/compliance-bundle/07-dpas.md` — **blocked on Swoop legal**; pointer-only file listing which DPAs need sourcing and from where.
- `product/cms/legal/compliance-bundle/08-data-subject-rights.md` — **fillable now** in policy form; runbook reference blocked on E.t7.
- `product/cms/legal/compliance-bundle/09-review-checklist.md` — what we want from counsel, in tickable form.
- `product/cms/legal/compliance-bundle/screenshots/.gitkeep` — placeholder dir for consent-flow screenshots (blocked on E.t5).

**Estimate**: ~2 h focused work for the structure + fillable sections. Filling the blocked sections is mechanical once E.t5 lands (~30 min for disclosure-copy + consent-flow + screenshots) and quick once Swoop sources DPAs (~15 min for processor section finalisation).

---

## Purpose

E.t8 is **packaging**, not authoring. The bundle is a single coherent artefact Swoop's legal counsel reviews — it pulls together every compliance surface Puma exposes (disclosure copy, consent flow, retention, processors, DPAs, data flow) so counsel reviews the whole posture in one pass, not piecemeal.

The reason this T3 plan exists ahead of E.t5 (legal copy) is **structural**: the bundle skeleton + the dependency graph + the fillable-vs-blocked split is exactly the kind of work that prevents the bundle being a last-minute scramble. Once E.t5 lands, the placeholder files swap to real copy via straight content paste; once Swoop sources DPAs, those files swap from pointers to attached PDFs. No structural rework.

This task **does not** author legal copy (that's E.t5), does not produce screenshots (blocked on E.t5 real copy), and does not source DPAs (Swoop legal counsel scope per E.10).

---

## Component map

| # | Component | File | Status today | Blocked on | Notes |
|---|---|---|---|---|---|
| 1 | Bundle README | `compliance-bundle/README.md` | ✅ Fillable now | — | TOC + legend + handoff process. |
| 2 | Overview | `compliance-bundle/01-overview.md` | ✅ Fillable now | — | What Puma is + jurisdictional posture. |
| 3 | Data flow diagram | `compliance-bundle/02-data-flow.md` | ✅ Fillable now | — | Mermaid + narrative. References real shipped components. |
| 4 | Disclosure copy | `compliance-bundle/03-disclosure-copy.md` | 🔴 Placeholder | E.t5 | Body file is the literal `cms/legal/disclosure-opening.md` etc; bundle includes a transclusion pointer + placeholder note. |
| 5 | Consent flow | `compliance-bundle/04-consent-flow.md` | 🔴 Placeholder | E.t5 (copy) → screenshots | Walks through tier-1 + tier-2 + marketing opt-in with screenshots. |
| 6 | Retention policy | `compliance-bundle/05-retention-policy.md` | ✅ Fillable now | — | Decisions E.6/E.7/E.8 closed. Enforcement paragraph notes "scheduled job lands in E.t6". |
| 7 | Processor list | `compliance-bundle/06-processors.md` | 🟡 Partial | E.5 (SMTP) + E.t5 (privacy-info copy) | Anthropic + Google Cloud known. SMTP TBC. |
| 8 | DPAs | `compliance-bundle/07-dpas.md` | 🔴 Pointer-only | Swoop legal sources | Names which DPAs are needed + where they live. |
| 9 | Data-subject rights | `compliance-bundle/08-data-subject-rights.md` | ✅ Fillable now (policy) | E.t7 (runbook link) | Right-to-erasure / access / rectification posture. Runbook link is a forward-reference. |
| 10 | Review checklist | `compliance-bundle/09-review-checklist.md` | ✅ Fillable now | — | What we want counsel to confirm + tickbox form. |
| 11 | Screenshots dir | `compliance-bundle/screenshots/` | 🔴 Empty | E.t5 | `.gitkeep` only. |

**Status legend** used inside each file's frontmatter / top-of-file note:

- ✅ **FILLED** — production-ready content; legal counsel can review.
- 🟡 **PARTIAL** — some content present, named gaps remain. Bundle reviewer can read but counsel cannot finalise sign-off.
- 🔴 **BLOCKED / PLACEHOLDER** — structure only; content lands when the named blocker resolves.

---

## Dependency graph

```
                                                    (legal counsel sign-off)
                                                              │
                                                              ▼
                                                          [ E.t9 ]
                                                              ▲
                                                              │
                                                       [ E.t8 bundle ]
                                                              ▲
                  ┌───────────────────────┬──────────────────┼──────────────────┬─────────────────────────┐
                  │                       │                  │                  │                         │
        ✅ retention policy     ✅ data flow diagram      🔴 disclosure copy   🔴 consent flow         🔴 DPAs (Swoop legal sources)
        (E.6/E.7/E.8 closed)    (shipped code today)         ▲ E.t5             ▲ E.t5 + screenshots
                  │                       │                  │                  │
                  │                       │           ✅ E.t5 placeholder strings inline today
                  │                       │           (functional but legally insufficient)
                  │                       │
        ⏸ E.t6 enforcement       (no upstream)
        Cloud Run Job
        (post-IAM, post-Postgres)
```

**Critical-path implication**: the bundle can ship to legal at ~80% completeness once E.t5 lands. DPAs and the SMTP processor entry can land in a follow-up pass — counsel will likely want to see the bundle anyway and may surface DPA-specific asks (for example, may insist on a particular Anthropic terms vintage, may ask for a Google Cloud DPA print-out). Better to expose the gaps explicitly than to wait for completeness.

---

## Section-by-section authoring brief

### 1. README (`compliance-bundle/README.md`)

**Purpose**: orient legal counsel + provide the document map + state of completeness.

**Content (this task delivers)**:
- One-paragraph framing: "This bundle packages the compliance-relevant surfaces of Puma, Swoop's website discovery tool. Counsel review is the M5 gate."
- Status legend (✅ / 🟡 / 🔴 as above).
- Document map (table of files with one-line description + current status).
- Handoff process: where to direct questions (Al, until handover; Swoop's named owner post-handover), expected SLA from counsel (TBC — `questions.md`), how feedback is incorporated.
- Version note: bundle version + last-updated date. Manually maintained for now (a pre-handover task can move to git-driven if useful).

### 2. Overview (`compliance-bundle/01-overview.md`)

**Purpose**: counsel-facing context for what Puma is and why the compliance surfaces matter.

**Content (this task delivers)**:
- What Puma is (one paragraph): website discovery tool, conversational AI, qualified-lead handoff, Patagonia-only scope at launch.
- Personal data Puma touches: visitor messages (free-form, may contain PII at visitor's discretion), explicit name + email + preferred contact at handoff, derived metadata (session id, timestamps, turn count).
- Lawful basis: explicit consent (tier 1 conversation start; tier 2 contact submission). GDPR Art. 6(1)(a). Legitimate-interest pathway considered and rejected — see §X of this overview.
- Jurisdictional posture: Puma's visitors include EU + UK residents. EU AI Act applies extraterritorially; UK + EU GDPR applies. No US-specific posture (CCPA/CPRA assumed n/a for now; flag for counsel if visitor mix changes).
- Scope statement: this bundle covers Puma. Does **not** cover (a) Swoop's CRM or downstream lead lifecycle, (b) Swoop's website beyond the chat surface, (c) Swoop's general privacy posture (counsel reviews those separately).

### 3. Data flow (`compliance-bundle/02-data-flow.md`)

**Purpose**: counsel + DPO can see at a glance where personal data goes, who processes it, and where it rests.

**Content (this task delivers)**:
- **Mermaid diagram** showing: Visitor → Tier-1 consent screen (D component) → Chat UI (`@swoop/ui`) → Orchestrator (`@swoop/orchestrator`, Cloud Run) → Anthropic API (model calls, US/EU region TBC) → Connector (`@swoop/connector`, in-process today) → Handoff store (`FsHandoffStore` interim, Cloud SQL Postgres post-IAM) → Mailer (nodemailer + SMTP, provider TBC) → Sales inbox.
- **Narrative walkthrough**: per-edge, what data crosses, whether it's transient or persisted, retention TTL.
- **Component-to-decision map**: links each box to the planning doc + decision that anchors it (E.10 for store, E.13 for submit path, E.4 for consent etc.).
- **Out-of-band channels noted**: Cloud Logging (chunk F events; processor = Google Cloud), no other third-party telemetry, no third-party analytics in the chat surface itself.

### 4. Disclosure copy (`compliance-bundle/03-disclosure-copy.md`) 🔴

**Purpose**: counsel reviews the actual visitor-facing copy.

**Content (this task delivers — placeholder)**:
- Status header: 🔴 BLOCKED on E.t5.
- File pointer: "Final copy lives in `product/cms/legal/{disclosure-opening,disclosure-chrome,consent-handoff,consent-marketing,privacy-info}.md`. This bundle file transcludes / quotes those files once E.t5 lands."
- Today's UI strings (copied from the shipped components verbatim, with a clear "PLACEHOLDER — DO NOT TREAT AS LEGALLY REVIEWED" banner) so counsel sees the *shape* of the disclosure today even if the words aren't final.
- Pointer to E.t5 plan (when authored) for the authoring approach.

**Post-E.t5 action**: replace placeholder banner + UI strings with the real copy from `cms/legal/`. Mechanical paste; ~5 min.

### 5. Consent flow (`compliance-bundle/04-consent-flow.md`) 🔴

**Purpose**: counsel can audit the consent journey end-to-end with screenshots.

**Content (this task delivers — placeholder)**:
- Status header: 🔴 BLOCKED on E.t5 (real copy required for non-misleading screenshots).
- Step-by-step textual walkthrough of the consent journey:
  1. First visit → tier-1 disclosure + consent (placeholder copy today).
  2. Continue → conversation begins; persistent chrome tag visible.
  3. Agent triggers handoff → lead-capture widget renders.
  4. Visitor fills name + email, ticks tier-2 consent, optionally ticks marketing opt-in.
  5. Submit → POST `/handoff/submit` → durable record with both consent timestamps + copy version id → optional email.
- Screenshot slots (file links into `screenshots/` dir, currently empty).
- Decision references: E.4 (two-tier), E.13 (submit path), E.14 (server enrichment), E.15 (consent timestamp).
- Backstop summary: orchestrator + connector both reject submissions without both consent flags (D consent gate + connector backstop).

**Post-E.t5 action**: capture screenshots in dev preview (placeholder copy first, then real copy after E.t5 review iteration), drop them in `screenshots/`, link in this file.

### 6. Retention policy (`compliance-bundle/05-retention-policy.md`) ✅

**Purpose**: counsel sees the retention TTLs + lawful basis for each retention window.

**Content (this task delivers — FILLED)**:
- In-progress sessions: 24h idle → archive; 7d archive → delete (decision E.8).
- Submitted handoffs (qualified / referred_out): 12 months or until CRM ingestion, whichever sooner (decision E.6).
- Submitted handoffs (disqualified): 90 days for analytics, then delete (decision E.7).
- Logs: 30 days in Cloud Logging by default; longer via BigQuery export (chunk F).
- Enforcement: planned scheduled Cloud Run Job running parameterised SQL `DELETE … WHERE scheduled_deletion_at < NOW()` against the Postgres `handoff` table on a daily schedule. **Note: enforcement lands in E.t6 once Cloud SQL Postgres swap completes (post-IAM); today's interim `FsHandoffStore` does not auto-delete. Files persist on the orchestrator's local disk until manually purged. This is acceptable for the pre-launch interim because (a) no real visitor traffic, (b) `var/handoffs/` is gitignored, (c) the directory lives on dev/staging machines, not production.**
- Right to erasure: per-request manual process today (E.t7 runbook); scheduled enforcement is for the auto-expiry side, not the erasure side.

### 7. Processor list (`compliance-bundle/06-processors.md`) 🟡

**Purpose**: counsel sees every third party that processes personal data, with DPA pointer.

**Content (this task delivers — PARTIAL)**:
- **Anthropic** (model calls): Claude Sonnet 4.5 + Claude Haiku 4.5. Personal data exposure: visitor messages (transient, not stored by Anthropic by default per Anthropic API terms — confirm vintage with counsel). Region: TBC; default Anthropic API may route US-side. DPA: Anthropic's standard terms (Swoop legal to source from Swoop's vendor agreements or `https://www.anthropic.com/legal/`).
- **Google Cloud Platform** (Cloud Run + future Cloud SQL Postgres + Cloud Logging): hosting + durable store + telemetry. Personal data exposure: full handoff record at rest (post-Postgres swap), session state in memory, log entries. Region: planned `europe-west2` (London) — confirm with Thomas. DPA: Google Cloud's standard DPA (Swoop legal sources from existing GCP contract or `https://cloud.google.com/terms/data-processing-addendum`).
- **SMTP provider** (mail delivery): 🟡 **Provider TBC pending Julie** (`questions.md`). Default candidates: Postmark, SES, Mailgun, or Swoop's existing SMTP. Personal data exposure: handoff email body (visitor name + email + conversation summary). Region + DPA: provider-specific, finalise once Julie confirms.
- **Out-of-scope (NOT processors)**: assistant-ui (Vercel-published OSS, not a runtime SaaS); local nodemailer transport (library, not a processor — the SMTP provider is the actual processor).

**Post-E.5 + Swoop-DPA action**: replace SMTP TBC with provider name + DPA reference; update region for Anthropic + Google Cloud once Thomas confirms.

### 8. DPAs (`compliance-bundle/07-dpas.md`) 🔴

**Purpose**: counsel sees the actual DPA documents Puma's processors operate under.

**Content (this task delivers — POINTER ONLY)**:
- Status header: 🔴 BLOCKED on Swoop legal sourcing.
- Required DPAs:
  1. Anthropic — standard commercial terms / DPA. Source: Swoop's existing Anthropic vendor agreement, or Anthropic's published DPA template if no commercial agreement.
  2. Google Cloud — standard DPA. Source: Swoop's existing GCP contract.
  3. SMTP provider — provider-specific DPA. Blocked on E.5 provider selection.
- Action for counsel / Swoop legal: attach DPA copies (PDF) to this directory or insert links to the canonical hosted versions. Note any deviations from standard terms.
- Self-attached DPAs (none today): if Puma adds a custom processor, the DPA goes here.

### 9. Data subject rights (`compliance-bundle/08-data-subject-rights.md`) ✅

**Purpose**: counsel sees the policy + the operational answer for each GDPR/UK GDPR right.

**Content (this task delivers — FILLED with one runbook forward-reference)**:
- **Right to be informed** (Arts. 12–14): satisfied by the disclosure-opening screen + persistent chrome tag + privacy-info page. (Copy reviewed in §3 of this bundle.)
- **Right of access** (Art. 15): per-request manual process. Visitor emails Swoop's privacy contact; recipient queries the handoff store by email address; relevant record(s) returned. Runbook: `product/cms/legal/runbooks/data-access.md` (forward-reference; lands in a follow-up to E.t7 if not bundled).
- **Right to rectification** (Art. 16): per-request manual; same channel as access.
- **Right to erasure** (Art. 17): per-request manual. Runbook: `product/cms/legal/runbooks/data-deletion.md` (E.t7, currently parked — link is forward-reference).
- **Right to restriction / objection / portability** (Arts. 18–21): assessed case-by-case. Puma stores narrow data (handoff record + transient session); portability is satisfied by exporting the JSON record on request.
- **Right to withdraw consent** (Art. 7(3)): tier-1 withdrawal closes the chat + deletes session state on the spot; tier-2 withdrawal triggers the erasure runbook.
- **Right not to be subject to automated decision-making** (Art. 22): n/a — Puma's triage classifier is not a "decision producing legal effects". Sales follow-up is human-led. Flag for counsel review.
- **Complaint contact**: visitors directed to Swoop's privacy contact (per Swoop's existing privacy policy). Puma does not handle complaints directly.

### 10. Review checklist (`compliance-bundle/09-review-checklist.md`) ✅

**Purpose**: counsel ticks through the review surfaces; produces a single artefact for M5 sign-off.

**Content (this task delivers — FILLED, tickbox form)**:
- Disclosure copy reviewed and approved? `[ ]`
- Tier-1 consent journey reviewed and approved? `[ ]`
- Tier-2 consent journey reviewed and approved? `[ ]`
- Marketing opt-in copy + behaviour reviewed and approved? `[ ]`
- Privacy-info page reviewed and approved? `[ ]`
- Retention TTLs match counsel's expectation under GDPR Art. 5(1)(e)? `[ ]`
- Processor list complete? `[ ]`
- Anthropic DPA on file? `[ ]`
- Google Cloud DPA on file? `[ ]`
- SMTP provider DPA on file? `[ ]`
- Data flow diagram represents reality? `[ ]`
- Right-to-erasure runbook reviewed? `[ ]` (defers to E.t7)
- DPIA needed? Counsel determination: `[ ] yes / [ ] no` — if yes, separate task.
- EU AI Act Art. 50 disclosure satisfied? `[ ]`
- Outstanding queries / amendments: free-text section.
- Sign-off: counsel name + date + signature.

### 11. Screenshots (`compliance-bundle/screenshots/`) 🔴

**Purpose**: holds PNG / JPG captures of the consent journey for §4.

**Content (this task delivers)**: `.gitkeep` only. Naming convention specified in §4 (e.g. `01-tier1-disclosure.png`, `02-chrome-tag.png`, `03-handoff-widget.png`, `04-confirmation.png`).

**Post-E.t5 action**: capture in dev preview against real legal copy.

---

## Out of scope for this task

- Authoring legal copy (E.t5).
- Producing screenshots (blocked on E.t5; lands as a follow-up pass to this task).
- Sourcing DPA PDFs from Swoop's vendor agreements (Swoop legal scope per E.10).
- Authoring the data-deletion runbook (E.t7, currently parked).
- Authoring the data-access runbook (deferred; not currently a named subtask but implied by §8 of this bundle — flag for triage).
- Running the legal counsel review (E.t9; blocks M5).
- Translating the bundle into other languages (no-scope at Puma; UK/EU-English-only at launch).

## Verification

E.t8's deliverable from this task is correctly landed when:

1. The bundle directory exists at `product/cms/legal/compliance-bundle/` with all 11 components per the map above.
2. Every file has a status header (✅ / 🟡 / 🔴) consistent with the map.
3. Filled sections (1, 2, 3, 6, 9, 10) read end-to-end without gaps that should already be filled.
4. Blocked sections (4, 5, 8 disclosure-copy/consent-flow/DPAs) name their blocker explicitly + cite the upstream task.
5. The data flow diagram renders in any markdown viewer that supports mermaid (GitHub, Obsidian, VS Code preview).
6. The review checklist is a tickable artefact a non-engineer counsel can mark up.
7. README transparently states current bundle status so counsel doesn't get stale-reference surprise.

When E.t5 lands, the post-E.t5 fillable actions take ~30 min and bring the bundle to ~95%. SMTP-provider + DPAs close the last 5%.

## Open sub-questions for follow-up

- Bundle versioning: should the README track a semver-style version, or just last-updated date? Defer until first real iteration with counsel — they'll signal what they want.
- Format: counsel may want a single PDF rather than markdown directory. Pandoc one-shot from this dir is trivial; defer until counsel asks.
- Data-access runbook: implicitly named in §8 but not a tracked task. **Flag for HITL: should this be a sibling of E.t7 (runbook for visitor access requests) or merged into E.t7 since the operational shape is the same `psql … WHERE email=…` query, just `SELECT` not `DELETE`?**
- DPIA threshold: counsel may determine one is needed despite the §1 framing. If so, it's a sibling task to E.t8, not part of E.t8.
- "AI Pat Chat" GCP project location confirmation (Thomas) — affects §6 Google Cloud region statement.

## PoC carry-forward pointers

None directly — the PoC didn't have a compliance bundle. The shape here is informed by Al's prior client work + GDPR-recital-driven structure. Reference for the ChatGPT App's privacy framing was Swoop's existing privacy policy (which Puma doesn't replace, just extends).

---

## Hand-off process to legal counsel (post-task)

1. E.t5 lands → fill placeholder sections (3, 4) with real copy + capture screenshots.
2. Swoop legal sources Anthropic + GCP DPAs → drop into §7.
3. Julie confirms SMTP provider → fill §6 SMTP entry + source provider DPA → drop into §7.
4. Bundle status updates from "PARTIAL" → "READY FOR REVIEW" in README.
5. Al packages directory → sends to Swoop's nominated counsel contact (TBC, `questions.md`).
6. Counsel reviews → ticks §10 checklist → returns with comments.
7. Iterate until sign-off.
8. E.t9 closes; M5 unblocked.
