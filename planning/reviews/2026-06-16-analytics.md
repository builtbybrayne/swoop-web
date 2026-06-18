# 2026-06-16 — Analytics & observability: assessment + collection-layer ledger

**Type**: Focused assessment (chunk F — observability & analytics) + master ledger for the collection-layer fix.
**Author**: forked analytics session (worktree `analytics-review`, off `main` @ `3f8c093`).
**Trigger**: Alastair forked the orientation session to assess analytics specifically, while a sibling session handles Luke's 16/06 feedback. Brief: *"Review the planning docs for analytics in particular, and assess code. Be comprehensive."*
**Companions**: [02-impl-observability.md](../02-impl-observability.md) (chunk F Tier 2) · [03-exec-observability-a.md](../03-exec-observability-a.md) (F-a) · [03-exec-observability-b.md](../03-exec-observability-b.md) (F-b) · [03-exec-observability-c.md](../03-exec-observability-c.md) (**F-c — the fix this ledger tracks**).

---

## ⛔ Standing rules honoured (per [2026-06-11 audit](2026-06-11-retrieval-emptiness-audit.md))

Never push. No commit without per-instance go-ahead. Nothing DB-touching without a named go + pre/post manifest; restores rename-never-drop. Diagnosis separated from change-making. This review is read-only; F-c execution holds at the commit boundary for Alastair's explicit go.

---

## 1. Scope reviewed

**Planning**: Tier 2 chunk F ([02-impl-observability.md](../02-impl-observability.md)); Tier 3 F-a + F-b in full; the malformed-prod-gate cross-cut; questions.md analytics items (Analytics platform preference; Pre-purge conversation-analysis policy); inbox.md 2026-05-18 malformed-widget-analytics item; Tier 1 §4F/§7 deferrals; decisions C.45, B.19/B.20, B.27, E.verdict-3, H.19.
**Code**: `ts-common/src/events.ts` (full schema) + `emit-event.ts`; every `emitEvent` call site (census + read of `chat.ts`, connector `_handler-runtime.ts`, `widget-shell.tsx`, orchestrator `index.ts`); the harness eval-event system (`harness/src/events.ts`); migrations 010 + 016 (durable session/event store); confirmed absence of F.t6/`conversation_analysis`/Cloud-Logging-sink/BigQuery/spot-check-runbook/aggregation/config-knobs. `@swoop/common` tests green (202).

## 2. The two themes (Alastair's framing)

- **Collection** — getting the emitted signal into a durable, queryable, alertable home. **This is the concern now.**
- **Analysis** — making sense of conversations (the F.t6 council, dashboards, "why behind the booking"). **Explicitly later.**

## 3. Headline

**The instrumentation is rich and ahead of plan; the pipeline behind it is absent.** ~31 of 34 event kinds fire live across the stack, but the only sink is `console.log` → stdout, and Puma runs single-VM (not Cloud Run), so nothing accrues. Analytics-as-capability is ~0% realised despite the event system being ~90% built.

## 4. Three observability surfaces (do not conflate)

| # | Surface | State | Persistence |
|---|---|---|---|
| 1 | **Product event stream (chunk F)** — `events.ts` 34 kinds + `emit-event.ts` | built, exceeds the F-a/F-b plans | **stdout only — ephemeral** |
| 2 | **Durable session store (B.t13)** — `puma_session_event` (migration 016) | built; live when `SESSION_BACKEND=postgres` | Postgres — durable but retention-TTL'd, raw ADK transcript, not analytics-shaped |
| 3 | **Harness eval observability (H.t8)** — `harness/src/events.ts` (16 kinds) | built, healthy | per-run JSONL + HTML viewer |

Surface 3 is eval/test observability, not visitor analytics — out of scope for this theme. The story is surfaces 1 (the signal) and 2 (the only durable conversation record today).

## 5. Findings (ranked by collection impact)

1. **No durable sink** — `setEventSink` is never called in production; no `@google-cloud/logging`; single-VM stdout evaporates. **The headline gap.**
2. **No dev-team error surface** — error coverage is actually *good* (a thrown tool emits `tool.invoked{ok:false}` + `error.raised`, mirrored by `tool.returned{outcome:error}`, plus `handoff.email.failed`, `*.sweep.failed`, `:malformed` widget telemetry) but it has nowhere to go and nobody is alerted.
3. **3 dead schema slots** — `tool.failed`, `handoff.triggered`, `skill.loaded` are defined + fixtured but never emitted. `tool.failed` is redundant by design; the other two are deferred features.
4. **F.t4 spot-check runbook absent**; **F.t5 BigQuery-readiness check** not done (schema *is* export-ready).
5. **Stale comments** in `orchestrator/src/index.ts` and `server/chat.ts` falsely claim observability isn't wired.
6. **F.t6 conversation-analysis entirely absent** — the *analysis* layer. Correctly out of scope now; noted for later.
7. **Message-text-in-logs unresolved** (events log hashes, not text) — caps non-converting-visitor analytics. Legal review; later.

## 6. External blockers (Swoop)

- **GCP "AI Pat Chat" IAM** (Thomas, long-pending) — gates the Cloud Logging / Error Reporting flip. The Postgres sink path is deliberately chosen to **not** block on this.
- **Analytics platform preference** (Julie/Thomas) — BigQuery vs their BI tool. Only matters at the *analysis* stage; parked.

## 7. Recommendation → F-c

GCP-native + trivial, riding the existing seam, deferring analysis: **Cloud Logging (collection) + Cloud Error Reporting (dev-team error surface)**, fed by a pluggable sink with a `postgres` mode that works on the demo Mini *today* and de-risks the IAM wait. Full design in [03-exec-observability-c.md](../03-exec-observability-c.md).

## 8. Recommended next moves (master ledger)

| # | Item | Where | Status |
|---|---|---|---|
| A1 | Pluggable `EVENT_SINK` (stdout/postgres/cloud-logging) + severity mapping + `event_log` migration 020 + both-process wiring | [F-c plan](../03-exec-observability-c.md) | **Authored; in execution (worktree `analytics-review`), holds at commit** |
| A2 | Retire dead `tool.failed` slot (F.sink-5) | F-c | bundled into F-c |
| A3 | Fix stale "observability not wired" comments | F-c | bundled into F-c |
| A4 | `handover/ops/observability.md` runbook (also discharges F.t4 spot-check) | F-c | bundled into F-c |
| A5 | GCP flip: Ops Agent + Logging Writer + `EVENT_SINK=cloud-logging` + `severity>=ERROR` alert policy + Error Reporting | F-c §1.5 | **gated on "AI Pat Chat" IAM** (Thomas) |
| B1 | `POST /events` UI→server transport (collect `ui.*` incl. malformed/silent) | F-c §4 (Phase 2) | deferred |
| B2 | `event_log` retention sweep | F-c §4 | fast-follow |
| C1 | F.t6 conversation-analysis council + `conversation_analysis` table | Tier 2 §2.7 | **later** (needs Swoop "what to learn" + legal retention call) |
| C2 | BigQuery export + dashboards | Tier 1 §7 | later (needs analytics-platform preference) |
| C3 | Message-text-in-logs decision | questions.md | later (legal) |

Convention: each F-c item ticks here on merge; the F-c plan back-links to this review.
