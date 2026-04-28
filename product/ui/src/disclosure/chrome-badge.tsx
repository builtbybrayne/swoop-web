// product/ui/src/disclosure/chrome-badge.tsx
//
// Small persistent AI-disclosure affordance rendered in the chat chrome
// throughout the conversation. Click opens `<PrivacyInfoModal />`.
//
// Visual intent: monochrome, low-contrast, hover-affordance; shouldn't
// compete with the conversation. See planning/03-exec-chat-surface-t4.md
// §"Chrome badge is unmissable but unintrusive".
//
// Copy is loaded from `cms/legal/disclosure-chrome.md` via `legal-copy.ts`
// (E.t5).

import { useState } from "react";
import { PrivacyInfoModal } from "./privacy-info-modal";
import { DisclosureChrome } from "./legal-copy";

export function ChromeBadge() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={DisclosureChrome.ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="chrome-badge"
        data-swoop-part="chrome-badge"
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400"
        />
        <span>{DisclosureChrome.badgeLabel}</span>
        <span className="text-slate-400">·</span>
        <span className="underline underline-offset-2">
          {DisclosureChrome.badgeInfoLabel}
        </span>
      </button>
      <PrivacyInfoModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

ChromeBadge.displayName = "ChromeBadge";
