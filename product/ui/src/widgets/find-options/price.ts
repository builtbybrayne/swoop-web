// product/ui/src/widgets/find-options/price.ts
//
// Per-variant pricing formatters for `find_options` proposal cards.
//
// Two flavours per crosscut §2.3 + decision C.14 + tool description:
//   - "from £X"       — trip / tour / region_base (total, headline only).
//   - "from £X / night" — hotel (per-night framing; the schema's
//     `pricingUnit: 'per_night'` literal carries the discriminator).
//
// If `fromPrice` is null/undefined, the helper returns null so the caller
// renders no price line at all (no placeholder).

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

function formatAmount(amount: number, currencyCode: string | undefined): string {
  const symbol = currencyCode ? CURRENCY_SYMBOLS[currencyCode] ?? "" : "";
  // Use Intl for the numeric grouping; strip Intl's currency rendering so the
  // symbol is positioned consistently (Swoop's pricing prose always leads with
  // the symbol, no decimals on the headline).
  const rounded = Math.round(amount);
  const grouped = new Intl.NumberFormat("en-GB").format(rounded);
  if (symbol) return `${symbol}${grouped}`;
  if (currencyCode) return `${currencyCode} ${grouped}`;
  return grouped;
}

export function formatFromPriceTotal(
  fromPrice: number | null | undefined,
  currencyCode: string | undefined,
): string | null {
  if (fromPrice == null) return null;
  return `from ${formatAmount(fromPrice, currencyCode)}`;
}

export function formatFromPricePerNight(
  fromPrice: number | null | undefined,
  currencyCode: string | undefined,
): string | null {
  if (fromPrice == null) return null;
  return `from ${formatAmount(fromPrice, currencyCode)} / night`;
}
