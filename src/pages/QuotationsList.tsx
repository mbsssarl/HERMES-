import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useMutation } from 'convex/react';
import { api } from '../lib/convex';
import { useToast } from '../components/Toast';
import type { QuotationWithRelations } from '../types';
import { formatAmount, formatDate, regionLabel } from '../lib/format';
import { StatusTag } from '../components/StatusTag';
import { UpdateBadge } from '../components/UpdateBadge';
import { ClientCell } from '../components/ClientCell';
import { Badge, Modal, StateBox } from '../components/ui';
import { useT } from '../lib/i18n';

export function QuotationsList({
  quotations,
  deletedQuotations,
  loading,
  isAdmin,
  onOpen,
  onNew,
}: {
  quotations: QuotationWithRelations[];
  deletedQuotations: QuotationWithRelations[];
  loading: boolean;
  isAdmin: boolean;
  onOpen: (q: QuotationWithRelations) => void;
  onNew: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const purgeDeleted = useMutation(api.orders.purgeDeleted);
  const [confirmPurge, setConfirmPurge] = React.useState(false);
  const [purging, setPurging] = React.useState(false);
  const [filter, setFilter] = React.useState<string>('ALL');
  const filters: Array<{ id: string; label: string }> = [
    { id: 'ALL', label: t('list.filterAll') },
    { id: 'PO', label: 'PO' },
    { id: 'CANCELLED', label: t('status.CANCELLED') },
    { id: 'DELETED', label: t('list.trash') },
  ];
  const filtered =
    filter === 'DELETED' ? deletedQuotations
    : filter === 'ALL' ? quotations
    : quotations.filter((q) => q.status === filter);

  // Supprime définitivement tout ce qui est dans la corbeille, par paquets (limite de taille d'une transaction).
  const emptyTrash = async () => {
    setPurging(true);
    try {
      let purged = 0;
      for (;;) {
        const res = await purgeDeleted({});
        purged += res.purged;
        if (res.remaining === 0 || res.purged === 0) break;
      }
      toast(t('list.purged', { n: purged }), 'success');
      setConfirmPurge(false);
      setFilter('ALL');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setPurging(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Quotations</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {isAdmin && (
            <button className="btn" onClick={() => setConfirmPurge(true)} disabled={deletedQuotations.length === 0}>
              <Trash2 size={16} /> {t('list.emptyTrash')}{deletedQuotations.length > 0 ? ` (${deletedQuotations.length})` : ''}
            </button>
          )}
          <button className="btn btn-primary" onClick={onNew}><Plus size={16} /> {t('common.newQuotation')}</button>
        </div>
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
          <StateBox loading variant="table" title={t('common.loading')} />
        ) : filtered.length === 0 ? (
          <StateBox title={t('common.noQuotation')} subtitle={t('list.emptyFilter')} />
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
                {filtered.map((q) => (
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
          </div>
        )}
      </div>

      {confirmPurge && (
        <Modal
          title={t('list.purgeTitle')}
          onClose={() => !purging && setConfirmPurge(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirmPurge(false)} disabled={purging}>{t('common.cancel')}</button>
            <button className="btn btn-primary" style={{ background: '#dc2626' }} onClick={() => void emptyTrash()} disabled={purging}>
              {purging ? t('list.purging') : t('list.purgeConfirm')}
            </button>
          </>}
        >
          <p>{t('list.purgeBody', { n: deletedQuotations.length })}</p>
        </Modal>
      )}
    </div>
  );
}
