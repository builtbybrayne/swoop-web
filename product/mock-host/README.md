# Mock host harness

> **Dev only. Not for deployment.** This folder is a local test harness whose
> only job is to let the Puma chat iframe be observed inside a plausible
> multi-page site. It is not the real Swoop website, will never be deployed,
> and is intentionally cheap — plain static HTML, hand-written CSS, vanilla
> JS, no build step, no framework.

Spec: [`planning/02-impl-side-quest-host-harness.md`](../../planning/02-impl-side-quest-host-harness.md)
Execution plan: [`planning/03-exec-side-quest-host-harness.md`](../../planning/03-exec-side-quest-host-harness.md)

---

## Run

From `product/`:

```bash
npm run mock-host
```

which is just `npx --yes serve mock-host -l 4173`. Browse http://localhost:4173/.

For a full dev loop you'll typically want three processes:

| Service | Port | Command |
|---|---|---|
| Orchestrator | 8080 | `npm run dev -w orchestrator` |
| Chat UI | 5173 | `npm run dev -w ui` |
| Mock host | 4173 | `npm run mock-host` |

The chat iframe embedded by the mock host points at `http://localhost:5173`. If
`:5173` isn't running the iframe will load broken — that's expected.

## Pages

- `/` or `/index.html` — Home
- `/regions.html` — Regions overview
- `/trek.html` — W Trek detail
- `/about.html` — About
- `/contact.html` — Contact

The top-nav "Chat to us" button and any in-page `[data-chat-trigger]` link
toggles a right-docked sidebar holding the Puma chat iframe. On desktop
(viewport ≥ 721px) the page reflows left via `body.mock-chat-open
{ padding-right: 420px }`; on mobile the sidebar overlays full-width.

The sidebar pattern (not a bottom-right popup) is intentional: once a
persistence layer lands, the sidebar should auto-reopen when a
conversation is in flight. That auto-reopen is **not implemented yet** —
`shared/chat-trigger.js` is where it will hook in.

## Known behaviours (the ones we care about)

- **Chat dies on nav.** Clicking any internal link triggers a full browser
  page load, which tears down the iframe and the chat conversation with it.
  **This is the observation target of the whole harness.** Don't "fix" it
  here. Decide what to do about it in response (see the parent side-quest
  Tier 1 doc).
- **Orchestrator restart mid-session.** Per
  [`gotchas.md`](../../gotchas.md#session-state-is-in-memory--orchestrator-restart-kills-all-active-sessions),
  the orchestrator's session store is in-memory. Restart kills all sessions;
  the chat will 404 on the next turn. Clear `sessionStorage` in the iframe
  (DevTools → Application → Storage → http://localhost:5173) and reload.

## Scope fences

This harness does **not**:

- Coordinate iframe/parent via `postMessage`.
- Persist chat state across pages.
- Style itself to match real Swoop branding.
- Contain any real Swoop content.
- Deploy anywhere, ever.

If you find yourself wanting any of the above, that's a signal to revisit the
parent side-quest plan — not to modify this harness.

## File map

```
mock-host/
├── README.md           — this file
├── index.html          — Home
├── regions.html        — Regions overview
├── trek.html           — W Trek detail
├── about.html          — About
├── contact.html        — Contact
└── shared/
    ├── site.css        — layout + type, ~200 lines
    └── chat-trigger.js — iframe inject/dismiss on [data-chat-trigger] click
```
