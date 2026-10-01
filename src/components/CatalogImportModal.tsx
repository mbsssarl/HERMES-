import React from 'react';
import { useAction, useConvex, useMutation } from 'convex/react';
import { Check, ChevronDown, ChevronUp, Link2, PlusCircle, RefreshCw, UploadCloud, Unlink } from 'lucide-react';
import type { Country, Currency } from '../types';
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
  // Comment le produit trouvé (s'il y en a un) a été trouvé. "code" fait autorité (toujours lié). "name" est
  // une simple ressemblance de nom, pas fiable : par défaut traité comme distinct, sauf si l'utilisateur choisit
  // de le lier (voir `forceNewOverride`).
  matchedBy?: 'code' | 'name' | null;
  duplicate?: boolean; // même code qu'une ligne précédente du fichier
  groupOf?: number; // index de la première ligne de ce produit (elle-même si elle n'a pas de code)
}

const BATCH = 200;
const round2 = (n: number) => Math.round(n * 100) / 100;
// Même règle que côté serveur (convex/lib/normalize.ts) : deux codes ne diffèrent que par la ponctuation
// ("23.30-34" / "233034") comptent comme identiques.
const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
const sameRow = (a: Row, b: Row) =>
  normalizeCode(a.code ?? '') === normalizeCode(b.code ?? '') &&
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
  (a.unit ?? '').toLowerCase() === (b.unit ?? '').toLowerCase() &&
  a.price === b.price;

/**
 * Import du catalogue depuis un fichier (Excel/PDF/Word), comme pour une demande
 * de cotation : import → analyse serveur → aperçu (nouveaux / existants) → validation.
 */
