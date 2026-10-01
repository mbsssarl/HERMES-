import React from 'react';
import { Check, ChevronDown, ChevronUp, CircleHelp, TriangleAlert, X } from 'lucide-react';
import type { ProductWithPrices, QuotationItem } from '../types';
import { MATCH_LABELS, formatAmount } from '../lib/format';
import { Badge } from './ui';
import { NumberCell, TextCell } from './EditableCells';

export type LineEdit = Partial<{
  rawCode: string;
  rawDescription: string;
  rawQuantity: number;
  rawUnit: string;
  rawOrigin: string;
  quotedQuantity: number;
  quotationPercent: number;
  unitPrice: number | null;
  reqNotes: string;
  enqNotes: string;
}>;

/** État de la correspondance avec le catalogue, dans le même style discret que l'aperçu d'import. */
function MatchTag({ item }: { item: QuotationItem }) {
  const score = item.match_score !== null ? ` · ${item.match_score}%` : '';
  if (item.match_status === 'MATCHED') {
    return <span className="tag tag-new"><Check size={13} /> {MATCH_LABELS.MATCHED}{score}</span>;
  }
  if (item.match_status === 'REVIEW') {
    return <span className="tag tag-warn"><TriangleAlert size={13} /> {MATCH_LABELS.REVIEW}{score}</span>;
  }
  return <span className="tag tag-error"><CircleHelp size={13} /> {MATCH_LABELS.NOT_FOUND}</span>;
}

/**
 * Lignes de la quotation : No., Code, Description, Quantity, Unit, Unit Price, Cotation (%), Final Price,
 * Correspondance (le discount est global, il s'applique au total de la commande). Tout ce que l'utilisateur a saisi est modifiable ; Final Price (total de la
 * ligne après remise) est calculé, ainsi que le Unit Price tant qu'aucun prix n'est saisi.
 */
export function LinesTable({
  items,
  products,
  currency,
  onEdit,
  countryId,
  onConfirm,
  onDismiss,
  onToggle,
}: {
  items: QuotationItem[];
  products: ProductWithPrices[];
  currency: string;
  /** Pays de cotation : les prix des propositions sont ceux de ce pays. */
  countryId: string | null;
  onEdit: (item: QuotationItem, edit: LineEdit) => void;
  onConfirm: (item: QuotationItem, productId: string) => void;
  /** Ignore une proposition de correspondance. */
  onDismiss: (item: QuotationItem, productId: string) => void;
  /** Inclut / exclut des lignes du devis (totaux, statistiques, PDF, fichier exporté). */
  onToggle: (items: QuotationItem[], included: boolean) => void;
}) {
  // Lignes dont les propositions sont dépliées
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allIncluded = items.length > 0 && items.every((it) => !it.excluded);
  const someIncluded = items.some((it) => !it.excluded);
  return (
    <div className="table-scroll" style={{ maxHeight: '68vh', border: 'none', borderRadius: 0 }}>
      <table className="data lines">
        <thead>
          <tr>
            <th style={{ width: 30 }}>
              <input
                type="checkbox"
                checked={allIncluded}
                ref={(el) => { if (el) el.indeterminate = someIncluded && !allIncluded; }}
                onChange={() => onToggle(items, !allIncluded)}
                aria-label="Tout sélectionner"
                title="Inclure / exclure toutes les lignes"
              />
            </th>
            <th>No.</th>
            <th>Code</th>
            <th>Description</th>
            <th className="text-right">Quantity</th>
            <th>Unit</th>
            <th className="text-right">Unit Price</th>
            <th className="text-right">Cotation (%)</th>
            <th className="text-right">Final Price</th>
            <th>Correspondance</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const proposals = it.match_status === 'REVIEW' ? it.candidate_products : [];
            const expanded = proposals.length > 0 && open.has(it.id);
            const priceMissing = it.product_id !== null && it.unit_price === null;
            return (
              <React.Fragment key={it.id}>
              <tr className={expanded ? 'has-proposals' : undefined} style={it.excluded ? { opacity: 0.45 } : undefined}>
                <td>
                  <input type="checkbox" checked={!it.excluded} onChange={() => onToggle([it], it.excluded)} aria-label={`Inclure la ligne ${it.line_no}`} />
                </td>
                <td className="text-muted mono">{it.line_no}</td>
                <td><TextCell mono width={96} value={it.raw_code ?? ''} onCommit={(v) => onEdit(it, { rawCode: v })} /></td>
                <td style={{ minWidth: 280, width: '35%' }}>
                  <TextCell width="100%" value={it.original_description} onCommit={(v) => onEdit(it, { rawDescription: v })} />
                </td>
                <td className="text-right"><NumberCell width={68} value={it.quantity} onCommit={(v) => onEdit(it, { rawQuantity: v })} /></td>
                <td><TextCell width={64} value={it.unit ?? ''} onCommit={(v) => onEdit(it, { rawUnit: v })} /></td>
                <td className="text-right">
                  <NumberCell
                    width={92}
                    value={it.unit_price_manual}
                    placeholder={priceMissing || it.unit_price === null ? 'Prix manquant' : String(it.unit_price)}
                    onCommit={(v) => onEdit(it, { unitPrice: v })}
                    onClear={() => onEdit(it, { unitPrice: null })}
                  />
                </td>
                <td className="text-right"><NumberCell width={64} value={it.margin_percentage} onCommit={(v) => onEdit(it, { quotationPercent: v })} /></td>
                <td className="text-right mono nowrap" style={{ fontWeight: 700 }}>{formatAmount(it.total_price)}</td>
                <td style={{ minWidth: 150 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MatchTag item={it} />
                    {proposals.length > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 6px' }}
                        onClick={() => toggleOpen(it.id)}
                        title={expanded ? 'Masquer les propositions' : 'Voir les propositions'}
                        aria-expanded={expanded}
                      >
                        {proposals.length} {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {expanded && (
                <>
                  {proposals.map((c, ci) => {
                    const price = countryId ? products.find((p) => p.id === c.id)?.product_prices.find((pr) => pr.country_id === countryId)?.base_price ?? null : null;
                    return (
                      <tr key={`${it.id}-${c.id}`} className={`proposal-row ${ci === proposals.length - 1 ? 'proposal-last' : ''}`}>
                        <td></td>
                        <td></td>
                        <td><TextCell mono readOnly width={96} value={c.reference} onCommit={() => {}} /></td>
                        <td style={{ minWidth: 170 }}><TextCell readOnly width="100%" value={c.name} onCommit={() => {}} /></td>
                        <td></td>
                        <td><TextCell readOnly width={64} value={c.unit} onCommit={() => {}} /></td>
                        <td className="text-right"><NumberCell readOnly width={92} decimals={2} value={price} placeholder="Prix manquant" onCommit={() => {}} /></td>
                        <td></td>
                        <td></td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-sm" onClick={() => onConfirm(it, c.id)}><Check size={13} /> Choisir</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(it, c.id)} title="Ignorer cette proposition" aria-label={`Ignorer la proposition ${c.name}`}>
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
