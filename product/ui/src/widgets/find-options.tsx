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
  type ProposalCardPublic,
} from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  WidgetSilentPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";
import { HotelCard } from "./find-options/hotel-card";
import { RegionBaseCard } from "./find-options/region-base-card";
import { TourCard } from "./find-options/tour-card";
import { TripCard } from "./find-options/trip-card";

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
  const { cards } = parsed.data;

  // Empty result is the agent's job to handle in prose, not a widget surface.
  // Match the find-proof / lookup pattern — prod silent, dev indicator so the
  // developer sees that find_options fired with zero cards.
  // Per crosscut plan 03-exec-crosscut-brave-pare-widget-user-copy-fix.md.
  if (cards.length === 0) {
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason="empty result"
        hint={{ cards: 0 }}
      />
    );
  }

  return (
    <section
      data-testid="find-options"
      data-swoop-part="widget"
      data-swoop-widget="find-options"
      aria-label="Trip and tour options"
      className="my-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {cards.map((card) => (
        // Cast: schema-inferred type vs `ProposalCardPublic` alias drift
        // (optional vs required `activityTags` / image-tag arrays) is a
        // `@swoop/common` reconciliation in flight elsewhere. Runtime shape
        // already matches; this cast keeps the widget surface stable until
        // the alias/schema realign.
        <ProposalCardRenderer
          key={card.id}
          card={card as ProposalCardPublic}
        />
      ))}
    </section>
  );
}

FindOptionsWidget.displayName = "FindOptionsWidget";

// -----------------------------------------------------------------------------
// ProposalCardRenderer — polymorphic dispatch on `card.type`.
//
// Discriminated-union exhaustiveness: a `never`-typed `_exhaustiveCheck` on
// the default branch makes the type system refuse to compile if a new variant
// is added to `ProposalCardPublic` without a matching renderer entry here.
// -----------------------------------------------------------------------------

function ProposalCardRenderer({ card }: { card: ProposalCardPublic }) {
  switch (card.type) {
    case "trip":
      return <TripCard card={card} />;
    case "tour":
      return <TourCard card={card} />;
    case "hotel":
      return <HotelCard card={card} />;
    case "region_base":
      return <RegionBaseCard card={card} />;
    default: {
      // Compile-time exhaustiveness guard. Runtime fall-through (a new
      // discriminator landed without matching renderer) is treated as
      // schema drift and surfaces via the shared placeholder.
      const _exhaustiveCheck: never = card;
      void _exhaustiveCheck;
      return <WidgetMalformedPlaceholder {...SHELL_CTX} />;
    }
  }
}
