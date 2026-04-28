# Processor list

Every third-party processor in Puma's data flow at M5 launch. Each entry: name, purpose, data categories transferred, retention at the processor, DPA reference.

For Puma's data-flow architecture see `data-flow.md`. For retention rules on Swoop-side stores see `retention-policy.md`.

---

## 1. Anthropic — model inference

- **Purpose**: hosts the language models Puma calls per turn.
  - **Claude Sonnet** — orchestrator agent (the visitor-facing conversation). Default model `claude-sonnet-4-5-20250929`.
  - **Claude Haiku** — pre-turn triage classifier (functional internal agent that runs each turn to assign a triage stance; invisible to the visitor). Default model `claude-haiku-4-5-20251001`.
- **Where**: Anthropic's hosted API (`api.anthropic.com`).
- **Region**: United States (Anthropic's primary inference region; cross-border flow from EU/UK to US — see `open-questions.md`).
- **Data sent per request**:
  - Visitor messages (prose; may contain PII the visitor freely volunteers — name, email, destination preferences, budget signals).
  - Conversation history for the active session (so the model has context).
  - System prompt + skills + tool descriptions (Swoop content; not visitor data).
  - Tool-call inputs / outputs from MCP tools (search queries, returned trip / region records).
- **Data returned**: model-generated text + tool-call instructions for Puma's orchestrator to execute.
- **Retention at Anthropic**: per Anthropic's published commercial terms, API request/response data is not used for model training and is retained for a limited window for abuse-detection / debugging only. Counsel should confirm against Anthropic's current Commercial Terms + DPA.
  - Reference: Anthropic Commercial Terms (https://www.anthropic.com/legal/commercial-terms — confirm current URL with counsel).
  - Reference: Anthropic DPA (https://www.anthropic.com/legal/dpa — confirm current URL with counsel).
- **DPA**: Swoop holds (or needs to hold) Anthropic's standard DPA. Open question for counsel to confirm: whether Swoop's existing Anthropic account terms include the DPA, or whether a separate DPA needs signing for Puma. See `open-questions.md`.
- **Sub-processors**: Anthropic uses cloud-infrastructure sub-processors (notably AWS, GCP) — list maintained on Anthropic's site.

---

## 2. Google Cloud Platform (GCP) — hosting + logging + persistence

Puma's deployment target. GCP project name: **AI Pat Chat** (provisioning owned by Thomas Forster at Swoop).

- **Purpose**: runtime hosting for the orchestrator and connector services; structured event logging; durable session + handoff storage post-M4.
- **Services used**:
  - **Cloud Run** — hosts the orchestrator (`:8080`) and connector services. Stateless containers; scale-to-zero.
  - **Cloud Logging** — structured event log sink. Receives Puma's 20+ event kinds (session start / end, tool calls, triage decisions, handoff submissions, errors). See `data-flow.md` for emit points.
  - **Cloud SQL (Postgres 16 + pgvector)** — post-M4 durable store for sessions, handoffs, retrieval index. Pre-M4 the orchestrator runs file-backed in-memory; this is a development posture only.
  - **Secret Manager** — credentials (Anthropic API key, SMTP credentials, etc.). Post-M4.
- **Region**: TBC at provisioning time. Default expectation is an EU region (e.g. `europe-west2`) given the visitor population. See `open-questions.md`.
- **Data stored**:
  - Session state — visitor messages + agent responses for the active conversation, plus triage state and consent flags. TTLs in `retention-policy.md`.
  - Handoff records — durable record of every triage verdict (qualified / referred_out / disqualified) with payload, contact details where applicable, consent snapshot, delivery status.
  - Logs — structured events; no message bodies, no PII (event schema is privacy-by-design — see `data-flow.md` and `gdpr-art-summary.md` Art. 25).
- **Retention at GCP**:
  - Cloud Logging default 30-day retention; longer retention via BigQuery export if Swoop opts in.
  - Cloud SQL retention follows Puma's application-level retention rules (`retention-policy.md`); deletion is enacted by the orchestrator's sweeper, not by GCP.
- **DPA**: Google Cloud's standard Customer Data Processing Addendum applies to all Cloud services Swoop uses. Counsel should confirm the existing GCP DPA (held by Swoop for the AI Pat Chat project) covers Puma's processing scope.
  - Reference: Google Cloud DPA (https://cloud.google.com/terms/data-processing-addendum — confirm current URL with counsel).
- **Sub-processors**: per Google Cloud's published list.

---

## 3. SMTP provider — handoff email delivery (TBC)

Puma sends a handoff email to Swoop's sales inbox when a conversation produces a `qualified` (always) or `referred_out` (variant treatment, lightweight) verdict. `disqualified` produces no email.

**Provider not yet selected.** Tracked in `open-questions.md` and in the project's `questions.md`. Whichever transactional provider Swoop chooses populates the `HANDOFF_EMAIL_*` environment variables at M3.

Candidate providers:

- **Postmark** (transactional-only; UK + EU regions available).
- **Amazon SES** (AWS-hosted; multi-region).
- **Mailgun** (multi-region).
- **Swoop's own SMTP** (existing infrastructure if Swoop runs one).
- **Gmail-via-app-password** (PoC pattern; not a production option).

For each candidate, counsel should be ready to confirm the DPA position before Swoop selects.

- **Purpose**: deliver the rendered handoff email from Puma's orchestrator to Swoop's sales inbox.
- **Data sent**: the rendered email body, which contains:
  - Visitor name + email (qualified / referred_out only).
  - Visitor phone (qualified / referred_out only, if provided).
  - Time-zone hint (if provided).
  - Conversation summary (motivation anchor, wishlist of trips/regions, agent's freeform reason text).
  - Triage verdict + reason code.
  - Session metadata (session id, conversation start, turn count, entry URL).
- **Region**: depends on provider chosen; record at selection time.
- **Retention at provider**: depends on provider; transactional providers typically retain delivery logs 30–90 days. Email body retention is provider-specific.
- **DPA**: required from the chosen provider. Open item.

---

## 4. Imgix — image CDN

- **Purpose**: image rendering + transformation for trip / tour / region photos surfaced in chat widgets. Hosting + CDN role only; serves images from Swoop's existing media library.
- **Region**: Imgix is a global CDN; image serving happens from edge caches near the visitor.
- **Data sent**: image URLs only (no visitor PII). Visitor IP arrives at the CDN edge as part of normal image delivery — same as any image served from Swoop's website today.
- **Data stored**: cached image renditions. Standard CDN logs (IP, user-agent, URL).
- **Retention at provider**: Imgix log retention per provider terms.
- **DPA**: required if Swoop's existing Imgix arrangement does not already cover this use. Counsel to confirm against existing Swoop ↔ Imgix terms.
- **Note on PII**: no visitor-volunteered data flows to Imgix. The image-URL path is informational (which trip's photo is shown). Imgix's exposure is the same shape as any other image asset on Swoop's website.

---

## 5. (Conditional) Parent contractor — WhaleyBear Ltd

WhaleyBear Ltd (Alastair Brayne's limited company) authors and operates the Puma codebase during the engagement. Whether this constitutes a sub-processor relationship under GDPR depends on whether WhaleyBear has access to Puma's production data after M5.

**Default expectation**: post-M5, Swoop's in-house team (Thomas / Richard) operates the system; WhaleyBear's access is limited to the engagement period and is governed by the master engagement contract.

Counsel should confirm:
- Whether the master engagement contract treats WhaleyBear as a sub-processor for GDPR purposes.
- Whether a separate sub-processor agreement is required.
- What WhaleyBear's data access posture is post-M5 (default: none / handover-only).

See `open-questions.md`.

---

## Summary table

| Processor | Role | PII transferred | Region | DPA |
|---|---|---|---|---|
| Anthropic | Model inference (Sonnet + Haiku) | Yes — visitor messages may contain PII | US | Required; confirm with counsel |
| Google Cloud (Cloud Run, Logging, SQL, Secret Manager) | Hosting + logging + persistence | Yes — handoff records + session state | TBC (EU expected) | Standard GCP DPA |
| SMTP provider (TBC) | Handoff email delivery | Yes — name, email, conversation summary | TBC | Required; depends on provider |
| Imgix | Image CDN | No (image URLs only; standard CDN exposure) | Global | Confirm existing terms |
| WhaleyBear Ltd (engagement period) | Build + handover | Engagement-period access only | UK | Master engagement contract; counsel to confirm sub-processor status |
