# 06 — Processor List

> **Status: 🟡 PARTIAL** — updated 2026-06-18 (v0.8): four processors documented (Anthropic, Google Gemini API, Google Cloud, SMTP). SMTP provider still TBC pending Swoop confirmation.
>
> **Pending**:
> - SMTP provider (blocked on Julie / D-3.3.1 — see [questions.md](../../../../questions.md) "Sales inbox address + SMTP").
> - Region confirmations for Anthropic API + Google Cloud (blocked on Thomas confirming GCP project location, D-3.3.5).

---

## Processors that handle Puma personal data

A "processor" here = a third party that processes personal data on Swoop's behalf in the course of Puma's operation. Listed in order of data-volume / sensitivity exposure.

### 1. Anthropic, PBC ✅

**Service**: Claude API (Sonnet-class conversation + Haiku-class triage).

**Data exposure**:
- Visitor messages (full conversation history, every turn).
- System prompt (Puma-authored — no visitor PII in the prompt itself).
- Tool definitions + tool-call results (may contain visitor query terms).

**Persistence by Anthropic**:
- Per Anthropic's published commercial API terms, message content is not retained for training by default.
- API processing data deleted within 30 days per Anthropic's privacy posture.
- **Counsel to confirm vintage** of terms applicable under Swoop's Anthropic agreement (or Anthropic's published commercial terms if no commercial agreement).

**Region**:
- 🟡 **TBC**. Anthropic API endpoints may route US-side by default. EU-region routing if available — counsel may want this confirmed before launch (D-3.1.6).
- Action: check with Anthropic / Swoop's Anthropic account contact whether EU routing is available + applicable.

