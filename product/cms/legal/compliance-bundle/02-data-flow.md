# 02 — Data Flow

> **Status: ✅ FILLED** — production-ready for counsel review.
>
> Reflects the system as shipped on 2026-04-28, including E.t2/t3/t4 (durable handoff store, mailer, end-to-end consent flow). Notes inline where future state (Cloud SQL Postgres swap, SMTP provider activation) differs.

---

## Diagram

```mermaid
flowchart TD
    V[Visitor browser] -->|loads page| W[Swoop marketing site<br/>iframe embeds chat widget]
    W -->|first visit| T1[Tier-1 disclosure + consent screen<br/>EU AI Act Art. 50 + GDPR primary consent]
    T1 -->|Continue| UI[Chat widget<br/>@swoop/ui — React, assistant-ui]
    T1 -.->|No thanks| END1[Chat closes<br/>no session state written]

    UI -->|HTTPS POST chat turn<br/>session id + message| ORCH[Orchestrator<br/>@swoop/orchestrator<br/>Cloud Run, europe-west2 planned]
    ORCH -->|conversation history + system prompt| ANTHROPIC[Anthropic API<br/>Claude Sonnet 4.5 + Haiku 4.5<br/>region TBC]
    ANTHROPIC -->|streamed response + tool calls| ORCH

    ORCH -->|in-process call| CONN[Connector<br/>@swoop/connector<br/>retrieval + handoff side-effects]
    CONN -->|SQL queries<br/>read-only| PGR[(Postgres — retrieval store<br/>Cloud SQL, planned post-IAM)]

    ORCH -->|server-sent events| UI
    UI -->|when agent triggers| LCW[Lead-capture widget<br/>tier-2 consent + marketing opt-in]
    LCW -->|Submit| HSUBMIT[POST /handoff/submit<br/>orchestrator route]
    HSUBMIT -->|enrich payload from session state| SUBMIT[submitHandoff<br/>connector orchestration]

    SUBMIT --> STORE[(Handoff store<br/>FsHandoffStore today —<br/>Cloud SQL Postgres post-IAM)]
    SUBMIT -->|verdict-aware<br/>off by default today| MAILER[Mailer<br/>nodemailer + SMTP<br/>provider TBC]
    MAILER -->|email| INBOX[Sales inbox<br/>address TBC]

    ORCH -.->|structured events<br/>30-day default retention| GCL[(Google Cloud Logging)]
    SUBMIT -.->|handoff.submitted event| GCL

    classDef visitor fill:#e1f5ff,stroke:#0066cc
    classDef puma fill:#f0f7e8,stroke:#4a7c2c
    classDef thirdParty fill:#fff4e1,stroke:#cc8800
    classDef store fill:#f4e1ff,stroke:#7c2cb5
    classDef closed fill:#fee,stroke:#c33

    class V,W visitor
    class T1,UI,LCW,ORCH,CONN,SUBMIT,HSUBMIT puma
    class ANTHROPIC,MAILER,INBOX thirdParty
    class STORE,PGR,GCL store
    class END1 closed
```

---

## Narrative walkthrough

Each edge labelled `(N)` below corresponds to a numbered step of the visitor journey, in order.

### (1) Visitor → Marketing site → Chat widget

- **Data crossing**: page request, standard web telemetry (IP, user-agent, referrer) handled by Swoop's existing marketing-site infrastructure — out of Puma's scope.
- **Persisted?**: standard Cloud Run / Swoop-marketing logs. No Puma-specific persistence at this stage.
- **Processor**: Swoop's website hosting; not a Puma processor.

### (2) First visit → Tier-1 disclosure + consent

- **Data crossing**: rendered HTML; no PII flows yet.
- **Decision moment**: visitor either clicks Continue (proceeds) or No thanks (chat closes, no state written).
- **Persisted?**: only on Continue — session record created with `consent.conversation = true`, timestamp, copy version id.
- **Decision reference**: **E.4** (two-tier consent), implemented in chunk D's tier-1 backstop + orchestrator's `/chat` endpoint refusing requests without it.

### (3) Visitor message → Orchestrator

