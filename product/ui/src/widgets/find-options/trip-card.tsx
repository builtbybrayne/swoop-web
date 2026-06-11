// product/ui/src/widgets/find-options/trip-card.tsx
//
// =============================================================================
// `find_options` — `trip` card variant.
//
// Conversational moment: visitor ready to compare concrete options. Trip
// cards surface flexible packages — self-contained, can be self-guided or
// guided, duration is configurable.
//
// Visitor sees: image, headline, vibe-line, an AttributeTable carrying
// Region / Duration / From price / Accommodation style, and a primary
// deep-link CTA. Pricing rule: "from £X" (total) — never quote a definitive
// total or imply availability. If `fromPrice` is null, the price line is
// omitted entirely.
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_options`" + the
// per-type pricing rule in
// `product/cms/prompts/tools/find_options/description.md`.
// =============================================================================

import type { TripProposalCard } from "@swoop/common";
import {
  AttributeTable,
  Card,
  CtaButton,
  ExpandableProse,
  ImageBlock,
} from "../../shared";
import type { AttributeRow } from "../../shared";
import { formatFromPriceTotal } from "./price";

export function TripCard({ card }: { card: TripProposalCard }) {
  const rows: AttributeRow[] = [
    { label: "Region", value: card.region ?? null },
    {
      label: "Duration",
      value: card.durationDays
        ? `${card.durationDays} ${card.durationDays === 1 ? "day" : "days"}`
        : null,
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
        data-swoop-card-type="trip"
        data-testid="find-options-trip-card"
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
              // trip_card.vibe_line is Haiku-composed (clean text). Clamp
              // visually, expand on click. Per
              // planning/03-exec-crosscut-brave-pare-card-expandable-prose.md.
              <ExpandableProse
                content={card.vibeLine}
                maxLines={3}
                className="text-sm leading-relaxed text-slate-600"
              />
            ) : null}
          </header>
          <AttributeTable rows={rows} />
          <div
            data-swoop-part="find-options-card-cta"
            className="mt-auto inline-flex"
          >
            <CtaButton
              href={card.canonicalUrl}
              ariaLabel={`Read more about ${card.headline}`}
            >
              See this trip
            </CtaButton>
          </div>
        </div>
      </div>
    </Card>
  );
}
