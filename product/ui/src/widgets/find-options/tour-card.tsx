// product/ui/src/widgets/find-options/tour-card.tsx
//
// =============================================================================
// `find_options` — `tour` card variant. Luke's upsell priority.
//
// Conversational moment: visitor signalled preference for a guided
// fixed-itinerary group product — "with a guide", "small group", asked
// about itinerary structure. Tours are a distinctive Swoop product; the
// `groupSizeMax` badge is the salient affordance Luke wants foregrounded.
//
// Visitor sees: image, headline, vibe-line, a **group-size badge** rendered
// prominently when `groupSizeMax` is present (e.g. *"max 8 guests"*), an
// AttributeTable carrying Region / Duration / Day-by-day count /
// From price / Accommodation, and a deep-link CTA. Pricing rule:
// "from £X" (total).
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_options`" + decision C.49
// (Tours-as-distinct-from-Trips).
// =============================================================================

import type { TourProposalCard } from "@swoop/common";
import { AttributeTable, Card, CtaButton, ImageBlock } from "../../shared";
import type { AttributeRow } from "../../shared";
import { formatFromPriceTotal } from "./price";

export function TourCard({ card }: { card: TourProposalCard }) {
  const rows: AttributeRow[] = [
    { label: "Region", value: card.region ?? null },
    {
      label: "Duration",
      value: card.durationDays
        ? `${card.durationDays} ${card.durationDays === 1 ? "day" : "days"}`
        : null,
    },
    {
      label: "Itinerary",
      value: card.dayCount ? `${card.dayCount}-day plan` : null,
    },
    {
      label: "From",
      value: formatFromPriceTotal(card.fromPrice, card.currencyCode),
    },
    { label: "Accommodation", value: card.accommodationStyle ?? null },
  ];

  return (
    <Card className="overflow-hidden">
      <div
        data-swoop-part="find-options-card"
        data-swoop-card-type="tour"
        data-testid="find-options-tour-card"
        className="contents"
      >
        {card.image ? (
          <ImageBlock
            src={card.image.canonicalUrl}
            alt={card.image.altText ?? ""}
          />
        ) : null}
        <div className="flex flex-1 flex-col gap-3 p-4">
          <header className="flex flex-col gap-1">
            <h3 className="font-swoop-display text-[17px] font-semibold leading-snug tracking-tight text-swoop-surface-fg">
              {card.headline}
            </h3>
            {card.vibeLine ? (
              <p className="text-sm leading-relaxed text-slate-600">
                {card.vibeLine}
              </p>
            ) : null}
          </header>
          {card.groupSizeMax ? (
            <div
              data-swoop-part="find-options-tour-group-size"
              data-testid="find-options-tour-group-size"
              className="inline-flex w-fit items-center gap-1.5 rounded-full bg-swoop-tint px-2.5 py-1 text-xs font-semibold text-swoop-deep"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-swoop-accent"
              />
              <span>max {card.groupSizeMax} guests</span>
            </div>
          ) : null}
          <AttributeTable rows={rows} />
          <div
            data-swoop-part="find-options-card-cta"
            className="mt-auto inline-flex"
          >
            <CtaButton
              href={card.canonicalUrl}
              ariaLabel={`Read more about ${card.headline}`}
            >
              See this tour
            </CtaButton>
          </div>
        </div>
      </div>
    </Card>
  );
}
