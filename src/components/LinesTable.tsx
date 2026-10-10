import React from 'react';
import { Check, ChevronDown, ChevronUp, CircleHelp, Pencil, TriangleAlert, X } from 'lucide-react';
import type { PendingEdit, ProductWithPrices, QuotationItem } from '../types';
import { MATCH_LABELS, formatAmount } from '../lib/format';
import { Badge } from './ui';
import { NumberCell, TextCell } from './EditableCells';
import { Pager, usePage } from './Pager';

export type LineEdit = Partial<{
  rawCode: string;
  rawDescription: string;
  rawQuantity: number;
  rawUnit: string;
  rawOrigin: string;
  quotedQuantity: number;
  quotationPercent: number;
  quotationAmount: number;
  unitPrice: number | null;
  reqNotes: string;
  enqNotes: string;
}>;

const CHANGE_LABELS: Record<string, string> = {
  rawCode: 'Code',
  rawDescription: 'Description',
  rawQuantity: 'Quantity',
  quotedQuantity: 'Quantity',
  rawUnit: 'Unit',
  rawOrigin: 'Origin',
  quotationPercent: 'Cotation (%)',
  quotationAmount: 'Cotation (prix)',
  unitPrice: 'Unit Price',
  reqNotes: 'Req notes',
  enqNotes: 'Enq notes',
};

/** Cotation de la ligne en montant par unité : prix retenu moins prix du catalogue (null si la ligne n'est pas chiffrée). */
function marginAmount(item: QuotationItem): number | null {
  return item.base_price !== null && item.unit_price !== null ? Math.round((item.unit_price - item.base_price) * 100) / 100 : null;
}

/** Valeur actuelle de la ligne pour chaque champ qu'une proposition peut modifier (pour afficher « avant → après »). */
function currentValue(item: QuotationItem, key: string): string {
  const raw: Record<string, string | number | null | undefined> = {
    rawCode: item.raw_code,
    rawDescription: item.original_description,
    rawQuantity: item.quantity,
    quotedQuantity: item.quantity,
    rawUnit: item.unit,
    rawOrigin: item.origin,
    quotationPercent: item.margin_percentage,
    quotationAmount: marginAmount(item),
    unitPrice: item.unit_price_manual ?? item.base_price,
    reqNotes: item.req_notes,
    enqNotes: item.enq_notes,
  };
  const value = raw[key];
  return value === null || value === undefined || value === '' ? '·' : String(value);
}

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
 * Lignes de la quotation : No., Code, Description, Quantity, Unit, Unit Price (prix du catalogue ou saisi), Cotation,
 * Final Price (prix unitaire après cotation), Total Price (Final Price × quantité), Correspondance. Le discount est
 * global : il s'applique au total de la commande. Final Price et Total Price sont calculés.
 */
