# 07 — Data Processing Agreements

> **Status: 🔴 BLOCKED / POINTER ONLY** — updated 2026-06-18 (v0.8): four required instruments now listed (Anthropic DPA, Google Cloud DPA, Google Gemini API terms, SMTP provider DPA/terms).
>
> **Blocked on**: Swoop legal sourcing instruments from existing vendor agreements. This file lists which instruments are needed, where they are typically obtained, and what the action items are.
>
> **What lands here when sourced**: PDF copies (or hosted-link references) stored in this directory as `dpa-<vendor>.pdf`, with this file updated to reference them + note any deviations from standard terms.

---

## Required instruments

### 1. Anthropic 🔴

- **Vendor**: Anthropic, PBC.
- **Purpose**: model API processing (visitor messages → Claude → response).
- **Source pathway**:
  - **Preferred**: Swoop's existing commercial Anthropic agreement, if one exists with explicit data-processing terms.
  - **Fallback**: Anthropic's standard published Commercial Terms / DPA from [https://www.anthropic.com/legal/](https://www.anthropic.com/legal/) — the public commercial terms include data-protection provisions.
- **Action owner**: Swoop legal (sourcing) + Al (chase-up if needed).
- **Vintage**: counsel should confirm the version reviewed matches Swoop's commercial relationship vintage.

---

### 2. Google — Gemini API 🔴

- **Vendor**: Google LLC.
- **Purpose**: embedding visitor query text via `gemini-embedding-001` on the public Generative Language API (`generativelanguage.googleapis.com`) — model-provider role for retrieval (D-3.1.10).
- **Governing instrument**: the **Gemini API terms**, *not* the Google Cloud DPA. These are a distinct instrument even though the vendor is the same as processor 3. The Google Cloud DPA covers Cloud infrastructure; it does not extend to the public Gemini API unless the call moves to Vertex AI.
- **If Vertex AI**: moving the embedding call to Vertex AI would bring it under the Google Cloud DPA (instrument 3 below) and enable EU region pinning. Counsel and Swoop to decide (D-3.1.10).
- **Source pathway**:
  - Gemini API terms: [https://ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms)
  - If Vertex AI: covered by the Google Cloud DPA (instrument 3).
- **Action owner**: Swoop legal + Al — confirm which instrument governs before launch.
- **Vintage**: confirm the paid-tier terms (the "not used to train" promise applies on paid tier only).

---

### 3. Google Cloud Platform 🔴

- **Vendor**: Google LLC / Google Cloud EMEA Limited.
- **Purpose**: hosting (Compute Engine VM), durable storage (Postgres on the VM), telemetry (Cloud Logging if adopted).
- **Source pathway**:
  - **Preferred**: Swoop's existing Google Cloud contract — DPA is typically attached as part of the Cloud Services Agreement.
  - **Fallback**: Google Cloud's standard published DPA from [https://cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum).
- **Note**: this DPA covers Cloud infrastructure only. It does not govern the Gemini API embedding call (instrument 2 above) unless that call moves to Vertex AI.
- **Action owner**: Swoop legal (sourcing). Thomas (Swoop ops) likely has the contract reference.
- **Vintage**: counsel should confirm version + sub-processor list vintage.

---

### 4. SMTP provider 🔴

- **Vendor**: TBC pending Swoop confirmation (D-3.3.1). See [06-processors.md](06-processors.md) §4.
- **Purpose**: handoff email delivery.
- **Source pathway**: provider-specific once selected.
- **Action owner**: Swoop legal once provider is selected; Al (chase-up).
- **Blocking**: this instrument can't be sourced until D-3.3.1 closes.

---

## Self-issued / Swoop ↔ Puma processing relationship

If counsel determines that the relationship between Puma (operated by Al / Buddy Apps) and Swoop requires a written agreement clarifying processor roles for the period before handover, Al + Swoop will execute one. **This is a counsel determination, not a default.** Most likely shape:

- **Swoop** = controller (decides why + how data is processed).
- **Al / Buddy Apps** = processor for the engagement period only.
- Post-handover, Swoop operates Puma directly + the processor relationship dissolves.

If counsel asks for this, Al has standard processing-agreement templates that can be adapted; alternatively counsel can draft.

---

## Layout for landed instruments

When instruments are sourced, store them in this directory next to this file:

```
07-dpas.md                       (this file — pointer + updates)
dpa-anthropic.pdf                (when sourced)
dpa-google-cloud.pdf             (when sourced)
gemini-api-terms.pdf             (when sourced; or note "Vertex AI → covered by dpa-google-cloud.pdf")
dpa-smtp-<provider>.pdf          (when sourced)
dpa-buddy-apps.pdf               (only if counsel asks for one)
```

Update this file's "Required instruments" section as each lands — flip status 🔴 → ✅, add a one-line note if any deviation from standard terms.

---

## Counsel review questions for this section

- Are the standard published DPAs from Anthropic / Google Cloud sufficient, or do you want commercial-tier addenda for Puma's specific processing?
- **Google Gemini API**: are the Gemini API terms sufficient as the governing instrument for the embedding call, or does Swoop require the call to move to Vertex AI (for Google Cloud DPA coverage + EU region pinning)?
- Sub-processor lists — do you want each vendor's current list as supporting documentation, or is the DPA's general sub-processor clause sufficient?
- Is a Buddy-Apps-as-processor agreement needed for the pre-handover period? (Counsel determination.)
- Are there other vendor relationships you'd want to add to this list given Puma's scope?

---

## When this section unblocks

- All four required instruments sourced and attached as PDFs (or hosted-link references).
- "Required instruments" table above flips all entries to ✅.
- README document map updates section 07 to ✅ FILLED.
