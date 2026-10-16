import React from 'react';
import { useAction } from 'convex/react';
import type { QuotationWithRelations } from '../types';
import { api } from '../lib/convex';
import { RateInputs, cleanServerError, parseRate } from './RateInputs';

const MANUAL_SOURCE = 'Taux saisi manuellement'; // doit rester identique à convex/orders.ts

/**
 * Étape 1 de la conversion d'une quotation : chaque ligne est d'abord convertie en USD, indépendamment du pays.
 * Pour chaque devise de prix, deux cases montrent la conversion « 1 EUR = [valeur] USD » : elle affiche le taux du
 * jour et on peut la remplacer par la valeur exacte voulue. L'étape 2 (USD -> autre devise) est dans le panneau suivant.
 */
export function BaseRatesPanel({
  quotation,
  busy,
  onApply,
}: {
  quotation: QuotationWithRelations;
  busy: boolean;
  onApply: (ratePercent: number | undefined, manualRates: { currency: string; rate: number }[]) => void;
}) {
  const getRate = useAction(api.exchangeRates.getRate);

  // Devises réellement présentes sur les lignes chiffrées (hors USD : rien à convertir).
  const currencies = React.useMemo(() => {
    const set = new Set<string>();
    for (const it of quotation.quotation_items) {
      if (it.excluded || it.total_price == null) continue;
      const c = it.price_currency ?? 'USD';
      if (c !== 'USD') set.add(c);
    }
    return [...set].sort();
  }, [quotation.quotation_items]);
  const currenciesKey = currencies.join(',');

  const applied = quotation.base_rates;
  const appliedKey = JSON.stringify(applied.map((r) => [r.currency, r.rate, r.source]));

  // Valeur saisie par devise (vide = taux du jour).
  const [typed, setTyped] = React.useState<Record<string, string>>({});
  const [live, setLive] = React.useState<Record<string, number>>({});
  const [failed, setFailed] = React.useState<Record<string, string>>({});

  // Repart de ce qui est enregistré sur la quotation : les taux saisis à la main.
  React.useEffect(() => {
    const init: Record<string, string> = {};
    for (const r of applied) if (r.source === MANUAL_SOURCE) init[r.currency] = String(r.rate);
    setTyped(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  // Taux du jour de chaque devise vers l'USD (aperçu ; rien n'est enregistré avant « Appliquer »).
  React.useEffect(() => {
    setLive({});
    setFailed({});
    let cancelled = false;
    for (const from of currencies) {
      getRate({ from, to: 'USD' })
        .then((r) => { if (!cancelled) setLive((prev) => ({ ...prev, [from]: r.rate })); })
        .catch((err) => { if (!cancelled) setFailed((prev) => ({ ...prev, [from]: cleanServerError(err) })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currenciesKey, getRate]);

  const overridden = (c: string) => (typed[c] ?? '').trim() !== '';
  // Une saisie doit être un nombre > 0 ; une devise sans taux en ligne exige une saisie.
  const invalid = currencies.some((c) => (overridden(c) ? !(parseRate(typed[c]) > 0) : failed[c] !== undefined));

  // MASQUÉ quand il n'y a rien à convertir : toutes les lignes sont déjà en USD. L'ancien message « aucune conversion
  // nécessaire » était redondant. Le panneau réapparaît tout seul dès qu'une ligne est chiffrée dans une autre devise
  // (EUR, XAF...), car c'est lui qui règle alors le taux de cette devise vers l'USD. (Tous les hooks sont déjà appelés plus haut.)
  if (currencies.length === 0) return null;

  return (
    <section className="panel panel-wide">
      <div className="panel-title">Conversion en USD</div>
      <div className="text-muted" style={{ fontSize: 12, margin: '8px 0' }}>
        Toutes les lignes sont d'abord converties en USD. Pour chaque devise, la case de droite affiche le taux du jour : remplacez-la par la valeur exacte voulue (ex. 1 EUR = 1,1 USD).
      </div>
      {currencies.map((c) => (
        <div key={c} style={{ marginTop: 12 }}>
          <RateInputs
            from={c}
            to="USD"
            live={live[c]}
            value={typed[c] ?? ''}
            onChange={(value) => setTyped((prev) => ({ ...prev, [c]: value }))}
            error={failed[c]}
          />
        </div>
      ))}
      <div className="panel-foot" style={{ marginTop: 12 }}>
        <span className="panel-hint">{applied.length > 0 ? 'Taux enregistrés sur cette quotation' : 'Taux du jour appliqués automatiquement'}</span>
        <button
          className="btn"
          disabled={busy || invalid}
          onClick={() => onApply(undefined, currencies.filter(overridden).map((c) => ({ currency: c, rate: parseRate(typed[c]) })))}
        >
          {busy ? 'Application…' : 'Appliquer les taux'}
        </button>
      </div>
    </section>
  );
}
