# Puma — productionisation (first-time stand-up)

How to provision and deploy the Puma backend (orchestrator + connector + Postgres + ingestion) into Swoop's GCP **for the first time**. Ongoing operation: [`maintenance.md`](maintenance.md). The visitor-facing UI (brand + iframe embed): [`ui-integration.md`](ui-integration.md).

> ⚠ **§5 (deploy topology) is pending the M4 deployment-shape decision** — single-VM-all-on-one vs Cloud SQL + Cloud Run (deferred; [planning/01-top-level.md](../../planning/01-top-level.md) §9). Single-VM is the leading shape. Everything else here is final.

---

## 1. Service topology

| Service | Workspace | Port | Owns |
|---|---|---|---|
| **connector** | `@swoop/connector` | 3002 | MCP-over-HTTP tool surface; the Postgres pool (retrieval + handoff + `event_log`) |
| **orchestrator** | `@swoop/orchestrator` | 8080 | the agent loop (Claude Sonnet via Google ADK); calls the connector; serves the UI's `/chat` SSE |
| **ingestion** | `@swoop/ingestion` | — (CLI) | builds/refreshes the derived store from Swoop's SQL dump |
| **ui** | `@swoop/ui` | static | React app in an iframe — see [`ui-integration.md`](ui-integration.md) |

One **Postgres 18** (`pgvector` + `tsvector` + `pg_trgm`) backs everything — single store per decision C.18. Architecture detail in [`../../discoveries.md`](../../discoveries.md) and the Tier-1 plan.

## 2. What Swoop must provision

The consolidated checklist. Each row is tracked as an ask in [`../../questions.md`](../../questions.md); closing it *is* the provisioning.

| Provide | Who | Where it goes | Gates |
|---|---|---|---|
| GCP project "AI Pat Chat" + IAM, region `europe-west2` | Thomas | GCP / service-account roles | **everything (M4)** |
| Secrets: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DATABASE_URL`, SMTP creds | Thomas / Julie | **Secret Manager** → service env | boot |
| Observability: Cloud Logging + Error Reporting APIs + SA `roles/logging.logWriter` + Ops Agent | Thomas | GCP + `EVENT_SINK=cloud-logging` | error visibility (§6) |
| SMTP provider + sales inbox(es) | Julie | `HANDOFF_EMAIL_*` / `SMTP_*` env | lead email (§7) |
| Claude account tier | Julie / Tom | cost routing | — |
| Legal counsel sign-off | Swoop counsel | — | **go-live (M5)** — [`../../planning/swoop-legal-review-pack.md`](../../planning/swoop-legal-review-pack.md) |

## 3. Environment & config surface

The full contract is the two `.env.example` files — **canonical, read them**: [`../orchestrator/.env.example`](../orchestrator/.env.example) + [`../connector/.env.example`](../connector/.env.example). Each var is validated at boot (Zod; fail-fast). Headlines:

- **Required**: `ANTHROPIC_API_KEY` (orchestrator), `DATABASE_URL` (connector), `GEMINI_API_KEY` (connector — visitor-query embeddings).
- **Cross-field refines** (boot fails if half-set): `HANDOFF_EMAIL_ENABLED=true` needs `HANDOFF_EMAIL_FROM/_TO_QUALIFIED` + `SMTP_USER/_PASS`; `SESSION_BACKEND=postgres` and `EVENT_SINK=postgres` each need `ORCHESTRATOR_DATABASE_URL`.
- **Production values**: `NODE_ENV=production`, `SESSION_BACKEND=postgres` (durable sessions), `EVENT_SINK=cloud-logging`, `HANDOFF_RETENTION_SWEEP_ENABLED=true`, `CORS_ALLOWED_ORIGINS` = the Swoop site origin(s).

## 4. First database build

1. Postgres 18 with `vector` + `pg_trgm` extensions (bootstrap recipe in [`../../gotchas.md`](../../gotchas.md) "Local Postgres…").
2. Apply migrations `001–020` — see [`../docs/ops/migration-management.md`](../docs/ops/migration-management.md).
3. Populate the derived store, either:
   - **Build from a dump** — run ETL + enrich against a fresh Swoop SQL dump ([`../docs/ops/etl-rerun.md`](../docs/ops/etl-rerun.md) → [`../docs/ops/embedding-rerun.md`](../docs/ops/embedding-rerun.md)); image annotations per [`../docs/ops/image-annotation-rerun.md`](../docs/ops/image-annotation-rerun.md); or
   - **Restore a prepared instance** — `pg_dump` (custom format, `--no-owner`) → `pg_restore`; proven laptop→Mini→GCE recipe in [`../../discoveries.md`](../../discoveries.md) (2026-05-21).
4. Verify: `ANALYZE;` then exercise an HNSW query (recipe in discoveries.md).

## 5. Deploy topology — ⚠ pending M4 shape decision

Two candidate recipes; the chosen one finalises when M4 settles the deployment shape.

- **Single-VM-all-on-one** *(leading)* — one GCE VM running connector + orchestrator + Postgres + UI behind a reverse proxy with TLS; secrets from Secret Manager; process supervision (e.g. `systemd`); one `DATABASE_URL`. The home demo on the Mac Mini + Tailscale Funnel ([`../docs/ops/demo-server.md`](../docs/ops/demo-server.md)) is the working precedent.
- **Cloud SQL + Cloud Run** — connector + orchestrator as Cloud Run services, Cloud SQL Postgres, ingestion as a Cloud Run Job. The "boring default" if scale demands it.

Build/run commands, reverse-proxy + iframe-origin/CORS specifics, and the secrets wiring land here once the shape is chosen. **TODO: finalise at M4.**

## 6. Observability go-live

The collection layer is wired (F-c); the prod flip is GCP config — full steps in [`../docs/ops/observability.md`](../docs/ops/observability.md) §"The GCP flip": enable the APIs, grant `logging.logWriter`, install the Ops Agent (or Cloud Run native), set `EVENT_SINK=cloud-logging`, create the `severity≥ERROR` alert policy → dev-team channel (the reliable error surface). Populating Error Reporting's grouped view needs a small sink enhancement — see the runbook caveat.

## 7. Go-live gates

- [ ] **Legal counsel sign-off** on the disclosure/consent surfaces ([`../../planning/swoop-legal-review-pack.md`](../../planning/swoop-legal-review-pack.md)).
- [ ] Mailer enabled: `HANDOFF_EMAIL_ENABLED=true` + creds + confirmed sales inbox.
- [ ] Observability flipped (§6) + the error alert verified firing.
- [ ] Smoke a real conversation → tool call → qualified handoff; confirm the email lands and a durable record + `handoff.submitted` event are written.
- [ ] Consent/disclosure copy versions confirmed current.
- [ ] **Privacy contact email** — replace the `privacy@example.com` placeholder (privacy-info modal + data-subject-rights copy) with Swoop's real privacy/DSAR address ([legal pack](../../planning/swoop-legal-review-pack.md) D-3.3.3).
