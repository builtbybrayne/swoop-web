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
import { useCallback, useEffect, useMemo, useState } from "react";
import { createOrchestratorTransport } from "./runtime/orchestrator-adapter";
import { emitUiEvent } from "./runtime/emit-ui-event";
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
import { usePreflight, useRehydrate } from "./session";

/**
 * Per-message renderer. Branches on role via `MessagePrimitive.If` so visitor
 * turns are visually distinct from the agent's:
 *
 *   - Visitor (`user`): right-aligned bubble — subtle slate background,
 *     rounded corners with a tucked bottom-right, capped at ~75% width.
 *     `data-swoop-role="user"` hook on the root + `data-swoop-part="message-bubble"`
 *     on the inner bubble so Swoop's brand team can re-skin without touching
 *     React internals.
 *   - Agent (`assistant`): full-width prose + tool-call widgets, matching
 *     the existing layout (no bubble, no alignment shift).
 *
 * Both branches delegate part rendering to the registry from `./parts`. In
 * practice user messages today are text-only, but routing both through the
 * same part registry keeps the door open without special-casing.
 *
 * `MessagePrimitive.If` is marked deprecated in 0.12.25 in favour of an
 * `<AuiIf>` API that's still settling; keeping the deprecated primitive is
 * the right tradeoff for now (the rest of the codebase consumes the
 * `MessagePrimitive.*` namespace consistently).
 */
/**
 * Per-message renderer. Branches on role via `MessagePrimitive.If` so visitor
 * turns are visually distinct from the agent's:
 *
 *   - Visitor (`user`): right-aligned bubble — subtle slate background,
 *     rounded corners with a tucked bottom-right, capped at ~75% width.
 *     `data-swoop-role="user"` hook on the root + `data-swoop-part="message-bubble"`
 *     on the inner bubble so Swoop's brand team can re-skin without touching
 *     React internals.
 *   - Agent (`assistant`): full-width prose + tool-call widgets, matching
 *     the existing layout (no bubble, no alignment shift).
 *
 * Both branches delegate part rendering to the registry from `./parts`. In
 * practice user messages today are text-only, but routing both through the
 * same part registry keeps the door open without special-casing.
 *
 * `MessagePrimitive.If` is marked deprecated in 0.12.25 in favour of an
 * `<AuiIf>` API that's still settling; keeping the deprecated primitive is
 * the right tradeoff for now (the rest of the codebase consumes the
 * `MessagePrimitive.*` namespace consistently).
 */
