import { v } from "convex/values";
import { action, query } from "./_generated/server";

// Franc CFA (zones CEMAC/UEMOA) : parité fixe avec l'euro, garantie par traité - ce n'est PAS un taux de
// marché flottant, donc jamais interrogé en ligne (aucune API de change ne le publie de toute façon).
const XAF_PER_EUR = 655.957;
const EUR_PEGGED: Record<string, number> = { XAF: XAF_PER_EUR, XOF: XAF_PER_EUR };
const PEG_SOURCE = "Parité fixe EUR/CFA (traité de coopération monétaire)";

// Devises effectivement utilisées par l'entreprise : seules celles-ci sont proposées pour la conversion
// du fichier exporté (choix explicite - inutile d'exposer les ~165 codes ISO 4217, presque tous hors
// sujet pour un ship-chandler basé à Douala). EUR/USD/CAD/GBP sont récupérées en ligne (BCE, API
// Frankfurter) ; XAF/XOF passent par la parité fixe ci-dessus.
const FRANKFURTER_CURRENCIES = new Set(["EUR", "USD", "CAD", "GBP"]);

/** Devises pour lesquelles une conversion en direct est effectivement possible (source BCE + parité fixe CFA). */
export const SUPPORTED_CONVERSION_CURRENCIES = [...FRANKFURTER_CURRENCIES, ...Object.keys(EUR_PEGGED)].sort();

export interface RateResult {
  rate: number;
  asOf: string; // date de la source, ou "parité fixe"/"identique"
  source: string;
}

async function fetchFrankfurter(from: string, to: string): Promise<RateResult> {
  const unsupported = [from, to].filter((code) => !FRANKFURTER_CURRENCIES.has(code));
  if (unsupported.length > 0) {
    throw new Error(
      `${unsupported.join(" et ")} ne fait pas partie des devises prises en charge pour la conversion en ligne ` +
        `(${SUPPORTED_CONVERSION_CURRENCIES.join(", ")}). Choisissez une devise parmi celles proposées dans le sélecteur.`,
    );
  }
  const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`);
  if (!response.ok) {
    throw new Error(`Service de taux de change en ligne indisponible pour ${from}/${to} (erreur ${response.status}). Réessayez dans quelques instants.`);
  }
  const data = (await response.json()) as { rates?: Record<string, number>; date?: string };
  const rate = data.rates?.[to];
  if (rate === undefined) {
    throw new Error(`Taux de change indisponible pour la paire ${from}/${to} auprès du service en ligne.`);
  }
  return { rate, asOf: data.date ?? new Date().toISOString().slice(0, 10), source: "Banque centrale européenne (api Frankfurter)" };
}

/** Taux d'une devise vers l'euro (marché pour les devises Frankfurter, parité fixe pour XAF/XOF). */
async function rateToEur(currency: string): Promise<RateResult> {
  if (currency === "EUR") return { rate: 1, asOf: "identique", source: "Même devise" };
  if (EUR_PEGGED[currency]) return { rate: 1 / EUR_PEGGED[currency], asOf: "parité fixe", source: PEG_SOURCE };
  return fetchFrankfurter(currency, "EUR");
}

/** Taux de l'euro vers une devise (marché pour les devises Frankfurter, parité fixe pour XAF/XOF). */
async function rateFromEur(currency: string): Promise<RateResult> {
  if (currency === "EUR") return { rate: 1, asOf: "identique", source: "Même devise" };
  if (EUR_PEGGED[currency]) return { rate: EUR_PEGGED[currency], asOf: "parité fixe", source: PEG_SOURCE };
  return fetchFrankfurter("EUR", currency);
}

/**
 * Taux de change from → to, sans jamais boucler : les deux seuls cas non triviaux (une devise pégée
 * d'un côté, l'euro direct de l'autre) sont résolus par rateToEur/rateFromEur, qui ne se rappellent
 * jamais elles-mêmes. Toute autre paire (ex. XAF -> USD) se compose en passant par l'euro.
 */
export async function fetchExchangeRate(from: string, to: string): Promise<RateResult> {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (f === t) return { rate: 1, asOf: "identique", source: "Même devise" };
  if (f === "EUR") return rateFromEur(t);
  if (t === "EUR") return rateToEur(f);
  if (EUR_PEGGED[f] && EUR_PEGGED[t]) return { rate: 1, asOf: "parité fixe", source: PEG_SOURCE };

  const toEur = await rateToEur(f);
  const fromEur = await rateFromEur(t);
  return { rate: toEur.rate * fromEur.rate, asOf: fromEur.asOf, source: fromEur.source };
}

/** Version appelable depuis le client, pour un simple aperçu du taux sans rien enregistrer. */
export const getRate = action({
  args: { from: v.string(), to: v.string() },
  handler: async (_ctx, { from, to }): Promise<RateResult> => fetchExchangeRate(from, to),
});

/** Devises pour lesquelles la conversion en direct est réellement disponible (à filtrer côté écran). */
export const listSupportedTargets = query({
  args: {},
  handler: async (): Promise<string[]> => SUPPORTED_CONVERSION_CURRENCIES,
});
