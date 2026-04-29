# 06 — Processor List

> **Status: 🟡 PARTIAL**
>
> **Filled**: Anthropic, Google Cloud (Cloud Run + Cloud SQL planned + Cloud Logging) — vendors are committed.
>
> **Pending**:
> - SMTP provider (blocked on Julie / E.5 — see [questions.md](../../../../questions.md) "Sales inbox address + SMTP").
> - Region confirmations for Anthropic API + Google Cloud (blocked on Thomas confirming "AI Pat Chat" GCP project location).

---

## Processors that handle Puma personal data

A "processor" here = a third party that processes personal data on Swoop's behalf in the course of Puma's operation. Listed in order of data-volume / sensitivity exposure.

### 1. Anthropic, PBC ✅

**Service**: Claude API (Sonnet 4.5 + Haiku 4.5).

**Data exposure**:
- Visitor messages (full conversation history, every turn).
- System prompt (Puma-authored — no visitor PII in the prompt itself).
- Tool definitions + tool-call results (may contain visitor query terms).

**Persistence by Anthropic**:
- Per Anthropic's published commercial API terms, message content is not retained for training by default.
- API processing data deleted within 30 days per Anthropic's privacy posture.
- **Counsel to confirm vintage** of terms applicable under Swoop's Anthropic agreement (or Anthropic's published commercial terms if no commercial agreement).

**Region**:
- 🟡 **TBC**. Anthropic API endpoints may route US-side by default. EU-region routing if available — counsel may want this confirmed before launch.
- Action: check with Anthropic / Swoop's Anthropic account contact (Luke?) whether EU routing is available + applicable.

**DPA**:
- Anthropic's standard commercial-customer terms include data-processing provisions.
- Source: Swoop's existing Anthropic vendor agreement (if commercial) OR Anthropic's published terms ([https://www.anthropic.com/legal/](https://www.anthropic.com/legal/)).
- See [07-dpas.md](07-dpas.md) for the sourcing checklist.

**Sub-processors used by Anthropic**: AWS, Google Cloud (per Anthropic's published list — confirm vintage). Counsel may want Anthropic's current sub-processor list as supporting documentation.

---

### 2. Google Cloud Platform ✅

Google Cloud is a single processor relationship that covers three sub-services for Puma.

**Sub-services in scope**:

#### 2a. Cloud Run

**Service**: hosts orchestrator + connector containers.

**Data exposure**: in-process session state, all visitor messages during conversation, all handoff payloads in transit.

**Persistence**: ephemeral — Cloud Run instances are stateless; restart = state lost. Logs (request logs) flow to Cloud Logging (see 2c).

**Region**: 🟡 planned `europe-west2` (London) — confirm with Thomas (Swoop ops) post-IAM.

#### 2b. Cloud SQL for Postgres (planned, post-IAM)

**Service**: durable storage for retrieval store + handoff store + post-M4 sessions.

**Data exposure**:
- Handoff records (full payload, including visitor name + email + conversation summary + consent records).
- Sessions post-M4 (currently in-memory; will move to Postgres per B.22).
- Retrieval store (no visitor PII; pre-ingested Swoop content).

**Persistence**: per retention policy (see [05-retention-policy.md](05-retention-policy.md)).

**Region**: same as Cloud Run — `europe-west2` planned.

**Backups**: Google Cloud's automated backups (default 7-day retention).

#### 2c. Cloud Logging

**Service**: structured event sink for orchestrator + connector events (F-a / F-b schema).

**Data exposure**:
- Event payloads (handoff IDs, verdicts, timestamps, status codes — minimised, no message bodies, no email content).
- Standard Cloud Run request logs (IPs, user-agents — for incident response).

**Persistence**: 30-day default. Optional BigQuery export for longer retention.

**Region**: same as Cloud Run.

---

**Single DPA covers all three sub-services**: Google Cloud's standard Data Processing Addendum.

**DPA source**: Swoop's existing Google Cloud contract OR [https://cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum).

**Sub-processors used by Google Cloud**: standard GCP sub-processor list — counsel may want current vintage.

---

### 3. SMTP provider 🟡 TBC

**Service**: handoff-email transport.

**Status**: provider not yet selected. Default candidates (in Julie's call):
- **Postmark** — purpose-built transactional email, EU region available.
- **Amazon SES** — broad use, region selectable, lowest cost.
- **Mailgun** — similar profile to Postmark.
- **Swoop's existing SMTP** — if Swoop already operates a transactional email infrastructure (e.g. for booking confirmations), Puma can plug into it.
- **Fallback dev only**: Gmail-via-app-password — not for production.

**Data exposure**:
- Email body (visitor name + email + conversation summary + agent's reason text + motivation anchor).
- Sender + recipient envelope addresses.

**Persistence by provider**:
- Most providers retain message metadata (delivery status, bounces) for 30-90 days; message bodies typically not retained beyond send.
- Provider-specific — finalise once selection confirmed.

**Region**: provider-specific.

**DPA**: provider-specific; sourced once Julie confirms.

**Counsel review depends on**: which provider Swoop selects. Counsel may want to weigh in on the choice if a particular provider is preferred under Swoop's data-protection posture.

---

## Out-of-scope (NOT processors)

The following are sometimes confused for processors but are not, in this context.

- **assistant-ui**: an open-source React component library Puma uses for the chat primitive. Not a runtime SaaS — it ships as a npm package. No data leaves Puma's processing boundary via assistant-ui.
- **nodemailer**: an email-sending Node.js library. The library is not a processor; the **SMTP provider** the library connects to is the processor.
- **Vercel** (publisher of assistant-ui): not in Puma's runtime path. Assistant-ui's code runs in our deployment, not Vercel's.
- **Open-source dependencies** (npm packages): code-level dependencies, not data processors. The relevant processor is whoever hosts the runtime (Google Cloud).
- **Swoop sales inbox**: Swoop-internal endpoint, not an external processor relationship.
- **Swoop CRM**: Swoop-internal; ingestion happens off-Puma. Whatever CRM Swoop uses is governed by Swoop's existing compliance posture, not this bundle.

---

## Processor relationships diagram

See [02-data-flow.md](02-data-flow.md) — the mermaid diagram shows where each processor sits in the data path.

---

## Counsel review questions for this section

- Is the standard Anthropic terms / Google Cloud DPA sufficient, or does Swoop's posture require addenda?
- Region routing: should Anthropic API EU routing be insisted on if available? Should `europe-west2` be the only acceptable Google Cloud region?
- SMTP provider preferences from Swoop's perspective?
- Is Anthropic's sub-processor list acceptable? (AWS + Google Cloud as Anthropic's hosting, etc.)
- Is the disclosure to visitors in the privacy-info page (§03 / `cms/legal/privacy-info.md`) listing all three processors sufficient under Art. 13(1)(e) (recipients of personal data)?

---

## Action checklist (for Swoop legal + Al)

- [ ] Source Anthropic DPA → drop in [07-dpas.md](07-dpas.md).
- [ ] Source Google Cloud DPA → drop in [07-dpas.md](07-dpas.md).
- [ ] Confirm Anthropic API region with Luke + Anthropic.
- [ ] Confirm Google Cloud region with Thomas.
- [ ] Julie confirms SMTP provider selection.
- [ ] Source SMTP provider DPA → drop in [07-dpas.md](07-dpas.md).
- [ ] Update privacy-info page (§03) to list all three processors with their region + retention summaries.
