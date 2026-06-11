// product/ui/src/widgets/find-options.tsx
//
// =============================================================================
// Conversational moment — Propose options (Strong Consideration).
//
// The conversation has earned the move from *"tell me about Patagonia"* to
// *"what would I actually do?"*. `find_options` is the closest the agent
// gets to recommending. The widget renders a small set (2–4) of concrete
// proposals the visitor can compare side-by-side.
//
// `find_options` is polymorphic — each card in the set is one of four
// `ProposalCardPublic` variants:
//
//   trip         — flexible package; the day-one default. "from £X" total.
//   tour         — guided fixed-itinerary group product (Luke priority).
//                  Distinguished by the group-size badge + day-by-day count.
//                  "from £X" total.
//   hotel        — accommodation as a concrete option, location-anchored.
//                  "from £X / night" (pricingUnit: 'per_night').
//   region_base  — a region framed as a launchpad. "use as a base" framing.
//
// Polymorphic-dispatch: the parent component switches on `card.type` and
// delegates to the matching sub-renderer. Cards in a single set share width
// + image height + spacing, so a mixed set (e.g. two trips and a tour)
// remains visually coherent.
//
// Layout: responsive — single column at narrow viewports, two-column grid
// at wider ones. No horizontal scroll; cards are meant to be compared
// side-by-side.
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_options`" (HITL Q3
// reversal — polymorphic, not TripCard-only) + crosscut plan
// `03-exec-crosscut-find-options-polymorphism.md` (the contract this widget
// dispatches over).
// =============================================================================

import {
  FindOptionsOutputSchema,
} from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  WidgetSilentPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

const SHELL_CTX = {
  widgetType: "find-options",
  toolName: "find_options",
} as const;

export function FindOptionsWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Pulling options together…",
  );
  if (gate) return gate;

  const parsed = safeParse(FindOptionsOutputSchema, props.result, SHELL_CTX);
  if (!parsed.ok) {
    return <WidgetMalformedPlaceholder {...SHELL_CTX} debug={parsed.debug} />;
  }
  const { options } = parsed.data;

  // Phase 1 (goofy-goldstine, 2026-06-11): find_options is now the agent's
  // browse tool — compact options list, agent-private. Nothing renders from
  // this tool. Phase 2 will move the widget registration to show_options
  // (visitor-facing) and register a null renderer here.
  // Until then, render silently (same as an empty result) so existing smoke
  // tests pass without a jarring mid-browse flash.
  return (
    <WidgetSilentPlaceholder
      {...SHELL_CTX}
      reason="browse-only — show_options renders cards"
      hint={{ optionsCount: options.length }}
    />
  );
}

FindOptionsWidget.displayName = "FindOptionsWidget";
