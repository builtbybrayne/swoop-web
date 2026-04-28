# 07 — Data Processing Agreements

> **Status: 🔴 BLOCKED / POINTER ONLY**
>
> **Blocked on**: Swoop legal sourcing DPAs from existing vendor agreements. This file lists which DPAs are needed, where they're typically obtained, and what the action items are.
>
> **What lands here when sourced**: PDF copies of each DPA stored in this directory as `dpa-<vendor>.pdf`, with this file updated to reference the attached files + note any deviations from standard terms.

---

## Required DPAs

### 1. Anthropic 🔴

- **Vendor**: Anthropic, PBC.
- **Purpose**: model API processing (visitor messages → Claude → response).
- **Source pathway**:
  - **Preferred**: Swoop's existing commercial Anthropic agreement, if one exists with explicit data-processing terms.
  - **Fallback**: Anthropic's standard published Commercial Terms / DPA from [https://www.anthropic.com/legal/](https://www.anthropic.com/legal/) — the public commercial terms include data-protection provisions.
- **Action owner**: Swoop legal (sourcing) + Al (chase-up if needed).
- **Vintage**: counsel should confirm the version reviewed matches Swoop's commercial relationship vintage.

### 2. Google Cloud Platform 🔴

- **Vendor**: Google LLC / Google Cloud EMEA Limited.
- **Purpose**: hosting (Cloud Run), durable storage (Cloud SQL planned), telemetry (Cloud Logging).
- **Source pathway**:
  - **Preferred**: Swoop's existing Google Cloud contract — DPA is typically attached as part of the Cloud Services Agreement.
  - **Fallback**: Google Cloud's standard published DPA from [https://cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum).
- **Action owner**: Swoop legal (sourcing). Thomas (Swoop ops) likely has the contract reference.
- **Vintage**: counsel should confirm version + sub-processor list vintage.

### 3. SMTP provider 🔴

- **Vendor**: TBC pending Julie confirmation. See [06-processors.md](06-processors.md) §3.
- **Purpose**: handoff email delivery.
- **Source pathway**: provider-specific.
- **Action owner**: Swoop legal once provider is selected; Al (chase-up).
- **Blocking**: this DPA can't be sourced until §3 of [06-processors.md](06-processors.md) closes.

---

## Self-issued / Swoop ↔ Puma processing relationship

If counsel determines that the relationship between Puma (operated by Al / Buddy Apps) and Swoop requires a written agreement clarifying processor roles for the period before handover, Al + Swoop will execute one. **This is a counsel determination, not a default.** Most likely shape:

- **Swoop** = controller (decides why + how data is processed).
- **Al / Buddy Apps** = processor for the engagement period only.
- Post-handover, Swoop operates Puma directly + the processor relationship dissolves.

If counsel asks for this, Al has standard processing-agreement templates that can be adapted; alternatively counsel can draft.

---

## Layout for landed DPAs

When DPAs are sourced, store them in this directory next to this file:

```
07-dpas.md                 (this file — pointer + updates)
dpa-anthropic.pdf          (when sourced)
dpa-google-cloud.pdf       (when sourced)
dpa-smtp-<provider>.pdf    (when sourced)
dpa-buddy-apps.pdf         (only if counsel asks for one)
```

Update this file's "Required DPAs" section as each lands — flip status 🔴 → ✅, add a one-line note if any deviation from standard terms.

---

## Counsel review questions for this section

- Are the standard published DPAs from Anthropic / Google Cloud sufficient, or do you want commercial-tier addenda for Puma's specific processing?
- Sub-processor lists — do you want each vendor's current list as supporting documentation, or is the DPA's general sub-processor clause sufficient?
- Is a Buddy-Apps-as-processor agreement needed for the pre-handover period? (Counsel determination.)
- Are there other vendor relationships you'd want to add to this list given Puma's scope? (E.g. CDN, monitoring, error tracking — Puma doesn't currently use any but you may want a forward-look statement.)

---

## When this section unblocks

- All three required DPAs sourced and attached as PDFs (or hosted-link references).
- "Required DPAs" table above flips all entries to ✅.
- README document map updates section 07 to ✅ FILLED.
