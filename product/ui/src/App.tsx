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
import { useMemo, useState } from "react";
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

export default function App() {
  // One transport per app instance. `useMemo` keeps it stable across renders
  // so the runtime doesn't churn.
  const transport = useMemo(() => createOrchestratorTransport(), []);
  const runtime = useChatRuntime({ transport });

  // D.t4 gate. Single `useConsent()` instance — its state drives both the
  // OpeningScreen and the post-consent chat surface. Lifting it here prevents
  // a second hook instance inside OpeningScreen from getting its own state.
  const consent = useConsent();
  const { hasConsented, hasDeclined } = consent;

  // Pre-consent visitors can still open the privacy modal from the opening
  // screen's disclosure link. Post-consent, the `<ChromeBadge />` manages
  // its own modal state.
  const [privacyOpen, setPrivacyOpen] = useState(false);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {hasConsented ? (
        <ThreadPrimitive.Root className="flex h-full w-full flex-col bg-slate-50">
          <div className="flex w-full items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <ChromeBadge />
            <div aria-hidden="true" className="text-xs text-slate-400">
              Swoop Discovery
            </div>
          </div>
          <ThreadPrimitive.Viewport className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-4">
            <ThreadPrimitive.Empty>
              <EmptyState />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ Message: MessageView }} />
          </ThreadPrimitive.Viewport>
          <div className="flex w-full justify-center border-t border-slate-200 bg-white px-4 py-3">
            <Composer />
          </div>
        </ThreadPrimitive.Root>
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
