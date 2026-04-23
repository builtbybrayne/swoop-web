// product/ui/src/disclosure/privacy-info-modal.tsx
//
// Lightweight modal with the longer "what happens with your data" copy.
// Opened from:
//   - The `<OpeningScreen />` disclosure link (pre-consent context).
//   - The persistent `<ChromeBadge />` during conversation (post-consent).
//
// Closeable via the X button, the explicit Close button, Esc, or
// click-outside. Focus is trapped while open and restored to the opener
// on close.
//
// See planning/03-exec-chat-surface-t4.md §"Privacy info modal" + §7.

import { useEffect, useRef } from "react";

// TODO(E.t5): replace with cms/legal/privacy-info.md authored copy once the
// legal / CMS surfaces land. Placeholder strings are deliberately generic
// so Swoop's team can brand-name the tool on embed.
const COPY = {
  heading: "How your conversation is handled",
  paragraphs: [
    "This is an AI-powered assistant. When you send a message, your text is processed by an AI model so the assistant can respond. The conversation is retained only long enough to help you — typically until you close the window.",
    "We do not sell your data, and your conversation is not used to train third-party AI models. Suppliers involved in processing may include our hosting provider and the AI model provider. If you'd like a copy of your conversation, or to have it deleted on request, contact us at privacy@example.com.",
  ],
  closeLabel: "Close",
  ariaCloseLabel: "Close privacy information",
} as const;

export interface PrivacyInfoModalProps {
  open: boolean;
  onClose: () => void;
}

export function PrivacyInfoModal({ open, onClose }: PrivacyInfoModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus management: on open, capture current focus, move into dialog.
  // On close, restore previously-focused element.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      (typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null) ?? null;

    // Defer one frame so the dialog is mounted before we move focus.
    const id = window.setTimeout(() => {
      firstFocusableRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(id);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  // Esc to close + rudimentary focus trap.
  useEffect(() => {
    if (!open) return;
    function handleKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="swoop-privacy-modal-heading"
      data-testid="privacy-info-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 transition-opacity duration-150"
      onClick={(ev) => {
        // Click-outside closes.
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="swoop-privacy-modal-heading"
            className="text-base font-semibold text-slate-900"
          >
            {/* TODO(E.t5): replace with cms/legal/privacy-info.md heading */}
            {COPY.heading}
          </h2>
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onClose}
            aria-label={COPY.ariaCloseLabel}
            data-testid="privacy-info-modal-close-x"
            className="-m-1 inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="mt-3 space-y-3 text-sm text-slate-700">
          {/* TODO(E.t5): replace with cms/legal/privacy-info.md body */}
          {COPY.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            data-testid="privacy-info-modal-close"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {/* TODO(E.t5): replace with cms/legal/privacy-info.md close label */}
            {COPY.closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

PrivacyInfoModal.displayName = "PrivacyInfoModal";
