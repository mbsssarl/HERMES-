export interface LinePricingInput {
  unitPriceOriginal: number;
  quotationPercent: number;
  lineDiscountPercent: number;
  quantity: number;
}

export interface LinePricingResult {
  priceAfterQuotation: number;
  finalUnitPrice: number;
  total: number;
}

/**
 * Applies the markup ("cotation") then the optional line discount, in that
 * order, and computes the line total.
 *
 * Only the displayed unit prices are rounded to 2 decimals: the line total is
 * computed from the unrounded values (quantity x unit x markup x discount), then
 * rounded once. Rounding the discounted unit price first and multiplying by the
 * quantity drifts by a few cents per line (2.15 -> 1.935 -> 1.94, x300 = 582.00
 * instead of 580.50), which is not what the client's own spreadsheet does.
 */
export function computeLinePricing(input: LinePricingInput): LinePricingResult {
  const rawAfterQuotation = input.unitPriceOriginal * (1 + input.quotationPercent / 100);
  const rawFinalUnit = rawAfterQuotation * (1 - input.lineDiscountPercent / 100);
  return {
    priceAfterQuotation: round2(rawAfterQuotation),
    finalUnitPrice: round2(rawFinalUnit),
    total: round2(rawFinalUnit * input.quantity),
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