- **Data crossing**: free-form visitor message text (may contain PII at visitor's discretion) + session id.
- **Transport**: HTTPS POST to orchestrator's `/chat` endpoint.
- **Persisted?**: in-memory session state during conversation. Persisted to Cloud SQL Postgres post-M4 (decision **B.22**); ADK in-built in-memory store today.
- **Retention**: 24h idle → archive; 7d archive → delete (decision **E.8**).

### (4) Orchestrator → Anthropic API

- **Data crossing**: full conversation history + system prompt + tool definitions, on every turn. Includes any PII the visitor has shared.
- **Transport**: HTTPS to Anthropic's API endpoint.
- **Persisted by Anthropic?**: per Anthropic's published API terms, message content is not retained for training by default and is deleted within 30 days of API processing. **Confirm with counsel that the API terms vintage matches Swoop's commercial agreement.** Region: TBC (Anthropic API may route US-side; counsel may want EU-region routing if available — flag for follow-up).
- **Processor**: **Anthropic, PBC** — see [06-processors.md](06-processors.md).

### (5) Orchestrator → Connector → Retrieval store

- **Data crossing**: agent tool calls (search queries, trip detail lookups). Visitor PII is generally NOT in tool-call arguments — the agent rephrases queries — but cannot be guaranteed for free-form retrieval queries.
- **Persisted?**: read-only against the retrieval store; queries themselves are not persisted (logged briefly via Cloud Logging).
- **Processor**: Google Cloud (hosting Cloud SQL).

### (6) Orchestrator → Visitor (streamed response)

- **Data crossing**: agent's response text + structured tool-call results.
- **Transport**: server-sent events back to the chat widget.
- **Persisted?**: yes, in session state (visitor messages + agent responses retained for the conversation).

### (7) Agent triggers handoff → Lead-capture widget

- **Data crossing**: tool-call arguments from agent (verdict, reason code, motivation anchor) → widget. No new visitor PII at this point.
- **Visitor action**: types name + email + ticks tier-2 consent + optionally ticks marketing opt-in + clicks Send.
- **Tier-2 consent timestamp**: captured client-side at the moment of click (decision **E.15**). Not server-stamped, to encode the visitor's *intent*.

### (8) Lead-capture widget → POST /handoff/submit

- **Data crossing**: visitor name, email, preferred contact method, tier-2 consent flags + timestamp, marketing opt-in, agent-args bundle, session id.
- **Transport**: HTTPS POST.
- **Schema**: `HandoffSubmitRequestSchema` (`.strict()` — extra fields rejected).
- **Decision reference**: **E.13** (HTTP route over MCP-tool routing) + **E.14** (server-side enrichment).

### (9) Orchestrator route → submitHandoff (connector)

- **Server-side enrichment**: orchestrator looks up session state by id, enriches the payload with handoff id (UUID), conversation start timestamp, turn count, tier-1 consent timestamp, wishlist accumulator, entry URL.
- **Backstop**: rejects payload if `consent.conversation !== true` OR `consent.handoff !== true`.

### (10) submitHandoff → Handoff store

- **Today (interim)**: `FsHandoffStore` writes JSON file to `<connector-package-root>/var/handoffs/<handoffId>.json`. Atomic tmp-file-rename. Filename safety regex. Schema-validated round-trip on read.
- **Future (post-IAM)**: `PostgresHandoffStore` writes to `handoff` table in same Cloud SQL Postgres instance as retrieval (decisions **E.10**, **C.18**, **C.23**). Same `HandoffStore` interface; one config flip at boot.
- **Persisted fields**: full payload (verdict, reason, profile, wishlist, motivation, contact, both consent records, session metadata, conversation reference).
- **Retention**: 12mo or until CRM ingestion (qualified/referred_out, decision **E.6**) / 90 days (disqualified, decision **E.7**).

### (11) submitHandoff → Mailer (verdict-aware)

- **Today**: `HANDOFF_EMAIL_ENABLED=false`. Mailer code, templates, send path all production-ready; off until Julie confirms SMTP + sales-inbox.
- **Qualified**: full email to `HANDOFF_EMAIL_TO_QUALIFIED`. Includes visitor name + email + conversation summary + motivation anchor.
- **Referred-out**: lighter email to `HANDOFF_EMAIL_TO_REFERRED_OUT` (or qualified inbox with subject prefix per E.2).
- **Disqualified**: no email. Durable record only (decision **E.3**).

### (12) Mailer → Sales inbox

- **Data crossing**: email body containing visitor name, email, conversation summary, agent's reason text + motivation anchor.
- **Transport**: SMTP via configured provider.
- **Processor**: SMTP provider TBC (Postmark / SES / Mailgun / Swoop's existing). See [06-processors.md](06-processors.md).
- **Recipient**: Swoop sales staff (Swoop-internal, not a Puma processor).

### (Out-of-band) Cloud Logging

- **Data crossing**: structured events emitted by orchestrator + connector via the F-a / F-b event schema (e.g. `handoff.submitted`). Event payloads are minimised — no message bodies, no email content, just IDs + verdicts + timestamps.
- **Persisted?**: 30-day default retention in Cloud Logging. Longer retention via BigQuery export (chunk F).
- **Processor**: Google Cloud Logging — see [06-processors.md](06-processors.md).

---

## Component-to-decision map

For counsel cross-reference if any architectural choice is queried.

| Component | Decision | Where |
|---|---|---|
| Two-tier consent | E.4 | [planning/decisions.md](../../../../planning/decisions.md) |
| HTTP `/handoff/submit` route | E.13 | as above |
| Server-side payload enrichment | E.14 | as above |
| Tier-2 consent timestamp client-side | E.15 | as above |
| `FsHandoffStore` interim | E.12 | as above |
| Cloud SQL Postgres swap target | E.10 | as above |
| Single-store posture | C.18 | as above |
| Firestore dropped | C.23 | as above |
| Connector ownership of side-effects | E.11 | as above |
| Retention windows | E.6 / E.7 / E.8 | as above |
| Disqualified — no email | E.3 | as above |
| Referred-out — light email | E.2 | as above |

---

## What is NOT shown

- **No third-party analytics in the chat surface.** No GA, no Facebook pixel, no Hotjar, no LogRocket, no fingerprinting library.
- **No CRM integration in Puma.** Sales staff manually consume the email + handoff record. CRM ingestion is Swoop-side, post-handoff.
- **No payment processing.** Bookings are handled off-Puma by sales specialists.
- **No third-party fonts or CDN trackers** in the chat surface (UI is bundled).

---

## Boundary statement

**Personal data leaves Puma's processing boundary at three points and only three points:**

1. To **Anthropic** (model calls, transient).
2. To **Google Cloud** (hosting, persistence, logging).
3. To **the SMTP provider** (handoff email transport — TBC pending Julie).

The sales inbox is operated by Swoop and is a Swoop-internal endpoint, not an external processor.
