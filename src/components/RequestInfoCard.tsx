import React from 'react';
import type { QuotationWithRelations } from '../types';

/**
 * Tarification globale : cotation (majoration sur les prix catalogue) et remise à appliquer d'un
 * coup à tous les articles. Chaque ligne reste ensuite modifiable individuellement.
 * (Les autres informations de l'en-tête du document client restent conservées sur la commande.)
 */
export function RequestInfoCard({
  quotation,
  applying,
  onApply,
}: {
  quotation: QuotationWithRelations;
  applying: boolean;
  onApply: (quotationPercent: number | undefined, discountPercent: number | undefined) => void;
}) {
  const [cotation, setCotation] = React.useState(String(quotation.quotation_percent_override ?? ''));
  const [discount, setDiscount] = React.useState(String(quotation.global_discount_percent ?? ''));

  const parse = (raw: string) => {
    const t = raw.trim().replace(',', '.');
    return t === '' ? undefined : Number(t);
  };
  const cot = parse(cotation);
  const dis = parse(discount);
  const invalid = (cot !== undefined && !Number.isFinite(cot)) || (dis !== undefined && !Number.isFinite(dis));

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
          {applying ? 'Application…' : 'Appliquer à tous les articles'}
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
        Les deux valeurs sont écrites sur chaque ligne (colonnes Cotation et Discount), qui restent modifiables une à
        une. Laissez un champ vide pour ne pas toucher à la valeur actuelle des lignes.
      </p>
    </div>
  );
}
