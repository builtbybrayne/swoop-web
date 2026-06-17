# 03-exec — Sales-Memory T3-2: staff authentication

**Status**: DRAFT, 2026-06-16. Pending ratification. Part of [02-impl-sales-memory.md](02-impl-sales-memory.md) (T2). Implements decision **sm-7** (auth) + **sm-4** (server-side gating).
**Workspaces**: `orchestrator` (route + validation + session flag), `ui` (triggers + popup + token storage), `@swoop/common` (schema + interface type).
**Sequences**: parallel with T3-1. T3-3's routing reads the staff/mode flag this task sets.

> **Altitude note**: framing + context fixed here; the executing agent picks the JWT library, exact route/middleware shapes, and UI component wiring, following existing patterns.

---

## Purpose (and where it sits)

Auth is the gate that lets a *trusted* sales member author memory while keeping the public surface untouched. It is the enabling boundary for the whole capability — and the **only "Higher-tier" chunk** here (a system that has no auth today gets a minimal, swappable one).

## Context to respect (read before building)

- **There is no UI-side agent** (decision D.11; the UI is a pure renderer). The browser never receives tool definitions — only rendered tool-call events. So **all gating is server-side and sufficient**: this task's job client-side is only to *obtain and present a token*; the orchestrator decides what that token unlocks (T3-3). A client flag is never the boundary.
- **`ChatRequestSchema` extension has precedent** — B.t12 added optional `clientTime` to the `{sessionId, message}` `.strict()` request. Add an optional staff token the same way; don't invent a new transport.
- **Session state already persists in Postgres** (B.t2 / B.t13). The staff flag + the `mode` flag (T3-3) live there, so they're shared across Cloud Run instances — not in-process.
- **Security headers / helmet are already in place** (Sec-2, 2026-04-30 review). The new `/staff/auth` route inherits that posture and adds the one thing the project otherwise defers: **rate-limit / lockout** on a public password endpoint (sm-7).
- **The UI consent/bootstrap flow** (`product/ui/src/disclosure/use-consent.ts`, `App.tsx`, the session bootstrap) is where the two triggers + the popup hook in. Reuse that surface; don't build a parallel one.

## What to build

1. **`StaffAuthenticator` interface** (in `@swoop/common`) — `verify(credential) → {ok, staffName}`, `issue/validate token`. v1 impl `SharedPasswordAuthenticator` (one staff password from config/secret + the staff member's name captured once for attribution). This interface is the swap seam: a later `GoogleOidcAuthenticator` drops in with **no caller change** (theme 4; mirrors `HandoffStore` interim→durable, E.1/E.12). **Keep the seam clean — this is the explicitly-requested refactor path.**
2. **`POST /staff/auth`** on the orchestrator — validates the credential via the authenticator, issues a JWT (~30-day, sm-7), rate-limited / lockout-protected.
3. **Two client triggers, one popup** (sm-7): (a) a magic URL param on the **direct widget URL** (not the iframe — storage/ITP); (b) a global **`window.swoop_login()`** console function exposed on the widget page (fallback recipe: Inspect → console → `swoop_login`; re-triggerable for testing/re-auth). Both open the same password popup → `/staff/auth` → JWT in `localStorage` → sent on subsequent chat/session requests.
4. **Orchestrator validation** — validate the token at session bootstrap (and/or per request); set the staff flag + allow entry to `mode` handling (consumed by T3-3). Invalid/expired → ordinary visitor session (graceful; preserve any in-flight draft on mid-session expiry).
5. **Token threading to the connector** — pass the validated token through so connector mutates can re-validate (T3-1 sm-4).

## Verification intent

- Both triggers (URL param + `swoop_login()`) open the popup; a correct password yields a staff session; `swoop_login()` is re-callable.
- Unauthenticated `/staff/auth` attempts are rate-limited/locked.
- A visitor session (no token) can neither see nor invoke memory tools (proven end-to-end with T3-3).
- Swapping `SharedPasswordAuthenticator` for a stub second authenticator requires **zero changes** outside the impl — proves the seam.
- Token works from the **direct** URL inside a real embed scenario (the iframe-storage caveat is respected).

## Scope guards (YAGNI)

Shared password for v1; per-user credentials are v2 **behind the same interface** (no rework). No OAuth in v1. No client-side trust. Rate-limiting added *here only* (still deferred elsewhere, top-level §7).
