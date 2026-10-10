import React from 'react';
import { useMutation } from 'convex/react';
import { Printer, Truck } from 'lucide-react';
import type { OrderValidation, QuotationWithRelations, ValidationItem } from '../types';
import { api, type Id } from '../lib/convex';
import { formatAmount } from '../lib/format';
import { printOrderDocument, type OrderDocumentInfo } from '../lib/printOrderDocument';
import { useToast } from './Toast';

const round2 = (n: number) => Math.round(n * 100) / 100;
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Intitulé de section du fichier du client (ex. « EQ/SCF/LHC/0017/PROVISIONS ») : du texte seul, sans code, quantité,
 * unité ni prix. Ces lignes sont conservées mais décochées d'office, pour ne pas être imprimées par erreur.
 */
export function isSectionHeader(item: ValidationItem): boolean {
  return !item.code && !(item.quantity !== null && item.quantity > 0) && !item.unit && item.unit_price === null;
}

/**
 * Prix d'achat d'une ligne = prix du fichier du client moins la marge de la cotation d'origine : la cotation (%)
 * a été ajoutée au prix du catalogue pour obtenir le prix client, on la retire donc (prix / (1 + cotation)).
 */
export function purchasePrice(item: ValidationItem): number | null {
  return item.unit_price === null ? null : round2(item.unit_price / (1 + item.margin_percent / 100));
}

/**
 * Détails de la commande validée : les articles du fichier final du client, puis l'impression du Purchase Order
 * (prix d'achat) et du Delivery Note (même document sans prix), au format des documents de l'entreprise.
 */
