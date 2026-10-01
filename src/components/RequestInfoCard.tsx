import React from 'react';
import { useQuery } from 'convex/react';
import type { Currency, QuotationWithRelations } from '../types';
import { formatAmount, formatPrice } from '../lib/format';
import { api } from '../lib/convex';

/**
 * Tarification globale : cotation (majoration sur les prix catalogue) et remise à appliquer d'un
 * coup à tous les articles. Chaque ligne reste ensuite modifiable individuellement.
 * (Les autres informations de l'en-tête du document client restent conservées sur la commande.)
 */
export function RequestInfoCard({
  quotation,
  currencies,
  pricingCurrency,
  applying,
  onApply,
  convertingCurrency,
  onApplyExportCurrency,
}: {
  quotation: QuotationWithRelations;
  currencies: Currency[];
  /** Devise de repli (pays de cotation) pour les lignes sans devise propre enregistrée. */
  pricingCurrency: string;
  /** undefined = annule la conversion (chaque ligne du fichier ressort dans sa propre devise d'origine). */
  onApplyExportCurrency: (targetCurrency: string | undefined) => void;
  convertingCurrency: boolean;
  applying: boolean;
  onApply: (quotationPercent: number | undefined, discountPercent: number | undefined) => void;
}) {
  const [cotation, setCotation] = React.useState(String(quotation.quotation_percent_override ?? ''));
  const [discount, setDiscount] = React.useState(String(quotation.global_discount_percent ?? ''));
  const [target, setTarget] = React.useState(quotation.export_currency ?? '');

  // Chaque ligne a été tarifée avec la devise enregistrée sur son prix catalogue au moment du matching
  // (productPrices.currency, choisie indépendamment du pays à l'import - voir CatalogImportModal) : des
  // lignes d'une même quotation peuvent donc être dans des devises différentes. C'est cet ensemble réel,
  // pas la seule devise du pays, qui détermine le(s) taux de change à appliquer.
  const sourceCurrencies = React.useMemo(() => {
    const set = new Set<string>();
    for (const it of quotation.quotation_items) {
      if (it.excluded || it.total_price == null) continue;
      set.add(it.price_currency ?? pricingCurrency);
    }
    return [...set].sort();
  }, [quotation.quotation_items, pricingCurrency]);
  const displayCurrency = sourceCurrencies.length > 0 ? sourceCurrencies.join(', ') : pricingCurrency;

  // Devises pour lesquelles un taux en direct existe réellement (source BCE + parité fixe CFA) - beaucoup
  // de codes ISO valides (ex. AWG, GNF...) ne sont pas couverts par ce service gratuit, ce n'est pas un
  // code erroné, juste une devise trop peu échangée pour avoir un taux de référence quotidien publié.
  const supportedTargets = useQuery(api.exchangeRates.listSupportedTargets, {});
  const bases = sourceCurrencies.length > 0 ? sourceCurrencies : [pricingCurrency];
  const unsupportedBases = supportedTargets ? bases.filter((c) => !supportedTargets.includes(c)) : [];
  const conversionAvailable = supportedTargets !== undefined && unsupportedBases.length === 0;

  // Si la commande change (conversion appliquée/annulée depuis ailleurs, ou navigation vers une autre
  // quotation), le sélecteur suit la valeur réellement enregistrée plutôt que de garder une saisie périmée.
  React.useEffect(() => { setTarget(quotation.export_currency ?? ''); }, [quotation.export_currency]);

  const parse = (raw: string) => {
    const t = raw.trim().replace(',', '.');
    return t === '' ? undefined : Number(t);
  };
  const cot = parse(cotation);
  const dis = parse(discount);
  const invalid = (cot !== undefined && !Number.isFinite(cot)) || (dis !== undefined && !Number.isFinite(dis));

  const isConverting = Boolean(quotation.export_currency && quotation.export_rates.length > 0);
  const rateFor = (currency: string) => quotation.export_rates.find((r) => r.currency === currency)?.rate;
  const convertedSubtotal = isConverting
    ? quotation.quotation_items
        .filter((it) => !it.excluded && it.total_price != null)
        .reduce((sum, it) => sum + (it.total_price as number) * (rateFor(it.price_currency ?? pricingCurrency) ?? 1), 0)
    : 0;
  const convertedTotal = convertedSubtotal * (1 - (quotation.global_discount_percent ?? 0) / 100);

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <div className="section-title">Tarification globale</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-field" style={{ marginBottom: 0, width: 200 }}>
          <label>Global Cotation (%)</label>
          <input className="input" inputMode="decimal" value={cotation} placeholder="inchangée" onChange={(e) => setCotation(e.target.value)} />
        </div>
        <div className="form-field" style={{ marginBottom: 0, width: 200 }}>
          <label>Global Discount (%)</label>
          <input className="input" inputMode="decimal" value={discount} placeholder="inchangé" onChange={(e) => setDiscount(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={applying || invalid} onClick={() => onApply(cot, dis)}>
          {applying ? 'Application…' : 'Appliquer'}
        </button>
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>Devise du fichier exporté</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-field" style={{ marginBottom: 0, width: 200 }}>
          <label>Devise actuelle des produits</label>
          <input className="input" value={displayCurrency} disabled readOnly title="Devise enregistrée sur le prix de chaque ligne au moment du matching." />
        </div>
        <div className="form-field" style={{ marginBottom: 0, width: 240 }}>
          <label>Convertir vers</label>
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!conversionAvailable}>
            <option value="">Aucune conversion ({displayCurrency})</option>
            {currencies
              .filter((c) => c.active && !bases.includes(c.code) && (supportedTargets?.includes(c.code) ?? false))
              .map((c) => (
                <option key={c.id} value={c.code}>{c.code} - {c.name}</option>
              ))}
          </select>
        </div>
        <button
          className="btn"
          disabled={!conversionAvailable || convertingCurrency || (target || '') === (quotation.export_currency ?? '')}
          onClick={() => onApplyExportCurrency(target || undefined)}
        >
          {convertingCurrency ? 'Récupération du taux…' : 'Appliquer le taux'}
        </button>
      </div>
      {!conversionAvailable && supportedTargets !== undefined && (
        <div className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
          Conversion en direct indisponible depuis {unsupportedBases.join(', ')} : {unsupportedBases.length > 1 ? 'ces devises n\'ont' : 'cette devise n\'a'} pas de taux de référence publié par la Banque centrale européenne (source du service utilisé).
        </div>
      )}
      {isConverting && (
        <div className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
          {quotation.export_rates.map((r) => (
            <div key={r.currency}>
              1 {r.currency} = {r.rate.toFixed(4)} {quotation.export_currency} — {r.source}{r.asOf && r.asOf !== 'identique' ? ` (taux du ${r.asOf})` : ''}
            </div>
          ))}
          Figé au moment de l'application, pas de mise à jour automatique.
          <br />
          Total de la quotation converti : <strong>{formatPrice(convertedTotal, quotation.export_currency ?? undefined)}</strong>
          {' '}(au lieu de {formatAmount(quotation.total)} {displayCurrency}). Seul le fichier exporté utilise ce montant converti ; les prix affichés à l'écran restent dans la devise d'origine de chaque ligne.
        </div>
      )}
    </div>
  );
}
