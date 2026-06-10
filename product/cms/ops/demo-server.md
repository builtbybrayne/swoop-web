# Puma demo-server runbook

Mac Mini demo-server operations. Owner: Alastair. Last reviewed: 2026-06-10.

**Back-link**: [03-exec-crosscut-magical-poincare-demo-stability.md](../../planning/03-exec-crosscut-magical-poincare-demo-stability.md) — Part B hardening, decision OPS.poincare-1.

---

## Architecture overview

```
External client (Luke's browser)
        │  HTTPS :443
        ▼
Tailscale Funnel  ──►  Mac Mini 127.0.0.1:5173  (vite preview — production build)
                                │
                                └── /api/*  ──►  :8080  (@swoop/orchestrator)
                                                     │
                                                     └──►  :3002  (@swoop/connector)
                                                                   │
                                                                   └──►  Postgres :5432
```

Key design decisions (OPS.poincare-1):

- **Production UI build served by `vite preview`** — no HMR websocket. Eliminates the "spontaneous browser refresh" failure class caused by Vite's WS reconnect-reload in dev mode.
- **`vite preview` proxy**: the `/api/*` → `:8080` proxy contract is preserved. `vite preview` reads `config.preview.proxy` (confirmed in vite 5.4.11 source). The `preview:` block in `ui/vite.config.ts` mirrors `server:`.
- **Non-watch services**: orchestrator and connector run their `start` semantics (not `dev`/watch). No file-watch restarts. A crash in one service does NOT tear down others.
- **launchd supervision**: each service is a LaunchAgent (user-level, `~/Library/LaunchAgents/`). Restart-on-crash, no file-watch trigger. `dev.sh` is untouched for laptop dev.
- **npm bypassed under launchd**: the plists invoke `node` directly (`node dist/index.js`, `node --import tsx src/server/index.ts`) because the npm wrapper does not propagate SIGTERM to its child (see `gotchas.md`) — with npm in the middle, `launchctl unload` would orphan the service and leave its port occupied.

---

## Cold-boot order (after Mac Mini restart or fresh setup)

Run these steps from the `product/` directory.

### 1. Prerequisites (one-time per checkout)

```bash
# Ensure npm packages are installed
npm install

# Build orchestrator (node dist/index.js needs compiled output)
npm run build -w @swoop/orchestrator

# Confirm .env files are present (gitignored — copy from secure store)
ls orchestrator/.env connector/.env
```

### 2. Install and start supervised services

```bash
bash scripts/setup-demo-services.sh install
```

This will:
- Build the UI (`vite build`) if `ui/dist/` is absent.
- Write three launchd plists to `~/Library/LaunchAgents/` with absolute paths resolved from the current `node` on PATH.
- Load services in order: connector (3 s gap) → orchestrator (2 s gap) → UI.

### 3. Verify health

```bash
bash scripts/setup-demo-services.sh status
```

Expected output: all three services `running (PID …)` and health endpoints returning OK.

Manual check:
```bash
curl -s http://localhost:8080/healthz   # → {"status":"ok"}
curl -s http://localhost:8080/readyz    # → {"status":"ok"}
curl -sI http://localhost:5173/          # → HTTP/1.1 200 OK
```

### 4. Start the Funnel

```bash
npm run funnel:up
```

This exposes `:5173` over Tailscale Funnel at `https://<mini-hostname>.ts.net`. Share that URL with the client.

---

## Funnel up / down

```bash
npm run funnel:up       # expose :5173 publicly (persists across shell sessions)
npm run funnel:down     # tear down the Funnel
npm run funnel:status   # show current Funnel config + public URL
```

The Funnel is independent from the services — services can run without the Funnel (LAN-only access).

---

## Manual start without launchd (`npm run demo`)

For ad-hoc runs (testing a branch, demoing from a laptop) there is a single foreground entry point that does NOT require installing launchd services:

```bash
npm run demo            # build UI + start connector + orchestrator + serve UI
npm run demo:ui-only    # build + serve UI only (no backend services)
```