export function CatalogImportModal({
  countries,
  currencies,
  onClose,
}: {
  countries: Country[];
  currencies: Currency[];
  onClose: () => void;
}) {
  const toast = useToast();
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const analyze = useAction(api.catalogImport.analyzeCatalogFile);
  const importCatalog = useMutation(api.products.importCatalog);

  const [countryId, setCountryId] = React.useState(countries[0]?.id ?? '');
  // Devise des prix du fichier, entièrement indépendante du pays choisi (ex. fichier fournisseur reçu en
  // USD pour un pays habituellement tarifé en XAF) - aucune valeur par défaut déduite du pays.
  const [currency, setCurrency] = React.useState(currencies.find((c) => c.active)?.code ?? '');
  const [fileName, setFileName] = React.useState('');
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [stats, setStats] = React.useState<{ sheets: number; read: number; ignored: number; duplicates: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Lignes cochées (par index) ; par défaut, toutes celles qui changent quelque chose.
  // Les doublons sont regroupés sous la première ligne de leur produit. `selected` contient les lignes de tête
  // (groupes cochés) ; `pick[tête]` = la ligne du groupe qui sera réellement importée (par défaut la tête).
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [pick, setPick] = React.useState<Record<number, number>>({});
  const [open, setOpen] = React.useState<Set<number>>(new Set());
  // Une ligne dont la seule correspondance trouvée est par le nom (pas de code) est traitée comme un produit
  // distinct par défaut ; l'utilisateur peut explicitement la lier au produit trouvé, ou délier après coup.
  const [forceNewOverride, setForceNewOverride] = React.useState<Record<number, boolean>>({});
  const isForceNew = React.useCallback(
    (i: number) => forceNewOverride[i] ?? rows![i].matchedBy === 'name',
    [forceNewOverride, rows],
  );
  const isLinked = React.useCallback((i: number) => rows![i].existingName !== undefined && !isForceNew(i), [isForceNew, rows]);
  const [onlyNoPrice, setOnlyNoPrice] = React.useState(false); // n'afficher que les produits sans prix
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
      setRows(result.rows);
      setStats(result.stats);
      setPick({});
      setOpen(new Set());
      // Pré-cochées par défaut : les nouveaux produits (aucune correspondance, ou correspondance par le seul nom -
      // pas liée d'office) et les correspondances par code dont le prix change.
      setSelected(new Set(result.rows.flatMap((r, i) => {
        if (r.duplicate) return [];
        const linked = r.existingName !== undefined && r.matchedBy !== 'name';
        const priceChange = linked && r.price !== undefined && r.currentPrice !== r.price;
        return !linked || priceChange ? [i] : [];
      })));
    } catch (err) {
      setRows(null);
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Groupes de doublons : têtes de groupe dans l'ordre du fichier, avec leurs membres.
  const groups = React.useMemo(() => {
    const map = new Map<number, number[]>();
    (rows ?? []).forEach((r, i) => {
      const root = r.groupOf ?? i;
      map.set(root, [...(map.get(root) ?? []), i]);
    });
    return [...map.entries()].map(([root, members]) => ({ root, members }));
  }, [rows]);
  const activeOf = (root: number) => pick[root] ?? root;

  // Statut de la ligne retenue de chaque groupe : "existing" tient compte de forceNew - une correspondance par
  // le seul nom, non liée explicitement, compte comme "nouveau produit", pas comme "existant".
  const status = (i: number) => {
    const r = rows![i];
    const linked = isLinked(i);
    return { existing: linked, priceChange: linked && r.price !== undefined && r.currentPrice !== r.price };
  };

  const chosenGroups = groups.filter((g) => selected.has(g.root));
  const newCount = chosenGroups.filter((g) => !status(activeOf(g.root)).existing).length;
  const priceCount = chosenGroups.filter((g) => status(activeOf(g.root)).priceChange).length;
  const hasNoPrice = (root: number) => rows![activeOf(root)].price === undefined;
  const noPriceCount = groups.filter((g) => hasNoPrice(g.root)).length;
  const visibleGroups = onlyNoPrice ? groups.filter((g) => hasNoPrice(g.root)) : groups;
  // La case d'en-tête agit sur les produits affichés (utile pour tout décocher les produits sans prix d'un coup).
  const allChecked = visibleGroups.length > 0 && visibleGroups.every((g) => selected.has(g.root));
  const duplicateRows = (rows ?? []).filter((r) => r.duplicate).length;
  // Doublons strictement identiques à leur ligne de tête (même code, nom, unité et prix) : fusionnés sans rien demander.
  const identicalRows = groups.reduce((n, g) => n + g.members.filter((m) => m !== g.root && sameRow(rows![m], rows![g.root])).length, 0);

  // Édition d'une cellule : on met à jour la ligne puis on re-vérifie côté serveur
  // (un code ou un nom modifié peut la faire correspondre - ou non - à un produit existant).
  const editRow = async (i: number, patch: Partial<Row>) => {
    if (!rows) return;
    const updated = { ...rows[i], ...patch };
    setRows((prev) => prev && prev.map((r, idx) => (idx === i ? updated : r)));
    const head = rows[i].groupOf ?? i;
    if (!updated.name.trim()) {
      setSelected((prev) => { const next = new Set(prev); next.delete(head); return next; });
      return;
    }
    // Corriger une ligne = vouloir l'importer : on coche son groupe.
    setSelected((prev) => new Set(prev).add(head));
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
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const g of visibleGroups) {
        if (allChecked) next.delete(g.root);
        else next.add(g.root);
      }
      return next;
    });
  const toggleOpen = (root: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });

  const confirm = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      let created = 0;
      let pricesSet = 0;
      const toImport = groups
        .filter((g) => selected.has(g.root))
        .map((g) => activeOf(g.root))
        .map((i) => ({ ...rows[i], forceNew: rows[i].matchedBy === 'name' ? isForceNew(i) : undefined }));
      for (let i = 0; i < toImport.length; i += BATCH) {
        const res = await importCatalog({
          countryId: countryId ? (countryId as Id<'countries'>) : undefined,
          currency: currency || undefined,
          rows: toImport.slice(i, i + BATCH).map(({ code, name, description, unit, price, forceNew }) => ({ code, name, description, unit, price, forceNew })),
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
            <button className="btn btn-primary" onClick={confirm} disabled={busy || selected.size === 0 || (priceCount > 0 && !currency)} title={priceCount > 0 && !currency ? 'Choisissez la devise des prix du fichier.' : undefined}>
              {busy ? <><span className="spinner-inline" /> Import en cours…</> : `Importer ${selected.size} produit(s) (${newCount} nouveau(x), ${priceCount} prix)`}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
          <label>Pays des prix du fichier</label>
          <select
            className="select"
            value={countryId}
            disabled={!!rows || busy}
            onChange={(e) => setCountryId(e.target.value)}
          >
            {countries.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-field" style={{ width: 200 }}>
          <label>Devise des prix du fichier</label>
          <select
            className="select"
            value={currency}
            disabled={!!rows || busy}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="" disabled>Choisir une devise…</option>
            {currencies.filter((c) => c.active || c.code === currency).map((c) => <option key={c.id} value={c.code}>{c.code} - {c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="text-muted" style={{ fontSize: 12, margin: '4px 0 16px' }}>
        Les colonnes reconnues : code/IMPA, nom, unité, prix (les intitulés peuvent varier). La devise est indépendante du pays :
        changez-la si les prix du fichier ne sont pas dans la devise habituelle de ce pays.
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
            {fileName}{stats ? ` (${stats.sheets} feuille(s), ${stats.read} ligne(s) lue(s)${stats.ignored > 0 ? `, ${stats.ignored} ignorée(s) : pieds de page et libellés` : ''})` : ''} - {groups.length} produit(s) distinct(s) ({duplicateRows} doublon(s) regroupé(s), dont {identicalRows} identique(s) fusionné(s) d'office) : {groups.filter((g) => !status(activeOf(g.root)).existing).length} nouveau(x), {groups.filter((g) => status(activeOf(g.root)).existing).length} déjà au catalogue - {selected.size} sélectionné(s).
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setRows(null)}>Changer de fichier</button>
            <button
              className={`btn btn-sm ${onlyNoPrice ? 'btn-primary' : ''}`}
              style={{ marginLeft: 8 }}
              onClick={() => setOnlyNoPrice((v) => !v)}
              disabled={noPriceCount === 0 && !onlyNoPrice}
              aria-pressed={onlyNoPrice}
            >
              {onlyNoPrice ? `Sans prix uniquement (${noPriceCount})` : `Afficher les produits sans prix (${noPriceCount})`}
            </button>
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Tout sélectionner" /></th><th>Code</th><th>Nom</th><th>Unité</th><th className="text-right">Prix</th><th></th></tr></thead>
              <tbody>
                {onlyNoPrice && visibleGroups.length === 0 && (
                  <tr><td colSpan={6} className="text-muted" style={{ padding: 24 }}>Tous les produits ont un prix.</td></tr>
                )}
                {visibleGroups.map(({ root, members }) => {
                  const i = activeOf(root);
                  const row = rows[i];
                  const { existing: linked, priceChange } = status(i);
                  const others = members.filter((m) => m !== i && !sameRow(rows[m], row)); // à départager
                  const merged = members.length - 1 - others.length; // identiques : fusionnés d'office
                  const expanded = open.has(root) && others.length > 0;
                  return (
                    <React.Fragment key={root}>
                      <tr className={expanded ? 'has-proposals' : undefined} style={selected.has(root) ? undefined : { opacity: 0.5 }}>
                        <td><input type="checkbox" checked={selected.has(root)} onChange={() => toggleRow(root)} aria-label={`Sélectionner ${row.name}`} /></td>
                        <td>
                          <input key={`c${i}${row.code ?? ''}`} className="input cell-input mono" style={{ width: 110 }} defaultValue={row.code ?? ''}
                            onBlur={(e) => { const v = e.target.value.trim() || undefined; if (v !== row.code) void editRow(i, { code: v }); }} />
                        </td>
                        <td style={{ width: '100%', minWidth: 380 }}>
                          <input key={`n${i}${row.name}`} className="input cell-input" style={{ width: '100%' }} defaultValue={row.name}
                            onBlur={(e) => { const v = e.target.value.trim(); if (v !== row.name) void editRow(i, { name: v }); }} />
                          {row.matchedBy === 'code' && row.existingName && (
                            <div className="text-muted" style={{ fontSize: 12 }}>= {row.existingCode ? `${row.existingCode} - ` : ''}{row.existingName}</div>
                          )}
                          {row.matchedBy === 'name' && row.existingName && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                              <span className="text-muted" style={{ fontSize: 12 }}>
                                Nom proche de {row.existingCode ? `${row.existingCode} - ` : ''}{row.existingName}
                              </span>
                              {isForceNew(i) ? (
                                <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', fontSize: 11 }}
                                  onClick={() => setForceNewOverride((prev) => ({ ...prev, [i]: false }))}
                                  title="Traiter cette ligne comme une mise à jour du produit existant, au lieu d'en créer un nouveau">
                                  <Link2 size={11} /> Lier à ce produit
                                </button>
                              ) : (
                                <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', fontSize: 11 }}
                                  onClick={() => setForceNewOverride((prev) => ({ ...prev, [i]: true }))}
                                  title="Créer un produit distinct au lieu de mettre à jour celui trouvé par le nom">
                                  <Unlink size={11} /> Produit distinct
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <input key={`u${i}${row.unit ?? ''}`} className="input cell-input" style={{ width: 70 }} defaultValue={row.unit ?? ''}
                            onBlur={(e) => { const v = e.target.value.trim() || undefined; if (v !== row.unit) void editRow(i, { unit: v }); }} />
                        </td>
                        <td className="text-right">
                          <input key={`p${i}${row.price ?? ''}`} className="input cell-input mono" style={{ width: 110, textAlign: 'right' }} inputMode="decimal"
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {!linked ? (
                              <span className="tag tag-new"><PlusCircle size={13} /> Nouveau</span>
                            ) : priceChange ? (
                              <span className="tag tag-update"><RefreshCw size={13} /> Prix modifié</span>
                            ) : (
                              <span className="tag tag-same"><Check size={13} /> Inchangé</span>
                            )}
                            {merged > 0 && (
                              <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }} title="Lignes identiques (même code, nom, unité et prix) fusionnées automatiquement">
                                +{merged} identique{merged > 1 ? 's' : ''}
                              </span>
                            )}
                            {others.length > 0 && (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ padding: '2px 6px' }}
                                onClick={() => toggleOpen(root)}
                                title={expanded ? 'Masquer les doublons' : 'Voir les doublons pour choisir'}
                                aria-expanded={expanded}
                              >
                                {others.length} doublon{others.length > 1 ? 's' : ''} {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && others.map((m, mi) => {
                        const d = rows[m];
                        return (
                          <tr key={`${root}-${m}`} className={`proposal-row ${mi === others.length - 1 ? 'proposal-last' : ''}`}>
                            <td></td>
                            <td><input readOnly tabIndex={-1} className="input cell-input cell-readonly mono" style={{ width: 110 }} value={d.code ?? ''} /></td>
                            <td><input readOnly tabIndex={-1} className="input cell-input cell-readonly" style={{ width: '100%' }} value={d.name} /></td>
                            <td><input readOnly tabIndex={-1} className="input cell-input cell-readonly" style={{ width: 70 }} value={d.unit ?? ''} /></td>
                            <td className="text-right"><input readOnly tabIndex={-1} className="input cell-input cell-readonly mono" style={{ width: 110, textAlign: 'right' }} value={d.price !== undefined ? d.price.toFixed(2) : ''} placeholder="-" /></td>
                            <td>
                              <button className="btn btn-sm" onClick={() => setPick((prev) => ({ ...prev, [root]: m }))}><Check size={13} /> Choisir</button>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
