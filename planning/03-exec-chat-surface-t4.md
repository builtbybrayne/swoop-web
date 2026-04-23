# 03 — Execution: D.t4 — Disclosure + primary consent UX

**Status**: Tier 3 execution plan. Draft, 2026-04-23.
**Chunk**: D (chat surface).
**Task**: t4 — opening disclosure paired with tier-1 consent + persistent chrome badge.
**Implements**: `planning/02-impl-chat-surface.md` §2.4 + decisions D.4 (paired opening) + D.10 (persistent badge).
**Depends on**: D.t1 (scaffold), D.t2 (parts wiring), B.t5 (`POST /session` + `PATCH /session/:id/consent` endpoints).
**Produces**: opening screen that pairs EU AI Act Art. 50 disclosure with GDPR tier-1 consent; persistent chrome badge during the conversation; route to a human.
**Unblocks**: end-to-end M1 demo (without this, every `/chat` returns 403).
**Estimate**: 2–3 hours.

---

## Purpose

Puma's session state begins accumulating conversation data the moment a visitor types. Per chunk E §2.3, GDPR requires a lawful basis before processing; per EU AI Act Art. 50, AI disclosure must be unmissable. D.t4 satisfies both with a single paired opening screen — no chat begins until the visitor explicitly continues.

The persistent chrome badge satisfies the "AI disclosure must remain visible" requirement for the rest of the session.

---

## Deliverables

### `product/ui/src/disclosure/`

| File | Role |
|---|---|
| `disclosure/opening-screen.tsx` | Full-viewport modal-style screen on first load. Disclosure copy + tier-1 consent + Continue / No thanks controls. Loads copy from `@swoop/common` constants or hardcoded for now (chunk E.t5 / G land the real copy in `product/cms/legal/`; in the interim, use plausible placeholder copy with a comment marking it for E to replace). |
| `disclosure/chrome-badge.tsx` | Small persistent affordance — "AI assistant · info" — visible in the chat chrome at all times. Click → opens `<PrivacyInfoModal />`. |
| `disclosure/privacy-info-modal.tsx` | Lightweight modal with the longer "what happens with your data" copy. Closeable. |
| `disclosure/index.ts` | Barrel export. |
| `disclosure/use-consent.ts` | Hook managing local UI state — has-consented, current session id. Wires to `sessionStorage` for resume on reload. |
| `disclosure/__tests__/opening-screen.test.tsx` | Tests: renders correctly, Continue triggers session bootstrap + consent grant, No thanks closes cleanly without writing session state. |
| `disclosure/__tests__/chrome-badge.test.tsx` | Tests: badge renders, click opens modal. |

### Integration

- `App.tsx` updated to gate `<ThreadPrimitive.Root>` behind consent state. If no consent yet → render `<OpeningScreen />`. If consent granted → render the chat with `<ChromeBadge />` in the chrome.
- The session-bootstrap call (`POST /session`) and consent grant (`PATCH /session/:id/consent`) move from D.t1's just-in-time-on-first-keystroke pattern into the Continue button handler. Update D.t1's `runtime/orchestrator-adapter.ts` accordingly — bootstrap now happens at consent-grant time, not on first message.

### Copy source

Authoritative copy lives in `product/cms/legal/` (chunk E.t5 + G author it). For D.t4, hardcode plausible-and-bland placeholders with a `// TODO(E.t5): replace with cms/legal/disclosure-opening.md` comment per surface. Three copies to seed:

- Opening disclosure + consent body — ~3 sentences. AI disclosure + what we do with the conversation + privacy-link.
- Continue button label — "Continue".
- No thanks button label — "No thanks".
- Chrome badge label — "AI assistant".
- Privacy info modal body — ~2 paragraphs. Retention, processors (Anthropic + GCP), right-to-deletion contact.

Also expose a `disclosure-copy-version` string (e.g. `"v1"`) that the consent grant carries to the orchestrator, so future copy revisions are auditable per E.4.

---

## Key implementation notes

