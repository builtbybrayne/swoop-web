// product/ui/src/widgets/find-options/hotel-card.tsx
//
// =============================================================================
// `find_options` — `hotel` card variant.
//
// Conversational moment: visitor asked "where could we stay", named an
// accommodation style, or has signalled a base-and-explore intent rather
// than a packaged-trip intent. Hotels are location-anchored; the
// "from £X / night" pricing variant is the discriminator vs trip / tour
// totals.
//
// Visitor sees: image, headline, vibe-line, an AttributeTable carrying
// Location / Star rating / From price (per-night) / Accommodation style,
// and a deep-link CTA. Pricing rule: "from £X / night" — branched off
// `pricingUnit: 'per_night'` per crosscut §2.3.
//
// Per `planning/03-exec-chat-surface-t9.md` §"`find_options`".
// =============================================================================

import type { HotelProposalCard } from "@swoop/common";
import {
  AttributeTable,
  Card,
  CtaButton,
  ExpandableProse,
  ImageBlock,
} from "../../shared";
import type { AttributeRow } from "../../shared";
import { formatFromPricePerNight } from "./price";

// Render the star rating as a compact glyph row so the brand team can target
// the row independently of the AttributeTable cell text.
function StarRating({ value }: { value: number }) {
  const filled = "★".repeat(value);
  const empty = "☆".repeat(Math.max(0, 5 - value));
  return (
    <span
      data-testid="find-options-hotel-star-rating"
      aria-label={`${value} out of 5 stars`}
      className="text-sm text-swoop-accent"
    >
      <span aria-hidden="true">{filled}</span>
      <span aria-hidden="true" className="text-slate-300">
        {empty}
      </span>
    </span>
  );
}

export function HotelCard({ card }: { card: HotelProposalCard }) {
  // Per-night pricing is the discriminator from trip/tour total pricing.
  // The schema's `pricingUnit` literal is `'per_night'` for hotels; we branch
  // deterministically here rather than reading the literal from card data
  // (it's always 'per_night' for this variant).
  const rows: AttributeRow[] = [
    { label: "Location", value: card.location ?? card.region ?? null },
    {
      label: "Rating",
      value: card.starRating ? <StarRating value={card.starRating} /> : null,
    },
    {
      label: "From",
      value: formatFromPricePerNight(card.fromPrice, card.currencyCode),
    },
    { label: "Style", value: card.accommodationStyle ?? null },
  ];

  return (
    <Card className="overflow-hidden">
      <div
        data-swoop-part="find-options-card"
        data-swoop-card-type="hotel"
        data-testid="find-options-hotel-card"
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
              // hotel.description is plain text today (0 of 44 carry HTML
              // per 2026-05-13 audit). Clamp visually, expand on click. Per
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
              See this hotel
            </CtaButton>
          </div>
        </div>
      </div>
    </Card>
  );
}