export function ValidationDetails({
  quotation,
  validation,
  currency,
}: {
  quotation: QuotationWithRelations;
  validation: OrderValidation;
  currency: string;
}) {
  const toast = useToast();
  const updateLogistics = useMutation(api.orders.updateLogistics);
  const orderId = quotation.id as Id<'orders'>;

  // Informations de l'en-tête des documents : reprises de la commande, modifiables ; ce qui peut l'être est
  // enregistré sur la commande à la sortie du champ (l'agent n'est pas mémorisé : c'est le client par défaut).
  const [info, setInfo] = React.useState<OrderDocumentInfo>({
    vessel: quotation.vessel ?? '',
    agent: quotation.customer_name,
    port: quotation.supply_place ?? quotation.countries?.city ?? '',
    orderNo: quotation.client_order_number ?? '',
    rfqNo: quotation.document_info.vendorRef ?? quotation.quotation_number,
    supplyDate: quotation.eta ?? '',
    category: quotation.document_info.category ?? '',
    onBehalf: quotation.document_info.issuer ?? '',
  });
  // Discount (%) du Purchase Order : par défaut celui de la quotation, modifiable ici sans toucher à la quotation.
  const [discountText, setDiscountText] = React.useState(quotation.global_discount_percent ? String(quotation.global_discount_percent) : '');
  const parsedDiscount = Number(discountText.trim().replace(',', '.'));
  const discountPercent = Number.isFinite(parsedDiscount) ? Math.min(100, Math.max(0, parsedDiscount)) : 0;
  const set = (key: keyof OrderDocumentInfo) => (value: string) => setInfo((prev) => ({ ...prev, [key]: value }));
  const persist = (field: 'vessel' | 'supplyPlace' | 'clientOrderNumber' | 'vendorRef' | 'eta' | 'category' | 'issuer', value: string) =>
    updateLogistics({ orderId, [field]: value }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  const items = validation.items;

  // Articles à imprimer : tous cochés au départ sauf les intitulés de section ; un nouveau fichier de validation remet cet état.
  const initialSelection = () => new Set(validation.items.filter((it) => !isSectionHeader(it)).map((it) => it.id));
  const [selected, setSelected] = React.useState<Set<string>>(initialSelection);
  const itemKey = validation.items.map((it) => it.id).join(',');
  React.useEffect(() => { setSelected(initialSelection()); }, [itemKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = items.filter((it) => selected.has(it.id));
  const allChosen = items.length > 0 && chosen.length === items.length;
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const total = chosen.reduce((sum, it) => {
    const price = purchasePrice(it);
    return sum + (price !== null && it.quantity !== null ? round2(price * it.quantity) : 0);
  }, 0);
  const discountAmount = round2((total * discountPercent) / 100);
  const netTotal = round2(total - discountAmount);
  const clientTotal = chosen.reduce((sum, it) => sum + (it.unit_price !== null && it.quantity !== null ? round2(it.unit_price * it.quantity) : 0), 0);
  const unmatched = items.filter((it) => !it.matched).length;

  const print = (kind: 'purchase' | 'delivery') => {
    const ok = printOrderDocument({
      kind,
      info,
      currency,
      discountPercent: kind === 'purchase' ? discountPercent : 0,
      lines: chosen.map((it) => ({
        no: it.line_ref ?? items.indexOf(it) + 1,
        description: it.description,
        code: it.code ?? '',
        unit: it.unit ?? '',
        quantity: it.quantity,
        unitPrice: kind === 'purchase' ? purchasePrice(it) : null,
      })),
    });
    if (!ok) toast("Le navigateur a bloqué l'ouverture du document : autorisez les fenêtres pop-up pour ce site.", 'error');
  };

  const field = (label: string, key: keyof OrderDocumentInfo, opts?: { persist?: Parameters<typeof persist>[0]; type?: string; wide?: boolean }) => (
    <div className="form-field" style={{ marginBottom: 0, gridColumn: opts?.wide ? '1 / -1' : undefined }}>
      <label>{label}</label>
      {key === 'onBehalf' ? (
        <textarea
          className="input"
          rows={3}
          value={info[key]}
          placeholder={'Nom du donneur d\'ordre\nAdresse'}
          onChange={(e) => set(key)(e.target.value)}
          onBlur={(e) => opts?.persist && persist(opts.persist, e.target.value.trim())}
          style={{ resize: 'vertical' }}
        />
      ) : (
        <input
          className="input"
          type={opts?.type}
          value={info[key]}
          onChange={(e) => set(key)(e.target.value)}
          onBlur={(e) => opts?.persist && persist(opts.persist, e.target.value.trim())}
        />
      )}
    </div>
  );

  return (
    <div>
      {unmatched > 0 && (
        <div className="card-pad" style={{ fontSize: 13, color: 'var(--color-warning, #b45309)', borderBottom: '1px solid var(--color-border)' }}>
          {unmatched} ligne(s) n'ont pas été retrouvées dans la cotation d'origine : la cotation de la commande est utilisée comme marge.
        </div>
      )}

      <div className="table-scroll" style={{ maxHeight: '60vh', border: 'none', borderRadius: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(items.map((it) => it.id)))}
                  aria-label="Tout sélectionner"
                  title="Tout sélectionner / désélectionner"
                />
              </th>
              <th style={{ width: 48 }}>No.</th>
              <th>Code</th>
              <th>Description</th>
              <th>Unit</th>
              <th className="text-right">Quantity</th>
              <th className="text-right">Prix client</th>
              <th className="text-right">Marge (%)</th>
              <th className="text-right">Prix d'achat</th>
              <th className="text-right">Total d'achat</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const price = purchasePrice(it);
              return (
                <tr key={it.id} style={selected.has(it.id) ? undefined : { opacity: 0.5 }}>
                  <td>
                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Imprimer l'article ${it.line_ref ?? i + 1}`} />
                  </td>
                  <td className="text-muted mono">{it.line_ref ?? i + 1}</td>
                  <td className="mono">{it.code ?? ''}</td>
                  <td>{it.description}</td>
                  <td>{it.unit ?? ''}</td>
                  <td className="text-right mono">{it.quantity ?? ''}</td>
                  <td className="text-right mono">{it.unit_price === null ? '·' : formatAmount(it.unit_price)}</td>
                  <td className="text-right mono" title={it.matched ? undefined : 'Ligne non retrouvée : marge de la commande'}>
                    {it.margin_percent}{it.matched ? '' : '*'}
                  </td>
                  <td className="text-right mono">{price === null ? '·' : formatAmount(price)}</td>
                  <td className="text-right mono">{price === null || it.quantity === null ? '·' : formatAmount(round2(price * it.quantity))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="total-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="label">Articles à imprimer</span>
          <span className="mono">{chosen.length} / {items.length}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="label">Total client</span>
          <span className="mono">{formatAmount(clientTotal)} {currency}</span>
        </div>
        {discountPercent > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="label">Sous-total d'achat</span>
              <span className="mono">{formatAmount(total)} {currency}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="label">Discount {discountPercent}%</span>
              <span className="mono">-{formatAmount(discountAmount)} {currency}</span>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="label">Total d'achat (Purchase Order)</span>
          <span className="amount mono">{formatAmount(discountPercent > 0 ? netTotal : total)} {currency}</span>
        </div>
      </div>

      <div className="card-pad" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="section-title">En-tête des documents</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          {field('Vessel name', 'vessel', { persist: 'vessel' })}
          {field('Agent', 'agent')}
          {field('Delivery port', 'port', { persist: 'supplyPlace' })}
          {field('Order no', 'orderNo', { persist: 'clientOrderNumber' })}
          {field('RFQ n°', 'rfqNo', { persist: 'vendorRef' })}
          {field('Supply date', 'supplyDate', { persist: 'eta', type: 'date' })}
          {field('Category', 'category', { persist: 'category' })}
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>Discount (%)</label>
            <input className="input" inputMode="decimal" value={discountText} placeholder="0" onChange={(e) => setDiscountText(e.target.value)} />
          </div>
          {field('On behalf (nom puis adresse)', 'onBehalf', { persist: 'issuer', wide: true })}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={chosen.length === 0} onClick={() => print('purchase')} title="Articles avec prix d'achat (prix du fichier client moins la marge de la cotation)">
            <Printer size={16} /> Imprimer le Purchase Order
          </button>
          <button className="btn" disabled={chosen.length === 0} onClick={() => print('delivery')} title="Le même document, sans prix">
            <Truck size={16} /> Imprimer le Delivery Note
          </button>
        </div>
      </div>
    </div>
  );
}