What it does: builds the UI (`vite build`), starts connector and orchestrator via their non-watch `start` scripts in the background, then serves the build with `vite preview` on :5173 in the foreground. Ctrl+C tears everything down (all processes share the script's process group).

Limitations vs launchd: no restart-on-crash, dies with the terminal/SSH session. Use launchd (`setup-demo-services.sh install`) for unattended demo operation on the Mini.

---

## Where logs land

All logs write to `~/Library/Logs/puma/`:

| File | Contents |
|---|---|
| `connector.log` | connector stdout |
| `connector.err.log` | connector stderr |
| `orchestrator.log` | orchestrator stdout |
| `orchestrator.err.log` | orchestrator stderr |
| `ui.log` | vite preview stdout |
| `ui.err.log` | vite preview stderr |

Tail all logs at once:
```bash
bash scripts/setup-demo-services.sh logs
# or directly:
tail -f ~/Library/Logs/puma/*.log ~/Library/Logs/puma/*.err.log
```

Tail a specific service:
```bash
bash scripts/setup-demo-services.sh logs orchestrator
```

---

## Deploying a code change

### UI-only change (no backend changes)

```bash
# Rebuild UI and restart just the ui service (no backend interruption)
bash scripts/setup-demo-services.sh restart-ui
```

Active conversations are NOT disrupted — orchestrator keeps running with live sessions intact.

### Backend change (orchestrator or connector)

```bash
# 1. Pull the change
git pull

# 2. Install any new packages
npm install

# 3. If orchestrator changed: rebuild
npm run build -w @swoop/orchestrator

# 4. Restart all services (active sessions will be lost until B.t13 lands)
bash scripts/setup-demo-services.sh restart
```

**Note**: until [B.t13 Postgres-backed durable sessions](../../planning/03-exec-agent-runtime-t13.md) merges, orchestrator restart destroys in-memory sessions. Avoid restarting during an active client demo. See "Durable sessions" section below.

---

## Verifying proxy behaviour

A quick sanity check that `/api/*` is proxying correctly (orchestrator does NOT need to be running — a 502 proves the proxy is configured):

```bash
# With orchestrator DOWN: expect 502 Bad Gateway (proxy active, backend unreachable)
curl -v http://localhost:5173/api/healthz 2>&1 | grep "< HTTP"

# With orchestrator UP: expect 200
curl -s http://localhost:5173/api/healthz
```

A 404 from vite preview would mean the proxy is NOT configured — check `ui/vite.config.ts` `preview.proxy`.

---

## Restart / stop individual services

```bash
# launchctl directly (replace 'connector' with 'orchestrator' or 'ui' as needed)
launchctl unload ~/Library/LaunchAgents/uk.co.swoop.puma.connector.plist
launchctl load   ~/Library/LaunchAgents/uk.co.swoop.puma.connector.plist

# Or use the helper:
bash scripts/setup-demo-services.sh restart
bash scripts/setup-demo-services.sh restart-ui   # UI only, no session disruption
```

## Uninstall services

```bash
bash scripts/setup-demo-services.sh uninstall
```

Removes all three plists from `~/Library/LaunchAgents/` and unloads them. Logs remain in `~/Library/Logs/puma/`.

---

## sessionStorage-per-tab caveat (for demo drivers)

**Important for anyone running the demo:**

The UI stores `sessionId` in `sessionStorage`, which is **scoped to the browser tab**. Every new tab = a new session. This is by design (consent + context isolation), but it surprises demo drivers who:

- Open the demo URL in a second tab → that tab starts a fresh conversation.
- Share a link for someone else to open in their own browser → they get a fresh session.
- Use "Open in new tab" from the address bar → new session.

**To resume a session**: stay in the same tab. If the tab is accidentally closed and the orchestrator is still running, the session is gone from the UI side (sessionStorage was cleared) even though the server-side session may still exist.

This is not a bug — it is intentional design. Brief the client before handing them the URL.

---

## Durable sessions (B.t13)

*Once [03-exec-agent-runtime-t13.md — B.t13 Postgres-backed durable sessions](../../planning/03-exec-agent-runtime-t13.md) merges*, set the following env vars in `orchestrator/.env` to activate Postgres-backed sessions:

```env
SESSION_BACKEND=postgres
ORCHESTRATOR_DATABASE_URL=postgresql://al:<password>@localhost:5432/puma_dev
```

After B.t13, orchestrator restarts and Mac Mini reboots will **not** destroy active sessions — the UI rehydrates from Postgres on reload. The `sessionStorage-per-tab` caveat still applies (it is a client-side ID store, separate from backend persistence).

Mark as complete once B.t13 is merged and these env vars are confirmed working on the Mini.

---

## Troubleshooting

### Service not starting after install

```bash
bash scripts/setup-demo-services.sh status
# Check logs for the failing service:
bash scripts/setup-demo-services.sh logs orchestrator
```

Common causes:
- Missing `orchestrator/dist/index.js` → run `npm run build -w @swoop/orchestrator`.
- Missing `.env` files → copy from secure store.
- Port already in use → `lsof -i :8080` (or `:3002`, `:5173`).

### "Blocked request" from vite preview

If the browser console shows `Blocked request. This host is not allowed.`, the Tailscale hostname is not in `allowedHosts`. Check `ui/vite.config.ts` `preview.allowedHosts` includes `.ts.net`.

### Vite build stale / showing wrong version

```bash
bash scripts/setup-demo-services.sh restart-ui
# This rebuilds ui/dist/ from source and restarts the vite preview service.
```

### Funnel URL not reachable

```bash
npm run funnel:status
# If funnel is down:
npm run funnel:up
# If tailscale is not running:
tailscale up
```

### Session lost after Tab close

See "sessionStorage-per-tab caveat" above. Until B.t13 lands, there is no recovery — start a new session.
