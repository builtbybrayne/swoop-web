# 03 — Crosscut: demo stability — refresh/history-loss investigation + hardening (Luke bug report, 2026-06-10)

**Status**: DRAFT — pending HITL ratification. Part C is a stub to promote.
**Back-link**: [2026-06-10 Luke Loom feedback ledger](reviews/2026-06-10-luke-loom-feedback.md) item B1 — Luke (direct to Alastair): pages "just refreshing" and losing conversation history on the demo; possibly Tailscale; debug in case a timeout kills chats.
**Surfaces**: Mac Mini demo deployment (ops), `product/scripts/` (serve scripts), `@swoop/ui` (build/serve mode), later `@swoop/orchestrator` (Part C).

---

## ★ Read this first — the hypothesis chain (evidence-based, unproven live)

Two stacked defects plausibly produce exactly Luke's symptom; neither is Tailscale-as-cause (the Funnel is just the flakiness *carrier*):

1. **The spontaneous refresh**: the Mini serves the **Vite dev server** through the Funnel ([funnel.sh](../product/scripts/funnel.sh): browser → Funnel :443 → `127.0.0.1:5173`, SPA + `/api/*` proxy). Vite's HMR **websocket** through that proxy is drop-prone; on WS reconnect-after-drop Vite's client can `location.reload()` (its server-restart recovery). A production build has no HMR socket — the whole failure class vanishes.
2. **The history loss**: sessions are **in-memory** ([known gotcha](../gotchas.md) — orchestrator restart kills all sessions). [dev.sh](../product/scripts/dev.sh) runs every workspace dev script under `concurrently --kill-others-on-fail` in watch mode — a crash in *any* service, or any file touch, restarts the orchestrator and destroys live sessions. After that, any reload → rehydrate `GET /session/:id/history` 404 → `onExpired` → fresh thread. (`SESSION_TTL_IDLE_HOURS=24` default makes TTL expiry an unlikely mid-demo cause; [B.t11's](03-exec-agent-runtime-t11.md) `session.expired {gate}` events discriminate the paths.)

Also rule in/out while there: sessionStorage is per-tab — a link re-opened in a new tab is a *new* session by design (not a bug, but may explain some reports); SSE drops through the Funnel (mid-stream cut ≠ history loss, but contributes to the "flaky" feel).

## Part A — Investigate (timeboxed ~half day, evidence before changes)

1. On the Mini: capture how services are actually launched today (shell history / running processes — `npm run dev`? separate watches? anything under launchd?). Pull orchestrator logs + UI event stream for `session.expired` events and correlate with orchestrator process start times around Luke's session timestamps (his Loom is 10 Jun).
2. Reproduce: open a Funnel session from an off-LAN client, idle 10–20 min, watch for Vite WS drop + reload (browser console shows Vite's `[vite] server connection lost` / reload messages). Touch a file server-side → confirm watch-restart kills the session and reload lands on a fresh thread.
3. Log findings in this plan's execution log; adjust Part B if the evidence surprises.

## Part B — Harden the demo (the fix for the reload class + restart frequency)

1. **Serve a built UI**: `vite build` + static serve (`vite preview` or a tiny static server) on :5173 (keep the port so [funnel.sh](../product/scripts/funnel.sh) and the `/api/*` proxy contract stay put — `vite preview` honours the same proxy config; verify, else front with Caddy/nginx-lite). No HMR socket → no dev-reload class. Add `npm run demo` (build + serve UI, run orchestrator + connector **non-watch** `npm start`) as the Mini's single entry point, documented in a short runbook `product/cms/ops/demo-server.md` (boot order, funnel up/down, where logs land, the sessionStorage-per-tab caveat for demo drivers).
2. **Supervise, don't watch**: orchestrator + connector via launchd plists (or `pm2` if simpler on the Mini — executor picks, documents) — restart-on-crash *without* file-watch restarts, logs to files. `--kill-others-on-fail` disappears from the demo path (dev.sh stays for laptop dev).
3. **Re-test** the Part A reproduction: idle + reload now resumes the conversation (rehydrate works when the session survives); file-touch no longer restarts anything.

**Decision (proposed) OPS.poincare-1**: the demo box serves a production UI build and supervised non-watch services; dev-mode serving is for development machines only.

## Part C — Durable sessions (B.t13 stub — the structural fix; promote to `03-exec-agent-runtime-t13.md` on ratification)

Hardening reduces restart frequency; it cannot make restarts safe. The structural fix is the long-planned session-backend swap (decision B.2 named Vertex/Firestore, pre-dating the [single-VM reframe](reviews/2026-05-27-ingest-and-state-of-play.md)): a **Postgres-backed ADK `SessionService`** against the same instance the connector already uses — sessions survive orchestrator restarts and deploys; rehydrate then *always* has something to rehydrate; demo and prod share the durability story.

Shape (for the full Tier 3): implement ADK's SessionService interface over a `puma` session table (+ migration); feature-flagged swap in the orchestrator boot path; the recent [assistant-text persistence fix (`9e990db`)](../progress.md) already normalised what gets written per turn; B.t11 history projection reads through the same store; TTL sweep moves from in-memory bookkeeping to a SQL sweep consistent with [E.t6's sweeper pattern](03-exec-handoff-t6.md). Estimate ~1–2 days. **This is the one genuine code-scope addition from Luke's feedback round — flag against the commercial fence at ratification.**

## Out of scope

- Tailscale ACL/cert changes (carrier, not cause — revisit only if Part A falsifies the hypothesis).
- GCE/Cloud Run moves (separate roadmap).
- UI offline/retry UX polish beyond what exists (D.t5 error surfaces unchanged).

## Verification

- Part A: written findings with timestamps/log excerpts (the deliverable is evidence).
- Part B: scripted check — kill -9 the orchestrator → supervisor restarts it; browser reload during an active conversation → conversation resumes (post-Part-C this also covers restart-during-conversation); 30-min idle Funnel session → no spontaneous reload (watch console).
- Runbook exists and a cold boot of the Mini following it yields a working demo.

## Estimate

Part A ~0.5d · Part B ~0.5d · Part C ~1–2d (separate ratification).
