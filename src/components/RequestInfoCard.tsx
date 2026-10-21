import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useAction } from 'convex/react';
import type { Currency, QuotationWithRelations } from '../types';
import { api } from '../lib/convex';
import { useBaseCurrency } from '../lib/currency';
import { BaseRatesPanel } from './BaseRatesPanel';
import { RateInputs, cleanServerError, parseRate } from './RateInputs';

/**
 * Tarification globale : cotation (majoration sur les prix catalogue) et remise à appliquer d'un
 * coup à tous les articles. Chaque ligne reste ensuite modifiable individuellement.
 * (Les autres informations de l'en-tête du document client restent conservées sur la commande.)
 */
const MANUAL_SOURCE = 'Taux saisi manuellement'; // doit rester identique à convex/orders.ts
// Étape 2 : le total de la quotation est déjà en USD (étape 1, voir BaseRatesPanel) ; on convertit USD -> devise cible.

export function RequestInfoCard({
  quotation,
  currencies,
  applying,
  onApply,
  convertingCurrency,
  onApplyExportCurrency,
  onApplyBaseRates,
  onSaveTransportFee,
  cotationMode,
  onCotationModeChange,
  onRefresh,
  refreshing,
  refreshDisabled,
}: {
  quotation: QuotationWithRelations;
  currencies: Currency[];
  /** undefined = annule la conversion (chaque ligne du fichier ressort dans sa propre devise d'origine). */
  onApplyExportCurrency: (targetCurrency: string | undefined, applyRate: boolean, ratePercent?: number, manualRates?: { currency: string; rate: number }[]) => void;
  /** Étape 1 : taux de chaque devise de prix vers l'USD (ajustement en % et/ou taux saisis). */
  onApplyBaseRates: (ratePercent: number | undefined, manualRates: { currency: string; rate: number }[]) => void;
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
  const baseCurrency = useBaseCurrency();
  const [cotation, setCotation] = React.useState(String(quotation.quotation_percent_override ?? ''));
  const [discount, setDiscount] = React.useState(String(quotation.global_discount_percent ?? ''));
  // « USD » = pas de conversion supplémentaire : le sélecteur reste alors vide.
  const currentTarget = quotation.export_currency && quotation.export_currency !== baseCurrency ? quotation.export_currency : '';
  const [target, setTarget] = React.useState(currentTarget);
  const [applyRate, setApplyRate] = React.useState(true);
  // Étape 2 : deux cases « 1 USD = [valeur exacte] devise cible ». `rateText` vide = taux du jour.
  const [rateText, setRateText] = React.useState('');
  const [live, setLive] = React.useState<number | undefined>(undefined);
  const [liveError, setLiveError] = React.useState<string | undefined>(undefined);
  const getRate = useAction(api.exchangeRates.getRate);
  const [fee, setFee] = React.useState(quotation.transport_fee ? String(quotation.transport_fee) : '');

  const displayCurrency = baseCurrency;

  const usdManual = quotation.usd_rate?.source === MANUAL_SOURCE ? quotation.usd_rate.rate : undefined;
  // Les cases reprennent le taux saisi déjà enregistré si la devise cible est inchangée, sinon repartent du taux du jour.
  React.useEffect(() => {
    setRateText(target === currentTarget && usdManual !== undefined ? String(usdManual) : '');
  }, [target, currentTarget, usdManual]);
  // Taux du jour USD -> devise cible (aperçu ; rien n'est enregistré avant « Appliquer le taux »).
  React.useEffect(() => {
    setLive(undefined);
    setLiveError(undefined);
    if (!target || !applyRate) return;
    let cancelled = false;
    getRate({ from: baseCurrency, to: target })
      .then((r) => { if (!cancelled) setLive(r.rate); })
      .catch((err) => { if (!cancelled) setLiveError(cleanServerError(err)); });
    return () => { cancelled = true; };
  }, [target, applyRate, getRate, baseCurrency]);
  const overridden = rateText.trim() !== '';
  const typedRate = parseRate(rateText);
  const rateInvalid = applyRate && Boolean(target) && (overridden ? !(typedRate > 0) : liveError !== undefined);
  const rateUnchanged = overridden ? usdManual === typedRate : usdManual === undefined;

  // Si la commande change (conversion appliquée/annulée depuis ailleurs, ou navigation vers une autre
  // quotation), le sélecteur suit la valeur réellement enregistrée plutôt que de garder une saisie périmée.
  React.useEffect(() => { setTarget(currentTarget); }, [currentTarget]);
  React.useEffect(() => { setFee(quotation.transport_fee ? String(quotation.transport_fee) : ''); }, [quotation.transport_fee]);

  const parse = (raw: string) => {
    const t = raw.trim().replace(',', '.');
    return t === '' ? undefined : Number(t);
  };
  const cot = parse(cotation);
  const dis = parse(discount);
  const invalid = (cot !== undefined && !Number.isFinite(cot)) || (dis !== undefined && !Number.isFinite(dis));

  // Changement de devise « sans conversion » : taux 1 enregistré pour chaque devise d'origine (étiquette seule).
  const relabelOnly = Boolean(currentTarget && quotation.usd_rate?.source === 'sans conversion');
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

        <BaseRatesPanel quotation={quotation} busy={convertingCurrency} onApply={onApplyBaseRates} />

        {/* has-rate : quand les cases du taux sont affichées, le panneau passe en mise en page « pleine largeur » (voir styles.css,
            section « Panneau de conversion »). Sans cette classe, ces cases se superposaient aux champs. */}
        <section className={`panel panel-wide${applyRate && target ? ' has-rate' : ''}`}>
          <div className="panel-head">
            <div className="panel-title">Convertir vers une autre devise (depuis {baseCurrency})</div>
            <label className="switch">
              <input type="checkbox" role="switch" checked={applyRate} onChange={(e) => setApplyRate(e.target.checked)} />
              <span className="switch-track"><span className="switch-thumb" /></span>
              <span className="switch-label">Appliquer le taux de change</span>
            </label>
          </div>
          <div className="panel-fields">
            {/* RETIRÉ : le champ « Initiale » (devise des prix du catalogue), jugé inutile ici. « Actuelle » est conservé. */}
            {/* field-narrow remplace l'ancien style en ligne (flex: 0 0 96px) pour pouvoir s'adapter au téléphone (voir styles.css) */}
            <div className="form-field field-narrow">
              <label>Actuelle</label>
              <input className="input" value={quotation.export_currency ?? displayCurrency} disabled readOnly title="Devise du fichier exporté." />
            </div>
            <div className="form-field">
              <label>Convertir vers</label>
              <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Aucune conversion ({displayCurrency})</option>
                {currencies
                  .filter((c) => c.active && c.code !== baseCurrency)
                  .map((c) => (
                    <option key={c.id} value={c.code}>{c.code} · {c.name}</option>
                  ))}
              </select>
            </div>
          </div>
          {applyRate && target && (
            // panel-rate : occupe toute la largeur de la grille, sur sa propre ligne (correctif du bug d'affichage)
            <div className="panel-rate">
              <RateInputs from={baseCurrency} to={target} live={live} value={rateText} onChange={setRateText} error={liveError} />
            </div>
          )}
          <div className="panel-foot">
            <button
              className="btn"
              disabled={
                convertingCurrency ||
                rateInvalid ||
                ((target || '') === currentTarget && (!target || (relabelOnly === !applyRate && (!applyRate || rateUnchanged))))
              }
              onClick={() =>
                onApplyExportCurrency(
                  target || undefined,
                  applyRate,
                  undefined,
                  applyRate && target && overridden ? [{ currency: baseCurrency, rate: typedRate }] : undefined,
                )
              }
            >
              {convertingCurrency ? (applyRate ? 'Récupération du taux…' : 'Application…') : applyRate ? 'Appliquer le taux' : 'Changer la devise'}
            </button>
          </div>
        </section>
      </div>

      {quotation.export_rates.some((r) => r.source.includes('ExchangeRate-API')) && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates By Exchange Rate API</a>
        </div>
      )}
    </div>
  );
}
