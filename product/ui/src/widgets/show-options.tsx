// product/ui/src/widgets/show-options.tsx
//
// =============================================================================
// Conversational moment — Show options (visitor-facing curation).
//
// `show_options` is the visitor-facing half of the browse → show split
// introduced by goofy-goldstine (2026-06-11). The agent browses privately
// with `find_options` then curates ids to hand to `show_options`, which
// hydrates full ProposalCards (image, price, deep link) and renders them here.
//
// Layout:
//   primary cards   — full proposal cards in the existing grid (2-col at md+).
//                     ≤ 4 by tool contract.
//   also_interesting — compact strip: a narrower horizontal row of smaller
//                     cards the visitor can glance at. 1–2 by convention.
//
// Polymorphic dispatch — same four variants as the existing find-options card
// sub-components: trip / tour / hotel / region_base. Cards in a mixed set
// share width + image height + spacing.
//
// Per crosscut plan `03-exec-crosscut-goofy-goldstine-find-options-reshape.md`
// §Phase 2 + §Phase 3 (also_interesting strip). Styling pass welcome — the
// Phase 3 commit is intentionally isolated to product/ui/ for that reason.
// =============================================================================

import {
  ShowOptionsOutputSchema,
  type HotelProposalCard,
  type RegionBaseProposalCard,
  type TourProposalCard,
  type TripProposalCard,
} from "@swoop/common";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { HotelCard } from "./find-options/hotel-card";
import { RegionBaseCard } from "./find-options/region-base-card";
import { TourCard } from "./find-options/tour-card";
import { TripCard } from "./find-options/trip-card";
import {
  renderLifecycleGate,
  safeParse,
  WidgetMalformedPlaceholder,
  WidgetSilentPlaceholder,
  type ToolCallLifecycle,
} from "./widget-shell";

// ShowOptionsOutputSchema cards have a `group` field added by the handler.
// We extend the schema-inferred type locally to avoid a compile-time dep on
// the group field before it lands in the public type.
type CardWithGroup = (
  | TripProposalCard
  | TourProposalCard
  | HotelProposalCard
  | RegionBaseProposalCard
) & { group: "primary" | "also_interesting" };

const SHELL_CTX = {
  widgetType: "show-options",
  toolName: "show_options",
} as const;

export function ShowOptionsWidget(
  props: ToolCallMessagePartProps<unknown, unknown>,
) {
  const gate = renderLifecycleGate(
    props as ToolCallLifecycle,
    SHELL_CTX,
    "Pulling together your options…",
  );
  if (gate) return gate;

  const parsed = safeParse(ShowOptionsOutputSchema, props.result, SHELL_CTX);
  if (!parsed.ok) {
    return <WidgetMalformedPlaceholder {...SHELL_CTX} debug={parsed.debug} />;
  }
  const { cards } = parsed.data;

  if (cards.length === 0) {
    return (
      <WidgetSilentPlaceholder
        {...SHELL_CTX}
        reason="empty result"
        hint={{ cards: 0 }}
      />
    );
  }

  // Split into primary and also_interesting. Input ordering within each group
  // is preserved (handler sorts by input.items position before returning).
  const primaryCards = (cards as CardWithGroup[]).filter(
    (c) => c.group === "primary",
  );
  const alsoInteresting = (cards as CardWithGroup[]).filter(
    (c) => c.group === "also_interesting",
  );

  return (
    <section
      data-testid="show-options"
      data-swoop-part="widget"
      data-swoop-widget="show-options"
      aria-label="Options"
      className="my-2 flex w-full flex-col gap-6"
    >
      {/* Primary cards — full proposal grid */}
      {primaryCards.length > 0 && (
        <div
          data-swoop-part="show-options-primary"
          className="grid w-full gap-4 sm:grid-cols-2"
        >
          {primaryCards.map((card) => (
            <ProposalCardDispatch key={`${card.type}:${card.id}`} card={card} />
          ))}
        </div>
      )}

      {/* Also-interesting strip — compact horizontal glance row */}
      {alsoInteresting.length > 0 && (
        <div
          data-swoop-part="show-options-also-interesting"
          aria-label="Also worth a look"
          className="flex flex-col gap-2"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Also worth a look
          </p>
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            {alsoInteresting.map((card) => (
              <div
                key={`${card.type}:${card.id}`}
                className="min-w-0 flex-1"
              >
                <ProposalCardDispatch card={card} compact />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

ShowOptionsWidget.displayName = "ShowOptionsWidget";

// ---------------------------------------------------------------------------
// ProposalCardDispatch — polymorphic switch on card.type.
// The `compact` prop is threaded through for future styling passes; for now
// all four variants render their full card. A styling pass (Phase 3 welcome)
// can add compact-specific layouts.
// ---------------------------------------------------------------------------

function ProposalCardDispatch({
  card,
  compact: _compact = false,
}: {
  card: CardWithGroup;
  compact?: boolean;
}) {
  switch (card.type) {
    case "trip":
      return <TripCard card={card as TripProposalCard} />;
    case "tour":
      return <TourCard card={card as TourProposalCard} />;
    case "hotel":
      return <HotelCard card={card as HotelProposalCard} />;
    case "region_base":
      return <RegionBaseCard card={card as RegionBaseProposalCard} />;
    default:
      // Unknown type — silent in production, visible in dev via the shell.
      return (
        <WidgetSilentPlaceholder
          {...SHELL_CTX}
          reason="unknown card type"
          hint={{ type: (card as { type: string }).type }}
        />
      );
  }
}
