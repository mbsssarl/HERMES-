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

/** Arrondi monétaire à 2 décimales (les valeurs des fichiers Excel exportés). */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Format de nombre Excel adapté à la valeur : aucun zéro inutile (« 1 » et non « 1,00 », « 12,5 » et non « 12,50 »),
 * mais les décimales réellement présentes sont affichées. `format` est le format du gabarit (« #,##0.00 [$USD] »...) :
 * on n'en change que la partie décimale. « General » est laissé tel quel.
 */
export function adaptiveNumFmt(format: string, value: number | undefined): string {
  if (!format || format === "General") return format;
  const cents = value === undefined || !Number.isFinite(value) ? 1 : Math.round(Math.abs(value) * 100);
  const decimals = cents % 100 === 0 ? 0 : cents % 10 === 0 ? 1 : 2;
  const frac = decimals === 0 ? "" : "." + "0".repeat(decimals);
  // Seules les parties numériques changent (pas le texte entre crochets ou guillemets, ex. « [$-409] ») ; un format
  // sans décimales (« #,##0 ») en reçoit si la valeur en a (2 au maximum).
  return format.replace(/(\[[^\]]*\]|"[^"]*"|\\.|_.|\*.)|([#0,]*0)(\.[0#]+)?/g, (m, literal, int) => (literal ? m : int + frac));
}

/**
 * Format d'un MONTANT dans un fichier Excel exporté : toujours 2 décimales (« 62,50 », « 20,00 »), quelle que soit la
 * valeur. Même logique que adaptiveNumFmt pour le reste du format (devise entre crochets, sections, etc.).
 */
export function moneyNumFmt(format: string): string {
  return adaptiveNumFmt(format, 0.01);
}
