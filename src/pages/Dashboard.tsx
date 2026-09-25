import React from 'react';
import { CheckCircle2, Clock, FileText, TrendingUp } from 'lucide-react';
import type { QuotationWithRelations } from '../types';
import { formatAmount, formatDate } from '../lib/format';
import { StatusTag } from '../components/StatusTag';

export function Dashboard({
  quotations,
  loading,
  onOpen,
  onNew,
}: {
  quotations: QuotationWithRelations[];
  loading: boolean;
  onOpen: (q: QuotationWithRelations) => void;
  onNew: () => void;
}) {
  const today = new Date().toDateString();
  const todayCount = quotations.filter((q) => new Date(q.created_at).toDateString() === today).length;
  // À vérifier : des lignes restent inconnues / à confirmer (hors quotations déjà en PO ou archivées)
  const open = quotations.filter((q) => q.status !== 'PO' && q.status !== 'CANCELLED');
  const toCheck = open.filter((q) => q.unresolved_count > 0).length;
  const unresolvedLines = open.reduce((s, q) => s + q.unresolved_count, 0);
  const po = quotations.filter((q) => q.status === 'PO');
  const poValue = po.reduce((s, q) => s + (q.total ?? 0), 0);
  const recent = quotations.slice(0, 6);

  const stats = [
    { label: 'Quotations du jour', value: String(todayCount), icon: <FileText size={18} />, trend: `${quotations.length} au total` },
    { label: 'À vérifier', value: String(toCheck), icon: <Clock size={18} />, trend: `${unresolvedLines} ligne(s) à traiter` },
    { label: 'PO reçus', value: String(po.length), icon: <CheckCircle2 size={18} />, trend: 'Approuvées par le client' },
    { label: 'Valeur des PO', value: formatAmount(poValue), icon: <TrendingUp size={18} />, trend: 'Total des PO reçus' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-subtitle">Vue d’ensemble des quotations en cours et terminées.</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>+ Nouvelle quotation</button>
      </div>

      <div className="stats-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="stat-label">{s.label}</span>
              <span style={{ color: 'var(--color-primary)' }}>{s.icon}</span>
            </div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-trend">{s.trend}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ fontSize: 16 }}>Quotations récentes</h3>
        </div>
        {loading ? (
          <div className="state-box"><div className="spinner" /></div>
        ) : recent.length === 0 ? (
          <div className="state-box"><h3>Aucune quotation</h3><p>Commencez par importer une demande client.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Client</th>
                  <th>Pays</th>
                  <th>Statut</th>
                  <th className="text-right">Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((q) => (
                  <tr key={q.id} className="clickable" onClick={() => onOpen(q)}>
                    <td className="mono" style={{ fontWeight: 700 }}>{q.quotation_number}</td>
                    <td>{q.customer_name}</td>
                    <td>{q.countries?.name ?? '-'}</td>
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