export function LinesTable({
  cotationMode,
  items,
  products,
  currency,
  onEdit,
  countryId,
  onConfirm,
  onDismiss,
  onToggle,
  edits,
  meId,
  isOwner,
  onDecide,
  onWithdraw,
  resetKey,
}: {
  /** Saisie de la cotation des lignes : en pourcentage ou en montant par unité (réglé dans le bloc de tarification). */
  cotationMode: 'percent' | 'price';
  items: QuotationItem[];
  /** Modifications proposées par d'autres utilisateurs, en attente de la décision du propriétaire. */
  edits: PendingEdit[];
  meId: string;
  /** L'utilisateur courant est le propriétaire de la quotation : seul à pouvoir valider / invalider. */
  isOwner: boolean;
  onDecide: (edit: PendingEdit, approve: boolean) => void;
  onWithdraw: (edit: PendingEdit) => void;
  /** Incrémenté après une proposition : les cellules reprennent la valeur actuelle de la ligne. */
  resetKey: number;
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
  const editsByItem = React.useMemo(() => {
    const map = new Map<string, PendingEdit[]>();
    for (const ed of edits) map.set(ed.item_id, [...(map.get(ed.item_id) ?? []), ed]);
    return map;
  }, [edits]);
  const allIncluded = items.length > 0 && items.every((it) => !it.excluded);
  const someIncluded = items.some((it) => !it.excluded);
  // Un fichier client peut compter des centaines de lignes : on n'en dessine que 100 à la fois
  // (cocher « tout » agit toujours sur l'ensemble des lignes).
  const paged = usePage(items, '');
  return (
    <>
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
            <th className="text-right">Cotation</th>
            <th className="text-right">Final Price</th>
            <th className="text-right">Total Price</th>
            <th>Correspondance</th>
          </tr>
        </thead>
        <tbody>
          {paged.slice.map((it) => {
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
                <td><TextCell mono width={96} resetKey={resetKey} value={it.raw_code ?? ''} onCommit={(v) => onEdit(it, { rawCode: v })} /></td>
                <td style={{ minWidth: 280, width: '35%' }}>
                  <TextCell width="100%" resetKey={resetKey} value={it.original_description} onCommit={(v) => onEdit(it, { rawDescription: v })} />
                </td>
                <td className="text-right"><NumberCell width={68} resetKey={resetKey} value={it.quantity} onCommit={(v) => onEdit(it, { rawQuantity: v })} /></td>
                <td><TextCell width={64} resetKey={resetKey} value={it.unit ?? ''} onCommit={(v) => onEdit(it, { rawUnit: v })} /></td>
                <td className="text-right">
                  <NumberCell
                    width={92}
                    resetKey={resetKey}
                    value={it.unit_price_manual}
                    placeholder={priceMissing || it.base_price === null ? 'Prix manquant' : String(it.base_price)}
                    onCommit={(v) => onEdit(it, { unitPrice: v })}
                    onClear={() => onEdit(it, { unitPrice: null })}
                  />
                </td>
                <td className="text-right">
                  {cotationMode === 'percent' ? (
                    <NumberCell width={64} resetKey={resetKey} value={it.margin_percentage} onCommit={(v) => onEdit(it, { quotationPercent: v })} />
                  ) : (
                    <NumberCell width={76} resetKey={resetKey} value={marginAmount(it)} decimals={2} onCommit={(v) => onEdit(it, { quotationAmount: v })} />
                  )}
                </td>
                <td className="text-right mono nowrap">{it.unit_price !== null ? formatAmount(it.unit_price) : '·'}</td>
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
              {(editsByItem.get(it.id) ?? []).map((ed) => (
                <tr key={`edit-${ed.id}`} className="proposal-row proposal-last" style={{ background: 'var(--color-primary-soft)' }}>
                  <td></td>
                  <td className="text-muted" title="Modification proposée, en attente de validation"><Pencil size={13} /></td>
                  <td colSpan={8}>
                    <div style={{ fontSize: 13 }}>
                      <strong>{ed.proposed_by}</strong> propose :{' '}
                      {Object.entries(ed.changes).map(([key, value], i) => (
                        <span key={key}>
                          {i > 0 && ' · '}
                          {CHANGE_LABELS[key] ?? key} :{' '}
                          <span className="text-muted" style={{ textDecoration: 'line-through' }}>{currentValue(it, key)}</span>
                          {' → '}
                          <strong>{value === null || value === '' ? (key === 'unitPrice' ? 'prix du catalogue' : '·') : String(value)}</strong>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {isOwner ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => onDecide(ed, true)} title="Appliquer cette modification à la ligne">
                          <Check size={13} /> Valider
                        </button>
                        <button className="btn btn-sm" onClick={() => onDecide(ed, false)} title="Rejeter cette modification">
                          <X size={13} /> Invalider
                        </button>
                      </div>
                    ) : ed.proposed_by_id === meId ? (
                      <button className="btn btn-sm" onClick={() => onWithdraw(ed)} title="Retirer ma proposition">Retirer</button>
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>En attente du propriétaire</span>
                    )}
                  </td>
                </tr>
              ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
    <Pager page={paged.page} pages={paged.pages} total={paged.total} pageSize={paged.pageSize} setPage={paged.setPage} />
    </>
  );
}
