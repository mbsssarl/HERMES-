import React from 'react';
import { ArrowRight, CheckCircle2, Clock, FileText, TrendingUp } from 'lucide-react';
import type { QuotationWithRelations } from '../types';
import { formatAmount, formatDate, regionLabel } from '../lib/format';
import { StatusTag } from '../components/StatusTag';
import { UpdateBadge } from '../components/UpdateBadge';
import { ClientCell } from '../components/ClientCell';
import { TableSkeleton } from '../components/ui';
import { useT } from '../lib/i18n';

export function Dashboard({
  quotations,
  loading,
  onOpen,
  onNew,
  onSeeAll,
}: {
  quotations: QuotationWithRelations[];
  loading: boolean;
  onOpen: (q: QuotationWithRelations) => void;
  onNew: () => void;
  /** Ouvre l'onglet Quotations, où elles sont toutes. */
  onSeeAll: () => void;
}) {
  const t = useT();
  const today = new Date().toDateString();
  const todayCount = quotations.filter((q) => new Date(q.created_at).toDateString() === today).length;
  // À vérifier : des lignes restent inconnues / à confirmer (hors quotations déjà en PO ou archivées)
  const open = quotations.filter((q) => q.status !== 'PO' && q.status !== 'CANCELLED');
  const toCheck = open.filter((q) => q.unresolved_count > 0).length;
  const unresolvedLines = open.reduce((s, q) => s + q.unresolved_count, 0);
  const po = quotations.filter((q) => q.status === 'PO');
  const poValue = po.reduce((s, q) => s + (q.total ?? 0), 0);
  const RECENT_LIMIT = 6;
  const recent = quotations.slice(0, RECENT_LIMIT);

  const stats = [
    { label: t('dashboard.today'), value: String(todayCount), icon: <FileText size={18} />, trend: t('dashboard.inTotal', { n: quotations.length }) },
    { label: t('dashboard.toCheck'), value: String(toCheck), icon: <Clock size={18} />, trend: t('dashboard.linesToProcess', { n: unresolvedLines }) },
    { label: t('dashboard.poReceived'), value: String(po.length), icon: <CheckCircle2 size={18} />, trend: t('dashboard.approved') },
    { label: t('dashboard.poValue'), value: formatAmount(poValue), icon: <TrendingUp size={18} />, trend: t('dashboard.poTotal') },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard.title')}</h1>
        </div>
        <button className="btn btn-primary" onClick={onNew}>+ {t('common.newQuotation')}</button>
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
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3 style={{ fontSize: 16 }}>{t('dashboard.recent')}</h3>
          {quotations.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={onSeeAll}>
              {t('dashboard.seeAll')} <ArrowRight size={14} />
            </button>
          )}
        </div>
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : recent.length === 0 ? (
          <div className="state-box"><h3>{t('common.noQuotation')}</h3><p>{t('dashboard.empty')}</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data list">
              <thead>
                <tr>
                  <th style={{ width: 185 }}>{t('common.reference')}</th>
                  <th>{t('common.client')}</th>
                  <th style={{ width: 150 }}>{t('common.region')}</th>
                  <th style={{ width: 160 }}>{t('common.status')}</th>
                  <th className="text-right" style={{ width: 110 }}>{t('common.total')}</th>
                  <th style={{ width: 170 }}>{t('common.date')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((q) => (
                  <tr key={q.id} className="clickable" onClick={() => onOpen(q)}>
                    <td><div className="cell-ref"><span className="mono ref">{q.quotation_number}</span><UpdateBadge update={q.catalog_update} compact /></div></td>
                    <td><ClientCell name={q.customer_name} /></td>
                    <td className="cell-ellipsis" title={q.countries ? regionLabel(q.countries) : undefined}>{q.countries ? regionLabel(q.countries) : '·'}</td>
                    <td><StatusTag status={q.status} /></td>
                    <td className="text-right mono">{formatAmount(q.total)}</td>
                    <td className="text-muted nowrap">{formatDate(q.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {quotations.length > RECENT_LIMIT && (
              <div style={{ padding: '4px 16px 16px' }}>
                <button className="btn btn-sm" onClick={onSeeAll}>
                  {t('dashboard.seeAllCount', { n: quotations.length })} <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
