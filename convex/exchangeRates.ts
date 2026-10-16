import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { KNOWN_CURRENCIES } from "./lib/currencyCodes";

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

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Source de secours (et seule source pour les devises hors BCE) : ExchangeRate-API, endpoint ouvert sans clé,
// ~160 devises, mise à jour quotidienne. Attribution obligatoire : voir le lien affiché dans l'application.
async function fetchOpenEr(from: string, to: string): Promise<RateResult> {
  const response = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!response.ok) throw new Error(`ExchangeRate-API a répondu ${response.status}`);
  const data = (await response.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string; "error-type"?: string };
  if (data.result !== "success") throw new Error(`ExchangeRate-API : ${data["error-type"] ?? "réponse invalide"}`);
  const rate = data.rates?.[to];
  if (typeof rate !== "number" || !(rate > 0)) throw new Error(`ExchangeRate-API ne publie pas de taux ${from}/${to}`);
  const day = data.time_last_update_utc ? new Date(data.time_last_update_utc) : new Date();
  return { rate, asOf: (Number.isNaN(day.getTime()) ? new Date() : day).toISOString().slice(0, 10), source: "ExchangeRate-API (open.er-api.com)" };
}

/** Taux du marché : BCE (Frankfurter) quand les deux devises y sont, sinon/échec -> ExchangeRate-API. */
async function fetchMarketRate(from: string, to: string): Promise<RateResult> {
  const errors: string[] = [];
  if (FRANKFURTER_CURRENCIES.has(from) && FRANKFURTER_CURRENCIES.has(to)) {
    try {
      return await fetchFrankfurter(from, to);
    } catch (err) {
      errors.push(errText(err));
    }
  }
  try {
    return await fetchOpenEr(from, to);
  } catch (err) {
    errors.push(errText(err));
  }
  throw new Error(`Taux en ligne indisponible pour ${from}/${to} (${errors.join(" ; ")}). Saisissez le taux manuellement.`);
}

/** Taux d'une devise vers l'euro (marché pour les devises Frankfurter, parité fixe pour XAF/XOF). */
async function rateToEur(currency: string): Promise<RateResult> {
  if (currency === "EUR") return { rate: 1, asOf: "identique", source: "Même devise" };
  if (EUR_PEGGED[currency]) return { rate: 1 / EUR_PEGGED[currency], asOf: "parité fixe", source: PEG_SOURCE };
  return fetchMarketRate(currency, "EUR");
}

/** Taux de l'euro vers une devise (marché pour les devises Frankfurter, parité fixe pour XAF/XOF). */
async function rateFromEur(currency: string): Promise<RateResult> {
  if (currency === "EUR") return { rate: 1, asOf: "identique", source: "Même devise" };
  if (EUR_PEGGED[currency]) return { rate: EUR_PEGGED[currency], asOf: "parité fixe", source: PEG_SOURCE };
  return fetchMarketRate("EUR", currency);
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

  // Aucune des deux devises n'est pégée : un seul appel direct suffit.
  if (!EUR_PEGGED[f] && !EUR_PEGGED[t]) return fetchMarketRate(f, t);

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
  // Toutes les devises connues de l'app : un taux en ligne est tenté pour chacune (BCE puis ExchangeRate-API) ;
  // si aucun n'est publié, l'écran bascule sur la saisie manuelle du taux.
  handler: async (): Promise<string[]> => [...new Set([...SUPPORTED_CONVERSION_CURRENCIES, ...Object.keys(KNOWN_CURRENCIES)])].sort(),
});
