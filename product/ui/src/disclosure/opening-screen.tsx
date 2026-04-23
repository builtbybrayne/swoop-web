// product/ui/src/disclosure/opening-screen.tsx
//
// Full-viewport modal-style screen shown on first load. Pairs EU AI Act Art.
// 50 disclosure with GDPR tier-1 consent in a single paired gesture — no chat
// begins until the visitor explicitly continues.
//
// See planning/03-exec-chat-surface-t4.md §"Pair, don't separate" and
// §"Continue triggers bootstrap".

import { useEffect, useRef } from "react";
import type { ConsentStatus } from "./use-consent";

// TODO(E.t5): replace with cms/legal/disclosure-opening.md authored copy +
// final legal review. All strings in this module are placeholder scaffolding
// so the surface renders end-to-end for the M1 demo. Keep brand-agnostic.
const COPY = {
  heading: "Before we start",
  intro:
    "This is an AI assistant. It helps you explore trip ideas by chatting with you and suggesting options from our library.",
  body:
    "To answer your questions, we process the messages you send during this conversation. Nothing you type is used to train third-party AI models, and the conversation is kept only for as long as it takes to help you.",
  bodyContinued:
    "If you'd prefer not to start the conversation, you can decline — no data is recorded.",
  privacyLinkLabel: "Read how we handle your data",
  continueLabel: "Continue",
  declineLabel: "No thanks",
  grantingLabel: "One moment…",
  errorPrefix: "Couldn't start the conversation:",
  declinedHeading: "No problem",
  declinedBody:
    "Nothing has been recorded. You can close this window — or reload the page if you change your mind.",
} as const;

interface OpeningScreenProps {
  /**
   * Called when the visitor clicks the privacy link in the disclosure body.
   * Parent wires this to the same `<PrivacyInfoModal />` the chrome badge
   * opens post-consent. Optional — if omitted, no link is rendered.
   */
  onOpenPrivacyInfo?: () => void;
  /** Consent state from `useConsent()` — lifted to the parent so a single
   *  hook instance backs both the screen and the gate in `App.tsx`. */
  status: ConsentStatus;
  isGranting: boolean;
  hasDeclined: boolean;
  grantConsent: () => Promise<void>;
  declineConsent: () => void;
}

/**
 * Opening screen. Consent state is provided by the caller (lifted to `App.tsx`)
 * so a single `useConsent()` instance drives both the screen and the
 * post-consent gate. Rendered by `App.tsx` when `!hasConsented`.
 */
export function OpeningScreen({
  onOpenPrivacyInfo,
  status,
  isGranting,
  hasDeclined,
  grantConsent,
  declineConsent,
}: OpeningScreenProps) {

  const continueRef = useRef<HTMLButtonElement | null>(null);

  // Move focus to Continue on render so keyboard-first visitors can Enter
  // straight through. Esc is deliberately not bound — by-design per plan §7.
  useEffect(() => {
    continueRef.current?.focus();
  }, []);

  if (hasDeclined) {
    return (
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="swoop-disclosure-declined-heading"
        data-testid="opening-screen-declined"
        className="flex h-full w-full items-center justify-center bg-slate-50 p-4"
      >
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h2
            id="swoop-disclosure-declined-heading"
            className="text-lg font-semibold text-slate-900"
          >
            {/* TODO(E.t5): replace with cms/legal/disclosure-declined.md */}
            {COPY.declinedHeading}
          </h2>
          <p className="mt-2 text-sm text-slate-600">{COPY.declinedBody}</p>
        </div>
      </section>
    );
  }

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="swoop-disclosure-heading"
      aria-describedby="swoop-disclosure-body"
      data-testid="opening-screen"
      className="flex h-full w-full items-center justify-center bg-slate-50 p-4 transition-opacity duration-200"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2
          id="swoop-disclosure-heading"
          className="text-lg font-semibold text-slate-900"
        >
          {/* TODO(E.t5): replace with cms/legal/disclosure-opening.md heading */}
          {COPY.heading}
        </h2>

        <div id="swoop-disclosure-body" className="mt-3 space-y-3 text-sm text-slate-700">
          {/* TODO(E.t5): replace with cms/legal/disclosure-opening.md body copy */}
          <p>{COPY.intro}</p>
          <p>{COPY.body}</p>
          <p>{COPY.bodyContinued}</p>
          {onOpenPrivacyInfo ? (
            <p>
              <button
                type="button"
                onClick={onOpenPrivacyInfo}
                className="text-sm font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
                data-testid="opening-screen-privacy-link"
              >
                {COPY.privacyLinkLabel}
              </button>
            </p>
          ) : null}
        </div>

        {status.state === "error" ? (
          <p
            role="alert"
            data-testid="opening-screen-error"
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800"
          >
            {COPY.errorPrefix} {status.message}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={declineConsent}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isGranting}
            data-testid="opening-screen-decline"
          >
            {/* TODO(E.t5): replace with cms/legal/disclosure-opening.md decline label */}
            {COPY.declineLabel}
          </button>
          <button
            ref={continueRef}
            type="button"
            onClick={() => {
              void grantConsent();
            }}
            className="inline-flex items-center justify-center rounded-md border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isGranting}
            data-testid="opening-screen-continue"
            aria-busy={isGranting || undefined}
          >
            {/* TODO(E.t5): replace with cms/legal/disclosure-opening.md continue label */}
            {isGranting ? COPY.grantingLabel : COPY.continueLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

OpeningScreen.displayName = "OpeningScreen";
