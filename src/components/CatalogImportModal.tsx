import React from 'react';
import { useAction, useConvex, useMutation } from 'convex/react';
import { Check, PlusCircle, RefreshCw, UploadCloud } from 'lucide-react';
import type { Country } from '../types';
import { api, type Id } from '../lib/convex';
import { formatPrice } from '../lib/format';
import { Modal } from './ui';
import { useToast } from './Toast';

interface Row {
  code?: string;
  name: string;
  description?: string;
  unit?: string;
  price?: number;
  // Résultat de l'analyse serveur (mêmes règles que l'import réel)
  existingName?: string;
  existingCode?: string;
  currentPrice?: number;
}

const BATCH = 200;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Import du catalogue depuis un fichier (Excel/PDF/Word), comme pour une demande
 * de cotation : import → analyse serveur → aperçu (nouveaux / existants) → validation.
 */
export function CatalogImportModal({
  countries,
  onClose,
}: {
  countries: Country[];
  onClose: () => void;
}) {
  const toast = useToast();
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const analyze = useAction(api.catalogImport.analyzeCatalogFile);
  const importCatalog = useMutation(api.products.importCatalog);

  const [countryId, setCountryId] = React.useState(countries[0]?.id ?? '');
  const [fileName, setFileName] = React.useState('');
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Lignes cochées (par index) ; par défaut, toutes celles qui changent quelque chose.
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const country = countries.find((c) => c.id === countryId);

  const readFile = async (file: File) => {
    setBusy(true);
    setFileName(file.name);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error("Échec de l'upload du fichier.");
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
      const result = await analyze({ storageId, mimeType: file.type, countryId: countryId ? (countryId as Id<'countries'>) : undefined });
      setRows(result);
      setSelected(new Set(result.flatMap((r, i) => (r.existingName === undefined || (r.price !== undefined && r.currentPrice !== r.price) ? [i] : []))));
    } catch (err) {
      setRows(null);
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Statut de chaque ligne, calculé côté serveur pendant l'analyse.
  const analysed = (rows ?? []).map((row) => ({
    row,
    existing: row.existingName !== undefined,
    priceChange: row.price !== undefined && row.currentPrice !== row.price,
  }));

  const chosen = analysed.filter((_, i) => selected.has(i));
  const newCount = chosen.filter((a) => !a.existing).length;
  const priceCount = chosen.filter((a) => a.priceChange).length;
  const allChecked = analysed.length > 0 && selected.size === analysed.length;

  // Édition d'une cellule : on met à jour la ligne puis on re-vérifie côté serveur
  // (un code ou un nom modifié peut la faire correspondre - ou non - à un produit existant).
  const editRow = async (i: number, patch: Partial<Row>) => {
    if (!rows) return;
    const updated = { ...rows[i], ...patch };
    setRows((prev) => prev && prev.map((r, idx) => (idx === i ? updated : r)));
    if (!updated.name.trim()) {
      setSelected((prev) => { const next = new Set(prev); next.delete(i); return next; });
      return;
    }
    // Corriger une ligne = vouloir l'importer : on la coche.
    setSelected((prev) => new Set(prev).add(i));
    if ('code' in patch || 'name' in patch) {
      try {
        const [m] = await convex.query(api.products.previewCatalogRows, {
          countryId: countryId ? (countryId as Id<'countries'>) : undefined,
          rows: [{ code: updated.code, name: updated.name }],
        });
        setRows((prev) => prev && prev.map((r, idx) => (idx === i ? { ...r, ...m } : r)));
      } catch (err) {
        toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
      }
    }
  };

  const toggleRow = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(analysed.map((_, i) => i)));

  const confirm = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      let created = 0;
      let pricesSet = 0;
      const toImport = rows.filter((_, i) => selected.has(i));
      for (let i = 0; i < toImport.length; i += BATCH) {
        const res = await importCatalog({
          countryId: countryId ? (countryId as Id<'countries'>) : undefined,
          rows: toImport.slice(i, i + BATCH).map(({ code, name, description, unit, price }) => ({ code, name, description, unit, price })),
        });
        created += res.created;
        pricesSet += res.pricesSet;
      }
      toast(`Import terminé : ${created} produit(s) créé(s), ${pricesSet} prix enregistré(s).`, 'success');
      onClose();
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Importer un catalogue"
      wide={!!rows}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          {rows && (
            <button className="btn btn-primary" onClick={confirm} disabled={busy || selected.size === 0}>
              {busy ? <><span className="spinner-inline" /> Import en cours…</> : `Importer ${selected.size} ligne(s) (${newCount} nouveau(x), ${priceCount} prix)`}
            </button>
          )}
        </>
      }
    >
      <div className="form-field">
        <label>Pays des prix du fichier</label>
        <select className="select" value={countryId} disabled={!!rows || busy} onChange={(e) => setCountryId(e.target.value)}>
          {countries.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
        </select>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          Les colonnes reconnues : code/IMPA, nom, unité, prix (les intitulés peuvent varier).
        </div>
      </div>

      {!rows && (
        <div
          className={`upload-zone ${dragging ? 'dragging' : ''}`}
          onClick={() => !busy && fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !busy) void readFile(f); }}
        >
          {busy ? <div className="spinner" /> : <div className="upload-icon"><UploadCloud size={28} /></div>}
          <h3>{busy ? 'Analyse du fichier en cours…' : fileName || 'Glissez un fichier ici'}</h3>
          <p>{busy ? `${fileName} - extraction des produits et comparaison avec le catalogue` : 'Cliquez ou déposez un fichier Excel, PDF ou Word'}</p>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.pdf,.docx" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
        </div>
      )}

      {rows && busy && (
        <div className="busy-overlay">
          <div className="spinner" />
          <h3>Import en cours…</h3>
          <p className="text-muted">Enregistrement des produits et des prix, ne fermez pas cette fenêtre.</p>
        </div>
      )}

      {rows && (
        <div className="fill">
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
            {fileName} - {rows.length} ligne(s) : {analysed.filter((a) => !a.existing).length} nouveau(x), {analysed.filter((a) => a.existing).length} déjà au catalogue - {selected.size} sélectionnée(s).
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setRows(null)}>Changer de fichier</button>
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Tout sélectionner" /></th><th>Code</th><th>Nom</th><th>Unité</th><th className="text-right">Prix</th><th></th></tr></thead>
              <tbody>
                {analysed.map(({ row, existing, priceChange }, i) => (
                  <tr key={i} style={selected.has(i) ? undefined : { opacity: 0.5 }}>
                    <td><input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} aria-label={`Sélectionner ${row.name}`} /></td>
                    <td>
                      <input className="input cell-input mono" style={{ width: 110 }} defaultValue={row.code ?? ''}
                        onBlur={(e) => { const v = e.target.value.trim() || undefined; if (v !== row.code) void editRow(i, { code: v }); }} />
                    </td>
                    <td style={{ width: '100%', minWidth: 380 }}>
                      <input className="input cell-input" style={{ width: '100%' }} defaultValue={row.name}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== row.name) void editRow(i, { name: v }); }} />
                      {existing && <div className="text-muted" style={{ fontSize: 12 }}>= {row.existingCode ? `${row.existingCode} - ` : ''}{row.existingName}</div>}
                    </td>
                    <td>
                      <input className="input cell-input" style={{ width: 70 }} defaultValue={row.unit ?? ''}
                        onBlur={(e) => { const v = e.target.value.trim() || undefined; if (v !== row.unit) void editRow(i, { unit: v }); }} />
                    </td>
                    <td className="text-right">
                      <input className="input cell-input mono" style={{ width: 110, textAlign: 'right' }} inputMode="decimal"
                        defaultValue={row.price !== undefined ? row.price.toFixed(2) : ''} placeholder={row.currentPrice !== undefined ? `actuel ${row.currentPrice}` : ''}
                        onBlur={(e) => {
                          const raw = e.target.value.trim().replace(',', '.');
                          const v = raw === '' ? undefined : Number(raw);
                          if (v !== undefined && (!Number.isFinite(v) || v < 0)) { toast('Prix invalide.', 'error'); e.target.value = row.price !== undefined ? row.price.toFixed(2) : ''; return; }
                          const rounded = v === undefined ? undefined : round2(v);
                          e.target.value = rounded !== undefined ? rounded.toFixed(2) : '';
                          if (rounded !== row.price) void editRow(i, { price: rounded });
                        }} />
                    </td>
                    <td>
                      {!existing ? (
                        <span className="tag tag-new"><PlusCircle size={13} /> Nouveau</span>
                      ) : priceChange ? (
                        <span className="tag tag-update"><RefreshCw size={13} /> Prix modifié</span>
                      ) : (
                        <span className="tag tag-same"><Check size={13} /> Inchangé</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
