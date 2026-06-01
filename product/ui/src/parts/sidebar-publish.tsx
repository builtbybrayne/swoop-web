// product/ui/src/parts/sidebar-publish.tsx
//
// The render-boundary intercept that mirrors a display widget into the visual
// sidebar (planning/02-impl-visual-sidebar.md §2.1).
//
// `wrapWithSidebarPublish` decorates a tool-call widget so that, in addition to
// rendering inline exactly as before, it publishes its tool-part to the
// sidebar store on mount and on update. This is the tool-part analogue of the
// `fyi-channel` precedent: tap assistant-ui's render boundary, don't re-route
// its message model.
//
// Two responsibilities, both side-effect-of-render:
//   1. Publish `{ toolCallId, toolName, args, result, status, isError }` into
//      `sidebar-channel` via a layout effect keyed on those fields, so a widget
//      that streams args -> result updates its sidebar copy in place.
//   2. Wrap the inline render in a layout-transparent marker
//      (`data-swoop-inline-widget`) that collapses to `display:none` at the
//      desktop breakpoint — so on desktop the sidebar shows the widget and the
//      inline copy is hidden, while on mobile the inline copy renders exactly
//      as today (the marker is `display:contents`, i.e. invisible to layout).
//
// Unlike `wrapWithDevTrace`, this wrapper is active in BOTH dev and prod — the
// relocation is a product behaviour, not a diagnostic. Compose it OUTSIDE the
// dev-trace wrapper so the inline dev-trace card hides together with its widget
// on desktop rather than orphaning below an empty slot.
//
// Only the six *display* widgets are wrapped (see `parts/index.ts`); `handoff`
// is never wrapped — its lead-capture form stays inline in both layouts.

import { useEffect } from "react";
import type { ComponentType, ReactNode } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { publishSidebarWidget } from "./sidebar-channel";

/**
 * Decorate a tool-call widget with the sidebar-publish side-effect + the
 * desktop-hide inline marker. Returns a component with the same props contract,
 * so the registry treats it like any other widget.
 */
export function wrapWithSidebarPublish(
  toolName: string,
  Inner: ComponentType<ToolCallMessagePartProps>,
): ComponentType<ToolCallMessagePartProps> {
  function WrappedWithSidebarPublish(
    props: ToolCallMessagePartProps,
  ): ReactNode {
    const resolvedName = props.toolName ?? toolName;
    const { toolCallId, args, result, status, isError } = props;

    // Publish on mount and whenever the tool-part changes. The store is
    // append-by-id and idempotent for an unchanged payload, so StrictMode's
    // double-invoked effects in dev collapse to a single visible entry.
    useEffect(() => {
      publishSidebarWidget({
        toolCallId,
        toolName: resolvedName,
        args,
        result,
        status,
        isError,
      });
    }, [toolCallId, resolvedName, args, result, status, isError]);

    // `contents` keeps the marker layout-transparent below the breakpoint, so
    // mobile rendering is byte-for-byte today's inline behaviour; `lg:hidden`
    // collapses it to `display:none` on desktop where the sidebar takes over.
    // `data-swoop-inline-widget` is the stable styling/test seam (a brand team
    // can re-point the show/hide rule at it without touching React internals).
    return (
      <div
        data-swoop-part="inline-widget"
        data-swoop-inline-widget="true"
        className="contents lg:hidden"
      >
        <Inner {...props} />
      </div>
    );
  }
  WrappedWithSidebarPublish.displayName = `WrappedWithSidebarPublish(${toolName})`;
  return WrappedWithSidebarPublish;
}
