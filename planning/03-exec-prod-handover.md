# 03 — Execution (scope): Backend prod handover & provisioning doc

**Status**: Scope + structure ratified 2026-06-16 (Alastair). The dev handover is **built** at [`../handover/`](../handover/README.md) — `productionisation.md` + `maintenance.md` drafted for the writable-now sections; the **deploy-topology** section is stubbed pending the M4 deployment-shape decision. A sales handover doc is deferred (the folder is its home). This file is the planning record + the section-source map.
**Why now**: the F-c observability work surfaced that Swoop-side provisioning needs (GCP IAM, SMTP, observability, secrets, region) are scattered across `questions.md`, the ops runbooks, and the compliance bundle, with **no single backend handover surface**. `product/ui/HANDOVER.md` exists but is UI-scoped (brand + iframe embed). Alastair: "we will need it shortly."
**Owner of the eventual doc**: Al authors; Swoop's receiving engineers (Thomas, Richard) are the audience.
**Estimate to build**: ~0.5–1 day once the §6 decisions land; the provisioning-checklist + env-surface sections (~half) can be drafted immediately, shape-agnostic.

---

## 1. Purpose & audience

One Swoop-facing document that lets Swoop's engineers **provision, deploy, run, own, and extend the Puma backend** (orchestrator + connector + Postgres + ingestion + observability) without Al in the loop. It is the engineering counterpart to `ui/HANDOVER.md` (which stays the UI brand/embed home).

