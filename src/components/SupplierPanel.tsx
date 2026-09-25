import React from 'react';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import { Download, Upload } from 'lucide-react';
import { api, type Doc, type Id } from '../lib/convex';
import { Badge } from './ui';
import { useToast } from './Toast';

const SUPPLIER_STATUS: Record<Doc<'supplierItems'>['status'], { label: string; color: string }> = {
  pending_validation: { label: 'À valider', color: 'var(--badge-warning)' },
  validated: { label: 'Enregistré', color: 'var(--badge-success)' },
  rejected: { label: 'Rejeté', color: 'var(--badge-error)' },
  duplicate: { label: 'Doublon', color: 'var(--badge-neutral)' },
};

/**
 * Aller-retour fournisseur : template Excel des articles inconnus → fichier
 * rempli par le fournisseur → validation des lignes → enregistrement au catalogue
 * (le rematching des lignes de la commande est ensuite automatique et temps réel).
 */
export function SupplierPanel({ orderId, unknownCount }: { orderId: Id<'orders'>; unknownCount: number }) {
  const toast = useToast();
  const convex = useConvex();
  const generateTemplate = useAction(api.extraction.generateSupplierTemplate);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUploadedFile = useMutation(api.files.registerUploadedFile);
  const updateItem = useMutation(api.supplierItems.update);
  const rejectItem = useMutation(api.supplierItems.reject);
  const saveToCatalog = useMutation(api.supplierItems.saveToCatalog);
  const items = useQuery(api.supplierItems.listByOrder, { orderId });
  const files = useQuery(api.files.listByOrder, { orderId });
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const supplierFile = files?.find((f) => f.kind === 'supplier_response');
  const pending = (items ?? []).filter((i) => i.status === 'pending_validation');

  if (unknownCount === 0 && (items ?? []).length === 0) return null;

  const download = async () => {
    setBusy(true);
    try {
      const fileId = await generateTemplate({ orderId });
      const file = (await convex.query(api.files.listByOrder, { orderId })).find((f) => f._id === fileId);
      const url = file ? await convex.query(api.files.getUrl, { storageId: file.storageId }) : null;
      if (!url) throw new Error('Fichier indisponible.');
      window.open(url, '_blank');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error("Échec de l'upload du fichier.");
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
      await registerUploadedFile({ orderId, storageId, kind: 'supplier_response', fileName: file.name, mimeType: file.type, size: file.size });
      toast('Fichier fournisseur importé : analyse en cours…', 'success');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const validateAll = async () => {
    try {
      await saveToCatalog({ supplierItemIds: pending.map((i) => i._id) });
      toast('Articles enregistrés au catalogue.', 'success');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 16 }}>Articles inconnus - fournisseur</h3>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {unknownCount} article(s) à faire chiffrer. Téléchargez le fichier, faites-le remplir, puis réimportez-le.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={download} disabled={busy || unknownCount === 0}><Download size={14} /> Fichier fournisseur</button>
          <button className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={14} /> Importer la réponse</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.pdf,.docx" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </div>
      </div>

      {supplierFile && supplierFile.status === 'error' && (
        <div className="card-pad text-muted" style={{ color: 'var(--badge-error)' }}>
          L'analyse du fichier fournisseur a échoué{supplierFile.extractionError ? ` : ${supplierFile.extractionError}` : '.'}
        </div>
      )}

      {(items ?? []).length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Code</th><th>Nom</th><th>Unité</th><th className="text-right">Prix</th><th>Statut</th><th></th></tr>
              </thead>
              <tbody>
                {(items ?? []).map((it) => {
                  const editable = it.status === 'pending_validation';
                  return (
                    <tr key={it._id}>
                      <td className="mono">
                        {editable
                          ? <input className="input" style={{ width: 110 }} defaultValue={it.rawCode ?? ''} onBlur={(e) => void updateItem({ supplierItemId: it._id, rawCode: e.target.value.trim() || undefined })} />
                          : it.rawCode ?? '-'}
                      </td>
                      <td>
                        {editable
                          ? <input className="input" defaultValue={it.rawName} onBlur={(e) => void updateItem({ supplierItemId: it._id, rawName: e.target.value.trim() })} />
                          : it.rawName}
                      </td>
                      <td>
                        {editable
                          ? <input className="input" style={{ width: 80 }} defaultValue={it.rawUnit ?? ''} onBlur={(e) => void updateItem({ supplierItemId: it._id, rawUnit: e.target.value.trim() || undefined })} />
                          : it.rawUnit ?? '-'}
                      </td>
                      <td className="text-right mono">
                        {editable
                          ? <input className="input" type="number" step="any" style={{ width: 110 }} defaultValue={it.rawPrice ?? ''} onBlur={(e) => void updateItem({ supplierItemId: it._id, rawPrice: e.target.value === '' ? undefined : Number(e.target.value) })} />
                          : it.rawPrice ?? '-'}
                      </td>
                      <td><Badge label={SUPPLIER_STATUS[it.status].label} color={SUPPLIER_STATUS[it.status].color} /></td>
                      <td>
                        {editable && <button className="btn btn-ghost btn-sm" onClick={() => void rejectItem({ supplierItemId: it._id })}>Rejeter</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pending.length > 0 && (
            <div style={{ padding: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={validateAll}>Enregistrer {pending.length} article(s) au catalogue</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