**DPA**:
- Anthropic's standard commercial-customer terms include data-processing provisions.
- Source: Swoop's existing Anthropic vendor agreement (if commercial) OR Anthropic's published terms ([https://www.anthropic.com/legal/](https://www.anthropic.com/legal/)).
- See [07-dpas.md](07-dpas.md) for the sourcing checklist.

**Sub-processors used by Anthropic**: AWS, Google Cloud (per Anthropic's published list — confirm vintage). Counsel may want Anthropic's current sub-processor list as supporting documentation.

---

### 2. Google — Gemini API 🟡

**Service**: `gemini-embedding-001` via the public Generative Language API (`generativelanguage.googleapis.com`) — embeds visitor query text for retrieval on most retrieval steps.

**Data exposure**:
- Visitor-derived query text, at runtime, on the conversation path. This is a **model-provider** role, distinct from Google Cloud hosting (processor 3 below). Both are Google entities but they are governed by different terms and present different compliance considerations.

**Key compliance points**:
- The public Gemini API has **no EU region pinning** by default. Vertex AI is the region-pinnable alternative and is covered by the Google Cloud DPA; the public Gemini API is governed by the Gemini API terms instead (D-3.1.10).
- The "not used to train third-party AI models" promise to visitors holds on the **paid** Gemini API tier only, not the free tier. Launch must use a paid key.
- Moving the embedding call to Vertex AI would bring it under the Google Cloud DPA and allow EU region pinning — a counsel-facing decision (D-3.1.10).

**Region**:
- 🟡 **No EU pinning on the public API**. See D-3.1.10 and D-3.1.6.

**DPA / Terms**:
- Governed by the **Gemini API terms**, *not* the Google Cloud DPA, unless the call moves to Vertex AI.
- Source: [https://ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms)
- See [07-dpas.md](07-dpas.md) for the sourcing checklist.

---

### 3. Google Cloud Platform ✅

Google Cloud is a single processor relationship that covers the infrastructure running Puma.

**Committed shape**: one Compute Engine VM in Swoop's GCP project hosting the orchestrator, connector, and a Postgres database on a single machine. Cloud Run + Cloud SQL is **not** the committed shape — managed services are a scale-up option only.

**Sub-services in scope**:

#### 3a. Compute Engine VM

**Service**: hosts the orchestrator + connector processes.

**Data exposure**: in-process session state, all visitor messages during conversation, all handoff payloads in transit.

**Persistence**: sessions are durable in Postgres on the same VM (wired retention sweep enforces TTL). The VM itself is not stateless.

**Region**: 🟡 working default `europe-west2` (London) — confirm with Thomas (D-3.3.5).

#### 3b. Postgres on the VM

**Service**: durable storage for retrieval store + handoff store + sessions.

**Data exposure**:
- Handoff records (full payload, including visitor name + email + conversation summary + consent records).
- Sessions (durable, swept by retention enforcement).
- Retrieval store (no visitor PII; pre-ingested Swoop content).

**Persistence**: per retention policy (see [05-retention-policy.md](05-retention-policy.md)).

**Region**: same VM — `europe-west2` working default.

**Backups**: shape-dependent. On the committed single-VM shape, backup cadence is ops-configured. On managed Postgres, ~7-day PITR would apply. Not asserted as a fixed window here.

#### 3c. Cloud Logging (shape-dependent)

**Service**: structured event sink — only if the managed-services path is adopted. Today's event stream sink is Postgres on the VM.

**Data exposure** (if adopted):
- Event payloads (handoff IDs, verdicts, timestamps, status codes — minimised, no message bodies, no email content).
- Standard VM/ingress request logs (IPs, user-agents — for incident response).

**Persistence**: 30-day default if Cloud Logging is the sink. Configurable. Not asserted as present at launch.

**Region**: same as VM, if adopted.

---

**Single DPA covers all Google Cloud sub-services**: Google Cloud's standard Data Processing Addendum.

**DPA source**: Swoop's existing Google Cloud contract OR [https://cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum).

**Note**: this DPA covers the Cloud VM, Postgres, and Cloud Logging. It does **not** cover the Gemini API embedding call (processor 2 above) — that is governed by the Gemini API terms unless moved to Vertex AI (D-3.1.10).

**Sub-processors used by Google Cloud**: standard GCP sub-processor list — counsel may want current vintage.

---

### 4. SMTP provider 🟡 TBC

**Service**: handoff-email transport.

**Status**: provider not yet selected. Default candidates:
- **Postmark** — purpose-built transactional email, EU region available.
- **Amazon SES** — broad use, region selectable, lowest cost.
- **Mailgun** — similar profile to Postmark.
- **Swoop's existing SMTP** — if Swoop already operates a transactional email infrastructure (e.g. for booking confirmations), Puma can plug into it. If Google Workspace / Gmail SMTP, the DPA is the same Google Cloud DPA (D-3.3.1).
- **Fallback dev only**: Gmail-via-app-password — not for production.

**Data exposure**:
- Email body (visitor name + email + conversation summary + agent's reason text + motivation anchor).
- Sender + recipient envelope addresses.

**Persistence by provider**:
- Most providers retain message metadata (delivery status, bounces) for 30–90 days; message bodies typically not retained beyond send.
- Provider-specific — finalise once selection confirmed.

**Region**: provider-specific.

**DPA**: provider-specific; sourced once Swoop confirms (D-3.3.4).

---

## Out-of-scope (NOT processors)

The following are sometimes confused for processors but are not, in this context.

- **assistant-ui**: an open-source React component library. Not a runtime SaaS — ships as an npm package. No data leaves Puma's processing boundary via assistant-ui.
- **nodemailer**: an email-sending Node.js library. The library is not a processor; the **SMTP provider** the library connects to is the processor.
- **Vercel** (publisher of assistant-ui): not in Puma's runtime path.
- **Open-source dependencies** (npm packages): code-level dependencies, not data processors. The relevant processor is whoever hosts the runtime (Google Cloud).
- **Swoop sales inbox**: Swoop-internal endpoint, not an external processor relationship.
- **Swoop CRM**: Swoop-internal; ingestion happens off-Puma. Governed by Swoop's existing compliance posture, not this bundle.

---

## Processor relationships diagram

See [02-data-flow.md](02-data-flow.md) — the mermaid diagram shows where each processor sits in the data path.

---

## Counsel review questions for this section

- Is the standard Anthropic terms / Google Cloud DPA sufficient, or does Swoop's posture require addenda?
- **Google Gemini API**: stay on the public Generative Language API or move to Vertex AI for EU region pinning and Google Cloud DPA coverage? (D-3.1.10)
- **Gemini API terms**: are the standard published Gemini API terms sufficient as the governing instrument for the embedding call?
- Region routing: should Anthropic API EU routing be insisted on if available? Should `europe-west2` be the only acceptable Google Cloud region?
- SMTP provider preferences from Swoop's perspective?
- Is Anthropic's sub-processor list acceptable? (AWS + Google Cloud as Anthropic's hosting.)
- Is the disclosure to visitors in the privacy-info page listing all four processors sufficient under Art. 13(1)(e) (recipients of personal data)?

---

## Action checklist (for Swoop legal + Al)

- [ ] Source Anthropic DPA → drop in [07-dpas.md](07-dpas.md).
- [ ] Source Google Cloud DPA → drop in [07-dpas.md](07-dpas.md).
- [ ] Source or confirm Gemini API terms as the governing instrument for the embedding call → drop reference in [07-dpas.md](07-dpas.md).
- [ ] Confirm Anthropic API region with Swoop's Anthropic contact (D-3.1.6).
- [ ] Confirm Google Cloud region with Thomas (D-3.3.5).
- [ ] Decide: public Gemini API vs Vertex AI (D-3.1.10).
- [ ] Swoop confirms SMTP provider (D-3.3.1).
- [ ] Source SMTP provider DPA → drop in [07-dpas.md](07-dpas.md).
- [ ] Update privacy-info page (§03) to list all four processors with their region + retention summaries.
