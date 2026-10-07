import React from 'react';
import { useMutation } from 'convex/react';
import { CheckSquare, Plus, Trash2, Upload } from 'lucide-react';
import type { Country, ProductCategory, ProductWithPrices } from '../types';
import { api, type Id } from '../lib/convex';
import { Modal, StateBox } from '../components/ui';
import { NumberCell, TextCell } from '../components/EditableCells';
import { useToast } from '../components/Toast';
import { CatalogImportModal } from '../components/CatalogImportModal';
import { Pager, usePage } from '../components/Pager';
import { formatPrice, regionLabel } from '../lib/format';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const NO_CATEGORY = '__none__'; // valeur du filtre/classement « sans catégorie »

/**
 * Catalogue : chaque cellule est directement modifiable par l'admin (code, nom, catégorie, unité et
 * prix par pays), sur le même principe que les lignes d'une quotation. Les prix précédents restent
 * dans l'historique.
 */
export function Products({
  products,
  countries,
  categories,
  loading,
  isAdmin,
}: {
  products: ProductWithPrices[];
  countries: Country[];
  categories: ProductCategory[];
  loading: boolean;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const createProduct = useMutation(api.products.createManual);
  const updateProduct = useMutation(api.products.update);
  const removeProduct = useMutation(api.products.remove);
  const removeMany = useMutation(api.products.removeMany);
  const setCategoryMany = useMutation(api.products.setCategoryMany);
  const [bulkCategory, setBulkCategory] = React.useState('');
  const [classifying, setClassifying] = React.useState(false);
  const [showTiles, setShowTiles] = React.useState(true);
  // Mode sélection (suppression en masse)
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<ProductWithPrices | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const setPrice = useMutation(api.productPrices.setPrice);
  const [showAdd, setShowAdd] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [countryFilter, setCountryFilter] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState('');
  const [showEmpty, setShowEmpty] = React.useState(false); // afficher aussi les lignes (produit, pays) sans prix

  // Formulaire d'ajout : la « référence » de l'UI correspond à l'IMPA/code du catalogue
  const [ref, setRef] = React.useState('');
  const [name, setName] = React.useState('');
  const [unit, setUnit] = React.useState('PCS');
  const [newCategory, setNewCategory] = React.useState('');
  const [newCountryId, setNewCountryId] = React.useState('');
  const [newPrice, setNewPrice] = React.useState('');
  const [newPriceCurrency, setNewPriceCurrency] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  // Devise choisie pour une nouvelle ligne de prix dans la grille (produit, pays) qui n'en a pas encore -
  // indépendante du pays, comme à l'import (voir CatalogImportModal). Clé : `${productId}:${countryId}`.
  const [gridPriceCurrency, setGridPriceCurrency] = React.useState<Record<string, string>>({});

  const activeCountries = countries.filter((c) => c.active); // pour l'import
  const priceCountries = countries; // colonnes de prix : tous les pays, actifs ou non

  const submitProduct = async () => {
    if (!name.trim()) { toast('Le nom est requis.', 'error'); return; }
    setSaving(true);
    try {
      const price = newPrice.trim() === '' ? undefined : Math.round(Number(newPrice.trim().replace(',', '.')) * 100) / 100;
      if (price !== undefined && (!Number.isFinite(price) || price < 0)) { toast('Prix invalide.', 'error'); setSaving(false); return; }
      const country = countries.find((c) => c.id === newCountryId);
      if (price !== undefined && !country) { toast('Choisissez la région de ce prix.', 'error'); setSaving(false); return; }

      const productId = await createProduct({ impaId: ref.trim() || undefined, name: name.trim(), unit: unit.trim() || 'PCS', category: newCategory || undefined });
      if (price !== undefined && country) {
        await setPrice({ productId, countryId: country.id as Id<'countries'>, price, currency: newPriceCurrency });
      }
      toast('Produit ajouté.', 'success');
      setShowAdd(false);
      setRef(''); setName(''); setUnit('PCS'); setNewPrice(''); setNewCategory('');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const edit = (p: ProductWithPrices, patch: { name?: string; unit?: string; code?: string; category?: string }) =>
    updateProduct({ productId: p.id as Id<'products'>, ...patch }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const { affectedLines } = await removeProduct({ productId: toDelete.id as Id<'products'> });
      toast(`Produit supprimé définitivement${affectedLines > 0 ? ` (${affectedLines} ligne(s) de quotation repassent en « Inconnu »)` : ''}.`, 'success');
      setToDelete(null);
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const savePrice = (p: ProductWithPrices, c: Country, price: number, currency: string) =>
    setPrice({
      productId: p.id as Id<'products'>,
      countryId: c.id as Id<'countries'>,
      price,
      currency,
    })
      .then(() => toast(`Prix ${c.code} enregistré : ${formatPrice(price, currency)}.`, 'success'))
      .catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  const exitSelection = () => { setSelectMode(false); setSelected(new Set()); };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = async () => {
    setBulkDeleting(true);
    try {
      const ids = [...selected] as Id<'products'>[];
      let affected = 0;
      for (let i = 0; i < ids.length; i += 50) {
        affected += (await removeMany({ productIds: ids.slice(i, i + 50) })).affectedLines;
      }
      toast(`${ids.length} produit(s) supprimé(s) définitivement${affected > 0 ? ` (${affected} ligne(s) de quotation repassent en « Inconnu »)` : ''}.`, 'success');
      setConfirmBulk(false);
      exitSelection();
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  const classifySelected = async () => {
    setClassifying(true);
    try {
      const ids = [...selected] as Id<'products'>[];
      const category = bulkCategory === NO_CATEGORY ? '' : bulkCategory;
      for (let i = 0; i < ids.length; i += 200) {
        await setCategoryMany({ productIds: ids.slice(i, i + 200), category });
      }
      toast(`${ids.length} produit(s) ${category ? `classé(s) dans « ${category} »` : 'sans catégorie'}.`, 'success');
      setBulkCategory('');
      exitSelection();
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setClassifying(false);
    }
  };

  const term = search.trim().toLowerCase();
  const byTerm = term
    ? products.filter((p) => p.name.toLowerCase().includes(term) || p.reference.toLowerCase().includes(term))
    : products;
  const visible = !categoryFilter
    ? byTerm
    : categoryFilter === NO_CATEGORY
      ? byTerm.filter((p) => !p.category)
      : byTerm.filter((p) => p.category === categoryFilter);

  // Nombre de produits par catégorie (selon la recherche en cours) pour les tuiles, comme sur impa.services.
  const countByCategory = new Map<string, number>();
  let uncategorized = 0;
  for (const p of byTerm) {
    if (p.category) countByCategory.set(p.category, (countByCategory.get(p.category) ?? 0) + 1);
    else uncategorized++;
  }
  const tileCategories = categories.filter((c) => c.active || countByCategory.has(c.name));

  // Une ligne par produit et par pays : ... | Unit | Unit Price | Country
  const shownCountries = countryFilter ? priceCountries.filter((c) => c.id === countryFilter) : priceCountries;
  // Par défaut, seules les lignes qui ont un prix sont affichées - y compris un produit sans aucun prix nulle
  // part, qui disparaît alors entièrement de la liste. Cochez "Afficher les lignes sans prix" pour le retrouver
  // et lui donner un premier prix.
  let hiddenCount = 0;
  const rows = visible.flatMap((p) => {
    const all = shownCountries.map((c) => ({ p, c }));
    if (showEmpty) return all;
    const priced = all.filter(({ c }) => p.product_prices.some((pr) => pr.country_id === c.id));
    hiddenCount += all.length - priced.length;
    return priced;
  });

  // Seules 100 lignes sont dessinées à la fois (la liste complète reste filtrable/sélectionnable).
  const paged = usePage(rows, `${search}|${countryFilter}|${categoryFilter}|${showEmpty}`);

  if (loading) return <StateBox loading title="Chargement du catalogue…" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Produits & prix</h1>
          <p className="page-subtitle">
            Catalogue produits avec tarifs par région.{isAdmin ? ' Cliquez sur une cellule pour la modifier.' : ''}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => { setNewCountryId(countryFilter || priceCountries[0]?.id || ''); setShowAdd(true); }}><Plus size={16} /> Ajouter un produit</button>
            <button className={`btn ${selectMode ? 'btn-primary' : ''}`} onClick={() => (selectMode ? exitSelection() : setSelectMode(true))}>
              <CheckSquare size={16} /> {selectMode ? 'Terminer la sélection' : 'Sélectionner'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowImport(true)}><Upload size={16} /> Importer un catalogue</button>
          </div>
        )}
      </div>

      {categories.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTiles ? 12 : 0 }}>
            <div className="section-title" style={{ margin: 0 }}>Catégories</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {categoryFilter && <button className="btn btn-ghost btn-sm" onClick={() => setCategoryFilter('')}>Tout afficher</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => setShowTiles((s) => !s)}>{showTiles ? 'Masquer' : 'Afficher'}</button>
            </div>
          </div>
          {showTiles && (
            <div className="cat-grid">
              {tileCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cat-tile ${categoryFilter === c.name ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(categoryFilter === c.name ? '' : c.name)}
                  title={c.name}
                >
                  <span className="cat-name">{c.name}</span>
                  <span className="cat-count">{countByCategory.get(c.name) ?? 0}</span>
                </button>
              ))}
              {uncategorized > 0 && (
                <button
                  type="button"
                  className={`cat-tile ${categoryFilter === NO_CATEGORY ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(categoryFilter === NO_CATEGORY ? '' : NO_CATEGORY)}
                >
                  <span className="cat-name">Sans catégorie</span>
                  <span className="cat-count">{uncategorized}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 16 }}>Catalogue produits</h3>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {visible.length} produit(s) · {countryFilter
                ? `${shownCountries[0]?.name ?? ''} (${shownCountries[0]?.currency ?? ''})`
                : `${priceCountries.length} région(s)`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
              Afficher les lignes sans prix{!showEmpty && hiddenCount > 0 ? ` (${hiddenCount} masquée${hiddenCount > 1 ? 's' : ''})` : ''}
            </label>
            <select className="select" style={{ width: 200 }} value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Région">
              <option value="">Toutes les régions</option>
              {priceCountries.map((c) => <option key={c.id} value={c.id}>{c.code} - {regionLabel(c)}</option>)}
            </select>
            <select className="select" style={{ width: 200 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Catégorie">
              <option value="">Toutes les catégories</option>
              <option value={NO_CATEGORY}>Sans catégorie</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <select className="select" style={{ width: 200 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Catégorie">
              <option value="">Toutes les catégories</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input className="input" style={{ width: 260 }} placeholder="Rechercher (nom, code)…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {selectMode && (
          <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--color-surface-2)' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{selected.size} produit(s) sélectionné(s)</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="select" style={{ width: 220, height: 32 }} value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} aria-label="Classer dans" disabled={selected.size === 0}>
                <option value="" disabled>Classer dans…</option>
                <option value={NO_CATEGORY}>Sans catégorie</option>
                {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <button className="btn btn-sm btn-primary" onClick={() => void classifySelected()} disabled={selected.size === 0 || !bulkCategory || classifying}>
                {classifying ? 'Classement…' : 'Classer'}
              </button>
              <button className="btn btn-sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Tout désélectionner</button>
              <button
                className="btn btn-sm btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => setConfirmBulk(true)}
                disabled={selected.size === 0}
              >
                <Trash2 size={14} /> Supprimer ({selected.size})
              </button>
            </div>
          </div>
        )}
        <div className="table-scroll" style={{ maxHeight: '70vh', border: 'none', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                {selectMode && (
                  <th style={{ width: 30 }}>
                    <input
                      type="checkbox"
                      checked={visible.length > 0 && visible.every((p) => selected.has(p.id))}
                      onChange={() => setSelected(visible.every((p) => selected.has(p.id)) ? new Set() : new Set(visible.map((p) => p.id)))}
                      aria-label="Tout sélectionner"
                      title="Sélectionner tous les produits affichés"
                    />
                  </th>
                )}
                <th style={{ width: 48 }}>No.</th>
                <th style={{ width: 130 }}>Code</th>
                <th>Description</th>
                <th style={{ width: 160 }}>Category</th>
                <th style={{ width: 90 }}>Unit</th>
                <th className="text-right">Unit Price</th>
                <th style={{ width: 110 }}>Region</th>
                {isAdmin && <th style={{ width: 44 }}></th>}
              </tr>
            </thead>
            <tbody>
              {paged.slice.map(({ p, c }, i) => {
                const index = paged.offset + i;
                const price = p.product_prices.find((pr) => pr.country_id === c.id);
                return (
                  <tr key={`${p.id}-${c.id}`} style={selectMode && selected.has(p.id) ? { background: 'var(--color-primary-soft)' } : undefined}>
                    {selectMode && (
                      <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Sélectionner ${p.name}`} /></td>
                    )}
                    <td className="text-muted mono">{index + 1}</td>
                    <td>
                      <TextCell mono width={110} disabled={!isAdmin} value={p.reference}
                        onCommit={(v) => edit(p, { code: v.trim() })} />
                    </td>
                    <td style={{ minWidth: 220 }}>
                      <TextCell width="100%" disabled={!isAdmin} value={p.name}
                        onCommit={(v) => { if (v.trim()) void edit(p, { name: v.trim() }); else toast('Le nom ne peut pas être vide.', 'error'); }} />
                    </td>
                    <td>
                      <select className="select cell-input" style={{ width: '100%' }} disabled={!isAdmin} value={p.category} onChange={(e) => void edit(p, { category: e.target.value })}>
                        <option value="">-</option>
                        {!categories.some((c) => c.name === p.category) && p.category && <option value={p.category}>{p.category}</option>}
                        {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <TextCell width={80} disabled={!isAdmin} value={p.unit}
                        onCommit={(v) => { if (v.trim()) void edit(p, { unit: v.trim() }); else toast("L'unité ne peut pas être vide.", 'error'); }} />
                    </td>
                    <td className="text-right">
                      <NumberCell
                        width={110}
                        decimals={2}
                        disabled={!isAdmin}
                        value={price ? price.base_price : null}
                        placeholder="-"
                        onCommit={(v) => void savePrice(p, c, v, gridPriceCurrency[`${p.id}:${c.id}`] ?? price?.currency ?? currencies.find((cur) => cur.active)?.code ?? '')}
                      />
                    </td>
                    <td>
                      <select
                        className="select cell-input"
                        style={{ width: 72 }}
                        disabled={!isAdmin}
                        value={gridPriceCurrency[`${p.id}:${c.id}`] ?? price?.currency ?? currencies.find((cur) => cur.active)?.code ?? ''}
                        onChange={(e) => setGridPriceCurrency((prev) => ({ ...prev, [`${p.id}:${c.id}`]: e.target.value }))}
                        title="Devise de ce prix, indépendante du pays"
                      >
                        {price && !currencies.some((cur) => cur.code === price.currency) && <option value={price.currency}>{price.currency}</option>}
                        {currencies.filter((cur) => cur.active || cur.code === price?.currency).map((cur) => <option key={cur.id} value={cur.code}>{cur.code}</option>)}
                      </select>
                    </td>
                    <td className="mono nowrap" title={c.name} style={{ fontWeight: 600 }}>
                      {c.code}
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-ghost btn-sm" title="Supprimer" aria-label={`Supprimer ${p.name}`} onClick={() => setToDelete(p)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {paged.total === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="text-muted" style={{ padding: 24 }}>Aucun produit.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={paged.page} pages={paged.pages} total={paged.total} pageSize={paged.pageSize} setPage={paged.setPage} />
      </div>

      {confirmBulk && (
        <Modal
          title="Supprimer définitivement les produits sélectionnés ?"
          onClose={() => !bulkDeleting && setConfirmBulk(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirmBulk(false)} disabled={bulkDeleting}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => void deleteSelected()} disabled={bulkDeleting}>
              {bulkDeleting ? 'Suppression…' : `Supprimer ${selected.size} produit(s)`}
            </button>
          </>}
        >
          <p><strong>{selected.size} produit(s)</strong> seront supprimés définitivement, avec tous leurs prix par région.</p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            Les lignes de quotation qui les utilisent repasseront en « Inconnu ». Une copie de sauvegarde est conservée à
            part, hors de l'application, pour pouvoir les récupérer en cas d'erreur.
          </p>
        </Modal>
      )}

      {toDelete && (
        <Modal
          title="Supprimer définitivement ce produit ?"
          onClose={() => !deleting && setToDelete(null)}
          footer={<>
            <button className="btn" onClick={() => setToDelete(null)} disabled={deleting}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </button>
          </>}
        >
          <p>
            <strong>{toDelete.reference ? `${toDelete.reference} - ` : ''}{toDelete.name}</strong> sera supprimé définitivement, avec ses prix par région.
          </p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            Les lignes de quotation qui l'utilisent repasseront en « Inconnu ». Une copie de sauvegarde est conservée à
            part, hors de l'application, pour pouvoir le récupérer en cas d'erreur.
          </p>
        </Modal>
      )}

      {showImport && <CatalogImportModal countries={activeCountries} currencies={currencies} onClose={() => setShowImport(false)} />}

      {showAdd && (
        <Modal
          title="Ajouter un produit"
          onClose={() => setShowAdd(false)}
          footer={<>
            <button className="btn" onClick={() => setShowAdd(false)}>Annuler</button>
            <button className="btn btn-primary" onClick={submitProduct} disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter'}</button>
          </>}
        >
          <div className="form-field"><label>Code (optionnel)</label><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="150301" /></div>
          <div className="form-field"><label>Description</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Safety Goggles" /></div>
          <div className="form-field"><label>Unit</label><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          <div className="form-field">
            <label>Category</label>
            <select className="select" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              <option value="">-</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label>Region</label>
              <select className="select" value={newCountryId} onChange={(e) => setNewCountryId(e.target.value)}>
                <option value="">Aucun</option>
                {priceCountries.map((c) => <option key={c.id} value={c.id}>{c.code}{c.active ? '' : ' (inactif)'} ({c.currency})</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Unit Price</label>
              <input className="input" inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" disabled={!newCountryId} />
            </div>
            <div className="form-field">
              <label>Devise</label>
              <select className="select" value={newPriceCurrency} onChange={(e) => setNewPriceCurrency(e.target.value)} disabled={!newCountryId}>
                <option value="" disabled>-</option>
                {currencies.filter((cur) => cur.active).map((cur) => <option key={cur.id} value={cur.code}>{cur.code}</option>)}
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
