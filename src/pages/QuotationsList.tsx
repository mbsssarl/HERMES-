import React from 'react';
import { Plus } from 'lucide-react';
import type { QuotationWithRelations } from '../types';
import { formatAmount, formatDate } from '../lib/format';
import { StatusTag } from '../components/StatusTag';
import { Badge, StateBox } from '../components/ui';

export function QuotationsList({
  quotations,
  deletedQuotations,
  loading,
  onOpen,
  onNew,
}: {
  quotations: QuotationWithRelations[];
  deletedQuotations: QuotationWithRelations[];
  loading: boolean;
  onOpen: (q: QuotationWithRelations) => void;
  onNew: () => void;
}) {
  const [filter, setFilter] = React.useState<string>('ALL');
  const filters: Array<{ id: string; label: string }> = [
    { id: 'ALL', label: 'Tout' },
    { id: 'PO', label: 'PO' },
    { id: 'CANCELLED', label: 'Archivé' },
    { id: 'DELETED', label: 'Supprimé' },
  ];
  const filtered =
    filter === 'DELETED' ? deletedQuotations
    : filter === 'ALL' ? quotations
    : quotations.filter((q) => q.status === filter);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Quotations</h1>
          <p className="page-subtitle">Historique des demandes client traitées par l’application.</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}><Plus size={16} /> Nouvelle quotation</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {filters.map((f) => (
          <button
            key={f.id}
            className={`btn btn-sm ${filter === f.id ? 'btn-primary' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <StateBox loading title="Chargement…" />
        ) : filtered.length === 0 ? (
          <StateBox title="Aucune quotation" subtitle="Aucune quotation ne correspond à ce filtre." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Client</th>
                  <th>Pays</th>
                  <th>Lignes</th>
                  <th>Statut</th>
                  <th className="text-right">Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id} className="clickable" onClick={() => onOpen(q)}>
                    <td className="mono" style={{ fontWeight: 700 }}>{q.quotation_number}</td>
                    <td>{q.customer_name}</td>
                    <td>{q.countries?.name ?? '-'}</td>
                    <td className="text-muted">{q.quotation_items?.length ?? 0}</td>
                    <td><StatusTag status={q.status} /></td>
                    <td className="text-right mono">{formatAmount(q.total)}</td>
                    <td className="text-muted nowrap">{formatDate(q.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
