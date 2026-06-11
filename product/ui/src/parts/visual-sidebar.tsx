// product/ui/src/parts/visual-sidebar.tsx
//
// The right-hand visual sidebar (planning/02-impl-visual-sidebar.md §2.3).
//
// On desktop this renders the display widgets that fired during the
// conversation, in arrival order, using the *same* widget components the inline
// path uses — fed from the `sidebar-channel` store rather than from
// assistant-ui's part props. The inline copies are hidden on desktop (see
// `sidebar-publish`), so the sidebar is the single visible home for visual
// material there. On mobile this whole region is hidden via the responsive
// `className` the caller passes, and the inline widgets render as today.
//
// The sidebar is a passive projection: it never drives the conversation, has no
// failure modes of its own beyond rendering whatever the store holds, and reads
// the *raw* widget map (no dev-trace, no re-publish) so there's no feedback
// loop back into the store.
//
// Static-card entries (the terminology card, decision D.poincare-4) render
// through `TerminologyCard` and arrive first in the snapshot — the store pins
// them above the tool-part chronology.

import { useSyncExternalStore } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { toolWidgetComponents } from "../widgets";
import {
  getSidebarSnapshot,
  subscribeSidebar,
  type SidebarToolPartEntry,
} from "./sidebar-channel";
import { TerminologyCard } from "./terminology-card";

/**
 * Re-render a single published widget from its stored tool-part. Builds the
 * subset of `ToolCallMessagePartProps` the widgets consume (`result` directly;
 * `status` / `isError` via the lifecycle gate) and casts to the full prop
 * contract — assistant-ui's transport-only fields (`addResult`, `resume`,
 * `argsText`) are inert here, exactly as they are for the inline fallback.
 */
function SidebarWidget({ entry }: { entry: SidebarToolPartEntry }) {
  const Widget = toolWidgetComponents[entry.toolName];
  if (!Widget) return null;

  const props = {
    type: "tool-call",
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    args: entry.args,
    argsText: "",
    result: entry.result,
    status: entry.status,
    isError: entry.isError,
    addResult: () => {},
    resume: () => {},
  } as unknown as ToolCallMessagePartProps;

  return (
    <div data-swoop-part="sidebar-widget" data-swoop-widget-tool={entry.toolName}>
      <Widget {...props} />
    </div>
  );
}

function SidebarEmptyState() {
  return (
    <div
      data-swoop-part="visual-sidebar-empty"
      className="mt-1 rounded-swoop-lg border border-dashed border-[#cdf1ff] bg-swoop-tint px-5 py-8 text-center"
    >
      {/* Same quiet peak glyph as the image fallback — line work, not imagery. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 48 24"
        className="mx-auto h-5 w-10 text-swoop-deep"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 22 14 6l8 10 6-8 16 14" />
      </svg>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        Images and places from the conversation will gather here as you
        explore.
      </p>
    </div>
  );
}

/**
 * The complementary visual region. `className` carries the caller's responsive
 * visibility + width (e.g. `hidden w-80 shrink-0 lg:flex xl:w-96`), so this
 * component stays layout-agnostic and the desktop/mobile breakpoint lives in
 * one place at the call site, matching the inline-hide breakpoint.
 */
export function VisualSidebar({ className }: { className?: string }) {
  const entries = useSyncExternalStore(
    subscribeSidebar,
    getSidebarSnapshot,
    getSidebarSnapshot,
  );

  return (
    <aside
      data-swoop-part="visual-sidebar"
      aria-label="Visual highlights from the conversation"
      className={`h-full flex-col border-l border-swoop-border bg-gradient-to-b from-white to-[#fafcfd] ${className ?? ""}`}
    >
      <div
        data-swoop-part="visual-sidebar-header"
        className="flex items-center gap-2 border-b border-swoop-border px-4 py-3"
      >
        {/* Brand tick — same navy→teal ramp as the static card's hairline. */}
        <span
          aria-hidden="true"
          className="h-3.5 w-1 rounded-full bg-gradient-to-b from-swoop-accent to-swoop-sky"
        />
        <span className="font-swoop-display text-[11px] font-semibold uppercase tracking-[0.18em] text-swoop-deep">
          Highlights
        </span>
      </div>
      <div
        data-swoop-part="visual-sidebar-scroll"
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {entries.length === 0 ? (
          <SidebarEmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            {entries.map((entry) =>
              entry.kind === "static-card" ? (
                <TerminologyCard key={entry.id} entry={entry} />
              ) : (
                <SidebarWidget key={entry.toolCallId} entry={entry} />
              ),
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

VisualSidebar.displayName = "VisualSidebar";
