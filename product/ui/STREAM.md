# Stream: @swoop/ui

**Status**: D.t1 complete — Vite + assistant-ui scaffold landed 2026-04-22.
**Current task**: D.t1 (Vite + assistant-ui scaffold) — complete.
**Next task**: D.t2 (streaming consumption + response-format parser integration).
**Blockers**: —
**Interface changes proposed**: —
**Last updated**: 2026-04-22

## What's wired

- React 18 + Vite 5 + Tailwind 3 SPA.
- `@assistant-ui/react@0.12.25` (pinned, no `^`) + `@assistant-ui/react-ai-sdk@1.3.19` (AI SDK v6 adapter).
- `AssistantRuntimeProvider` + `useChatRuntime({ transport })`.
- `ThreadPrimitive.*` + `MessagePrimitive.*` + `ComposerPrimitive.*` composition — no `@assistant-ui/react-ui` pre-styled shell (kept out to honour D.7 clean-base decision).
- Text parts only (D.t2 extends with `<fyi>`; D.t3 adds widgets).
- Session bootstrap lazy on first submit (`POST /session`); session id persisted in `sessionStorage` under `swoop.session.id` (decision D.8).
- Orchestrator URL via `VITE_ORCHESTRATOR_URL` (default `http://localhost:8080`).
- Dev port 5173.

## What's explicitly NOT wired

- Tool-call widget renderers (D.t3).
- Disclosure + primary consent opening screen (D.t4).
- Error states (D.t5).
- Session resume UX / expiry (D.t6).
- Mobile-specific reflow pass (D.t7) — a baseline "no horizontal scroll at 375px" is met.
- Markdown rendering — deferred; a decision about `@assistant-ui/react-markdown` vs a lighter renderer will be taken when needed.

## Extension points for downstream chunks

- `MessagePrimitive.Parts` `components` prop in `App.tsx` — D.t2 registers `tool-call`, custom data parts, and the `<fyi>` affordance here.
- `makeAssistantToolUI` from `@assistant-ui/react` — D.t3's widget registrations hang off this.
- `AssistantRuntimeProvider` wrapping in `App.tsx` — D.t4's disclosure / consent UI should wrap the provider (or gate it) so no session can bootstrap pre-consent.
