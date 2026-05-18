# 03 — Crosscut: composer unresponsive after New conversation / restart (nice-knuth worktree)

**Status**: **POST-HOC BACKFILL** authored 2026-05-18. The work landed without
a Tier-3 plan having been written first — this file is provenance, not a
pre-execution spec. The convention (Tier-3-first, including for review-driven /
live-smoke fixes — see the 2026-05-13 brave-pare wave) was not honoured for
the nice-knuth wave; this backfill closes the documentation gap so a future
agent picking up adjacent restart / session-rehydrate / runtime-state work
has a coherent record to read against.

**Filename suffix `-nice-knuth-`**: worktree-slug-stamped per the 2026-05-13
collision-avoidance discipline.

**Chunk**: Crosscut — UI surface only; no wire schema change; no server change.
**Commit**: `4817a2d`.
**Merged to main**: `e141477`.

---

## What was asked for

Al's framing in the session that triggered this:

> "When I clear the conversation (either through the new conversation button
> or the expired conversation restart button) the text input for the chat
> window becomes unresponsive."

Both buttons share the `handleFreshChat` path in `App.tsx`; both reproduced
the same failure mode.

## Root cause (named via live-stack debugging)

Two interacting facts in the pre-fix `handleFreshChat`:

1. **`useChatRuntime` proxies the transport with empty-deps memoization.**
   `@assistant-ui/react-ai-sdk`'s `useDynamicChatTransport` wraps the
   passed-in transport in a `new Proxy(transportRef.current, ...)` memoized
   with `useMemo(..., [])`. Even when App.tsx churned the `transport` prop
   via `useMemo(..., [resetKey])`, the Proxy stayed the same instance, so
   the runtime never actually saw a new transport.

2. **`<AssistantRuntimeProvider key={resetKey}>` remounted only the children.**
   The chat-hook-local message state lived inside the child tree, so it
   reset cleanly (the thread *did* visibly clear). But the composer state
   lives in `@assistant-ui/store`'s global Zustand — outside the React
   subtree controlled by the key. The post-remount textarea's binding to
   the global store desynchronised:
   - Stale draft text persisted in the visible textarea.
   - The new textarea's `onChange` no longer propagated to the controlled
     value — typing didn't register.
   - Even direct `runtime.thread.composer.setText("…")` /
     `runtime.thread.composer.reset()` calls were no-ops (the runtime
     reported the methods existed, the calls returned successfully, but
     `getState().text` didn't update).
   - `runtime.threads.switchToNewThread()` cleared the thread but did NOT
     clear the composer or repair the binding.

The pre-fix pattern's only working effect was the thread-message reset (via
the child remount). The composer "fix" claimed by the discoveries.md
2026-04-24 entry on the `resetKey` pattern was never load-bearing for the
composer — it just happened to look fine in earlier paths that didn't
exercise the post-remount typing flow.

## What landed

Single file: [product/ui/src/App.tsx](../product/ui/src/App.tsx).

| Change | Detail |
|---|---|
| Removed `const [resetKey, setResetKey] = useState(0);` | The state is dead after this fix. |
| `transport` useMemo dep changed from `[resetKey]` to `[]` | Transport is now created once. It reads `sessionId` from `sessionStorage` per-request, so refreshed sessions are picked up automatically. |
| Removed `key={resetKey}` from `<AssistantRuntimeProvider>` | This was the source of the composer-binding desync. React tree no longer remounts on restart. |
| Replaced `setResetKey((k) => k + 1)` in `handleFreshChat` with `runtime.threads.switchToNewThread(); runtime.thread.composer.setText("");` | Library-sanctioned API path: switch to a fresh thread (clears messages) + explicitly clear any composer draft. |
| Same replacement in `useRehydrate.onExpired` callback | Both restart paths share the clearing pair. |

Net result: textarea is the same DOM node across the click (verified
`sameTextarea === true` in live smoke), composer clears cleanly, new typing
registers immediately, Send button enables.

## Decisions taken (informal — no decisions.md entries authored)

- **Drop the resetKey/provider-remount hack entirely.** It was load-bearing
  for thread-message clearing (via React remount of `useChat`-hook-local
  state), but the side effect (composer binding desync) is a worse bug than
  the convenience. Use the library-sanctioned `switchToNewThread` +
  `composer.setText("")` instead.
