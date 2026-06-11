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
      className="relative overflow-hidden rounded-swoop-lg border border-swoop-border bg-gradient-to-br from-swoop-tint via-white to-white px-4 pb-4 pt-[18px] shadow-swoop-card"
    >
      {/* Brand hairline — navy into glacial teal. Decorative only. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-swoop-accent to-swoop-sky"
      />
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-swoop-display text-[15px] font-semibold leading-snug tracking-tight text-swoop-surface-fg">
          {entry.payload.title}
        </h3>
        <button
          type="button"
          onClick={() => dismissStaticCard(entry.id)}
          aria-label="Dismiss"
          data-testid="terminology-card-dismiss"
          className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-swoop-deep hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-swoop-accent"
        >
          ×
        </button>
      </div>
      {entry.payload.lines.map((line) => (
        <p
          key={line}
          className="mt-2 text-[13px] leading-relaxed text-slate-600 first-of-type:mt-2.5"
        >
          {line}
        </p>
      ))}
    </div>
  );
}

TerminologyCard.displayName = "TerminologyCard";
