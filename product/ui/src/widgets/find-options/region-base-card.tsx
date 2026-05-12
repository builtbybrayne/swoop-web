// product/ui/src/widgets/find-options/region-base-card.tsx
//
// =============================================================================
// `find_options` — `region_base` card variant.
//
// Conversational moment: visitor is choosing the launchpad region first,
// trip second — *"we're thinking Torres del Paine — what's the best base?"*.
// The card frames the region as a place to *use* — somewhere you settle
// for a few days and branch out from.
//
// Visitor sees: image, headline, vibe-line, the `baseFraming` prose
// (the load-bearing "use this as a base, explore around" line), an
// AttributeTable carrying Region / Nearby trips count, and a deep-link
// CTA to the region page. Pricing: typically null at the region level,
// so no price row — handled by AttributeTable's empty-row filtering.
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_options`".
// =============================================================================

import type { RegionBaseProposalCard } from "@swoop/common";
import { AttributeTable, Card, CtaButton, ImageBlock } from "../../shared";
import type { AttributeRow } from "../../shared";
import { formatFromPriceTotal } from "./price";

export function RegionBaseCard({ card }: { card: RegionBaseProposalCard }) {
  const rows: AttributeRow[] = [
    { label: "Region", value: card.region ?? null },
    {
      label: "Nearby trips",
      value:
        typeof card.nearbyTripsCount === "number"
          ? `${card.nearbyTripsCount} trips`
          : null,
    },
    {
      label: "From",
      value: formatFromPriceTotal(card.fromPrice, card.currencyCode),
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div
        data-swoop-part="find-options-card"
        data-swoop-card-type="region_base"
        data-testid="find-options-region-base-card"
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
            <h3 className="text-base font-semibold text-slate-900">
              {card.headline}
            </h3>
            {card.vibeLine ? (
              <p className="text-sm leading-relaxed text-slate-600">
                {card.vibeLine}
              </p>
            ) : null}
          </header>
          {card.baseFraming ? (
            <p
              data-testid="find-options-region-base-framing"
              className="rounded bg-slate-50 px-3 py-2 text-xs italic leading-relaxed text-slate-700"
            >
              {card.baseFraming}
            </p>
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
              Use as a base
            </CtaButton>
          </div>
        </div>
      </div>
    </Card>
  );
}