**Audience**: Thomas / Richard — competent engineers new to *this* codebase. Role-based, paste-ready, **single-source-of-truth via cross-links** (the same discipline as `handover/ops/README.md` §Conventions — link, don't duplicate; the runbooks/`.env.example`/compliance bundle remain canonical).

**Defining job**: turn the scattered `questions.md` provisioning asks into one actionable checklist + the run/deploy/extend context that makes them usable.

## 2. The spine: "what Swoop must provide / provision"

This is the heart of the doc — a consolidated checklist, each row naming **who · what · why · where the value goes · what it gates**. Sources already exist; the doc gathers them:

| Need | Who | Where it lands | Tracked today in |
|---|---|---|---|
| GCP "AI Pat Chat" project + IAM (region `europe-west2`) | Thomas | GCP project / SA roles | questions.md (GCP IAM) — **the master gate for M4** |
| Secrets: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DATABASE_URL`, SMTP creds | Thomas/Julie | **Secret Manager** → env | `.env.example` ×2; planned per C.18 / A.t8 |
| Observability: Cloud Logging + Error Reporting + `severity≥ERROR` alert policy | Thomas | APIs + SA `logging.logWriter` + Ops Agent + `EVENT_SINK=cloud-logging` | questions.md (added 2026-06-16) + [handover/ops/observability.md](../handover/ops/observability.md) |
| Email: SMTP provider + sales inbox(es) | Julie | `HANDOFF_EMAIL_*` / `SMTP_*` env | questions.md (Sales inbox + SMTP) |
| Claude account tier | Julie/Tom | cost routing | questions.md (Claude account tier) |
| Legal counsel sign-off | Swoop counsel | — | swoop-legal-review-pack.md — **gates go-live (M5)** |
| Analytics platform preference | Julie/Thomas | future (analysis layer) | questions.md (Analytics platform preference) |

The doc does **not** re-litigate these — it presents the checklist and links to the canonical ask. Closing the asks *is* the provisioning.

## 3. Proposed section outline (the doc's TOC)

1. **What Puma is + service topology** — orchestrator (:8080) ↔ connector (:3002, MCP) ↔ one Postgres; ingestion CLI; UI iframe. ~½ page, pointer to `discoveries.md` + Tier-1 plan. No architecture re-derivation.
2. **Provisioning checklist** — §2 above. The actionable core.
3. **Environment & config surface** — one consolidated table from both `.env.example`s: per var, required/optional · secret/config · prod value · which service. Flags the cross-field refines (`HANDOFF_EMAIL_ENABLED`, `EVENT_SINK=postgres`, `SESSION_BACKEND=postgres` all require companions).
4. **Database** — Postgres 18 + `pgvector`/`tsvector`/`pg_trgm`; the migration runner + 001–020; populating the derived store (ETL → enrich → embed — pointers to `handover/ops/etl-rerun.md` + `embedding-rerun.md`); the **`pg_dump`→restore promotion path** (laptop→Mini→GCE, per `discoveries.md` 2026-05-21).
5. **Deploy topology** — ⚠ **gated on the M4 deployment-shape decision** (single-VM-all-on-one vs Cloud SQL + Cloud Run — deferred per Tier-1 §9). Written as two recipes; the chosen one finalises at M4. Build/run/process-supervision commands; `demo-server.md` is the single-VM precedent.
6. **Observability & ops** — pointer to `handover/ops/` index + `observability.md` (collection/error-surfacing) + the alert policy.
7. **Compliance & data handling** — pointer to the compliance bundle (processors, retention, consent-copy versioning) + the legal review pack; the **legal sign-off gate** for go-live.
8. **Run / build / extend** — npm workspaces, Node 20 (`.nvmrc`), dev/build/test/typecheck, CI; how to add a tool / prompt / migration (pointers to `discoveries.md` + `gotchas.md` + `product/CLAUDE.md`).
9. **UI handover** — pointer to `ui/HANDOVER.md` (brand + iframe embed); this doc owns backend, that one owns the visitor surface.
10. **Known gaps / not production-hardened** — rate limiting (deferred), UI→server event transport (Phase 2), `event_log` retention sweep, F.t6 analysis layer, message-text-in-logs decision.

## 4. What it consolidates (link, never copy)

`product/orchestrator/.env.example` + `connector/.env.example` · `handover/ops/*` (incl. the new `observability.md` + `demo-server.md`) · `cms/legal/compliance-bundle/*` + `planning/swoop-legal-review-pack.md` · `discoveries.md` (pg_dump recipe, page-as-hub, etc.) · `gotchas.md` (Postgres.app, dotenv override, model IDs) · `questions.md` (the open Swoop asks) · `ui/HANDOVER.md` · migrations `001–020`.

## 5. Dependencies

- **M4 deployment-shape decision** (Tier-1 §9, deferred) → gates §3.5 deploy topology. Everything else is shape-agnostic and writable now.
- **Legal sign-off** (M5 gate) → referenced, not owned.
- The **open `questions.md` asks** → the doc surfaces them as the provisioning checklist; their closure is the provisioning work.

## 6. Decisions

**Resolved 2026-06-16 (Alastair):** a dedicated **`handover/`** folder (not a single root file); the **dev** handover splits into [`productionisation.md`](../handover/productionisation.md) (one-time stand-up) + [`maintenance.md`](../handover/maintenance.md) (run & evolve) + a README index; a **sales** handover doc is deferred (the folder is its home); the writable-now sections are drafted now, deploy-topology stubbed pending M4; audience assumed GCP+Node fluent (terse, link-heavy). Original options kept below for the record.

1. **Location / shape** — *Recommend* `handover.md` (whole-product root, sibling-discoverable to `ui/HANDOVER.md`, which it cross-links). Alternatives: a `product/docs/handover/` set, or `planning/`. → **resolved: a `handover/` folder.**
2. **Breadth** — *Recommend* "full-but-lean": the **provisioning checklist is the spine**, plus enough env/DB/deploy/run/extend context (mostly cross-links) to be self-sufficient — not a from-scratch architecture tome. Narrower ("provisioning checklist only") or broader ("full engineering onboarding") are both viable.
3. **Audience fluency** — assume Thomas/Richard are fluent in GCP + Node (sets verbosity)? *Recommend* yes — keep it terse, paste-ready, link-heavy.
4. **Timing** — *Recommend* draft §2/§3/§4/§7/§8 **now** (stable, "needed shortly"), and stub §5 deploy-topology as "pending M4 shape decision" so the doc exists and grows rather than waiting. → your call.

## 7. Back-links

Raised by the F-c collection work — [reviews/2026-06-16-analytics.md](reviews/2026-06-16-analytics.md) + [03-exec-observability-c.md](03-exec-observability-c.md). The observability provisioning row (§2) lives in [questions.md](../questions.md) "Observability — Cloud Logging + Error Reporting provisioning".
