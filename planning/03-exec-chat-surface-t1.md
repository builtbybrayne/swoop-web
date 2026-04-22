# 03 — Execution: D.t1 — Vite + assistant-ui scaffold

**Status**: Tier 3 execution plan. Draft, 2026-04-22.
**Chunk**: D (chat surface).
**Task**: t1 — Vite React SPA scaffold + assistant-ui + AI SDK adapter pointing at local orchestrator.
**Implements**: `planning/02-impl-chat-surface.md` §2.1 + §2.8 + decisions D.1 (assistant-ui) + D.7 (clean base styling).
**Depends on**: A.t1–A.t4 (workspace, empty `@swoop/ui` package), B.t1 or B.t5 (orchestrator endpoint to connect to — stubbed is fine).
**Produces**: `product/ui/` — Vite React app, assistant-ui `Thread` wired, AI SDK adapter, Tailwind, dev harness.
**Unblocks**: D.t2 (streaming consumption), D.t3 (widget port).
**Estimate**: 3–4 hours.

---

## Purpose

Stand up the React chat surface. Vite, Tailwind, assistant-ui's main `Thread` primitive, AI SDK v5 adapter pointing at the orchestrator SSE endpoint. No widgets yet (D.t3), no disclosure UX yet (D.t4), no error states yet (D.t5). Just a thread that can accept a user message and render whatever comes back.

---

## Deliverables

### `product/ui/` files

| File | Role |
|---|---|
| `product/ui/package.json` | Add deps: `react`, `react-dom`, `@assistant-ui/react` (verify current package name + version at implementation time), `@assistant-ui/react-ai-sdk` (or AI SDK adapter package), `ai` (Vercel AI SDK v5), `zod`, `@swoop/common`. Dev deps: `vite`, `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`, `typescript`, `@types/react`, `@types/react-dom`. Scripts: `dev` (vite), `build` (tsc + vite build), `preview` (vite preview), `typecheck` (tsc --noEmit), `lint`. |
| `product/ui/tsconfig.json` | Already scaffolded by A.t4; no change needed. |
| `product/ui/vite.config.ts` | React plugin, dev port 5173, env prefix `VITE_`, aliases if needed. |
| `product/ui/index.html` | Single `<div id="root" />` + root script. Terse. |
| `product/ui/tailwind.config.js` | Content glob covers `src/**/*.{ts,tsx,html}`. Theme empty (no Swoop brand tokens yet). Plugins minimal. |
| `product/ui/postcss.config.js` | Tailwind + autoprefixer. |
| `product/ui/src/main.tsx` | React entry. Renders `<App />` inside `<AssistantRuntimeProvider>` (or assistant-ui's equivalent provider primitive). |
| `product/ui/src/App.tsx` | Top-level layout: chat takes full viewport. Renders `<Thread />` (assistant-ui primitive). |
| `product/ui/src/styles/index.css` | Tailwind base / components / utilities. Any minimal `theme.css` overrides. |
| `product/ui/src/runtime/orchestrator-adapter.ts` | AI SDK adapter factory pointing at `VITE_ORCHESTRATOR_URL`. Handles session bootstrap (`POST /session`) on first interaction; stores `sessionId` in `sessionStorage`. |
| `product/ui/.env.example` | `VITE_ORCHESTRATOR_URL=http://localhost:8080`. |
| `product/ui/STREAM.md` | Updated from placeholder. |

### No widget renderers yet

D.t3 ports widgets. D.t1 renders plain text parts only.

### Dev harness (optional for D.t1, fine to defer)

A `src/dev-harness.tsx` exercising the Thread with a mocked adapter so UI work can proceed without a live orchestrator. Nice-to-have; not blocking.

---

## Key implementation notes

### 1. assistant-ui version pin

Pin to a specific version in `package.json` (not `^`). Library is pre-1.0; upgrade is deliberate. Record the pinned version in `planning/decisions.md` as D.1.

### 2. AI SDK adapter verification

Confirm the current `@assistant-ui/react-ai-sdk` package name and API. If the library's structure has changed since research, adapt — raise a PR against `planning/02-impl-chat-surface.md` if the deviation is meaningful.

### 3. Session bootstrap on first interaction

The adapter doesn't `POST /session` at mount — that's wasteful for users who never type. Bootstrap on the first user keystroke or message submit.

### 4. Consent capture — NOT here

D.t4 handles disclosure + primary consent. D.t1 allows a turn to be sent even without consent; the orchestrator (B.t5) returns 403. This is a known gap that D.t4 closes.

### 5. Session resumption

On mount, check `sessionStorage` for a `sessionId`. If present, use it. If not, wait for bootstrap. No backend check that the id still exists — a 404 from `/chat` triggers D.t5's "session expired" flow (not built yet; placeholder error is fine in D.t1).

### 6. Zero Swoop brand styling

Plain Tailwind, minimal `theme.css`, standard typography. Swoop's team adds identity later. D.t8 documents the extension surface.

### 7. Mobile not-yet-tested

D.t7 does the reflow pass. D.t1 just doesn't break — no horizontal scroll on a 375px viewport.

---

## References

- `@assistant-ui/react` docs — current primitives.
- AI SDK v5 — `message.parts` taxonomy.
- `chatgpt_poc/product/ui-react/vite.config.ts` — Vite config reference (simplify; drop `vite-plugin-singlefile`).

---

## Verification

1. `cd product && npm install` resolves without errors.
2. `cd product && npm run dev -w @swoop/ui` starts Vite on port 5173.
3. Browser at `http://localhost:5173` loads; `<Thread />` renders with an input field.
4. Typing a message + sending triggers a `POST /chat` to the orchestrator (if running).
5. Orchestrator response streams back; plain text parts appear in the thread.
6. Reload → same `sessionId` in `sessionStorage`; thread shows previous messages if the orchestrator supports resumption.
7. Close tab + reopen → new `sessionId` (sessionStorage cleared); fresh conversation.
8. Mobile viewport (375px width) — no horizontal scroll, text reflows.
9. Lighthouse / Axe doesn't scream about missing roles on the `Thread` component.

---

## Handoff notes

- Do not build tool-call widgets — D.t3.
- Do not build the disclosure UX — D.t4.
- Do not build error states — D.t5.
- If assistant-ui's API is significantly different from what Tier 2 D assumed, raise it. Don't silently adapt around it.
- Vite's dev server HMR should work. If HMR is broken, that's a signal worth investigating before moving on.