- **`switchToNewThread()` + `composer.setText("")` as a pair.**
  `switchToNewThread` alone leaves the composer draft live (assistant-ui
  treats the composer as UI state, not thread content). Pair the two so
  "New conversation" is a clean slate end-to-end.
- **Transport stays stable across restarts.** The Proxy-with-empty-deps
  pattern in `useChatRuntime` means changing the transport prop never had
  any effect anyway. Making it explicit (`useMemo(..., [])`) removes
  confusion for future readers.

## Verification done

- `npm run typecheck -w @swoop/ui` — green.
- `npm test -w @swoop/ui` — 19 files / 118 tests passed.
- Live preview on `:5183`, orchestrator stubbed via `fetch` override:
  - Type "Pre-click draft" → click "New conversation" → composer clears to
    `""`, thread shows empty state ("Start a conversation.").
  - Type "Brand new content" → value lands in the textarea, Send button
    enables.
  - Same DOM textarea node across the click — confirmed via
    `oldNode === newNode` reference equality in `preview_eval`.
  - User-bubble styling from the visitor-bubble work still intact
    (`flex-end`, `bg-slate-200`).

## What was skipped vs. convention

- **No Tier-3 plan authored before code touched.** Bug report → live
  debugging via `preview_eval` → fix → commit, all in one motion. Same
  gap as the visitor-bubble and malformed-prod-gate work — this is the
  third and final post-hoc backfill in the nice-knuth wave.
- **No decisions.md entries.** Three decisions above (drop resetKey,
  switchToNewThread+composer.setText pair, stable transport) would
  normally warrant numbered entries. Captured here instead; can be
  promoted on triage.
- **No discoveries.md entry.** The root-cause naming (proxy-with-empty-deps
  +  global-Zustand-survives-key-remount = composer binding desync) is
  worth pinning to discoveries.md so a future agent debugging similar
  symptoms doesn't redo the live-stack archaeology. Promote on next
  housekeeping pass.

## Bug provenance

This bug was **pre-existing** on `main` before the nice-knuth wave. The
visitor-bubble work (commit `de108bb` / merge `ed5cb01`) did not introduce
it — confirmed by reverting the `MessagePrimitive.If` MessageView change
mid-debug and reproducing the bug against the pre-nice-knuth shape.

The discoveries.md 2026-04-24 entry on the `resetKey` pattern ("Clearing
assistant-ui thread state without library internals: re-key the provider +
churn the transport") was the source of the bug. That entry should be
**updated** to note:

> Pattern superseded 2026-05-18 (nice-knuth wave). The `resetKey` + Proxy
> arrangement worked for thread-message clearing but desynchronised the
> composer-state binding (composer text persisted, typing stopped
> registering). Use `runtime.threads.switchToNewThread()` +
> `runtime.thread.composer.setText("")` instead — the library-sanctioned
> path. Transport can stay stable across restarts; it reads sessionId from
> storage per-request.

(Discoveries-md update not done in this wave — also a backfill TODO.)

## Follow-ups / open items

- Update `discoveries.md` 2026-04-24 entry as above.
- Promote the three informal decisions to `decisions.md` if convention
  benefits.
- Consider whether any other call site of the deprecated resetKey pattern
  exists elsewhere in the UI (e.g. error-banner restart, test fixtures).
  Quick grep at fix time showed `App.tsx` was the only consumer; verify on
  next pass.

## Cross-references

- Visitor-bubble work (separate commit `de108bb`, same wave): [`03-exec-crosscut-nice-knuth-visitor-bubble.md`](03-exec-crosscut-nice-knuth-visitor-bubble.md).
- Malformed-prod-gate work (same commit `de108bb`): [`03-exec-crosscut-nice-knuth-malformed-prod-gate.md`](03-exec-crosscut-nice-knuth-malformed-prod-gate.md).
- Predecessor (live-smoke pattern this should have followed):
  [`03-exec-crosscut-brave-pare-widget-user-copy-fix.md`](03-exec-crosscut-brave-pare-widget-user-copy-fix.md).
- Adjacent: [`03-exec-chat-surface-t9-mount-rehydrate.md`](03-exec-chat-surface-t9-mount-rehydrate.md) (the `useRehydrate` hook whose `onExpired` callback shares the new clearing-pair).
