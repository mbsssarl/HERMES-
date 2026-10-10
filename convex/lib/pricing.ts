export interface LinePricingInput {
  unitPriceOriginal: number;
  quotationPercent: number;
  /** Cotation en montant par unité : si présent, remplace le pourcentage. */
  quotationAmount?: number;
  quantity: number;
}

export interface LinePricingResult {
  priceAfterQuotation: number;
  /** Unit price after cotation (same as priceAfterQuotation now that discounts are global). */
  finalUnitPrice: number;
  total: number;
}

/**
 * Applies the markup ("cotation") and computes the line total. Unit prices are rounded to 2 decimals for
 * display; the line total is computed from the unrounded price and rounded once. The discount is no longer
 * a line concern: a single global discount applies to the total of the whole order (see orders / export).
 */
export function computeLinePricing(input: LinePricingInput): LinePricingResult {
  const raw =
    input.quotationAmount !== undefined
      ? input.unitPriceOriginal + input.quotationAmount
      : input.unitPriceOriginal * (1 + input.quotationPercent / 100);
  return {
    priceAfterQuotation: round2(raw),
    finalUnitPrice: round2(raw),
    total: round2(raw * input.quantity),
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
