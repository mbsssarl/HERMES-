import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery } from 'convex/react';
import type { Currency, QuotationWithRelations } from '../types';
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
  onSaveTransportFee,
  cotationMode,
  onCotationModeChange,
  onRefresh,
  refreshing,
  refreshDisabled,
}: {
  quotation: QuotationWithRelations;
  currencies: Currency[];
  /** Devise de repli (pays de cotation) pour les lignes sans devise propre enregistrée. */
  pricingCurrency: string;
  /** undefined = annule la conversion (chaque ligne du fichier ressort dans sa propre devise d'origine). */
  onApplyExportCurrency: (targetCurrency: string | undefined, applyRate: boolean) => void;
  /** Frais de livraison + mise à l'eau (devise du fichier) ; undefined = les retirer. */
  onSaveTransportFee: (fee: number | undefined) => void;
  /** Saisie de la cotation des lignes du tableau : en % ou en montant par unité. */
  cotationMode: 'percent' | 'price';
  onCotationModeChange: (mode: 'percent' | 'price') => void;
  /** Refait un tour en base : reconnaissance des lignes en attente et prix du catalogue à jour. */
  onRefresh: () => void;
  refreshing: boolean;
  refreshDisabled: boolean;
  convertingCurrency: boolean;
  applying: boolean;
  onApply: (quotationPercent: number | undefined, discountPercent: number | undefined) => void;
}) {
  const [cotation, setCotation] = React.useState(String(quotation.quotation_percent_override ?? ''));
  const [discount, setDiscount] = React.useState(String(quotation.global_discount_percent ?? ''));
  const [target, setTarget] = React.useState(quotation.export_currency ?? '');
  const [applyRate, setApplyRate] = React.useState(true);
  const [fee, setFee] = React.useState(quotation.transport_fee ? String(quotation.transport_fee) : '');

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
  React.useEffect(() => { setFee(quotation.transport_fee ? String(quotation.transport_fee) : ''); }, [quotation.transport_fee]);

  const parse = (raw: string) => {
    const t = raw.trim().replace(',', '.');
    return t === '' ? undefined : Number(t);
  };
  const cot = parse(cotation);
  const dis = parse(discount);
  const invalid = (cot !== undefined && !Number.isFinite(cot)) || (dis !== undefined && !Number.isFinite(dis));

  // Changement de devise « sans conversion » : taux 1 enregistré pour chaque devise d'origine (étiquette seule).
  const relabelOnly = Boolean(quotation.export_currency && quotation.export_rates.length > 0 && quotation.export_rates.every((r) => r.source === 'sans conversion'));
  const feeValue = parse(fee);
  const feeInvalid = feeValue !== undefined && (!Number.isFinite(feeValue) || feeValue < 0);
  const feeCurrency = quotation.export_currency ?? displayCurrency;
  const feeChanged = (feeValue ?? 0) !== (quotation.transport_fee ?? 0);

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <div className="panel-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="panel-title">Tarification globale</div>
            <button
              className="btn btn-sm"
              onClick={onRefresh}
              disabled={refreshing || refreshDisabled}
              title="Refait un tour dans le catalogue : reconnaissance des lignes en attente et prix à jour"
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : undefined} /> {refreshing ? 'Actualisation…' : 'Actualiser'}
            </button>
          </div>
          <div className="panel-fields">
            <div className="form-field">
              <label>Global Cotation (%)</label>
              <input className="input" inputMode="decimal" value={cotation} placeholder="inchangée" onChange={(e) => setCotation(e.target.value)} />
            </div>
            <div className="form-field">
              <label>Global Discount (%)</label>
              <input className="input" inputMode="decimal" value={discount} placeholder="inchangé" onChange={(e) => setDiscount(e.target.value)} />
            </div>
          </div>
          <div className="panel-foot">
            <div className="panel-mode">
              <span className="panel-hint">Cotation des lignes</span>
              <div className="segmented segmented-xs" role="group" aria-label="Saisie de la cotation des lignes">
                <button type="button" className={cotationMode === 'percent' ? 'active' : ''} onClick={() => onCotationModeChange('percent')} title="Cotation en pourcentage">%</button>
                <button type="button" className={cotationMode === 'price' ? 'active' : ''} onClick={() => onCotationModeChange('price')} title="Cotation en montant par unité">Prix</button>
              </div>
            </div>
            <button className="btn btn-primary" disabled={applying || invalid} onClick={() => onApply(cot, dis)}>
              {applying ? 'Application…' : 'Appliquer'}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">Frais de transport</div>
          <div className="panel-fields">
            <div className="form-field">
              <label>Delivery + launch service ({feeCurrency})</label>
              <input className="input" inputMode="decimal" value={fee} placeholder="aucun" onChange={(e) => setFee(e.target.value)} />
            </div>
          </div>
          <div className="panel-foot">
            <span className="panel-hint">{quotation.transport_fee ? 'Défini : ajouté après le discount' : 'Non défini'}</span>
            <button className="btn" disabled={feeInvalid || !feeChanged} onClick={() => onSaveTransportFee(feeValue && feeValue > 0 ? feeValue : undefined)}>
              {feeValue ? 'Enregistrer' : quotation.transport_fee ? 'Retirer' : 'Enregistrer'}
            </button>
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-head">
            <div className="panel-title">Devise du fichier exporté</div>
            <label className="switch">
              <input type="checkbox" role="switch" checked={applyRate} onChange={(e) => setApplyRate(e.target.checked)} />
              <span className="switch-track"><span className="switch-thumb" /></span>
              <span className="switch-label">Appliquer le taux de change</span>
            </label>
          </div>
          <div className="panel-fields">
            <div className="form-field" style={{ flex: '0 0 96px' }}>
              <label>Initiale</label>
              <input className="input" value={displayCurrency} disabled readOnly title="Devise des prix du catalogue, enregistrée sur chaque ligne au moment du matching." />
            </div>
            <div className="form-field" style={{ flex: '0 0 96px' }}>
              <label>Actuelle</label>
              <input className="input" value={quotation.export_currency ?? displayCurrency} disabled readOnly title="Devise du fichier exporté." />
            </div>
            <div className="form-field">
              <label>Convertir vers</label>
              <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} disabled={applyRate && !conversionAvailable}>
                <option value="">Aucune conversion ({displayCurrency})</option>
                {currencies
                  .filter((c) => c.active && !bases.includes(c.code) && (!applyRate || (supportedTargets?.includes(c.code) ?? false)))
                  .map((c) => (
                    <option key={c.id} value={c.code}>{c.code} · {c.name}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="panel-foot">
            <button
              className="btn"
              disabled={
                (applyRate && !conversionAvailable) ||
                convertingCurrency ||
                ((target || '') === (quotation.export_currency ?? '') && (!target || relabelOnly === !applyRate))
              }
              onClick={() => onApplyExportCurrency(target || undefined, applyRate)}
            >
              {convertingCurrency ? (applyRate ? 'Récupération du taux…' : 'Application…') : applyRate ? 'Appliquer le taux' : 'Changer la devise'}
            </button>
          </div>
        </section>
      </div>

      {applyRate && !conversionAvailable && supportedTargets !== undefined && (
        <div className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
          Conversion en direct indisponible depuis {unsupportedBases.join(', ')} : {unsupportedBases.length > 1 ? 'ces devises n\'ont' : 'cette devise n\'a'} pas de taux de référence publié par la Banque centrale européenne (source du service utilisé).
        </div>
      )}
    </div>
  );
}