### 1. Pair, don't separate

Disclosure and tier-1 consent are one screen, one continue gesture. Not two modals chained. Not a banner-then-modal. One paired surface.

### 2. No thanks must actually leave

Clicking No thanks closes the chat surface cleanly (parent host can listen for a postMessage or just see the iframe go blank). Critically, no session id is requested from the orchestrator, no state is persisted, no analytics event fires. "No" means no.

### 3. Continue triggers bootstrap

Continue handler:
1. `POST /session` → receives `{sessionId, disclosureCopyVersion}`.
2. `PATCH /session/:id/consent` with `{granted: true, copyVersion: <returned version>}`.
3. Stores session id in `sessionStorage`.
4. Removes the opening screen; reveals `<Thread />`.

### 4. Resume on reload

If `sessionStorage` already holds a session id with a recorded consent flag, skip the opening screen and jump straight to the chat. The orchestrator side (B.t5) already gates `/chat` on consent; if the stored session has expired server-side, the next `/chat` returns 404 → D.t5 (later) handles gracefully; for D.t4, accept the bare 404 fallthrough.

### 5. Chrome badge is unmissable but unintrusive

Position: top of the chat surface, alongside any other chrome. Small, monochrome, hover-affordance. Shouldn't compete with the conversation visually.

### 6. Privacy info modal

Closeable via X, Esc, click-outside, and an explicit Close button. `role="dialog"` + `aria-modal="true"` + focus trap.

### 7. Accessibility

- Opening screen: focus moves to Continue button on render; Esc not bound (no easy escape — by design).
- Buttons: real `<button>`, not `<div onClick>`. Keyboard-operable.
- Modal: focus trap; first focusable on open; restored to badge on close.

### 8. No animation beyond fade

Subtle fade transitions (150–200ms). No bouncing, sliding, etc. Production-quality means clean, not flashy.

---

## References

- Tier 2 D §2.4 — paired flow, persistent chrome.
- Tier 2 E §2.3 — two-tier consent model (D.t4 is tier-1; D.t3's lead-capture handles tier-2).
- B.t5 endpoints: `POST /session`, `PATCH /session/:id/consent`, `DELETE /session/:id`.
- Chunk E §2.6 — copy will eventually live in `product/cms/legal/`.

---

## Verification

1. `cd product && npm run typecheck -w @swoop/ui` green.
2. `cd product && npm run lint -w @swoop/ui` green.
3. `cd product && npm run test -w @swoop/ui` — D.t4 tests pass; all prior tests still pass.
4. With Vite dev server running, browser at `http://localhost:5173` shows the opening screen on first load. Continue dismisses it; reload preserves the dismissed state.
5. With orchestrator running too, Continue triggers `POST /session` then `PATCH /session/:id/consent` (visible in DevTools Network tab). Subsequent `/chat` calls succeed (no 403).
6. No thanks: closes the surface cleanly; no network requests beyond the page load; `sessionStorage` empty.
7. Chrome badge visible during conversation; click opens the privacy info modal; modal closeable via X / Esc / click-outside.
8. Mobile (375px): opening screen + badge + modal all fit and remain operable.
9. Keyboard nav: Tab cycles through opening-screen controls; Enter activates Continue.
10. `grep -rn "TODO(E.t5)" product/ui/src/disclosure/` returns the placeholder-copy markers — visible audit trail for chunk E to find.

---

## Handoff notes

- Do not author final legal copy. Placeholder + TODO comments only. Real copy lands in `product/cms/legal/` via chunk E.t5 + G drafting + legal counsel review.
- Do not add the secondary (tier-2) handoff consent — that's D.t3's `lead-capture` widget (already done).
- Do not implement session expiry UX — D.t5/t6.
- Do not gate non-chat surfaces (e.g. error states) behind consent — D.t5's error states render unconditionally.
- The `disclosureCopyVersion` returned by `POST /session` is the orchestrator's authoritative version. The UI's consent grant must echo it back unchanged so the orchestrator's audit log records what the user actually saw.
