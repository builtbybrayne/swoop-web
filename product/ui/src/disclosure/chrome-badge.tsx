// product/ui/src/disclosure/chrome-badge.tsx
//
// Small persistent AI-disclosure affordance rendered in the chat chrome
// throughout the conversation. Click opens `<PrivacyInfoModal />`.
//
// Visual intent: monochrome, low-contrast, hover-affordance; shouldn't
// compete with the conversation. See planning/03-exec-chat-surface-t4.md
// §"Chrome badge is unmissable but unintrusive".

import { useState } from "react";
import { PrivacyInfoModal } from "./privacy-info-modal";

// TODO(E.t5): replace with cms/legal/chrome-badge-label.md
const COPY = {
  label: "AI assistant",
  info: "info",
  ariaLabel: "Open privacy information for this AI assistant",
} as const;

export function ChromeBadge() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={COPY.ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="chrome-badge"
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400"
        />
        {/* TODO(E.t5): replace with cms/legal/chrome-badge-label.md */}
        <span>{COPY.label}</span>
        <span className="text-slate-400">·</span>
        <span className="underline underline-offset-2">{COPY.info}</span>
      </button>
      <PrivacyInfoModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

ChromeBadge.displayName = "ChromeBadge";
