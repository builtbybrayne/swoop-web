// product/ui/src/parts/terminology-card.tsx
//
// The quiet explainer card for static sidebar entries — today only the
// "About Swoop Planning Specialists" terminology card
// (planning/03-exec-crosscut-magical-poincare-terminology-card.md §2.3,
// decision D.poincare-4).
//
// Deliberately understated: title + two-three short lines, no CTA (the
// handoff form is the CTA surface; this card informs), no imagery. It sits
// pinned above the tool-part widgets in the visual sidebar and inherits the
// sidebar's `aria`-labelled complementary region — no aria region of its own.
//
// Dismissable: the × button removes the card for the rest of the conversation
// (store-level dismissal — see `dismissStaticCard`). A native <button> keeps
// dismissal keyboard-reachable for free.
//
// `data-swoop-widget="terminology-card"` is the stable styling/test seam so
// Swoop's brand team can re-skin without touching React internals. All copy
// arrives via the store payload (sourced from cms/) — never inlined here.

import { dismissStaticCard, type SidebarStaticCardEntry } from "./sidebar-channel";

export function TerminologyCard({ entry }: { entry: SidebarStaticCardEntry }) {
  return (
    <div
      data-swoop-part="static-card"
      data-swoop-widget="terminology-card"
      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-900">
          {entry.payload.title}
        </h3>
        <button
          type="button"
          onClick={() => dismissStaticCard(entry.id)}
          aria-label="Dismiss"
          data-testid="terminology-card-dismiss"
          className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
        >
          ×
        </button>
      </div>
      {entry.payload.lines.map((line) => (
        <p key={line} className="mt-1.5 text-[13px] leading-5 text-slate-600">
          {line}
        </p>
      ))}
    </div>
  );
}

TerminologyCard.displayName = "TerminologyCard";
