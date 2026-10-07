import React from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Eye, RotateCcw, Trash2 } from 'lucide-react';
import { api, type Id } from '../lib/convex';
import type { Country } from '../types';
import { formatAmount, formatDate } from '../lib/format';
import { Modal, StateBox } from '../components/ui';
import { useToast } from '../components/Toast';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Copie de sécurité des produits supprimés : consulter, restaurer dans le catalogue, ou supprimer pour de bon
 * (c'est la seule façon d'effacer réellement un produit).
 */
export function BackupsTab({ countries }: { countries: Country[] }) {
  const toast = useToast();
  const data = useQuery(api.productBackups.list);
  const restore = useMutation(api.productBackups.restore);
  const purge = useMutation(api.productBackups.purge);
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [viewId, setViewId] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<{ kind: 'restore' | 'purge'; ids: string[] } | null>(null);
  const [working, setWorking] = React.useState(false);

  const term = search.trim().toLowerCase();
  const items = (data?.items ?? []).filter((b) => !term || `${b.name} ${b.code}`.toLowerCase().includes(term));
  const allChecked = items.length > 0 && items.every((b) => selected.has(b._id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    if (!confirm) return;
    setWorking(true);
    try {
      let done = 0;
      for (let i = 0; i < confirm.ids.length; i += 50) {
        const chunk = confirm.ids.slice(i, i + 50) as Id<'productBackups'>[];
        if (confirm.kind === 'restore') done += (await restore({ backupIds: chunk })).restored;
        else done += (await purge({ backupIds: chunk })).purged;
      }
      toast(
        confirm.kind === 'restore' ? `${done} produit(s) restauré(s) dans le catalogue.` : `${done} sauvegarde(s) supprimée(s) définitivement.`,
        'success',
      );
      setSelected(new Set());
      setConfirm(null);
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setWorking(false);
    }
  };

  if (data === undefined) return <StateBox loading title="Chargement…" />;

  return (
    <>
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 16 }}>Produits supprimés</h3>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {data.total} sauvegarde(s){data.total > data.items.length ? ` (les ${data.items.length} plus récentes sont affichées)` : ''}. Copie de sécurité : restaurez ou supprimez définitivement.
            </span>
          </div>
          <input className="input" style={{ width: 260 }} placeholder="Rechercher (nom, code)…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {selected.size > 0 && (
          <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--color-surface-2)' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{selected.size} sélectionné(s)</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setConfirm({ kind: 'restore', ids: [...selected] })}><RotateCcw size={14} /> Restaurer ({selected.size})</button>
              <button className="btn btn-sm btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => setConfirm({ kind: 'purge', ids: [...selected] })}>
                <Trash2 size={14} /> Supprimer définitivement ({selected.size})
              </button>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <StateBox title="Aucune sauvegarde" subtitle="Les produits supprimés apparaîtront ici." />
        ) : (
          <div className="table-scroll" style={{ maxHeight: '62vh', border: 'none', borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((b) => b._id)))} aria-label="Tout sélectionner" />
                  </th>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Unit</th>
                  <th className="text-right">Prix</th>
                  <th>Supprimé le</th>
                  <th>Par</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b._id} style={selected.has(b._id) ? { background: 'var(--color-primary-soft)' } : undefined}>
                    <td><input type="checkbox" checked={selected.has(b._id)} onChange={() => toggle(b._id)} aria-label={`Sélectionner ${b.name}`} /></td>
                    <td className="mono">{b.code || '-'}</td>
                    <td style={{ minWidth: 260 }}>{b.name}</td>
                    <td className="text-muted">{b.unit}</td>
                    <td className="text-right mono">{b.priceCount}</td>
                    <td className="text-muted nowrap">{formatDate(new Date(b.deletedAt).toISOString())}</td>
                    <td className="text-muted">{b.deletedBy || '-'}</td>
                    <td className="text-right nowrap">
                      <button className="btn btn-ghost btn-sm" title="Consulter" onClick={() => setViewId(b._id)}><Eye size={14} /></button>
                      <button className="btn btn-ghost btn-sm" title="Restaurer" onClick={() => setConfirm({ kind: 'restore', ids: [b._id] })}><RotateCcw size={14} /></button>
                      <button className="btn btn-ghost btn-sm" title="Supprimer définitivement" onClick={() => setConfirm({ kind: 'purge', ids: [b._id] })}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewId && <BackupView backupId={viewId} countries={countries} onClose={() => setViewId(null)} />}

      {confirm && (
        <Modal
          title={confirm.kind === 'restore' ? 'Restaurer dans le catalogue ?' : 'Supprimer définitivement ?'}
          onClose={() => !working && setConfirm(null)}
          footer={<>
            <button className="btn" onClick={() => setConfirm(null)} disabled={working}>Annuler</button>
            <button
              className="btn btn-primary"
              style={confirm.kind === 'purge' ? { background: '#dc2626', borderColor: '#dc2626' } : undefined}
              onClick={() => void run()}
              disabled={working}
            >
              {working ? 'En cours…' : confirm.kind === 'restore' ? `Restaurer ${confirm.ids.length} produit(s)` : `Supprimer ${confirm.ids.length} définitivement`}
            </button>
          </>}
        >
          {confirm.kind === 'restore' ? (
            <>
              <p><strong>{confirm.ids.length} produit(s)</strong> seront remis dans le catalogue avec leurs prix.</p>
              <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
                Les quotations dont des lignes attendent un produit pourront les reconnaître à nouveau.
              </p>
            </>
          ) : (
            <>
              <p><strong>{confirm.ids.length} sauvegarde(s)</strong> seront effacées pour de bon.</p>
              <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
                Cette action est irréversible : les produits ne pourront plus être récupérés.
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/** Contenu détaillé d'une sauvegarde : fiche du produit et lignes de prix (historique compris). */
function BackupView({ backupId, countries, onClose }: { backupId: string; countries: Country[]; onClose: () => void }) {
  const b = useQuery(api.productBackups.get, { backupId: backupId as Id<'productBackups'> });
  const codeOf = (id: unknown) => countries.find((c) => c.id === id)?.code ?? '?';
  return (
    <Modal title="Produit sauvegardé" wide onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Fermer</button>}>
      {b === undefined ? (
        <StateBox loading title="Chargement…" />
      ) : b === null ? (
        <StateBox title="Sauvegarde introuvable" />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="form-field"><label>Code</label><input className="input cell-readonly" readOnly value={String(b.product.impaId ?? b.product.code ?? '')} /></div>
            <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Description</label><input className="input cell-readonly" readOnly value={String(b.product.name ?? '')} /></div>
            <div className="form-field"><label>Unit</label><input className="input cell-readonly" readOnly value={String(b.product.unit ?? '')} /></div>
          </div>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Supprimé le {formatDate(new Date(b.deletedAt).toISOString())} par {b.deletedBy || '-'}.
          </p>
          <div className="section-title">Prix ({b.prices.length})</div>
          {b.prices.length === 0 ? (
            <p className="text-muted">Aucun prix enregistré.</p>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Pays</th><th className="text-right">Prix</th><th>Devise</th><th>Depuis</th><th>Jusqu&apos;au</th></tr>
              </thead>
              <tbody>
                {[...b.prices].sort((x, y) => Number(y.validFrom ?? 0) - Number(x.validFrom ?? 0)).map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{codeOf(p.countryId)}</td>
                    <td className="text-right mono">{formatAmount(Number(p.price))}</td>
                    <td>{String(p.currency ?? '')}</td>
                    <td className="text-muted nowrap">{p.validFrom ? formatDate(new Date(Number(p.validFrom)).toISOString()) : '-'}</td>
                    <td className="text-muted nowrap">{p.validTo ? formatDate(new Date(Number(p.validTo)).toISOString()) : 'en cours'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  );
}
