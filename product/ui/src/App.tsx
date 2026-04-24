// product/ui/src/App.tsx
//
// Top-level chat surface. Wires assistant-ui's runtime to the orchestrator
// transport, then composes a minimal Thread out of primitives:
//
//   AssistantRuntimeProvider
//     (pre-consent)  OpeningScreen          — D.t4 paired disclosure + tier-1 consent
//     (post-consent)
//       Thread.Root
//         ChromeBadge                       — D.t4 persistent AI-disclosure badge
//         Thread.Viewport
//           Thread.Empty     (welcome / placeholder)
//           Thread.Messages  (renders each message via MessageView)
//         Composer            (input + send)
//
// Message-part rendering is delegated to `parts/index.ts` (D.t2): text +
// ephemeral `<fyi>` + dev-mode reasoning guard. Tool-call widgets arrive in
// D.t3; consent UI in D.t4; error states in D.t5.
//
// References:
//   - planning/02-impl-chat-surface.md §2.1, §2.3, §2.4, §2.8
//   - planning/03-exec-chat-surface-t1.md
//   - planning/03-exec-chat-surface-t2.md
//   - planning/03-exec-chat-surface-t4.md

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useCallback, useMemo, useState } from "react";
import { createOrchestratorTransport } from "./runtime/orchestrator-adapter";
// Registers the `data-fyi` renderer + reasoning-guard (D.t2). Importing here
// is what gives assistant-ui the component map below; the module itself has
// no top-level side effects, but its named export encodes the full registry.
import { messagePartComponents } from "./parts";
import {
  ChromeBadge,
  OpeningScreen,
  PrivacyInfoModal,
  useConsent,
} from "./disclosure";
import { ErrorBanner, useRuntimeErrors } from "./errors";
import { usePreflight } from "./session";

/**
 * Per-message renderer. Delegates every part kind to the registry exported
 * from `./parts`. Tool-call widgets register in D.t3 by extending that map.
 */
function MessageView() {
  return (
    <MessagePrimitive.Root className="flex w-full max-w-2xl flex-col gap-2 py-3">
      <MessagePrimitive.Parts components={messagePartComponents} />
    </MessagePrimitive.Root>
  );
}

/**
 * Minimal composer: textarea (auto-growing) + send button. assistant-ui's
 * ComposerPrimitive.Input is a react-textarea-autosize under the hood, so it
 * reflows with content. No keyboard shortcuts beyond its defaults (Enter
 * submits, Shift-Enter inserts newline).
 */
function Composer() {
  return (
    <ComposerPrimitive.Root className="flex w-full max-w-2xl items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm focus-within:border-slate-400">
      <ComposerPrimitive.Input
        className="flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 outline-none placeholder:text-slate-400"
        placeholder="Ask anything about an adventure…"
        rows={1}
      />
      <ComposerPrimitive.Send
        className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Send
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-12 max-w-2xl px-4 text-center text-slate-500">
      <p className="text-base">Start a conversation.</p>
      <p className="mt-1 text-xs text-slate-400">
        Swoop Discovery · pre-release scaffold
      </p>
    </div>
  );
}

/**
 * The post-consent chat surface. Lives inside `<AssistantRuntimeProvider>` so
 * `useRuntimeErrors` can reach `useThread` / `useThreadRuntime`. Owns the
 * error banner between the message viewport and the composer.
 *
 * Split out from <App /> so the error hook is never mounted pre-consent (the
 * runtime provider is above it, but the thread has nothing in it and the
 * emitter never fires — still, clean separation > cleverness).
 */
function ThreadSurface({
  onRestart,
  onFreshChat,
}: {
  onRestart: () => void;
  onFreshChat: () => void;
}) {
  const { current, retry, restart, dismiss } = useRuntimeErrors({ onRestart });
  return (
    <ThreadPrimitive.Root className="flex h-full w-full flex-col bg-slate-50">
      <div className="flex w-full items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <ChromeBadge />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onFreshChat}
            data-testid="new-conversation"
            className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            New conversation
          </button>
          <div aria-hidden="true" className="hidden text-xs text-slate-400 sm:block">
            Swoop Discovery
          </div>
        </div>
      </div>
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-4">
        <ThreadPrimitive.Empty>
          <EmptyState />
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ Message: MessageView }} />
      </ThreadPrimitive.Viewport>
      <div className="flex w-full flex-col items-center border-t border-slate-200 bg-white px-4 py-3">
        <ErrorBanner
          error={current}
          onRetry={retry}
          onRestart={restart}
          onDismiss={dismiss}
        />
        <Composer />
      </div>
    </ThreadPrimitive.Root>
  );
}

export default function App() {
  // Bumped by the "Fresh chat" button and the error-banner restart flow.
  // Used two ways: (1) as a dep of the transport `useMemo` so a new
  // transport picks up the new session id from storage, and (2) as a
  // `key` on <AssistantRuntimeProvider> so the assistant-ui thread state
  // remounts clean (no stale messages from the previous conversation).
  const [resetKey, setResetKey] = useState(0);

  // `useMemo` on `resetKey` churns the transport each time we restart; the
  // runtime below then re-initialises against the new transport. Keeping
  // both keyed avoids any subtle state carry-over.
  const transport = useMemo(() => createOrchestratorTransport(), [resetKey]);
  const runtime = useChatRuntime({ transport });

  // D.t4 gate. Single `useConsent()` instance — its state drives both the
  // OpeningScreen and the post-consent chat surface. Lifting it here prevents
  // a second hook instance inside OpeningScreen from getting its own state.
  const consent = useConsent();
  const { hasConsented, hasDeclined } = consent;

  // D.t6: proactive session-preflight. Probes on mount / tab-focus / long
  // idle, emits `[session_not_found]` via the shared adapter channel on
  // expiry so D.t5's banner surfaces before the visitor types. Gated on
  // `hasConsented` — pre-consent there's no session id worth probing.
  usePreflight({
    enabled: hasConsented,
    sessionId:
      consent.status.state === "granted" ? consent.status.sessionId : null,
  });

  // Pre-consent visitors can still open the privacy modal from the opening
  // screen's disclosure link. Post-consent, the `<ChromeBadge />` manages
  // its own modal state.
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Soft-restart path: visitor stays in the chat surface, gets a new
  // server session, UI thread clears. Failures are emitted through the
  // shared adapter channel so the error banner surfaces them; we swallow
  // here so the callback stays sync-friendly.
  const handleFreshChat = useCallback(() => {
    void consent.refreshSession().then(
      () => setResetKey((k) => k + 1),
      () => {
        // refreshSession already emitted; banner handles display.
      },
    );
  }, [consent]);

  return (
    <AssistantRuntimeProvider key={resetKey} runtime={runtime}>
      {hasConsented ? (
        <ThreadSurface onRestart={handleFreshChat} onFreshChat={handleFreshChat} />
      ) : (
        <>
          <OpeningScreen
            onOpenPrivacyInfo={
              hasDeclined ? undefined : () => setPrivacyOpen(true)
            }
            status={consent.status}
            isGranting={consent.isGranting}
            hasDeclined={consent.hasDeclined}
            grantConsent={consent.grantConsent}
            declineConsent={consent.declineConsent}
          />
          <PrivacyInfoModal
            open={privacyOpen}
            onClose={() => setPrivacyOpen(false)}
          />
        </>
      )}
    </AssistantRuntimeProvider>
  );
}