function MessageView() {
  return (
    <>
      <MessagePrimitive.If user>
        <MessagePrimitive.Root
          data-swoop-part="message"
          data-swoop-role="user"
          className="flex w-full max-w-2xl justify-end py-1.5"
        >
          <div
            data-swoop-part="message-bubble"
            className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-200 px-4 py-2 text-[15px] leading-6 text-slate-900 sm:max-w-[75%]"
          >
            <MessagePrimitive.Parts components={messagePartComponents} />
          </div>
        </MessagePrimitive.Root>
      </MessagePrimitive.If>
      <MessagePrimitive.If assistant>
        <MessagePrimitive.Root
          data-swoop-part="message"
          data-swoop-role="assistant"
          className="flex w-full max-w-2xl flex-col gap-2 py-3"
        >
          <MessagePrimitive.Parts components={messagePartComponents} />
        </MessagePrimitive.Root>
      </MessagePrimitive.If>
    </>
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
    <ComposerPrimitive.Root
      data-swoop-part="composer"
      className="flex w-full max-w-2xl items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm focus-within:border-slate-400"
    >
      <ComposerPrimitive.Input
        className="flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 outline-none placeholder:text-slate-400"
        placeholder="Ask anything about an adventure…"
        rows={1}
      />
      <ComposerPrimitive.Send
        data-swoop-part="composer-send"
        className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Send
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

/**
 * Cheap UA classification for `ui.conversation_opened`. Kept local — not
 * worth a dep for three buckets. "unknown" on SSR / missing UA.
 */
function detectUaCategory(): "desktop" | "mobile" | "tablet" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent ?? "";
  if (!ua) return "unknown";
  if (/iPad|Tablet|Nexus 7|Nexus 10/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
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
      <div
        data-swoop-part="thread-header"
        className="flex w-full items-center justify-between border-b border-slate-200 bg-white px-4 py-2"
      >
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
  // Fire `ui.conversation_opened` once per mount. Pre-consent this still
  // emits with a `"unknown"` sessionId — that's the signal that a visitor
  // reached the surface but hasn't committed yet. Post-consent reloads
  // read the stored id and the event carries it.
  useEffect(() => {
    emitUiEvent({
      eventType: "ui.conversation_opened",
      payload: {
        source: "mount",
        uaCategory: detectUaCategory(),
      },
    });
    // No cleanup emit here — `ui.conversation_closed` is fired explicitly on
    // "Fresh chat" (below) and on tab-close via `beforeunload`.
  }, []);

  // Best-effort `ui.conversation_closed` on tab/navigation close. Modern
  // browsers ignore async work in `beforeunload` but `emitEvent` → default
  // sink → `console.log` is synchronous JSON-line write, which the Cloud
  // Run stdout pipe captures. If the pipe loses it (rare), the server-side
  // `session.ended` from DELETE / idle-sweep is the compensating signal.
  useEffect(() => {
    const onBeforeUnload = (): void => {
      emitUiEvent({
        eventType: "ui.conversation_closed",
        payload: { closeReason: "tab_close" },
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Transport is created once and reused. It reads the current session id
  // from sessionStorage per-request, so a fresh-chat / restart that mints
  // a new session id is picked up automatically by the next outbound call.
  // We deliberately do NOT re-create the transport (or re-key the provider)
  // on restart: assistant-ui's `useChatRuntime` wraps the transport in a
  // stable Proxy memoized with empty deps, so churning the transport prop
  // doesn't actually swap the runtime — but a `key` bump on
  // `<AssistantRuntimeProvider>` DID remount the React tree, which left
  // the composer's global Zustand state out of sync with the post-remount
  // tree and made the textarea unresponsive to typing. See `handleFreshChat`
  // below for the supported clearing path (`runtime.threads.switchToNewThread()`).
  const transport = useMemo(() => createOrchestratorTransport(), []);
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

  // D.t9-mount-rehydrate: on mount, if sessionStorage holds a session id and
  // consent is granted, fetch history from B.t11's `GET /session/:id/history`
  // and replay the parts into the assistant-ui thread so the visitor lands on
  // the conversation surface — no OpeningScreen flash. Per HITL Q1
  // ratification 2026-05-12: 404 soft-fails to OpeningScreen with a small
  // notification (no manual click required).
  //
  // The notification copy lives inline per plan default (HITL Q3 still open;
  // executor's call). Renders only on the next OpeningScreen render after
  // `onExpired` runs.
  const [rehydrateNotification, setRehydrateNotification] = useState<
    string | undefined
  >(undefined);
  useRehydrate({
    enabled: hasConsented,
    sessionId:
      consent.status.state === "granted" ? consent.status.sessionId : null,
    runtime,
    onExpired: () => {
      // Per HITL ratification: clear sessionStorage automatically, route to
      // OpeningScreen, surface a brief notification. No manual click required.
      // `clearSilently` wipes storage + flips status back to "pending" without
      // emitting `consent.declined` (the visitor never declined).
      setRehydrateNotification(
        "Your previous conversation expired — please start a new one.",
      );
      consent.clearSilently();
      // Switch to a fresh assistant-ui thread + clear any drafted composer
      // text so neither bleeds across the OpeningScreen boundary into the
      // subsequent post-consent render.
      runtime.threads.switchToNewThread();
      runtime.thread.composer.setText("");
    },
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
    // Emit the close for the outgoing session before the new one lands.
    // `closeReason: "restart"` is the discriminator downstream analysis
    // uses to tell a deliberate fresh-chat from a tab-close or navigation.
    emitUiEvent({
      eventType: "ui.conversation_closed",
      payload: { closeReason: "restart" },
    });
    void consent.refreshSession().then(
      () => {
        // Use the assistant-ui-sanctioned API to start a new thread (clears
        // the thread message list) and explicitly clear the composer text
        // (clears any drafted input). The earlier pattern of bumping a
        // resetKey on `<AssistantRuntimeProvider>` cleared messages via a
        // React remount of the chat hook's local state, but left the
        // composer's global Zustand state live AND broke its binding to the
        // post-remount tree — the textarea then shipped stale input and was
        // unresponsive to further typing.
        runtime.threads.switchToNewThread();
        runtime.thread.composer.setText("");
      },
      () => {
        // refreshSession already emitted; banner handles display.
      },
    );
  }, [consent, runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
            grantConsent={async () => {
              // Clear the rehydrate notification on a fresh consent action so
              // it doesn't linger after the visitor has started over.
              setRehydrateNotification(undefined);
              await consent.grantConsent();
            }}
            declineConsent={consent.declineConsent}
            notification={rehydrateNotification}
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
